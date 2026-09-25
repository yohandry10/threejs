import { factionDef, isMajor } from '../data/factions';
import { canMarry, fullName, marry, skillOf, updateHeir, age } from './characters';
import type { Sim } from './context';
import { armyPower, fleetPower } from './military';
import type { FactionId, OpinionModifier, Treaty, TreatyType, War } from './types';

export const pairKey = (a: FactionId, b: FactionId) => `${a}>${b}`;

export function addModifier(sim: Sim, from: FactionId, to: FactionId, kind: string, label: string, value: number, decay = 1, duration?: number) {
  const d = sim.s.diplomacy;
  const ex = d.modifiers.find((m) => m.from === from && m.to === to && m.kind === kind);
  if (ex) {
    ex.value = Math.max(-100, Math.min(100, ex.value + value));
    ex.label = label;
    ex.decay = decay;
    if (duration) ex.expires = sim.s.turn + duration;
    return;
  }
  d.modifiers.push({ from, to, kind, label, value, decay, expires: duration ? sim.s.turn + duration : undefined });
}

export function hasTreaty(sim: Sim, a: FactionId, b: FactionId, type: TreatyType): boolean {
  return sim.s.diplomacy.treaties.some((t) => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}
export function treatyBetween(sim: Sim, a: FactionId, b: FactionId, type: TreatyType): Treaty | undefined {
  return sim.s.diplomacy.treaties.find((t) => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}
export function removeTreaty(sim: Sim, a: FactionId, b: FactionId, type: TreatyType) {
  const d = sim.s.diplomacy;
  d.treaties = d.treaties.filter((t) => !(t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a))));
}
export function addTreaty(sim: Sim, t: Treaty) {
  removeTreaty(sim, t.a, t.b, t.type);
  sim.s.diplomacy.treaties.push(t);
  sim.emit({ type: 'TREATY_SIGNED', treaty: t });
}

export function overlordOf(sim: Sim, f: FactionId): FactionId | undefined {
  return sim.s.diplomacy.treaties.find((t) => t.type === 'vassal' && t.b === f)?.a;
}
export function vassalsOf(sim: Sim, f: FactionId): FactionId[] {
  return sim.s.diplomacy.treaties.filter((t) => t.type === 'vassal' && t.a === f).map((t) => t.b);
}

export function warBetween(sim: Sim, a: FactionId, b: FactionId): War | undefined {
  return sim.s.diplomacy.wars.find((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)));
}
export function atWar(sim: Sim, a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  if (a === 'rebels' || b === 'rebels' || a === 'pirates' || b === 'pirates') return true;
  return !!warBetween(sim, a, b);
}
export function enemiesOf(sim: Sim, f: FactionId): FactionId[] {
  const out = new Set<FactionId>();
  for (const w of sim.s.diplomacy.wars) {
    if (w.attackers.includes(f)) w.defenders.forEach((x) => out.add(x));
    if (w.defenders.includes(f)) w.attackers.forEach((x) => out.add(x));
  }
  return [...out];
}
export function alliesOf(sim: Sim, f: FactionId): FactionId[] {
  return sim.s.diplomacy.treaties.filter((t) => t.type === 'alliance' && (t.a === f || t.b === f)).map((t) => (t.a === f ? t.b : t.a));
}
export function isAllied(sim: Sim, a: FactionId, b: FactionId) {
  return a === b || hasTreaty(sim, a, b, 'alliance') || overlordOf(sim, a) === b || overlordOf(sim, b) === a;
}
export function hasTruce(sim: Sim, a: FactionId, b: FactionId) {
  return sim.s.diplomacy.truces.some((t) => ((t.a === a && t.b === b) || (t.a === b && t.b === a)) && t.until > sim.s.turn);
}
export function canPass(sim: Sim, mover: FactionId, owner: FactionId) {
  if (mover === owner || owner === undefined) return true;
  if (atWar(sim, mover, owner)) return true;
  if (isAllied(sim, mover, owner)) return true;
  if (sim.s.diplomacy.treaties.some((t) => t.type === 'access' && t.a === owner && t.b === mover)) return true;
  return false;
}

/** Marriage ties between the ruling families of two factions */
export function marriageTies(sim: Sim, a: FactionId, b: FactionId): number {
  let n = 0;
  for (const c of Object.values(sim.s.characters)) {
    if (!c.alive || c.spouse === undefined) continue;
    const sp = sim.s.characters[c.spouse];
    if (!sp || !sp.alive) continue;
    if (c.id > sp.id) continue;
    const fa = [c.dynasty, c.faction];
    const fb = [sp.dynasty, sp.faction];
    if ((fa.includes(a) && fb.includes(b)) || (fa.includes(b) && fb.includes(a))) {
      if ((c.dynasty === a || c.dynasty === b) && (sp.dynasty === a || sp.dynasty === b) && c.dynasty !== sp.dynasty) n++;
    }
  }
  return n;
}

