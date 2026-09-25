import { CULTURES } from '../data/names';
import { factionDef } from '../data/factions';
import { TRAITS, traitDef } from '../data/traits';
import type { Sim } from './context';
import { ageOf, type Character, type CharacterRole, type FactionId, type Gender, type PortraitGenes, type SkillSet } from './types';

export const ADULT_AGE = 16;

export function cultureOf(dynastyOrFaction: string): string {
  const d = factionDef(dynastyOrFaction);
  if (d && d.id === dynastyOrFaction) return d.culture;
  // minor houses encode culture as "culture:Name"
  const i = dynastyOrFaction.indexOf(':');
  return i > 0 ? dynastyOrFaction.slice(0, i) : 'west';
}

export function dynastyName(dyn: string): string {
  const d = factionDef(dyn);
  if (d && d.id === dyn) return d.house.replace('House ', '');
  const i = dyn.indexOf(':');
  return i > 0 ? dyn.slice(i + 1) : dyn;
}

export function fullName(c: Character): string {
  return `${c.name} ${dynastyName(c.dynasty)}`;
}

export function randomGenes(sim: Sim, culture: string): PortraitGenes {
  const r = sim.rng;
  const skinBase: Record<string, number> = { west: 1, central: 2, north: 0, norse: 0, south: 3, sea: 1, ember: 2, green: 1 };
  const hairBase: Record<string, number[]> = { west: [1, 2, 3, 4], central: [2, 3, 4], north: [0, 1, 2], norse: [0, 0, 1, 5], south: [3, 4, 4], sea: [2, 3, 4, 5], ember: [3, 4, 4, 5], green: [1, 2, 5, 5] };
  return {
    skin: Math.max(0, Math.min(5, (skinBase[culture] ?? 1) + r.int(-1, 1))),
    hair: r.pick(hairBase[culture] ?? [2, 3]),
    hairStyle: r.int(0, 5),
    beard: r.int(0, 5),
    eyes: r.int(0, 3),
    face: r.int(0, 3),
    nose: r.int(0, 3),
    brow: r.int(0, 2),
  };
}

export function inheritGenes(sim: Sim, f: PortraitGenes, m: PortraitGenes): PortraitGenes {
  const r = sim.rng;
  const pick = <K extends keyof PortraitGenes>(k: K) => (r.chance(0.5) ? f[k] : m[k]);
  return {
    skin: Math.round((f.skin + m.skin) / 2 + (r.chance(0.2) ? r.int(-1, 1) : 0)),
    hair: pick('hair'),
    hairStyle: r.int(0, 5),
    beard: r.int(0, 5),
    eyes: pick('eyes'),
    face: pick('face'),
    nose: pick('nose'),
    brow: pick('brow'),
  };
}

export function randomTraits(sim: Sim, n: number): string[] {
  const out: string[] = [];
  const pool = TRAITS.filter((t) => t.id !== 'wounded' && t.id !== 'veteran');
  let guard = 0;
  while (out.length < n && guard++ < 50) {
    const t = sim.rng.pick(pool);
    if (out.includes(t.id) || (t.opposite && out.includes(t.opposite))) continue;
    if (!t.good && sim.rng.chance(0.4)) continue;
    out.push(t.id);
  }
  return out;
}

export function pickName(sim: Sim, culture: string, gender: Gender, avoid: string[] = []): string {
  const c = CULTURES[culture] ?? CULTURES.west;
  const list = gender === 'm' ? c.male : c.female;
  for (let i = 0; i < 8; i++) {
    const n = sim.rng.pick(list);
    if (!avoid.includes(n)) return n;
  }
  return sim.rng.pick(list);
}

export interface NewCharOpts {
  dynasty: string;
  faction: FactionId | null;
  gender: Gender;
  birthTurn: number;
  father?: number;
  mother?: number;
  role?: CharacterRole;
  name?: string;
  traits?: string[];
  skills?: Partial<SkillSet>;
  genes?: PortraitGenes;
  alive?: boolean;
}

