import { factionDef } from '../data/factions';
import { createCharacter, fullName, killCharacter, age, ADULT_AGE } from './characters';
import type { Sim } from './context';
import { addModifier, areNeighbours, executeProposal, evaluateProposal, type Proposal } from './diplomacy';
import { createArmy, createFleet, newShip, newUnit } from './military';
import { transferProvince } from './conquest';
import { waterCellsNear } from './movement';
import type { FactionId, PendingDecision, ProvinceState } from './types';
import { seasonOf } from './types';

type Choice = { id: string; label: string; tooltip?: string; apply: (sim: Sim) => string };

interface EventDef {
  id: string;
  weight: (sim: Sim, fid: FactionId) => number;
  build: (sim: Sim, fid: FactionId) => { title: string; text: string; choices: Choice[]; data?: Record<string, unknown> } | null;
}

const orderMod = (p: ProvinceState, v: number) => {
  const q = p as ProvinceState & { eventOrder?: number };
  q.eventOrder = (q.eventOrder ?? 0) + v;
};

const randomProvince = (sim: Sim, fid: FactionId, pred: (p: ProvinceState) => boolean = () => true) => {
  const list = sim.provincesOf(fid).filter(pred);
  return list.length ? sim.rng.pick(list) : undefined;
};

export const EVENTS: EventDef[] = [
  {
    id: 'poor_harvest',
    weight: (sim) => (seasonOf(sim.s.turn) >= 2 ? 1.2 : 0.4),
    build: (sim, fid) => {
      const p = randomProvince(sim, fid, (x) => x.settlement.buildings.some((b) => b.id === 'farm'));
      if (!p) return null;
      const loss = 120 + p.settlement.tier * 60;
      return {
        title: 'A Poor Harvest',
        text: `Blight and rain have ruined the fields around ${p.settlement.name}. The granaries will be short by ${loss} measures of grain.`,
        choices: [
          { id: 'buy', label: `Buy grain from merchants (-${Math.round(loss * 1.5)} gold)`, apply: (s) => ((s.fac(fid).treasury -= Math.round(loss * 1.5)), 'Merchants fill the granaries at a steep price.') },
          { id: 'ration', label: 'Impose rationing', tooltip: `-${loss} food, public order falls in ${p.settlement.name}`, apply: (s) => ((s.fac(fid).food = Math.max(0, s.fac(fid).food - loss)), orderMod(p, -15), 'Rationing is imposed. The people grumble.') },
        ],
      };
    },
  },
  {
    id: 'merchant_boom',
    weight: (sim, fid) => (sim.provincesOf(fid).some((p) => p.settlement.buildings.some((b) => b.id === 'market' || b.id === 'harbor')) ? 1 : 0),
    build: (sim, fid) => {
      const p = randomProvince(sim, fid, (x) => x.settlement.buildings.some((b) => b.id === 'market' || b.id === 'harbor'));
      if (!p) return null;
      return {
        title: 'Merchant Boom',
        text: `Foreign merchants crowd the wharves and stalls of ${p.settlement.name}. Coin flows as never before.`,
        choices: [
          { id: 'tax', label: 'Levy a special toll (+400 gold)', tooltip: 'Order -8 locally', apply: (s) => ((s.fac(fid).treasury += 400), orderMod(p, -8), 'The toll is paid, if resentfully.') },
          { id: 'invest', label: 'Grant them charters', tooltip: 'Development +2, order +5', apply: () => ((p.development = Math.min(10, p.development + 2)), orderMod(p, 5), 'New guilds are chartered.') },
        ],
      };
    },
  },
  {
    id: 'noble_dispute',
    weight: (sim, fid) => (sim.fac(fid).legitimacy < 65 ? 1.2 : 0.5),
    build: (sim, fid) => {
      const lords = Object.values(sim.s.characters).filter((c) => c.alive && c.faction === fid && (c.role === 'courtier' || c.role === 'knight' || c.role === 'general') && age(sim, c) >= ADULT_AGE);
      if (lords.length < 2) return null;
      const [a, b] = sim.rng.shuffle(lords.slice()).slice(0, 2);
      return {
        title: 'A Quarrel Among Lords',
        text: `${fullName(a)} and ${fullName(b)} dispute the rights to a rich river mill. Both demand the crown's judgement.`,
        choices: [
          { id: 'a', label: `Side with ${a.name}`, tooltip: `${b.name} loses loyalty`, apply: () => ((a.loyalty += 15), (b.loyalty -= 25), `${a.name} is pleased; ${b.name} seethes.`) },
          { id: 'b', label: `Side with ${b.name}`, tooltip: `${a.name} loses loyalty`, apply: () => ((b.loyalty += 15), (a.loyalty -= 25), `${b.name} is pleased; ${a.name} seethes.`) },
          { id: 'arbitrate', label: 'Split the mill and pay compensation (-250 gold)', tooltip: 'Prestige +10', apply: (s) => ((s.fac(fid).treasury -= 250), (s.fac(fid).prestige += 10), (a.loyalty += 5), (b.loyalty += 5), 'A fair judgement, remembered well.') },
        ],
      };
    },
  },
  {
    id: 'border_incident',
    weight: (sim, fid) => (sim.majorFactions().some((f) => f.id !== fid && areNeighbours(sim, fid, f.id)) ? 0.8 : 0),
    build: (sim, fid) => {
      const others = sim.majorFactions().filter((f) => f.id !== fid && areNeighbours(sim, fid, f.id));
      if (!others.length) return null;
      const o = sim.rng.pick(others).id;
      return {
        title: 'Border Incident',
        text: `Soldiers of ${sim.houseName(o)} crossed the border and killed a shepherd. Our lords demand a response.`,
        choices: [
          { id: 'demand', label: 'Demand reparations', tooltip: 'Prestige +10, their opinion -15', apply: (s) => ((s.fac(fid).prestige += 10), addModifier(s, o, fid, 'incident', 'Border incident', -15, 0.5), addModifier(s, fid, o, 'incident', 'Border incident', -10, 0.5), 'Stern words are exchanged.') },
          { id: 'let', label: 'Let it pass', tooltip: 'Prestige -5, legitimacy -2', apply: (s) => ((s.fac(fid).prestige = Math.max(0, s.fac(fid).prestige - 5)), (s.fac(fid).legitimacy -= 2), 'The matter is quietly forgotten, though not by all.') },
        ],
      };
    },
  },
  {
    id: 'pirates',
    weight: (sim, fid) => (sim.provincesOf(fid).some((p) => p.settlement.isPort) ? 0.55 : 0),
    build: (sim, fid) => {
      const p = randomProvince(sim, fid, (x) => x.settlement.isPort);
      if (!p) return null;
      return {
        title: 'Corsairs Sighted',
        text: `Corsair sails have been sighted off ${p.settlement.name}. They prey on merchants and may blockade the port.`,
        choices: [
          { id: 'pay', label: 'Pay them to sail elsewhere (-300 gold)', apply: (s) => ((s.fac(fid).treasury -= 300), 'The corsairs take the gold and depart.') },
          { id: 'fight', label: 'Let them come', tooltip: 'A corsair fleet appears near the port', apply: (s) => (spawnPirates(s, p.id), 'Corsair ships lurk off the coast. Hunt them down!') },
        ],
      };
    },
  },
  {
    id: 'plague',
    weight: (sim, fid) => (sim.provincesOf(fid).some((p) => p.settlement.tier >= 2) ? 0.25 : 0),
    build: (sim, fid) => {
      const p = randomProvince(sim, fid, (x) => x.settlement.tier >= 2);
      if (!p) return null;
      return {
        title: 'Sickness in the City',
        text: `A sweating sickness spreads through the crowded lanes of ${p.settlement.name}.`,
        choices: [
          { id: 'quarantine', label: 'Close the gates (quarantine)', tooltip: 'Population -3%, income from the city reduced this season', apply: (s) => ((p.population = Math.round(p.population * 0.97)), (s.fac(fid).treasury -= 150), orderMod(p, -5), 'The gates are shut. The sickness burns out slowly.') },
          { id: 'ignore', label: 'Keep the markets open', tooltip: 'Population -10%, order falls', apply: () => ((p.population = Math.round(p.population * 0.9)), orderMod(p, -12), 'Trade continues while the dead are carted away.') },
        ],
      };
    },
  },
  {
    id: 'commander',
    weight: () => 0.45,
    build: (sim, fid) => {
      const culture = factionDef(fid).culture;
      return {
        title: 'An Exceptional Commander',
        text: 'A landless knight of great renown, veteran of many wars, offers his sword to your house in exchange for a place at court.',
        choices: [
          {
            id: 'accept',
            label: 'Welcome him (-200 gold)',
            tooltip: 'A new general joins your court',
            apply: (s) => {
              s.fac(fid).treasury -= 200;
              const c = createCharacter(s, { dynasty: `${culture}:${s.rng.pick(['Blackwood', 'Hale', 'Varn', 'Corbet', 'Mayne'])}`, faction: fid, gender: 'm', birthTurn: s.s.turn - 4 * s.rng.int(28, 44), role: 'knight', traits: ['brave', s.rng.pick(['strategist', 'veteran', 'cautious'])] });
              c.skills.command = 12 + s.rng.int(0, 4);
              c.isKnight = true;
              c.title = 'Ser';
              return `${fullName(c)} kneels before your throne.`;
            },
          },
          { id: 'decline', label: 'Send him away', apply: () => 'He rides off to seek another lord.' },
        ],
      };
    },
  },
  {
    id: 'tournament',
    weight: (sim, fid) => (sim.fac(fid).treasury > 800 ? 0.5 : 0.1),
    build: (sim, fid) => ({
      title: 'A Grand Tournament',
      text: 'Your lords propose a great tournament of jousts and melees to celebrate the season.',
      choices: [
        { id: 'host', label: 'Host a lavish tourney (-450 gold)', tooltip: 'Prestige +35, lords\' loyalty up', apply: (s) => ((s.fac(fid).treasury -= 450), (s.fac(fid).prestige += 35), Object.values(s.s.characters).forEach((c) => c.faction === fid && c.alive && (c.loyalty += 5)), 'Banners fly and lances shatter. The realm talks of nothing else.') },
        { id: 'modest', label: 'A modest affair (-120 gold)', tooltip: 'Prestige +10', apply: (s) => ((s.fac(fid).treasury -= 120), (s.fac(fid).prestige += 10), 'A pleasant, modest tourney.') },
        { id: 'refuse', label: 'Refuse — there is no coin to spare', apply: () => 'The lords are disappointed.' },
      ],
    }),
  },
  {
    id: 'mine',
    weight: (sim, fid) => (sim.provincesOf(fid).some((p) => sim.geo.provinces[p.id].terrain === 'hills' || sim.geo.provinces[p.id].terrain === 'mountain') ? 0.35 : 0),
    build: (sim, fid) => ({
      title: 'A New Iron Seam',
      text: 'Prospectors have struck a rich seam of iron ore in the hills.',
      choices: [
        { id: 'work', label: 'Work it at once (+150 iron, -100 gold)', apply: (s) => ((s.fac(fid).iron += 150), (s.fac(fid).treasury -= 100), 'Smoke rises from new forges.') },
        { id: 'sell', label: 'Sell the rights (+300 gold)', apply: (s) => ((s.fac(fid).treasury += 300), 'A merchant consortium buys the rights.') },
      ],
    }),
  },
  {
    id: 'bountiful',
    weight: (sim) => (seasonOf(sim.s.turn) === 2 ? 0.7 : 0.1),
    build: (sim, fid) => ({
      title: 'A Bountiful Harvest',
      text: 'The harvest is the richest in living memory.',
      choices: [
        { id: 'store', label: 'Fill the granaries (+300 food)', apply: (s) => ((s.fac(fid).food += 300), 'The granaries overflow.') },
        { id: 'feast', label: 'Hold harvest feasts (+150 food, order up)', apply: (s) => ((s.fac(fid).food += 150), s.provincesOf(fid).forEach((p) => orderMod(p, 6)), 'The people feast and bless their lords.') },
      ],
    }),
  },
  {
    id: 'education',
    weight: (sim, fid) => (Object.values(sim.s.characters).some((c) => c.alive && c.faction === fid && c.dynasty === fid && age(sim, c) === 15) ? 3 : 0),
    build: (sim, fid) => {
      const c = Object.values(sim.s.characters).find((x) => x.alive && x.faction === fid && x.dynasty === fid && age(sim, x) === 15);
      if (!c) return null;
      const boost = (k: 'command' | 'diplomacy' | 'stewardship' | 'intrigue', trait: string) => () => {
        c.skills[k] = Math.min(20, c.skills[k] + 4);
        if (!c.traits.includes(trait) && c.traits.length < 4) c.traits.push(trait);
        return `${c.name} takes to the lessons.`;
      };
      return {
        title: 'Coming of Age',
        text: `${fullName(c)} approaches adulthood. Which tutors shall shape ${c.gender === 'm' ? 'him' : 'her'}?`,
        choices: [
          { id: 'martial', label: 'The master-at-arms (Command)', apply: boost('command', 'brave') },
          { id: 'diplo', label: 'The court envoy (Diplomacy)', apply: boost('diplomacy', 'diplomatic') },
          { id: 'steward', label: 'The royal steward (Stewardship)', apply: boost('stewardship', 'merchant') },
          { id: 'intrigue', label: 'The spymaster (Intrigue)', apply: boost('intrigue', 'deceitful') },
        ],
      };
    },
  },
];

