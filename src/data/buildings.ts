export type BuildingCategory = 'economic' | 'military' | 'defensive' | 'maritime' | 'administrative';

export interface BuildingLevel {
  name: string;
  cost: number;
  timber: number;
  stone: number;
  iron: number;
  turns: number;
  effects: BuildingEffects;
  minTier?: number;
}

export interface BuildingEffects {
  food?: number;
  gold?: number;
  goldPct?: number;
  trade?: number;
  timber?: number;
  stone?: number;
  iron?: number;
  order?: number;
  growth?: number;
  prestige?: number;
  legitimacy?: number;
  walls?: number;
  towers?: number;
  gateHp?: number;
  garrison?: number;
  recruitDiscount?: number;
  xp?: number;
  armor?: number;
  vision?: number;
  repair?: boolean;
  shipyard?: boolean;
  capacity?: number;
}

export interface BuildingDef {
  id: string;
  category: BuildingCategory;
  desc: string;
  requiresPort?: boolean;
  requiresResource?: string[];
  requiresBuilding?: string;
  levels: BuildingLevel[];
}

const L = (name: string, cost: number, timber: number, stone: number, iron: number, turns: number, effects: BuildingEffects, minTier = 0): BuildingLevel => ({ name, cost, timber, stone, iron, turns, effects, minTier });

