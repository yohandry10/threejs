/**
 * Authored geography of the realm of "Aurelmark" (original setting).
 * Coordinates are normalised: u = x / WORLD_W (west->east), v = z / WORLD_H (north->south).
 */
export const WORLD_W = 6144;
export const WORLD_H = 4096;

export interface Blob {
  u: number;
  v: number;
  ru: number;
  rv: number;
  w?: number;
}

export interface LandmassDef {
  id: number;
  name: string;
  kind: 'continent' | 'island';
  role: string;
  blobs: Blob[];
  rugged: number; // 0..1 cliffs
  climate: 'temperate' | 'north' | 'south' | 'volcanic' | 'maritime';
}

export const LANDMASSES: LandmassDef[] = [
  {
    id: 1,
    name: 'Aurelmark',
    kind: 'continent',
    role: 'The great continent',
    rugged: 0.15,
    climate: 'temperate',
    blobs: [
      { u: 0.47, v: 0.5, ru: 0.26, rv: 0.3 },
      { u: 0.28, v: 0.52, ru: 0.12, rv: 0.19 },
      { u: 0.45, v: 0.23, ru: 0.22, rv: 0.12 },
      { u: 0.69, v: 0.45, ru: 0.09, rv: 0.17 },
      { u: 0.53, v: 0.76, ru: 0.17, rv: 0.1 },
      { u: 0.31, v: 0.73, ru: 0.07, rv: 0.09 },
      { u: 0.36, v: 0.13, ru: 0.06, rv: 0.05 },
      { u: 0.72, v: 0.6, ru: 0.05, rv: 0.06 },
      { u: 0.21, v: 0.35, ru: 0.05, rv: 0.06 },
      { u: 0.6, v: 0.83, ru: 0.05, rv: 0.05 },
      { u: 0.76, v: 0.36, ru: 0.03, rv: 0.05 },
    ],
  },
  { id: 2, name: 'Emberfell', kind: 'island', role: 'Volcanic mining isle', rugged: 0.6, climate: 'volcanic', blobs: [{ u: 0.1, v: 0.2, ru: 0.055, rv: 0.085 }, { u: 0.13, v: 0.26, ru: 0.03, rv: 0.04 }] },
  { id: 3, name: 'Greenholm', kind: 'island', role: 'Fertile grain isle', rugged: 0.05, climate: 'maritime', blobs: [{ u: 0.085, v: 0.72, ru: 0.05, rv: 0.075 }, { u: 0.1, v: 0.66, ru: 0.03, rv: 0.035 }] },
  { id: 4, name: 'Lirien', kind: 'island', role: 'Merchant trade isle', rugged: 0.1, climate: 'south', blobs: [{ u: 0.62, v: 0.915, ru: 0.065, rv: 0.035 }, { u: 0.57, v: 0.91, ru: 0.03, rv: 0.03 }] },
  { id: 5, name: 'Skarholm', kind: 'island', role: 'Fortress isle guarding the strait', rugged: 0.9, climate: 'maritime', blobs: [{ u: 0.835, v: 0.645, ru: 0.03, rv: 0.05 }] },
  { id: 6, name: 'Norhaven', kind: 'island', role: 'Great northern sea-kingdom', rugged: 0.35, climate: 'north', blobs: [{ u: 0.905, v: 0.31, ru: 0.06, rv: 0.16 }, { u: 0.9, v: 0.44, ru: 0.045, rv: 0.06 }, { u: 0.915, v: 0.2, ru: 0.045, rv: 0.06 }] },
];

/** Bays and inlets carved out of the land */
export const BAYS: Blob[] = [
  { u: 0.665, v: 0.69, ru: 0.045, rv: 0.05 },
  { u: 0.2, v: 0.44, ru: 0.03, rv: 0.035 },
  { u: 0.58, v: 0.1, ru: 0.05, rv: 0.04 },
  { u: 0.24, v: 0.86, ru: 0.05, rv: 0.05 },
  { u: 0.44, v: 0.885, ru: 0.035, rv: 0.035 },
  { u: 0.705, v: 0.2, ru: 0.05, rv: 0.05 },
  { u: 0.25, v: 0.13, ru: 0.04, rv: 0.05 },
];

