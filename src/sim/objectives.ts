import { FACTIONS, factionDef } from '../data/factions';
import { REGION_NAMES } from '../data/worldLayout';
import type { Sim } from './context';
import { alliesOf, isAllied, marriageTies, opinion, provinceClaims, vassalsOf } from './diplomacy';
import type { FactionId, Objective } from './types';

export function generateObjectives(sim: Sim, fid: FactionId): Objective[] {
  const out: Objective[] = [];
  const g = sim.geo;
  const myPorts = sim.provincesOf(fid).filter((p) => p.settlement.isPort).length;
  out.push({ id: 'ports', kind: 'ports', label: `Control ${Math.max(3, myPorts + 2)} port cities`, amount: Math.max(3, myPorts + 2), reward: { gold: 600, prestige: 40 }, done: false });
  // friendliest great house for an alliance
  const others = FACTIONS.map((f) => f.id).filter((x) => x !== fid);
  others.sort((a, b) => opinion(sim, b, fid) - opinion(sim, a, fid));
  const friend = others.find((x) => !isAllied(sim, fid, x));
  if (friend) out.push({ id: 'alliance', kind: 'alliance', label: `Secure an alliance with ${factionDef(friend).house}`, target: friend, reward: { prestige: 50, legitimacy: 5 }, done: false });
  // island to conquer
  const myLand = new Set(sim.provincesOf(fid).map((p) => g.provinces[p.id].landmass));
  const islands = [2, 3, 4, 5, 6].filter((l) => !myLand.has(l));
  if (islands.length) {
    const lm = islands[sim.rng.int(0, islands.length - 1)];
    const name = g.provinces.find((p) => p.landmass === lm)?.region ?? '';
    out.push({ id: 'island', kind: 'island', label: `Hold a settlement on the isle of ${REGION_NAMES[name] ?? name}`, target: lm, reward: { gold: 500, prestige: 60 }, done: false });
  }
  out.push({ id: 'treasury', kind: 'treasury', label: 'Amass a treasury of 6,000 gold', amount: 6000, reward: { prestige: 50, legitimacy: 5 }, done: false });
  const claims = provinceClaims(sim, fid);
  if (claims.length) out.push({ id: 'claim', kind: 'claim', label: `Press your claim on ${sim.provName(claims[0])}`, target: claims[0], reward: { prestige: 70, legitimacy: 10 }, done: false });
  out.push({ id: 'marriage', kind: 'marriage', label: 'Wed a child of your house into another great house', reward: { prestige: 40 }, done: false });
  const home = g.provinces[sim.fac(fid).capital]?.region;
  if (home) out.push({ id: 'region', kind: 'region', label: `Unite all of ${REGION_NAMES[home] ?? home} under your banner`, target: home, reward: { gold: 800, prestige: 60 }, done: false });
  return out;
}

export function checkObjectives(sim: Sim, fid: FactionId) {
  const f = sim.fac(fid);
  for (const o of f.objectives) {
    if (o.done) continue;
    let ok = false;
    switch (o.kind) {
      case 'ports':
        ok = sim.provincesOf(fid).filter((p) => p.settlement.isPort).length >= (o.amount ?? 3);
        break;
      case 'alliance':
        ok = alliesOf(sim, fid).includes(o.target as string);
        break;
      case 'island':
        ok = sim.provincesOf(fid).some((p) => sim.geo.provinces[p.id].landmass === o.target);
        break;
      case 'treasury':
        ok = f.treasury >= (o.amount ?? 6000);
        break;
      case 'claim':
        ok = sim.s.provinces[o.target as number]?.owner === fid;
        break;
      case 'marriage':
        ok = FACTIONS.some((x) => x.id !== fid && marriageTies(sim, fid, x.id) > 0 && sim.s.stats.marriages > 0 && Object.values(sim.s.characters).some((c) => c.dynasty === fid && c.alive && c.spouse !== undefined && sim.char(c.spouse)?.dynasty === x.id));
        break;
      case 'region':
        ok = sim.s.provinces.filter((p) => sim.geo.provinces[p.id].region === o.target).every((p) => p.owner === fid);
        break;
    }
    if (ok) {
      o.done = true;
      f.treasury += o.reward.gold ?? 0;
      f.prestige += o.reward.prestige ?? 0;
      f.legitimacy = Math.min(100, f.legitimacy + (o.reward.legitimacy ?? 0));
      sim.notify({ kind: 'info', title: 'Objective Achieved', text: `${o.label}. Reward: ${[o.reward.gold ? `${o.reward.gold} gold` : '', o.reward.prestige ? `${o.reward.prestige} prestige` : '', o.reward.legitimacy ? `${o.reward.legitimacy} legitimacy` : ''].filter(Boolean).join(', ')}.` }, fid);
    }
  }
}