export function spawnPirates(sim: Sim, pid: number) {
  const pg = sim.geo.provinces[pid];
  const waters = waterCellsNear(sim, pg.portCell >= 0 ? pg.portCell : pg.cell, 8).filter((c) => sim.geo.coastDist[c] < -3);
  if (!waters.length) return;
  const cell = sim.rng.pick(waters);
  sim.fac('pirates').alive = true;
  const f = createFleet(sim, 'pirates', cell, [newShip(sim, 'pirates', 'galley'), newShip(sim, 'pirates', sim.rng.chance(0.5) ? 'galley' : 'cog')]);
  f.name = 'Corsair Squadron';
  f.isPirate = true;
  f.order = 'blockade';
  f.orderTarget = pid;
}

/** Roll seasonal events for a faction. */
export function rollEvents(sim: Sim, fid: FactionId) {
  if (!sim.rng.chance(0.32)) return;
  const pool = EVENTS.map((e) => ({ e, w: e.weight(sim, fid) })).filter((x) => x.w > 0);
  const pick = sim.rng.weighted(pool, (x) => x.w);
  if (!pick) return;
  const built = pick.e.build(sim, fid);
  if (!built) return;
  if (sim.isPlayer(fid)) {
    const d: PendingDecision = {
      id: sim.s.ids.decision++,
      kind: 'event',
      faction: fid,
      eventId: pick.e.id,
      title: built.title,
      text: built.text,
      options: built.choices.map((c) => ({ id: c.id, label: c.label, tooltip: c.tooltip })),
      data: { ...built.data, seed: sim.rng.int(1, 1e9) },
      turn: sim.s.turn,
    };
    // keep the built closure in cache so resolution applies exactly what was offered
    sim.cache.set(`event:${d.id}`, built.choices);
    sim.s.decisions.push(d);
    sim.emit({ type: 'EVENT_TRIGGERED', decision: d.id });
  } else {
    // AI picks a sensible option
    const choices = built.choices;
    const f = sim.fac(fid);
    const choice = f.treasury > 900 ? choices[0] : choices[choices.length - 1];
    choice.apply(sim);
  }
}

