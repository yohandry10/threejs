import { factionDef, FACTIONS, isMajor } from '../data/factions';
import { unitDef, shipDef } from '../data/units';
import { age, ADULT_AGE, canMarry, skillOf, marry } from './characters';
import type { Sim } from './context';
import {
  alliesOf,
  areNeighbours,
  atWar,
  canDeclareWar,
  claimsOn,
  declareWar,
  enemiesOf,
  evaluateProposal,
  executeProposal,
  hasTreaty,
  isAllied,
  militaryStrength,
  opinion,
  overlordOf,
  provinceClaims,
  warBetween,
  type Proposal,
} from './diplomacy';
import { buildOptions, factionEconomy, recruitOptions, recruit, startConstruction } from './economy';
import { aiFillCouncil, startIntrigue, INTRIGUE_KINDS } from './intrigue';
import { armyPower, availableCommanders, assignGeneral, fleetCapacity, fleetPower, troopCount, armyInSettlement } from './military';
import { issueArmyOrder, issueFleetOrder, captureWith, assaultSettlement, type OrderResult } from './commands';
import { cellDist, findArmyPath, waterCellsNear, embark, disembark, landCellsNear } from './movement';
import { autoResolve, applyBattleOutcome, type BattleSetup } from './battles';
import { canAssault } from './conquest';
import type { ArmyState, FactionId, FleetState, ProvinceState } from './types';
import { isWaterCell } from './world/geo';

export interface TurnHooks {
  yieldFrame: () => Promise<void>;
  /** A battle involving the player. Must resolve and apply the outcome. */
  playerBattle: (setup: BattleSetup) => Promise<void>;
  progress?: (label: string, frac: number) => void;
}

const reserveFor = (sim: Sim, fid: FactionId) => 300 + sim.provincesOf(fid).length * 90;

export async function runBattle(sim: Sim, setup: BattleSetup, hooks: TurnHooks) {
  const p = sim.s.player;
  const involvesPlayer = setup.attacker.faction === p || setup.defender.faction === p || isAllied(sim, setup.defender.faction, p) && setup.defender.armies.some((id) => sim.s.armies[id]?.faction === p);
  if (involvesPlayer) {
    await hooks.playerBattle(setup);
  } else {
    const o = autoResolve(sim, setup);
    applyBattleOutcome(sim, setup, o);
  }
}

async function handleOrderResult(sim: Sim, fid: FactionId, army: ArmyState | undefined, r: OrderResult, hooks: TurnHooks) {
  if (r.battle) await runBattle(sim, r.battle, hooks);
  if (r.capture && army && sim.s.armies[army.id]) captureWith(sim, sim.s.armies[army.id], r.capture.province, factionDef(fid).ai.honor < 0.45 && sim.rng.chance(0.5) ? 'sack' : 'occupy');
}

// --------------------------------------------------------------------------- economy

function aiEconomy(sim: Sim, fid: FactionId) {
  const f = sim.fac(fid);
  const provs = sim.provincesOf(fid);
  if (!provs.length) return;
  const avgOrder = provs.reduce((s, p) => s + p.publicOrder, 0) / provs.length;
  const eco = factionEconomy(sim, fid);
  if (avgOrder < -8) f.taxLevel = 0;
  else if ((f.treasury < 300 || eco.net < 0) && avgOrder > 15) f.taxLevel = 2;
  else if (avgOrder > 35 && f.treasury < 1500) f.taxLevel = 2;
  else f.taxLevel = 1;
  const reserve = reserveFor(sim, fid);
  const def = factionDef(fid);
  let builds = 0;
  const maxBuilds = f.treasury > 6000 ? 5 : f.treasury > reserve * 4 ? 3 : 2;
  const atWarNow = enemiesOf(sim, fid).length > 0;
  while (builds < maxBuilds && f.treasury > reserve) {
    let best: { pid: number; id: string; score: number; cost: number } | undefined;
    for (const p of provs) {
      if (p.settlement.construction.length >= 2) continue;
      for (const o of buildOptions(sim, p.id)) {
        if (o.blocked) continue;
        if (f.treasury - o.cost < reserve * 0.6) continue;
        let score = 10;
        switch (o.id) {
          case '__tier':
            score = 40;
            break;
          case 'farm':
            score = 18 + (f.food < 300 || eco.food < 0 ? 30 : 0);
            break;
          case 'fishery':
            score = 14 + (eco.food < 0 ? 20 : 0);
            break;
          case 'market':
          case 'trade_docks':
          case 'treasury':
            score = 20 + def.ai.trade * 22;
            break;
          case 'mine':
          case 'lumber':
            score = 16;
            break;
          case 'workshop':
            score = 17;
            break;
          case 'harbor':
            score = 14 + def.ai.naval * 15 + def.ai.trade * 8;
            break;
          case 'shipyard':
            score = 6 + def.ai.naval * 25;
            break;
          case 'barracks':
          case 'archery_range':
            score = 12 + def.ai.aggression * 12;
            break;
          case 'stables':
          case 'armory':
            score = 9 + def.ai.aggression * 14;
            break;
          case 'siege_workshop':
            score = def.ai.expansion * 16;
            break;
          case 'walls':
          case 'towers':
          case 'gatehouse':
            score = 8 + def.ai.caution * 18 + (atWarNow ? 12 : 0) + (p.id === f.capital ? 10 : 0);
            break;
          case 'manor':
            score = 10 + (p.publicOrder < 10 ? 25 : 0);
            break;
          case 'council_hall':
            score = 16;
            break;
        }
        score -= o.cost / 120;
        score += sim.rng.range(0, 6);
        if (!best || score > best.score) best = { pid: p.id, id: o.id, score, cost: o.cost };
      }
    }
    if (!best) break;
    if (startConstruction(sim, best.pid, best.id)) break;
    builds++;
  }
}

