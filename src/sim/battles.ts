import { factionDef } from '../data/factions';
import { shipDef, unitDef } from '../data/units';
import { fullName, killCharacter, skillOf } from './characters';
import type { Sim } from './context';
import { sackSettlement, transferProvince } from './conquest';
import { atWar, isAllied, warBetween } from './diplomacy';
import { armyInSettlement, destroyArmy, destroyFleet, factionUnitMods, troopCount, unitPower, shipPower } from './military';
import { biomeAt, cellX, cellZ, NavT, type TerrainKind } from './world/geo';
import type { ArmyState, FactionId, FleetState, UnitState, WeatherKind } from './types';
import { seasonOf } from './types';

export type BattleKind = 'field' | 'siege' | 'naval';

export interface BattleSide {
  faction: FactionId;
  armies: number[];
  fleets: number[];
  garrisonOf?: number;
}

export interface BattleSetup {
  kind: BattleKind;
  attacker: BattleSide;
  defender: BattleSide;
  province: number;
  x: number;
  z: number;
  terrain: TerrainKind;
  weather: WeatherKind;
  season: number;
  walls: number;
  towers: number;
  gateHp: number;
  coastal: boolean;
  river: boolean;
  settlement: boolean;
  seed: number;
}

export interface UnitLoss {
  uid: number;
  lost: number;
}

export interface BattleOutcome {
  winner: 'attacker' | 'defender';
  losses: UnitLoss[]; // by unit uid (armies + garrison)
  shipDamage: { uid: number; hull: number; crew: number }[];
  shipsSunk: number[];
  shipsCaptured: number[];
  generalsKilled: number[];
  generalsWounded: number[];
  settlementTaken: boolean;
  killsA: number;
  killsD: number;
  heroic?: boolean;
  summary?: string;
  tactical?: boolean;
}

export function battleTerrainAt(sim: Sim, x: number, z: number, pid: number): TerrainKind {
  const b = biomeAt(sim.geo, x, z);
  const g = sim.geo;
  const c = Math.floor(z / g.navStep) * g.navW + Math.floor(x / g.navStep);
  const t = g.nav[c];
  if (b === 9) return 'snow';
  if (t === NavT.Mountain) return 'mountain';
  if (t === NavT.Hills) return 'hills';
  if (b === 5 || b === 6) return 'forest';
  if (b === 10) return 'dry';
  if (b === 4) return 'farmland';
  if (g.coastDist[c] <= 3) return 'coast';
  return pid >= 0 ? sim.geo.provinces[pid].terrain : 'plains';
}

/** Armies of a side (allied, within range) that join as reinforcements. */
export function gatherReinforcements(sim: Sim, faction: FactionId, x: number, z: number, exclude: number[], enemy: FactionId): number[] {
  const out: number[] = [];
  const R = 3.5 * sim.geo.navStep;
  for (const a of Object.values(sim.s.armies)) {
    if (exclude.includes(a.id) || a.embarked !== undefined) continue;
    if (!(a.faction === faction || (isAllied(sim, a.faction, faction) && atWar(sim, a.faction, enemy)))) continue;
    if ((a.x - x) ** 2 + (a.z - z) ** 2 <= R * R) out.push(a.id);
  }
  return out.slice(0, 2);
}

export function makeFieldBattle(sim: Sim, attacker: ArmyState, defender: ArmyState): BattleSetup {
  const x = (attacker.x + defender.x) / 2;
  const z = (attacker.z + defender.z) / 2;
  const pid = sim.geo.province[defender.cell];
  const aArmies = [attacker.id, ...gatherReinforcements(sim, attacker.faction, x, z, [attacker.id, defender.id], defender.faction)];
  const dArmies = [defender.id, ...gatherReinforcements(sim, defender.faction, x, z, [attacker.id, defender.id, ...aArmies], attacker.faction)];
  // a defending army standing in its settlement fights a siege-like battle with the garrison
  let garrisonOf: number | undefined;
  let settlement = false;
  if (pid >= 0) {
    const pg = sim.geo.provinces[pid];
    if (sim.s.provinces[pid].owner === defender.faction && Math.hypot(defender.x - pg.x, defender.z - pg.z) < pg.radius + 12) {
      garrisonOf = pid;
      settlement = true;
    }
  }
  return baseSetup(sim, settlement && sim.s.provinces[garrisonOf!].settlement.walls > 0 ? 'siege' : 'field', { faction: attacker.faction, armies: aArmies, fleets: [] }, { faction: defender.faction, armies: dArmies, fleets: [], garrisonOf }, pid, settlement ? sim.geo.provinces[pid].x : x, settlement ? sim.geo.provinces[pid].z : z, settlement);
}

