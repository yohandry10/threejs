import type { BattleSim, BUnit, Side } from './sim';
import { PLAY } from './field';
import { clamp } from '../core/math';

type Role = 'inf' | 'ranged' | 'cav' | 'general' | 'engine' | 'ram';

function roleOf(u: BUnit): Role {
  const d = u.def;
  if (u.isGeneral) return 'general';
  if (d.id === 'ram') return 'ram';
  if (d.category === 'siege') return 'engine';
  if (d.visual.mounted) return 'cav';
  if (d.range) return 'ranged';
  return 'inf';
}

interface Memo {
  cav?: 'wait' | 'flank' | 'charge' | 'regroup';
  cavT?: number;
  flankPt?: { x: number; z: number };
  home?: { x: number; z: number };
  wallX?: number;
}

/**
 * Battle AI for one side. Controls every unit flagged `ai` on that side:
 * line advance, target matching, archers skirmishing behind the line, cavalry flanking and
 * cycle charges, generals staying safe, and dedicated siege assault / wall defence plans.
 */
export class BattleAI {
  private t = 0.5;
  private memo = new Map<number, Memo>();
  private assaultAt: number;
  private stance: 'attack' | 'defend' = 'attack';
  private started = 0;
  constructor(
    private sim: BattleSim,
    public side: Side,
  ) {
    this.assaultAt = 0;
  }

  private m(u: BUnit): Memo {
    let v = this.memo.get(u.id);
    if (!v) this.memo.set(u.id, (v = {}));
    return v;
  }

  update(dt: number) {
    if (!this.sim.started || this.sim.winner !== null) return;
    this.started += dt;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1.1;
    const sim = this.sim;
    if (sim.siege) {
      if (this.side === 0) this.siegeAttack();
      else this.siegeDefend();
    } else this.field();
  }

