import { unitDef } from '../data/units';
import type { Sim } from './context';
import { atWar, isAllied } from './diplomacy';
import { canAssault, isSettlementEmpty, startSiege, transferProvince, sackSettlement } from './conquest';
import { makeFieldBattle, makeNavalBattle, makeSettlementBattle, type BattleSetup } from './battles';
import { advanceArmy, advanceFleet, canDisembark, cellDist, disembark, embark, findArmyPath, findFleetPath, landCellsNear, waterCellsNear, type MoveOutcome } from './movement';
import { armyInSettlement, assignGeneral, createArmy, destroyArmy, MAX_ARMY_UNITS, armyMaxMP } from './military';
import { cellX, cellZ, isWaterCell, NavT } from './world/geo';
import type { ArmyState, FleetState } from './types';

export type OrderTarget = { kind: 'cell'; cell: number } | { kind: 'army'; id: number } | { kind: 'settlement'; pid: number } | { kind: 'fleet'; id: number };

export interface OrderResult {
  ok: boolean;
  message?: string;
  moved?: MoveOutcome;
  battle?: BattleSetup;
  siege?: number;
  capture?: { province: number; army: number };
  embarked?: number;
  disembarked?: boolean;
  merged?: boolean;
}

const ADJ = 2.3; // cells considered in contact

function settlementCell(sim: Sim, pid: number) {
  return sim.geo.provinces[pid].cell;
}

export function armyAtSettlement(sim: Sim, army: ArmyState, pid: number) {
  const pg = sim.geo.provinces[pid];
  return Math.hypot(army.x - pg.x, army.z - pg.z) <= pg.radius + 20;
}