// --------------------------------------------------------------------------- recruitment

function desiredArmyPower(sim: Sim, fid: FactionId): number {
  const f = sim.fac(fid);
  const def = factionDef(fid);
  const provs = sim.provincesOf(fid).length;
  let base = 260 + provs * 115 + Math.max(0, f.treasury - 1500) / 12;
  base *= 0.7 + def.ai.aggression * 0.6;
  const enemies = enemiesOf(sim, fid).filter((e) => e !== 'pirates');
  if (enemies.length) {
    const threat = enemies.reduce((s, e) => s + militaryStrength(sim, e), 0);
    base = Math.max(base * 1.4, threat * 0.9);
  }
  // budget: upkeep should not eat the treasury
  const eco = f.lastIncome;
  if (eco && eco.net < 0 && f.treasury < 600) base *= 0.6;
  return base;
}

function chooseUnit(sim: Sim, fid: FactionId, pid: number, army: ArmyState | undefined): string | undefined {
  const opts = recruitOptions(sim, pid).filter((o) => !o.blocked && !o.ship);
  if (!opts.length) return undefined;
  const def = factionDef(fid);
  const comp: Record<string, number> = { melee: 0, spear: 0, ranged: 0, cav: 0, siege: 0 };
  for (const u of army?.units ?? []) {
    const d = unitDef(u.type);
    const k = d.visual.mounted ? 'cav' : d.range && d.category !== 'siege' ? 'ranged' : d.category === 'spear' ? 'spear' : d.category === 'siege' ? 'siege' : 'melee';
    comp[k]++;
  }
  const n = Math.max(1, army?.units.length ?? 1);
  const want: Record<string, number> = { melee: 0.35, spear: 0.22, ranged: 0.25, cav: 0.15 + (def.military.cavMul ?? 1) - 1, siege: def.ai.expansion > 0.6 ? 0.07 : 0.03 };
  let best: string | undefined;
  let bestScore = -1e9;
  for (const o of opts) {
    const d = unitDef(o.type);
    const k = d.visual.mounted ? 'cav' : d.range && d.category !== 'siege' ? 'ranged' : d.category === 'spear' ? 'spear' : d.category === 'siege' ? 'siege' : 'melee';
    let s = (want[k] - comp[k] / n) * 100;
    if (def.military.favoured.includes(o.type)) s += 18;
    if (def.military.unique === o.type) s += 10;
    if (o.type === 'militia') s -= 25;
    s += (d.attack + d.defense + d.armor * 0.5) / 6;
    s -= o.cost / 40;
    if (k === 'siege' && comp.siege >= 1) s -= 60;
    s += sim.rng.range(0, 8);
    if (s > bestScore) {
      bestScore = s;
      best = o.type;
    }
  }
  return best;
}

function aiRecruit(sim: Sim, fid: FactionId) {
  const f = sim.fac(fid);
  const armies = sim.armiesOf(fid).filter((a) => a.embarked === undefined);
  let power = armies.reduce((s, a) => s + armyPower(sim, a), 0);
  const want = desiredArmyPower(sim, fid);
  const reserve = reserveFor(sim, fid);
  const eco = f.lastIncome;
  const upkeepRatio = eco ? (eco.armyUpkeep + eco.fleetUpkeep) / Math.max(1, eco.tax + eco.trade + eco.buildings) : 0;
  let guard = 0;
  while (power < want && f.treasury > reserve && upkeepRatio < 0.75 && guard++ < 6) {
    // prefer settlement with an army present or the capital
    const provs = sim.provincesOf(fid).filter((p) => !p.siege && p.settlement.recruitment.length < 2 + p.settlement.tier);
    if (!provs.length) break;
    provs.sort((a, b) => {
      const sa = (armyInSettlement(sim, a.id) ? 50 : 0) + a.settlement.tier * 10 + (a.id === f.capital ? 20 : 0) + a.settlement.buildings.length;
      const sb = (armyInSettlement(sim, b.id) ? 50 : 0) + b.settlement.tier * 10 + (b.id === f.capital ? 20 : 0) + b.settlement.buildings.length;
      return sb - sa;
    });
    const p = provs[0];
    const type = chooseUnit(sim, fid, p.id, armyInSettlement(sim, p.id));
    if (!type) break;
    if (recruit(sim, p.id, type)) break;
    power += 25;
  }
  // appoint generals
  for (const a of sim.armiesOf(fid)) {
    if (a.general !== undefined || a.isRebel) continue;
    if (troopCount(a.units) < 250) continue;
    const cands = availableCommanders(sim, fid).filter((c) => c.role !== 'ruler' || sim.armiesOf(fid).filter((x) => x.general === c.id).length === 0);
    cands.sort((x, y) => skillOf(y, 'command') - skillOf(x, 'command'));
    const c = cands.find((x) => x.role !== 'heir' || age(sim, x) > 18);
    if (c) assignGeneral(sim, a, c.id);
  }
  // navy
  const def = factionDef(fid);
  if (def.maritime || def.ai.naval > 0.5) {
    const fleets = sim.fleetsOf(fid);
    const fp = fleets.reduce((s, x) => s + fleetPower(sim, x), 0);
    const wantF = 60 + def.ai.naval * 160 + (enemiesOf(sim, fid).some((e) => factionDef(e).maritime) ? 120 : 0);
    const cap = fleets.reduce((s, x) => s + fleetCapacity(x), 0);
    const needTransport = f.aiMemory['wantInvasion'] === 1 && cap < 900;
    if ((fp < wantF || needTransport) && f.treasury > reserve + 300) {
      const ports = sim.provincesOf(fid).filter((p) => p.settlement.isPort && !p.blockaded && !p.siege);
      for (const p of ports) {
        const opts = recruitOptions(sim, p.id).filter((o) => o.ship && !o.blocked);
        if (!opts.length) continue;
        const pickType = needTransport ? 'cog' : fp < wantF ? (opts.some((o) => o.type === 'carrack') && f.treasury > 1500 ? 'carrack' : 'galley') : 'cog';
        const o = opts.find((x) => x.type === pickType) ?? opts[0];
        if (!recruit(sim, p.id, o.type)) break;
      }
    }
  }
  // disband when broke
  if (f.treasury < -200) {
    const worst = sim.armiesOf(fid).sort((a, b) => armyPower(sim, a) - armyPower(sim, b))[0];
    if (worst) {
      const u = worst.units.find((x) => x.type === 'militia') ?? worst.units[worst.units.length - 1];
      if (u && u.type !== 'bodyguard') worst.units = worst.units.filter((x) => x !== u);
    }
  }
}

