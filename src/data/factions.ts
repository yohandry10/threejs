import type { Heraldry } from './heraldry';
import type { AIPersonality } from '../sim/types';

export interface ArchStyle {
  roof: string; // roof colour
  roof2: string;
  stone: string;
  plaster: string;
  timber: string;
  towerTop: 'cone' | 'crenel' | 'dome' | 'spire';
  wallHeight: number;
}

export interface FactionDef {
  id: string;
  house: string; // "House Aldmere"
  realm: string; // "Kingdom of Westmarch"
  short: string;
  motto: string;
  color: string;
  color2: string;
  heraldry: Heraldry;
  arch: ArchStyle;
  personality: AIPersonality;
  /** 0..1 behavioural weights */
  ai: { aggression: number; diplomacy: number; trade: number; naval: number; honor: number; caution: number; expansion: number };
  econ: { food: number; gold: number; trade: number; timber: number; stone: number; iron: number };
  /** unit stat multipliers & recruitment preferences */
  military: { favoured: string[]; unique?: string; meleeMul?: number; armorMul?: number; cavMul?: number; rangedMul?: number; navalMul?: number; recruitCostMul?: number };
  culture: string;
  island: boolean;
  playable: boolean;
  strengths: string[];
  militaryTendency: string;
  economicTendency: string;
  situation: string;
  startTreasury: number;
  maritime: boolean;
}