export function claimsOn(sim: Sim, holder: FactionId, target: FactionId): number {
  let n = 0;
  const f = sim.fac(holder);
  if (!f) return 0;
  for (const c of Object.values(sim.s.characters)) {
    if (!c.alive || c.faction !== holder) continue;
    for (const cl of c.claims) {
      if (cl.kind === 'province' && sim.s.provinces[cl.target as number]?.owner === target) n += cl.strength;
      if (cl.kind === 'throne' && cl.target === target) n += cl.strength;
    }
  }
  return n;
}

export function provinceClaims(sim: Sim, fid: FactionId): number[] {
  const out = new Set<number>();
  for (const c of Object.values(sim.s.characters)) {
    if (!c.alive || c.faction !== fid) continue;
    for (const cl of c.claims) if (cl.kind === 'province') out.add(cl.target as number);
  }
  return [...out];
}

export function areNeighbours(sim: Sim, a: FactionId, b: FactionId): boolean {
  for (const p of sim.s.provinces) {
    if (p.owner !== a) continue;
    for (const n of sim.geo.provinces[p.id].neighbors) if (sim.s.provinces[n].owner === b) return true;
  }
  return false;
}

export function militaryStrength(sim: Sim, f: FactionId): number {
  let p = 0;
  for (const a of Object.values(sim.s.armies)) if (a.faction === f) p += armyPower(sim, a);
  for (const fl of Object.values(sim.s.fleets)) if (fl.faction === f) p += fleetPower(sim, fl) * 0.4;
  for (const pr of sim.s.provinces) if (pr.owner === f) p += pr.settlement.garrison.reduce((s, u) => s + u.troops, 0) * 0.08;
  return p;
}

export interface OpinionPart {
  label: string;
  value: number;
}

export function opinionBreakdown(sim: Sim, a: FactionId, b: FactionId): OpinionPart[] {
  const parts: OpinionPart[] = [];
  if (a === b) return [{ label: 'Self', value: 100 }];
  const d = sim.s.diplomacy;
  const base = d.base[pairKey(a, b)] ?? 0;
  if (base) parts.push({ label: 'Longstanding sentiment', value: base });
  for (const m of d.modifiers) if (m.from === a && m.to === b && Math.round(m.value) !== 0) parts.push({ label: m.label, value: Math.round(m.value) });
  if (atWar(sim, a, b)) parts.push({ label: 'At war', value: -50 });
  if (hasTreaty(sim, a, b, 'alliance')) parts.push({ label: 'Allies', value: 25 });
  else if (hasTreaty(sim, a, b, 'defensive')) parts.push({ label: 'Defensive pact', value: 15 });
  if (hasTreaty(sim, a, b, 'trade')) parts.push({ label: 'Trade agreement', value: 10 });
  if (overlordOf(sim, a) === b) parts.push({ label: 'Our overlord', value: 10 });
  if (overlordOf(sim, b) === a) parts.push({ label: 'Our vassal', value: 15 });
  const ties = marriageTies(sim, a, b);
  if (ties) parts.push({ label: 'Royal marriages', value: Math.min(40, ties * 15) });
  const cl = claimsOn(sim, b, a);
  if (cl) parts.push({ label: 'They claim our lands', value: -Math.min(30, cl * 6) });
  const enemiesA = enemiesOf(sim, a);
  const common = enemiesOf(sim, b).filter((x) => enemiesA.includes(x) && isMajor(x));
  if (common.length) parts.push({ label: 'Common enemies', value: Math.min(30, common.length * 15) });
  if (areNeighbours(sim, a, b)) parts.push({ label: 'Border friction', value: factionDef(a).ai.expansion > 0.6 ? -10 : -5 });
  const rep = d.reputation[b] ?? 60;
  if (rep < 45) parts.push({ label: 'Untrustworthy', value: -Math.round((45 - rep) * 0.6) });
  else if (rep > 75) parts.push({ label: 'Honourable reputation', value: Math.round((rep - 75) * 0.4) });
  const pa = sim.fac(a)?.prestige ?? 0;
  const pb = sim.fac(b)?.prestige ?? 0;
  if (pb > pa * 1.5 && pb > 200) parts.push({ label: 'Respects their prestige', value: 6 });
  const leg = sim.fac(b)?.legitimacy ?? 50;
  if (leg < 30) parts.push({ label: 'Illegitimate ruler', value: -8 });
  const chancellor = sim.char(sim.fac(b)?.council.chancellor);
  const cd = skillOf(chancellor, 'diplomacy');
  if (cd) parts.push({ label: 'Their chancellor', value: Math.round(cd * 0.6) });
  const ruler = sim.char(sim.fac(b)?.ruler);
  if (ruler?.traits.includes('diplomatic')) parts.push({ label: 'Diplomatic ruler', value: 5 });
  if (ruler?.traits.includes('cruel')) parts.push({ label: 'Cruel ruler', value: -6 });
  return parts;
}

export function opinion(sim: Sim, a: FactionId, b: FactionId): number {
  let v = 0;
  for (const p of opinionBreakdown(sim, a, b)) v += p.value;
  return Math.max(-100, Math.min(100, Math.round(v)));
}