// --------------------------------------------------------------------------- diplomacy

function proposeTo(sim: Sim, p: Proposal): boolean {
  if (p.to === sim.s.player) {
    // only one open proposal per sender
    if (sim.s.decisions.some((d) => d.kind === 'proposal' && (d.data?.proposal as Proposal)?.from === p.from)) return false;
    const ev = evaluateProposal(sim, { ...p, from: p.from, to: p.to });
    if (ev.impossible) return false;
    const texts: Record<string, string> = {
      alliance: `${sim.houseName(p.from)} proposes a formal alliance: to stand together in war and peace.`,
      defensive: `${sim.houseName(p.from)} proposes a defensive pact: each to defend the other if attacked.`,
      trade: `${sim.houseName(p.from)} proposes a trade agreement between your ports and markets.`,
      marriage: `${sim.houseName(p.from)} proposes a marriage: ${sim.char(p.charA)?.name} of their house to ${sim.char(p.charB)?.name} of yours.`,
      peace: `${sim.houseName(p.from)} sues for peace (${p.peaceTerms === 'tribute' ? 'they will pay tribute' : p.peaceTerms === 'receive' ? 'they demand tribute from you' : 'white peace'}).`,
      demand_tribute: `${sim.houseName(p.from)} demands tribute of ${p.amount} gold each season, or else.`,
      nonaggression: `${sim.houseName(p.from)} offers a pact of non-aggression.`,
      request_access: `${sim.houseName(p.from)} requests military access through your lands.`,
      demand_vassal: `${sim.houseName(p.from)} demands that you bend the knee as their vassal.`,
    };
    sim.s.decisions.push({
      id: sim.s.ids.decision++,
      kind: 'proposal',
      faction: sim.s.player,
      title: `Envoy from ${sim.houseName(p.from)}`,
      text: texts[p.kind] ?? `${sim.houseName(p.from)} makes a proposal.`,
      options: [
        { id: 'accept', label: 'Accept' },
        { id: 'decline', label: 'Decline' },
      ],
      data: { proposal: p },
      turn: sim.s.turn,
    });
    sim.notify({ kind: 'diplomacy', title: `Envoy from ${sim.houseName(p.from)}`, text: texts[p.kind] ?? 'A proposal awaits your answer.' });
    return true;
  }
  const ev = evaluateProposal(sim, p);
  if (ev.accept) {
    executeProposal(sim, p);
    if (p.kind === 'alliance' || p.kind === 'marriage') sim.notify({ kind: 'diplomacy', title: p.kind === 'alliance' ? 'New Alliance' : 'Royal Wedding', text: p.kind === 'alliance' ? `${sim.houseName(p.from)} and ${sim.houseName(p.to)} have formed an alliance.` : `${sim.char(p.charA)?.name} of ${sim.houseName(p.from)} has wed ${sim.char(p.charB)?.name} of ${sim.houseName(p.to)}.` });
    return true;
  }
  return false;
}

