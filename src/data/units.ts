export type UnitCategory = 'militia' | 'infantry' | 'spear' | 'heavy' | 'archer' | 'crossbow' | 'lightcav' | 'heavycav' | 'knight' | 'general' | 'siege';

export interface UnitVisual {
  helmet: number; // 0 hood/cap, 1 kettle, 2 nasal, 3 great helm, 4 bascinet, 5 bare
  body: number; // 0 tunic, 1 gambeson, 2 mail, 3 plate
  shield: number; // 0 none, 1 round, 2 kite, 3 heater, 4 pavise
  weapon: number; // 0 sword, 1 spear, 2 axe, 3 bow, 4 crossbow, 5 lance, 6 pike, 7 pitchfork/club, 8 mace
  mounted: boolean;
  barded?: boolean;
  cloak?: boolean;
}

export interface UnitDef {
  id: string;
  name: string;
  category: UnitCategory;
  desc: string;
  troops: number;
  cost: number;
  upkeep: number;
  foodUpkeep: number; // per 100 troops
  iron: number;
  recruitTurns: number;
  requires: string[]; // building ids (any level)
  requiresLevel?: number;
  factions?: string[]; // restricted to
  // battle stats
  hp: number;
  attack: number;
  defense: number;
  damage: number;
  ap: number; // armour-piercing fraction 0..1
  armor: number;
  charge: number;
  morale: number;
  walk: number;
  run: number;
  mass: number;
  shield: number; // missile block chance from front
  bonusVsCav: number;
  bonusVsInf: number;
  range?: number;
  missileDamage?: number;
  reload?: number;
  ammo?: number;
  accuracy?: number;
  arc?: boolean; // indirect fire capability
  siegeDamage?: number;
  visual: UnitVisual;
}

const V = (helmet: number, body: number, shield: number, weapon: number, mounted = false, barded = false, cloak = false): UnitVisual => ({ helmet, body, shield, weapon, mounted, barded, cloak });

