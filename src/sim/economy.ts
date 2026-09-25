import { BUILDINGS, buildingDef, TIERS, type BuildingEffects } from '../data/buildings';
import { factionDef } from '../data/factions';
import { shipDef, unitDef } from '../data/units';
import { skillOf } from './characters';
import type { Sim } from './context';
import { armyInSettlement, armyUpkeep, buildableShips, createArmy, createFleet, fleetUpkeep, MAX_ARMY_UNITS, MAX_FLEET_SHIPS, newShip, newUnit, recruitableUnits, refreshGarrison, unitCost } from './military';
import { atWar, overlordOf } from './diplomacy';
import { seasonOf, type FactionId, type IncomeBreakdown, type ProvinceState } from './types';
import { cellOf } from './world/geo';

export const TAX_MULT = [0.65, 1, 1.35, 1.75];
export const TAX_ORDER = [10, 0, -12, -28];
export const TAX_NAMES = ['Low', 'Normal', 'High', 'Extortionate'];
const SEASON_FOOD = [1.0, 1.2, 1.35, 0.45];
const LUXURIES = ['silk', 'wine', 'amber', 'salt', 'furs', 'wool', 'horses'];

export function buildingEffects(p: ProvinceState): BuildingEffects[] {
  const out: BuildingEffects[] = [];
  for (const b of p.settlement.buildings) {
    const def = buildingDef(b.id);
    if (!def) continue;
    const lv = def.levels[Math.min(b.level, def.levels.length) - 1];
    if (!lv) continue;
    if (b.damaged) {
      // damaged buildings give half their benefit
      const half: BuildingEffects = {};
      for (const [k, v] of Object.entries(lv.effects)) (half as Record<string, unknown>)[k] = typeof v === 'number' ? v * 0.5 : v;
      out.push(half);
    } else out.push(lv.effects);
  }
  return out;
}

export function sumEffect(p: ProvinceState, key: keyof BuildingEffects): number {
  let s = 0;
  for (const e of buildingEffects(p)) {
    const v = e[key];
    if (typeof v === 'number') s += v;
  }
  return s;
}

export function hasBuilding(p: ProvinceState, id: string, level = 1) {
  return p.settlement.buildings.some((b) => b.id === id && b.level >= level);
}

export function tradeValue(sim: Sim, p: ProvinceState): number {
  const pg = sim.geo.provinces[p.id];
  const lux = pg.resources.filter((r) => LUXURIES.includes(r)).length;
  return (20 + p.settlement.tier * 15 + lux * 12) * (1 + sumEffect(p, 'trade'));
}

export interface OrderPart {
  label: string;
  value: number;
}

