import { factionDef, FACTIONS, INDEPENDENT, PIRATES, REBELS } from '../data/factions';
import { buildingDef, TIERS } from '../data/buildings';
import { CULTURES } from '../data/names';
import { Sim } from './context';
import { createCharacter, updateHeir, skillOf, marry } from './characters';
import { addModifier, addTreaty, pairKey } from './diplomacy';
import { createArmy, createFleet, newShip, newUnit, refreshGarrison, assignGeneral } from './military';
import { computeTrade, gateHpFor, updateProvinces } from './economy';
import { generateObjectives } from './objectives';
import { rollWeather } from './weather';
import { initFog } from './fog';
import { COUNCIL_SEATS, type Character, type FactionState, type GameState, type ProvinceState } from './types';
import type { WorldGeo } from './world/geo';
import { EventBus } from '../core/eventBus';

export const SAVE_VERSION = 3;
export const START_YEAR = 1142;

const T = (years: number) => -Math.round(years * 4); // birth turn from age at turn 0

interface FamilySpec {
  ruler: { name: string; gender: 'm' | 'f'; age: number; traits: string[]; skills?: Partial<Character['skills']> };
  spouse?: { name: string; age: number; dynasty?: string; traits?: string[]; sisterOf?: string };
  children: { name: string; gender: 'm' | 'f'; age: number; traits?: string[] }[];
  siblings: { name: string; gender: 'm' | 'f'; age: number; traits?: string[]; married?: boolean }[];
  succession: FactionState['succession'];
}

const FAMILIES: Record<string, FamilySpec> = {
  aldmere: {
    ruler: { name: 'Edric', gender: 'm', age: 46, traits: ['just', 'brave'], skills: { command: 11, diplomacy: 9, stewardship: 10, intrigue: 5 } },
    spouse: { name: 'Carys', age: 41, dynasty: 'tamsin', traits: ['generous'], sisterOf: 'tamsin' },
    children: [
      { name: 'Aldous', gender: 'm', age: 20, traits: ['ambitious', 'brave'] },
      { name: 'Rowena', gender: 'f', age: 17, traits: ['diplomatic'] },
      { name: 'Tobin', gender: 'm', age: 11, traits: ['scholar'] },
    ],
    siblings: [{ name: 'Garrick', gender: 'm', age: 42, traits: ['strategist', 'loyal'], married: true }],
    succession: 'primogeniture',
  },
  orsenne: {
    ruler: { name: 'Amaury', gender: 'm', age: 52, traits: ['ambitious', 'cruel'], skills: { command: 13, diplomacy: 6, stewardship: 9, intrigue: 10 } },
    spouse: { name: 'Hedda', age: 45, dynasty: 'varrow', sisterOf: 'varrow' },
    children: [
      { name: 'Thibault', gender: 'm', age: 27, traits: ['brave', 'strategist'] },
      { name: 'Oriane', gender: 'f', age: 22, traits: ['deceitful'] },
      { name: 'Lucien', gender: 'm', age: 18, traits: ['ambitious'] },
    ],
    siblings: [{ name: 'Renaud', gender: 'm', age: 48, traits: ['veteran'], married: true }],
    succession: 'agnatic',
  },
  varrow: {
    ruler: { name: 'Konrad', gender: 'm', age: 58, traits: ['cautious', 'loyal'], skills: { command: 10, diplomacy: 8, stewardship: 12, intrigue: 6 } },
    spouse: { name: 'Adelheid', age: 55 },
    children: [
      { name: 'Ulric', gender: 'm', age: 31, traits: ['robust'] },
      { name: 'Ilse', gender: 'f', age: 26, traits: ['scholar'] },
    ],
    siblings: [],
    succession: 'primogeniture',
  },
  ostrevan: {
    ruler: { name: 'Hakon', gender: 'm', age: 39, traits: ['brave', 'ambitious', 'seafarer'], skills: { command: 14, diplomacy: 5, stewardship: 8, intrigue: 7 } },
    spouse: { name: 'Vesna', age: 33, dynasty: 'korr' },
    children: [
      { name: 'Eirik', gender: 'm', age: 13 },
      { name: 'Sigrid', gender: 'f', age: 9 },
    ],
    siblings: [
      { name: 'Ivar', gender: 'm', age: 35, traits: ['seafarer', 'cruel'], married: false },
      { name: 'Astrid', gender: 'f', age: 30, traits: ['brave'], married: false },
    ],
    succession: 'elective',
  },
  sabeline: {
    ruler: { name: 'Livia', gender: 'f', age: 47, traits: ['merchant', 'diplomatic'], skills: { command: 5, diplomacy: 14, stewardship: 15, intrigue: 11 } },
    spouse: { name: 'Aurelio', age: 50 },
    children: [
      { name: 'Cosimo', gender: 'm', age: 24, traits: ['merchant'] },
      { name: 'Bianca', gender: 'f', age: 19, traits: ['deceitful', 'diplomatic'] },
    ],
    siblings: [{ name: 'Dario', gender: 'm', age: 44, traits: ['cautious'], married: true }],
    succession: 'primogeniture',
  },
  dray: {
    ruler: { name: 'Ronan', gender: 'm', age: 36, traits: ['seafarer', 'deceitful'], skills: { command: 12, diplomacy: 8, stewardship: 9, intrigue: 12 } },
    spouse: { name: 'Nolwenn', age: 31 },
    children: [{ name: 'Maelys', gender: 'f', age: 8 }],
    siblings: [{ name: 'Erwan', gender: 'm', age: 32, traits: ['seafarer', 'loyal'], married: false }],
    succession: 'primogeniture',
  },
  korr: {
    ruler: { name: 'Borek', gender: 'm', age: 49, traits: ['robust', 'cruel'], skills: { command: 11, diplomacy: 6, stewardship: 11, intrigue: 8 } },
    spouse: { name: 'Mira', age: 44 },
    children: [
      { name: 'Radko', gender: 'm', age: 23, traits: ['brave'] },
      { name: 'Zora', gender: 'f', age: 17 },
    ],
    siblings: [{ name: 'Vesna', gender: 'f', age: 33, traits: [], married: true }],
    succession: 'primogeniture',
  },
  tamsin: {
    ruler: { name: 'Owain', gender: 'm', age: 64, traits: ['just', 'sickly', 'diplomatic'], skills: { command: 6, diplomacy: 13, stewardship: 11, intrigue: 4 } },
    children: [{ name: 'Seren', gender: 'f', age: 19, traits: ['diplomatic', 'just'] }],
    siblings: [{ name: 'Carys', gender: 'f', age: 41, traits: ['generous'], married: true }],
    succession: 'primogeniture',
  },
};