export function createCharacter(sim: Sim, o: NewCharOpts): Character {
  const id = sim.s.ids.char++;
  const culture = cultureOf(o.dynasty);
  const r = sim.rng;
  const father = sim.char(o.father);
  const mother = sim.char(o.mother);
  const siblingsNames = [...(father?.children ?? []), ...(mother?.children ?? [])].map((cid) => sim.char(cid)?.name ?? '');
  const skill = (k: keyof SkillSet) => {
    const base = o.skills?.[k];
    if (base !== undefined) return base;
    let v = r.int(2, 9);
    if (father && mother) v = Math.round((father.skills[k] + mother.skills[k]) / 2 + r.int(-3, 3));
    return Math.max(0, Math.min(20, v));
  };
  const genes = o.genes ?? (father && mother ? inheritGenes(sim, father.genes, mother.genes) : randomGenes(sim, culture));
  let traits = o.traits ?? randomTraits(sim, r.int(1, 3));
  if (!o.traits && father && r.chance(0.3)) {
    const t = r.pick(father.traits);
    if (t && !traits.includes(t) && t !== 'wounded' && t !== 'veteran') traits = [...traits.slice(0, 2), t];
  }
  const c: Character = {
    id,
    name: o.name ?? pickName(sim, culture, o.gender, siblingsNames),
    dynasty: o.dynasty,
    faction: o.faction,
    gender: o.gender,
    birthTurn: o.birthTurn,
    alive: o.alive ?? true,
    father: o.father,
    mother: o.mother,
    children: [],
    traits,
    skills: { command: skill('command'), diplomacy: skill('diplomacy'), stewardship: skill('stewardship'), intrigue: skill('intrigue') },
    loyalty: 60 + r.int(-10, 20),
    prestige: r.int(0, 20),
    health: 80 + r.int(-10, 20),
    role: o.role ?? 'family',
    claims: [],
    relations: {},
    genes,
    xp: 0,
    battlesWon: 0,
    battlesLost: 0,
  };
  sim.s.characters[id] = c;
  if (father) father.children.push(id);
  if (mother) mother.children.push(id);
  return c;
}

/** Effective skill including traits and wounds. */
export function skillOf(c: Character | undefined, k: keyof SkillSet): number {
  if (!c) return 0;
  let v = c.skills[k];
  for (const t of c.traits) v += traitDef(t)?.skills?.[k] ?? 0;
  if (k === 'command') v += Math.min(4, Math.floor(c.xp / 100));
  return Math.max(0, Math.min(25, v));
}

export const age = (sim: Sim, c: Character) => ageOf(c, sim.s.turn);
export const isAdult = (sim: Sim, c: Character) => age(sim, c) >= ADULT_AGE;

export function siblingsOf(sim: Sim, c: Character): Character[] {
  const set = new Set<number>();
  for (const pid of [c.father, c.mother]) {
    const p = sim.char(pid);
    if (p) for (const k of p.children) if (k !== c.id) set.add(k);
  }
  return [...set].map((id) => sim.char(id)!).filter(Boolean);
}

export function isCloseKin(sim: Sim, a: Character, b: Character): boolean {
  if (a.id === b.id) return true;
  if (a.father === b.id || a.mother === b.id || b.father === a.id || b.mother === a.id) return true;
  if ((a.father !== undefined && a.father === b.father) || (a.mother !== undefined && a.mother === b.mother)) return true;
  // grandparent / grandchild
  const parents = (c: Character) => [c.father, c.mother].filter((x) => x !== undefined) as number[];
  const gpA = parents(a).flatMap((p) => (sim.char(p) ? parents(sim.char(p)!) : []));
  const gpB = parents(b).flatMap((p) => (sim.char(p) ? parents(sim.char(p)!) : []));
  if (gpA.includes(b.id) || gpB.includes(a.id)) return true;
  // first cousins
  if (gpA.some((g) => gpB.includes(g))) return true;
  // aunt/uncle
  const pa = parents(a);
  const pb = parents(b);
  if (pa.some((p) => sim.char(p) && siblingsOf(sim, sim.char(p)!).some((s) => s.id === b.id))) return true;
  if (pb.some((p) => sim.char(p) && siblingsOf(sim, sim.char(p)!).some((s) => s.id === a.id))) return true;
  return false;
}