export function orderBreakdown(sim: Sim, p: ProvinceState): OrderPart[] {
  const f = sim.s.factions[p.owner];
  const parts: OrderPart[] = [];
  parts.push({ label: 'Base contentment', value: 22 });
  if (!f) return parts;
  parts.push({ label: `${TAX_NAMES[f.taxLevel]} taxes`, value: TAX_ORDER[f.taxLevel] });
  const b = sumEffect(p, 'order');
  if (b) parts.push({ label: 'Buildings', value: b });
  const g = p.settlement.garrison.reduce((s, u) => s + u.troops, 0);
  const army = armyInSettlement(sim, p.id);
  const troops = g + (army ? army.units.reduce((s, u) => s + u.troops, 0) : 0);
  parts.push({ label: 'Garrison', value: Math.min(14, Math.round(troops / 60)) });
  parts.push({ label: 'Ruler legitimacy', value: Math.round((f.legitimacy - 50) / 4) });
  parts.push({ label: 'Settlement size', value: -p.settlement.tier * 4 });
  if (p.conqueredTurn !== undefined) {
    const since = sim.s.turn - p.conqueredTurn;
    if (since < 16) parts.push({ label: 'Recently conquered', value: -Math.round(30 * (1 - since / 16)) });
  }
  if (p.previousOwners.some((o) => o.faction !== p.owner) && p.previousOwners[p.previousOwners.length - 1]?.untilTurn > sim.s.turn - 40) parts.push({ label: 'Loyal to former lords', value: -6 });
  if (f.starvingTurns > 0) parts.push({ label: 'Famine', value: -20 });
  if (f.debtTurns > 0) parts.push({ label: 'Unpaid soldiers and officials', value: -10 });
  if (p.siege) parts.push({ label: 'Under siege', value: -15 });
  if (p.sacked !== undefined && sim.s.turn - p.sacked < 8) parts.push({ label: 'Sacked', value: -20 });
  const gov = sim.char(p.governor);
  if (gov) parts.push({ label: 'Governor', value: Math.round(skillOf(gov, 'stewardship') / 2) });
  const ruler = sim.char(f.ruler);
  if (ruler?.traits.includes('cruel')) parts.push({ label: 'Cruel ruler', value: -5 });
  if (ruler?.traits.includes('just')) parts.push({ label: 'Just ruler', value: 5 });
  if (ruler?.traits.includes('pious')) parts.push({ label: 'Devout ruler', value: 3 });
  const tmp = (p as ProvinceState & { eventOrder?: number }).eventOrder;
  if (tmp) parts.push({ label: 'Recent events', value: tmp });
  return parts;
}

export interface ProvinceYield {
  tax: number;
  buildingGold: number;
  food: number;
  foodUse: number;
  timber: number;
  stone: number;
  iron: number;
  growth: number;
  order: number;
}

export function provinceYield(sim: Sim, p: ProvinceState): ProvinceYield {
  const f = sim.s.factions[p.owner];
  const def = factionDef(p.owner);
  const pg = sim.geo.provinces[p.id];
  const steward = sim.char(f?.council.steward);
  const stewardMul = 1 + skillOf(steward, 'stewardship') * 0.015;
  const order = orderBreakdown(sim, p).reduce((s, x) => s + x.value, 0);
  const orderMul = 0.55 + 0.45 * Math.max(0, Math.min(1, (order + 40) / 80));
  const tax = f ? p.population * 0.0095 * (1 + p.development * 0.05) * TAX_MULT[f.taxLevel] * orderMul * def.econ.gold * stewardMul : 0;
  let buildingGold = ([8, 20, 40, 70][p.settlement.tier] ?? 10) + sumEffect(p, 'gold');
  const goldPct = sumEffect(p, 'goldPct');
  buildingGold = (buildingGold + tax * goldPct) * def.econ.gold;
  const season = seasonOf(sim.s.turn);
  const sm = SEASON_FOOD[season] * (pg.region === 'north' || pg.region === 'norhaven' ? (season === 3 ? 0.7 : 0.9) : 1);
  let food = (35 + pg.fertility * 115) * def.econ.food * sm;
  for (const e of buildingEffects(p)) if (e.food) food += e.food * (hasBuildingFish(e) ? 1 : sm);
  if (pg.resources.includes('fish')) food += 15;
  if (pg.resources.includes('grain')) food += 20 * sm;
  const foodUse = p.population / 85 + p.settlement.garrison.reduce((s, u) => s + (u.troops * unitDef(u.type).foodUpkeep) / 200, 0);
  const res = (r: string, v: number) => (pg.resources.includes(r) ? v : 0);
  const timber = (3 + res('timber', 14) + sumEffect(p, 'timber')) * def.econ.timber;
  const stone = (2 + res('stone', 10) + sumEffect(p, 'stone') * (pg.resources.includes('stone') ? 1 : 0.6)) * def.econ.stone;
  const iron = (res('iron', 8) + sumEffect(p, 'iron') * (pg.resources.includes('iron') ? 1 : 0.5)) * def.econ.iron;
  const growth = 0.006 + sumEffect(p, 'growth') + (order > 20 ? 0.003 : 0) - (order < -20 ? 0.006 : 0);
  let mul = 1;
  if (p.siege) mul = 0.4;
  if (p.blockaded) mul *= 0.75;
  return { tax: tax * mul, buildingGold: buildingGold * mul, food: food * (p.siege ? 0.3 : 1), foodUse, timber, stone, iron, growth, order };
}
function hasBuildingFish(e: BuildingEffects) {
  return !!e.gold && !!e.food && !e.growth;
}