export const FACTIONS: FactionDef[] = [
  {
    id: 'aldmere',
    house: 'House Aldmere',
    realm: 'Kingdom of Westmarch',
    short: 'Aldmere',
    motto: 'We Reap What We Defend',
    color: '#2f6b3a',
    color2: '#d4af37',
    heraldry: { field: 'plain', tincture: '#2f6b3a', tincture2: '#d4af37', charge: 'sheaf', chargeColor: '#d8b441' },
    arch: { roof: '#6b3b2a', roof2: '#7a4a32', stone: '#b7ad98', plaster: '#e2d6bc', timber: '#4a3322', towerTop: 'cone', wallHeight: 1 },
    personality: 'diplomatic',
    ai: { aggression: 0.45, diplomacy: 0.7, trade: 0.5, naval: 0.45, honor: 0.75, caution: 0.5, expansion: 0.5 },
    econ: { food: 1.25, gold: 1.0, trade: 1.0, timber: 1.0, stone: 1.0, iron: 0.9 },
    military: { favoured: ['knights', 'spearmen', 'longbowmen', 'swordsmen'], unique: 'knights', armorMul: 1.05 },
    culture: 'west',
    island: false,
    playable: true,
    strengths: ['Fertile farmland feeds large armies', 'Armoured knights of renown', 'Coastal capital with a harbour'],
    militaryTendency: 'Feudal host: spear levies anchored by heavy knights.',
    economicTendency: 'Breadbasket of the west. Grain surplus, modest trade.',
    situation: 'Old grievance with Orsenne over Corvel. Warm ties with the Tamsins of Greenholm.',
    startTreasury: 1400,
    maritime: true,
  },
  {
    id: 'orsenne',
    house: 'House Orsenne',
    realm: 'Sunlit Dominion of Valmont',
    short: 'Orsenne',
    motto: 'The Plains Are Ours to Ride',
    color: '#9c1f24',
    color2: '#e0b84c',
    heraldry: { field: 'per_fess', tincture: '#9c1f24', tincture2: '#7a171b', charge: 'knight', chargeColor: '#e6c25a' },
    arch: { roof: '#a54a2e', roof2: '#b35a38', stone: '#cdbb99', plaster: '#ecdcc0', timber: '#5b3a25', towerTop: 'spire', wallHeight: 1.1 },
    personality: 'expansionist',
    ai: { aggression: 0.75, diplomacy: 0.4, trade: 0.45, naval: 0.3, honor: 0.4, caution: 0.3, expansion: 0.85 },
    econ: { food: 1.05, gold: 1.1, trade: 1.0, timber: 0.9, stone: 1.0, iron: 1.0 },
    military: { favoured: ['light_cavalry', 'heavy_cavalry', 'swordsmen', 'crossbowmen'], unique: 'heavy_cavalry', cavMul: 1.12 },
    culture: 'central',
    island: false,
    playable: true,
    strengths: ['Largest realm on the continent', 'Superb cavalry', 'Rich river-plains capital'],
    militaryTendency: 'Mounted host: fast horse and lance, crossbows in support.',
    economicTendency: 'Tax-rich heartland. Needs conquest to stay solvent.',
    situation: 'Hungry for the free towns of the east. Distrusted by every neighbour.',
    startTreasury: 1600,
    maritime: false,
  },
  {
    id: 'varrow',
    house: 'House Varrow',
    realm: 'Iron Holds of the Greyspine',
    short: 'Varrow',
    motto: 'Stone Endures',
    color: '#4b5563',
    color2: '#e5e7eb',
    heraldry: { field: 'chief', tincture: '#4b5563', tincture2: '#e5e7eb', charge: 'tower', chargeColor: '#eef0f2' },
    arch: { roof: '#3e4652', roof2: '#4a525e', stone: '#8c8e8c', plaster: '#c8c4b8', timber: '#3a2c20', towerTop: 'crenel', wallHeight: 1.3 },
    personality: 'defensive',
    ai: { aggression: 0.35, diplomacy: 0.45, trade: 0.35, naval: 0.25, honor: 0.8, caution: 0.75, expansion: 0.35 },
    econ: { food: 0.8, gold: 0.95, trade: 0.8, timber: 1.2, stone: 1.4, iron: 1.5 },
    military: { favoured: ['heavy_infantry', 'spearmen', 'crossbowmen'], unique: 'heavy_infantry', armorMul: 1.15 },
    culture: 'north',
    island: false,
    playable: true,
    strengths: ['Mountain fortresses and narrow passes', 'Iron and stone in abundance', 'Heavily armoured infantry'],
    militaryTendency: 'Shield walls of mailed infantry, crossbows on the ramparts.',
    economicTendency: 'Mines and quarries. Short of grain in hard winters.',
    situation: 'Guards the northern passes. Wary of Orsenne ambitions.',
    startTreasury: 1200,
    maritime: false,
  },
  {
    id: 'ostrevan',
    house: 'House Ostrevan',
    realm: 'Sea-Kingdom of Norhaven',
    short: 'Ostrevan',
    motto: 'The Tide Answers To Us',
    color: '#0f4c4c',
    color2: '#c98b3b',
    heraldry: { field: 'per_pale', tincture: '#0f4c4c', tincture2: '#123b3b', charge: 'ship', chargeColor: '#d49a47' },
    arch: { roof: '#2b3a36', roof2: '#3a4a44', stone: '#9a988c', plaster: '#d6cfbd', timber: '#3d2a1c', towerTop: 'crenel', wallHeight: 1.1 },
    personality: 'aggressive',
    ai: { aggression: 0.8, diplomacy: 0.35, trade: 0.4, naval: 0.95, honor: 0.45, caution: 0.35, expansion: 0.75 },
    econ: { food: 0.95, gold: 1.0, trade: 1.05, timber: 1.3, stone: 1.0, iron: 1.0 },
    military: { favoured: ['axemen', 'archers', 'swordsmen'], unique: 'axemen', navalMul: 1.2, meleeMul: 1.05 },
    culture: 'norse',
    island: true,
    playable: true,
    strengths: ['Great war fleets', 'Ferocious axe-armed raiders', 'Large island kingdom, hard to invade'],
    militaryTendency: 'Raiders and shipborne infantry. Masters of amphibious war.',
    economicTendency: 'Timber and fish. Lives off the sea lanes.',
    situation: 'Covets the eastern coast of the continent. Rival of Dray over the strait.',
    startTreasury: 1300,
    maritime: true,
  },
  {
    id: 'sabeline',
    house: 'House Sabeline',
    realm: 'Merchant Signory of Lirien',
    short: 'Sabeline',
    motto: 'Every Crown Has Its Price',
    color: '#5b2a86',
    color2: '#d8b04a',
    heraldry: { field: 'bordure', tincture: '#5b2a86', tincture2: '#d8b04a', charge: 'key', chargeColor: '#e4c261' },
    arch: { roof: '#b0643a', roof2: '#c27447', stone: '#e0d2b4', plaster: '#f2e6cc', timber: '#6a4a30', towerTop: 'dome', wallHeight: 1 },
    personality: 'mercantile',
    ai: { aggression: 0.25, diplomacy: 0.85, trade: 1.0, naval: 0.7, honor: 0.5, caution: 0.6, expansion: 0.35 },
    econ: { food: 0.9, gold: 1.25, trade: 1.5, timber: 0.9, stone: 1.0, iron: 0.9 },
    military: { favoured: ['crossbowmen', 'pikemen', 'light_cavalry'], unique: 'pikemen', recruitCostMul: 0.9 },
    culture: 'south',
    island: true,
    playable: true,
    strengths: ['Wealthiest trade network', 'Ports on island and mainland', 'Skilled diplomats'],
    militaryTendency: 'Paid professionals: crossbows and pikes, few but well equipped.',
    economicTendency: 'Trade empire. Gold flows from every agreement.',
    situation: 'Holds Ystra and Merrowgate on the mainland. Trades with all, trusted by few.',
    startTreasury: 2400,
    maritime: true,
  },
  {
    id: 'dray',
    house: 'House Dray',
    realm: 'Wardenry of Skarholm',
    short: 'Dray',
    motto: 'None Pass Unseen',
    color: '#1d2f5c',
    color2: '#c8ccd4',
    heraldry: { field: 'chevron', tincture: '#1d2f5c', tincture2: '#c8ccd4', charge: 'anchor', chargeColor: '#d8dce4' },
    arch: { roof: '#2c3444', roof2: '#374055', stone: '#7e8288', plaster: '#b9b8b0', timber: '#35291e', towerTop: 'crenel', wallHeight: 1.4 },
    personality: 'opportunistic',
    ai: { aggression: 0.55, diplomacy: 0.55, trade: 0.6, naval: 1.0, honor: 0.4, caution: 0.55, expansion: 0.45 },
    econ: { food: 0.75, gold: 1.1, trade: 1.2, timber: 0.9, stone: 1.2, iron: 1.0 },
    military: { favoured: ['crossbowmen', 'swordsmen', 'marines'], unique: 'marines', navalMul: 1.25 },
    culture: 'sea',
    island: true,
    playable: true,
    strengths: ['Impregnable fortress controlling the strait', 'Finest warships', 'Tolls on passing trade'],
    militaryTendency: 'Marines and crossbows. Fights at sea first.',
    economicTendency: 'Tolls and trade. Must import food.',
    situation: 'Small, proud and exposed. Norhaven eyes the strait.',
    startTreasury: 1500,
    maritime: true,
  },
  {
    id: 'korr',
    house: 'House Korr',
    realm: 'Forgeholds of Emberfell',
    short: 'Korr',
    motto: 'From Fire, Iron',
    color: '#241c1a',
    color2: '#d9651e',
    heraldry: { field: 'per_bend', tincture: '#241c1a', tincture2: '#3a2a24', charge: 'anvil', chargeColor: '#e0762c' },
    arch: { roof: '#2a2422', roof2: '#3b302b', stone: '#5e5650', plaster: '#a89e90', timber: '#2e231b', towerTop: 'crenel', wallHeight: 1.2 },
    personality: 'aggressive',
    ai: { aggression: 0.65, diplomacy: 0.35, trade: 0.55, naval: 0.6, honor: 0.55, caution: 0.45, expansion: 0.55 },
    econ: { food: 0.8, gold: 1.0, trade: 1.1, timber: 0.8, stone: 1.3, iron: 1.8 },
    military: { favoured: ['heavy_infantry', 'crossbowmen', 'swordsmen'], armorMul: 1.12 },
    culture: 'ember',
    island: true,
    playable: true,
    strengths: ['Richest iron mines in the realm', 'Superb arms and armour', 'Volcanic island fortress'],
    militaryTendency: 'Heavily equipped infantry. Sells steel to anyone with gold.',
    economicTendency: 'Iron exports. Food must be bought.',
    situation: 'Resents Varrow as a rival in the iron trade. Open to buyers.',
    startTreasury: 1300,
    maritime: true,
  },
  {
    id: 'tamsin',
    house: 'House Tamsin',
    realm: 'Lordship of Greenholm',
    short: 'Tamsin',
    motto: 'Deep Roots, Long Summers',
    color: '#3a79b8',
    color2: '#f1f1e6',
    heraldry: { field: 'quarterly', tincture: '#3a79b8', tincture2: '#f1f1e6', charge: 'oak', chargeColor: '#2f6b3a' },
    arch: { roof: '#5a6e3a', roof2: '#6b7f47', stone: '#c6bda6', plaster: '#efe6cf', timber: '#50392a', towerTop: 'cone', wallHeight: 0.9 },
    personality: 'diplomatic',
    ai: { aggression: 0.2, diplomacy: 0.9, trade: 0.6, naval: 0.5, honor: 0.85, caution: 0.7, expansion: 0.2 },
    econ: { food: 1.45, gold: 0.9, trade: 1.1, timber: 1.1, stone: 0.9, iron: 0.8 },
    military: { favoured: ['longbowmen', 'spearmen', 'militia'], unique: 'longbowmen', rangedMul: 1.12 },
    culture: 'green',
    island: true,
    playable: true,
    strengths: ['Abundant harvests', 'Famed longbowmen', 'Beloved by the realm'],
    militaryTendency: 'Longbows and spears. Prefers to defend.',
    economicTendency: 'Grain and wool exports. Stable and contented.',
    situation: 'Friendly to Aldmere. Its heir is unmarried and sought after.',
    startTreasury: 1100,
    maritime: true,
  },
];