export function issueArmyOrder(sim: Sim, army: ArmyState, target: OrderTarget): OrderResult {
  if (army.embarked !== undefined) return { ok: false, message: 'The army is aboard ships. Select the fleet to sail or land it.' };
  const g = sim.geo;
  if (target.kind === 'cell') {
    if (isWaterCell(g, target.cell)) {
      const fl = Object.values(sim.s.fleets).find((f) => f.faction === army.faction && cellDist(sim, f.cell, target.cell) <= 2);
      if (fl) return issueArmyOrder(sim, army, { kind: 'fleet', id: fl.id });
      return { ok: false, message: 'Armies cannot march into the sea. Move a fleet to the shore and embark.' };
    }
    const own = Object.values(sim.s.armies).find((a) => a.cell === target.cell && a.id !== army.id && a.embarked === undefined);
    if (own) return issueArmyOrder(sim, army, { kind: 'army', id: own.id });
    const pr = findArmyPath(sim, army, target.cell);
    if (!pr.path.length) return { ok: false, message: pr.reason };
    army.path = pr.path.slice(1);
    const moved = advanceArmy(sim, army);
    return { ok: true, moved, message: moved.stop === 'zoc' ? 'Halted: enemy forces nearby.' : moved.stop === 'mp' ? 'The march will continue next season.' : undefined };
  }
  if (target.kind === 'army') {
    const other = sim.s.armies[target.id];
    if (!other || other.embarked !== undefined) return { ok: false, message: 'That army is not reachable.' };
    if (other.faction === army.faction) {
      // move adjacent and merge
      if (cellDist(sim, army.cell, other.cell) > ADJ) {
        const pr = findArmyPath(sim, army, other.cell);
        if (!pr.path.length) return { ok: false, message: pr.reason };
        army.path = pr.path.slice(1, -1);
        const moved = advanceArmy(sim, army);
        if (cellDist(sim, army.cell, other.cell) > ADJ) return { ok: true, moved, message: 'The armies will join when they meet.' };
        const ok = mergeArmies(sim, other, army);
        return { ok: true, moved, merged: ok };
      }
      return { ok: true, merged: mergeArmies(sim, other, army) };
    }
    if (!atWar(sim, army.faction, other.faction)) return { ok: false, message: `You are not at war with ${sim.houseName(other.faction)}. Declare war first from the Diplomacy screen.` };
    let moved: MoveOutcome | undefined;
    if (cellDist(sim, army.cell, other.cell) > ADJ) {
      const pr = findArmyPath(sim, army, other.cell);
      if (!pr.path.length) return { ok: false, message: pr.reason };
      army.path = pr.path.slice(1, -1);
      moved = advanceArmy(sim, army);
      if (cellDist(sim, army.cell, other.cell) > ADJ) return { ok: true, moved, message: 'Not enough movement to reach the enemy this season.' };
    }
    if (army.movePoints <= 0 && moved === undefined) return { ok: false, message: 'This army has no movement left this season.' };
    // defender inside its settlement?
    const pid = g.province[other.cell];
    if (pid >= 0 && sim.s.provinces[pid].owner === other.faction && armyAtSettlement(sim, other, pid) && sim.s.provinces[pid].settlement.walls > 0) {
      return issueArmyOrder(sim, army, { kind: 'settlement', pid });
    }
    army.movePoints = 0;
    return { ok: true, moved, battle: makeFieldBattle(sim, army, other) };
  }
  if (target.kind === 'settlement') {
    const pid = target.pid;
    const p = sim.s.provinces[pid];
    const cell = settlementCell(sim, pid);
    if (p.owner === army.faction || isAllied(sim, p.owner, army.faction)) {
      const pr = findArmyPath(sim, army, cell);
      if (!pr.path.length) return { ok: false, message: pr.reason };
      army.path = pr.path.slice(1);
      return { ok: true, moved: advanceArmy(sim, army) };
    }
    if (!atWar(sim, army.faction, p.owner)) return { ok: false, message: `${p.settlement.name} belongs to ${sim.houseName(p.owner)}. You are not at war with them.` };
    let moved: MoveOutcome | undefined;
    if (cellDist(sim, army.cell, cell) > ADJ + 2) {
      const pr = findArmyPath(sim, army, cell);
      if (!pr.path.length) return { ok: false, message: pr.reason };
      army.path = pr.path.slice(1, -2);
      moved = advanceArmy(sim, army);
      if (cellDist(sim, army.cell, cell) > ADJ + 2) return { ok: true, moved, message: 'Not enough movement to reach the walls this season.' };
    }
    // at the settlement
    if (isSettlementEmpty(sim, pid)) {
      army.movePoints = 0;
      if (army.faction === sim.s.player) return { ok: true, moved, capture: { province: pid, army: army.id } };
      captureWith(sim, army, pid, 'occupy');
      return { ok: true, moved };
    }
    if (p.settlement.walls > 0) {
      if (p.siege?.armyId === army.id) {
        if (canAssault(sim, army, p)) return { ok: true, moved, battle: makeSettlementBattle(sim, army, pid) };
        return { ok: false, moved, message: 'Siege equipment is still being built. Wait a season, or bring rams and engines.' };
      }
      if (p.siege && p.siege.armyId !== army.id) {
        // join as reinforcement: assault if possible
        return { ok: true, moved, battle: makeSettlementBattle(sim, army, pid) };
      }
      startSiege(sim, army, pid);
      return { ok: true, moved, siege: pid };
    }
    army.movePoints = 0;
    return { ok: true, moved, battle: makeSettlementBattle(sim, army, pid) };
  }
  if (target.kind === 'fleet') {
    const fl = sim.s.fleets[target.id];
    if (!fl) return { ok: false, message: 'No such fleet.' };
    if (fl.faction !== army.faction) return { ok: false, message: 'Armies cannot attack ships at sea.' };
    if (cellDist(sim, army.cell, fl.cell) > 2.9) {
      const shore = landCellsNear(sim, fl.cell, 2).filter((c) => g.landmass[c] === g.landmass[army.cell]);
      if (!shore.length) return { ok: false, message: 'The fleet is not near a reachable shore.' };
      shore.sort((a, b) => cellDist(sim, a, army.cell) - cellDist(sim, b, army.cell));
      const pr = findArmyPath(sim, army, shore[0]);
      if (!pr.path.length) return { ok: false, message: pr.reason };
      army.path = pr.path.slice(1);
      const moved = advanceArmy(sim, army);
      if (cellDist(sim, army.cell, fl.cell) > 2.9) return { ok: true, moved, message: 'The army marches toward the fleet.' };
      const err = embark(sim, army, fl);
      return err ? { ok: false, moved, message: err } : { ok: true, moved, embarked: fl.id };
    }
    const err = embark(sim, army, fl);
    return err ? { ok: false, message: err } : { ok: true, embarked: fl.id };
  }
  return { ok: false };
}