export function computeTrade(sim: Sim) {
  const s = sim.s;
  const routes: typeof s.tradeRoutes = [];
  const ports = (fid: FactionId) => s.provinces.filter((p) => p.owner === fid && p.settlement.isPort);
  const facs = Object.keys(s.factions);
  const seen = new Set<string>();
  const addRoute = (a: ProvinceState, b: ProvinceState, sea: boolean, mul: number) => {
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const ga = sim.geo.provinces[a.id];
    const gb = sim.geo.provinces[b.id];
    const d = Math.hypot(ga.x - gb.x, ga.z - gb.z);
    const distMul = Math.min(1.6, 0.7 + d / 3000);
    const value = (tradeValue(sim, a) + tradeValue(sim, b)) * 0.2 * distMul * mul;
    const active = !atWar(sim, a.owner, b.owner) && !a.blockaded && !b.blockaded && !a.siege && !b.siege;
    routes.push({ a: a.id, b: b.id, sea, value: Math.round(value), active, factionA: a.owner, factionB: b.owner });
  };
  for (const t of s.diplomacy.treaties) {
    if (t.type !== 'trade') continue;
    const pa = ports(t.a);
    const pb = ports(t.b);
    const pairs: [ProvinceState, ProvinceState, number][] = [];
    for (const a of pa) for (const b of pb) pairs.push([a, b, tradeValue(sim, a) + tradeValue(sim, b)]);
    pairs.sort((x, y) => y[2] - x[2]);
    const used = new Set<number>();
    let n = 0;
    for (const [a, b] of pairs) {
      if (n >= 2) break;
      if (used.has(a.id) || used.has(b.id)) continue;
      used.add(a.id);
      used.add(b.id);
      addRoute(a, b, true, 1);
      n++;
    }
    // overland routes across shared borders
    let land = 0;
    for (const p of s.provinces) {
      if (p.owner !== t.a || land >= 2) continue;
      for (const nb of sim.geo.provinces[p.id].neighbors) {
        const q = s.provinces[nb];
        if (q.owner === t.b && sim.geo.provinces[p.id].landmass === sim.geo.provinces[q.id].landmass) {
          addRoute(p, q, false, 0.6);
          land++;
          break;
        }
      }
    }
  }
  // domestic sea trade between a realm's own ports on different shores
  for (const fid of facs) {
    const pp = ports(fid);
    for (let i = 0; i < pp.length; i++)
      for (let j = i + 1; j < pp.length; j++) {
        const ga = sim.geo.provinces[pp[i].id];
        const gb = sim.geo.provinces[pp[j].id];
        if (ga.landmass !== gb.landmass) addRoute(pp[i], pp[j], true, 0.3);
      }
  }
  s.tradeRoutes = routes;
}

export function tradeIncome(sim: Sim, fid: FactionId): number {
  let t = 0;
  const def = factionDef(fid);
  for (const r of sim.s.tradeRoutes) {
    if (!r.active) continue;
    if (r.factionA === fid) t += r.value * (r.factionA === r.factionB ? 1 : 0.5);
    else if (r.factionB === fid) t += r.value * 0.5;
  }
  // merchant hulks in port
  for (const fl of Object.values(sim.s.fleets)) if (fl.faction === fid && fl.inPort !== undefined) t += fl.ships.filter((s) => shipDef(s.type).trade >= 1).length * 30;
  const steward = sim.char(sim.fac(fid)?.council.steward);
  return t * def.econ.trade * (1 + skillOf(steward, 'stewardship') * 0.01);
}