  private mine() {
    return this.sim.units.filter((u) => u.side === this.side && u.ai && this.sim.canCommand(u));
  }
  private enemies() {
    return this.sim.units.filter((u) => u.side !== this.side && u.state !== 'fled' && u.state !== 'dead');
  }
  private reachableUnit(u: BUnit, e: BUnit) {
    const f = this.sim.field;
    if (!f.fort) return true;
    const a = f.inside(u.cx, u.cz);
    const b = f.inside(e.cx, e.cz);
    return a === b || f.passages().length > 0 || (this.side === 0 && !u.def.visual.mounted);
  }
  private nearest(u: BUnit, list: BUnit[], pred?: (e: BUnit) => boolean) {
    let best: BUnit | null = null;
    let bd = Infinity;
    for (const e of list) {
      if (pred && !pred(e)) continue;
      let d = Math.hypot(e.cx - u.cx, e.cz - u.cz);
      if (e.state === 'routing') d += 80;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best ? { u: best, d: bd } : null;
  }
  private centroid(list: BUnit[]) {
    let x = 0;
    let z = 0;
    let w = 0;
    for (const u of list) {
      x += u.cx * u.alive;
      z += u.cz * u.alive;
      w += u.alive;
    }
    return w ? { x: x / w, z: z / w } : null;
  }

  // ------------------------------------------------------------------ field battles
  private field() {
    const sim = this.sim;
    const mine = this.mine();
    const foes = this.enemies();
    const standing = foes.filter((e) => e.state !== 'routing');
    if (!mine.length || !foes.length) return;
    const E = this.centroid(standing.length ? standing : foes)!;
    const allMine = sim.units.filter((u) => u.side === this.side && sim.canCommand(u));
    const O = this.centroid(allMine) ?? E;
    const dist = Math.hypot(E.x - O.x, E.z - O.z);
    const fac = Math.atan2(E.x - O.x, E.z - O.z);
    const dirX = Math.sin(fac);
    const dirZ = Math.cos(fac);
    const ratio = sim.sideStrength(this.side) / Math.max(1, sim.sideStrength(this.side === 0 ? 1 : 0));
    const rangedPow = (s: Side) => sim.units.filter((u) => u.side === s && u.def.range && u.def.category !== 'siege' && sim.canCommand(u)).reduce((a, u) => a + u.alive * (u.def.missileDamage ?? 0), 0);
    const myR = rangedPow(this.side);
    const theirR = rangedPow(this.side === 0 ? 1 : 0);
    // defenders with a decent position or ranged edge wait; attackers and those out-shot advance
    const defensive = (this.side === 1 && ratio < 1.8 && theirR < myR * 1.4) || (ratio < 0.65 && theirR < myR * 1.2);
    this.stance = defensive && this.started < 240 ? 'defend' : 'attack';
    const infantry = mine.filter((u) => roleOf(u) === 'inf');
    const infC = this.centroid(infantry) ?? O;
    const engagedAny = foes.some((e) => sim.time - e.engagedT < 2);

    for (const u of mine) {
      const role = roleOf(u);
      const memo = this.m(u);
      if (!memo.home) memo.home = { x: u.cx, z: u.cz };
      const near = this.nearest(u, foes, (e) => e.state !== 'routing');
      if (role === 'inf') {
        if (near && near.d < (this.stance === 'defend' ? 70 : 110)) {
          if (u.order !== 'attack' || u.target !== near.u || u.target.state === 'routing') {
            // match the unit facing us rather than piling onto one target
            const tgt = this.pickMeleeTarget(u, standing) ?? near.u;
            sim.orderAttack(u, tgt, near.d < 55);
          }
        } else if (this.stance === 'attack' && dist > 90) {
          const step = 45;
          sim.orderMove(u, u.x + dirX * step, u.z + dirZ * step, fac, false);
        } else if (this.stance === 'defend' && u.order === 'idle' && Math.abs(u.facing - fac) > 0.4) {
          sim.orderMove(u, u.x, u.z, fac, false);
        }
      } else if (role === 'ranged') {
        const threat = this.nearest(u, foes, (e) => !e.def.range && e.state !== 'routing');
        if (threat && threat.d < 38 && sim.time - u.engagedT > 2 && u.ammo > 0) {
          // skirmish back behind friendly lines
          const bx = u.cx - Math.sin(fac) * 45;
          const bz = u.cz - Math.cos(fac) * 45;
          sim.orderMove(u, bx, bz, fac, true);
        } else if (u.ammo <= 0) {
          if (near && near.d < 40) sim.orderAttack(u, near.u, true);
          else if (u.order === 'idle' && infantry.length) sim.orderMove(u, infC.x - dirX * 30, infC.z - dirZ * 30, fac, false);
        } else if (u.order !== 'fire' || !u.target) {
          // keep pace behind the infantry, or advance into range
          const inRange = near && near.d < sim.rangeOf(u) * 0.95;
          if (!inRange) {
            if (this.stance === 'attack' || !near) {
              const lat = (u.cx - O.x) * Math.cos(fac) - (u.cz - O.z) * Math.sin(fac);
              const tx = (infantry.length ? infC.x - dirX * 28 : u.cx + dirX * 40) + Math.cos(fac) * lat * 0.2;
              const tz = (infantry.length ? infC.z - dirZ * 28 : u.cz + dirZ * 40) - Math.sin(fac) * lat * 0.2;
              if (Math.hypot(tx - u.x, tz - u.z) > 12) sim.orderMove(u, tx, tz, fac, false);
            }
          }
        }
      } else if (role === 'cav') {
        this.cavalry(u, memo, foes, standing, infC, fac, engagedAny);
      } else if (role === 'general') {
        const threat = this.nearest(u, foes, (e) => e.state !== 'routing' && !e.def.range);
        const healthy = u.alive > u.startCount * 0.55;
        if (threat && threat.d < 32 && healthy) {
          if (u.order !== 'attack') sim.orderAttack(u, threat.u, true);
        } else if (threat && threat.d < 32) {
          sim.orderMove(u, u.cx - dirX * 60, u.cz - dirZ * 60, fac, true);
        } else if (u.order !== 'attack' || !healthy) {
          const tx = infC.x - dirX * 55;
          const tz = infC.z - dirZ * 55;
          if (Math.hypot(tx - u.x, tz - u.z) > 15) sim.orderMove(u, tx, tz, fac, false);
        }
      } else if (role === 'engine') {
        if (near && near.d > sim.rangeOf(u)) {
          if (this.stance === 'attack' && u.order === 'idle') sim.orderMove(u, u.x + dirX * 30, u.z + dirZ * 30, fac, false);
        }
      }
    }
  }

  private pickMeleeTarget(u: BUnit, foes: BUnit[]): BUnit | null {
    // prefer the enemy roughly in front of us and not already swarmed by our units
    let best: BUnit | null = null;
    let bs = -Infinity;
    for (const e of foes) {
      if (!this.reachableUnit(u, e)) continue;
      const d = Math.hypot(e.cx - u.cx, e.cz - u.cz);
      if (d > 160) continue;
      const ang = Math.atan2(e.cx - u.cx, e.cz - u.cz) - u.facing;
      const front = Math.cos(ang);
      const attackers = this.sim.units.filter((o) => o.side === u.side && o.target === e && o !== u).length;
      let s = -d + front * 30 - attackers * 25;
      if (e.def.range) s += 20;
      if (e.def.visual.mounted && u.def.category !== 'spear') s -= 25;
      if (e.state === 'wavering') s += 10;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    return best;
  }

  private cavalry(u: BUnit, memo: Memo, foes: BUnit[], standing: BUnit[], infC: { x: number; z: number }, fac: number, engagedAny: boolean) {
    const sim = this.sim;
    memo.cav ??= 'wait';
    memo.cavT = (memo.cavT ?? 0) + 1.1;
    const engaged = sim.time - u.engagedT < 1.5;
    // regroup after a long melee then charge again
    if (memo.cav === 'charge' && engaged && memo.cavT > 14 && u.morale < 45 && u.alive > u.startCount * 0.3) {
      memo.cav = 'regroup';
      memo.cavT = 0;
      sim.orderMove(u, u.cx - Math.sin(fac) * 90, u.cz - Math.cos(fac) * 90, fac, true);
      return;
    }
    if (memo.cav === 'regroup') {
      if (memo.cavT > 10) memo.cav = 'wait';
      return;
    }
    // chase routers when nothing better to do
    const routers = foes.filter((e) => e.state === 'routing');
    const soft = standing.filter((e) => (e.def.range || e.def.category === 'siege') && !this.protectedUnit(e));
    const engagedFoes = standing.filter((e) => sim.time - e.engagedT < 2 && !e.def.visual.mounted);
    let target: BUnit | null = null;
    if (soft.length) target = this.nearest(u, soft)!.u;
    else if (engagedFoes.length && engagedAny) target = this.nearest(u, engagedFoes)!.u;
    else if (!standing.length && routers.length) target = this.nearest(u, routers)!.u;
    else {
      const enemyCav = standing.filter((e) => e.def.visual.mounted);
      const c = this.nearest(u, enemyCav);
      if (c && c.d < 120) target = c.u;
    }
    if (!target) {
      // guard the flank of our line
      if (u.order === 'idle' || memo.cav !== 'wait') {
        memo.cav = 'wait';
        const lat = (u.cx - infC.x) * Math.cos(fac) - (u.cz - infC.z) * Math.sin(fac);
        const sgn = lat >= 0 ? 1 : -1;
        const tx = infC.x + Math.cos(fac) * sgn * 110 - Math.sin(fac) * 10;
        const tz = infC.z - Math.sin(fac) * sgn * 110 - Math.cos(fac) * 10;
        if (Math.hypot(tx - u.x, tz - u.z) > 20) sim.orderMove(u, tx, tz, fac, false);
      }
      return;
    }
    if (u.target === target && u.order === 'attack') return;
    // go around to the flank / rear before charging an engaged enemy
    const tFac = target.facing;
    const behindX = target.cx - Math.sin(tFac) * 45;
    const behindZ = target.cz - Math.cos(tFac) * 45;
    const dFront = Math.hypot(u.cx - (target.cx + Math.sin(tFac) * 40), u.cz - (target.cz + Math.cos(tFac) * 40));
    const dBehind = Math.hypot(u.cx - behindX, u.cz - behindZ);
    const engagedTarget = sim.time - target.engagedT < 2;
    if (engagedTarget && dBehind > 30 && dFront < dBehind && memo.cav !== 'flank') {
      memo.cav = 'flank';
      memo.cavT = 0;
      const side = (u.cx - target.cx) * Math.cos(tFac) - (u.cz - target.cz) * Math.sin(tFac) >= 0 ? 1 : -1;
      memo.flankPt = { x: clamp(target.cx + Math.cos(tFac) * side * 55 - Math.sin(tFac) * 30, -PLAY + 10, PLAY - 10), z: clamp(target.cz - Math.sin(tFac) * side * 55 - Math.cos(tFac) * 30, -PLAY + 10, PLAY - 10) };
      sim.orderMove(u, memo.flankPt.x, memo.flankPt.z, null, true);
      return;
    }
    if (memo.cav === 'flank' && memo.flankPt && Math.hypot(u.cx - memo.flankPt.x, u.cz - memo.flankPt.z) > 25 && memo.cavT < 25) return;
    memo.cav = 'charge';
    memo.cavT = 0;
    sim.orderAttack(u, target, true);
  }

  private protectedUnit(e: BUnit) {
    // is an enemy ranged unit screened by its own melee units?
    return this.sim.units.some((o) => o.side === e.side && !o.def.range && o.state === 'ok' && Math.hypot(o.cx - e.cx, o.cz - e.cz) < 35);
  }

  // ------------------------------------------------------------------ sieges
  private siegeAttack() {
    const sim = this.sim;
    const f = sim.field;
    const fort = f.fort!;
    const mine = this.mine();
    const foes = this.enemies();
    if (!mine.length) return;
    const passages = f.passages();
    const open = passages.length > 0;
    const rams = mine.filter((u) => roleOf(u) === 'ram');
    const engines = mine.filter((u) => roleOf(u) === 'engine');
    if (!this.assaultAt) this.assaultAt = rams.length || engines.length ? 150 : 25;
    const assault = open || this.started > this.assaultAt;
    const wz0 = f.wallZ(0);
    for (const u of mine) {
      const role = roleOf(u);
      const memo = this.m(u);
      if (role === 'ram') {
        if (!fort.gate.open && u.order !== 'ram') sim.orderRam(u);
        continue;
      }
      if (role === 'engine') {
        if (u.order !== 'bombard' || !u.targetPt) {
          // towers covering the approach first, then the wall next to the gate
          const tw = fort.towers.map((t, i) => ({ t, i })).filter((x) => x.t.alive && Math.abs(x.t.x) < 120);
          if (tw.length && !rams.length) {
            const pick = tw.sort((a, b) => Math.abs(a.t.x) - Math.abs(b.t.x))[0];
            sim.orderBombard(u, { x: pick.t.x, z: pick.t.z, kind: 'tower', index: pick.i });
          } else if (!fort.gate.open && !rams.length) {
            sim.orderBombard(u, { x: 0, z: wz0, kind: 'gate', index: 0 });
          } else {
            memo.wallX ??= (u.id % 2 ? 1 : -1) * (50 + (u.id % 3) * 20);
            const seg = f.segAt(memo.wallX);
            if (seg && seg.breached) {
              // switch to firing at defenders
              u.order = 'idle';
              u.targetPt = null;
              u.fireAtWill = true;
            } else sim.orderBombard(u, { x: memo.wallX, z: f.wallZ(memo.wallX), kind: 'wall', index: 0 });
          }
        }
        continue;
      }
      if (role === 'ranged') {
        if (u.order !== 'fire') {
          const x = clamp(u.cx, -120, 120);
          const tz = f.wallZ(x) + 95;
          if (Math.hypot(u.x - x, u.z - tz) > 15) sim.orderMove(u, x, tz, Math.PI, false);
        }
        continue;
      }
      if (role === 'general') {
        const tz = assault ? wz0 + 110 : wz0 + 190;
        if (Math.hypot(u.x, u.z - tz) > 20 && u.order !== 'attack') sim.orderMove(u, 0, tz, Math.PI, false);
        const threat = this.nearest(u, foes, (e) => e.state !== 'routing' && !f.inside(e.cx, e.cz));
        if (threat && threat.d < 35 && u.alive > u.startCount * 0.5) sim.orderAttack(u, threat.u, true);
        continue;
      }
      // infantry and cavalry
      const near = this.nearest(u, foes, (e) => e.state !== 'routing' && this.reachableUnit(u, e));
      if (near && near.d < 45 && (f.inside(near.u.cx, near.u.cz) === f.inside(u.cx, u.cz) || open)) {
        if (u.order !== 'attack' || u.target?.state === 'routing') sim.orderAttack(u, near.u, true);
        continue;
      }
      if (!assault || (role === 'cav' && !open)) {
        memo.home ??= { x: u.cx, z: u.cz };
        const tz = f.wallZ(clamp(u.cx, -fort.halfW, fort.halfW)) + 150;
        if (u.order === 'idle' && Math.abs(u.z - tz) > 25) sim.orderMove(u, clamp(u.cx, -150, 150), tz, Math.PI, false);
        continue;
      }
      // assault: through the gate/breach to the plaza, or over the walls with ladders
      if (u.order === 'move' || u.order === 'attack') continue;
      if (open) {
        const p = f.nearestPassage(u.cx)!;
        const inside = f.inside(u.cx, u.cz);
        if (!inside) sim.orderMove(u, p.x, f.wallZ(p.x) - 25, Math.PI, true);
        else sim.orderMove(u, fort.plaza.x + ((u.id % 3) - 1) * 12, fort.plaza.z + 6, Math.PI, true);
      } else if (role === 'inf') {
        memo.wallX ??= clamp(u.cx, -110, 110);
        const inside = f.inside(u.cx, u.cz);
        if (!inside) sim.orderMove(u, memo.wallX, f.wallZ(memo.wallX) - 8, Math.PI, false);
        else sim.orderMove(u, fort.plaza.x, fort.plaza.z, Math.PI, true);
      }
    }
  }

  private siegeDefend() {
    const sim = this.sim;
    const f = sim.field;
    const fort = f.fort!;
    const mine = this.mine();
    const foes = this.enemies();
    if (!mine.length) return;
    const passages = f.passages();
    const intruders = foes.filter((e) => f.inside(e.cx, e.cz) || e.soldiers.filter((s) => s.alive && !s.climbing && f.inside(s.x, s.z)).length > 3);
    const ranged = mine.filter((u) => roleOf(u) === 'ranged');
    // archers man the walls around the gate
    let off = 0;
    const order = [...ranged].sort((a, b) => a.id - b.id);
    order.forEach((u, i) => {
      const memo = this.m(u);
      if (memo.wallX === undefined) {
        const w = Math.ceil(u.alive / 2) * 1.15;
        const sgn = i % 2 === 0 ? 1 : -1;
        memo.wallX = sgn * (18 + off + w / 2);
        if (sgn < 0) off += w + 4;
      }
      const x = memo.wallX;
      const seg = f.segAt(x);
      const threat = this.nearest(u, intruders);
      if (threat && threat.d < 20 && u.ammo <= 0) {
        sim.orderAttack(u, threat.u, true);
        return;
      }
      if (seg && seg.breached) {
        if (u.order === 'idle' && !u.dest) sim.orderMove(u, x * 0.5, f.wallZ(x) - 30, 0, false);
        return;
      }
      const tz = f.wallZ(x) - 1.7;
      if (Math.hypot(u.x - x, u.z - tz) > 3 && u.order !== 'fire') sim.orderMove(u, x, tz, 0, false, Math.ceil(u.alive / 2));
    });
    for (const u of mine) {
      const role = roleOf(u);
      if (role === 'ranged') continue;
      const inReach = this.nearest(u, intruders);
      if (inReach && inReach.d < 140) {
        if (u.order !== 'attack' || u.target !== inReach.u) sim.orderAttack(u, inReach.u, inReach.d < 60);
        continue;
      }
      if (role === 'general') {
        if (Math.hypot(u.x - fort.plaza.x, u.z - fort.plaza.z + 25) > 15) sim.orderMove(u, fort.plaza.x, fort.plaza.z + 25, 0, false);
        continue;
      }
      // block the openings, or wait behind the gate
      let tx = 0;
      let tz = f.wallZ(0) - 28;
      if (passages.length) {
        const p = passages[u.id % passages.length];
        tx = (p.x0 + p.x1) / 2;
        tz = f.wallZ(tx) - 14;
      } else if (role === 'cav') {
        tx = fort.plaza.x + (u.id % 2 ? 20 : -20);
        tz = fort.plaza.z + 20;
      } else {
        tx = ((u.id % 5) - 2) * 25;
      }
      if (u.order === 'idle' && Math.hypot(u.x - tx, u.z - tz) > 8) sim.orderMove(u, tx, tz, 0, false);
      // counter-attack attackers lingering right outside an open gate
      if (passages.length) {
        const out = this.nearest(u, foes, (e) => !f.inside(e.cx, e.cz) && e.state !== 'routing');
        if (out && out.d < 30 && role !== 'cav') sim.orderAttack(u, out.u, true);
      }
    }
  }
}