export function canMarry(sim: Sim, a: Character, b: Character): string | null {
  if (!a.alive || !b.alive) return 'Both must be alive.';
  if (a.spouse !== undefined) return `${fullName(a)} is already married.`;
  if (b.spouse !== undefined) return `${fullName(b)} is already married.`;
  if (a.gender === b.gender) return 'A political marriage requires a bride and a groom.';
  if (!isAdult(sim, a) || !isAdult(sim, b)) return 'Both must be of age (16).';
  if (age(sim, a) > 60 || age(sim, b) > 60) return 'Too old for a political match.';
  if (isCloseKin(sim, a, b)) return 'They are too closely related.';
  return null;
}

/** Which faction does a married couple's household belong to, and which dynasty do children take. */
export function marry(sim: Sim, aId: number, bId: number): void {
  const a = sim.char(aId)!;
  const b = sim.char(bId)!;
  a.spouse = b.id;
  b.spouse = a.id;
  const man = a.gender === 'm' ? a : b;
  const woman = a.gender === 'm' ? b : a;
  const womanKey = woman.role === 'ruler' || woman.role === 'heir';
  const manKey = man.role === 'ruler' || man.role === 'heir';
  // the non-key spouse joins the other court
  if (womanKey && !manKey) {
    man.faction = woman.faction;
    man.role = 'consort';
    detachFromPosts(sim, man);
  } else if (!womanKey) {
    if (woman.faction !== man.faction) detachFromPosts(sim, woman);
    woman.faction = man.faction;
    if (woman.role !== 'ruler') woman.role = man.role === 'ruler' ? 'consort' : 'family';
  }
  // claims: spouses of a ruling dynasty's children get weak claims for their offspring (handled at birth)
  a.prestige += 10;
  b.prestige += 10;
  a.relations[b.id] = 50;
  b.relations[a.id] = 50;
}

export function detachFromPosts(sim: Sim, c: Character) {
  if (c.council && c.faction) {
    const f = sim.fac(c.faction);
    if (f && f.council[c.council] === c.id) delete f.council[c.council];
    c.council = undefined;
  }
  if (c.armyId !== undefined) {
    const army = sim.s.armies[c.armyId];
    if (army && army.general === c.id) {
      army.general = undefined;
      army.units = army.units.filter((u) => u.type !== 'bodyguard');
    }
    c.armyId = undefined;
  }
  if (c.fleetId !== undefined) {
    const fl = sim.s.fleets[c.fleetId];
    if (fl && fl.admiral === c.id) fl.admiral = undefined;
    c.fleetId = undefined;
  }
}

/** Dynasty of a newborn: father's unless the mother is the ruler/heir and father is a consort. */
export function childDynasty(father: Character, mother: Character): { dynasty: string; faction: FactionId | null } {
  if ((mother.role === 'ruler' || mother.role === 'heir') && father.role === 'consort') return { dynasty: mother.dynasty, faction: mother.faction };
  return { dynasty: father.dynasty, faction: father.faction ?? mother.faction };
}

// --------------------------------------------------------------------------- succession