const ARMY_TEMPLATES: Record<string, { at: string; units: string[]; general: 'ruler' | 'heir' | 'sibling' | 'courtier' }[]> = {
  aldmere: [
    { at: 'Aldhaven', units: ['knights', 'spearmen', 'spearmen', 'swordsmen', 'longbowmen', 'longbowmen', 'militia'], general: 'sibling' },
    { at: 'Harrowgate', units: ['spearmen', 'archers', 'militia'], general: 'courtier' },
  ],
  orsenne: [
    { at: 'Valmont', units: ['heavy_cavalry', 'heavy_cavalry', 'light_cavalry', 'swordsmen', 'swordsmen', 'spearmen', 'crossbowmen', 'crossbowmen'], general: 'heir' },
    { at: 'Corvel', units: ['light_cavalry', 'swordsmen', 'spearmen', 'crossbowmen', 'militia'], general: 'sibling' },
  ],
  varrow: [{ at: 'Hollowcrest', units: ['heavy_infantry', 'heavy_infantry', 'spearmen', 'spearmen', 'crossbowmen', 'crossbowmen', 'light_cavalry'], general: 'heir' }],
  ostrevan: [{ at: 'Norhaven', units: ['axemen', 'axemen', 'swordsmen', 'archers', 'archers', 'spearmen'], general: 'sibling' }],
  sabeline: [
    { at: 'Ystra', units: ['pikemen', 'pikemen', 'crossbowmen', 'light_cavalry'], general: 'sibling' },
    { at: 'Lirien', units: ['crossbowmen', 'spearmen', 'militia'], general: 'courtier' },
  ],
  dray: [{ at: 'Skarholm', units: ['marines', 'marines', 'crossbowmen', 'spearmen'], general: 'courtier' }],
  korr: [{ at: 'Emberfell', units: ['heavy_infantry', 'swordsmen', 'crossbowmen', 'crossbowmen', 'spearmen'], general: 'heir' }],
  tamsin: [{ at: 'Greenholm', units: ['longbowmen', 'longbowmen', 'spearmen', 'militia'], general: 'courtier' }],
};