export function makeSettlementBattle(sim: Sim, attacker: ArmyState, pid: number): BattleSetup {
  const pg = sim.geo.provinces[pid];
  const p = sim.s.provinces[pid];
  const def = armyInSettlement(sim, pid);
  const aArmies = [attacker.id, ...gatherReinforcements(sim, attacker.faction, pg.x, pg.z, [attacker.id, ...(def ? [def.id] : [])], p.owner)];
  const dArmies = def ? [def.id] : [];
  return baseSetup(sim, p.settlement.walls > 0 ? 'siege' : 'field', { faction: attacker.faction, armies: aArmies, fleets: [] }, { faction: p.owner, armies: dArmies, fleets: [], garrisonOf: pid }, pid, pg.x, pg.z, true);
}

export function makeNavalBattle(sim: Sim, attacker: FleetState, defender: FleetState): BattleSetup {
  const x = (attacker.x + defender.x) / 2;
  const z = (attacker.z + defender.z) / 2;
  return baseSetup(sim, 'naval', { faction: attacker.faction, armies: [], fleets: [attacker.id] }, { faction: defender.faction, armies: [], fleets: [defender.id] }, -1, x, z, false);
}

function baseSetup(sim: Sim, kind: BattleKind, att: BattleSide, def: BattleSide, pid: number, x: number, z: number, settlement: boolean): BattleSetup {
  const p = pid >= 0 ? sim.s.provinces[pid] : undefined;
  const region = pid >= 0 ? sim.geo.provinces[pid].region : 'sea';
  const w = kind === 'naval' ? sim.s.weather.regions['sea'] ?? 'clear' : sim.s.weather.regions[region] ?? 'clear';
  const g = sim.geo;
  const c = Math.floor(z / g.navStep) * g.navW + Math.floor(x / g.navStep);
  let river = false;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (g.river[c + dz * g.navW + dx]) river = true;
  return {
    kind,
    attacker: att,
    defender: def,
    province: pid,
    x,
    z,
    terrain: kind === 'naval' ? 'coast' : settlement && p ? sim.geo.provinces[pid].terrain : battleTerrainAt(sim, x, z, pid),
    weather: w,
    season: seasonOf(sim.s.turn),
    walls: settlement && p ? p.settlement.walls : 0,
    towers: settlement && p ? p.settlement.buildings.find((b) => b.id === 'towers')?.level ?? 0 : 0,
    gateHp: settlement && p ? p.settlement.gateHp : 0,
    coastal: kind === 'naval' || (g.coastDist[c] >= 0 && g.coastDist[c] <= 6),
    river: !settlement && river,
    settlement,
    seed: sim.rng.int(1, 1e9),
  };
}

export function sideUnits(sim: Sim, side: BattleSide): { unit: UnitState; army?: ArmyState; faction: FactionId }[] {
  const out: { unit: UnitState; army?: ArmyState; faction: FactionId }[] = [];
  for (const id of side.armies) {
    const a = sim.s.armies[id];
    if (!a) continue;
    for (const u of a.units) out.push({ unit: u, army: a, faction: a.faction });
  }
  if (side.garrisonOf !== undefined) for (const u of sim.s.provinces[side.garrisonOf].settlement.garrison) out.push({ unit: u, faction: side.faction });
  return out;
}

export function sideGeneral(sim: Sim, side: BattleSide) {
  let best: ReturnType<Sim['char']>;
  for (const id of side.armies) {
    const g = sim.char(sim.s.armies[id]?.general);
    if (g && (!best || skillOf(g, 'command') > skillOf(best, 'command'))) best = g;
  }
  if (!best && side.garrisonOf !== undefined) best = sim.char(sim.s.provinces[side.garrisonOf].governor);
  return best;
}