/** Resolve a player decision. Returns the result text. */
export function resolveDecision(sim: Sim, decisionId: number, optionId: string): string {
  const d = sim.s.decisions.find((x) => x.id === decisionId);
  if (!d) return '';
  sim.s.decisions = sim.s.decisions.filter((x) => x.id !== decisionId);
  if (d.kind === 'proposal') {
    const p = d.data?.proposal as Proposal;
    if (!p) return '';
    if (optionId === 'accept') {
      const ev = evaluateProposal(sim, { ...p });
      if (ev.impossible) return `The proposal is no longer possible: ${ev.impossible}`;
      return executeProposal(sim, p);
    }
    addModifier(sim, p.from, p.to, 'rejected', 'Rejected our proposal', -8, 0.5);
    return `You decline the proposal of ${sim.houseName(p.from)}.`;
  }
  if (d.eventId === 'succession_crisis') {
    const rival = sim.char(d.data?.rival as number);
    const f = sim.fac(d.faction);
    if (!rival || !rival.alive) return 'The pretender is no longer a threat.';
    if (optionId === 'bribe') {
      f.treasury -= 400;
      rival.loyalty = 70;
      rival.claims = rival.claims.filter((c) => !(c.kind === 'throne' && c.target === d.faction));
      f.legitimacy = Math.min(100, f.legitimacy + 5);
      return `${fullName(rival)} accepts lands and gold and swears fealty.`;
    }
    if (optionId === 'imprison') {
      f.legitimacy = Math.max(0, f.legitimacy - 8);
      f.prestige += 10;
      killCharacter(sim, rival, 'died in captivity');
      return `${fullName(rival)} is seized and cast into the dungeons, where ${rival.gender === 'm' ? 'he' : 'she'} soon perishes.`;
    }
    rival.loyalty = Math.max(0, rival.loyalty - 10);
    (sim.fac(d.faction).aiMemory as Record<string, number>)['pretender'] = rival.id;
    return 'You ignore the grumbling. For now.';
  }
  const choices = sim.cache.get(`event:${d.id}`) as Choice[] | undefined;
  sim.cache.delete(`event:${d.id}`);
  if (choices) {
    const c = choices.find((x) => x.id === optionId);
    if (c) return c.apply(sim);
  } else {
    // decision restored from a save: rebuild from the event definition
    const ev = EVENTS.find((e) => e.id === d.eventId);
    const built = ev?.build(sim, d.faction);
    const c = built?.choices.find((x) => x.id === optionId);
    if (c) return c.apply(sim);
  }
  return '';
}