function aiDiplomacy(sim: Sim, fid: FactionId) {
  const f = sim.fac(fid);
  const def = factionDef(fid).ai;
  const r = sim.rng;
  const others = sim.majorFactions().filter((x) => x.id !== fid);
  const myStr = militaryStrength(sim, fid) + 1;
  // --- peace
  for (const w of [...sim.s.diplomacy.wars]) {
    if (!w.attackers.includes(fid) && !w.defenders.includes(fid)) continue;
    const leader = w.attackers.includes(fid) ? w.leaderA : w.leaderD;
    if (leader !== fid) continue;
    const enemy = w.attackers.includes(fid) ? w.leaderD : w.leaderA;
    const myScore = w.attackers.includes(fid) ? w.score : -w.score;
    const len = sim.s.turn - w.startTurn;
    const wantPeace = f.warWeariness > 45 || myScore < -35 || (len > 14 && Math.abs(myScore) < 15) || f.treasury < -300 || (enemy === 'free' && len > 20);
    if (!wantPeace || len < 3 || !r.chance(0.45)) continue;
    const terms: Proposal['peaceTerms'] = myScore > 30 ? 'receive' : myScore < -40 ? 'tribute' : 'white';
    proposeTo(sim, { kind: 'peace', from: fid, to: enemy, peaceTerms: terms });
  }
  // --- war
  const enemies = enemiesOf(sim, fid).filter((e) => e !== 'pirates' && e !== 'rebels');
  const lastWar = f.aiMemory['lastWar'] ?? -99;
  if (enemies.length === 0 && f.treasury > 500 && sim.s.turn - lastWar > 6 && sim.s.turn >= 2 && !overlordOf(sim, fid)) {
    let best: { id: FactionId; score: number } | undefined;
    const candidates = [...others.map((o) => o.id), 'free'].filter((x) => sim.fac(x)?.alive);
    for (const o of candidates) {
      const chk = canDeclareWar(sim, fid, o);
      if (!chk.ok || isAllied(sim, fid, o) || hasTreaty(sim, fid, o, 'nonaggression')) continue;
      const neighbour = areNeighbours(sim, fid, o);
      const naval = factionDef(fid).maritime && def.naval > 0.5 && sim.fleetsOf(fid).length > 0;
      if (!neighbour && !naval) continue;
      const theirStr = militaryStrength(sim, o) + alliesOf(sim, o).reduce((s, x) => s + militaryStrength(sim, x) * 0.6, 0) + 1;
      const ratio = myStr / theirStr;
      const op = opinion(sim, fid, o);
      let score = (ratio - 1) * 1.2 + def.aggression * 0.9 + def.expansion * 0.5 - op / 60 + claimsOn(sim, fid, o) * 0.25 - (neighbour ? 0 : 0.35);
      if (o === 'free') score += 0.3 + def.expansion * 0.4;
      if (sim.isPlayer(o)) score += 0.05;
      if (!chk.casusBelli) score -= def.honor * 0.8;
      if (ratio < 1.05) score -= 1;
      if (!best || score > best.score) best = { id: o, score };
    }
    if (best && best.score > 1.25 && r.chance(0.28 + def.aggression * 0.25)) {
      const claims = provinceClaims(sim, fid).filter((pid) => sim.s.provinces[pid].owner === best!.id);
      declareWar(sim, fid, best.id, claims.length ? { kind: 'claim', province: claims[0] } : { kind: 'conquest' });
    }
  }
  // --- alliances / pacts / trade
  if (r.chance(0.35)) {
    const o = r.pick(others);
    if (o && !atWar(sim, fid, o.id)) {
      const op = opinion(sim, fid, o.id);
      const common = enemiesOf(sim, fid).filter((e) => enemiesOf(sim, o.id).includes(e));
      if (!hasTreaty(sim, fid, o.id, 'alliance') && (op > 40 || (op > 15 && common.length)) && r.chance(def.diplomacy)) proposeTo(sim, { kind: 'alliance', from: fid, to: o.id });
      else if (!hasTreaty(sim, fid, o.id, 'trade') && op > -5 && r.chance(def.trade * 0.8)) proposeTo(sim, { kind: 'trade', from: fid, to: o.id });
      else if (!hasTreaty(sim, fid, o.id, 'defensive') && !hasTreaty(sim, fid, o.id, 'alliance') && op > 20 && r.chance(def.caution * 0.5)) proposeTo(sim, { kind: 'defensive', from: fid, to: o.id });
      else if (op < -20 && militaryStrength(sim, o.id) > myStr * 1.3 && r.chance(def.caution * 0.4) && !hasTreaty(sim, fid, o.id, 'nonaggression')) proposeTo(sim, { kind: 'nonaggression', from: fid, to: o.id });
      else if (def.aggression > 0.6 && militaryStrength(sim, o.id) * 2.5 < myStr && areNeighbours(sim, fid, o.id) && r.chance(0.2)) proposeTo(sim, { kind: 'demand_tribute', from: fid, to: o.id, amount: 60 });
    }
  }
  // --- marriages
  if (r.chance(0.3)) {
    const singles = Object.values(sim.s.characters).filter((c) => c.alive && c.faction === fid && c.dynasty === fid && c.spouse === undefined && age(sim, c) >= ADULT_AGE && age(sim, c) < 40);
    if (singles.length) {
      singles.sort((a, b) => (f.heir === b.id ? 1 : 0) - (f.heir === a.id ? 1 : 0));
      const me = singles[0];
      const cands = Object.values(sim.s.characters).filter((c) => c.alive && c.faction && c.faction !== fid && isMajor(c.faction) && c.dynasty === c.faction && !canMarry(sim, me, c) && !atWar(sim, fid, c.faction));
      cands.sort((a, b) => opinion(sim, fid, b.faction!) + (sim.fac(b.faction!).heir === b.id ? 25 : 0) - (opinion(sim, fid, a.faction!) + (sim.fac(a.faction!).heir === a.id ? 25 : 0)));
      const target = cands[0];
      if (target && opinion(sim, fid, target.faction!) > -10) proposeTo(sim, { kind: 'marriage', from: fid, to: target.faction!, charA: me.id, charB: target.id });
      else if (r.chance(0.25)) {
        // marry a local noble instead
        const locals = Object.values(sim.s.characters).filter((c) => c.alive && c.faction === fid && c.dynasty !== fid && !canMarry(sim, me, c));
        if (locals.length) {
          const l = r.pick(locals);
          marry(sim, me.id, l.id);
        }
      }
    }
  }
  // --- intrigue
  if (f.council.spymaster !== undefined && f.treasury > 900 && r.chance(0.12)) {
    const rivals = others.filter((o) => opinion(sim, fid, o.id) < -20);
    if (rivals.length) {
      const t = r.pick(rivals);
      const kinds = Object.keys(INTRIGUE_KINDS) as (keyof typeof INTRIGUE_KINDS)[];
      const kind = r.pick(kinds);
      const third = others.find((o) => o.id !== t.id && opinion(sim, t.id, o.id) > 10)?.id;
      const prov = sim.provincesOf(t.id).find((p) => sim.geo.provinces[p.id].neighbors.some((n) => sim.s.provinces[n].owner === fid))?.id;
      startIntrigue(sim, fid, kind, t.id, { third, province: prov });
    }
  }
}