export function relationLabel(v: number): string {
  return v >= 60 ? 'Devoted' : v >= 30 ? 'Friendly' : v >= 10 ? 'Cordial' : v > -10 ? 'Neutral' : v > -30 ? 'Cold' : v > -60 ? 'Hostile' : 'Hateful';
}

export function decayModifiers(sim: Sim) {
  const d = sim.s.diplomacy;
  for (const m of d.modifiers) {
    if (m.decay) m.value = m.value > 0 ? Math.max(0, m.value - m.decay) : Math.min(0, m.value + m.decay);
  }
  d.modifiers = d.modifiers.filter((m) => Math.abs(m.value) >= 0.5 && (!m.expires || m.expires > sim.s.turn));
  d.truces = d.truces.filter((t) => t.until > sim.s.turn);
  for (const f of Object.keys(d.reputation)) d.reputation[f] = Math.min(100, d.reputation[f] + 0.25);
  // expire timed treaties
  d.treaties = d.treaties.filter((t) => !t.until || t.until > sim.s.turn);
}

// ---------------------------------------------------------------------------- wars

function warName(sim: Sim, att: FactionId, def: FactionId, goal?: War['goal']): string {
  if (goal?.province !== undefined) return `War for ${sim.provName(goal.province)}`;
  const n = sim.s.diplomacy.wars.length + sim.s.stats.wars;
  const fmt = ['The {a}-{d} War', "{a}'s War on {d}", 'The War of the {r}', 'The {d} Campaign'];
  const regions: Record<string, string> = { west: 'Westmarch', center: 'Heartlands', north: 'Greyspine', east: 'Amber Coast', south: 'Sunward Shore', emberfell: 'Ember Isle', greenholm: 'Green Isle', lirien: 'Merchant Isle', skarholm: 'Strait', norhaven: 'Northern Sea' };
  const capReg = sim.geo.provinces[sim.fac(def)?.capital ?? 0]?.region ?? 'center';
  return fmt[n % fmt.length].replace('{a}', sim.facName(att)).replace('{d}', sim.facName(def)).replace('{r}', regions[capReg] ?? 'Realm');
}

export interface WarCheck {
  ok: boolean;
  reason?: string;
  casusBelli: boolean;
  cbLabel: string;
}

export function canDeclareWar(sim: Sim, a: FactionId, b: FactionId): WarCheck {
  if (a === b) return { ok: false, reason: 'Cannot declare war on yourself.', casusBelli: false, cbLabel: '' };
  if (!sim.fac(b)?.alive) return { ok: false, reason: 'That realm no longer exists.', casusBelli: false, cbLabel: '' };
  if (atWar(sim, a, b)) return { ok: false, reason: 'Already at war.', casusBelli: false, cbLabel: '' };
  if (hasTruce(sim, a, b)) return { ok: false, reason: 'A truce is in force.', casusBelli: false, cbLabel: '' };
  if (overlordOf(sim, a) === b) return { ok: false, reason: 'You cannot attack your overlord while a vassal. Seek independence first.', casusBelli: false, cbLabel: '' };
  if (overlordOf(sim, b) === a) return { ok: false, reason: 'They are your vassal.', casusBelli: false, cbLabel: '' };
  const cl = claimsOn(sim, a, b);
  const hist = sim.s.diplomacy.modifiers.some((m) => m.from === a && m.to === b && m.kind === 'history_grievance');
  return { ok: true, casusBelli: cl > 0 || hist, cbLabel: cl > 0 ? 'Press our claims' : hist ? 'Avenge old wrongs' : 'No casus belli (reputation and legitimacy will suffer)' };
}

