import { factionDef } from '../data/factions';
import { unitDef } from '../data/units';
import { fullName } from './characters';
import type { Sim } from './context';
import { addModifier, atWar, setTransferProvince, warBetween } from './diplomacy';
import { armyInSettlement, destroyArmy, destroyFleet, refreshGarrison } from './military';
import type { ArmyState, FactionId, ProvinceState } from './types';

export function transferProvince(sim: Sim, pid: number, to: FactionId, how: 'conquest' | 'treaty' | 'rebellion' | 'union') {
  const p = sim.s.provinces[pid];
  const from = p.owner;
  if (from === to) return;
  const pg = sim.geo.provinces[pid];
  p.previousOwners.push({ faction: from, untilTurn: sim.s.turn });
  if (p.previousOwners.length > 6) p.previousOwners.shift();
  p.owner = to;
  p.siege = undefined;
  p.settlement.construction = [];
  p.settlement.recruitment = [];
  p.governor = undefined;
  if (how === 'conquest' || how === 'rebellion') {
    p.conqueredTurn = sim.s.turn;
    p.publicOrder = Math.min(p.publicOrder, -10);
    p.settlement.gateHp = Math.max(p.settlement.gateHp, 200);
  } else p.publicOrder = Math.min(p.publicOrder, 10);
  p.settlement.garrison = [];
  refreshGarrison(sim, p, false);
  // remove claims the new owner held on this province (fulfilled)
  for (const c of Object.values(sim.s.characters)) {
    if (c.faction === to) c.claims = c.claims.filter((cl) => !(cl.kind === 'province' && cl.target === pid));
  }
  const fromF = sim.s.factions[from];
  const toF = sim.s.factions[to];
  if (fromF && fromF.alive && from !== 'free' && from !== 'rebels') {
    // historic claim for the dispossessed dynasty
    const ruler = sim.char(fromF.ruler);
    if (ruler && how !== 'treaty') ruler.claims.push({ kind: 'province', target: pid, strength: 2, source: 'history', sinceTurn: sim.s.turn });
    if (how === 'conquest') addModifier(sim, from, to, `took_${pid}`, `Took ${pg.name} from us`, -30, 0.15);
    if (fromF.capital === pid) relocateCapital(sim, from);
    fromF.prestige = Math.max(0, fromF.prestige - (10 + p.settlement.tier * 10 + (pg.anchor.greatCapital ? 60 : 0)));
  }
  if (toF && how === 'conquest') {
    toF.prestige += 10 + p.settlement.tier * 10 + (pg.anchor.greatCapital ? 60 : 0);
    const war = warBetween(sim, from, to);
    if (war) {
      const delta = 12 + p.settlement.tier * 6 + (fromF?.capital === pid || pg.anchor.greatCapital ? 20 : 0);
      war.score += war.attackers.includes(to) ? delta : -delta;
      war.score = Math.max(-100, Math.min(100, war.score));
    }
  }
  sim.emit({ type: 'OWNERSHIP_CHANGED', province: pid, from, to, how });
  if (how === 'conquest' || how === 'rebellion') sim.emit({ type: 'CITY_CAPTURED', province: pid, from, to });
  sim.chronicle(`${pg.name} passed from ${sim.houseName(from)} to ${sim.houseName(to)} (${how}).`, [from, to], 'capture');
  const player = sim.s.player;
  if (from === player) sim.notify({ kind: 'danger', title: `${pg.name} Lost`, text: `${pg.name} has fallen to ${sim.houseName(to)}.`, focus: { x: pg.x, z: pg.z } });
  else if (to === player) sim.notify({ kind: 'military', title: `${pg.name} Taken`, text: `${pg.name} is now yours. Its people watch their new lords warily.`, focus: { x: pg.x, z: pg.z } });
  else if (pg.anchor.greatCapital) sim.notify({ kind: 'war', title: `${pg.name} Has Fallen`, text: `${sim.houseName(to)} has taken ${pg.name} from ${sim.houseName(from)}.`, focus: { x: pg.x, z: pg.z } });
  if (fromF && fromF.alive && sim.provincesOf(from).length === 0) eliminateFaction(sim, from, to);
}
setTransferProvince(transferProvince);