export const BUILDINGS: BuildingDef[] = [
  { id: 'farm', category: 'economic', desc: 'Fields and granaries. Increases food production and growth.', levels: [L('Farmland', 200, 20, 0, 0, 2, { food: 60, growth: 0.004 }), L('Great Estates', 520, 40, 30, 0, 3, { food: 130, growth: 0.007 }, 1)] },
  { id: 'fishery', category: 'economic', requiresPort: true, desc: 'Fishing fleet and smokehouses. Food and a little gold.', levels: [L('Fishery', 220, 40, 0, 0, 2, { food: 50, gold: 20 }), L('Great Fishery', 480, 60, 20, 0, 3, { food: 95, gold: 45 }, 1)] },
  { id: 'market', category: 'economic', desc: 'Trade hall and market square. Gold and trade value.', levels: [L('Market', 300, 30, 20, 0, 2, { gold: 60, trade: 0.25, order: 2 }), L('Merchant Quarter', 700, 40, 60, 0, 3, { gold: 140, trade: 0.5, order: 3 }, 2)] },
  { id: 'mine', category: 'economic', requiresResource: ['iron', 'stone'], desc: 'Mines and quarries. Iron and stone output.', levels: [L('Mine', 320, 40, 0, 0, 2, { iron: 30, stone: 30, gold: 30 }), L('Deep Mine', 680, 60, 30, 20, 3, { iron: 60, stone: 55, gold: 70 }, 1)] },
  { id: 'lumber', category: 'economic', requiresResource: ['timber'], desc: 'Sawmills and logging camps. Timber output.', levels: [L('Lumber Yard', 220, 0, 10, 0, 1, { timber: 45, gold: 10 }), L('Sawmill', 460, 20, 30, 10, 2, { timber: 90, gold: 25 }, 1)] },
  { id: 'workshop', category: 'economic', desc: 'Smiths and crafts. Gold, unlocks crossbows and better equipment.', levels: [L('Workshop', 380, 40, 30, 20, 2, { gold: 50, armor: 2 }, 1), L('Guild Halls', 760, 50, 60, 40, 3, { gold: 110, armor: 4 }, 2)] },
  { id: 'barracks', category: 'military', desc: 'Drill yard. Recruits infantry.', levels: [L('Barracks', 260, 50, 20, 10, 1, { garrison: 1 }), L('Drill Grounds', 560, 60, 60, 30, 2, { garrison: 2, xp: 1 }, 1)] },
  { id: 'archery_range', category: 'military', desc: 'Butts and fletchers. Recruits archers and crossbowmen.', levels: [L('Archery Range', 240, 60, 10, 5, 1, {}), L('Master Fletchers', 520, 70, 30, 10, 2, { xp: 1 }, 1)] },
  { id: 'stables', category: 'military', desc: 'Horse breeding. Recruits cavalry.', levels: [L('Stables', 320, 60, 20, 10, 2, {}), L('Royal Stud', 700, 80, 50, 20, 3, { xp: 1 }, 1)] },
  { id: 'armory', category: 'military', desc: 'Armourers. Heavy troops and better armour for recruits.', levels: [L('Armory', 480, 30, 50, 40, 2, { armor: 3 }, 1), L('Great Armory', 900, 40, 80, 80, 3, { armor: 6 }, 2)] },
  { id: 'siege_workshop', category: 'military', desc: 'Engineers and carpenters. Builds rams, mangonels and trebuchets.', levels: [L('Siege Workshop', 420, 90, 30, 20, 2, {}, 1)] },
  { id: 'walls', category: 'defensive', desc: 'Fortifications. Enables sieges, protects the garrison.', levels: [L('Palisade', 260, 80, 0, 0, 2, { walls: 1, order: 2, garrison: 1, gateHp: 600 }), L('Stone Walls', 720, 40, 160, 20, 3, { walls: 2, order: 4, garrison: 2, gateHp: 1200 }, 1), L('Great Walls', 1400, 60, 320, 40, 4, { walls: 3, order: 6, garrison: 3, gateHp: 2000 }, 2)] },
  { id: 'towers', category: 'defensive', requiresBuilding: 'walls', desc: 'Watchtowers and wall towers. Vision and arrow fire in sieges.', levels: [L('Watchtowers', 280, 40, 50, 5, 2, { towers: 2, vision: 3 }), L('Bastions', 640, 40, 140, 20, 3, { towers: 4, vision: 5 }, 1)] },
  { id: 'gatehouse', category: 'defensive', requiresBuilding: 'walls', desc: 'Fortified gatehouse. Greatly strengthens the gate.', levels: [L('Fortified Gate', 340, 30, 80, 30, 2, { gateHp: 900 }, 1)] },
  { id: 'harbor', category: 'maritime', requiresPort: true, desc: 'Piers and warehouses. Trade, transports, fleet repair.', levels: [L('Harbor', 360, 80, 30, 0, 2, { trade: 0.3, gold: 30, repair: true, capacity: 1 }), L('Great Harbor', 780, 120, 80, 10, 3, { trade: 0.6, gold: 70, repair: true, capacity: 2 }, 1)] },
  { id: 'shipyard', category: 'maritime', requiresPort: true, requiresBuilding: 'harbor', desc: 'Slipways and ropewalks. Builds warships.', levels: [L('Shipyard', 520, 140, 40, 20, 2, { shipyard: true }), L('Royal Dockyard', 980, 200, 80, 40, 3, { shipyard: true, xp: 1 }, 2)] },
  { id: 'trade_docks', category: 'maritime', requiresPort: true, requiresBuilding: 'harbor', desc: 'Bonded warehouses and customs houses. Sea trade value.', levels: [L('Trade Docks', 460, 70, 40, 0, 2, { trade: 0.5, gold: 50 }, 1)] },
  { id: 'manor', category: 'administrative', desc: "Lord's manor. Order, administration and noble loyalty.", levels: [L('Manor', 300, 40, 40, 0, 2, { order: 6, gold: 20 }), L('Castle Keep', 820, 60, 140, 20, 3, { order: 10, gold: 40, garrison: 1, prestige: 1 }, 1)] },
  { id: 'council_hall', category: 'administrative', desc: 'Seat of counsel. Prestige, legitimacy and diplomacy.', levels: [L('Council Hall', 600, 60, 90, 10, 3, { prestige: 2, legitimacy: 1, order: 3 }, 2)] },
  { id: 'treasury', category: 'administrative', desc: 'Royal treasury and mint. Raises gold income.', levels: [L('Treasury', 700, 30, 110, 30, 3, { goldPct: 0.1, order: 1 }, 2)] },
];

const bmap = new Map(BUILDINGS.map((b) => [b.id, b]));
export const buildingDef = (id: string) => bmap.get(id)!;

/** Settlement upgrade (tier) definitions */
export const TIERS = [
  { name: 'Village', slots: 4, popCap: 2500, upgradeCost: 0, upgradePop: 0, turns: 0 },
  { name: 'Town', slots: 6, popCap: 7000, upgradeCost: 600, upgradePop: 2000, turns: 3 },
  { name: 'City', slots: 8, popCap: 16000, upgradeCost: 1400, upgradePop: 6000, turns: 4 },
  { name: 'Great City', slots: 10, popCap: 30000, upgradeCost: 2600, upgradePop: 14000, turns: 5 },
];