export function issueFleetOrder(sim: Sim, fleet: FleetState, target: OrderTarget): OrderResult {
  const g = sim.geo;
  if (target.kind === 'cell') {
    if (!isWaterCell(g, target.cell)) {
      if (!fleet.carrying.length) return { ok: false, message: 'Ships cannot sail onto land.' };
      if (g.nav[target.cell] === NavT.Impassable) return { ok: false, message: 'The cliffs there are impassable.' };
      // sail next to the shore and land the army
      if (cellDist(sim, fleet.cell, target.cell) > 2.9) {
        const waters = waterCellsNear(sim, target.cell, 2);
        if (!waters.length) return { ok: false, message: 'No landing place there.' };
        waters.sort((a, b) => cellDist(sim, a, fleet.cell) - cellDist(sim, b, fleet.cell));
        const pr = findFleetPath(sim, fleet, waters[0]);
        if (!pr.path.length) return { ok: false, message: pr.reason };
        fleet.path = pr.path.slice(1);
        const moved = advanceFleet(sim, fleet);
        if (cellDist(sim, fleet.cell, target.cell) > 2.9) return { ok: true, moved, message: 'The fleet sails for the landing.' };
        const err = disembark(sim, fleet, target.cell);
        return err ? { ok: false, moved, message: err } : { ok: true, moved, disembarked: true };
      }
      const err = canDisembark(sim, fleet, target.cell) ?? disembark(sim, fleet, target.cell);
      return err ? { ok: false, message: err } : { ok: true, disembarked: true };
    }
    const hostile = Object.values(sim.s.fleets).find((f) => f.cell === target.cell && f.id !== fleet.id);
    if (hostile) return issueFleetOrder(sim, fleet, { kind: 'fleet', id: hostile.id });
    const pr = findFleetPath(sim, fleet, target.cell);
    if (!pr.path.length) return { ok: false, message: pr.reason };
    fleet.path = pr.path.slice(1);
    fleet.order = 'move';
    return { ok: true, moved: advanceFleet(sim, fleet) };
  }
  if (target.kind === 'fleet') {
    const other = sim.s.fleets[target.id];
    if (!other) return { ok: false };
    if (other.faction === fleet.faction) {
      if (cellDist(sim, fleet.cell, other.cell) > 2.5) {
        const pr = findFleetPath(sim, fleet, other.cell);
        if (!pr.path.length) return { ok: false, message: pr.reason };
        fleet.path = pr.path.slice(1, -1);
        const moved = advanceFleet(sim, fleet);
        if (cellDist(sim, fleet.cell, other.cell) > 2.5) return { ok: true, moved };
        mergeFleets(sim, other, fleet);
        return { ok: true, moved, merged: true };
      }
      mergeFleets(sim, other, fleet);
      return { ok: true, merged: true };
    }
    if (!atWar(sim, fleet.faction, other.faction)) return { ok: false, message: `You are not at war with ${sim.houseName(other.faction)}.` };
    let moved: MoveOutcome | undefined;
    if (cellDist(sim, fleet.cell, other.cell) > ADJ) {
      const pr = findFleetPath(sim, fleet, other.cell);
      if (!pr.path.length) return { ok: false, message: pr.reason };
      fleet.path = pr.path.slice(1, -1);
      moved = advanceFleet(sim, fleet);
      if (cellDist(sim, fleet.cell, other.cell) > ADJ) return { ok: true, moved, message: 'The enemy is beyond reach this season.' };
    }
    fleet.movePoints = 0;
    return { ok: true, moved, battle: makeNavalBattle(sim, fleet, other) };
  }
  if (target.kind === 'settlement') {
    const pg = g.provinces[target.pid];
    const p = sim.s.provinces[target.pid];
    if (!pg.port) {
      if (fleet.carrying.length) return issueFleetOrder(sim, fleet, { kind: 'cell', cell: pg.cell });
      return { ok: false, message: `${p.settlement.name} has no harbour.` };
    }
    const pr = findFleetPath(sim, fleet, pg.portCell);
    if (!pr.path.length) return { ok: false, message: pr.reason };
    fleet.path = pr.path.slice(1);
    const moved = advanceFleet(sim, fleet);
    if (atWar(sim, fleet.faction, p.owner)) {
      fleet.order = 'blockade';
      fleet.orderTarget = target.pid;
      return { ok: true, moved, message: cellDist(sim, fleet.cell, pg.portCell) <= 2.5 ? `${p.settlement.name} is blockaded.` : 'The fleet sails to blockade the port.' };
    }
    fleet.order = 'return';
    return { ok: true, moved };
  }
  if (target.kind === 'army') {
    const a = sim.s.armies[target.id];
    if (a && a.faction === fleet.faction && fleet.carrying.length === 0) {
      // come pick up the army
      const waters = waterCellsNear(sim, a.cell, 2);
      if (!waters.length) return { ok: false, message: 'That army is not on the coast.' };
      waters.sort((x, y) => cellDist(sim, x, fleet.cell) - cellDist(sim, y, fleet.cell));
      const pr = findFleetPath(sim, fleet, waters[0]);
      if (!pr.path.length) return { ok: false, message: pr.reason };
      fleet.path = pr.path.slice(1);
      return { ok: true, moved: advanceFleet(sim, fleet), message: 'The fleet sails to collect the army. Select the army and right-click the fleet to embark.' };
    }
    if (a) return issueFleetOrder(sim, fleet, { kind: 'cell', cell: a.cell });
  }
  return { ok: false };
}