export function declareWar(sim: Sim, a: FactionId, b: FactionId, goal?: War['goal']): War | null {
  const chk = canDeclareWar(sim, a, b);
  if (!chk.ok) return null;
  const d = sim.s.diplomacy;
  // breaking an alliance / pact with the target
  if (hasTreaty(sim, a, b, 'alliance') || hasTreaty(sim, a, b, 'defensive') || hasTreaty(sim, a, b, 'nonaggression')) {
    removeTreaty(sim, a, b, 'alliance');
    removeTreaty(sim, a, b, 'defensive');
    removeTreaty(sim, a, b, 'nonaggression');
    d.reputation[a] = Math.max(0, (d.reputation[a] ?? 60) - 25);
    for (const f of sim.majorFactions()) if (f.id !== a) addModifier(sim, f.id, a, 'betrayal', 'Betrayed an ally', -15, 0.5);
    addModifier(sim, b, a, 'backstab', 'Stabbed us in the back', -60, 0.4);
  }
  removeTreaty(sim, a, b, 'trade');
  removeTreaty(sim, a, b, 'access');
  removeTreaty(sim, b, a, 'access');
  if (!chk.casusBelli) {
    d.reputation[a] = Math.max(0, (d.reputation[a] ?? 60) - 12);
    sim.fac(a).legitimacy = Math.max(0, sim.fac(a).legitimacy - 6);
    for (const f of sim.majorFactions()) if (f.id !== a && f.id !== b && factionDef(f.id).ai.honor > 0.6) addModifier(sim, f.id, a, 'warmonger', 'Unjust aggression', -10, 0.5);
  }
  addModifier(sim, b, a, 'declared_war', 'Declared war on us', -30, 0.5);
  const war: War = {
    id: d.nextWarId++,
    name: warName(sim, a, b, goal),
    attackers: [a],
    defenders: [b],
    leaderA: a,
    leaderD: b,
    startTurn: sim.s.turn,
    score: 0,
    goal,
    battles: 0,
    casualtiesA: 0,
    casualtiesD: 0,
  };
  d.wars.push(war);
  sim.s.stats.wars++;
  // defenders' allies and defensive pacts, and vassals / overlords
  const callDef = [...alliesOf(sim, b), ...d.treaties.filter((t) => t.type === 'defensive' && (t.a === b || t.b === b)).map((t) => (t.a === b ? t.b : t.a)), ...vassalsOf(sim, b)];
  const ob = overlordOf(sim, b);
  if (ob) callDef.push(ob);
  for (const ally of new Set(callDef)) {
    if (ally === a || war.defenders.includes(ally) || isAllied(sim, ally, a) || !sim.fac(ally)?.alive) continue;
    const joins = sim.isPlayer(ally) ? true : opinion(sim, ally, b) > -10 || vassalsOf(sim, b).includes(ally);
    if (joins) {
      war.defenders.push(ally);
      removeTreaty(sim, ally, a, 'trade');
      if (sim.isPlayer(ally)) sim.notify({ kind: 'war', title: 'Called to Arms', text: `As ally of ${sim.houseName(b)}, you are now at war with ${sim.houseName(a)}.` });
    } else {
      removeTreaty(sim, ally, b, 'alliance');
      removeTreaty(sim, ally, b, 'defensive');
      d.reputation[ally] = Math.max(0, (d.reputation[ally] ?? 60) - 15);
      addModifier(sim, b, ally, 'abandoned', 'Abandoned us in war', -40, 0.5);
    }
  }
  for (const ally of [...alliesOf(sim, a), ...vassalsOf(sim, a)]) {
    if (ally === b || war.attackers.includes(ally) || war.defenders.includes(ally) || isAllied(sim, ally, b)) continue;
    const joins = sim.isPlayer(ally) ? false : opinion(sim, ally, b) < 10 || vassalsOf(sim, a).includes(ally);
    if (joins) war.attackers.push(ally);
  }
  sim.emit({ type: 'WAR_DECLARED', war: war.id, attacker: a, defender: b });
  sim.chronicle(`${sim.houseName(a)} declared war on ${sim.houseName(b)}: ${war.name}.`, [a, b], 'war');
  if (sim.isPlayer(b) || war.defenders.includes(sim.s.player)) sim.notify({ kind: 'war', title: 'War Declared!', text: `${sim.houseName(a)} has declared war on ${sim.houseName(b)}. ${war.name} has begun.` });
  else if (sim.isPlayer(a)) sim.notify({ kind: 'war', title: 'War Declared', text: `You have declared war on ${sim.houseName(b)}. ${war.attackers.length > 1 ? 'Allies join you: ' + war.attackers.slice(1).map((x) => sim.facName(x)).join(', ') + '.' : ''}${war.defenders.length > 1 ? ' They are joined by ' + war.defenders.slice(1).map((x) => sim.facName(x)).join(', ') + '.' : ''}` });
  else sim.notify({ kind: 'war', title: 'War in the Realm', text: `${sim.houseName(a)} has declared war on ${sim.houseName(b)}.` });
  sim.fac(a).aiMemory['lastWar'] = sim.s.turn;
  return war;
}

/** Ends the war between a and b (removing both from the war; ends it entirely if leaders). */
export function makePeace(sim: Sim, a: FactionId, b: FactionId, terms: string) {
  const d = sim.s.diplomacy;
  const war = warBetween(sim, a, b);
  if (!war) return;
  const leaders = [war.leaderA, war.leaderD];
  if (leaders.includes(a) && leaders.includes(b)) {
    d.wars = d.wars.filter((w) => w !== war);
    for (const x of war.attackers) for (const y of war.defenders) d.truces.push({ a: x, b: y, until: sim.s.turn + 8 });
  } else {
    // separate peace: the non-leading participant leaves the war
    const leaver = leaders.includes(a) ? b : a;
    war.attackers = war.attackers.filter((x) => x !== leaver);
    war.defenders = war.defenders.filter((x) => x !== leaver);
    d.truces.push({ a, b, until: sim.s.turn + 8 });
    if (!war.attackers.length || !war.defenders.length) d.wars = d.wars.filter((w) => w !== war);
  }
  for (const p of sim.s.provinces) {
    if (p.siege && ((p.owner === a && sim.s.armies[p.siege.armyId]?.faction === b) || (p.owner === b && sim.s.armies[p.siege.armyId]?.faction === a))) {
      const army = sim.s.armies[p.siege.armyId];
      if (army) {
        army.siegeOf = undefined;
        army.stance = 'normal';
      }
      p.siege = undefined;
    }
  }
  sim.fac(a).warWeariness = Math.max(0, sim.fac(a).warWeariness - 20);
  sim.fac(b).warWeariness = Math.max(0, sim.fac(b).warWeariness - 20);
  sim.emit({ type: 'PEACE_SIGNED', a, b, terms });
  sim.chronicle(`${sim.houseName(a)} and ${sim.houseName(b)} made peace (${terms}).`, [a, b], 'peace');
  sim.notify({ kind: 'diplomacy', title: 'Peace Signed', text: `${sim.houseName(a)} and ${sim.houseName(b)} have made peace: ${terms}.` }, sim.isPlayer(a) || sim.isPlayer(b) ? sim.s.player : sim.s.player);
}