export function sidePower(sim: Sim, setup: BattleSetup, side: 'attacker' | 'defender'): number {
  const s = setup[side];
  const other = setup[side === 'attacker' ? 'defender' : 'attacker'];
  if (setup.kind === 'naval') {
    let p = 0;
    for (const fid of s.fleets) {
      const f = sim.s.fleets[fid];
      if (!f) continue;
      for (const sh of f.ships) p += shipPower(sh);
      p *= 1 + skillOf(sim.char(f.admiral), 'command') * 0.025;
      p *= factionDef(f.faction).military.navalMul ?? 1;
    }
    return p;
  }
  const units = sideUnits(sim, s);
  const enemyUnits = sideUnits(sim, other);
  const enemyCav = enemyUnits.filter((u) => unitDef(u.unit.type).visual.mounted).reduce((a, u) => a + u.unit.troops, 0);
  const enemyTotal = Math.max(1, enemyUnits.reduce((a, u) => a + u.unit.troops, 0));
  const enemySpear = enemyUnits.filter((u) => unitDef(u.unit.type).category === 'spear').reduce((a, u) => a + u.unit.troops, 0) / enemyTotal;
  const enemyArmor = enemyUnits.reduce((a, u) => a + unitDef(u.unit.type).armor * u.unit.troops, 0) / enemyTotal;
  let p = 0;
  for (const { unit, faction } of units) {
    const d = unitDef(unit.type);
    let v = unitPower(unit, d, factionUnitMods(faction));
    if (d.visual.mounted) {
      v *= 1 - enemySpear * 0.45;
      if (setup.terrain === 'forest' || setup.terrain === 'mountain') v *= 0.75;
      if (setup.kind === 'siege') v *= 0.6;
    }
    if (d.category === 'spear') v *= 1 + (enemyCav / enemyTotal) * 0.5;
    if (d.range) {
      if (setup.weather === 'rain' || setup.weather === 'storm') v *= 0.75;
      if (setup.weather === 'fog') v *= 0.8;
      if (d.category === 'crossbow' || d.ap > 0.3) v *= 1 + enemyArmor / 200;
    }
    if (d.category === 'siege' && setup.kind !== 'siege') v *= 0.4;
    if (unit.troops > 0) p += v;
  }
  const gen = sideGeneral(sim, s);
  p *= 1 + skillOf(gen, 'command') * 0.03;
  if (gen?.traits.includes('brave')) p *= 1.04;
  // morale of armies
  const armies = s.armies.map((id) => sim.s.armies[id]).filter(Boolean);
  if (armies.length) p *= 0.75 + (armies.reduce((a, x) => a + x.morale, 0) / armies.length / 100) * 0.35;
  if (side === 'defender') {
    if (setup.terrain === 'hills' || setup.terrain === 'mountain') p *= 1.15;
    if (setup.terrain === 'forest') p *= 1.08;
    if (setup.river) p *= 1.12;
    if (setup.kind === 'siege') {
      p *= 1 + setup.walls * 0.35 + setup.towers * 0.08;
    }
  } else if (setup.kind === 'siege') {
    const hasEngines = units.some((u) => ['ram', 'catapult', 'trebuchet'].includes(u.unit.type));
    const siege = setup.province >= 0 ? sim.s.provinces[setup.province].siege : undefined;
    if (!hasEngines && !(siege && siege.equipment > 0)) p *= 0.35;
    else p *= 1 + Math.min(0.3, (siege?.equipment ?? 0) * 0.08) + (hasEngines ? 0.1 : 0);
  }
  return p;
}