export function courtUpkeep(sim: Sim, fid: FactionId): number {
  let n = 0;
  for (const c of Object.values(sim.s.characters)) if (c.alive && c.faction === fid && c.role !== 'ruler') n++;
  let u = n * 4;
  const r = sim.char(sim.fac(fid)?.ruler);
  if (r?.traits.includes('generous')) u *= 1.4;
  return Math.round(u);
}

export function factionEconomy(sim: Sim, fid: FactionId): IncomeBreakdown {
  const out: IncomeBreakdown = { tax: 0, trade: 0, buildings: 0, tribute: 0, armyUpkeep: 0, fleetUpkeep: 0, courtUpkeep: 0, net: 0, food: 0, foodProduced: 0, foodConsumed: 0, timber: 0, stone: 0, iron: 0 };
  for (const p of sim.s.provinces) {
    if (p.owner !== fid) continue;
    const y = provinceYield(sim, p);
    out.tax += y.tax;
    out.buildings += y.buildingGold;
    out.foodProduced += y.food;
    out.foodConsumed += y.foodUse;
    out.timber += y.timber;
    out.stone += y.stone;
    out.iron += y.iron;
  }
  out.trade = tradeIncome(sim, fid);
  for (const a of Object.values(sim.s.armies)) {
    if (a.faction !== fid) continue;
    const u = armyUpkeep(a);
    out.armyUpkeep += u.gold;
    out.foodConsumed += u.food;
  }
  for (const f of Object.values(sim.s.fleets)) if (f.faction === fid) out.fleetUpkeep += fleetUpkeep(f);
  out.courtUpkeep = courtUpkeep(sim, fid);
  for (const t of sim.s.diplomacy.treaties) {
    if (t.type === 'tribute') {
      if (t.a === fid) out.tribute -= t.amount ?? 0;
      if (t.b === fid) out.tribute += t.amount ?? 0;
    }
  }
  // vassal dues: 15% of tax
  const lord = overlordOf(sim, fid);
  if (lord) out.tribute -= out.tax * 0.15;
  for (const t of sim.s.diplomacy.treaties) if (t.type === 'vassal' && t.a === fid) out.tribute += vassalDues(sim, t.b);
  // round
  for (const k of Object.keys(out) as (keyof IncomeBreakdown)[]) out[k] = Math.round(out[k] ?? 0);
  out.food = out.foodProduced - out.foodConsumed;
  // grain merchants cover shortfalls when the granaries run low (at a price)
  const f = sim.fac(fid);
  out.grainImports = 0;
  if (out.food < 0 && f && f.food + out.food < 150) {
    const need = Math.min(-out.food, 150 - (f.food + out.food));
    const coastal = sim.s.provinces.some((p) => p.owner === fid && p.settlement.isPort && !p.blockaded);
    const price = coastal ? 1.6 : 2.4;
    const affordable = Math.max(0, Math.min(need, (f.treasury + out.tax) / price));
    out.grainImports = Math.round(affordable * price);
    out.food += affordable;
  }
  out.net = Math.round(out.tax + out.trade + out.buildings + out.tribute - out.armyUpkeep - out.fleetUpkeep - out.courtUpkeep - out.grainImports);
  out.food = Math.round(out.food);
  return out;
}

function vassalDues(sim: Sim, vassal: FactionId) {
  let tax = 0;
  for (const p of sim.s.provinces) if (p.owner === vassal) tax += provinceYield(sim, p).tax;
  return tax * 0.15;
}