// --------------------------------------------------------------------------- military

function settlementValue(sim: Sim, p: ProvinceState, fid: FactionId) {
  const pg = sim.geo.provinces[p.id];
  let v = 20 + p.settlement.tier * 15 + (p.settlement.isPort ? 8 : 0) + (pg.anchor.greatCapital ? 25 : 0);
  if (provinceClaims(sim, fid).includes(p.id)) v += 30;
  const garrison = p.settlement.garrison.reduce((s, u) => s + u.troops, 0);
  const def = armyInSettlement(sim, p.id);
  v -= garrison / 40 + (def ? armyPower(sim, def) / 8 : 0) + p.settlement.walls * 6;
  return v;
}

function defendersPower(sim: Sim, pid: number) {
  const p = sim.s.provinces[pid];
  let power = p.settlement.garrison.reduce((s, u) => s + u.troops, 0) * 0.07 * (1 + p.settlement.walls * 0.4);
  const a = armyInSettlement(sim, pid);
  if (a) power += armyPower(sim, a) * (1 + p.settlement.walls * 0.35);
  return power;
}

function aiConsolidate(sim: Sim, fid: FactionId) {
  const armies = sim.armiesOf(fid).filter((a) => a.embarked === undefined && a.siegeOf === undefined && sim.fac(fid).aiMemory['invArmy'] !== a.id);
  for (const a of armies) {
    if (!sim.s.armies[a.id] || a.general !== undefined || a.units.length > 6) continue;
    const host = armies
      .filter((b) => b.id !== a.id && sim.s.armies[b.id] && b.units.length + a.units.length <= 16 && sim.geo.landmass[b.cell] === sim.geo.landmass[a.cell])
      .map((b) => ({ b, d: Math.hypot(b.x - a.x, b.z - a.z) + (b.general !== undefined ? -200 : 0) }))
      .sort((x, y) => x.d - y.d)[0];
    if (host && host.d < 1400) issueArmyOrder(sim, a, { kind: 'army', id: host.b.id });
  }
}