// ----------------------------------------------------------------------- rebellion

export function checkRebellions(sim: Sim) {
  for (const p of sim.s.provinces) {
    if (p.owner === 'rebels' || p.owner === 'free') continue;
    if (p.publicOrder < -25) p.unrest++;
    else p.unrest = Math.max(0, p.unrest - 1);
    const f = sim.fac(p.owner);
    const pg = sim.geo.provinces[p.id];
    if (p.publicOrder < -20 && p.unrest === 1) sim.notify({ kind: 'danger', title: 'Rebellion Brewing', text: `Unrest grows in ${p.settlement.name}. Lower taxes, station troops, or build a manor before it boils over.`, focus: { x: pg.x, z: pg.z } }, p.owner);
    if (p.unrest >= 3 && p.publicOrder < -30 && sim.rng.chance(0.35)) {
      spawnRebels(sim, p.id, undefined);
      p.unrest = 0;
    }
  }
  // pretenders rising
  for (const f of sim.majorFactions()) {
    const pid = f.aiMemory['pretender'];
    if (pid === undefined) continue;
    const rival = sim.char(pid);
    if (!rival || !rival.alive || rival.faction !== f.id) {
      delete f.aiMemory['pretender'];
      continue;
    }
    if (f.legitimacy < 55 && rival.loyalty < 35 && sim.rng.chance(0.3)) {
      const provs = sim.provincesOf(f.id).filter((p) => p.id !== f.capital);
      if (!provs.length) continue;
      const p = sim.rng.pick(provs);
      spawnRebels(sim, p.id, rival.id);
      delete f.aiMemory['pretender'];
    }
  }
}

