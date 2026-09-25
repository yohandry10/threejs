import { skillOf, fullName, age, ADULT_AGE, detachFromPosts } from './characters';
import type { Sim } from './context';
import { addModifier } from './diplomacy';
import { COUNCIL_SEATS, type CouncilSeat, type FactionId, type IntrigueOp } from './types';

export const INTRIGUE_KINDS: Record<IntrigueOp['kind'], { name: string; desc: string; cost: number; turns: number; base: number; detect: number }> = {
  intel: { name: 'Gather Intelligence', desc: 'Spies report every army, fleet and garrison of the target realm for two years.', cost: 150, turns: 1, base: 0.7, detect: 0.12 },
  sabotage: { name: 'Sow Discord', desc: 'Forged letters damage relations between the target and a third house.', cost: 250, turns: 2, base: 0.55, detect: 0.25 },
  opposition: { name: 'Support Their Opposition', desc: 'Fund malcontent lords: target legitimacy and public order fall.', cost: 350, turns: 2, base: 0.5, detect: 0.3 },
  fabricate: { name: 'Fabricate a Claim', desc: 'Forge old charters granting your house a claim on one of their provinces. A casus belli for war.', cost: 400, turns: 3, base: 0.5, detect: 0.3 },
};

export function spymasterOf(sim: Sim, fid: FactionId) {
  return sim.char(sim.fac(fid)?.council.spymaster);
}

export function intrigueChance(sim: Sim, fid: FactionId, kind: IntrigueOp['kind'], target: FactionId) {
  const def = INTRIGUE_KINDS[kind];
  const mine = skillOf(spymasterOf(sim, fid), 'intrigue');
  const theirs = skillOf(spymasterOf(sim, target), 'intrigue');
  const chance = Math.max(0.1, Math.min(0.95, def.base + (mine - theirs) * 0.03));
  const detect = Math.max(0.05, Math.min(0.8, def.detect + (theirs - mine) * 0.025));
  return { chance, detect };
}

export function startIntrigue(sim: Sim, fid: FactionId, kind: IntrigueOp['kind'], target: FactionId, extra: { third?: FactionId; province?: number } = {}): string | null {
  const def = INTRIGUE_KINDS[kind];
  const f = sim.fac(fid);
  if (!spymasterOf(sim, fid)) return 'Appoint a Spymaster to your council first.';
  if (f.treasury < def.cost) return 'Not enough gold.';
  if (sim.s.intrigue.filter((o) => o.faction === fid).length >= 2) return 'Your spymaster can only run two operations at once.';
  if (kind === 'sabotage' && !extra.third) return 'Choose a third house.';
  if (kind === 'fabricate' && extra.province === undefined) return 'Choose a province.';
  if (target === fid) return 'Invalid target.';
  const { chance, detect } = intrigueChance(sim, fid, kind, target);
  f.treasury -= def.cost;
  sim.s.intrigue.push({ id: sim.s.ids.op++, faction: fid, kind, target, third: extra.third, province: extra.province, turnsLeft: def.turns, chance, detectChance: detect });
  return null;
}