/** Apply one season of economy to a faction. */
export function processFactionEconomy(sim: Sim, fid: FactionId) {
  const f = sim.fac(fid);
  if (!f.alive || fid === 'rebels' || fid === 'pirates') return;
  const e = factionEconomy(sim, fid);
  f.lastIncome = e;
  f.treasury += e.net;
  f.food += e.food;
  f.timber += e.timber;
  f.stone += e.stone;
  f.iron += e.iron;
  const cap = 1500 + sim.provincesOf(fid).length * 300;
  f.food = Math.min(f.food, cap);
  f.timber = Math.min(f.timber, 3000);
  f.stone = Math.min(f.stone, 3000);
  f.iron = Math.min(f.iron, 2000);
  // debt
  if (f.treasury < 0) {
    f.debtTurns++;
    f.legitimacy = Math.max(0, f.legitimacy - 2);
    // unpaid troops desert
    for (const a of Object.values(sim.s.armies)) {
      if (a.faction !== fid) continue;
      a.morale = Math.max(10, a.morale - 12);
      for (const u of a.units) if (u.type !== 'bodyguard') u.troops = Math.max(1, Math.floor(u.troops * 0.93));
    }
    if (f.debtTurns === 1 || f.debtTurns % 3 === 0) sim.notify({ kind: 'danger', title: 'Treasury Crisis', text: 'The treasury is empty. Unpaid soldiers desert and lords grumble. Raise taxes, disband troops or make peace.' }, fid);
  } else f.debtTurns = 0;
  // famine
  if (f.food < 0) {
    f.starvingTurns++;
    f.food = 0;
    for (const p of sim.s.provinces) if (p.owner === fid) p.population = Math.round(p.population * 0.97);
    for (const a of Object.values(sim.s.armies)) {
      if (a.faction !== fid) continue;
      for (const u of a.units) u.troops = Math.max(1, Math.floor(u.troops * 0.94));
      a.morale = Math.max(10, a.morale - 8);
    }
    if (f.starvingTurns === 1 || f.starvingTurns % 3 === 0) sim.notify({ kind: 'danger', title: 'Famine', text: 'The granaries are empty. People starve and armies waste away. Build farms, conquer fertile lands or reduce your armies.' }, fid);
  } else f.starvingTurns = 0;
  f.prestige += Math.max(0, Math.round(f.treasury / 4000));
}

export function updateProvinces(sim: Sim) {
  for (const p of sim.s.provinces) {
    const f = sim.s.factions[p.owner];
    if (!f) continue;
    const y = provinceYield(sim, p);
    p.publicOrder = Math.max(-100, Math.min(100, Math.round(y.order)));
    p.food = Math.round(y.food - y.foodUse);
    p.taxValue = Math.round(y.tax);
    p.income = Math.round(y.tax + y.buildingGold);
    const cap = TIERS[p.settlement.tier].popCap * 1.1;
    let g = y.growth;
    if (f.starvingTurns > 0) g = -0.02;
    p.population = Math.max(400, Math.min(cap, Math.round(p.population * (1 + g))));
    if (p.development < 10 && sim.rng.chance(0.02 + sumEffect(p, 'trade') * 0.03)) p.development = Math.min(10, p.development + 0.5);
    const tmp = p as ProvinceState & { eventOrder?: number };
    if (tmp.eventOrder) tmp.eventOrder = Math.round(tmp.eventOrder * 0.7);
    if (!p.siege) refreshGarrison(sim, p, false);
    // damaged buildings repair slowly
    for (const b of p.settlement.buildings) if (b.damaged && sim.rng.chance(0.25)) b.damaged = false;
  }
}

// ------------------------------------------------------------------ construction

export interface BuildOption {
  id: string;
  name: string;
  level: number;
  cost: number;
  timber: number;
  stone: number;
  iron: number;
  turns: number;
  blocked?: string;
  desc: string;
  category: string;
  upgrade: boolean;
}

export function constructionDiscount(sim: Sim, fid: FactionId) {
  const steward = sim.char(sim.fac(fid)?.council.steward);
  return 1 - Math.min(0.2, skillOf(steward, 'stewardship') * 0.01);
}

