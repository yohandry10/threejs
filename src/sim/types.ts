/**
 * Authoritative campaign game state. Everything here is plain JSON-serialisable data.
 * The renderer, UI and audio only read this state and react to events.
 */
export type FactionId = string;
export type CharId = number;
export type ProvinceId = number;

export type Season = 0 | 1 | 2 | 3; // spring, summer, autumn, winter
export type Gender = 'm' | 'f';

export type SkillSet = { command: number; diplomacy: number; stewardship: number; intrigue: number };

export interface PortraitGenes {
  skin: number; // 0..5
  hair: number; // colour index
  hairStyle: number;
  beard: number;
  eyes: number;
  face: number;
  nose: number;
  brow: number;
}

export type CharacterRole = 'ruler' | 'consort' | 'heir' | 'family' | 'courtier' | 'general' | 'admiral' | 'knight';
export type CouncilSeat = 'chancellor' | 'marshal' | 'steward' | 'spymaster' | 'admiral';
export const COUNCIL_SEATS: CouncilSeat[] = ['chancellor', 'marshal', 'steward', 'spymaster', 'admiral'];

export interface Claim {
  kind: 'throne' | 'province';
  /** faction id for throne claims, province id for province claims */
  target: string | number;
  strength: number; // 1 weak .. 3 strong
  source: 'inheritance' | 'marriage' | 'history' | 'fabricated' | 'succession';
  sinceTurn: number;
}

export interface Character {
  id: CharId;
  name: string;
  dynasty: string; // house name key (faction id for great houses, or minor house key)
  faction: FactionId | null; // allegiance
  gender: Gender;
  birthTurn: number;
  alive: boolean;
  deathTurn?: number;
  deathCause?: string;
  father?: CharId;
  mother?: CharId;
  spouse?: CharId;
  formerSpouses?: CharId[];
  children: CharId[];
  traits: string[];
  skills: SkillSet;
  loyalty: number; // 0..100
  prestige: number;
  health: number; // 0..100
  wounded?: number; // turns remaining
  role: CharacterRole;
  council?: CouncilSeat;
  armyId?: number;
  fleetId?: number;
  location?: ProvinceId;
  claims: Claim[];
  /** personal opinions of other characters: rival (<-40) / friend (>40) */
  relations: Record<string, number>;
  genes: PortraitGenes;
  xp: number; // command experience
  battlesWon: number;
  battlesLost: number;
  isKnight?: boolean;
  title?: string;
}

export interface BuildingInstance {
  id: string; // building def id
  level: number;
  damaged?: boolean;
}

export interface ConstructionJob {
  building: string;
  level: number;
  turnsLeft: number;
  totalTurns: number;
}

export interface RecruitJob {
  unitType: string;
  turnsLeft: number;
  /** army to join when complete (if still present in the province), else garrison / new army */
  targetArmy?: number;
  ship?: boolean;
}

export interface UnitState {
  uid: number;
  type: string;
  troops: number;
  maxTroops: number;
  xp: number; // 0..9 chevrons (float xp internally 0..900)
}

export interface ShipState {
  uid: number;
  type: string;
  hull: number; // current hit points
  maxHull: number;
  crew: number;
  maxCrew: number;
  xp: number;
  name: string;
}

export interface SettlementState {
  name: string;
  tier: number; // 0 village, 1 town, 2 city, 3 great city
  isPort: boolean;
  fortress: boolean;
  buildings: BuildingInstance[];
  construction: ConstructionJob[];
  recruitment: RecruitJob[];
  garrison: UnitState[];
  walls: number; // 0 none, 1 palisade, 2 stone, 3 great walls
  gateHp: number;
}

export interface SiegeState {
  armyId: number;
  faction: FactionId;
  turns: number;
  equipment: number; // siege works progress (rams/ladders built)
}

export interface ProvinceState {
  id: ProvinceId;
  owner: FactionId;
  settlement: SettlementState;
  population: number;
  publicOrder: number; // -100..100
  development: number; // 0..10
  food: number; // net food last turn (derived, stored for UI)
  taxValue: number; // derived last turn
  income: number; // derived last turn
  unrest: number; // turns of low order
  conqueredTurn?: number;
  previousOwners: { faction: FactionId; untilTurn: number }[];
  siege?: SiegeState;
  blockaded?: boolean;
  governor?: CharId;
  sacked?: number; // turn of last sack
}

export type ArmyStance = 'normal' | 'fortify' | 'raid' | 'siege' | 'forced';

export interface ArmyState {
  id: number;
  faction: FactionId;
  name: string;
  general?: CharId;
  units: UnitState[];
  x: number;
  z: number;
  cell: number; // nav cell index
  path: number[]; // remaining nav cells
  movePoints: number;
  maxMovePoints: number;
  stance: ArmyStance;
  supply: number; // 0..100
  embarked?: number; // fleet id carrying this army
  siegeOf?: ProvinceId;
  lastMoveTurn?: number;
  morale: number; // campaign-level morale 0..100
  isRebel?: boolean;
  claimant?: CharId;
  retreated?: boolean;
}

export type FleetOrder = 'idle' | 'move' | 'patrol' | 'blockade' | 'escort' | 'transport' | 'return';

export interface FleetState {
  id: number;
  faction: FactionId;
  name: string;
  admiral?: CharId;
  ships: ShipState[];
  x: number;
  z: number;
  cell: number;
  path: number[];
  movePoints: number;
  maxMovePoints: number;
  order: FleetOrder;
  orderTarget?: number; // province id for blockade / patrol origin
  patrolPoints?: number[];
  carrying: number[]; // army ids
  inPort?: ProvinceId;
  isPirate?: boolean;
}