export function resolveIntrigue(sim: Sim) {
  const done: IntrigueOp[] = [];
  for (const op of sim.s.intrigue) {
    op.turnsLeft--;
    if (op.turnsLeft <= 0) done.push(op);
  }
  sim.s.intrigue = sim.s.intrigue.filter((o) => o.turnsLeft > 0);
  for (const op of done) {
    if (!sim.fac(op.target)?.alive) continue;
    const ok = sim.rng.chance(op.chance);
    const caught = sim.rng.chance(op.detectChance);
    const def = INTRIGUE_KINDS[op.kind];
    let text = '';
    if (ok) {
      switch (op.kind) {
        case 'intel':
          sim.fac(op.faction).intelOn[op.target] = sim.s.turn + 8;
          text = `Our agents now report on every movement of ${sim.houseName(op.target)}.`;
          break;
        case 'sabotage':
          if (op.third) {
            addModifier(sim, op.target, op.third, 'sabotage', 'Forged insults', -25, 0.5);
            addModifier(sim, op.third, op.target, 'sabotage', 'Forged insults', -25, 0.5);
          }
          text = `Forged letters have poisoned relations between ${sim.houseName(op.target)} and ${sim.houseName(op.third ?? '')}.`;
          break;
        case 'opposition':
          sim.fac(op.target).legitimacy = Math.max(0, sim.fac(op.target).legitimacy - 12);
          for (const p of sim.provincesOf(op.target).slice(0, 3)) (p as typeof p & { eventOrder?: number }).eventOrder = ((p as typeof p & { eventOrder?: number }).eventOrder ?? 0) - 10;
          text = `Malcontent lords in the realm of ${sim.houseName(op.target)} grow bold.`;
          break;
        case 'fabricate': {
          const ruler = sim.char(sim.fac(op.faction).ruler);
          if (ruler && op.province !== undefined) ruler.claims.push({ kind: 'province', target: op.province, strength: 2, source: 'fabricated', sinceTurn: sim.s.turn });
          text = `Old charters "rediscovered": our house now holds a claim on ${sim.provName(op.province ?? 0)}.`;
          break;
        }
      }
    } else text = `Our ${def.name.toLowerCase()} against ${sim.houseName(op.target)} came to nothing.`;
    if (caught) {
      addModifier(sim, op.target, op.faction, 'caught_spying', 'Caught our spies', -30, 0.4);
      sim.s.diplomacy.reputation[op.faction] = Math.max(0, (sim.s.diplomacy.reputation[op.faction] ?? 60) - 5);
      text += ' Worse, our agents were caught and the plot exposed.';
      if (sim.isPlayer(op.target)) sim.notify({ kind: 'diplomacy', title: 'Spies Unmasked', text: `Agents of ${sim.houseName(op.faction)} were caught plotting against us (${def.name}).` });
    }
    if (sim.isPlayer(op.faction)) sim.notify({ kind: 'diplomacy', title: ok ? `${def.name}: Success` : `${def.name}: Failure`, text });
  }
}

// ------------------------------------------------------------------------ council

export const SEAT_INFO: Record<CouncilSeat, { name: string; skill: 'command' | 'diplomacy' | 'stewardship' | 'intrigue'; effect: string }> = {
  chancellor: { name: 'Chancellor', skill: 'diplomacy', effect: 'Improves how other houses regard you and their willingness to accept proposals.' },
  marshal: { name: 'Marshal', skill: 'command', effect: 'Reduces recruitment costs and speeds army marches.' },
  steward: { name: 'Steward', skill: 'stewardship', effect: 'Increases tax and trade income, reduces construction cost.' },
  spymaster: { name: 'Spymaster', skill: 'intrigue', effect: 'Enables intrigue and improves its odds; protects against enemy plots.' },
  admiral: { name: 'Admiral', skill: 'command', effect: 'Speeds fleets and strengthens them at sea.' },
};

export function councilCandidates(sim: Sim, fid: FactionId) {
  return Object.values(sim.s.characters).filter((c) => c.alive && c.faction === fid && age(sim, c) >= ADULT_AGE && c.role !== 'ruler');
}

export function assignCouncil(sim: Sim, fid: FactionId, seat: CouncilSeat, charId: number | undefined) {
  const f = sim.fac(fid);
  const prev = sim.char(f.council[seat]);
  if (prev) prev.council = undefined;
  if (charId === undefined) {
    delete f.council[seat];
    return;
  }
  const c = sim.char(charId);
  if (!c) return;
  if (c.council) delete f.council[c.council];
  c.council = seat;
  f.council[seat] = c.id;
}

export function aiFillCouncil(sim: Sim, fid: FactionId) {
  const f = sim.fac(fid);
  for (const seat of COUNCIL_SEATS) {
    const cur = sim.char(f.council[seat]);
    if (cur && cur.alive && cur.faction === fid) continue;
    const pool = councilCandidates(sim, fid).filter((c) => !c.council);
    pool.sort((a, b) => skillOf(b, SEAT_INFO[seat].skill) - skillOf(a, SEAT_INFO[seat].skill));
    if (pool[0]) assignCouncil(sim, fid, seat, pool[0].id);
  }
}

export function describeChar(sim: Sim, id: number) {
  const c = sim.char(id);
  return c ? fullName(c) : '';
}
export { detachFromPosts };