export const UNITS: UnitDef[] = [
  {
    id: 'militia', name: 'Militia Levy', category: 'militia', desc: 'Peasants hastily armed. Cheap, brittle, useful to hold walls or soak arrows.',
    troops: 100, cost: 90, upkeep: 12, foodUpkeep: 8, iron: 0, recruitTurns: 1, requires: [],
    hp: 10, attack: 16, defense: 14, damage: 4, ap: 0.05, armor: 8, charge: 4, morale: 32, walk: 1.3, run: 3.2, mass: 1, shield: 0.05, bonusVsCav: 0, bonusVsInf: 0,
    visual: V(0, 0, 0, 7),
  },
  {
    id: 'spearmen', name: 'Spear Levy', category: 'spear', desc: 'Shielded spearmen. Brace against cavalry charges and hold the line.',
    troops: 120, cost: 150, upkeep: 20, foodUpkeep: 8, iron: 5, recruitTurns: 1, requires: ['barracks'],
    hp: 12, attack: 22, defense: 30, damage: 5, ap: 0.1, armor: 22, charge: 6, morale: 45, walk: 1.3, run: 3.2, mass: 1.05, shield: 0.35, bonusVsCav: 18, bonusVsInf: 0,
    visual: V(1, 1, 1, 1),
  },
  {
    id: 'pikemen', name: 'Signory Pikes', category: 'spear', desc: 'Professional pike blocks. Deadly against horse, hard to break from the front.',
    troops: 120, cost: 230, upkeep: 28, foodUpkeep: 8, iron: 10, recruitTurns: 2, requires: ['barracks', 'workshop'], factions: ['sabeline'],
    hp: 12, attack: 26, defense: 36, damage: 6, ap: 0.2, armor: 30, charge: 5, morale: 55, walk: 1.2, run: 3.0, mass: 1.05, shield: 0.1, bonusVsCav: 26, bonusVsInf: 2,
    visual: V(4, 2, 0, 6),
  },
  {
    id: 'swordsmen', name: 'Sword Infantry', category: 'infantry', desc: 'Versatile shield-and-sword infantry, strong in a melee brawl.',
    troops: 100, cost: 190, upkeep: 24, foodUpkeep: 8, iron: 10, recruitTurns: 1, requires: ['barracks'],
    hp: 13, attack: 32, defense: 26, damage: 6, ap: 0.15, armor: 28, charge: 8, morale: 50, walk: 1.35, run: 3.4, mass: 1.05, shield: 0.35, bonusVsCav: 0, bonusVsInf: 4,
    visual: V(2, 2, 2, 0),
  },
  {
    id: 'axemen', name: 'Norhaven Huscarls', category: 'infantry', desc: 'Towering axe-armed raiders. Terrifying shock infantry that cleaves armour.',
    troops: 90, cost: 260, upkeep: 30, foodUpkeep: 9, iron: 12, recruitTurns: 2, requires: ['barracks'], factions: ['ostrevan'],
    hp: 15, attack: 40, defense: 22, damage: 8, ap: 0.4, armor: 30, charge: 14, morale: 62, walk: 1.4, run: 3.6, mass: 1.15, shield: 0.3, bonusVsCav: 2, bonusVsInf: 6,
    visual: V(2, 2, 1, 2, false, false, true),
  },
  {
    id: 'marines', name: 'Sea Wardens', category: 'infantry', desc: 'Skarholm marines. Excellent in boarding actions and on walls.',
    troops: 90, cost: 240, upkeep: 28, foodUpkeep: 8, iron: 10, recruitTurns: 2, requires: ['barracks', 'harbor'], factions: ['dray'],
    hp: 14, attack: 34, defense: 30, damage: 7, ap: 0.2, armor: 32, charge: 8, morale: 60, walk: 1.4, run: 3.5, mass: 1.05, shield: 0.35, bonusVsCav: 4, bonusVsInf: 4,
    visual: V(1, 2, 3, 0, false, false, true),
  },
  {
    id: 'heavy_infantry', name: 'Men-at-Arms', category: 'heavy', desc: 'Armoured veterans with poleaxes and maces. Slow, expensive, and immovable.',
    troops: 80, cost: 320, upkeep: 36, foodUpkeep: 9, iron: 25, recruitTurns: 2, requires: ['barracks', 'armory'],
    hp: 16, attack: 38, defense: 36, damage: 8, ap: 0.45, armor: 55, charge: 10, morale: 68, walk: 1.2, run: 3.0, mass: 1.25, shield: 0.25, bonusVsCav: 6, bonusVsInf: 4,
    visual: V(4, 3, 3, 8, false, false, false),
  },
  {
    id: 'archers', name: 'Archers', category: 'archer', desc: 'Short-bow skirmishers. Rapid volleys that thin unarmoured ranks.',
    troops: 80, cost: 150, upkeep: 20, foodUpkeep: 8, iron: 3, recruitTurns: 1, requires: ['archery_range'],
    hp: 11, attack: 14, defense: 12, damage: 4, ap: 0.05, armor: 12, charge: 3, morale: 40, walk: 1.35, run: 3.5, mass: 0.95, shield: 0, bonusVsCav: 0, bonusVsInf: 0,
    range: 145, missileDamage: 6, reload: 5.5, ammo: 26, accuracy: 0.55, arc: true,
    visual: V(0, 1, 0, 3),
  },
  {
    id: 'longbowmen', name: 'Longbowmen', category: 'archer', desc: 'Yew longbows with great range and punch. Pride of the west.',
    troops: 80, cost: 230, upkeep: 26, foodUpkeep: 8, iron: 4, recruitTurns: 2, requires: ['archery_range'], factions: ['aldmere', 'tamsin'],
    hp: 12, attack: 18, defense: 14, damage: 5, ap: 0.1, armor: 16, charge: 3, morale: 52, walk: 1.35, run: 3.5, mass: 1, shield: 0, bonusVsCav: 0, bonusVsInf: 0,
    range: 175, missileDamage: 8, reload: 5.5, ammo: 24, accuracy: 0.6, arc: true,
    visual: V(1, 1, 0, 3, false, false, false),
  },
  {
    id: 'crossbowmen', name: 'Crossbowmen', category: 'crossbow', desc: 'Slow to reload, but their bolts punch through mail. Carry pavises.',
    troops: 80, cost: 200, upkeep: 24, foodUpkeep: 8, iron: 10, recruitTurns: 1, requires: ['archery_range', 'workshop'],
    hp: 12, attack: 16, defense: 18, damage: 5, ap: 0.1, armor: 26, charge: 3, morale: 46, walk: 1.25, run: 3.2, mass: 1, shield: 0.15, bonusVsCav: 0, bonusVsInf: 0,
    range: 135, missileDamage: 13, reload: 9.5, ammo: 18, accuracy: 0.66, arc: false,
    visual: V(1, 2, 4, 4),
  },
  {
    id: 'light_cavalry', name: 'Outriders', category: 'lightcav', desc: 'Fast horsemen for scouting, flanking and running down fleeing troops.',
    troops: 50, cost: 230, upkeep: 30, foodUpkeep: 14, iron: 6, recruitTurns: 1, requires: ['stables'],
    hp: 18, attack: 26, defense: 16, damage: 6, ap: 0.1, armor: 16, charge: 20, morale: 48, walk: 2.6, run: 9.2, mass: 3.5, shield: 0.2, bonusVsCav: 0, bonusVsInf: 0,
    visual: V(1, 1, 1, 1, true),
  },
  {
    id: 'heavy_cavalry', name: 'Lancers', category: 'heavycav', desc: 'Mailed lancers on strong horses. A devastating charge.',
    troops: 45, cost: 360, upkeep: 40, foodUpkeep: 16, iron: 18, recruitTurns: 2, requires: ['stables', 'armory'],
    hp: 22, attack: 32, defense: 24, damage: 8, ap: 0.25, armor: 40, charge: 38, morale: 60, walk: 2.4, run: 8.4, mass: 5, shield: 0.3, bonusVsCav: 4, bonusVsInf: 2,
    visual: V(2, 2, 2, 5, true),
  },
  {
    id: 'knights', name: 'Knights of the Realm', category: 'knight', desc: 'Plate-clad nobles on barded destriers. Elite, proud, and costly.',
    troops: 36, cost: 520, upkeep: 56, foodUpkeep: 18, iron: 30, recruitTurns: 3, requires: ['stables', 'armory', 'manor'],
    hp: 28, attack: 42, defense: 34, damage: 10, ap: 0.35, armor: 64, charge: 50, morale: 78, walk: 2.3, run: 8.0, mass: 6.5, shield: 0.35, bonusVsCav: 6, bonusVsInf: 4,
    visual: V(3, 3, 3, 5, true, true, true),
  },
  {
    id: 'bodyguard', name: "General's Retinue", category: 'general', desc: 'The commander and sworn household knights. If they fall, the army wavers.',
    troops: 24, cost: 0, upkeep: 30, foodUpkeep: 16, iron: 0, recruitTurns: 1, requires: ['__never__'],
    hp: 32, attack: 40, defense: 38, damage: 10, ap: 0.35, armor: 60, charge: 42, morale: 85, walk: 2.4, run: 8.2, mass: 6, shield: 0.35, bonusVsCav: 6, bonusVsInf: 4,
    visual: V(3, 3, 3, 0, true, true, true),
  },
  {
    id: 'ram', name: 'Battering Ram', category: 'siege', desc: 'A roofed ram to break fortified gates. Vulnerable to fire from the walls.',
    troops: 16, cost: 180, upkeep: 14, foodUpkeep: 6, iron: 5, recruitTurns: 1, requires: ['siege_workshop'],
    hp: 12, attack: 6, defense: 6, damage: 3, ap: 0, armor: 30, charge: 0, morale: 40, walk: 0.9, run: 1.1, mass: 1, shield: 0.8, bonusVsCav: 0, bonusVsInf: 0,
    siegeDamage: 60,
    visual: V(0, 1, 0, 7),
  },
  {
    id: 'catapult', name: 'Mangonel', category: 'siege', desc: 'Traction catapult hurling stones at walls, gates and massed ranks.',
    troops: 20, cost: 300, upkeep: 24, foodUpkeep: 6, iron: 8, recruitTurns: 2, requires: ['siege_workshop'],
    hp: 11, attack: 6, defense: 6, damage: 3, ap: 0, armor: 10, charge: 0, morale: 40, walk: 0.8, run: 1.0, mass: 1, shield: 0, bonusVsCav: 0, bonusVsInf: 0,
    range: 260, missileDamage: 40, reload: 14, ammo: 30, accuracy: 0.35, arc: true, siegeDamage: 90,
    visual: V(0, 1, 0, 7),
  },
  {
    id: 'trebuchet', name: 'Trebuchet', category: 'siege', desc: 'Counterweight engine of immense range. Smashes walls from afar.',
    troops: 24, cost: 460, upkeep: 32, foodUpkeep: 6, iron: 14, recruitTurns: 3, requires: ['siege_workshop', 'workshop'],
    hp: 11, attack: 6, defense: 6, damage: 3, ap: 0, armor: 10, charge: 0, morale: 40, walk: 0.6, run: 0.8, mass: 1, shield: 0, bonusVsCav: 0, bonusVsInf: 0,
    range: 380, missileDamage: 70, reload: 22, ammo: 24, accuracy: 0.3, arc: true, siegeDamage: 180,
    visual: V(0, 1, 0, 7),
  },
];