/** Ordered line of succession for a faction (alive characters). */
export function lineOfSuccession(sim: Sim, factionId: FactionId, limit = 12): Character[] {
  const f = sim.fac(factionId);
  if (!f) return [];
  const ruler = sim.char(f.ruler);
  if (!ruler) return [];
  const law = f.succession;
  const out: Character[] = [];
  const seen = new Set<number>([ruler.id]);
  const sortedChildren = (c: Character) =>
    c.children
      .map((id) => sim.char(id)!)
      .filter(Boolean)
      .sort((x, y) => {
        if (law !== 'agnatic' && x.gender !== y.gender) return x.gender === 'm' ? -1 : 1;
        return x.birthTurn - y.birthTurn;
      });
  const descend = (c: Character) => {
    for (const k of sortedChildren(c)) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      if (law === 'agnatic' && k.gender !== 'm') continue;
      if (k.alive) out.push(k);
      descend(k);
      if (out.length >= limit) return;
    }
  };
  if (law === 'elective') {
    // strongest adult of the dynasty (and consorts' kin excluded)
    const cands = Object.values(sim.s.characters).filter((c) => c.alive && c.dynasty === ruler.dynasty && c.id !== ruler.id);
    cands.sort((a, b) => electiveScore(sim, b) - electiveScore(sim, a));
    return cands.slice(0, limit);
  }
  descend(ruler);
  // then ancestors' other descendants (siblings, nephews, uncles ...)
  let anc: Character | undefined = ruler;
  for (let depth = 0; depth < 3 && out.length < limit; depth++) {
    const parent: Character | undefined = sim.char(anc?.father) ?? sim.char(anc?.mother);
    if (!parent) break;
    seen.add(parent.id);
    if (depth > 0 && parent.alive && (law !== 'agnatic' || parent.gender === 'm')) out.push(parent);
    descend(parent);
    anc = parent;
  }
  return out.slice(0, limit);
}

function electiveScore(sim: Sim, c: Character): number {
  const a = age(sim, c);
  if (a < ADULT_AGE) return -100 + a;
  return skillOf(c, 'command') * 2 + skillOf(c, 'diplomacy') + c.prestige * 0.2 + (c.gender === 'm' ? 3 : 0) - Math.max(0, a - 55);
}

export function updateHeir(sim: Sim, factionId: FactionId) {
  const f = sim.fac(factionId);
  if (!f) return;
  const old = sim.char(f.heir);
  const line = lineOfSuccession(sim, factionId, 1);
  const heir = line[0];
  if (old && old.role === 'heir' && (!heir || old.id !== heir.id)) old.role = old.faction === factionId ? 'family' : old.role;
  f.heir = heir?.id;
  if (heir && heir.faction === factionId && heir.role !== 'general' && heir.role !== 'admiral') heir.role = 'heir';
}

export function rulerLegitimacyBase(sim: Sim, factionId: FactionId, newRuler: Character, oldRuler: Character | undefined): number {
  let leg = 45;
  if (oldRuler && (newRuler.father === oldRuler.id || newRuler.mother === oldRuler.id)) leg = 72;
  else if (oldRuler && siblingsOf(sim, oldRuler).some((s) => s.id === newRuler.id)) leg = 58;
  else if (newRuler.dynasty === oldRuler?.dynasty) leg = 50;
  if (age(sim, newRuler) < ADULT_AGE) leg -= 15;
  for (const t of newRuler.traits) leg += traitDef(t)?.legitimacy ?? 0;
  leg += Math.min(12, newRuler.prestige / 10);
  return Math.max(10, Math.min(95, leg));
}

export function killCharacter(sim: Sim, c: Character, cause: string) {
  if (!c.alive) return;
  c.alive = false;
  c.deathTurn = sim.s.turn;
  c.deathCause = cause;
  detachFromPosts(sim, c);
  const spouse = sim.char(c.spouse);
  if (spouse) {
    spouse.formerSpouses = [...(spouse.formerSpouses ?? []), c.id];
    spouse.spouse = undefined;
    c.spouse = spouse.id; // keep for the family tree (dead keep record)
  }
  sim.emit({ type: 'CHARACTER_DIED', char: c.id, cause });
  const fid = c.faction;
  if (!fid) return;
  const f = sim.fac(fid);
  if (!f) return;
  if (f.ruler === c.id) {
    handleRulerDeath(sim, fid, c, cause);
  } else if (f.heir === c.id) {
    updateHeir(sim, fid);
    if (sim.isPlayer(fid) || c.prestige > 30)
      sim.notify({ kind: 'dynasty', title: 'Heir Has Died', text: `${fullName(c)}, heir of ${sim.houseName(fid)}, has died (${cause}). The line of succession has changed.` }, fid);
  } else if (sim.isPlayer(fid) && (c.dynasty === fid || c.role === 'consort' || c.role === 'general')) {
    sim.notify({ kind: 'dynasty', title: 'A Death at Court', text: `${fullName(c)} has died (${cause}).` }, fid);
  }
}