export function buildOptions(sim: Sim, pid: number): BuildOption[] {
  const p = sim.s.provinces[pid];
  const st = p.settlement;
  const pg = sim.geo.provinces[pid];
  const f = sim.fac(p.owner);
  const disc = constructionDiscount(sim, p.owner);
  const out: BuildOption[] = [];
  const usedSlots = st.buildings.length + st.construction.filter((c) => c.building !== '__tier' && !st.buildings.some((b) => b.id === c.building)).length;
  const slots = TIERS[st.tier].slots;
  const inQueue = (id: string) => st.construction.some((c) => c.building === id);
  for (const def of BUILDINGS) {
    const existing = st.buildings.find((b) => b.id === def.id);
    const nextLevel = existing ? existing.level + 1 : 1;
    if (nextLevel > def.levels.length) continue;
    const lv = def.levels[nextLevel - 1];
    let blocked: string | undefined;
    if (def.requiresPort && !st.isPort) continue;
    if (def.requiresResource && !def.requiresResource.some((r) => pg.resources.includes(r))) continue;
    if (def.requiresBuilding && !st.buildings.some((b) => b.id === def.requiresBuilding)) blocked = `Requires ${buildingDef(def.requiresBuilding).levels[0].name}`;
    if ((lv.minTier ?? 0) > st.tier) blocked = `Requires a ${TIERS[lv.minTier ?? 0].name}`;
    if (!existing && usedSlots >= slots) blocked = blocked ?? 'No free building slots — grow the settlement';
    if (inQueue(def.id)) blocked = 'Already under construction';
    if (p.siege) blocked = 'Cannot build under siege';
    const cost = Math.round(lv.cost * disc);
    if (!blocked && f.treasury < cost) blocked = 'Not enough gold';
    if (!blocked && (f.timber < lv.timber || f.stone < lv.stone || f.iron < lv.iron)) blocked = 'Not enough materials';
    out.push({ id: def.id, name: lv.name, level: nextLevel, cost, timber: lv.timber, stone: lv.stone, iron: lv.iron, turns: Math.max(1, Math.round(lv.turns * (disc < 0.9 ? 0.85 : 1))), blocked, desc: def.desc, category: def.category, upgrade: !!existing });
  }
  // settlement growth
  if (st.tier < TIERS.length - 1) {
    const t = TIERS[st.tier + 1];
    let blocked: string | undefined;
    if (p.population < t.upgradePop) blocked = `Needs ${t.upgradePop.toLocaleString()} population`;
    if (inQueue('__tier')) blocked = 'Already growing';
    const cost = Math.round(t.upgradeCost * disc);
    if (!blocked && f.treasury < cost) blocked = 'Not enough gold';
    const stone = 60 + st.tier * 80;
    if (!blocked && f.stone < stone) blocked = 'Not enough stone';
    out.unshift({ id: '__tier', name: `Grow into a ${t.name}`, level: st.tier + 1, cost, timber: 80, stone, iron: 0, turns: t.turns, blocked, desc: `More building slots, higher population cap and larger garrison.`, category: 'settlement', upgrade: true });
  }
  return out;
}

export function startConstruction(sim: Sim, pid: number, id: string): string | null {
  const opt = buildOptions(sim, pid).find((o) => o.id === id);
  if (!opt) return 'Not available';
  if (opt.blocked) return opt.blocked;
  const p = sim.s.provinces[pid];
  const f = sim.fac(p.owner);
  f.treasury -= opt.cost;
  f.timber -= opt.timber;
  f.stone -= opt.stone;
  f.iron -= opt.iron;
  p.settlement.construction.push({ building: id, level: opt.level, turnsLeft: opt.turns, totalTurns: opt.turns });
  return null;
}

export function cancelConstruction(sim: Sim, pid: number, index: number) {
  const p = sim.s.provinces[pid];
  const job = p.settlement.construction[index];
  if (!job) return;
  p.settlement.construction.splice(index, 1);
  // 50% refund
  const f = sim.fac(p.owner);
  if (job.building === '__tier') f.treasury += Math.round(TIERS[job.level].upgradeCost * 0.5);
  else f.treasury += Math.round(buildingDef(job.building).levels[job.level - 1].cost * 0.5);
}

