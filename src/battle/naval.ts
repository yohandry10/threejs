import { shipDef, type ShipDef } from '../data/units';
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import type { Sim } from '../sim/context';
import type { BattleOutcome, BattleSetup } from '../sim/battles';
import { skillOf } from '../sim/characters';
import { turnToward, type Side } from './sim';

export const SEA_R = 900;

export interface NShip {
  id: number;
  side: Side;
  faction: string;
  uid: number;
  name: string;
  type: string;
  def: ShipDef;
  x: number;
  z: number;
  heading: number;
  speed: number;
  hull: number;
  maxHull: number;
  crew: number;
  maxCrew: number;
  startHull: number;
  startCrew: number;
  order: 'idle' | 'move' | 'attack' | 'board';
  dest: { x: number; z: number } | null;
  target: NShip | null;
  sinking: number;
  sunk: boolean;
  capturedBy: Side | null;
  fled: boolean;
  fleeing: boolean;
  grappled: NShip | null;
  reloadA: number;
  reloadB: number;
  ramT: number;
  ai: boolean;
  xp: number;
  cmd: number; // commander bonus
  lastFire: number;
  fighting: number;
  turnRate: number;
}

export interface NavalShot {
  alive: boolean;
  kind: 'arrow' | 'bolt';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
}

export interface NavalEvent {
  kind: 'sink' | 'capture' | 'ram' | 'grapple' | 'volley' | 'bolt' | 'hit' | 'splash' | 'clash' | 'horn' | 'flee';
  x: number;
  z: number;
  ship?: NShip;
}

/** Real-time naval battle: sailing with the wind, arrow volleys, ballistae, ramming, boarding and capture. */
export class NavalSim {
  ships: NShip[] = [];
  shots: NavalShot[] = [];
  events: NavalEvent[] = [];
  time = 0;
  rng: Rng;
  windDir: number;
  wind: number;
  winner: Side | null = null;
  endReason = '';
  started = false;
  constructor(seed: number, weather: string) {
    this.rng = new Rng(seed ^ 0x5eaf00d);
    this.windDir = this.rng.range(0, Math.PI * 2);
    this.wind = weather === 'storm' ? 1.5 : weather === 'rain' ? 1.15 : weather === 'fog' ? 0.6 : 1;
  }

  add(side: Side, faction: string, uid: number, type: string, name: string, hull: number, maxHull: number, crew: number, maxCrew: number, xp: number, ai: boolean, cmd: number, x: number, z: number, heading: number) {
    const def = shipDef(type);
    const s: NShip = {
      id: this.ships.length,
      side,
      faction,
      uid,
      name,
      type,
      def,
      x,
      z,
      heading,
      speed: 0,
      hull,
      maxHull,
      crew,
      maxCrew,
      startHull: hull,
      startCrew: crew,
      order: 'idle',
      dest: null,
      target: null,
      sinking: 0,
      sunk: false,
      capturedBy: null,
      fled: false,
      fleeing: false,
      grappled: null,
      reloadA: this.rng.range(0, 3),
      reloadB: this.rng.range(0, 5),
      ramT: 0,
      ai,
      xp,
      cmd,
      lastFire: -99,
      fighting: 0,
      turnRate: 0,
    };
    this.ships.push(s);
    return s;
  }

  active(s: NShip) {
    return !s.sunk && s.sinking === 0 && s.capturedBy === null && !s.fled;
  }
  canCommand(s: NShip) {
    return this.active(s) && !s.fleeing;
  }
  radius(s: NShip) {
    return s.def.length * 0.32;
  }