export function handleRulerDeath(sim: Sim, fid: FactionId, old: Character, cause: string) {
  const f = sim.fac(fid);
  sim.emit({ type: 'RULER_DIED', faction: fid, char: old.id, cause });
  sim.chronicle(`${fullName(old)}, ruler of ${factionDef(fid).realm}, died (${cause}).`, [fid], 'death');
  const line = lineOfSuccession(sim, fid, 8);
  let heir = line[0];
  f.pastRulers.push(old.id);
  if (!heir) {
    // dynasty extinct: a courtier seizes power / new house rises
    const courtiers = Object.values(sim.s.characters).filter((c) => c.alive && c.faction === fid && c.id !== old.id && ageOf(c, sim.s.turn) >= ADULT_AGE);
    courtiers.sort((a, b) => b.prestige + skillOf(b, 'command') * 3 - (a.prestige + skillOf(a, 'command') * 3));
    heir = courtiers[0];
    if (!heir) {
      // create a new lord
      heir = createCharacter(sim, { dynasty: `${factionDef(fid).culture}:${sim.rng.pick(['Newhold', 'Ashgrove', 'Marrow', 'Brand'])}`, faction: fid, gender: 'm', birthTurn: sim.s.turn - 4 * sim.rng.int(25, 45), role: 'courtier' });
    }
    f.legitimacy = 25;
    sim.chronicle(`With the line of ${sim.houseName(fid)} broken, ${fullName(heir)} seized the throne.`, [fid], 'succession');
  }
  // dynastic union: heir already rules another realm
  const heirFaction = heir.faction;
  if (heirFaction && heirFaction !== fid && sim.s.factions[heirFaction]?.alive && sim.fac(heirFaction).ruler === heir.id) {
    dynasticUnion(sim, fid, heirFaction, heir, old);
    return;
  }
  const oldLeg = f.legitimacy;
  f.ruler = heir.id;
  f.rulerSinceTurn = sim.s.turn;
  detachFromPosts(sim, heir);
  heir.faction = fid;
  heir.role = 'ruler';
  heir.prestige += 20;
  f.legitimacy = Math.round(rulerLegitimacyBase(sim, fid, heir, old) * 0.7 + oldLeg * 0.3);
  // disputed succession: ambitious relatives with claims
  const rivals = line.slice(1).filter((c) => c.alive && ageOf(c, sim.s.turn) >= ADULT_AGE && (c.traits.includes('ambitious') || (ageOf(c, sim.s.turn) > ageOf(heir, sim.s.turn) + 5 && sim.rng.chance(0.25))));
  for (const r of rivals.slice(0, 2)) {
    r.claims.push({ kind: 'throne', target: fid, strength: 2, source: 'succession', sinceTurn: sim.s.turn });
    r.loyalty = Math.max(0, r.loyalty - 25);
  }
  if (rivals.length) f.legitimacy = Math.max(10, f.legitimacy - 8 * rivals.length);
  updateHeir(sim, fid);
  sim.s.stats.successions++;
  sim.emit({ type: 'SUCCESSION_OCCURRED', faction: fid, oldRuler: old.id, newRuler: heir.id, legitimacy: f.legitimacy, rivals: rivals.map((r) => r.id) });
  sim.chronicle(`${fullName(heir)} succeeded to the throne of ${factionDef(fid).realm}.`, [fid], 'succession');
  // foreign relations: opinion resets partially toward neutral (new ruler, new friendships)
  for (const m of sim.s.diplomacy.modifiers) if (m.from === fid && m.kind !== 'history') m.value *= 0.7;
  if (sim.isPlayer(fid)) {
    // handled by UI (coronation) + possible crisis event
    if (rivals.length) {
      sim.s.decisions.push({
        id: sim.s.ids.decision++,
        kind: 'event',
        faction: fid,
        eventId: 'succession_crisis',
        title: 'A Disputed Succession',
        text: `${fullName(rivals[0])} disputes the accession of ${fullName(heir)} and gathers discontented lords. How will the crown answer?`,
        options: [
          { id: 'bribe', label: 'Grant lands and gold (-400 gold)', tooltip: 'Restore their loyalty. Legitimacy +5.' },
          { id: 'imprison', label: 'Imprison the pretender', tooltip: 'Removes the claimant. Legitimacy -8, prestige +10.' },
          { id: 'ignore', label: 'Ignore the grumbling', tooltip: 'Risk of a rebellion led by the claimant.' },
        ],
        data: { rival: rivals[0].id },
        turn: sim.s.turn,
      });
    }
  } else {
    sim.notify({ kind: 'dynasty', title: `New Ruler in ${sim.facName(fid)}`, text: `${fullName(old)} has died. ${fullName(heir)} now rules ${factionDef(fid).realm}.` }, sim.s.player);
  }
}