async function aiArmies(sim: Sim, fid: FactionId, hooks: TurnHooks) {
  const f = sim.fac(fid);
  aiConsolidate(sim, fid);
  const enemies = enemiesOf(sim, fid);
  const armies = sim.armiesOf(fid).filter((a) => a.embarked === undefined);
  const myProvs = sim.provincesOf(fid);
  for (const army of armies) {
    if (!sim.s.armies[army.id] || army.embarked !== undefined) continue;
    const power = armyPower(sim, army);
    const invasion = f.aiMemory['invArmy'] === army.id;
    // 1. sieges
    if (army.siegeOf !== undefined) {
      const p = sim.s.provinces[army.siegeOf];
      if (p.siege?.armyId === army.id && atWar(sim, fid, p.owner)) {
        if (canAssault(sim, army, p) && power > defendersPower(sim, p.id) * 1.25) {
          const r = assaultSettlement(sim, army);
          await handleOrderResult(sim, fid, army, r, hooks);
        }
        continue;
      }
    }
    if (invasion) continue; // handled by the invasion planner
    // 2. threats against own settlements
    let threat: ArmyState | undefined;
    let threatened: ProvinceState | undefined;
    for (const p of myProvs) {
      const pg = sim.geo.provinces[p.id];
      for (const e of Object.values(sim.s.armies)) {
        if (e.embarked !== undefined || !atWar(sim, fid, e.faction)) continue;
        const d = Math.hypot(e.x - pg.x, e.z - pg.z);
        if (d < 260 && Math.hypot(e.x - army.x, e.z - army.z) < 900) {
          if (!threat || armyPower(sim, e) > armyPower(sim, threat)) {
            threat = e;
            threatened = p;
          }
        }
      }
    }
    if (threat && threatened) {
      const tp = armyPower(sim, threat);
      if (power > tp * 1.1) {
        const r = issueArmyOrder(sim, army, { kind: 'army', id: threat.id });
        await handleOrderResult(sim, fid, army, r, hooks);
        continue;
      }
      if (sim.s.armies[army.id]) {
        issueArmyOrder(sim, army, { kind: 'settlement', pid: threatened.id });
        continue;
      }
    }
    if (!enemies.length || enemies.every((e) => e === 'pirates')) {
      // peacetime: rest in the nearest own settlement when away
      const pid = sim.geo.province[army.cell];
      if (pid < 0 || sim.s.provinces[pid].owner !== fid) {
        const home = myProvs.map((p) => ({ p, d: Math.hypot(sim.geo.provinces[p.id].x - army.x, sim.geo.provinces[p.id].z - army.z) })).sort((a, b) => a.d - b.d)[0];
        if (home) issueArmyOrder(sim, army, { kind: 'settlement', pid: home.p.id });
      }
      continue;
    }
    // 3. offensive: nearby enemy armies
    const nearEnemy = Object.values(sim.s.armies)
      .filter((e) => e.embarked === undefined && atWar(sim, fid, e.faction) && sim.geo.landmass[e.cell] === sim.geo.landmass[army.cell])
      .map((e) => ({ e, d: Math.hypot(e.x - army.x, e.z - army.z) }))
      .filter((x) => x.d < 700)
      .sort((a, b) => a.d - b.d)[0];
    if (nearEnemy && power > armyPower(sim, nearEnemy.e) * 1.25 && troopCount(army.units) > 300) {
      const r = issueArmyOrder(sim, army, { kind: 'army', id: nearEnemy.e.id });
      await handleOrderResult(sim, fid, army, r, hooks);
      continue;
    }
    if (troopCount(army.units) < 350 || power < 30) {
      // too weak: fall back and replenish
      const pid = sim.geo.province[army.cell];
      if (pid < 0 || sim.s.provinces[pid].owner !== fid) {
        const home = myProvs.map((p) => ({ p, d: Math.hypot(sim.geo.provinces[p.id].x - army.x, sim.geo.provinces[p.id].z - army.z) })).sort((a, b) => a.d - b.d)[0];
        if (home) issueArmyOrder(sim, army, { kind: 'settlement', pid: home.p.id });
      }
      continue;
    }
    // 4. target settlement on the same landmass
    const targets = sim.s.provinces
      .filter((p) => atWar(sim, fid, p.owner) && sim.geo.provinces[p.id].landmass === sim.geo.landmass[army.cell])
      .map((p) => ({ p, v: settlementValue(sim, p, fid) - Math.hypot(sim.geo.provinces[p.id].x - army.x, sim.geo.provinces[p.id].z - army.z) / 45 }))
      .sort((a, b) => b.v - a.v);
    let acted = false;
    for (const t of targets.slice(0, 3)) {
      if (defendersPower(sim, t.p.id) > power * 1.5 && t.p.settlement.walls > 0 && t.p.siege?.armyId !== army.id && !t.p.siege) {
        // still lay siege: starvation works over time
        if (power < defendersPower(sim, t.p.id) * 0.5) continue;
      }
      const r = issueArmyOrder(sim, army, { kind: 'settlement', pid: t.p.id });
      if (r.ok) {
        await handleOrderResult(sim, fid, army, r, hooks);
        acted = true;
        break;
      }
    }
    if (!acted && targets.length === 0) {
      f.aiMemory['wantInvasion'] = 1;
    }
    await hooks.yieldFrame();
  }
}