export function relocateCapital(sim: Sim, fid: FactionId) {
  const f = sim.fac(fid);
  const provs = sim.provincesOf(fid);
  if (!provs.length) return;
  provs.sort((a, b) => b.settlement.tier * 10000 + b.population - (a.settlement.tier * 10000 + a.population));
  f.capital = provs[0].id;
  f.legitimacy = Math.max(0, f.legitimacy - 15);
  sim.notify({ kind: 'danger', title: 'Court in Exile', text: `The court of ${sim.houseName(fid)} flees to ${sim.provName(f.capital)}.` }, fid);
}

export function eliminateFaction(sim: Sim, fid: FactionId, by: FactionId) {
  const f = sim.fac(fid);
  if (!f.alive) return;
  f.alive = false;
  for (const a of Object.values(sim.s.armies)) if (a.faction === fid) destroyArmy(sim, a, 'disbanded');
  for (const fl of Object.values(sim.s.fleets)) if (fl.faction === fid) destroyFleet(sim, fl, 'disbanded');
  const d = sim.s.diplomacy;
  d.treaties = d.treaties.filter((t) => t.a !== fid && t.b !== fid);
  for (const w of d.wars) {
    w.attackers = w.attackers.filter((x) => x !== fid);
    w.defenders = w.defenders.filter((x) => x !== fid);
  }
  d.wars = d.wars.filter((w) => w.attackers.length && w.defenders.length);
  // surviving family keep claims on their former capital: exiles
  const capitalPid = sim.geo.provinces.find((p) => p.anchor.owner === fid && p.anchor.kind === 'capital')?.id;
  for (const c of Object.values(sim.s.characters)) {
    if (!c.alive || c.faction !== fid) continue;
    c.role = 'family';
    c.council = undefined;
    if (capitalPid !== undefined && c.dynasty === fid) c.claims.push({ kind: 'province', target: capitalPid, strength: 3, source: 'inheritance', sinceTurn: sim.s.turn });
  }
  if (fid !== 'rebels' && fid !== 'free') {
    sim.chronicle(`${sim.houseName(fid)} lost the last of its lands. Its heirs wander in exile.`, [fid, by], 'elimination');
    sim.notify({ kind: 'war', title: `${sim.houseName(fid)} Has Fallen`, text: `${factionDef(fid).realm} is no more. The surviving members of ${sim.houseName(fid)} live in exile, their claims unforgotten.` });
  }
  sim.emit({ type: 'FACTION_ELIMINATED', faction: fid, by });
}

export function sackSettlement(sim: Sim, pid: number, fid: FactionId): number {
  const p = sim.s.provinces[pid];
  const loot = Math.round(p.population * 0.05 + p.settlement.tier * 180 + 100);
  sim.fac(fid).treasury += loot;
  p.population = Math.round(p.population * 0.7);
  p.publicOrder = Math.max(-100, p.publicOrder - 35);
  p.sacked = sim.s.turn;
  const econ = p.settlement.buildings.filter((b) => b.id !== 'walls');
  if (econ.length) sim.rng.pick(econ).damaged = true;
  sim.s.diplomacy.reputation[fid] = Math.max(0, (sim.s.diplomacy.reputation[fid] ?? 60) - 4);
  sim.chronicle(`${sim.houseName(fid)} sacked ${p.settlement.name}.`, [fid], 'sack');
  return loot;
}

// ------------------------------------------------------------------------ sieges

export function wallsOf(p: ProvinceState) {
  return p.settlement.walls;
}

export function isBesiegeable(p: ProvinceState) {
  return p.settlement.walls > 0;
}

export function siegeSupplyTurns(sim: Sim, p: ProvinceState): number {
  const st = p.settlement;
  let t = 2 + st.walls * 2 + (st.fortress ? 2 : 0);
  if (st.isPort && !p.blockaded) t += 3;
  if (st.buildings.some((b) => b.id === 'farm')) t += 1;
  return t;
}