export interface VictoryStatus {
  conquest: { have: number; need: number };
  dynastic: { prestige: number; need: number; rival: number; bonds: number; needBonds: number };
  imperial: { capitals: string[]; heldCapitals: string[]; islands: number; needIslands: number };
}

export const GREAT_CONTINENTAL_CAPITALS = ['Aldhaven', 'Valmont', 'Hollowcrest'];

export function victoryStatus(sim: Sim, fid: FactionId): VictoryStatus {
  const total = sim.s.provinces.length;
  const mine = sim.s.provinces.filter((p) => p.owner === fid || vassalsOf(sim, fid).includes(p.owner)).length;
  const prestige = sim.fac(fid).prestige;
  let rival = 0;
  for (const f of sim.majorFactions()) if (f.id !== fid) rival = Math.max(rival, f.prestige);
  const bonds = FACTIONS.filter((x) => x.id !== fid && sim.fac(x.id).alive && (isAllied(sim, fid, x.id) || vassalsOf(sim, fid).includes(x.id) || marriageTies(sim, fid, x.id) > 0)).length;
  const held = GREAT_CONTINENTAL_CAPITALS.filter((n) => sim.s.provinces.find((p) => p.settlement.name === n || sim.geo.provinces[p.id].name === n)?.owner === fid);
  const islandSet = new Set<number>();
  for (const p of sim.s.provinces) if (p.owner === fid) {
    const lm = sim.geo.provinces[p.id].landmass;
    if (lm >= 2 && lm <= 6) islandSet.add(lm);
  }
  return {
    conquest: { have: mine, need: Math.ceil(total * 0.6) },
    dynastic: { prestige, need: 1500, rival, bonds, needBonds: 4 },
    imperial: { capitals: GREAT_CONTINENTAL_CAPITALS, heldCapitals: held, islands: islandSet.size, needIslands: 4 },
  };
}

export function checkVictory(sim: Sim) {
  if (sim.s.victory) return;
  for (const f of sim.majorFactions()) {
    const v = victoryStatus(sim, f.id);
    let kind: string | null = null;
    if (v.conquest.have >= v.conquest.need) kind = 'conquest';
    else if (v.dynastic.prestige >= v.dynastic.need && v.dynastic.prestige >= v.dynastic.rival * 2 && v.dynastic.bonds >= v.dynastic.needBonds) kind = 'dynastic';
    else if (v.imperial.heldCapitals.length === v.imperial.capitals.length && v.imperial.islands >= v.imperial.needIslands) kind = 'imperial';
    if (kind) {
      sim.s.victory = { faction: f.id, kind, turn: sim.s.turn };
      sim.emit({ type: 'VICTORY', faction: f.id, kind });
      sim.chronicle(`${sim.houseName(f.id)} achieved ${kind} victory.`, [f.id], 'victory');
      return;
    }
  }
  const pf = sim.fac(sim.s.player);
  if (!pf.alive) {
    sim.s.victory = { faction: 'none', kind: 'defeat', turn: sim.s.turn };
    sim.emit({ type: 'VICTORY', faction: 'none', kind: 'defeat' });
  }
}
