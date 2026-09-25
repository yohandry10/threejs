import { factionDef } from '../data/factions';
import { SHIPS, UNITS, shipDef, unitDef, type UnitDef } from '../data/units';
import { CULTURES } from '../data/names';
import { skillOf, fullName, detachFromPosts, killCharacter } from './characters';
import type { Sim } from './context';
import { cellOf, cellX, cellZ, type WorldGeo } from './world/geo';
import type { ArmyState, Character, FactionId, FleetState, ProvinceState, ShipState, UnitState } from './types';

export const MAX_ARMY_UNITS = 16;
export const MAX_FLEET_SHIPS = 12;
export const ARMY_BASE_MP = 30;

export function newUnit(sim: Sim, type: string, frac = 1, xp = 0): UnitState {
  const d = unitDef(type);
  const troops = Math.max(1, Math.round(d.troops * frac));
  return { uid: sim.s.ids.unit++, type, troops, maxTroops: d.troops, xp };
}

export function newShip(sim: Sim, faction: FactionId, type: string): ShipState {
  const d = shipDef(type);
  const cult = CULTURES[factionDef(faction).culture] ?? CULTURES.west;
  const used = new Set(Object.values(sim.s.fleets).flatMap((f) => f.ships.map((s) => s.name)));
  let name = sim.rng.pick(cult.ships);
  if (used.has(name)) name = `${name} ${['II', 'III', 'IV', 'V', 'VI'][sim.rng.int(0, 4)]}`;
  return { uid: sim.s.ids.unit++, type, hull: d.hull, maxHull: d.hull, crew: d.crew, maxCrew: d.crew, xp: 0, name };
}

/** Rough combat value of a unit, used by auto-resolve and AI planning. */
export function unitPower(u: UnitState, d: UnitDef = unitDef(u.type), mods?: { armor?: number; melee?: number; cav?: number; ranged?: number }): number {
  const armor = d.armor * (mods?.armor ?? 1);
  let per = d.attack * (mods?.melee ?? 1) * 0.9 + d.defense * 0.8 + armor * 0.55 + d.damage * 3 + d.charge * 0.35 + d.hp * 1.2;
  if (d.range) per += (d.missileDamage ?? 0) * (d.range / 100) * 2.2 * (mods?.ranged ?? 1);
  if (d.visual.mounted) per *= mods?.cav ?? 1;
  if (d.category === 'siege') per *= 0.5;
  const xpMul = 1 + Math.min(9, u.xp) * 0.04;
  return (per * u.troops * xpMul) / 100;
}

export function factionUnitMods(fid: FactionId) {
  const m = factionDef(fid).military;
  return { armor: m.armorMul ?? 1, melee: m.meleeMul ?? 1, cav: m.cavMul ?? 1, ranged: m.rangedMul ?? 1 };
}

export function armyPower(sim: Sim, a: ArmyState): number {
  const mods = factionUnitMods(a.faction);
  let p = 0;
  for (const u of a.units) p += unitPower(u, unitDef(u.type), mods);
  const gen = sim.char(a.general);
  p *= 1 + skillOf(gen, 'command') * 0.02;
  p *= 0.75 + (a.morale / 100) * 0.35;
  return p;
}

export function troopCount(units: UnitState[]) {
  return units.reduce((s, u) => s + u.troops, 0);
}

export function shipPower(s: ShipState): number {
  const d = shipDef(s.type);
  return (s.hull / d.hull) * (d.hull * 0.08 + s.crew * (0.3 + d.archers * 0.5) * d.boarding + d.ballista * 18);
}

export function fleetPower(sim: Sim, f: FleetState): number {
  let p = 0;
  for (const s of f.ships) p += shipPower(s);
  p *= 1 + skillOf(sim.char(f.admiral), 'command') * 0.02 + (factionDef(f.faction).military.navalMul ?? 1) - 1;
  return p;
}

export function fleetCapacity(f: FleetState): number {
  return f.ships.reduce((s, sh) => s + shipDef(sh.type).capacity * (sh.hull > 0 ? 1 : 0), 0);
}

export function fleetMaxMP(sim: Sim, f: FleetState): number {
  if (!f.ships.length) return 0;
  let mp = Math.min(...f.ships.map((s) => shipDef(s.type).moveCells));
  const adm = sim.char(f.admiral) ?? sim.char(sim.fac(f.faction)?.council.admiral);
  mp *= 1 + skillOf(adm, 'command') * 0.012;
  return Math.round(mp);
}

export function armyMaxMP(sim: Sim, a: ArmyState): number {
  const allCav = a.units.length > 0 && a.units.every((u) => unitDef(u.type).visual.mounted);
  const hasSiege = a.units.some((u) => unitDef(u.type).category === 'siege');
  let mp = ARMY_BASE_MP * (allCav ? 1.3 : 1) * (hasSiege ? 0.85 : 1);
  const gen = sim.char(a.general);
  if (gen) mp *= 1 + skillOf(gen, 'command') * 0.008;
  const marshal = sim.char(sim.fac(a.faction)?.council.marshal);
  if (marshal) mp *= 1 + skillOf(marshal, 'command') * 0.005;
  if (a.stance === 'forced') mp *= 1.4;
  if (a.supply < 30) mp *= 0.85;
  return Math.round(mp);
}