export function spawnRebels(sim: Sim, pid: number, claimant?: number) {
  const p = sim.s.provinces[pid];
  const pg = sim.geo.provinces[pid];
  const owner = p.owner;
  sim.fac('rebels').alive = true;
  const n = 3 + p.settlement.tier * 2;
  const units = [];
  for (let i = 0; i < n; i++) units.push(newUnit(sim, sim.rng.pick(['militia', 'militia', 'spearmen', 'archers', 'swordsmen']), sim.rng.range(0.6, 1)));
  // spawn on a free land cell near the settlement
  const g = sim.geo;
  let cell = pg.cell;
  for (let t = 0; t < 30; t++) {
    const c = pg.cell + (sim.rng.int(-5, 5) * g.navW + sim.rng.int(-5, 5));
    if (c >= 0 && c < g.nav.length && g.nav[c] >= 2 && g.nav[c] < 6 && g.province[c] === pid) {
      cell = c;
      break;
    }
  }
  const rebel = sim.char(claimant);
  const a = createArmy(sim, 'rebels', cell, units);
  a.isRebel = true;
  if (rebel) {
    rebel.faction = 'rebels';
    a.general = rebel.id;
    rebel.armyId = a.id;
    a.units.unshift(newUnit(sim, 'bodyguard'));
    a.claimant = rebel.id;
    a.name = `Pretender's Host (${fullName(rebel)})`;
  } else a.name = `Rebels of ${p.settlement.name}`;
  sim.emit({ type: 'REBELLION', province: pid, army: a.id, faction: owner });
  sim.chronicle(`Rebellion broke out in ${p.settlement.name} against ${sim.houseName(owner)}.`, [owner], 'rebellion');
  sim.notify({ kind: 'danger', title: 'Rebellion!', text: `${rebel ? fullName(rebel) + ' has raised the banner of revolt' : 'The people have risen in revolt'} near ${p.settlement.name}!`, focus: { x: pg.x, z: pg.z } }, owner);
  void transferProvince;
}