/** Plans and executes an amphibious invasion for maritime factions. */
async function aiInvasion(sim: Sim, fid: FactionId, hooks: TurnHooks) {
  const f = sim.fac(fid);
  const mem = f.aiMemory;
  const enemies = enemiesOf(sim, fid).filter((e) => e !== 'pirates' && e !== 'rebels');
  const clear = () => {
    delete mem['invArmy'];
    delete mem['invFleet'];
    delete mem['invTarget'];
    delete mem['invStage'];
  };
  if (!enemies.length) {
    // disembark if at sea
    const fl = sim.s.fleets[mem['invFleet']];
    if (fl && fl.carrying.length) {
      const home = sim.provincesOf(fid).filter((p) => sim.geo.provinces[p.id].port)[0];
      if (home) issueFleetOrder(sim, fl, { kind: 'cell', cell: sim.geo.provinces[home.id].cell });
    }
    clear();
    mem['wantInvasion'] = 0;
    return;
  }
  let army = sim.s.armies[mem['invArmy']];
  let fleet = sim.s.fleets[mem['invFleet']];
  let target = mem['invTarget'] !== undefined ? sim.s.provinces[mem['invTarget']] : undefined;
  if (mem['invArmy'] !== undefined && (!army || !fleet || !target || !atWar(sim, fid, target.owner))) {
    if (army && fleet && army.embarked === fleet.id) {
      /* keep sailing home below */
    }
    clear();
    army = undefined as unknown as ArmyState;
    fleet = undefined as unknown as FleetState;
    target = undefined;
  }
  if (!army) {
    if (mem['wantInvasion'] !== 1 && !factionDef(fid).island) return;
    // pick strongest idle army near a port, and a fleet with capacity
    const fleets = sim.fleetsOf(fid).filter((x) => !x.isPirate && x.carrying.length === 0);
    const armies = sim.armiesOf(fid).filter((a) => a.embarked === undefined && a.siegeOf === undefined && troopCount(a.units) > 400);
    if (!fleets.length || !armies.length) return;
    armies.sort((a, b) => armyPower(sim, b) - armyPower(sim, a));
    const cand = armies[0];
    const fl = fleets.filter((x) => fleetCapacity(x) >= troopCount(cand.units)).sort((a, b) => fleetCapacity(b) - fleetCapacity(a))[0];
    if (!fl) {
      mem['wantInvasion'] = 1;
      return;
    }
    // target: enemy coastal settlement on another landmass (or unreachable by land)
    const tg = sim.s.provinces
      .filter((p) => enemies.includes(p.owner) && sim.geo.provinces[p.id].landmass !== sim.geo.landmass[cand.cell])
      .map((p) => ({ p, v: settlementValue(sim, p, fid) - Math.hypot(sim.geo.provinces[p.id].x - cand.x, sim.geo.provinces[p.id].z - cand.z) / 60 }))
      .filter((x) => defendersPower(sim, x.p.id) < armyPower(sim, cand) * 1.3)
      .sort((a, b) => b.v - a.v)[0];
    if (!tg) return;
    mem['invArmy'] = cand.id;
    mem['invFleet'] = fl.id;
    mem['invTarget'] = tg.p.id;
    mem['invStage'] = 0;
    army = cand;
    fleet = fl;
    target = tg.p;
    if (sim.isPlayer(tg.p.owner) || sim.rng.chance(0.3)) {
      /* intelligence of invasions is not revealed */
    }
  }
  if (!army || !fleet || !target) return;
  const stage = mem['invStage'] ?? 0;
  if (stage === 0) {
    // rendezvous: fleet goes to water near the army, army goes to the shore near the fleet
    if (army.embarked === fleet.id) mem['invStage'] = 1;
    else {
      const d = cellDist(sim, army.cell, fleet.cell);
      if (d > 2.9) {
        const waters = waterCellsNear(sim, army.cell, 3);
        if (waters.length) {
          waters.sort((a, b) => cellDist(sim, a, fleet.cell) - cellDist(sim, b, fleet.cell));
          issueFleetOrder(sim, fleet, { kind: 'cell', cell: waters[0] });
        } else {
          // army must go to a coast
          const ports = sim.provincesOf(fid).filter((p) => sim.geo.provinces[p.id].port && sim.geo.provinces[p.id].landmass === sim.geo.landmass[army.cell]);
          if (ports.length) issueArmyOrder(sim, army, { kind: 'settlement', pid: ports[0].id });
          else {
            clear();
            return;
          }
        }
      }
      if (sim.s.armies[army.id] && cellDist(sim, army.cell, fleet.cell) > 2.9 && army.movePoints > 0) issueArmyOrder(sim, army, { kind: 'fleet', id: fleet.id });
      if (sim.s.armies[army.id] && cellDist(sim, army.cell, fleet.cell) <= 2.9 && army.embarked === undefined) {
        if (!embark(sim, army, fleet)) mem['invStage'] = 1;
      }
    }
  }
  if ((mem['invStage'] ?? 0) === 1 && sim.s.fleets[fleet.id]) {
    const pg = sim.geo.provinces[target.id];
    // choose a landing cell near the target settlement
    const shore = waterCellsNear(sim, pg.cell, 7).filter((c) => sim.geo.coastDist[c] >= -2);
    if (!shore.length) {
      clear();
      return;
    }
    shore.sort((a, b) => cellDist(sim, a, fleet.cell) - cellDist(sim, b, fleet.cell));
    if (cellDist(sim, fleet.cell, shore[0]) > 1.5) {
      // hostile fleets? fight them if stronger
      const r = issueFleetOrder(sim, fleet, { kind: 'cell', cell: shore[0] });
      await handleOrderResult(sim, fid, undefined, r, hooks);
    }
    const fl2 = sim.s.fleets[fleet.id];
    if (fl2 && cellDist(sim, fl2.cell, shore[0]) <= 1.5) {
      const lands = landCellsNear(sim, fl2.cell, 2).filter((c) => sim.geo.landmass[c] === pg.landmass);
      lands.sort((a, b) => cellDist(sim, a, pg.cell) - cellDist(sim, b, pg.cell));
      if (lands.length && !disembark(sim, fl2, lands[0])) {
        mem['invStage'] = 2;
        sim.chronicle(`${sim.houseName(fid)} landed an army near ${pg.name}.`, [fid, target.owner], 'invasion');
        if (sim.isPlayer(target.owner)) sim.notify({ kind: 'danger', title: 'Enemy Landing!', text: `${sim.houseName(fid)} has landed an army near ${pg.name}!`, focus: { x: pg.x, z: pg.z } });
      }
    }
  }
  if ((mem['invStage'] ?? 0) === 2) {
    const a = sim.s.armies[army.id];
    if (!a) {
      clear();
      return;
    }
    // now a normal army: next turn it will be handled by land logic
    clear();
    mem['wantInvasion'] = 0;
  }
}