export interface RangeDef {
  name: string;
  points: [number, number][];
  width: number; // world units
  height: number;
  passes: [number, number][];
}

export const RANGES: RangeDef[] = [
  { name: 'Greyspine Mountains', points: [[0.25, 0.22], [0.32, 0.17], [0.4, 0.165], [0.5, 0.17], [0.58, 0.2], [0.63, 0.27]], width: 190, height: 420, passes: [[0.44, 0.19], [0.555, 0.215]] },
  { name: 'Ashen Divide', points: [[0.345, 0.34], [0.36, 0.44], [0.355, 0.54], [0.335, 0.63]], width: 120, height: 210, passes: [[0.357, 0.475], [0.345, 0.6]] },
  { name: 'Duskmere Heights', points: [[0.6, 0.42], [0.63, 0.5], [0.61, 0.56]], width: 110, height: 150, passes: [] },
  { name: 'Norhaven Spine', points: [[0.915, 0.15], [0.9, 0.26], [0.91, 0.38]], width: 90, height: 230, passes: [[0.905, 0.3]] },
  { name: 'Emberfell Cone', points: [[0.09, 0.17], [0.1, 0.19]], width: 150, height: 480, passes: [] },
  { name: 'Skarholm Crags', points: [[0.835, 0.62], [0.838, 0.67]], width: 70, height: 160, passes: [] },
];

export interface RiverDef {
  name: string;
  points: [number, number][];
}

export const RIVERS: RiverDef[] = [
  { name: 'Aveline', points: [[0.5, 0.215], [0.49, 0.3], [0.475, 0.38], [0.5, 0.47], [0.485, 0.56], [0.47, 0.64], [0.5, 0.72], [0.51, 0.8], [0.505, 0.9]] },
  { name: 'Wend', points: [[0.33, 0.28], [0.3, 0.36], [0.26, 0.43], [0.225, 0.5], [0.205, 0.575], [0.16, 0.615], [0.1, 0.63]] },
  { name: 'Ambrel', points: [[0.62, 0.3], [0.66, 0.37], [0.71, 0.4], [0.8, 0.41]] },
  { name: 'Coldwater', points: [[0.42, 0.2], [0.4, 0.13], [0.39, 0.02]] },
];

export type SettlementKind = 'village' | 'town' | 'city' | 'fortress' | 'capital';

export interface ProvinceAnchor {
  name: string;
  u: number;
  v: number;
  kind: SettlementKind;
  port: boolean;
  owner: string;
  region: string;
  resources: string[];
  tier?: number;
  greatCapital?: boolean;
}

