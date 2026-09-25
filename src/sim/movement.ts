import { MinHeap } from '../core/math';
import type { Sim } from './context';
import { atWar, canPass, isAllied } from './diplomacy';
import { armyMaxMP, fleetCapacity, fleetMaxMP, troopCount } from './military';
import { astar } from './world/worldGen';
import { Biome, cellX, cellZ, NavT, cellOf } from './world/geo';
import { seasonOf, type ArmyState, type FactionId, type FleetState } from './types';

export const ZOC_RADIUS = 2.2; // cells

export function armyCellCost(sim: Sim, fid: FactionId, c: number, ignoreBorders = false): number {
  const g = sim.geo;
  const t = g.nav[c];
  if (t < NavT.Plains || t === NavT.Impassable) return -1;
  let cost = t === NavT.Mountain ? 3.2 : t === NavT.Hills ? 1.9 : t === NavT.Forest ? 1.5 : 1;
  if (g.road[c]) cost = 0.55;
  else if (g.river[c]) cost += 2.2;
  const season = seasonOf(sim.s.turn);
  if (season === 3) {
    cost *= 1.2;
    const b = g.biome[Math.min(g.hmH - 1, Math.floor(c / g.navW) * 2 + 1) * g.hmW + Math.min(g.hmW - 1, (c % g.navW) * 2 + 1)];
    if (b === Biome.Snow || b === Biome.Tundra || b === Biome.Conifer) cost *= 1.35;
  }
  if (!ignoreBorders) {
    const pid = g.province[c];
    if (pid >= 0) {
      const owner = sim.s.provinces[pid].owner;
      if (!canPass(sim, fid, owner)) return -1;
    }
  }
  return cost;
}

export function fleetCellCost(sim: Sim, c: number): number {
  const t = sim.geo.nav[c];
  if (t > NavT.Shallow) return -1;
  return t === NavT.Shallow ? 1.1 : 1;
}

export interface PathResult {
  path: number[];
  cost: number[]; // cumulative
  reason?: string;
}

function cumulative(path: number[], costFn: (c: number) => number, navW: number): number[] {
  const out: number[] = [0];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const diag = a % navW !== b % navW && Math.floor(a / navW) !== Math.floor(b / navW);
    acc += Math.max(0.2, costFn(b)) * (diag ? 1.414 : 1);
    out.push(acc);
  }
  return out;
}

/** Hostile army cells that block pathing (except the goal). */
function hostileBlockers(sim: Sim, fid: FactionId, selfId?: number): Set<number> {
  const set = new Set<number>();
  for (const a of Object.values(sim.s.armies)) {
    if (a.id === selfId || a.embarked !== undefined) continue;
    if (a.faction !== fid && !isAllied(sim, a.faction, fid)) set.add(a.cell);
  }
  return set;
}

export function findArmyPath(sim: Sim, army: ArmyState, goal: number): PathResult {
  const g = sim.geo;
  if (goal === army.cell) return { path: [army.cell], cost: [0] };
  const t = g.nav[goal];
  if (t <= NavT.Shallow) return { path: [], cost: [], reason: 'Armies cannot march into the sea. Use a fleet to transport them.' };
  if (t === NavT.Impassable) return { path: [], cost: [], reason: 'That terrain is impassable.' };
  const pid = g.province[goal];
  if (pid >= 0) {
    const owner = sim.s.provinces[pid].owner;
    if (!canPass(sim, army.faction, owner)) return { path: [], cost: [], reason: `You need military access (or war) to enter the lands of ${sim.houseName(owner)}.` };
  }
  if (g.landmass[goal] !== g.landmass[army.cell]) return { path: [], cost: [], reason: 'That land lies across the sea. Embark the army on a fleet.' };
  const blockers = hostileBlockers(sim, army.faction, army.id);
  const costFn = (c: number) => (blockers.has(c) && c !== goal ? -1 : armyCellCost(sim, army.faction, c));
  const path = astar(g.navW, g.navH, army.cell, goal, costFn, 120000);
  if (!path) return { path: [], cost: [], reason: 'No route can be found.' };
  return { path, cost: cumulative(path, (c) => armyCellCost(sim, army.faction, c, true), g.navW) };
}

export function findFleetPath(sim: Sim, fleet: FleetState, goal: number): PathResult {
  const g = sim.geo;
  if (g.nav[goal] > NavT.Shallow) return { path: [], cost: [], reason: 'Ships cannot sail onto land.' };
  const path = astar(g.navW, g.navH, fleet.cell, goal, (c) => fleetCellCost(sim, c), 150000);
  if (!path) return { path: [], cost: [], reason: 'No sea route can be found.' };
  return { path, cost: cumulative(path, (c) => fleetCellCost(sim, c), g.navW) };
}