export const INDEPENDENT: FactionDef = {
  id: 'free',
  house: 'Free Towns',
  realm: 'Free Towns of the East',
  short: 'Free Towns',
  motto: 'Our Charters, Our Walls',
  color: '#7a6a58',
  color2: '#e8dcc4',
  heraldry: { field: 'per_fess', tincture: '#7a6a58', tincture2: '#e8dcc4', charge: 'star', chargeColor: '#2a2418' },
  arch: { roof: '#8a5a3a', roof2: '#9a6a48', stone: '#c2b59a', plaster: '#e8dcc4', timber: '#553a26', towerTop: 'cone', wallHeight: 1 },
  personality: 'defensive',
  ai: { aggression: 0, diplomacy: 0.3, trade: 0.6, naval: 0, honor: 0.6, caution: 1, expansion: 0 },
  econ: { food: 1, gold: 1, trade: 1.1, timber: 1, stone: 1, iron: 1 },
  military: { favoured: ['militia', 'spearmen', 'crossbowmen'] },
  culture: 'south',
  island: false,
  playable: false,
  strengths: [],
  militaryTendency: 'Town militias behind stout walls.',
  economicTendency: 'Chartered trade towns.',
  situation: 'Independent towns courted and threatened by every great house.',
  startTreasury: 600,
  maritime: false,
};