/** Settlement anchors define provinces. Order is province id. */
export const ANCHORS: ProvinceAnchor[] = [
  // --- Aldmere (west)
  { name: 'Aldhaven', u: 0.19, v: 0.525, kind: 'capital', port: true, owner: 'aldmere', region: 'west', resources: ['grain', 'fish'], tier: 3, greatCapital: true },
  { name: 'Wendmoor', u: 0.265, v: 0.45, kind: 'town', port: false, owner: 'aldmere', region: 'west', resources: ['grain', 'horses'] },
  { name: 'Briarfield', u: 0.25, v: 0.59, kind: 'village', port: false, owner: 'aldmere', region: 'west', resources: ['grain'] },
  { name: 'Oakenshaw', u: 0.285, v: 0.36, kind: 'town', port: false, owner: 'aldmere', region: 'west', resources: ['timber'] },
  { name: 'Harrowgate', u: 0.33, v: 0.48, kind: 'fortress', port: false, owner: 'aldmere', region: 'west', resources: ['stone'] },
  { name: 'Saltmere', u: 0.225, v: 0.67, kind: 'town', port: true, owner: 'aldmere', region: 'west', resources: ['fish', 'salt'] },
  // --- Orsenne (centre / south)
  { name: 'Valmont', u: 0.475, v: 0.47, kind: 'capital', port: false, owner: 'orsenne', region: 'center', resources: ['grain', 'horses'], tier: 3, greatCapital: true },
  { name: 'Cressy Ford', u: 0.47, v: 0.335, kind: 'town', port: false, owner: 'orsenne', region: 'center', resources: ['grain'] },
  { name: 'Sorrel', u: 0.405, v: 0.4, kind: 'village', port: false, owner: 'orsenne', region: 'center', resources: ['horses'] },
  { name: 'Lanreth', u: 0.42, v: 0.6, kind: 'city', port: false, owner: 'orsenne', region: 'center', resources: ['grain', 'wine'] },
  { name: 'Corvel', u: 0.325, v: 0.765, kind: 'city', port: true, owner: 'orsenne', region: 'south', resources: ['fish', 'wine'] },
  { name: 'Duskmere', u: 0.555, v: 0.56, kind: 'town', port: false, owner: 'orsenne', region: 'center', resources: ['timber', 'stone'] },
  { name: 'Brightwater', u: 0.49, v: 0.79, kind: 'town', port: true, owner: 'orsenne', region: 'south', resources: ['fish', 'wine'] },
  { name: 'Pellow', u: 0.4, v: 0.72, kind: 'village', port: false, owner: 'orsenne', region: 'south', resources: ['grain'] },
  // --- Varrow (north)
  { name: 'Hollowcrest', u: 0.445, v: 0.22, kind: 'capital', port: false, owner: 'varrow', region: 'north', resources: ['iron', 'stone'], tier: 2, greatCapital: true },
  { name: 'Frostmarch', u: 0.33, v: 0.245, kind: 'town', port: false, owner: 'varrow', region: 'north', resources: ['timber', 'furs'] },
  { name: 'Irongate', u: 0.565, v: 0.245, kind: 'fortress', port: false, owner: 'varrow', region: 'north', resources: ['iron'] },
  { name: 'Kelda', u: 0.37, v: 0.105, kind: 'town', port: true, owner: 'varrow', region: 'north', resources: ['fish', 'furs'] },
  { name: 'Stonebarrow', u: 0.52, v: 0.12, kind: 'village', port: true, owner: 'varrow', region: 'north', resources: ['stone', 'iron'] },
  { name: 'Coldwater', u: 0.28, v: 0.29, kind: 'village', port: false, owner: 'varrow', region: 'north', resources: ['timber'] },
  // --- East (Sabeline mainland holdings + free towns)
  { name: 'Ystra', u: 0.755, v: 0.43, kind: 'city', port: true, owner: 'sabeline', region: 'east', resources: ['fish', 'silk'], tier: 2 },
  { name: 'Merrowgate', u: 0.745, v: 0.575, kind: 'town', port: true, owner: 'sabeline', region: 'east', resources: ['fish', 'salt'] },
  { name: 'Amberlight', u: 0.665, v: 0.33, kind: 'town', port: false, owner: 'free', region: 'east', resources: ['timber', 'amber'] },
  { name: 'Tallow Cross', u: 0.645, v: 0.47, kind: 'village', port: false, owner: 'free', region: 'east', resources: ['grain', 'horses'] },
  { name: 'Calder Bay', u: 0.645, v: 0.635, kind: 'town', port: true, owner: 'free', region: 'south', resources: ['fish', 'wine'] },
  { name: 'Seravel', u: 0.585, v: 0.8, kind: 'city', port: true, owner: 'free', region: 'south', resources: ['wine', 'salt'], tier: 2 },
  // --- Korr (Emberfell)
  { name: 'Emberfell', u: 0.135, v: 0.255, kind: 'capital', port: true, owner: 'korr', region: 'emberfell', resources: ['iron', 'stone'], tier: 2, greatCapital: true },
  { name: 'Cinderhold', u: 0.085, v: 0.14, kind: 'fortress', port: false, owner: 'korr', region: 'emberfell', resources: ['iron'] },
  { name: 'Slagmoor', u: 0.07, v: 0.24, kind: 'village', port: true, owner: 'korr', region: 'emberfell', resources: ['stone', 'fish'] },
  // --- Tamsin (Greenholm)
  { name: 'Greenholm', u: 0.105, v: 0.695, kind: 'capital', port: true, owner: 'tamsin', region: 'greenholm', resources: ['grain', 'wool'], tier: 2, greatCapital: true },
  { name: 'Mistle', u: 0.07, v: 0.765, kind: 'village', port: true, owner: 'tamsin', region: 'greenholm', resources: ['grain', 'fish'] },
  { name: 'Fairhollow', u: 0.095, v: 0.635, kind: 'village', port: false, owner: 'tamsin', region: 'greenholm', resources: ['grain', 'wool'] },
  // --- Sabeline (Lirien)
  { name: 'Lirien', u: 0.625, v: 0.905, kind: 'capital', port: true, owner: 'sabeline', region: 'lirien', resources: ['silk', 'wine'], tier: 3, greatCapital: true },
  { name: 'Coralmouth', u: 0.565, v: 0.915, kind: 'village', port: true, owner: 'sabeline', region: 'lirien', resources: ['fish', 'salt'] },
  // --- Dray (Skarholm)
  { name: 'Skarholm', u: 0.832, v: 0.63, kind: 'capital', port: true, owner: 'dray', region: 'skarholm', resources: ['stone', 'fish'], tier: 2, greatCapital: true },
  { name: 'Seawatch', u: 0.838, v: 0.68, kind: 'village', port: true, owner: 'dray', region: 'skarholm', resources: ['fish'] },
  // --- Ostrevan (Norhaven)
  { name: 'Norhaven', u: 0.885, v: 0.3, kind: 'capital', port: true, owner: 'ostrevan', region: 'norhaven', resources: ['timber', 'fish'], tier: 3, greatCapital: true },
  { name: 'Skelde', u: 0.885, v: 0.445, kind: 'town', port: true, owner: 'ostrevan', region: 'norhaven', resources: ['fish', 'timber'] },
  { name: 'Holmgard', u: 0.925, v: 0.19, kind: 'fortress', port: false, owner: 'ostrevan', region: 'norhaven', resources: ['iron', 'furs'] },
  { name: 'Ravensea', u: 0.875, v: 0.37, kind: 'village', port: true, owner: 'ostrevan', region: 'norhaven', resources: ['timber'] },
  { name: 'Tern', u: 0.935, v: 0.33, kind: 'village', port: true, owner: 'ostrevan', region: 'norhaven', resources: ['fish'] },
];

export const REGION_NAMES: Record<string, string> = {
  west: 'Westmarch',
  center: 'The Heartlands',
  north: 'The Greyspine',
  east: 'The Amber Coast',
  south: 'The Sunward Shore',
  emberfell: 'Emberfell',
  greenholm: 'Greenholm',
  lirien: 'Lirien',
  skarholm: 'Skarholm',
  norhaven: 'Norhaven',
};

export const SEA_ZONES: { name: string; u: number; v: number }[] = [
  { name: 'Sunset Sea', u: 0.08, v: 0.45 },
  { name: 'Emberwater', u: 0.18, v: 0.1 },
  { name: 'Northern Deep', u: 0.6, v: 0.04 },
  { name: 'Strait of Dray', u: 0.82, v: 0.5 },
  { name: 'Gulf of Calder', u: 0.68, v: 0.72 },
  { name: 'Sunward Sea', u: 0.42, v: 0.92 },
  { name: 'Eastern Reach', u: 0.97, v: 0.7 },
  { name: 'Greenholm Sound', u: 0.16, v: 0.75 },
];