  // ------------------------------------------------------------------ orders
  orderMove(s: NShip, x: number, z: number) {
    if (!this.canCommand(s) || s.grappled) return;
    s.order = 'move';
    s.target = null;
    const r = Math.hypot(x, z);
    const k = r > SEA_R - 40 ? (SEA_R - 40) / r : 1;
    s.dest = { x: x * k, z: z * k };
  }
  orderAttack(s: NShip, t: NShip, board: boolean) {
    if (!this.canCommand(s) || t.side === s.side || !this.active(t)) return;
    s.order = board ? 'board' : 'attack';
    s.target = t;
    s.dest = null;
  }
  orderHalt(s: NShip) {
    if (!this.canCommand(s)) return;
    s.order = 'idle';
    s.dest = null;
    s.target = null;
  }
  withdraw(side: Side) {
    for (const s of this.ships) if (s.side === side && this.active(s)) this.flee(s);
  }
  private flee(s: NShip) {
    s.fleeing = true;
    s.order = 'move';
    if (s.grappled) {
      s.grappled.grappled = null;
      s.grappled = null;
    }
    const a = Math.atan2(s.x, s.z + (s.side === 0 ? -1 : 1) * 200);
    s.dest = { x: Math.sin(a) * (SEA_R + 60), z: Math.cos(a) * (SEA_R + 60) };
    this.events.push({ kind: 'flee', x: s.x, z: s.z, ship: s });
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    this.time += dt;
    for (const s of this.ships) {
      if (s.sinking > 0 && !s.sunk) {
        s.sinking = Math.min(1, s.sinking + dt / 14);
        s.speed *= 1 - dt;
        if (s.sinking >= 1) s.sunk = true;
      }
    }
    if (this.winner === null && this.started) {
      for (const s of this.ships) if (this.canCommand(s) || s.fleeing) this.steer(s, dt);
      this.collide();
      this.combat(dt);
      this.updateShots(dt);
      this.check();
    } else {
      for (const s of this.ships) if (this.active(s)) s.speed *= 1 - dt * 0.3;
    }
    for (const s of this.ships) {
      if (s.sunk || s.fled) continue;
      if (s.grappled) continue;
      s.x += Math.sin(s.heading) * s.speed * dt;
      s.z += Math.cos(s.heading) * s.speed * dt;
      if (s.fleeing && Math.hypot(s.x, s.z) > SEA_R) s.fled = true;
    }
  }

  private windFactor(s: NShip) {
    if (s.def.id === 'galley') return 0.95;
    const rel = Math.cos(this.windDir - s.heading);
    return clamp(0.45 + 0.55 * (rel * 0.5 + 0.5), 0.4, 1) * (0.8 + this.wind * 0.2);
  }