/** Deterministic-seeded auto-resolve using composition, commanders, terrain and walls. */
export function autoResolve(sim: Sim, setup: BattleSetup): BattleOutcome {
  const pa = sidePower(sim, setup, 'attacker');
  const pd = sidePower(sim, setup, 'defender');
  const ratio = pa / Math.max(1, pa + pd);
  const r = sim.rng;
  const pWin = 1 / (1 + Math.exp(-(ratio - 0.5) * 11));
  const attackerWins = r.next() < pWin;
  const winner = attackerWins ? 'attacker' : 'defender';
  const dominance = attackerWins ? ratio : 1 - ratio; // 0.5..1 for winner
  const out: BattleOutcome = { winner, losses: [], shipDamage: [], shipsSunk: [], shipsCaptured: [], generalsKilled: [], generalsWounded: [], settlementTaken: false, killsA: 0, killsD: 0 };
  if (setup.kind === 'naval') {
    for (const side of ['attacker', 'defender'] as const) {
      const won = side === winner;
      const frac = won ? r.range(0.08, 0.3) * (1.4 - dominance) : r.range(0.35, 0.75) * (0.6 + dominance * 0.6);
      for (const fid of setup[side].fleets) {
        const f = sim.s.fleets[fid];
        if (!f) continue;
        for (const sh of f.ships) {
          const dmg = sh.maxHull * frac * r.range(0.5, 1.5);
          const crew = Math.round(sh.crew * frac * r.range(0.4, 1.2));
          if (sh.hull - dmg <= 0 || (!won && r.chance(frac * 0.4))) {
            if (!won && r.chance(0.3)) out.shipsCaptured.push(sh.uid);
            else out.shipsSunk.push(sh.uid);
          } else out.shipDamage.push({ uid: sh.uid, hull: dmg, crew });
          if (side === 'attacker') out.killsD += crew;
          else out.killsA += crew;
        }
      }
    }
    return out;
  }
  for (const side of ['attacker', 'defender'] as const) {
    const won = side === winner;
    const base = won ? r.range(0.1, 0.28) * (1.5 - dominance) : r.range(0.4, 0.7) * (0.55 + dominance * 0.6);
    const units = sideUnits(sim, setup[side]);
    let lostTotal = 0;
    for (const { unit } of units) {
      const d = unitDef(unit.type);
      let f = base * r.range(0.7, 1.3);
      if (d.range) f *= 0.7;
      if (d.visual.mounted && !won) f *= 0.8; // cavalry escapes
      if (d.category === 'general') f *= 0.6;
      const lost = Math.min(unit.troops, Math.round(unit.troops * f));
      lostTotal += lost;
      out.losses.push({ uid: unit.uid, lost });
    }
    if (side === 'attacker') out.killsD = lostTotal;
    else out.killsA = lostTotal;
    // generals
    for (const id of setup[side].armies) {
      const g = sim.char(sim.s.armies[id]?.general);
      if (!g) continue;
      let pk = won ? 0.02 : 0.08;
      if (g.traits.includes('brave')) pk *= 1.6;
      if (r.chance(pk)) out.generalsKilled.push(g.id);
      else if (r.chance(won ? 0.04 : 0.12)) out.generalsWounded.push(g.id);
    }
  }
  if (setup.defender.garrisonOf !== undefined && winner === 'attacker') out.settlementTaken = true;
  return out;
}

function findUnit(sim: Sim, setup: BattleSetup, uid: number): { unit: UnitState; list: UnitState[] } | undefined {
  for (const side of [setup.attacker, setup.defender]) {
    for (const id of side.armies) {
      const a = sim.s.armies[id];
      if (!a) continue;
      const u = a.units.find((x) => x.uid === uid);
      if (u) return { unit: u, list: a.units };
    }
    if (side.garrisonOf !== undefined) {
      const g = sim.s.provinces[side.garrisonOf].settlement.garrison;
      const u = g.find((x) => x.uid === uid);
      if (u) return { unit: u, list: g };
    }
  }
  return undefined;
}

export interface AppliedResult {
  text: string;
  captureDecision?: { province: number; army: number };
}