// ---------------------------------------------------------------------------- proposals

export type ProposalKind =
  | 'gift'
  | 'alliance'
  | 'defensive'
  | 'break_alliance'
  | 'trade'
  | 'request_access'
  | 'grant_access'
  | 'marriage'
  | 'demand_tribute'
  | 'offer_tribute'
  | 'peace'
  | 'demand_territory'
  | 'offer_territory'
  | 'demand_vassal'
  | 'offer_vassal'
  | 'release_vassal'
  | 'nonaggression';

export interface Proposal {
  kind: ProposalKind;
  from: FactionId;
  to: FactionId;
  amount?: number;
  province?: number;
  charA?: number; // from's character
  charB?: number; // to's character
  peaceTerms?: 'white' | 'cede' | 'tribute' | 'receive';
}

export interface Evaluation {
  accept: boolean;
  score: number;
  reasons: OpinionPart[];
  impossible?: string;
}

function powerRatio(sim: Sim, a: FactionId, b: FactionId) {
  const pa = militaryStrength(sim, a) + 1;
  const pb = militaryStrength(sim, b) + 1;
  return pa / pb;
}

/** Can the proposal even be made? Returns an explanation if not. */
export function proposalBlocked(sim: Sim, p: Proposal): string | null {
  const { from, to } = p;
  const war = atWar(sim, from, to);
  const f = sim.fac(from);
  switch (p.kind) {
    case 'gift':
      if ((p.amount ?? 0) > f.treasury) return 'Not enough gold in the treasury.';
      if ((p.amount ?? 0) <= 0) return 'Choose an amount.';
      return null;
    case 'alliance':
      if (war) return 'You are at war with them.';
      if (hasTreaty(sim, from, to, 'alliance')) return 'Already allied.';
      return null;
    case 'defensive':
      if (war) return 'You are at war with them.';
      if (hasTreaty(sim, from, to, 'defensive') || hasTreaty(sim, from, to, 'alliance')) return 'Already bound by treaty.';
      return null;
    case 'nonaggression':
      if (war) return 'You are at war with them.';
      if (hasTreaty(sim, from, to, 'nonaggression')) return 'Already bound by treaty.';
      return null;
    case 'break_alliance':
      if (!hasTreaty(sim, from, to, 'alliance') && !hasTreaty(sim, from, to, 'defensive')) return 'No alliance to break.';
      return null;
    case 'trade':
      if (war) return 'Cannot trade while at war.';
      if (hasTreaty(sim, from, to, 'trade')) return 'Already trading.';
      return null;
    case 'request_access':
      if (war) return 'At war.';
      if (sim.s.diplomacy.treaties.some((t) => t.type === 'access' && t.a === to && t.b === from)) return 'You already have military access.';
      return null;
    case 'grant_access':
      if (war) return 'At war.';
      if (sim.s.diplomacy.treaties.some((t) => t.type === 'access' && t.a === from && t.b === to)) return 'Already granted.';
      return null;
    case 'marriage': {
      const a = sim.char(p.charA);
      const b = sim.char(p.charB);
      if (!a || !b) return 'Choose a groom and a bride.';
      if (war) return 'Cannot arrange marriages with an enemy at war.';
      return canMarry(sim, a, b);
    }
    case 'demand_tribute':
    case 'offer_tribute':
      if (war) return 'At war: negotiate peace instead.';
      if (p.kind === 'offer_tribute' && (p.amount ?? 0) * 4 > f.treasury + 400) return 'Your treasury cannot sustain this tribute.';
      return null;
    case 'peace':
      if (!war) return 'You are not at war with them.';
      if (p.peaceTerms === 'cede' && p.province === undefined) return 'Choose a province to demand.';
      return null;
    case 'demand_territory':
    case 'offer_territory': {
      if (p.province === undefined) return 'Choose a province.';
      const pr = sim.s.provinces[p.province];
      const owner = p.kind === 'demand_territory' ? to : from;
      if (pr.owner !== owner) return 'That province is not theirs to give.';
      if (sim.fac(owner).capital === p.province) return 'A capital cannot be ceded.';
      return null;
    }
    case 'demand_vassal':
      if (war) return 'Win the war first — or demand it as a peace term.';
      if (overlordOf(sim, to)) return 'They already have an overlord.';
      if (overlordOf(sim, from) === to) return 'You are their vassal.';
      return null;
    case 'offer_vassal':
      if (overlordOf(sim, from)) return 'You already have an overlord.';
      return null;
    case 'release_vassal':
      if (overlordOf(sim, to) !== from) return 'They are not your vassal.';
      return null;
  }
  return null;
}

