import type { Sim } from './context';
import { aiTakeTurn, type TurnHooks } from './ai';
import { atWar, decayModifiers, isAllied } from './diplomacy';
import { computeTrade, processFactionEconomy, progressConstruction, progressRecruitment, updateProvinces } from './economy';
import { updateSieges } from './conquest';
import { updateCharacters } from './characters';
import { checkRebellions, rollEvents } from './events';
import { resolveIntrigue } from './intrigue';
import { checkObjectives, checkVictory } from './objectives';
import { rollWeather } from './weather';
import { advanceArmy, advanceFleet, refreshForces, cellDist } from './movement';
import { updateFog } from './fog';
import { isMajor } from '../data/factions';

export function computeBlockades(sim: Sim) {
  for (const p of sim.s.provinces) {
    const pg = sim.geo.provinces[p.id];
    if (!pg.port) {
      p.blockaded = false;
      continue;
    }
    let hostile = false;
    let friendly = false;
    for (const f of Object.values(sim.s.fleets)) {
      if (cellDist(sim, f.cell, pg.portCell) > 3) continue;
      if (f.faction === p.owner || isAllied(sim, f.faction, p.owner)) friendly = true;
      else if (atWar(sim, f.faction, p.owner)) hostile = true;
    }
    const was = p.blockaded;
    p.blockaded = hostile && !friendly;
    if (p.blockaded && !was) sim.notify({ kind: 'danger', title: `${p.settlement.name} Blockaded`, text: `Enemy ships blockade ${p.settlement.name}. Trade and shipbuilding there have stopped.`, focus: { x: pg.portX, z: pg.portZ } }, p.owner);
  }
}

export interface EndTurnResult {
  newTurn: number;
}

/** Runs AI factions and resolves the world. Yields to the renderer between steps. */
export async function endTurn(sim: Sim, hooks: TurnHooks): Promise<EndTurnResult> {
  const s = sim.s;
  sim.emit({ type: 'TURN_ENDED', turn: s.turn });
  const order = Object.keys(s.factions).filter((f) => f !== s.player && s.factions[f].alive);
  const majors = sim.rng.shuffle(order.filter((f) => isMajor(f)));
  const minors = order.filter((f) => !isMajor(f));
  const all = [...majors, ...minors];
  for (let i = 0; i < all.length; i++) {
    const fid = all[i];
    hooks.progress?.(`${sim.houseName(fid)} is deliberating`, i / (all.length + 2));
    await aiTakeTurn(sim, fid, hooks);
    await hooks.yieldFrame();
  }
  hooks.progress?.('The seasons turn', all.length / (all.length + 2));
  computeBlockades(sim);
  computeTrade(sim);
  for (const f of Object.values(s.factions)) {
    if (!f.alive) continue;
    processFactionEconomy(sim, f.id);
    progressConstruction(sim, f.id);
    progressRecruitment(sim, f.id);
    if (sim.s.diplomacy.wars.some((w) => w.attackers.includes(f.id) || w.defenders.includes(f.id))) f.warWeariness += 1.2;
    else f.warWeariness = Math.max(0, f.warWeariness - 2);
  }
  updateProvinces(sim);
  updateSieges(sim);
  decayModifiers(sim);
  await hooks.yieldFrame();
  updateCharacters(sim);
  for (const f of Object.values(s.factions)) if (f.alive && isMajor(f.id)) rollEvents(sim, f.id);
  resolveIntrigue(sim);
  checkRebellions(sim);
  for (const f of Object.values(s.factions)) if (f.alive && isMajor(f.id)) checkObjectives(sim, f.id);
  // new season
  s.turn++;
  rollWeather(sim);
  for (const f of Object.values(s.factions)) if (f.alive || f.id === 'rebels' || f.id === 'pirates') refreshForces(sim, f.id);
  // continue queued player marches
  for (const a of Object.values(s.armies)) if (a.faction === s.player && a.path.length && a.embarked === undefined) advanceArmy(sim, a);
  for (const fl of Object.values(s.fleets)) if (fl.faction === s.player && fl.path.length) advanceFleet(sim, fl);
  computeBlockades(sim);
  checkVictory(sim);
  updateFog(sim);
  sim.syncRng();
  hooks.progress?.('', 1);
  sim.emit({ type: 'TURN_STARTED', turn: s.turn });
  return { newTurn: s.turn };
}