export function mergeArmies(sim: Sim, into: ArmyState, from: ArmyState): boolean {
  if (into.faction !== from.faction) return false;
  const bodyguard = from.units.find((u) => u.type === 'bodyguard');
  const movable = from.units.filter((u) => u.type !== 'bodyguard');
  const space = MAX_ARMY_UNITS - into.units.length;
  if (space <= 0) return false;
  const moving = movable.slice(0, space);
  into.units.push(...moving);
  from.units = from.units.filter((u) => !moving.includes(u));
  if (!into.general && from.general !== undefined) {
    const gid = from.general;
    from.units = from.units.filter((u) => u !== bodyguard);
    const c = sim.char(gid);
    if (c) c.armyId = undefined;
    from.general = undefined;
    assignGeneral(sim, into, gid);
  }
  into.movePoints = Math.min(into.movePoints, from.movePoints);
  if (!from.units.length || (from.units.length === 1 && from.units[0].type === 'bodyguard' && !from.general)) destroyArmy(sim, from, 'merged');
  into.maxMovePoints = armyMaxMP(sim, into);
  return true;
}

export function mergeFleets(sim: Sim, into: FleetState, from: FleetState) {
  const space = 12 - into.ships.length;
  const moving = from.ships.slice(0, space);
  into.ships.push(...moving);
  from.ships = from.ships.filter((s) => !moving.includes(s));
  into.carrying.push(...from.carrying.filter(() => !from.ships.length));
  if (!from.ships.length) {
    for (const aid of from.carrying) {
      const a = sim.s.armies[aid];
      if (a) a.embarked = into.id;
    }
    from.carrying = [];
    const adm = sim.char(from.admiral);
    if (adm) adm.fleetId = undefined;
    delete sim.s.fleets[from.id];
    sim.emit({ type: 'FLEET_DESTROYED', fleet: from.id, faction: from.faction, reason: 'merged' });
  }
  into.movePoints = Math.min(into.movePoints, from.movePoints);
}