export function startSiege(sim: Sim, army: ArmyState, pid: number) {
  const p = sim.s.provinces[pid];
  army.siegeOf = pid;
  army.stance = 'siege';
  army.path = [];
  army.movePoints = 0;
  p.siege = { armyId: army.id, faction: army.faction, turns: 0, equipment: army.units.some((u) => ['ram', 'catapult', 'trebuchet'].includes(u.type)) ? 1 : 0 };
  sim.s.stats.sieges++;
  sim.emit({ type: 'SIEGE_STARTED', province: pid, army: army.id });
  const pg = sim.geo.provinces[pid];
  if (p.owner === sim.s.player) sim.notify({ kind: 'danger', title: `${pg.name} Under Siege`, text: `${sim.houseName(army.faction)} has laid siege to ${pg.name}. Supplies will last ${siegeSupplyTurns(sim, p)} seasons.`, focus: { x: pg.x, z: pg.z } });
}

export function canAssault(sim: Sim, army: ArmyState, p: ProvinceState): boolean {
  if (p.settlement.walls === 0) return true;
  if (army.units.some((u) => ['ram', 'catapult', 'trebuchet'].includes(u.type))) return true;
  return (p.siege?.armyId === army.id && p.siege.equipment >= 1) || false;
}

/** Called each turn to advance all sieges. */
export function updateSieges(sim: Sim) {
  for (const p of sim.s.provinces) {
    if (!p.siege) continue;
    const army = sim.s.armies[p.siege.armyId];
    const pg = sim.geo.provinces[p.id];
    if (!army || !atWar(sim, army.faction, p.owner) || Math.hypot(army.x - pg.x, army.z - pg.z) > pg.radius + 90) {
      if (army) {
        army.siegeOf = undefined;
        if (army.stance === 'siege') army.stance = 'normal';
      }
      p.siege = undefined;
      continue;
    }
    p.siege.turns++;
    p.siege.equipment = Math.min(3, p.siege.equipment + 1);
    const supply = siegeSupplyTurns(sim, p);
    if (p.siege.turns > supply) {
      // starvation within the walls
      const defenders = armyInSettlement(sim, p.id);
      let alive = 0;
      for (const u of p.settlement.garrison) {
        u.troops = Math.floor(u.troops * 0.8);
        alive += u.troops;
      }
      p.settlement.garrison = p.settlement.garrison.filter((u) => u.troops > 4);
      if (defenders) {
        for (const u of defenders.units) {
          u.troops = Math.floor(u.troops * 0.85);
          alive += u.troops;
        }
        defenders.units = defenders.units.filter((u) => u.troops > 4);
        if (!defenders.units.length) destroyArmy(sim, defenders, 'starved');
      }
      p.population = Math.round(p.population * 0.95);
      if (alive < 40) {
        // surrender
        sim.notify({ kind: 'military', title: `${pg.name} Surrenders`, text: `Starving and hopeless, ${pg.name} opens its gates to ${sim.houseName(army.faction)}.`, focus: { x: pg.x, z: pg.z } }, sim.s.player);
        const fid = army.faction;
        army.siegeOf = undefined;
        army.stance = 'normal';
        transferProvince(sim, p.id, fid, 'conquest');
        army.x = pg.x + Math.cos(pg.coastAngle + Math.PI) * 10;
        army.z = pg.z + Math.sin(pg.coastAngle + Math.PI) * 10;
      }
    }
  }
}

export function settlementDefenders(sim: Sim, pid: number): { army?: ArmyState; garrisonTroops: number } {
  const p = sim.s.provinces[pid];
  return { army: armyInSettlement(sim, pid), garrisonTroops: p.settlement.garrison.reduce((s, u) => s + u.troops, 0) };
}

export function isSettlementEmpty(sim: Sim, pid: number) {
  const d = settlementDefenders(sim, pid);
  return !d.army && d.garrisonTroops < 1;
}

export function describeCapture(sim: Sim, pid: number) {
  const p = sim.s.provinces[pid];
  const gov = sim.char(p.governor);
  return gov ? fullName(gov) : '';
}

export function unitIsSiege(type: string) {
  return unitDef(type).category === 'siege';
}