/** Apply a battle outcome to the persistent campaign state. */
export function applyBattleOutcome(sim: Sim, setup: BattleSetup, o: BattleOutcome): AppliedResult {
  const winSide = o.winner === 'attacker' ? setup.attacker : setup.defender;
  const loseSide = o.winner === 'attacker' ? setup.defender : setup.attacker;
  sim.s.stats.battles++;
  // --- naval
  if (setup.kind === 'naval') {
    const allFleets = [...setup.attacker.fleets, ...setup.defender.fleets].map((id) => sim.s.fleets[id]).filter(Boolean);
    const captured: { ship: (typeof allFleets)[0]['ships'][0]; to: FactionId }[] = [];
    for (const f of allFleets) {
      for (const d of o.shipDamage) {
        const sh = f.ships.find((s) => s.uid === d.uid);
        if (sh) {
          sh.hull = Math.max(1, sh.hull - d.hull);
          sh.crew = Math.max(1, sh.crew - d.crew);
        }
      }
      const before = f.ships.length;
      for (const uid of [...o.shipsSunk, ...o.shipsCaptured]) {
        const idx = f.ships.findIndex((s) => s.uid === uid);
        if (idx >= 0) {
          const [sh] = f.ships.splice(idx, 1);
          if (o.shipsCaptured.includes(uid)) captured.push({ ship: sh, to: winSide.faction });
          sim.emit({ type: 'SHIP_SUNK', fleet: f.id, ship: uid, faction: f.faction });
        }
      }
      // carried armies lose troops proportional to lost capacity
      if (f.ships.length < before && f.carrying.length) {
        const frac = f.ships.length / before;
        for (const aid of f.carrying) {
          const a = sim.s.armies[aid];
          if (!a) continue;
          for (const u of a.units) u.troops = Math.floor(u.troops * (0.3 + 0.7 * frac));
          a.units = a.units.filter((u) => u.troops > 2);
          if (!a.units.length) destroyArmy(sim, a, 'drowned');
        }
      }
      for (const s of f.ships) s.xp = Math.min(9, s.xp + (f.faction === winSide.faction ? 1 : 0.5));
      if (!f.ships.length) destroyFleet(sim, f, 'sunk');
    }
    const wf = winSide.fleets.map((id) => sim.s.fleets[id]).find(Boolean);
    if (wf) for (const c of captured) if (wf.ships.length < 12) wf.ships.push({ ...c.ship, hull: c.ship.maxHull * 0.3, crew: Math.round(c.ship.maxCrew * 0.3) });
    // loser retreats
    for (const id of loseSide.fleets) {
      const f = sim.s.fleets[id];
      if (f) retreatFleet(sim, f, setup.x, setup.z);
    }
    const adm = sim.char(sim.s.fleets[winSide.fleets[0]]?.admiral);
    if (adm) {
      adm.xp += 40;
      adm.prestige += 8;
      adm.battlesWon++;
    }
    warScore(sim, setup, o, 8);
    sim.fac(winSide.faction).prestige += 12;
    const text = `${o.winner === 'attacker' ? 'Attack' : 'Defence'} victorious at sea: ${o.shipsSunk.length} ships sunk, ${o.shipsCaptured.length} captured.`;
    report(sim, setup, o, text);
    return { text };
  }
  // --- land
  for (const l of o.losses) {
    const f = findUnit(sim, setup, l.uid);
    if (f) f.unit.troops = Math.max(0, f.unit.troops - l.lost);
  }
  // kill generals
  for (const gid of o.generalsKilled) {
    const g = sim.char(gid);
    if (g && g.alive) {
      const army = g.armyId !== undefined ? sim.s.armies[g.armyId] : undefined;
      killCharacter(sim, g, 'slain in battle');
      if (army) for (const a of [army]) a.morale = Math.max(5, a.morale - 25);
    }
  }
  for (const gid of o.generalsWounded) {
    const g = sim.char(gid);
    if (g && g.alive) {
      g.wounded = 4;
      g.health = Math.max(10, g.health - 25);
      if (!g.traits.includes('wounded') && sim.rng.chance(0.3)) g.traits.push('wounded');
    }
  }
  // cleanup units, xp, morale
  const winTroopsLost = o.winner === 'attacker' ? o.killsD : o.killsA;
  const loseTroopsLost = o.winner === 'attacker' ? o.killsA : o.killsD;
  for (const [side, won] of [
    [setup.attacker, o.winner === 'attacker'],
    [setup.defender, o.winner === 'defender'],
  ] as const) {
    for (const id of side.armies) {
      const a = sim.s.armies[id];
      if (!a) continue;
      a.units = a.units.filter((u) => u.troops >= Math.max(3, u.maxTroops * 0.06));
      for (const u of a.units) u.xp = Math.min(9, u.xp + (won ? 0.8 : 0.35));
      a.morale = Math.max(5, Math.min(100, a.morale + (won ? 12 : -30)));
      const g = sim.char(a.general);
      if (g && g.alive) {
        g.xp += won ? 60 : 25;
        if (won) {
          g.battlesWon++;
          g.prestige += 10;
          if (g.battlesWon >= 3 && !g.traits.includes('veteran')) g.traits.push('veteran');
          if (g.battlesWon >= 6 && !g.traits.includes('strategist') && sim.rng.chance(0.4)) g.traits.push('strategist');
        } else g.battlesLost++;
      }
      if (!a.units.length || troopCount(a.units) < 20) destroyArmy(sim, a, 'destroyed in battle');
    }
    if (side.garrisonOf !== undefined) {
      const st = sim.s.provinces[side.garrisonOf].settlement;
      st.garrison = st.garrison.filter((u) => u.troops >= 3);
    }
  }
  sim.fac(winSide.faction).prestige += Math.round(8 + loseTroopsLost / 60);
  sim.fac(loseSide.faction).prestige = Math.max(0, sim.fac(loseSide.faction).prestige - 5);
  // war weariness
  sim.fac(winSide.faction).warWeariness += winTroopsLost / 200;
  sim.fac(loseSide.faction).warWeariness += loseTroopsLost / 120;
  warScore(sim, setup, o, 6 + Math.min(14, loseTroopsLost / 80));
  // retreat of losers
  for (const id of loseSide.armies) {
    const a = sim.s.armies[id];
    if (!a) continue;
    if (a.siegeOf !== undefined) {
      const p = sim.s.provinces[a.siegeOf];
      if (p.siege?.armyId === a.id) p.siege = undefined;
      a.siegeOf = undefined;
      a.stance = 'normal';
    }
    retreatArmy(sim, a, setup.x, setup.z);
  }
  let result: AppliedResult = { text: '' };
  // settlement capture
  if (setup.defender.garrisonOf !== undefined && o.winner === 'attacker') {
    const pid = setup.defender.garrisonOf;
    const p = sim.s.provinces[pid];
    const inside = armyInSettlement(sim, pid);
    if (inside && inside.faction === p.owner) retreatArmy(sim, inside, setup.x, setup.z);
    const leadArmy = sim.s.armies[setup.attacker.armies[0]];
    if (leadArmy) {
      if (leadArmy.faction === sim.s.player) result.captureDecision = { province: pid, army: leadArmy.id };
      else {
        transferProvince(sim, pid, leadArmy.faction, 'conquest');
        if (factionDef(leadArmy.faction).ai.honor < 0.5 && sim.rng.chance(0.5)) sackSettlement(sim, pid, leadArmy.faction);
      }
      const pg = sim.geo.provinces[pid];
      leadArmy.x = pg.x;
      leadArmy.z = pg.z;
      leadArmy.cell = Math.floor(pg.z / sim.geo.navStep) * sim.geo.navW + Math.floor(pg.x / sim.geo.navStep);
      leadArmy.siegeOf = undefined;
      leadArmy.stance = 'normal';
      p.siege = undefined;
    }
  }
  const text = `${sim.houseName(winSide.faction)} won the battle. Losses: ${o.killsD.toLocaleString()} attackers and ${o.killsA.toLocaleString()} defenders fell.${o.generalsKilled.length ? ' ' + o.generalsKilled.map((g) => fullName(sim.char(g)!)).join(', ') + ' fell in battle.' : ''}`;
  report(sim, setup, o, text);
  result.text = text;
  return result;
}