export function evaluateProposal(sim: Sim, p: Proposal): Evaluation {
  const blocked = proposalBlocked(sim, p);
  if (blocked) return { accept: false, score: -999, reasons: [], impossible: blocked };
  const { from, to } = p;
  const reasons: OpinionPart[] = [];
  const add = (label: string, value: number) => {
    if (Math.round(value) !== 0) reasons.push({ label, value: Math.round(value) });
  };
  const op = opinion(sim, to, from);
  const def = factionDef(to).ai;
  const ratio = powerRatio(sim, from, to);
  const fromEnemies = enemiesOf(sim, from);
  const toEnemies = enemiesOf(sim, to);
  const commonEnemies = fromEnemies.filter((e) => toEnemies.includes(e));
  const chancellor = sim.char(sim.fac(from).council.chancellor);
  add('Opinion of you', op * 0.6);
  add('Your chancellor', skillOf(chancellor, 'diplomacy') * 0.8);
  const rep = sim.s.diplomacy.reputation[from] ?? 60;
  switch (p.kind) {
    case 'gift':
      return { accept: true, score: 100, reasons };
    case 'alliance': {
      add('Base reluctance', -25);
      add('Common enemies', commonEnemies.length * 18);
      add('Your military might', Math.max(-20, Math.min(20, (ratio - 1) * 15)));
      add('Your reputation', (rep - 55) * 0.4);
      add('Their personality', (def.diplomacy - 0.5) * 20);
      if (fromEnemies.length && !commonEnemies.length) add('Would drag them into your wars', -15 * fromEnemies.length);
      if (marriageTies(sim, from, to)) add('Bound by marriage', 15);
      break;
    }
    case 'defensive':
      add('Base reluctance', -12);
      add('Common enemies', commonEnemies.length * 12);
      add('Your military might', Math.max(-15, Math.min(15, (ratio - 1) * 10)));
      add('Your reputation', (rep - 55) * 0.3);
      add('Their caution', def.caution * 10);
      break;
    case 'nonaggression':
      add('Base', 5);
      add('Their caution', def.caution * 15);
      add('Your military might', Math.max(-10, Math.min(20, (ratio - 1) * 15)));
      break;
    case 'break_alliance':
      return { accept: true, score: 100, reasons };
    case 'trade':
      add('Base', 5);
      add('Mercantile interest', def.trade * 25);
      if (sim.s.provinces.some((x) => x.owner === to && x.settlement.isPort) && sim.s.provinces.some((x) => x.owner === from && x.settlement.isPort)) add('Sea trade possible', 8);
      break;
    case 'request_access':
      add('Base reluctance', -10);
      if (isAllied(sim, from, to)) add('Allies', 30);
      if (commonEnemies.length) add('Common enemies', 20);
      add('Your might', Math.max(-10, Math.min(15, (ratio - 1) * 10)));
      break;
    case 'grant_access':
      add('Welcomes access', 25);
      break;
    case 'marriage': {
      const a = sim.char(p.charA)!;
      const b = sim.char(p.charB)!;
      const rank = (c: typeof a, fid: FactionId) => (sim.fac(fid).ruler === c.id ? 3 : sim.fac(fid).heir === c.id ? 2.5 : c.dynasty === fid ? 1.5 : 0.5);
      const ra = rank(a, from);
      const rb = rank(b, to);
      add('Base', 5);
      add('Match of rank', (ra - rb) * 12);
      add('Your prestige', Math.max(-15, Math.min(15, (sim.fac(from).prestige - sim.fac(to).prestige) / 25)));
      add('Your might', Math.max(-10, Math.min(15, (ratio - 1) * 10)));
      if (rb >= 2.5 && ra < 2.5) add('They guard their heir', -15);
      if (hasTreaty(sim, from, to, 'alliance')) add('Allies', 12);
      const ageDiff = Math.abs(age(sim, a) - age(sim, b));
      if (ageDiff > 15) add('Age difference', -ageDiff * 0.6);
      break;
    }
    case 'demand_tribute': {
      add('Pride', -35);
      add('Fear of your might', Math.max(-30, Math.min(45, (ratio - 1.5) * 30)));
      add('Size of demand', -(p.amount ?? 0) / 8);
      add('Their caution', def.caution * 15);
      break;
    }
    case 'offer_tribute':
      add('Welcome gold', 20 + (p.amount ?? 0) / 10);
      break;
    case 'peace': {
      const war = warBetween(sim, from, to)!;
      const fromIsAtt = war.attackers.includes(from);
      const score = fromIsAtt ? war.score : -war.score; // positive => proposer winning
      const weariness = sim.fac(to).warWeariness;
      add('War score', score * 0.9);
      add('War weariness', weariness * 0.5);
      add('Their aggression', -def.aggression * 15);
      add('Relative strength', Math.max(-20, Math.min(20, (ratio - 1) * 15)));
      if (p.peaceTerms === 'white') add('White peace', 5);
      if (p.peaceTerms === 'cede') {
        const pr = sim.s.provinces[p.province!];
        add('Cede ' + pr.settlement.name, -20 - pr.settlement.tier * 10 - (sim.fac(to).capital === pr.id ? 60 : 0));
      }
      if (p.peaceTerms === 'tribute') add('Pay tribute', -15);
      if (p.peaceTerms === 'receive') add('Receive tribute', 20);
      if (sim.s.turn - war.startTurn < 3) add('War has just begun', -20);
      break;
    }
    case 'demand_territory': {
      const pr = sim.s.provinces[p.province!];
      add('Pride', -45 - pr.settlement.tier * 12);
      add('Fear of your might', Math.max(-30, Math.min(50, (ratio - 2) * 25)));
      if (claimsOn(sim, from, to)) add('Your claim', 10);
      break;
    }
    case 'offer_territory':
      add('Welcome land', 40);
      break;
    case 'demand_vassal':
      add('Pride', -70);
      add('Fear of your might', Math.max(-30, Math.min(70, (ratio - 2.5) * 25)));
      add('Their weakness', sim.provincesOf(to).length <= 2 ? 15 : 0);
      if (toEnemies.length && !toEnemies.includes(from)) add('Seek protection', 15);
      break;
    case 'offer_vassal':
      add('Gain a vassal', 45);
      break;
    case 'release_vassal':
      add('Freedom', 100);
      break;
  }
  let score = 0;
  for (const r of reasons) score += r.value;
  return { accept: score >= 0, score, reasons };
}