/** A ruler inherits another realm: the inherited faction is absorbed into the heir's faction. */
export function dynasticUnion(sim: Sim, fid: FactionId, into: FactionId, heir: Character, old: Character) {
  const f = sim.fac(fid);
  const target = sim.fac(into);
  sim.chronicle(`By right of blood, ${fullName(heir)} inherited ${factionDef(fid).realm}. ${sim.houseName(fid)}'s lands were joined to ${factionDef(into).realm}.`, [fid, into], 'union');
  for (const p of sim.s.provinces)
    if (p.owner === fid) {
      p.owner = into;
      sim.emit({ type: 'OWNERSHIP_CHANGED', province: p.id, from: fid, to: into });
    }
  for (const a of Object.values(sim.s.armies)) if (a.faction === fid) a.faction = into;
  for (const fl of Object.values(sim.s.fleets)) if (fl.faction === fid) fl.faction = into;
  for (const c of Object.values(sim.s.characters)) if (c.alive && c.faction === fid) c.faction = into;
  target.treasury += Math.max(0, f.treasury);
  target.prestige += 150;
  target.food += f.food;
  f.alive = false;
  f.ruler = old.id;
  // treaties of the absorbed realm lapse
  const d = sim.s.diplomacy;
  d.treaties = d.treaties.filter((t) => t.a !== fid && t.b !== fid);
  for (const w of d.wars) {
    w.attackers = w.attackers.filter((x) => x !== fid);
    w.defenders = w.defenders.filter((x) => x !== fid);
  }
  d.wars = d.wars.filter((w) => w.attackers.length && w.defenders.length);
  sim.emit({ type: 'FACTION_ELIMINATED', faction: fid, by: into, union: true });
  sim.notify({ kind: 'dynasty', title: 'A Crown Inherited', text: `${fullName(heir)} of ${sim.houseName(into)} has inherited ${factionDef(fid).realm}. The realms are joined in a dynastic union.` }, sim.s.player);
  if (sim.isPlayer(fid)) {
    sim.s.victory = { faction: into, kind: 'union', turn: sim.s.turn };
  }
}