export function progressConstruction(sim: Sim, fid: FactionId) {
  for (const p of sim.s.provinces) {
    if (p.owner !== fid || p.siege) continue;
    const st = p.settlement;
    for (const job of st.construction) job.turnsLeft--;
    const done = st.construction.filter((j) => j.turnsLeft <= 0);
    st.construction = st.construction.filter((j) => j.turnsLeft > 0);
    for (const job of done) {
      let name: string;
      if (job.building === '__tier') {
        st.tier = Math.min(3, job.level);
        name = TIERS[st.tier].name;
        sim.fac(fid).prestige += 10;
      } else {
        const ex = st.buildings.find((b) => b.id === job.building);
        if (ex) {
          ex.level = job.level;
          ex.damaged = false;
        } else st.buildings.push({ id: job.building, level: job.level });
        const lv = buildingDef(job.building).levels[job.level - 1];
        name = lv.name;
        if (lv.effects.walls) {
          st.walls = lv.effects.walls;
        }
        if (lv.effects.gateHp) st.gateHp = gateHpFor(p);
        if (lv.effects.prestige) sim.fac(fid).prestige += lv.effects.prestige * 10;
        if (lv.effects.legitimacy) sim.fac(fid).legitimacy = Math.min(100, sim.fac(fid).legitimacy + lv.effects.legitimacy * 5);
      }
      sim.emit({ type: 'BUILDING_COMPLETED', province: p.id, building: job.building, level: job.level, faction: fid });
      const pg = sim.geo.provinces[p.id];
      sim.notify({ kind: 'construction', title: 'Construction Complete', text: `${name} completed in ${st.name}.`, focus: { x: pg.x, z: pg.z } }, fid);
    }
  }
}

export function gateHpFor(p: ProvinceState) {
  return Math.round(300 + sumEffect(p, 'gateHp'));
}

// ------------------------------------------------------------------ recruitment

export interface RecruitOption {
  type: string;
  name: string;
  cost: number;
  iron: number;
  timber: number;
  turns: number;
  troops: number;
  upkeep: number;
  blocked?: string;
  ship: boolean;
}

export function recruitOptions(sim: Sim, pid: number): RecruitOption[] {
  const p = sim.s.provinces[pid];
  const f = sim.fac(p.owner);
  const out: RecruitOption[] = [];
  const queued = p.settlement.recruitment.length;
  const cap = 2 + p.settlement.tier;
  const manpower = p.population - 800 - p.settlement.recruitment.reduce((s, r) => s + (r.ship ? 0 : unitDef(r.unitType).troops), 0);
  for (const d of recruitableUnits(sim, p)) {
    const cost = unitCost(sim, p.owner, d);
    let blocked: string | undefined;
    if (p.siege) blocked = 'Under siege';
    else if (queued >= cap) blocked = `Recruitment queue full (${cap})`;
    else if (manpower < d.troops) blocked = 'Not enough population';
    else if (f.treasury < cost) blocked = 'Not enough gold';
    else if (f.iron < d.iron) blocked = 'Not enough iron';
    out.push({ type: d.id, name: d.name, cost, iron: d.iron, timber: 0, turns: d.recruitTurns, troops: d.troops, upkeep: d.upkeep, blocked, ship: false });
  }
  for (const s of buildableShips(sim, p)) {
    let blocked: string | undefined;
    const cost = Math.round(s.cost * (hasBuilding(p, 'shipyard', 2) ? 0.9 : 1));
    if (p.siege || p.blockaded) blocked = p.blockaded ? 'Port is blockaded' : 'Under siege';
    else if (queued >= cap) blocked = `Recruitment queue full (${cap})`;
    else if (f.treasury < cost) blocked = 'Not enough gold';
    else if (f.timber < s.timber) blocked = 'Not enough timber';
    out.push({ type: s.id, name: s.name, cost, iron: 0, timber: s.timber, turns: s.recruitTurns, troops: s.crew, upkeep: s.upkeep, blocked, ship: true });
  }
  return out;
}