export type TreatyType = 'alliance' | 'defensive' | 'trade' | 'access' | 'vassal' | 'tribute' | 'nonaggression';

export interface Treaty {
  type: TreatyType;
  a: FactionId; // for vassal: a = overlord, b = vassal; tribute: a pays b; access: a grants access to b
  b: FactionId;
  since: number;
  until?: number;
  amount?: number;
}

export interface OpinionModifier {
  from: FactionId; // who holds the opinion
  to: FactionId;
  kind: string;
  label: string;
  value: number;
  decay: number; // value moved towards 0 each turn
  expires?: number;
}

export interface War {
  id: number;
  name: string;
  attackers: FactionId[];
  defenders: FactionId[];
  leaderA: FactionId;
  leaderD: FactionId;
  startTurn: number;
  score: number; // positive favours attackers (-100..100)
  goal?: { kind: 'claim' | 'conquest' | 'subjugate' | 'independence'; province?: ProvinceId };
  battles: number;
  casualtiesA: number;
  casualtiesD: number;
}

export interface DiplomacyState {
  /** base opinion matrix "a>b" -> static base value (history etc) */
  base: Record<string, number>;
  modifiers: OpinionModifier[];
  treaties: Treaty[];
  wars: War[];
  truces: { a: FactionId; b: FactionId; until: number }[];
  /** reputation (trustworthiness) per faction 0..100 */
  reputation: Record<FactionId, number>;
  nextWarId: number;
}

export type AIPersonality = 'aggressive' | 'diplomatic' | 'defensive' | 'opportunistic' | 'mercantile' | 'expansionist';

export interface IntrigueOp {
  id: number;
  faction: FactionId;
  kind: 'intel' | 'sabotage' | 'opposition' | 'fabricate';
  target: FactionId;
  third?: FactionId;
  province?: ProvinceId;
  turnsLeft: number;
  chance: number;
  detectChance: number;
}

export interface Objective {
  id: string;
  kind: 'ports' | 'alliance' | 'island' | 'treasury' | 'region' | 'marriage' | 'claim';
  label: string;
  target?: string | number;
  amount?: number;
  reward: { gold?: number; prestige?: number; legitimacy?: number };
  done: boolean;
}

export interface FactionState {
  id: FactionId;
  alive: boolean;
  ruler: CharId;
  heir?: CharId;
  capital: ProvinceId;
  treasury: number;
  food: number; // stored grain
  timber: number;
  stone: number;
  iron: number;
  prestige: number;
  legitimacy: number;
  taxLevel: 0 | 1 | 2 | 3; // low normal high extortionate
  council: Partial<Record<CouncilSeat, CharId>>;
  personality: AIPersonality;
  succession: 'primogeniture' | 'agnatic' | 'elective';
  explored?: string; // base64 bitset (player only)
  intelOn: Record<FactionId, number>; // until turn
  lastIncome: IncomeBreakdown;
  debtTurns: number;
  starvingTurns: number;
  rulerSinceTurn: number;
  pastRulers: CharId[];
  objectives: Objective[];
  isRebel?: boolean;
  warWeariness: number;
  aiMemory: Record<string, number>;
}

export interface IncomeBreakdown {
  tax: number;
  trade: number;
  buildings: number;
  tribute: number;
  armyUpkeep: number;
  fleetUpkeep: number;
  courtUpkeep: number;
  grainImports?: number;
  net: number;
  food: number;
  foodProduced: number;
  foodConsumed: number;
  timber: number;
  stone: number;
  iron: number;
}

export interface PendingDecision {
  id: number;
  kind: 'event' | 'proposal' | 'battle' | 'capture' | 'succession' | 'peace_offer';
  faction: FactionId;
  eventId?: string;
  title: string;
  text: string;
  options: { id: string; label: string; tooltip?: string }[];
  data?: Record<string, unknown>;
  turn: number;
}

export interface ChronicleEntry {
  turn: number;
  text: string;
  factions: FactionId[];
  kind: string;
}

export interface Notification {
  id: number;
  turn: number;
  kind: 'info' | 'war' | 'diplomacy' | 'dynasty' | 'economy' | 'military' | 'danger' | 'construction';
  title: string;
  text: string;
  focus?: { x: number; z: number };
  read?: boolean;
}

export interface TradeRoute {
  a: ProvinceId;
  b: ProvinceId;
  sea: boolean;
  value: number;
  active: boolean;
  factionA: FactionId;
  factionB: FactionId;
}

export interface WeatherState {
  /** per climate region condition */
  regions: Record<string, WeatherKind>;
}
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

export interface GameState {
  version: number;
  worldSeed: number;
  campaignSeed: number;
  rng: number;
  turn: number;
  startYear: number;
  player: FactionId;
  difficulty: number;
  factions: Record<FactionId, FactionState>;
  characters: Record<number, Character>;
  provinces: ProvinceState[];
  armies: Record<number, ArmyState>;
  fleets: Record<number, FleetState>;
  diplomacy: DiplomacyState;
  tradeRoutes: TradeRoute[];
  intrigue: IntrigueOp[];
  decisions: PendingDecision[];
  chronicle: ChronicleEntry[];
  notifications: Notification[];
  weather: WeatherState;
  ids: { char: number; army: number; fleet: number; unit: number; decision: number; notif: number; op: number };
  victory?: { faction: FactionId; kind: string; turn: number };
  tutorial: { step: number; done: boolean; enabled: boolean };
  stats: { battles: number; sieges: number; marriages: number; successions: number; wars: number };
}

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const seasonOf = (turn: number): Season => (turn % 4) as Season;
export const yearOf = (s: GameState, turn = s.turn) => s.startYear + Math.floor(turn / 4);
export const ageOf = (c: Character, turn: number) => Math.floor((turn - c.birthTurn) / 4);