/** Seasonal character update: ageing, health, deaths, births. */
export function updateCharacters(sim: Sim) {
  const s = sim.s;
  const r = sim.rng;
  const chars = Object.values(s.characters).filter((c) => c.alive);
  for (const c of chars) {
    if (!c.alive) continue;
    const a = ageOf(c, s.turn);
    if (c.wounded) {
      c.wounded--;
      if (c.wounded <= 0) {
        c.wounded = undefined;
        c.health = Math.min(100, c.health + 20);
      }
    }
    let p = a < 5 ? 0.004 : a < 45 ? 0.0015 : a < 55 ? 0.006 : a < 65 ? 0.016 : a < 75 ? 0.04 : a < 85 ? 0.09 : 0.2;
    if (c.traits.includes('sickly')) p *= 2.2;
    if (c.traits.includes('robust')) p *= 0.55;
    if (c.health < 50) p *= 2;
    if (c.health < 25) p *= 2;
    // health drifts
    c.health = Math.max(5, Math.min(100, c.health + (a > 55 ? -r.range(0, 2) : r.range(-1, 1.5))));
    if (r.chance(p)) {
      const cause = a < 5 ? 'childhood fever' : a > 65 ? 'old age' : r.pick(['a fever', 'a hunting accident', 'a wasting sickness', 'a fall from a horse', 'illness']);
      killCharacter(sim, c, cause);
      continue;
    }
    // births
    if (c.gender === 'f' && c.spouse !== undefined && a >= 16 && a <= 42) {
      const h = sim.char(c.spouse);
      if (h && h.alive) {
        const kids = c.children.filter((k) => sim.char(k)?.alive).length;
        let pb = 0.075 - kids * 0.01;
        if (c.traits.includes('lustful') || h.traits.includes('lustful')) pb += 0.03;
        const youngest = c.children.map((k) => sim.char(k)!).reduce((m, k) => Math.max(m, k?.birthTurn ?? -999), -999);
        if (s.turn - youngest < 4) pb = 0;
        if (r.chance(Math.max(0.01, pb))) {
          const dyn = childDynasty(h, c);
          const child = createCharacter(sim, { dynasty: dyn.dynasty, faction: dyn.faction, gender: r.chance(0.5) ? 'm' : 'f', birthTurn: s.turn, father: h.id, mother: c.id, role: 'family' });
          // claims through the non-dynastic parent's ruling house
          const other = child.dynasty === h.dynasty ? c : h;
          const otherHouseFaction = sim.s.factions[other.dynasty];
          if (otherHouseFaction && otherHouseFaction.id !== child.faction && (sim.fac(otherHouseFaction.id).ruler === other.id || sim.fac(otherHouseFaction.id).heir === other.id || other.father === sim.fac(otherHouseFaction.id).ruler)) {
            child.claims.push({ kind: 'throne', target: otherHouseFaction.id, strength: 1, source: 'marriage', sinceTurn: s.turn });
          }
          sim.emit({ type: 'CHARACTER_BORN', char: child.id, faction: child.faction });
          if (child.faction) {
            const f = sim.fac(child.faction);
            if (f) {
              const before = f.heir;
              updateHeir(sim, child.faction);
              if (sim.isPlayer(child.faction) && (child.dynasty === child.faction || f.heir === child.id))
                sim.notify({ kind: 'dynasty', title: f.heir === child.id && before !== child.id ? 'An Heir Is Born' : 'A Child Is Born', text: `${fullName(c)} has given birth to ${child.gender === 'm' ? 'a son' : 'a daughter'}, ${child.name}.` }, child.faction);
            }
          }
        }
      }
    }
    // coming of age: bump skills a little over time for young adults
    if (a >= 16 && a <= 30 && r.chance(0.05)) {
      const k = r.pick(['command', 'diplomacy', 'stewardship', 'intrigue'] as const);
      c.skills[k] = Math.min(20, c.skills[k] + 1);
    }
    // loyalty drift
    if (c.faction) {
      const f = sim.fac(c.faction);
      if (f && f.ruler !== c.id) {
        let target = 55 + (f.legitimacy - 50) * 0.4 + (c.dynasty === f.id ? 15 : 0);
        for (const t of c.traits) target += traitDef(t)?.loyalty ?? 0;
        if (c.claims.some((cl) => cl.kind === 'throne' && cl.target === f.id)) target -= 25;
        c.loyalty += (target - c.loyalty) * 0.1;
      }
    }
  }
  // legitimacy drift & reign length prestige
  for (const f of Object.values(s.factions)) {
    if (!f.alive) continue;
    const ruler = sim.char(f.ruler);
    if (!ruler || !ruler.alive) continue;
    const reign = s.turn - f.rulerSinceTurn;
    const adult = ageOf(ruler, s.turn) >= ADULT_AGE;
    let target = 55 + Math.min(20, reign / 4) + Math.min(10, ruler.prestige / 20) + (adult ? 0 : -15);
    for (const t of ruler.traits) target += traitDef(t)?.legitimacy ?? 0;
    if (f.debtTurns > 0) target -= 15;
    f.legitimacy += Math.sign(target - f.legitimacy) * Math.min(1.5, Math.abs(target - f.legitimacy));
    f.legitimacy = Math.max(0, Math.min(100, f.legitimacy));
    if (reign > 0 && reign % 20 === 0) f.prestige += 15; // long reigns
  }
}