/** Dijkstra flood for movement range overlay. Returns map cell->cost within budget. */
export function reachable(sim: Sim, start: number, budget: number, cost: (c: number) => number): Map<number, number> {
  const g = sim.geo;
  const dist = new Map<number, number>();
  const heap = new MinHeap();
  dist.set(start, 0);
  heap.push(start, 0);
  while (heap.size) {
    const c = heap.pop();
    const d = dist.get(c)!;
    const x = c % g.navW;
    const z = Math.floor(c / g.navW);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= g.navW || nz >= g.navH) continue;
        const n = nz * g.navW + nx;
        const cc = cost(n);
        if (cc < 0) continue;
        const nd = d + cc * (dx && dz ? 1.414 : 1);
        if (nd > budget) continue;
        if (nd < (dist.get(n) ?? Infinity)) {
          dist.set(n, nd);
          heap.push(n, nd);
        }
      }
  }
  return dist;
}

export function armyRange(sim: Sim, army: ArmyState) {
  return reachable(sim, army.cell, army.movePoints, (c) => armyCellCost(sim, army.faction, c));
}
export function fleetRange(sim: Sim, fleet: FleetState) {
  return reachable(sim, fleet.cell, fleet.movePoints, (c) => fleetCellCost(sim, c));
}

export function hostileNear(sim: Sim, fid: FactionId, c: number, radiusCells: number, selfId?: number): ArmyState | undefined {
  const g = sim.geo;
  const x = cellX(g, c);
  const z = cellZ(g, c);
  const r = radiusCells * g.navStep;
  for (const a of Object.values(sim.s.armies)) {
    if (a.id === selfId || a.embarked !== undefined) continue;
    if (!atWar(sim, a.faction, fid)) continue;
    if ((a.x - x) ** 2 + (a.z - z) ** 2 <= r * r) return a;
  }
  return undefined;
}

export interface MoveOutcome {
  walked: number[];
  stop: 'arrived' | 'mp' | 'zoc' | 'blocked' | 'none';
}

/** Walk the stored path consuming movement points. */
export function advanceArmy(sim: Sim, army: ArmyState): MoveOutcome {
  const g = sim.geo;
  const walked: number[] = [army.cell];
  let stop: MoveOutcome['stop'] = 'none';
  if (army.siegeOf !== undefined && army.path.length) {
    const p = sim.s.provinces[army.siegeOf];
    if (p.siege?.armyId === army.id) p.siege = undefined;
    army.siegeOf = undefined;
    army.stance = 'normal';
  }
  while (army.path.length) {
    const next = army.path[0];
    const diag = next % g.navW !== army.cell % g.navW && Math.floor(next / g.navW) !== Math.floor(army.cell / g.navW);
    const c = armyCellCost(sim, army.faction, next);
    if (c < 0) {
      stop = 'blocked';
      army.path = [];
      break;
    }
    const cost = c * (diag ? 1.414 : 1);
    if (cost > army.movePoints + 0.01) {
      stop = 'mp';
      break;
    }
    // occupied by hostile army? stop before it
    const occ = Object.values(sim.s.armies).find((a) => a.cell === next && a.id !== army.id && a.embarked === undefined && !isAllied(sim, a.faction, army.faction));
    if (occ) {
      stop = 'blocked';
      break;
    }
    army.movePoints -= cost;
    army.cell = next;
    army.path.shift();
    walked.push(next);
    // zone of control
    if (army.path.length && hostileNear(sim, army.faction, next, ZOC_RADIUS, army.id)) {
      stop = 'zoc';
      army.movePoints = 0;
      break;
    }
  }
  if (!army.path.length && stop === 'none') stop = 'arrived';
  army.x = cellX(g, army.cell);
  army.z = cellZ(g, army.cell);
  army.lastMoveTurn = sim.s.turn;
  if (walked.length > 1) sim.emit({ type: 'ARMY_MOVED', army: army.id, cells: walked });
  return { walked, stop };
}