/** Apply an accepted proposal. Returns a short result text. */
export function executeProposal(sim: Sim, p: Proposal): string {
  const { from, to } = p;
  const d = sim.s.diplomacy;
  switch (p.kind) {
    case 'gift': {
      const amt = Math.min(p.amount ?? 0, sim.fac(from).treasury);
      sim.fac(from).treasury -= amt;
      sim.fac(to).treasury += amt;
      addModifier(sim, to, from, 'gift', 'Received gifts', Math.min(35, 6 + amt / 25), 1);
      return `${sim.houseName(to)} graciously accepts your gift.`;
    }
    case 'alliance':
      addTreaty(sim, { type: 'alliance', a: from, b: to, since: sim.s.turn });
      removeTreaty(sim, from, to, 'defensive');
      sim.emit({ type: 'ALLIANCE_FORMED', a: from, b: to });
      sim.chronicle(`${sim.houseName(from)} and ${sim.houseName(to)} sealed an alliance.`, [from, to], 'alliance');
      return 'An alliance is sealed.';
    case 'defensive':
      addTreaty(sim, { type: 'defensive', a: from, b: to, since: sim.s.turn });
      return 'A defensive pact is signed.';
    case 'nonaggression':
      addTreaty(sim, { type: 'nonaggression', a: from, b: to, since: sim.s.turn, until: sim.s.turn + 20 });
      return 'A pact of non-aggression is signed for five years.';
    case 'break_alliance':
      removeTreaty(sim, from, to, 'alliance');
      removeTreaty(sim, from, to, 'defensive');
      addModifier(sim, to, from, 'broke_alliance', 'Broke our alliance', -30, 0.5);
      d.reputation[from] = Math.max(0, (d.reputation[from] ?? 60) - 8);
      sim.emit({ type: 'ALLIANCE_BROKEN', a: from, b: to });
      return 'The alliance is dissolved.';
    case 'trade':
      addTreaty(sim, { type: 'trade', a: from, b: to, since: sim.s.turn });
      return 'A trade agreement is signed. Merchants will sail between your ports.';
    case 'request_access':
      addTreaty(sim, { type: 'access', a: to, b: from, since: sim.s.turn, until: sim.s.turn + 16 });
      return 'Military access granted for four years.';
    case 'grant_access':
      addTreaty(sim, { type: 'access', a: from, b: to, since: sim.s.turn, until: sim.s.turn + 16 });
      addModifier(sim, to, from, 'granted_access', 'Granted us access', 8, 0.25);
      return 'You grant military access.';
    case 'marriage': {
      const a = sim.char(p.charA)!;
      const b = sim.char(p.charB)!;
      marry(sim, a.id, b.id);
      addModifier(sim, to, from, 'marriage', 'Royal marriage', 25, 0.25);
      addModifier(sim, from, to, 'marriage', 'Royal marriage', 25, 0.25);
      sim.fac(from).prestige += 25;
      sim.fac(to).prestige += 25;
      sim.s.stats.marriages++;
      updateHeir(sim, from);
      updateHeir(sim, to);
      sim.emit({ type: 'MARRIAGE_COMPLETED', a: a.id, b: b.id, fa: from, fb: to });
      sim.chronicle(`${fullName(a)} of ${sim.houseName(from)} wed ${fullName(b)} of ${sim.houseName(to)}.`, [from, to], 'marriage');
      return `${fullName(a)} and ${fullName(b)} are wed. The houses are bound by blood.`;
    }
    case 'demand_tribute':
      addTreaty(sim, { type: 'tribute', a: to, b: from, since: sim.s.turn, until: sim.s.turn + 8, amount: p.amount });
      addModifier(sim, to, from, 'humiliated', 'Extorted tribute', -25, 0.5);
      sim.fac(from).prestige += 15;
      return `${sim.houseName(to)} will pay ${p.amount} gold each season for two years.`;
    case 'offer_tribute':
      addTreaty(sim, { type: 'tribute', a: from, b: to, since: sim.s.turn, until: sim.s.turn + 8, amount: p.amount });
      addModifier(sim, to, from, 'tribute', 'Pays us tribute', 20, 0.25);
      return `You will pay ${p.amount} gold each season for two years.`;
    case 'peace': {
      let terms = 'white peace';
      if (p.peaceTerms === 'cede' && p.province !== undefined) {
        transferProvince(sim, p.province, from, 'treaty');
        terms = `${sim.provName(p.province)} ceded to ${sim.houseName(from)}`;
      } else if (p.peaceTerms === 'tribute') {
        addTreaty(sim, { type: 'tribute', a: from, b: to, since: sim.s.turn, until: sim.s.turn + 8, amount: 120 });
        terms = `${sim.houseName(from)} pays tribute`;
      } else if (p.peaceTerms === 'receive') {
        addTreaty(sim, { type: 'tribute', a: to, b: from, since: sim.s.turn, until: sim.s.turn + 8, amount: 120 });
        terms = `${sim.houseName(to)} pays tribute`;
      }
      makePeace(sim, from, to, terms);
      return `Peace is made: ${terms}.`;
    }
    case 'demand_territory':
      transferProvince(sim, p.province!, from, 'treaty');
      addModifier(sim, to, from, 'extorted_land', 'Extorted our land', -40, 0.3);
      return `${sim.provName(p.province!)} is ceded to you.`;
    case 'offer_territory':
      transferProvince(sim, p.province!, to, 'treaty');
      addModifier(sim, to, from, 'gift_land', 'Gifted us land', 35, 0.3);
      return `${sim.provName(p.province!)} is given to ${sim.houseName(to)}.`;
    case 'demand_vassal':
      addTreaty(sim, { type: 'vassal', a: from, b: to, since: sim.s.turn });
      sim.fac(from).prestige += 60;
      sim.chronicle(`${sim.houseName(to)} bent the knee to ${sim.houseName(from)}.`, [from, to], 'vassal');
      return `${sim.houseName(to)} becomes your vassal.`;
    case 'offer_vassal':
      addTreaty(sim, { type: 'vassal', a: to, b: from, since: sim.s.turn });
      sim.chronicle(`${sim.houseName(from)} swore fealty to ${sim.houseName(to)}.`, [from, to], 'vassal');
      return `You swear fealty to ${sim.houseName(to)}.`;
    case 'release_vassal':
      removeTreaty(sim, from, to, 'vassal');
      addModifier(sim, to, from, 'released', 'Granted our freedom', 40, 0.3);
      return `${sim.houseName(to)} is released from vassalage.`;
  }
  return '';
}