export interface ShipDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  upkeep: number;
  timber: number;
  recruitTurns: number;
  requires: string[];
  hull: number;
  crew: number;
  capacity: number; // troops it can carry
  speed: number; // knots-ish battle speed (units/s)
  turn: number; // rad/s
  archers: number; // ranged crew fraction
  ballista: number; // bolt throwers
  boarding: number; // melee strength per crew
  moveCells: number; // campaign movement
  length: number; // model length (m)
  masts: number;
  castles: number;
  trade: number; // trade value multiplier (merchant)
}

export const SHIPS: ShipDef[] = [
  { id: 'cog', name: 'Transport Cog', desc: 'Broad-beamed cog for carrying troops across the sea.', cost: 220, upkeep: 16, timber: 40, recruitTurns: 1, requires: ['harbor'], hull: 260, crew: 30, capacity: 420, speed: 5.2, turn: 0.24, archers: 0.3, ballista: 0, boarding: 0.8, moveCells: 34, length: 26, masts: 1, castles: 2, trade: 0.4 },
  { id: 'hulk', name: 'Merchant Hulk', desc: 'Deep-holded trader. Increases trade income from this port.', cost: 260, upkeep: 12, timber: 45, recruitTurns: 1, requires: ['harbor'], hull: 240, crew: 24, capacity: 260, speed: 4.8, turn: 0.22, archers: 0.2, ballista: 0, boarding: 0.6, moveCells: 32, length: 28, masts: 2, castles: 1, trade: 1.0 },
  { id: 'galley', name: 'War Galley', desc: 'Fast oared warship crewed with archers. Quick to strike, lightly built.', cost: 320, upkeep: 24, timber: 50, recruitTurns: 2, requires: ['shipyard'], hull: 280, crew: 70, capacity: 120, speed: 7.2, turn: 0.42, archers: 0.5, ballista: 1, boarding: 1.0, moveCells: 42, length: 32, masts: 1, castles: 1, trade: 0 },
  { id: 'carrack', name: 'War Carrack', desc: 'High-castled heavy warship packed with marines and bolt throwers.', cost: 560, upkeep: 40, timber: 90, recruitTurns: 3, requires: ['shipyard'], hull: 620, crew: 120, capacity: 200, speed: 5.6, turn: 0.26, archers: 0.4, ballista: 3, boarding: 1.2, moveCells: 36, length: 40, masts: 3, castles: 2, trade: 0.2 },
  { id: 'flagship', name: 'Great Ship', desc: 'A towering floating castle. Commands the seas and awes all who see it.', cost: 980, upkeep: 70, timber: 160, recruitTurns: 4, requires: ['shipyard', 'council_hall'], hull: 1100, crew: 200, capacity: 260, speed: 5.2, turn: 0.2, archers: 0.4, ballista: 5, boarding: 1.35, moveCells: 34, length: 52, masts: 3, castles: 2, trade: 0.3 },
];

const unitMap = new Map(UNITS.map((u) => [u.id, u]));
const shipMap = new Map(SHIPS.map((s) => [s.id, s]));
export const unitDef = (id: string): UnitDef => unitMap.get(id) ?? UNITS[0];
export const shipDef = (id: string): ShipDef => shipMap.get(id) ?? SHIPS[0];
export const isCavalry = (d: UnitDef) => d.visual.mounted;
export const isRanged = (d: UnitDef) => !!d.range && d.category !== 'siege';