export function advanceFleet(sim: Sim, fleet: FleetState): MoveOutcome {
  const g = sim.geo;
  const walked: number[] = [fleet.cell];
  let stop: MoveOutcome['stop'] = 'none';
  const stormy = sim.s.weather.regions['sea'] === 'storm';
  while (fleet.path.length) {
    const next = fleet.path[0];
    const diag = next % g.navW !== fleet.cell % g.navW && Math.floor(next / g.navW) !== Math.floor(fleet.cell / g.navW);
    const c = fleetCellCost(sim, next);
    if (c < 0) {
      stop = 'blocked';
      fleet.path = [];
      break;
    }
    const cost = c * (diag ? 1.414 : 1) * (stormy ? 1.6 : 1);
    if (cost > fleet.movePoints + 0.01) {
      stop = 'mp';
      break;
    }
    const occ = Object.values(sim.s.fleets).find((f) => f.cell === next && f.id !== fleet.id && atWar(sim, f.faction, fleet.faction));
    if (occ) {
      stop = 'blocked';
      break;
    }
    fleet.movePoints -= cost;
    fleet.cell = next;
    fleet.path.shift();
    walked.push(next);
  }
  if (!fleet.path.length && stop === 'none') stop = 'arrived';
  fleet.x = cellX(g, fleet.cell);
  fleet.z = cellZ(g, fleet.cell);
  if (walked.length > 1) fleet.inPort = undefined;
  // carried armies travel with the fleet
  for (const aid of fleet.carrying) {
    const a = sim.s.armies[aid];
    if (a) {
      a.cell = fleet.cell;
      a.x = fleet.x;
      a.z = fleet.z;
    }
  }
  // docking
  for (const p of sim.geo.provinces) {
    if (p.port && p.portCell === fleet.cell) {
      const owner = sim.s.provinces[p.id].owner;
      if (owner === fleet.faction || isAllied(sim, owner, fleet.faction)) fleet.inPort = p.id;
    }
  }
  if (walked.length > 1) sim.emit({ type: 'FLEET_MOVED', fleet: fleet.id, cells: walked });
  return { walked, stop };
}

/** Land cells adjacent (8-neighbourhood, radius r) to a water cell. */
export function landCellsNear(sim: Sim, waterCell: number, r = 1): number[] {
  const g = sim.geo;
  const out: number[] = [];
  const x0 = waterCell % g.navW;
  const z0 = Math.floor(waterCell / g.navW);
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx;
      const z = z0 + dz;
      if (x < 0 || z < 0 || x >= g.navW || z >= g.navH) continue;
      const c = z * g.navW + x;
      const t = g.nav[c];
      if (t >= NavT.Plains && t < NavT.Impassable) out.push(c);
    }
  return out;
}

export function waterCellsNear(sim: Sim, landCell: number, r = 1): number[] {
  const g = sim.geo;
  const out: number[] = [];
  const x0 = landCell % g.navW;
  const z0 = Math.floor(landCell / g.navW);
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx;
      const z = z0 + dz;
      if (x < 0 || z < 0 || x >= g.navW || z >= g.navH) continue;
      const c = z * g.navW + x;
      if (g.nav[c] <= NavT.Shallow) out.push(c);
    }
  return out;
}

export function cellDist(sim: Sim, a: number, b: number) {
  const g = sim.geo;
  return Math.hypot((a % g.navW) - (b % g.navW), Math.floor(a / g.navW) - Math.floor(b / g.navW));
}

export function canEmbark(sim: Sim, army: ArmyState, fleet: FleetState): string | null {
  if (fleet.faction !== army.faction) return 'You can only embark on your own ships.';
  if (army.embarked !== undefined) return 'Already at sea.';
  if (cellDist(sim, army.cell, fleet.cell) > 2.9) return 'The army must stand on the shore next to the fleet.';
  const carried = fleet.carrying.reduce((s, id) => s + (sim.s.armies[id] ? troopCount(sim.s.armies[id].units) : 0), 0);
  const cap = fleetCapacity(fleet);
  if (carried + troopCount(army.units) > cap) return `Not enough transport capacity (${cap - carried} free, ${troopCount(army.units)} needed). Build transport cogs.`;
  return null;
}

export function embark(sim: Sim, army: ArmyState, fleet: FleetState): string | null {
  const err = canEmbark(sim, army, fleet);
  if (err) return err;
  army.embarked = fleet.id;
  army.path = [];
  army.movePoints = 0;
  army.cell = fleet.cell;
  army.x = fleet.x;
  army.z = fleet.z;
  fleet.carrying.push(army.id);
  if (army.siegeOf !== undefined) {
    const p = sim.s.provinces[army.siegeOf];
    if (p.siege?.armyId === army.id) p.siege = undefined;
    army.siegeOf = undefined;
  }
  sim.emit({ type: 'ARMY_MOVED', army: army.id, cells: [army.cell], embarked: fleet.id });
  return null;
}