export const REBELS: FactionDef = {
  ...INDEPENDENT,
  id: 'rebels',
  house: 'Rebels',
  realm: 'Rebel Host',
  short: 'Rebels',
  motto: 'No Crown But Our Own',
  color: '#3a3533',
  color2: '#b3342c',
  heraldry: { field: 'per_bend', tincture: '#3a3533', tincture2: '#b3342c', charge: 'swords', chargeColor: '#d8d0c0' },
  personality: 'aggressive',
  ai: { aggression: 1, diplomacy: 0, trade: 0, naval: 0, honor: 0, caution: 0.2, expansion: 0.5 },
};

export const PIRATES: FactionDef = {
  ...INDEPENDENT,
  id: 'pirates',
  house: 'Corsairs',
  realm: 'Corsair Brotherhood',
  short: 'Corsairs',
  motto: 'The Sea Takes',
  color: '#1c1c1c',
  color2: '#d0d0d0',
  heraldry: { field: 'plain', tincture: '#1c1c1c', tincture2: '#d0d0d0', charge: 'swords', chargeColor: '#d8d8d8' },
  personality: 'aggressive',
  ai: { aggression: 1, diplomacy: 0, trade: 0, naval: 1, honor: 0, caution: 0.3, expansion: 0 },
  maritime: true,
};

export const ALL_FACTION_DEFS: FactionDef[] = [...FACTIONS, INDEPENDENT, REBELS, PIRATES];
const defMap = new Map(ALL_FACTION_DEFS.map((f) => [f.id, f]));
export function factionDef(id: string): FactionDef {
  return defMap.get(id) ?? INDEPENDENT;
}
export const isMajor = (id: string) => FACTIONS.some((f) => f.id === id);