/** Hook set by conquest module (avoids a circular import). */
export let transferProvince: (sim: Sim, pid: number, to: FactionId, how: 'conquest' | 'treaty' | 'rebellion' | 'union') => void = () => {};
export function setTransferProvince(fn: typeof transferProvince) {
  transferProvince = fn;
}

export function propose(sim: Sim, p: Proposal): { accepted: boolean; text: string; evaluation: Evaluation } {
  const ev = evaluateProposal(sim, p);
  if (ev.impossible) return { accepted: false, text: ev.impossible, evaluation: ev };
  if (p.kind === 'break_alliance' || p.kind === 'gift' || p.kind === 'release_vassal' || p.kind === 'grant_access') {
    return { accepted: true, text: executeProposal(sim, p), evaluation: ev };
  }
  if (ev.accept) {
    const text = executeProposal(sim, p);
    return { accepted: true, text, evaluation: ev };
  }
  addModifier(sim, p.from, p.to, 'rejected', 'Rejected our proposal', -3, 0.5);
  if (p.kind === 'demand_tribute' || p.kind === 'demand_territory' || p.kind === 'demand_vassal') addModifier(sim, p.to, p.from, 'insulting_demand', 'Insulting demands', -12, 0.5);
  sim.emit({ type: 'PROPOSAL_REJECTED', proposal: p });
  return { accepted: false, text: `${sim.houseName(p.to)} refuses.`, evaluation: ev };
}

export function allOpinionModifiers(sim: Sim, from: FactionId, to: FactionId): OpinionModifier[] {
  return sim.s.diplomacy.modifiers.filter((m) => m.from === from && m.to === to);
}