function warScore(sim: Sim, setup: BattleSetup, o: BattleOutcome, amount: number) {
  const war = warBetween(sim, setup.attacker.faction, setup.defender.faction);
  if (!war) return;
  war.battles++;
  const attackerIsWarAttacker = war.attackers.includes(setup.attacker.faction);
  const attackerWon = o.winner === 'attacker';
  const delta = amount * (attackerIsWarAttacker === attackerWon ? 1 : -1);
  war.score = Math.max(-100, Math.min(100, war.score + delta));
  if (attackerIsWarAttacker) {
    war.casualtiesA += o.killsD;
    war.casualtiesD += o.killsA;
  } else {
    war.casualtiesA += o.killsA;
    war.casualtiesD += o.killsD;
  }
}

function report(sim: Sim, setup: BattleSetup, o: BattleOutcome, text: string) {
  sim.emit({ type: 'BATTLE_RESOLVED', setup, outcome: o, text });
  const where = setup.province >= 0 ? sim.provName(setup.province) : 'at sea';
  sim.chronicle(`Battle ${setup.province >= 0 ? 'near ' + where : where}: ${sim.houseName(o.winner === 'attacker' ? setup.attacker.faction : setup.defender.faction)} prevailed over ${sim.houseName(o.winner === 'attacker' ? setup.defender.faction : setup.attacker.faction)}.`, [setup.attacker.faction, setup.defender.faction], 'battle');
  const p = sim.s.player;
  if (setup.attacker.faction !== p && setup.defender.faction !== p) {
    if (sim.rng.chance(0.35)) sim.notify({ kind: 'war', title: `Battle ${setup.province >= 0 ? 'near ' + where : 'at Sea'}`, text: `${sim.houseName(o.winner === 'attacker' ? setup.attacker.faction : setup.defender.faction)} defeated ${sim.houseName(o.winner === 'attacker' ? setup.defender.faction : setup.attacker.faction)}.`, focus: { x: setup.x, z: setup.z } });
  }
}