export function canDisembark(sim: Sim, fleet: FleetState, landCell: number): string | null {
  const g = sim.geo;
  if (!fleet.carrying.length) return 'The fleet carries no army.';
  const t = g.nav[landCell];
  if (t < NavT.Plains || t === NavT.Impassable) return 'Cannot land there.';
  if (cellDist(sim, fleet.cell, landCell) > 2.9) return 'The fleet must be close to the shore.';
  const pid = g.province[landCell];
  if (pid >= 0) {
    const owner = sim.s.provinces[pid].owner;
    if (!canPass(sim, fleet.faction, owner)) return `You need military access (or war) to land in ${sim.houseName(owner)} territory.`;
  }
  return null;
}

export function disembark(sim: Sim, fleet: FleetState, landCell: number): string | null {
  const err = canDisembark(sim, fleet, landCell);
  if (err) return err;
  const g = sim.geo;
  for (const aid of fleet.carrying) {
    const a = sim.s.armies[aid];
    if (!a) continue;
    a.embarked = undefined;
    a.cell = landCell;
    a.x = cellX(g, landCell);
    a.z = cellZ(g, landCell);
    a.movePoints = 0;
    a.path = [];
    sim.emit({ type: 'ARMY_MOVED', army: a.id, cells: [fleet.cell, landCell], landed: true });
  }
  fleet.carrying = [];
  return null;
}

/** Seasonal supply, attrition, replenishment, MP refresh for all armies & fleets of a faction. */
export function refreshForces(sim: Sim, fid: FactionId) {
  const g = sim.geo;
  const winter = seasonOf(sim.s.turn) === 3;
  for (const a of Object.values(sim.s.armies)) {
    if (a.faction !== fid) continue;
    let delta: number;
    if (a.embarked !== undefined) delta = -5;
    else {
      const pid = g.province[a.cell];
      const owner = pid >= 0 ? sim.s.provinces[pid].owner : undefined;
      if (owner === fid) delta = 30;
      else if (owner && isAllied(sim, owner, fid)) delta = 15;
      else if (owner && atWar(sim, owner, fid)) delta = winter ? -22 : -12;
      else delta = -4;
      if (a.siegeOf !== undefined) delta -= 4;
      if (a.stance === 'forced') delta -= 8;
    }
    a.supply = Math.max(0, Math.min(100, a.supply + delta));
    let attr = 0;
    if (a.supply < 30) attr = 0.04;
    if (a.supply < 10) attr = 0.08;
    if (attr) for (const u of a.units) u.troops = Math.max(1, Math.floor(u.troops * (1 - attr)));
    // replenish in own lands when stationary
    const pid = g.province[a.cell];
    if (a.embarked === undefined && pid >= 0 && sim.s.provinces[pid].owner === fid && a.lastMoveTurn !== sim.s.turn - 1) {
      const p = sim.s.provinces[pid];
      const rate = p.settlement.buildings.some((b) => b.id === 'barracks') ? 0.14 : 0.08;
      for (const u of a.units) {
        const add = Math.min(u.maxTroops - u.troops, Math.ceil(u.maxTroops * rate));
        if (add > 0 && p.population > 1500) {
          u.troops += add;
          p.population -= Math.round(add * 0.5);
        }
      }
    }
    const gen = sim.char(a.general);
    const target = 70 + (gen ? Math.min(20, gen.skills.command) : -10) - (a.supply < 30 ? 20 : 0);
    a.morale += (target - a.morale) * 0.35;
    a.units = a.units.filter((u) => u.troops > 0);
    a.maxMovePoints = armyMaxMP(sim, a);
    a.movePoints = a.embarked !== undefined ? 0 : a.maxMovePoints;
    if (a.stance === 'forced') a.stance = 'normal';
  }
  for (const f of Object.values(sim.s.fleets)) {
    if (f.faction !== fid) continue;
    const port = f.inPort !== undefined ? sim.s.provinces[f.inPort] : undefined;
    const harbor = port && port.owner === fid && port.settlement.buildings.some((b) => b.id === 'harbor');
    for (const s of f.ships) {
      if (harbor) {
        s.hull = Math.min(s.maxHull, s.hull + s.maxHull * 0.25);
        s.crew = Math.min(s.maxCrew, s.crew + Math.ceil(s.maxCrew * 0.2));
      } else if (sim.s.weather.regions['sea'] === 'storm' && sim.rng.chance(0.12)) {
        s.hull = Math.max(1, s.hull - s.maxHull * 0.15);
      }
    }
    f.maxMovePoints = fleetMaxMP(sim, f);
    f.movePoints = f.maxMovePoints;
  }
}

export function settlementCellOf(sim: Sim, pid: number) {
  const pg = sim.geo.provinces[pid];
  return cellOf(sim.geo, pg.x, pg.z);
}