export function recruit(sim: Sim, pid: number, type: string): string | null {
  const opt = recruitOptions(sim, pid).find((o) => o.type === type);
  if (!opt) return 'Cannot recruit that here';
  if (opt.blocked) return opt.blocked;
  const p = sim.s.provinces[pid];
  const f = sim.fac(p.owner);
  f.treasury -= opt.cost;
  f.iron -= opt.iron;
  f.timber -= opt.timber;
  if (!opt.ship) p.population -= Math.round(opt.troops * 0.6);
  p.settlement.recruitment.push({ unitType: type, turnsLeft: opt.turns, ship: opt.ship });
  return null;
}

export function cancelRecruit(sim: Sim, pid: number, index: number) {
  const p = sim.s.provinces[pid];
  const job = p.settlement.recruitment[index];
  if (!job) return;
  p.settlement.recruitment.splice(index, 1);
  const f = sim.fac(p.owner);
  if (job.ship) {
    const d = shipDef(job.unitType);
    f.treasury += d.cost;
    f.timber += d.timber;
  } else {
    const d = unitDef(job.unitType);
    f.treasury += unitCost(sim, p.owner, d);
    f.iron += d.iron;
    p.population += Math.round(d.troops * 0.6);
  }
}

export function progressRecruitment(sim: Sim, fid: FactionId) {
  for (const p of sim.s.provinces) {
    if (p.owner !== fid || p.siege) continue;
    const st = p.settlement;
    for (const r of st.recruitment) r.turnsLeft--;
    const done = st.recruitment.filter((r) => r.turnsLeft <= 0);
    st.recruitment = st.recruitment.filter((r) => r.turnsLeft > 0);
    const pg = sim.geo.provinces[p.id];
    for (const r of done) {
      if (r.ship) {
        let fleet = Object.values(sim.s.fleets).find((fl) => fl.faction === fid && fl.cell === pg.portCell && fl.ships.length < MAX_FLEET_SHIPS);
        const ship = newShip(sim, fid, r.unitType);
        if (fleet) fleet.ships.push(ship);
        else {
          fleet = createFleet(sim, fid, pg.portCell, [ship]);
          fleet.inPort = p.id;
        }
        sim.emit({ type: 'UNIT_RECRUITED', province: p.id, unit: r.unitType, ship: true, faction: fid });
        sim.notify({ kind: 'military', title: 'Ship Launched', text: `The ${shipDef(r.unitType).name} "${ship.name}" has been launched at ${st.name}.`, focus: { x: pg.portX, z: pg.portZ } }, fid);
      } else {
        const d = unitDef(r.unitType);
        const xpBonus = sumEffect(p, 'xp');
        const unit = newUnit(sim, r.unitType, 1, xpBonus);
        let army = armyInSettlement(sim, p.id);
        if (!army || army.units.length >= MAX_ARMY_UNITS) {
          const r = sim.geo.navStep * 6;
          army = Object.values(sim.s.armies).find((a) => a.faction === fid && a.embarked === undefined && !a.isRebel && a.units.length < MAX_ARMY_UNITS && (a.x - pg.x) ** 2 + (a.z - pg.z) ** 2 < r * r);
        }
        if (army) army.units.push(unit);
        else army = createArmy(sim, fid, pg.cell, [unit]);
        sim.emit({ type: 'UNIT_RECRUITED', province: p.id, unit: r.unitType, army: army.id, faction: fid });
        sim.notify({ kind: 'military', title: 'Troops Mustered', text: `${d.name} have mustered at ${st.name}.`, focus: { x: pg.x, z: pg.z } }, fid);
      }
    }
  }
}

export function settlementCell(sim: Sim, pid: number) {
  const pg = sim.geo.provinces[pid];
  return cellOf(sim.geo, pg.x, pg.z);
}