const FLEET_TEMPLATES: Record<string, { at: string; ships: string[]; admiral: 'ruler' | 'sibling' | 'courtier' }[]> = {
  aldmere: [{ at: 'Aldhaven', ships: ['galley', 'cog'], admiral: 'courtier' }],
  ostrevan: [
    { at: 'Norhaven', ships: ['carrack', 'galley', 'galley', 'galley', 'cog', 'cog'], admiral: 'ruler' },
    { at: 'Skelde', ships: ['galley', 'galley'], admiral: 'courtier' },
  ],
  sabeline: [{ at: 'Lirien', ships: ['carrack', 'galley', 'hulk', 'hulk'], admiral: 'courtier' }],
  dray: [{ at: 'Skarholm', ships: ['flagship', 'carrack', 'galley', 'galley'], admiral: 'sibling' }],
  korr: [{ at: 'Emberfell', ships: ['galley', 'galley', 'cog'], admiral: 'courtier' }],
  tamsin: [{ at: 'Greenholm', ships: ['galley', 'hulk'], admiral: 'courtier' }],
};

function emptyState(worldSeed: number, seed: number, player: string): GameState {
  return {
    version: SAVE_VERSION,
    worldSeed,
    campaignSeed: seed,
    rng: seed,
    turn: 0,
    startYear: START_YEAR,
    player,
    difficulty: 1,
    factions: {},
    characters: {},
    provinces: [],
    armies: {},
    fleets: {},
    diplomacy: { base: {}, modifiers: [], treaties: [], wars: [], truces: [], reputation: {}, nextWarId: 1 },
    tradeRoutes: [],
    intrigue: [],
    decisions: [],
    chronicle: [],
    notifications: [],
    weather: { regions: {} },
    ids: { char: 1, army: 1, fleet: 1, unit: 1, decision: 1, notif: 1, op: 1 },
    tutorial: { step: 0, done: false, enabled: true },
    stats: { battles: 0, sieges: 0, marriages: 0, successions: 0, wars: 0 },
  };
}

function initialBuildings(p: ProvinceState, kind: string, faction: string, resources: string[], fertility: number, isCapital: boolean) {
  const b: { id: string; level: number }[] = [];
  const add = (id: string, level = 1) => {
    if (!b.some((x) => x.id === id)) b.push({ id, level });
  };
  const tier = p.settlement.tier;
  if (resources.includes('grain') || fertility > 0.55) add('farm', tier >= 2 ? 2 : 1);
  if (p.settlement.isPort && (tier === 0 || resources.includes('fish'))) add('fishery');
  if (tier >= 1) add('barracks');
  if (tier >= 2) add('market');
  if (p.settlement.isPort && tier >= 1) add('harbor', isCapital && tier >= 2 ? 2 : 1);
  if ((resources.includes('iron') || resources.includes('stone')) && (tier >= 1 || kind === 'fortress')) add('mine');
  if (resources.includes('timber') && tier >= 1) add('lumber');
  if (kind === 'fortress') {
    add('walls', 2);
    add('towers', 1);
    add('gatehouse');
    add('barracks');
    add('archery_range');
  } else if (isCapital) {
    add('walls', tier >= 3 ? 3 : 2);
    add('towers', 1);
    add('manor', 2);
    add('archery_range');
    if (tier >= 2) add('council_hall');
  } else if (tier >= 2) add('walls', 2);
  else if (tier === 1) add('walls', 1);
  if (resources.includes('horses') && tier >= 1) add('stables');
  // faction flavour
  if (isCapital) {
    const fl: Record<string, string[]> = {
      aldmere: ['stables', 'armory'],
      orsenne: ['stables', 'armory', 'workshop'],
      varrow: ['armory', 'workshop'],
      ostrevan: ['shipyard'],
      sabeline: ['trade_docks', 'shipyard', 'workshop'],
      dray: ['shipyard'],
      korr: ['workshop', 'armory', 'shipyard'],
      tamsin: [],
    };
    for (const id of fl[faction] ?? []) {
      const def = buildingDef(id);
      if (def.requiresPort && !p.settlement.isPort) continue;
      add(id);
    }
  }
  const slots = TIERS[tier].slots;
  // walls and military don't count beyond capacity; trim economic extras if over
  while (b.length > slots) {
    const idx = b.findIndex((x) => ['lumber', 'fishery', 'mine', 'market'].includes(x.id));
    if (idx < 0) break;
    b.splice(idx, 1);
  }
  p.settlement.buildings = b;
  p.settlement.walls = b.find((x) => x.id === 'walls')?.level ?? 0;
}