export function retreatArmy(sim: Sim, a: ArmyState, fromX: number, fromZ: number) {
  const g = sim.geo;
  // move up to 6 cells away from the battle toward friendly territory
  let best = a.cell;
  let bestScore = -1e9;
  const x0 = a.cell % g.navW;
  const z0 = Math.floor(a.cell / g.navW);
  for (let dz = -6; dz <= 6; dz++)
    for (let dx = -6; dx <= 6; dx++) {
      const x = x0 + dx;
      const z = z0 + dz;
      if (x < 0 || z < 0 || x >= g.navW || z >= g.navH) continue;
      const c = z * g.navW + x;
      if (g.nav[c] < NavT.Plains || g.nav[c] === NavT.Impassable || g.landmass[c] !== g.landmass[a.cell]) continue;
      if (Object.values(sim.s.armies).some((o) => o.id !== a.id && o.cell === c)) continue;
      const cx = cellX(g, c);
      const cz = cellZ(g, c);
      const pid = g.province[c];
      const own = pid >= 0 && sim.s.provinces[pid].owner === a.faction ? 40 : 0;
      const score = Math.hypot(cx - fromX, cz - fromZ) * 0.5 + own - Math.hypot(dx, dz) * 2;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  const cells = [a.cell, best];
  a.cell = best;
  a.x = cellX(g, best);
  a.z = cellZ(g, best);
  a.path = [];
  a.movePoints = 0;
  a.retreated = true;
  sim.emit({ type: 'ARMY_MOVED', army: a.id, cells });
}

export function retreatFleet(sim: Sim, f: FleetState, fromX: number, fromZ: number) {
  const g = sim.geo;
  let best = f.cell;
  let bestScore = -1e9;
  const x0 = f.cell % g.navW;
  const z0 = Math.floor(f.cell / g.navW);
  for (let dz = -7; dz <= 7; dz++)
    for (let dx = -7; dx <= 7; dx++) {
      const x = x0 + dx;
      const z = z0 + dz;
      if (x < 0 || z < 0 || x >= g.navW || z >= g.navH) continue;
      const c = z * g.navW + x;
      if (g.nav[c] > NavT.Shallow) continue;
      const score = Math.hypot(cellX(g, c) - fromX, cellZ(g, c) - fromZ) - Math.hypot(dx, dz) * 3;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  f.cell = best;
  f.x = cellX(g, best);
  f.z = cellZ(g, best);
  f.path = [];
  f.movePoints = 0;
  for (const aid of f.carrying) {
    const a = sim.s.armies[aid];
    if (a) {
      a.cell = best;
      a.x = f.x;
      a.z = f.z;
    }
  }
  sim.emit({ type: 'FLEET_MOVED', fleet: f.id, cells: [best] });
}

/** Strength estimate shown before battle */
export function battleOdds(sim: Sim, setup: BattleSetup): { attacker: number; defender: number; chance: number } {
  const a = sidePower(sim, setup, 'attacker');
  const d = sidePower(sim, setup, 'defender');
  const ratio = a / Math.max(1, a + d);
  return { attacker: a, defender: d, chance: 1 / (1 + Math.exp(-(ratio - 0.5) * 11)) };
}

export function shipTypeName(type: string) {
  return shipDef(type).name;
}