export function splitArmy(sim: Sim, army: ArmyState, uids: number[]): ArmyState | string {
  const units = army.units.filter((u) => uids.includes(u.uid) && u.type !== 'bodyguard');
  if (!units.length) return 'Select units to detach.';
  if (units.length === army.units.length) return 'Cannot detach every unit.';
  const g = sim.geo;
  // find a free adjacent cell
  let cell = -1;
  for (const c of landCellsNear(sim, army.cell, 2)) {
    if (c !== army.cell && !Object.values(sim.s.armies).some((a) => a.cell === c) && g.landmass[c] === g.landmass[army.cell]) {
      cell = c;
      break;
    }
  }
  if (cell < 0) return 'No room to form a new army here.';
  army.units = army.units.filter((u) => !units.includes(u));
  const na = createArmy(sim, army.faction, cell, units);
  na.movePoints = Math.min(army.movePoints, na.maxMovePoints);
  na.supply = army.supply;
  na.morale = army.morale;
  sim.emit({ type: 'ARMY_MOVED', army: na.id, cells: [army.cell, cell] });
  return na;
}

export function disbandUnit(sim: Sim, army: ArmyState, uid: number) {
  const u = army.units.find((x) => x.uid === uid);
  if (!u || u.type === 'bodyguard') return;
  army.units = army.units.filter((x) => x !== u);
  const pid = sim.geo.province[army.cell];
  if (pid >= 0 && sim.s.provinces[pid].owner === army.faction) sim.s.provinces[pid].population += Math.round(u.troops * 0.8);
  if (!army.units.length || (army.units.every((x) => x.type === 'bodyguard') && !army.general)) destroyArmy(sim, army, 'disbanded');
}

export function disbandArmy(sim: Sim, army: ArmyState) {
  const pid = sim.geo.province[army.cell];
  if (pid >= 0 && sim.s.provinces[pid].owner === army.faction) sim.s.provinces[pid].population += Math.round(army.units.reduce((s, u) => s + u.troops, 0) * 0.8);
  destroyArmy(sim, army, 'disbanded');
}

export function captureWith(sim: Sim, army: ArmyState, pid: number, mode: 'occupy' | 'sack'): string {
  const pg = sim.geo.provinces[pid];
  const p = sim.s.provinces[pid];
  const name = p.settlement.name;
  if (p.owner === army.faction) return '';
  const def = armyInSettlement(sim, pid);
  if (def) return 'Defenders remain.';
  transferProvince(sim, pid, army.faction, 'conquest');
  let text = `${name} is occupied.`;
  if (mode === 'sack') {
    const loot = sackSettlement(sim, pid, army.faction);
    text = `${name} is sacked. Your soldiers carry off ${loot} gold.`;
  }
  army.x = pg.x;
  army.z = pg.z;
  army.cell = pg.cell;
  army.siegeOf = undefined;
  army.stance = 'normal';
  army.path = [];
  army.movePoints = 0;
  sim.emit({ type: 'ARMY_MOVED', army: army.id, cells: [army.cell] });
  return text;
}

export function setArmyStance(sim: Sim, army: ArmyState, stance: ArmyState['stance']) {
  if (stance === 'forced' && army.stance !== 'forced') {
    army.movePoints += army.maxMovePoints * 0.4;
    army.morale = Math.max(10, army.morale - 10);
  }
  army.stance = stance;
}

export function assaultSettlement(sim: Sim, army: ArmyState): OrderResult {
  if (army.siegeOf === undefined) return { ok: false, message: 'Not besieging.' };
  const p = sim.s.provinces[army.siegeOf];
  if (!canAssault(sim, army, p)) return { ok: false, message: 'You need siege equipment. It will be ready next season.' };
  return { ok: true, battle: makeSettlementBattle(sim, army, army.siegeOf) };
}

export function unitsSummary(army: ArmyState) {
  const cats: Record<string, number> = {};
  for (const u of army.units) {
    const c = unitDef(u.type).category;
    cats[c] = (cats[c] ?? 0) + u.troops;
  }
  return cats;
}

export function armyCellCenter(sim: Sim, c: number) {
  return { x: cellX(sim.geo, c), z: cellZ(sim.geo, c) };
}