export function newCampaign(geo: WorldGeo, player: string, seed: number, bus = new EventBus()): Sim {
  const s = emptyState(1337, seed, player);
  const sim = new Sim(s, geo, bus);
  const r = sim.rng;

  // factions
  for (const def of [...FACTIONS, INDEPENDENT, REBELS, PIRATES]) {
    s.factions[def.id] = {
      id: def.id,
      alive: def.id !== 'rebels' && def.id !== 'pirates',
      ruler: 0,
      capital: -1,
      treasury: def.startTreasury,
      food: 400,
      timber: 300,
      stone: 250,
      iron: 150,
      prestige: 100,
      legitimacy: 65,
      taxLevel: 1,
      council: {},
      personality: def.personality,
      succession: FAMILIES[def.id]?.succession ?? 'primogeniture',
      intelOn: {},
      lastIncome: { tax: 0, trade: 0, buildings: 0, tribute: 0, armyUpkeep: 0, fleetUpkeep: 0, courtUpkeep: 0, net: 0, food: 0, foodProduced: 0, foodConsumed: 0, timber: 0, stone: 0, iron: 0 },
      debtTurns: 0,
      starvingTurns: 0,
      rulerSinceTurn: 0,
      pastRulers: [],
      objectives: [],
      isRebel: def.id === 'rebels',
      warWeariness: 0,
      aiMemory: {},
    };
    s.diplomacy.reputation[def.id] = { orsenne: 45, sabeline: 55, tamsin: 82, varrow: 75, dray: 50, aldmere: 70, korr: 58, ostrevan: 50 }[def.id] ?? 60;
  }

  // provinces
  for (const pg of geo.provinces) {
    const a = pg.anchor;
    const tier = a.tier ?? (a.kind === 'village' ? 0 : a.kind === 'town' || a.kind === 'fortress' ? 1 : a.kind === 'city' ? 2 : 2);
    const popBase = [1600, 4200, 9500, 17000][tier];
    const p: ProvinceState = {
      id: pg.id,
      owner: a.owner,
      settlement: { name: a.name, tier, isPort: pg.port, fortress: a.kind === 'fortress', buildings: [], construction: [], recruitment: [], garrison: [], walls: 0, gateHp: 0 },
      population: Math.round(popBase * r.range(0.85, 1.15)),
      publicOrder: 30,
      development: 2 + tier,
      food: 0,
      taxValue: 0,
      income: 0,
      unrest: 0,
      previousOwners: [],
    };
    const isCapital = a.kind === 'capital';
    initialBuildings(p, a.kind, a.owner, pg.resources, pg.fertility, isCapital);
    p.settlement.gateHp = gateHpFor(p);
    s.provinces.push(p);
    if (isCapital) s.factions[a.owner].capital = pg.id;
  }
  s.factions.free.capital = s.provinces.find((p) => p.owner === 'free')!.id;
  for (const p of s.provinces) refreshGarrison(sim, p, true);

  // dynasties
  const rulers: Record<string, Character> = {};
  const siblingsOfRuler: Record<string, Character[]> = {};
  const courtiers: Record<string, Character[]> = {};
  const spousesToLink: { f: string; spec: NonNullable<FamilySpec['spouse']> }[] = [];
  for (const def of FACTIONS) {
    const spec = FAMILIES[def.id];
    const fid = def.id;
    const culture = def.culture;
    // grandparents / previous ruler
    const gpAge = spec.ruler.age + r.int(22, 30);
    const oldRuler = createCharacter(sim, { dynasty: fid, faction: fid, gender: 'm', birthTurn: T(gpAge + r.int(5, 15)), role: 'family' });
    oldRuler.alive = false;
    oldRuler.deathTurn = -r.int(8, 48);
    oldRuler.deathCause = r.pick(['old age', 'a fever', 'battle wounds']);
    const minorHouse = (c: string) => `${c}:${r.pick(CULTURES[c].minorHouses)}`;
    const oldQueen = createCharacter(sim, { dynasty: minorHouse(culture), faction: fid, gender: 'f', birthTurn: oldRuler.birthTurn + r.int(8, 30), role: 'family' });
    const queenAlive = r.chance(0.35) && gpAge < 72;
    if (!queenAlive) {
      oldQueen.alive = false;
      oldQueen.deathTurn = -r.int(4, 60);
      oldQueen.deathCause = 'illness';
    }
    oldRuler.spouse = oldQueen.id;
    oldQueen.spouse = oldRuler.id;
    s.factions[fid].pastRulers.push(oldRuler.id);
    const rs = spec.ruler;
    const ruler = createCharacter(sim, {
      dynasty: fid,
      faction: fid,
      gender: rs.gender,
      birthTurn: T(rs.age) - r.int(0, 3),
      father: rs.gender === 'm' || fid === 'sabeline' ? oldRuler.id : oldRuler.id,
      mother: oldQueen.id,
      role: 'ruler',
      name: rs.name,
      traits: rs.traits,
      skills: rs.skills,
    });
    ruler.prestige = 60 + r.int(0, 40);
    rulers[fid] = ruler;
    s.factions[fid].ruler = ruler.id;
    s.factions[fid].rulerSinceTurn = oldRuler.deathTurn!;
    s.factions[fid].legitimacy = 60 + r.int(0, 20);
    siblingsOfRuler[fid] = [];
    for (const sb of spec.siblings) {
      const c = createCharacter(sim, { dynasty: fid, faction: fid, gender: sb.gender, birthTurn: T(sb.age) - r.int(0, 3), father: oldRuler.id, mother: oldQueen.id, role: 'family', name: sb.name, traits: sb.traits });
      siblingsOfRuler[fid].push(c);
    }
    if (spec.spouse) spousesToLink.push({ f: fid, spec: spec.spouse });
    courtiers[fid] = [];
    const nCourt = 4;
    for (let i = 0; i < nCourt; i++) {
      const house = minorHouse(culture);
      const c = createCharacter(sim, { dynasty: house, faction: fid, gender: i === 3 && r.chance(0.5) ? 'f' : 'm', birthTurn: T(r.int(24, 58)), role: 'courtier' });
      c.title = r.pick(['Lord', 'Ser', 'Lord', 'Baron']);
      if (i === 0) {
        c.isKnight = true;
        c.role = 'knight';
        c.skills.command = Math.max(c.skills.command, 9);
        if (!c.traits.includes('brave')) c.traits.push('brave');
      }
      courtiers[fid].push(c);
    }
    if (factionDef(fid).maritime) {
      const adm = createCharacter(sim, { dynasty: minorHouse(culture), faction: fid, gender: 'm', birthTurn: T(r.int(30, 50)), role: 'courtier', traits: ['seafarer'] });
      adm.skills.command = Math.max(adm.skills.command, 8);
      courtiers[fid].push(adm);
    }
  }
  // cross-house spouses (historic marriages) - rulers' wives from other great houses
  for (const { f, spec } of spousesToLink) {
    const ruler = rulers[f];
    let spouse: Character;
    if (spec.sisterOf && rulers[spec.sisterOf]) {
      // the spouse is a daughter of the other house's previous ruler
      const other = rulers[spec.sisterOf];
      const existing = siblingsOfRuler[spec.sisterOf].find((c) => c.name === spec.name);
      spouse =
        existing ??
        createCharacter(sim, { dynasty: spec.sisterOf, faction: f, gender: ruler.gender === 'm' ? 'f' : 'm', birthTurn: T(spec.age), father: other.father, mother: other.mother, name: spec.name, traits: spec.traits, role: 'consort' });
    } else if (spec.dynasty && rulers[spec.dynasty]) {
      // a cousin of the other house
      const other = rulers[spec.dynasty];
      const existing = siblingsOfRuler[spec.dynasty].find((c) => c.name === spec.name);
      spouse = existing ?? createCharacter(sim, { dynasty: spec.dynasty, faction: f, gender: ruler.gender === 'm' ? 'f' : 'm', birthTurn: T(spec.age), father: other.father, mother: other.mother, name: spec.name, role: 'consort' });
    } else {
      spouse = createCharacter(sim, { dynasty: `${factionDef(f).culture}:${r.pick(CULTURES[factionDef(f).culture].minorHouses)}`, faction: f, gender: ruler.gender === 'm' ? 'f' : 'm', birthTurn: T(spec.age), name: spec.name, traits: spec.traits, role: 'consort' });
    }
    spouse.faction = f;
    spouse.role = 'consort';
    ruler.spouse = spouse.id;
    spouse.spouse = ruler.id;
  }
  // children
  for (const def of FACTIONS) {
    const fid = def.id;
    const spec = FAMILIES[fid];
    const ruler = rulers[fid];
    const spouse = sim.char(ruler.spouse);
    const father = ruler.gender === 'm' ? ruler : spouse;
    const mother = ruler.gender === 'f' ? ruler : spouse;
    for (const ch of spec.children) {
      const c = createCharacter(sim, { dynasty: fid, faction: fid, gender: ch.gender, birthTurn: T(ch.age) - r.int(0, 3), father: father?.id, mother: mother?.id, name: ch.name, traits: ch.traits, role: 'family' });
      if (!father) {
        // widowed ruler: children of a deceased spouse
        const late = createCharacter(sim, { dynasty: `${def.culture}:${r.pick(CULTURES[def.culture].minorHouses)}`, faction: fid, gender: ruler.gender === 'm' ? 'f' : 'm', birthTurn: ruler.birthTurn + r.int(4, 20), role: 'consort' });
        late.alive = false;
        late.deathTurn = -r.int(20, 50);
        late.deathCause = 'childbirth fever';
        late.spouse = ruler.id;
        ruler.formerSpouses = [late.id];
        c.mother = ruler.gender === 'm' ? late.id : ruler.id;
        c.father = ruler.gender === 'm' ? ruler.id : late.id;
        late.children.push(c.id);
        if (!ruler.children.includes(c.id)) ruler.children.push(c.id);
      }
    }
    // married siblings get spouse and kids
    for (const sb of siblingsOfRuler[fid]) {
      const spec2 = spec.siblings.find((x) => x.name === sb.name);
      if (!spec2?.married || sb.spouse !== undefined) continue;
      const sp = createCharacter(sim, { dynasty: `${def.culture}:${r.pick(CULTURES[def.culture].minorHouses)}`, faction: fid, gender: sb.gender === 'm' ? 'f' : 'm', birthTurn: sb.birthTurn + r.int(-8, 16), role: 'family' });
      marry(sim, sb.id, sp.id);
      const nk = r.int(1, 2);
      for (let k = 0; k < nk; k++) {
        const kidAge = Math.max(1, Math.floor((0 - sb.birthTurn) / 4) - r.int(20, 30));
        createCharacter(sim, { dynasty: sb.gender === 'm' ? fid : sp.dynasty, faction: fid, gender: r.chance(0.5) ? 'm' : 'f', birthTurn: T(kidAge), father: sb.gender === 'm' ? sb.id : sp.id, mother: sb.gender === 'f' ? sb.id : sp.id, role: 'family' });
      }
    }
    updateHeir(sim, fid);
    // council from best available
    const pool = Object.values(s.characters).filter((c) => c.alive && c.faction === fid && c.id !== ruler.id && Math.floor(-c.birthTurn / 4) >= 18);
    const used = new Set<number>();
    const skillFor: Record<string, keyof Character['skills']> = { chancellor: 'diplomacy', marshal: 'command', steward: 'stewardship', spymaster: 'intrigue', admiral: 'command' };
    for (const seat of COUNCIL_SEATS) {
      if (seat === 'admiral' && !def.maritime) continue;
      const best = pool.filter((c) => !used.has(c.id) && (seat !== 'admiral' || c.traits.includes('seafarer') || true)).sort((a, b) => skillOf(b, skillFor[seat]) - skillOf(a, skillFor[seat]))[0];
      if (!best) continue;
      used.add(best.id);
      s.factions[fid].council[seat] = best.id;
      best.council = seat;
    }
  }

  // armies & fleets
  const provByName = (n: string) => geo.provinces.find((p) => p.name === n)!;
  for (const def of FACTIONS) {
    const fid = def.id;
    const ruler = rulers[fid];
    const heir = sim.char(s.factions[fid].heir);
    for (const t of ARMY_TEMPLATES[fid] ?? []) {
      const pg = provByName(t.at);
      let gen: Character | undefined;
      const takeFree = (c: Character | undefined) => (c && c.alive && c.armyId === undefined && c.fleetId === undefined && Math.floor(-c.birthTurn / 4) >= 16 ? c : undefined);
      if (t.general === 'ruler') gen = takeFree(ruler);
      else if (t.general === 'heir') gen = takeFree(heir) ?? takeFree(ruler);
      else if (t.general === 'sibling') gen = siblingsOfRuler[fid].map(takeFree).find(Boolean) ?? takeFree(heir);
      if (!gen) gen = courtiers[fid].map(takeFree).find((c) => c && !c.council) ?? courtiers[fid].map(takeFree).find(Boolean);
      const units = t.units.map((u) => newUnit(sim, u, r.range(0.8, 1), r.int(0, 2)));
      const army = createArmy(sim, fid, pg.cell, units, gen?.id);
      if (gen && gen.council) {
        // generals keep their council seat (they may do both)
      }
      void army;
    }
    for (const t of FLEET_TEMPLATES[fid] ?? []) {
      const pg = provByName(t.at);
      if (!pg.port) continue;
      let adm: Character | undefined;
      const free = (c: Character | undefined) => (c && c.alive && c.armyId === undefined && c.fleetId === undefined ? c : undefined);
      if (t.admiral === 'ruler') adm = free(ruler);
      else if (t.admiral === 'sibling') adm = siblingsOfRuler[fid].map(free).find(Boolean);
      if (!adm) adm = courtiers[fid].map(free).find((c) => c?.traits.includes('seafarer')) ?? courtiers[fid].map(free).find(Boolean);
      const fleet = createFleet(sim, fid, pg.portCell, t.ships.map((x) => newShip(sim, fid, x)), adm?.id);
      fleet.inPort = pg.id;
    }
  }
  // free towns militia army
  const freeTown = geo.provinces.find((p) => p.name === 'Seravel')!;
  createArmy(sim, 'free', freeTown.cell, ['spearmen', 'crossbowmen', 'militia', 'militia'].map((u) => newUnit(sim, u, 0.9)));

  // --- diplomacy & history
  generateHistory(sim);
  computeTrade(sim);
  updateProvinces(sim);
  for (const f of Object.values(s.factions)) if (f.alive) f.lastIncome = { ...f.lastIncome };
  rollWeather(sim);
  for (const def of FACTIONS) s.factions[def.id].objectives = generateObjectives(sim, def.id);
  initFog(sim);
  sim.syncRng();
  return sim;
}