  private steer(s: NShip, dt: number) {
    if (s.grappled) {
      s.speed = 0;
      return;
    }
    let tx: number | null = null;
    let tz: number | null = null;
    let want = s.def.speed * this.windFactor(s) * (0.55 + 0.45 * (s.crew / s.maxCrew));
    const t = s.target;
    if (t && !this.active(t)) {
      s.target = null;
      s.order = 'idle';
    }
    if (s.order === 'move' && s.dest) {
      tx = s.dest.x;
      tz = s.dest.z;
      const d = Math.hypot(tx - s.x, tz - s.z);
      if (d < 20) {
        want *= d / 20;
        if (d < 6) {
          s.order = 'idle';
          s.dest = null;
        }
      }
    } else if (s.order === 'board' && s.target) {
      tx = s.target.x;
      tz = s.target.z;
      const d = Math.hypot(tx - s.x, tz - s.z);
      if (d < this.radius(s) + this.radius(s.target) + 8 && s.speed < 4.5) {
        // grapple
        if (!s.target.grappled) {
          s.grappled = s.target;
          s.target.grappled = s;
          s.speed = 0;
          s.target.speed = 0;
          this.events.push({ kind: 'grapple', x: (s.x + s.target.x) / 2, z: (s.z + s.target.z) / 2, ship: s });
          return;
        }
      }
      if (d < 60) want = Math.min(want, 3.5);
    } else if (s.order === 'attack' && s.target) {
      const tg = s.target;
      const d = Math.hypot(tg.x - s.x, tg.z - s.z);
      const ram = s.def.id === 'galley';
      if (ram) {
        tx = tg.x + Math.sin(tg.heading) * tg.speed * 3;
        tz = tg.z + Math.cos(tg.heading) * tg.speed * 3;
      } else {
        // hold at archery range, broadside on
        const stand = 70;
        const ang = Math.atan2(s.x - tg.x, s.z - tg.z);
        const side = Math.sin(s.heading - ang) > 0 ? 1 : -1;
        const a2 = ang + side * 0.5;
        tx = tg.x + Math.sin(a2) * stand;
        tz = tg.z + Math.cos(a2) * stand;
        if (d < stand * 1.1) want *= 0.6;
      }
    }
    if (tx !== null && tz !== null) {
      const des = Math.atan2(tx - s.x, tz - s.z);
      const turn = s.def.turn * clamp(0.35 + s.speed / 4, 0.35, 1.2);
      const before = s.heading;
      s.heading = turnToward(s.heading, des, turn * dt);
      s.turnRate = (s.heading - before) / Math.max(dt, 1e-4);
      let diff = Math.abs(des - s.heading) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff > 1.2) want *= 0.5;
    } else {
      want = 0;
      s.turnRate = 0;
    }
    const acc = want > s.speed ? 0.35 : 0.6;
    s.speed += clamp(want - s.speed, -acc * dt * 3, acc * dt);
  }

  private collide() {
    const sh = this.ships;
    for (let i = 0; i < sh.length; i++) {
      const a = sh[i];
      if (a.sunk || a.fled) continue;
      for (let j = i + 1; j < sh.length; j++) {
        const b = sh[j];
        if (b.sunk || b.fled) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = this.radius(a) + this.radius(b);
        if (d >= min || d < 1e-3) continue;
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        if (!a.grappled) {
          a.x -= nx * push;
          a.z -= nz * push;
        }
        if (!b.grappled) {
          b.x += nx * push;
          b.z += nz * push;
        }
        // ramming: a galley driving its bow into an enemy
        for (const [r, v] of [
          [a, b],
          [b, a],
        ] as const) {
          if (r.side === v.side || r.def.id !== 'galley' || r.speed < 3.5 || this.time - r.ramT < 4 || !this.active(r) || !this.active(v)) continue;
          const toV = Math.atan2(v.x - r.x, v.z - r.z);
          if (Math.cos(toV - r.heading) < 0.7) continue;
          r.ramT = this.time;
          const dmg = r.speed * 28 * (0.8 + this.rng.next() * 0.4);
          v.hull -= dmg;
          v.crew = Math.max(0, v.crew - Math.round(this.rng.range(2, 8)));
          r.hull -= dmg * 0.15;
          r.speed *= 0.3;
          this.events.push({ kind: 'ram', x: (r.x + v.x) / 2, z: (r.z + v.z) / 2, ship: v });
        }
      }
    }
  }

  private nearestEnemy(s: NShip, maxD: number) {
    let best: NShip | null = null;
    let bd = maxD;
    for (const o of this.ships) {
      if (o.side === s.side || !this.active(o)) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  private combat(dt: number) {
    for (const s of this.ships) {
      if (!this.active(s)) continue;
      s.fighting = Math.max(0, s.fighting - dt);
      // boarding melee
      if (s.grappled) {
        const o = s.grappled;
        if (!this.active(o)) {
          s.grappled = null;
          continue;
        }
        if (s.id < o.id) this.melee(s, o, dt);
        continue;
      }
      // archers
      s.reloadA -= dt;
      const archers = s.crew * s.def.archers;
      if (s.reloadA <= 0 && archers > 2) {
        const tgt = s.target && this.active(s.target) && Math.hypot(s.target.x - s.x, s.target.z - s.z) < 120 ? s.target : this.nearestEnemy(s, 120);
        if (tgt) {
          s.reloadA = 3.2 + this.rng.range(0, 1);
          const d = Math.hypot(tgt.x - s.x, tgt.z - s.z);
          const acc = clamp(1 - d / 160, 0.2, 1) * (0.8 + s.xp * 0.03 + s.cmd * 0.02) / this.wind;
          const cover = tgt.def.castles >= 2 ? 0.7 : 0.85;
          const kills = archers * 0.035 * acc * cover * this.rng.range(0.6, 1.4);
          this.hurtCrew(tgt, kills);
          s.lastFire = this.time;
          s.fighting = 3;
          const n = Math.min(14, Math.ceil(archers / 4));
          for (let k = 0; k < n; k++) this.shoot('arrow', s, tgt);
          this.events.push({ kind: 'volley', x: s.x, z: s.z, ship: s });
        }
      }
      // ballistae
      s.reloadB -= dt;
      if (s.def.ballista > 0 && s.reloadB <= 0) {
        const tgt = s.target && this.active(s.target) && Math.hypot(s.target.x - s.x, s.target.z - s.z) < 200 ? s.target : this.nearestEnemy(s, 200);
        if (tgt) {
          s.reloadB = 6 + this.rng.range(0, 2);
          for (let k = 0; k < s.def.ballista; k++) {
            if (this.rng.chance(0.55)) {
              tgt.hull -= this.rng.range(14, 30);
              this.hurtCrew(tgt, this.rng.range(0.5, 2.5));
              this.events.push({ kind: 'hit', x: tgt.x, z: tgt.z, ship: tgt });
            } else this.events.push({ kind: 'splash', x: tgt.x + this.rng.range(-15, 15), z: tgt.z + this.rng.range(-15, 15) });
            this.shoot('bolt', s, tgt);
          }
          s.fighting = 3;
          this.events.push({ kind: 'bolt', x: s.x, z: s.z, ship: s });
        }
      }
      this.checkShip(s);
    }
    for (const s of this.ships) if (this.active(s)) this.checkShip(s);
  }
  private hurtCrew(s: NShip, n: number) {
    s.crew = Math.max(0, s.crew - n);
  }
  private melee(a: NShip, b: NShip, dt: number) {
    const pa = a.crew * a.def.boarding * (1 + a.xp * 0.05 + a.cmd * 0.03);
    const pb = b.crew * b.def.boarding * (1 + b.xp * 0.05 + b.cmd * 0.03);
    this.hurtCrew(b, pa * 0.045 * dt * this.rng.range(0.6, 1.4));
    this.hurtCrew(a, pb * 0.045 * dt * this.rng.range(0.6, 1.4));
    a.fighting = b.fighting = 2;
    if (this.rng.chance(dt * 3)) this.events.push({ kind: 'clash', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      if (x.crew < x.maxCrew * 0.1 && y.crew > y.maxCrew * 0.2) {
        x.capturedBy = y.side;
        x.grappled = null;
        y.grappled = null;
        x.speed = 0;
        // a prize crew goes aboard
        const prize = Math.round(y.crew * 0.2);
        y.crew -= prize;
        x.crew = prize;
        if (y.order === 'board') y.order = 'idle';
        this.events.push({ kind: 'capture', x: x.x, z: x.z, ship: x });
        return;
      }
    }
  }
  private checkShip(s: NShip) {
    if (s.hull <= 0 && s.sinking === 0) {
      s.hull = 0;
      s.sinking = 0.001;
      if (s.grappled) {
        s.grappled.grappled = null;
        s.grappled = null;
      }
      s.crew = Math.round(s.crew * 0.3);
      this.events.push({ kind: 'sink', x: s.x, z: s.z, ship: s });
      return;
    }
    if (!s.fleeing && !s.grappled && s.crew < s.maxCrew * 0.22 && s.hull < s.maxHull * 0.4) this.flee(s);
  }

  private shoot(kind: 'arrow' | 'bolt', s: NShip, t: NShip) {
    const T = kind === 'arrow' ? 1.6 : 1.1;
    const tx = t.x + Math.sin(t.heading) * t.speed * T + this.rng.gauss(0, 4);
    const tz = t.z + Math.cos(t.heading) * t.speed * T + this.rng.gauss(0, 4);
    const sx = s.x + this.rng.range(-4, 4);
    const sz = s.z + this.rng.range(-4, 4);
    const y0 = 6;
    const y1 = 3;
    let p = this.shots.find((q) => !q.alive);
    if (!p) {
      p = { alive: true } as NavalShot;
      this.shots.push(p);
    }
    Object.assign(p, { alive: true, kind, x: sx, y: y0, z: sz, vx: (tx - sx) / T, vz: (tz - sz) / T, vy: (y1 - y0 + 0.5 * 9.8 * T * T) / T, t: 0 });
  }
  private updateShots(dt: number) {
    for (const p of this.shots) {
      if (!p.alive) continue;
      p.t += dt;
      p.vy -= 9.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0 || p.t > 5) p.alive = false;
    }
  }

  private check() {
    const alive = (side: Side) => this.ships.some((s) => s.side === side && this.canCommand(s));
    const a = alive(0);
    const d = alive(1);
    if (!a && !d) this.finish(1, 'Both fleets have scattered.');
    else if (!a) this.finish(1, 'The attacking fleet has been defeated.');
    else if (!d) this.finish(0, 'The enemy fleet has been destroyed or driven off.');
    else if (this.time > 22 * 60) this.finish(1, 'The attackers break off as night falls.');
  }
  finish(w: Side, reason: string) {
    if (this.winner !== null) return;
    this.winner = w;
    this.endReason = reason;
    for (const s of this.ships) s.grappled = null;
    this.events.push({ kind: 'horn', x: 0, z: 0 });
  }
  strength(side: Side) {
    let v = 0;
    for (const s of this.ships) if (s.side === side && this.canCommand(s)) v += s.hull * 0.5 + s.crew * s.def.boarding * 3 + s.def.ballista * 40;
    return v;
  }
}

// ------------------------------------------------------------------ AI
export class NavalAI {
  private t = 0;
  constructor(
    private sim: NavalSim,
    public side: Side,
  ) {}
  update(dt: number) {
    if (!this.sim.started || this.sim.winner !== null) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1.5;
    const sim = this.sim;
    const foes = sim.ships.filter((s) => s.side !== this.side && sim.active(s));
    if (!foes.length) return;
    for (const s of sim.ships) {
      if (s.side !== this.side || !s.ai || !sim.canCommand(s) || s.grappled) continue;
      if (s.target && sim.active(s.target) && s.order !== 'idle') continue;
      let best: NShip | null = null;
      let bs = -Infinity;
      for (const f of foes) {
        const d = Math.hypot(f.x - s.x, f.z - s.z);
        const weak = 1 - f.crew / f.maxCrew + (1 - f.hull / f.maxHull);
        const score = -d + weak * 120 + (f.grappled ? -40 : 0);
        if (score > bs) {
          bs = score;
          best = f;
        }
      }
      if (!best) continue;
      const myP = s.crew * s.def.boarding;
      const theirP = best.crew * best.def.boarding;
      const board = myP > theirP * 1.25 || (s.def.id !== 'galley' && s.def.ballista === 0 && s.def.archers < 0.35);
      sim.orderAttack(s, best, board);
    }
  }
}

// ------------------------------------------------------------------ campaign glue
export function deployNaval(sim: Sim, setup: BattleSetup) {
  const ns = new NavalSim(setup.seed, setup.weather);
  const player = sim.s.player;
  (['attacker', 'defender'] as const).forEach((key, si) => {
    const side = setup[key];
    const fleets = side.fleets.map((id) => sim.s.fleets[id]).filter(Boolean);
    let k = 0;
    const total = fleets.reduce((a, f) => a + f.ships.length, 0);
    for (const f of fleets) {
      const adm = sim.char(f.admiral);
      const cmd = skillOf(adm, 'command');
      for (const shp of f.ships) {
        const row = Math.floor(k / 5);
        const col = (k % 5) - (Math.min(5, total) - 1) / 2;
        const z = (si === 0 ? 1 : -1) * (320 + row * 70);
        const x = col * 75 + (row % 2) * 30;
        ns.add(si as Side, f.faction, shp.uid, shp.type, shp.name, shp.hull, shp.maxHull, shp.crew, shp.maxCrew, shp.xp, f.faction !== player, cmd, x, z, si === 0 ? Math.PI : 0);
        k++;
      }
    }
  });
  const ais = [new NavalAI(ns, 0), new NavalAI(ns, 1)];
  const playerSide: Side | null = setup.attacker.faction === player ? 0 : setup.defender.faction === player ? 1 : null;
  return { ns, ais, playerSide };
}

export function navalOutcome(ns: NavalSim): BattleOutcome {
  const winner = ns.winner === 0 ? 'attacker' : 'defender';
  const o: BattleOutcome = { winner, losses: [], shipDamage: [], shipsSunk: [], shipsCaptured: [], generalsKilled: [], generalsWounded: [], settlementTaken: false, killsA: 0, killsD: 0, tactical: true, summary: ns.endReason };
  for (const s of ns.ships) {
    const crewLost = Math.max(0, Math.round(s.startCrew - s.crew));
    if (s.side === 0) o.killsD += crewLost;
    else o.killsA += crewLost;
    if (s.sunk || s.sinking > 0) o.shipsSunk.push(s.uid);
    else if (s.capturedBy !== null) {
      if (s.capturedBy === ns.winner) o.shipsCaptured.push(s.uid);
      else o.shipsSunk.push(s.uid);
    } else o.shipDamage.push({ uid: s.uid, hull: Math.max(0, s.startHull - s.hull), crew: crewLost });
  }
  return o;
}

export function simulateNavalHeadless(ns: NavalSim, ais: NavalAI[], maxT = 1500, dt = 0.1) {
  for (const s of ns.ships) s.ai = true;
  ns.started = true;
  let t = 0;
  while (ns.winner === null && t < maxT) {
    for (const a of ais) a.update(dt);
    ns.update(dt);
    ns.events.length = 0;
    t += dt;
  }
  if (ns.winner === null) ns.finish(1, 'Time ran out.');
  return ns;
}