export function armyName(sim: Sim, fid: FactionId, gen?: Character): string {
  if (gen) return `Host of ${fullName(gen)}`;
  const n = Object.values(sim.s.armies).filter((a) => a.faction === fid).length + 1;
  const ord = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
  return `${ord[(n - 1) % ord.length]} Company of ${factionDef(fid).short}`;
}

export function createArmy(sim: Sim, fid: FactionId, cell: number, units: UnitState[], generalId?: number): ArmyState {
  const geo = sim.geo;
  const id = sim.s.ids.army++;
  const a: ArmyState = {
    id,
    faction: fid,
    name: '',
    units: [],
    x: cellX(geo, cell),
    z: cellZ(geo, cell),
    cell,
    path: [],
    movePoints: 0,
    maxMovePoints: ARMY_BASE_MP,
    stance: 'normal',
    supply: 100,
    morale: 75,
  };
  sim.s.armies[id] = a;
  a.units = units;
  if (generalId !== undefined) assignGeneral(sim, a, generalId);
  a.name = armyName(sim, fid, sim.char(a.general));
  a.maxMovePoints = armyMaxMP(sim, a);
  a.movePoints = a.maxMovePoints;
  sim.emit({ type: 'ARMY_CREATED', army: id, faction: fid });
  return a;
}

export function assignGeneral(sim: Sim, a: ArmyState, charId: number) {
  const c = sim.char(charId);
  if (!c || !c.alive) return;
  detachFromPosts(sim, c);
  if (a.general !== undefined) {
    const old = sim.char(a.general);
    if (old) {
      old.armyId = undefined;
      if (old.role === 'general') old.role = old.dynasty === a.faction ? 'family' : 'courtier';
    }
    a.units = a.units.filter((u) => u.type !== 'bodyguard');
  }
  a.general = c.id;
  c.armyId = a.id;
  if (c.role !== 'ruler' && c.role !== 'heir' && c.role !== 'consort') c.role = 'general';
  a.units.unshift(newUnit(sim, 'bodyguard', 1, Math.min(9, Math.floor(c.xp / 60))));
  if (a.units.length > MAX_ARMY_UNITS) a.units.length = MAX_ARMY_UNITS;
  a.name = armyName(sim, a.faction, c);
}

export function createFleet(sim: Sim, fid: FactionId, cell: number, ships: ShipState[], admiral?: number): FleetState {
  const id = sim.s.ids.fleet++;
  const f: FleetState = {
    id,
    faction: fid,
    name: `${factionDef(fid).short} Fleet ${Object.values(sim.s.fleets).filter((x) => x.faction === fid).length + 1}`,
    ships,
    x: cellX(sim.geo, cell),
    z: cellZ(sim.geo, cell),
    cell,
    path: [],
    movePoints: 0,
    maxMovePoints: 30,
    order: 'idle',
    carrying: [],
  };
  sim.s.fleets[id] = f;
  if (admiral !== undefined) {
    const c = sim.char(admiral);
    if (c) {
      detachFromPosts(sim, c);
      f.admiral = c.id;
      c.fleetId = id;
      if (c.role !== 'ruler' && c.role !== 'heir') c.role = 'admiral';
      f.name = `Fleet of ${fullName(c)}`;
    }
  }
  f.maxMovePoints = fleetMaxMP(sim, f);
  f.movePoints = f.maxMovePoints;
  return f;
}

export function destroyArmy(sim: Sim, a: ArmyState, reason: string) {
  const gen = sim.char(a.general);
  if (gen) {
    gen.armyId = undefined;
    if (gen.role === 'general') gen.role = gen.dynasty === a.faction ? 'family' : 'courtier';
  }
  if (a.embarked !== undefined) {
    const f = sim.s.fleets[a.embarked];
    if (f) f.carrying = f.carrying.filter((x) => x !== a.id);
  }
  for (const p of sim.s.provinces) if (p.siege?.armyId === a.id) p.siege = undefined;
  delete sim.s.armies[a.id];
  sim.emit({ type: 'ARMY_DESTROYED', army: a.id, faction: a.faction, reason });
}

export function destroyFleet(sim: Sim, f: FleetState, reason: string) {
  const adm = sim.char(f.admiral);
  if (adm) {
    adm.fleetId = undefined;
    if (adm.role === 'admiral') adm.role = adm.dynasty === f.faction ? 'family' : 'courtier';
  }
  for (const aid of f.carrying) {
    const a = sim.s.armies[aid];
    if (a) {
      // armies aboard sunk ships are lost at sea
      const gen = sim.char(a.general);
      if (gen && sim.rng.chance(0.6)) killCharacter(sim, gen, 'drowned at sea');
      destroyArmy(sim, a, 'lost at sea');
    }
  }
  delete sim.s.fleets[f.id];
  sim.emit({ type: 'FLEET_DESTROYED', fleet: f.id, faction: f.faction, reason });
}