function generateHistory(sim: Sim) {
  const s = sim.s;
  const r = sim.rng;
  const ids = FACTIONS.map((f) => f.id);
  // base sentiment from personalities
  for (const a of ids)
    for (const b of ids) {
      if (a === b) continue;
      let v = r.int(-8, 8);
      const da = factionDef(a).ai;
      v += Math.round((da.diplomacy - 0.5) * 10);
      s.diplomacy.base[pairKey(a, b)] = v;
    }
  for (const a of ids) {
    s.diplomacy.base[pairKey(a, 'free')] = -5;
    s.diplomacy.base[pairKey('free', a)] = 0;
  }
  const hist = (turnsAgo: number, text: string, factions: string[], kind: string) => s.chronicle.push({ turn: -turnsAgo, text, factions, kind });
  const grievance = (from: string, to: string, label: string, v: number) => addModifier(sim, from, to, 'history_grievance', label, v, 0.05);
  const bond = (from: string, to: string, label: string, v: number) => addModifier(sim, from, to, 'history_bond', label, v, 0.05);
  const corvel = sim.geo.provinces.find((p) => p.name === 'Corvel')!;
  const tallow = sim.geo.provinces.find((p) => p.name === 'Tallow Cross')!;
  const seawatch = sim.geo.provinces.find((p) => p.name === 'Seawatch')!;
  const cinder = sim.geo.provinces.find((p) => p.name === 'Cinderhold')!;
  // Scripted core history
  hist(4 * 22, 'The War of the Salt Coast: House Orsenne seized Corvel from House Aldmere.', ['orsenne', 'aldmere'], 'war');
  s.provinces[corvel.id].previousOwners.push({ faction: 'aldmere', untilTurn: -88 });
  grievance('aldmere', 'orsenne', 'Stole Corvel from us', -35);
  grievance('orsenne', 'aldmere', 'Old enemies', -10);
  const aldRuler = sim.char(s.factions.aldmere.ruler)!;
  aldRuler.claims.push({ kind: 'province', target: corvel.id, strength: 2, source: 'history', sinceTurn: -88 });
  hist(4 * 25, 'Princess Carys of House Tamsin wed Edric of House Aldmere, binding Greenholm and Westmarch.', ['tamsin', 'aldmere'], 'marriage');
  bond('tamsin', 'aldmere', 'Old friendship', 25);
  bond('aldmere', 'tamsin', 'Old friendship', 25);
  addTreaty(sim, { type: 'defensive', a: 'aldmere', b: 'tamsin', since: -60 });
  addTreaty(sim, { type: 'trade', a: 'aldmere', b: 'tamsin', since: -60 });
  hist(4 * 12, 'The Strait War: Norhaven raiders burned Seawatch before Dray drove them back into the sea.', ['ostrevan', 'dray'], 'war');
  grievance('dray', 'ostrevan', 'Burned Seawatch', -40);
  grievance('ostrevan', 'dray', 'Denied us the strait', -30);
  sim.char(s.factions.ostrevan.ruler)!.claims.push({ kind: 'province', target: seawatch.id, strength: 1, source: 'history', sinceTurn: -48 });
  hist(4 * 30, 'House Varrow and House Korr fell out over the iron trade of the northern seas.', ['varrow', 'korr'], 'rivalry');
  grievance('varrow', 'korr', 'Iron trade rivalry', -20);
  grievance('korr', 'varrow', 'Iron trade rivalry', -25);
  sim.char(s.factions.varrow.ruler)!.claims.push({ kind: 'province', target: cinder.id, strength: 1, source: 'history', sinceTurn: -120 });
  hist(4 * 18, 'Hedda of House Varrow married Amaury of House Orsenne; the northern passes knew a brief peace.', ['varrow', 'orsenne'], 'marriage');
  bond('orsenne', 'varrow', 'Marriage alliance of old', 10);
  hist(4 * 8, 'Orsenne horsemen raided the fields of Tallow Cross. The free towns appealed to Lirien for aid.', ['orsenne', 'free', 'sabeline'], 'raid');
  sim.char(s.factions.orsenne.ruler)!.claims.push({ kind: 'province', target: tallow.id, strength: 1, source: 'fabricated', sinceTurn: -32 });
  grievance('sabeline', 'orsenne', 'Threatens our trade', -15);
  hist(4 * 15, 'The Merchant Accord: House Sabeline and House Dray pledged to keep the southern sea lanes open.', ['sabeline', 'dray'], 'treaty');
  addTreaty(sim, { type: 'alliance', a: 'sabeline', b: 'dray', since: -60 });
  addTreaty(sim, { type: 'trade', a: 'sabeline', b: 'dray', since: -60 });
  addTreaty(sim, { type: 'trade', a: 'sabeline', b: 'tamsin', since: -40 });
  addTreaty(sim, { type: 'trade', a: 'korr', b: 'ostrevan', since: -30 });
  addTreaty(sim, { type: 'trade', a: 'sabeline', b: 'korr', since: -30 });
  bond('korr', 'ostrevan', 'Iron for timber', 12);
  bond('ostrevan', 'korr', 'Iron for timber', 12);
  hist(4 * 6, 'House Varrow closed the Irongate pass to Orsenne merchants after a border killing.', ['varrow', 'orsenne'], 'incident');
  grievance('varrow', 'orsenne', 'Border killings', -12);
  hist(4 * 35, 'House Aldmere and House Varrow fought side by side against the raiders of the north.', ['aldmere', 'varrow'], 'alliance');
  bond('varrow', 'aldmere', 'Brothers in arms', 12);
  bond('aldmere', 'varrow', 'Brothers in arms', 12);
  // randomised extra history
  const events = r.int(4, 6);
  for (let i = 0; i < events; i++) {
    const a = r.pick(ids);
    const b = r.pick(ids.filter((x) => x !== a));
    const ago = r.int(10, 150);
    const kind = r.pick(['skirmish', 'betrayal', 'feast', 'insult', 'aid']);
    const A = sim.houseName(a);
    const B = sim.houseName(b);
    if (kind === 'skirmish') {
      hist(ago, `Border skirmish between ${A} and ${B}.`, [a, b], 'incident');
      grievance(a, b, 'Past skirmishes', -8);
      grievance(b, a, 'Past skirmishes', -8);
    } else if (kind === 'betrayal') {
      hist(ago, `${A} broke faith with ${B} in the Autumn Parley.`, [a, b], 'betrayal');
      grievance(b, a, 'Broke faith with us', -18);
    } else if (kind === 'feast') {
      hist(ago, `The heirs of ${A} and ${B} feasted together at the Tournament of Lanreth.`, [a, b], 'feast');
      bond(a, b, 'Shared tourneys', 6);
      bond(b, a, 'Shared tourneys', 6);
    } else if (kind === 'insult') {
      hist(ago, `An envoy of ${A} was insulted at the court of ${B}.`, [a, b], 'incident');
      grievance(a, b, 'Insulted our envoy', -10);
    } else {
      hist(ago, `${A} sent grain to ${B} in a famine year.`, [a, b], 'aid');
      bond(b, a, 'Aided us in famine', 12);
    }
  }
  s.chronicle.sort((x, y) => x.turn - y.turn);
}