async function aiFleets(sim: Sim, fid: FactionId, hooks: TurnHooks) {
  const f = sim.fac(fid);
  const enemies = enemiesOf(sim, fid);
  for (const fleet of sim.fleetsOf(fid)) {
    if (!sim.s.fleets[fleet.id]) continue;
    if (f.aiMemory['invFleet'] === fleet.id) continue;
    if (fleet.carrying.length) continue;
    const myP = fleetPower(sim, fleet);
    // engage hostile fleets nearby
    const hostile = Object.values(sim.s.fleets)
      .filter((o) => atWar(sim, fid, o.faction))
      .map((o) => ({ o, d: Math.hypot(o.x - fleet.x, o.z - fleet.z) }))
      .filter((x) => x.d < 900)
      .sort((a, b) => a.d - b.d)[0];
    if (hostile) {
      const theirP = fleetPower(sim, hostile.o);
      if (myP > theirP * 1.15) {
        const r = issueFleetOrder(sim, fleet, { kind: 'fleet', id: hostile.o.id });
        await handleOrderResult(sim, fid, undefined, r, hooks);
        continue;
      } else if (theirP > myP * 1.3 && hostile.d < 400) {
        // flee to home port
        const home = sim.provincesOf(fid).find((p) => sim.geo.provinces[p.id].port);
        if (home) issueFleetOrder(sim, fleet, { kind: 'settlement', pid: home.id });
        continue;
      }
    }
    if (fleet.isPirate) {
      const tgt = fleet.orderTarget !== undefined ? sim.geo.provinces[fleet.orderTarget] : undefined;
      if (tgt && tgt.port && cellDist(sim, fleet.cell, tgt.portCell) > 2) issueFleetOrder(sim, fleet, { kind: 'cell', cell: tgt.portCell });
      const age2 = (fleet as FleetState & { spawned?: number }).spawned ?? sim.s.turn;
      (fleet as FleetState & { spawned?: number }).spawned = age2;
      if (sim.s.turn - age2 > 12) {
        delete sim.s.fleets[fleet.id];
        sim.emit({ type: 'FLEET_DESTROYED', fleet: fleet.id, faction: fid, reason: 'departed' });
      }
      continue;
    }
    if (enemies.length) {
      // blockade the nearest enemy port
      const port = sim.s.provinces
        .filter((p) => atWar(sim, fid, p.owner) && sim.geo.provinces[p.id].port)
        .map((p) => ({ p, d: Math.hypot(sim.geo.provinces[p.id].portX - fleet.x, sim.geo.provinces[p.id].portZ - fleet.z) }))
        .sort((a, b) => a.d - b.d)[0];
      if (port && port.d < 2500 && myP > 60 && !fleet.ships.every((s) => shipDef(s.type).id === 'cog' || shipDef(s.type).id === 'hulk')) {
        const r = issueFleetOrder(sim, fleet, { kind: 'settlement', pid: port.p.id });
        await handleOrderResult(sim, fid, undefined, r, hooks);
        continue;
      }
    }
    // patrol: occasionally sail between own ports
    if (fleet.inPort === undefined || sim.rng.chance(0.15)) {
      const ports = sim.provincesOf(fid).filter((p) => sim.geo.provinces[p.id].port);
      if (ports.length) {
        const p = sim.rng.pick(ports);
        if (!isWaterCell(sim.geo, sim.geo.provinces[p.id].portCell)) continue;
        issueFleetOrder(sim, fleet, { kind: 'settlement', pid: p.id });
        fleet.order = 'patrol';
      }
    }
  }
}

async function aiRebels(sim: Sim, hooks: TurnHooks) {
  for (const a of Object.values(sim.s.armies)) {
    if (a.faction !== 'rebels' || !sim.s.armies[a.id]) continue;
    const pid = sim.geo.province[a.cell];
    const targets = sim.s.provinces.filter((p) => p.owner !== 'rebels' && sim.geo.provinces[p.id].landmass === sim.geo.landmass[a.cell]);
    targets.sort((x, y) => Math.hypot(sim.geo.provinces[x.id].x - a.x, sim.geo.provinces[x.id].z - a.z) - Math.hypot(sim.geo.provinces[y.id].x - a.x, sim.geo.provinces[y.id].z - a.z));
    const t = pid >= 0 && sim.s.provinces[pid].owner !== 'rebels' ? sim.s.provinces[pid] : targets[0];
    if (!t) continue;
    if (a.siegeOf !== undefined) {
      if (canAssault(sim, a, sim.s.provinces[a.siegeOf]) && armyPower(sim, a) > defendersPower(sim, a.siegeOf)) {
        const r = assaultSettlement(sim, a);
        await handleOrderResult(sim, 'rebels', a, r, hooks);
      }
      continue;
    }
    const r = issueArmyOrder(sim, a, { kind: 'settlement', pid: t.id });
    await handleOrderResult(sim, 'rebels', a, r, hooks);
  }
}

export async function aiTakeTurn(sim: Sim, fid: FactionId, hooks: TurnHooks) {
  if (fid === 'rebels') return aiRebels(sim, hooks);
  if (fid === 'pirates') return aiFleets(sim, fid, hooks);
  const f = sim.fac(fid);
  if (!f.alive) return;
  if (fid !== 'free') {
    aiFillCouncil(sim, fid);
    aiEconomy(sim, fid);
    aiDiplomacy(sim, fid);
    aiRecruit(sim, fid);
    await hooks.yieldFrame();
    await aiInvasion(sim, fid, hooks);
    await aiFleets(sim, fid, hooks);
  } else {
    // free towns: keep treasury for walls, recruit militia when threatened
    aiEconomy(sim, fid);
    if (enemiesOf(sim, fid).length && f.treasury > 300) {
      for (const p of sim.provincesOf(fid)) {
        const opt = recruitOptions(sim, p.id).find((o) => !o.blocked && !o.ship && (o.type === 'spearmen' || o.type === 'crossbowmen' || o.type === 'militia'));
        if (opt) recruit(sim, p.id, opt.type);
      }
    }
  }
  await aiArmies(sim, fid, hooks);
}

export { FACTIONS, warBetween };
