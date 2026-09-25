export interface TraitDef {
  id: string;
  name: string;
  desc: string;
  skills?: Partial<{ command: number; diplomacy: number; stewardship: number; intrigue: number }>;
  morale?: number;
  loyalty?: number;
  prestige?: number;
  legitimacy?: number;
  health?: number;
  opposite?: string;
  ai?: Partial<{ aggression: number; diplomacy: number; honor: number; caution: number }>;
  good: boolean;
}

export const TRAITS: TraitDef[] = [
  { id: 'brave', name: 'Brave', desc: 'Leads from the front. +Command, troops fight harder; more likely to fall in battle.', skills: { command: 2 }, morale: 6, opposite: 'craven', ai: { aggression: 0.15, caution: -0.1 }, good: true },
  { id: 'craven', name: 'Craven', desc: 'Avoids danger. Troops lose heart.', skills: { command: -2 }, morale: -6, opposite: 'brave', ai: { caution: 0.2, aggression: -0.15 }, good: false },
  { id: 'cautious', name: 'Cautious', desc: 'Careful planner. Better defence, fewer rash wars.', skills: { command: 1 }, opposite: 'ambitious', ai: { caution: 0.2, aggression: -0.1 }, good: true },
  { id: 'ambitious', name: 'Ambitious', desc: 'Hungry for power. +Skills, but loyalty is fragile and claims get pressed.', skills: { command: 1, diplomacy: 1, intrigue: 1 }, loyalty: -15, ai: { aggression: 0.15 }, good: true },
  { id: 'diplomatic', name: 'Diplomatic', desc: 'A natural envoy. +Diplomacy, better relations.', skills: { diplomacy: 3 }, ai: { diplomacy: 0.2 }, good: true },
  { id: 'cruel', name: 'Cruel', desc: 'Feared rather than loved. +Intrigue, -Diplomacy, subjects cowed.', skills: { intrigue: 2, diplomacy: -2 }, opposite: 'generous', ai: { honor: -0.2, aggression: 0.1 }, good: false },
  { id: 'generous', name: 'Generous', desc: 'Open-handed. +Loyalty and diplomacy, costlier court.', skills: { diplomacy: 1 }, loyalty: 10, opposite: 'cruel', good: true },
  { id: 'strategist', name: 'Strategist', desc: 'Master of the field. Large command bonus.', skills: { command: 4 }, morale: 4, good: true },
  { id: 'merchant', name: 'Merchant Mind', desc: 'Understands coin. +Stewardship, trade income.', skills: { stewardship: 3 }, good: true },
  { id: 'loyal', name: 'Loyal', desc: 'Steadfast to liege and house.', loyalty: 25, good: true },
  { id: 'scholar', name: 'Scholar', desc: 'Learned and shrewd. +Stewardship and intrigue.', skills: { stewardship: 2, intrigue: 1 }, good: true },
  { id: 'just', name: 'Just', desc: 'Renowned for fair rule. +Legitimacy.', legitimacy: 8, skills: { stewardship: 1 }, ai: { honor: 0.2 }, good: true },
  { id: 'deceitful', name: 'Deceitful', desc: 'A liar and schemer. +Intrigue, less trusted.', skills: { intrigue: 3, diplomacy: -1 }, ai: { honor: -0.25 }, good: false },
  { id: 'sickly', name: 'Sickly', desc: 'Poor health. Shorter life expectancy.', health: -25, good: false },
  { id: 'robust', name: 'Robust', desc: 'Hale and strong. Longer life expectancy.', health: 15, skills: { command: 1 }, good: true },
  { id: 'wounded', name: 'Wounded', desc: 'Carries a grievous wound from battle.', health: -15, good: false },
  { id: 'seafarer', name: 'Seafarer', desc: 'Born to the sea. Great admiral.', skills: { command: 2 }, good: true },
  { id: 'veteran', name: 'Veteran', desc: 'Has seen many battles. +Command and morale.', skills: { command: 2 }, morale: 5, good: true },
  { id: 'lustful', name: 'Passionate', desc: 'Fertile and restless.', good: true },
  { id: 'pious', name: 'Devout', desc: 'Respected by the clergy. +Legitimacy and order.', legitimacy: 5, good: true },
];

const tmap = new Map(TRAITS.map((t) => [t.id, t]));
export const traitDef = (id: string) => tmap.get(id);