/** Units that may be recruited in a settlement given its buildings. */
export function recruitableUnits(sim: Sim, p: ProvinceState): UnitDef[] {
  const b = new Map(p.settlement.buildings.map((x) => [x.id, x.level]));
  return UNITS.filter((u) => {
    if (u.id === 'bodyguard') return false;
    if (u.factions && !u.factions.includes(p.owner)) return false;
    return u.requires.every((r) => b.has(r));
  });
}

export function buildableShips(sim: Sim, p: ProvinceState) {
  if (!p.settlement.isPort) return [];
  const b = new Map(p.settlement.buildings.map((x) => [x.id, x.level]));
  return SHIPS.filter((s) => s.requires.every((r) => b.has(r)));
}

export function unitCost(sim: Sim, fid: FactionId, d: UnitDef): number {
  let c = d.cost * (factionDef(fid).military.recruitCostMul ?? 1);
  if (factionDef(fid).military.favoured.includes(d.id)) c *= 0.9;
  const marshal = sim.char(sim.fac(fid)?.council.marshal);
  c *= 1 - Math.min(0.15, skillOf(marshal, 'command') * 0.01);
  return Math.round(c);
}

export function armyUpkeep(a: ArmyState): { gold: number; food: number } {
  let gold = 0;
  let food = 0;
  for (const u of a.units) {
    const d = unitDef(u.type);
    const frac = u.troops / d.troops;
    gold += d.upkeep * 1.35 * (0.5 + 0.5 * frac);
    food += (d.foodUpkeep * u.troops) / 100;
  }
  return { gold, food };
}

export function fleetUpkeep(f: FleetState): number {
  return f.ships.reduce((s, sh) => s + shipDef(sh.type).upkeep * 1.2, 0);
}

/** Target garrison for a settlement (automatic, free). */
export function garrisonTemplate(sim: Sim, p: ProvinceState): string[] {
  const st = p.settlement;
  const out: string[] = [];
  const blds = new Map(st.buildings.map((b) => [b.id, b.level]));
  const militia = 1 + st.tier + (st.fortress ? 1 : 0);
  for (let i = 0; i < militia; i++) out.push('militia');
  if (blds.has('barracks') || st.walls >= 1) out.push('spearmen');
  if (st.walls >= 2 || blds.has('archery_range')) out.push('archers');
  if (st.walls >= 2) out.push('spearmen');
  if ((blds.get('towers') ?? 0) >= 1) out.push('crossbowmen');
  if (st.walls >= 3 || st.fortress) out.push('swordsmen', 'crossbowmen');
  const g = (blds.get('manor') ?? 0) >= 2 ? 1 : 0;
  if (g) out.push('swordsmen');
  if (st.tier >= 3) out.push('swordsmen', 'archers');
  return out.slice(0, 10);
}

export function refreshGarrison(sim: Sim, p: ProvinceState, full = false) {
  const tpl = garrisonTemplate(sim, p);
  const g = p.settlement.garrison;
  // match template
  const counts = new Map<string, number>();
  for (const t of tpl) counts.set(t, (counts.get(t) ?? 0) + 1);
  const next: UnitState[] = [];
  for (const [t, n] of counts) {
    const have = g.filter((u) => u.type === t);
    for (let i = 0; i < n; i++) {
      const u = have[i] ?? newUnit(sim, t, full ? 1 : 0.25);
      if (!have[i]) u.troops = Math.max(1, Math.round(u.maxTroops * (full ? 1 : 0.25)));
      else if (!p.siege) u.troops = Math.min(u.maxTroops, Math.round(u.troops + u.maxTroops * (full ? 1 : 0.25)));
      next.push(u);
    }
  }
  p.settlement.garrison = next;
}

export function armiesAt(sim: Sim, x: number, z: number, radius: number, pred?: (a: ArmyState) => boolean): ArmyState[] {
  const r2 = radius * radius;
  return Object.values(sim.s.armies).filter((a) => a.embarked === undefined && (a.x - x) ** 2 + (a.z - z) ** 2 <= r2 && (!pred || pred(a)));
}

/** Army currently occupying the settlement of a province (defending it). */
export function armyInSettlement(sim: Sim, pid: number): ArmyState | undefined {
  const pg = sim.geo.provinces[pid];
  const owner = sim.s.provinces[pid].owner;
  return armiesAt(sim, pg.x, pg.z, pg.radius + 10, (a) => a.faction === owner)[0];
}

export function provinceAt(geo: WorldGeo, x: number, z: number): number {
  return geo.province[cellOf(geo, x, z)];
}

export function availableCommanders(sim: Sim, fid: FactionId): Character[] {
  return Object.values(sim.s.characters).filter(
    (c) => c.alive && c.faction === fid && c.armyId === undefined && c.fleetId === undefined && Math.floor((sim.s.turn - c.birthTurn) / 4) >= 16 && c.role !== 'consort' && (c.gender === 'm' || c.role === 'ruler' || c.role === 'heir' || c.traits.includes('brave') || c.traits.includes('strategist')),
  );
}
