import { unitDef, type UnitDef } from '../data/units';
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import { BattleField, PLAY } from './field';

export type Side = 0 | 1; // 0 = attacker, 1 = defender
export type Formation = 'line' | 'deep' | 'loose' | 'square' | 'wedge';
export type OrderKind = 'idle' | 'move' | 'attack' | 'fire' | 'ram' | 'bombard';
export type UnitStateKind = 'ok' | 'wavering' | 'routing' | 'fled' | 'dead';

/** Global speed multiplier (unit stats are in "realistic" m/s; battles need to be brisker). */
export const SPEED_MUL = 2.1;
const HP_MUL = 3;
const HCELL = 4;
const HOFF = PLAY + 12;
const HN = Math.ceil((HOFF * 2) / HCELL);

export interface Soldier {
  id: number;
  u: BUnit;
  side: Side;
  x: number;
  z: number;
  y: number;
  yaw: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  slot: number;
  target: number;
  retarget: number;
  cd: number;
  anim: number;
  animT: number;
  reload: number;
  mounted: boolean;
  radius: number;
  climb: number;
  climbing: boolean;
  general: boolean;
  fled: boolean;
  deathT: number;
  chargeUntil: number;
  fighting: boolean;
  seed: number;
  speed: number;
}

export interface BUnit {
  id: number;
  side: Side;
  faction: string;
  def: UnitDef;
  uid: number;
  armyId: number;
  startTroops: number;
  menPer: number;
  soldiers: Soldier[];
  startCount: number;
  alive: number;
  x: number;
  z: number;
  cx: number;
  cz: number;
  facing: number;
  dest: { x: number; z: number; facing: number } | null;
  formation: Formation;
  cols: number;
  order: OrderKind;
  target: BUnit | null;
  targetPt: { x: number; z: number; kind: 'ground' | 'wall' | 'gate' | 'tower'; index: number } | null;
  running: boolean;
  fireAtWill: boolean;
  hold: boolean;
  morale: number;
  state: UnitStateKind;
  rallyT: number;
  routCount: number;
  fatigue: number;
  ammo: number;
  maxAmmo: number;
  engagedT: number;
  recentLoss: number;
  missileT: number;
  ai: boolean;
  xp: number;
  isGeneral: boolean;
  generalName?: string;
  generalDead: boolean;
  generalWounded: boolean;
  siegeT: number;
  engineArm: number;
  onWalls: boolean;
  flankedT: number;
  lastShotT: number;
  killCount: number;
}

export interface Projectile {
  alive: boolean;
  kind: 'arrow' | 'bolt' | 'stone';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  side: Side;
  from: BUnit | null;
  dmg: number;
  ap: number;
  splash: number;
  siege: number;
  aim: { kind: 'wall' | 'gate' | 'tower' | 'ground'; index: number } | null;
  fromWall: boolean;
}

export interface BattleEvent {
  kind: 'clash' | 'hit' | 'death' | 'shoot' | 'stone' | 'impact' | 'gate' | 'gateOpen' | 'breach' | 'towerFall' | 'rout' | 'rally' | 'charge' | 'generalDied' | 'shout' | 'climb' | 'horn';
  x: number;
  z: number;
  side?: Side;
  unit?: BUnit;
}

export interface UnitSpawn {
  side: Side;
  faction: string;
  type: string;
  uid: number;
  armyId: number;
  troops: number;
  xp: number;
  ai: boolean;
  generalName?: string;
}

const tmpOut = { x: 0, z: 0 };

function spacing(def: UnitDef, f: Formation): [number, number] {
  let sx = def.visual.mounted ? 2.3 : 1.15;
  let sz = def.visual.mounted ? 3.6 : 1.45;
  if (def.category === 'siege') {
    sx = 1.6;
    sz = 1.6;
  }
  if (f === 'loose') {
    sx *= 1.9;
    sz *= 1.6;
  }
  return [sx, sz];
}

/**
 * Real-time tactical battle simulation. Pure logic: no rendering, deterministic for a given
 * seed and command stream, so it can also run headless in tests.
 */
export class BattleSim {
  units: BUnit[] = [];
  soldiers: Soldier[] = [];
  projectiles: Projectile[] = [];
  events: BattleEvent[] = [];
  time = 0;
  rng: Rng;
  head = new Int32Array(HN * HN);
  next = new Int32Array(0);
  winner: Side | null = null;
  endReason = '';
  capture = 0; // siege plaza capture progress 0..1 (attackers)
  timeLimit: number;
  started = false;
  weatherRangedMul = 1;
  weatherVis = 1;
  menPer = 1;
  startStr: [number, number] | null = null;
  private moraleT = 0;
  private slotT = 0;
  private checkT = 0;
  constructor(
    public field: BattleField,
    seed: number,
    public siege: boolean,
    weather: string,
  ) {
    this.rng = new Rng(seed ^ 0xbadc0de);
    this.timeLimit = siege ? 26 * 60 : 20 * 60;
    this.weatherRangedMul = weather === 'rain' ? 0.75 : weather === 'storm' ? 0.6 : weather === 'snow' ? 0.85 : 1;
    this.weatherVis = weather === 'fog' ? 0.7 : weather === 'storm' ? 0.8 : 1;
  }

  // ------------------------------------------------------------------ setup
  /** Number of men each figure represents so the total stays within the figure budget. */
  static menPerFigure(totalTroops: number, budget = 3600) {
    return Math.max(1, Math.ceil(totalTroops / budget));
  }

  addUnit(sp: UnitSpawn, x: number, z: number, facing: number): BUnit {
    const def = unitDef(sp.type);
    const count = Math.max(1, Math.ceil(sp.troops / this.menPer));
    const u: BUnit = {
      id: this.units.length,
      side: sp.side,
      faction: sp.faction,
      def,
      uid: sp.uid,
      armyId: sp.armyId,
      startTroops: sp.troops,
      menPer: this.menPer,
      soldiers: [],
      startCount: count,
      alive: count,
      x,
      z,
      cx: x,
      cz: z,
      facing,
      dest: null,
      formation: 'line',
      cols: 1,
      order: 'idle',
      target: null,
      targetPt: null,
      running: false,
      fireAtWill: true,
      hold: false,
      morale: def.morale + 25 + sp.xp * 3,
      state: 'ok',
      rallyT: 0,
      routCount: 0,
      fatigue: 0,
      ammo: def.ammo ?? 0,
      maxAmmo: def.ammo ?? 0,
      engagedT: -99,
      recentLoss: 0,
      missileT: -99,
      ai: sp.ai,
      xp: sp.xp,
      isGeneral: def.category === 'general',
      generalName: sp.generalName,
      generalDead: false,
      generalWounded: false,
      siegeT: 0,
      engineArm: 0,
      onWalls: false,
      flankedT: -99,
      lastShotT: -99,
      killCount: 0,
    };
    u.cols = this.defaultCols(u, count);
    const baseHp = def.hp * HP_MUL * (1 + sp.xp * 0.03);
    for (let k = 0; k < count; k++) {
      const s: Soldier = {
        id: this.soldiers.length,
        u,
        side: sp.side,
        x,
        z,
        y: 0,
        yaw: facing,
        vx: 0,
        vz: 0,
        hp: baseHp,
        maxHp: baseHp,
        alive: true,
        slot: k,
        target: -1,
        retarget: this.rng.range(0, 0.6),
        cd: this.rng.range(0, 1),
        anim: 0,
        animT: 0,
        reload: this.rng.range(0, 3),
        mounted: def.visual.mounted,
        radius: def.visual.mounted ? 1.0 : 0.42,
        climb: 0,
        climbing: false,
        general: u.isGeneral && k === 0,
        fled: false,
        deathT: 0,
        chargeUntil: 0,
        fighting: false,
        seed: this.rng.next(),
        speed: 0,
      };
      u.soldiers.push(s);
      this.soldiers.push(s);
    }
    this.units.push(u);
    // place soldiers at their slots
    this.layoutSlots(u);
    for (const s of u.soldiers) {
      const p = this.slotPos(u, s.slot, u.x, u.z, u.facing);
      s.x = p.x + this.rng.range(-0.2, 0.2);
      s.z = p.z + this.rng.range(-0.2, 0.2);
      s.y = this.groundY(s.x, s.z);
    }
    this.next = new Int32Array(this.soldiers.length);
    return u;
  }

  defaultCols(u: BUnit, n: number) {
    const d = u.def;
    const ranks = d.category === 'siege' ? 3 : d.visual.mounted ? 2 : d.range ? 3 : d.category === 'heavy' ? 5 : 4;
    return Math.max(2, Math.ceil(n / ranks));
  }

  // ------------------------------------------------------------------ formations
  private layoutSlots(u: BUnit) {
    let k = 0;
    for (const s of u.soldiers) if (s.alive && !s.fled) s.slot = k++;
  }
  formationWidth(u: BUnit, cols = u.cols) {
    return cols * spacing(u.def, u.formation)[0];
  }
  /** World position of formation slot k with the unit anchored at (ax,az) facing `facing`. */
  slotPos(u: BUnit, k: number, ax: number, az: number, facing: number, out = { x: 0, z: 0, yaw: facing }) {
    const n = Math.max(1, u.alive);
    const [sx, sz] = spacing(u.def, u.formation);
    let r = 0;
    let f = 0;
    let yaw = facing;
    if (u.formation === 'square') {
      // hollow square facing outwards
      const side = Math.max(2, Math.ceil(n / 4 / 2));
      const per = side * 2;
      const edge = Math.floor(k / per) % 4;
      const idx = k % per;
      const row = Math.floor(idx / side);
      const col = idx % side;
      const half = ((side - 1) * sx) / 2 + sx;
      const off = (col - (side - 1) / 2) * sx;
      const depth = half - row * sz * 0.8;
      if (edge === 0) (r = off), (f = depth), (yaw = facing);
      else if (edge === 1) (r = depth), (f = -off), (yaw = facing + Math.PI / 2);
      else if (edge === 2) (r = -off), (f = -depth), (yaw = facing + Math.PI);
      else (r = -depth), (f = off), (yaw = facing - Math.PI / 2);
    } else if (u.formation === 'wedge') {
      // triangle with the point forward
      let row = 0;
      let start = 0;
      while (start + row + 1 <= k) {
        start += row + 1;
        row++;
      }
      const inRow = k - start;
      r = (inRow - row / 2) * sx;
      f = -row * sz * 0.8 + 4;
    } else {
      let cols = u.cols;
      if (u.formation === 'deep') cols = Math.max(2, Math.ceil(cols / 2));
      cols = Math.min(cols, n);
      const rows = Math.ceil(n / cols);
      const row = Math.floor(k / cols);
      const col = k % cols;
      const inRow = row === rows - 1 ? n - row * cols : cols;
      r = (col - (inRow - 1) / 2) * sx;
      f = ((rows - 1) / 2 - row) * sz;
    }
    const c = Math.cos(facing);
    const sn = Math.sin(facing);
    out.x = ax + r * c + f * sn;
    out.z = az - r * sn + f * c;
    out.yaw = yaw;
    return out;
  }

  groundY(x: number, z: number) {
    const f = this.field;
    let y = f.heightAt(x, z);
    if (f.fort && f.onWall(x, z)) y = Math.max(y, f.heightAt(x, f.wallZ(x)) + f.fort.height);
    const wd = f.waterDepth(x, z);
    if (wd > 0) y = Math.max(y, f.river.level - 0.9);
    return y;
  }

  // ------------------------------------------------------------------ commands
  private clearOrders(u: BUnit) {
    u.target = null;
    u.targetPt = null;
    u.hold = false;
  }
  canCommand(u: BUnit) {
    return u.state !== 'routing' && u.state !== 'fled' && u.state !== 'dead';
  }
  orderMove(u: BUnit, x: number, z: number, facing: number | null, run: boolean, cols?: number) {
    if (!this.canCommand(u)) return;
    this.clearOrders(u);
    const fac = facing ?? (Math.hypot(x - u.cx, z - u.cz) > 4 ? Math.atan2(x - u.cx, z - u.cz) : u.facing);
    u.dest = { x: clamp(x, -PLAY + 5, PLAY - 5), z: clamp(z, -PLAY + 5, PLAY - 5), facing: fac };
    if (cols) u.cols = Math.max(2, Math.min(u.alive, cols));
    u.order = 'move';
    u.running = run;
  }
  /** Plan a group move: where each unit ends up (used for orders and the drag preview). */
  planGroupMove(units: BUnit[], x: number, z: number, facing: number | null, width?: number): { u: BUnit; x: number; z: number; facing: number; cols?: number }[] {
    const us = units.filter((u) => this.canCommand(u));
    if (!us.length) return [];
    if (us.length === 1) {
      const u = us[0];
      const fac = facing ?? (Math.hypot(x - u.cx, z - u.cz) > 4 ? Math.atan2(x - u.cx, z - u.cz) : u.facing);
      const cols = width ? Math.max(2, Math.round(width / spacing(u.def, u.formation)[0])) : undefined;
      return [{ u, x, z, facing: fac, cols }];
    }
    let gx = 0;
    let gz = 0;
    for (const u of us) {
      gx += u.cx;
      gz += u.cz;
    }
    gx /= us.length;
    gz /= us.length;
    const fac = facing ?? Math.atan2(x - gx, z - gz);
    const c = Math.cos(fac);
    const s = Math.sin(fac);
    const out: { u: BUnit; x: number; z: number; facing: number; cols?: number }[] = [];
    if (width || facing !== null) {
      // side by side along the line; ranged and cavalry keep behind / on the flanks
      const main = us.filter((u) => !u.def.range && !u.def.visual.mounted && u.def.category !== 'siege' && !u.isGeneral);
      const ranged = us.filter((u) => u.def.range && u.def.category !== 'siege');
      const cav = us.filter((u) => u.def.visual.mounted && !u.isGeneral);
      const rest = us.filter((u) => !main.includes(u) && !ranged.includes(u) && !cav.includes(u));
      const line = (list: BUnit[], depth: number, totalW?: number) => {
        if (!list.length) return 0;
        const sorted = [...list].sort((a, b) => this.lateral(a, fac) - this.lateral(b, fac));
        const nat = sorted.map((u) => this.formationWidth(u, this.defaultCols(u, u.alive)));
        const natTotal = nat.reduce((a, b) => a + b, 0) + (list.length - 1) * 4;
        const k = totalW ? Math.max(0.3, (totalW - (list.length - 1) * 4) / Math.max(1, natTotal - (list.length - 1) * 4)) : 1;
        const widths = nat.map((w) => w * k);
        const tot = widths.reduce((a, b) => a + b, 0) + (list.length - 1) * 4;
        let off = -tot / 2;
        sorted.forEach((u, i) => {
          const w = widths[i];
          const r = off + w / 2;
          off += w + 4;
          const cols = Math.max(2, Math.round(w / spacing(u.def, u.formation)[0]));
          out.push({ u, x: x + r * c - depth * s, z: z - r * s - depth * c, facing: fac, cols });
        });
        return tot;
      };
      const mainList = main.length ? main : ranged.length ? ranged : [];
      const w0 = line(mainList, 0, width);
      if (mainList !== ranged) line(ranged, 26, width ? Math.min(width, w0 || width) : undefined);
      const halfW = Math.max(w0, 40) / 2;
      cav.forEach((u, i) => {
        const sgn = i % 2 === 0 ? 1 : -1;
        const r = sgn * (halfW + 22 + Math.floor(i / 2) * 30);
        out.push({ u, x: x + r * c, z: z - r * s, facing: fac });
      });
      rest.forEach((u, i) => {
        const r = (i - (rest.length - 1) / 2) * 30;
        out.push({ u, x: x + r * c - 50 * s, z: z - r * s - 50 * c, facing: fac });
      });
      return out;
    }
    // keep formation shape relative to the group centre, rotated to the new facing
    const oldFac = us.reduce((a, u) => a + u.facing, 0) / us.length;
    const dRot = fac - oldFac;
    const cr = Math.cos(dRot);
    const sr = Math.sin(dRot);
    for (const u of us) {
      const ox = u.cx - gx;
      const oz = u.cz - gz;
      out.push({ u, x: x + ox * cr + oz * sr, z: z - ox * sr + oz * cr, facing: fac });
    }
    return out;
  }
  orderGroupMove(units: BUnit[], x: number, z: number, facing: number | null, run: boolean, width?: number) {
    for (const p of this.planGroupMove(units, x, z, facing, width)) this.orderMove(p.u, p.x, p.z, p.facing, run, p.cols);
  }
  private lateral(u: BUnit, fac: number) {
    return u.cx * Math.cos(fac) - u.cz * Math.sin(fac);
  }
  orderAttack(u: BUnit, target: BUnit, run: boolean) {
    if (!this.canCommand(u) || target.side === u.side) return;
    this.clearOrders(u);
    u.target = target;
    u.running = run;
    u.order = u.def.range && u.ammo > 0 && u.def.category !== 'siege' ? 'fire' : u.def.category === 'siege' ? (u.def.range ? 'bombard' : 'idle') : 'attack';
    if (u.order === 'bombard') u.targetPt = null;
    u.dest = null;
  }
  orderBombard(u: BUnit, pt: { x: number; z: number; kind: 'ground' | 'wall' | 'gate' | 'tower'; index: number }) {
    if (!this.canCommand(u) || !u.def.range) return;
    this.clearOrders(u);
    u.order = 'bombard';
    u.targetPt = pt;
    u.dest = null;
  }
  orderRam(u: BUnit) {
    const f = this.field.fort;
    if (!this.canCommand(u) || !f || u.def.id !== 'ram') return;
    this.clearOrders(u);
    u.order = 'ram';
    u.dest = { x: 0, z: this.field.wallZ(0) + 6, facing: Math.PI };
  }
  orderHalt(u: BUnit) {
    if (!this.canCommand(u)) return;
    this.clearOrders(u);
    u.order = 'idle';
    u.dest = null;
    u.hold = true;
  }
  setFormation(u: BUnit, f: Formation) {
    if (!this.canCommand(u)) return;
    if (f === 'square' && u.def.visual.mounted) return;
    if (f === 'wedge' && !u.def.visual.mounted) return;
    u.formation = f;
  }
  withdraw(side: Side) {
    for (const u of this.units) if (u.side === side && u.state !== 'fled' && u.state !== 'dead') this.rout(u, true);
  }

  // ------------------------------------------------------------------ helpers
  enemyOf(side: Side): Side {
    return side === 0 ? 1 : 0;
  }
  sideUnits(side: Side) {
    return this.units.filter((u) => u.side === side);
  }
  activeUnits(side: Side) {
    return this.units.filter((u) => u.side === side && u.state !== 'fled' && u.state !== 'dead');
  }
  sideStrength(side: Side) {
    let v = 0;
    for (const u of this.units) if (u.side === side && u.state !== 'fled' && u.state !== 'dead' && u.state !== 'routing') v += u.alive * u.menPer * (u.def.attack + u.def.defense + u.def.armor) * (u.def.visual.mounted ? 1.6 : 1);
    return v;
  }
  menAlive(u: BUnit) {
    return Math.min(u.startTroops, u.alive * u.menPer);
  }
  /** Remaining men of a unit when the battle ends (fled soldiers survive). */
  survivingMen(u: BUnit) {
    let n = 0;
    for (const s of u.soldiers) if (s.alive || s.fled) n++;
    return Math.min(u.startTroops, Math.round(n * u.menPer - (u.startCount * u.menPer - u.startTroops) * (n / u.startCount)));
  }

  private rebuildHash() {
    this.head.fill(-1);
    const next = this.next;
    for (const s of this.soldiers) {
      if (!s.alive || s.fled) continue;
      const cx = clamp(Math.floor((s.x + HOFF) / HCELL), 0, HN - 1);
      const cz = clamp(Math.floor((s.z + HOFF) / HCELL), 0, HN - 1);
      const c = cz * HN + cx;
      next[s.id] = this.head[c];
      this.head[c] = s.id;
    }
  }
  /** Iterate soldiers within radius r of (x,z). Return true from fn to stop. */
  query(x: number, z: number, r: number, fn: (s: Soldier) => boolean | void) {
    const x0 = clamp(Math.floor((x - r + HOFF) / HCELL), 0, HN - 1);
    const x1 = clamp(Math.floor((x + r + HOFF) / HCELL), 0, HN - 1);
    const z0 = clamp(Math.floor((z - r + HOFF) / HCELL), 0, HN - 1);
    const z1 = clamp(Math.floor((z + r + HOFF) / HCELL), 0, HN - 1);
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.head[cz * HN + cx];
        while (i >= 0) {
          const s = this.soldiers[i];
          const dx = s.x - x;
          const dz = s.z - z;
          if (dx * dx + dz * dz <= r2 && fn(s)) return;
          i = this.next[i];
        }
      }
  }
  /** Can a and b fight hand-to-hand (not separated by a wall)? */
  private reachable(a: Soldier, b: Soldier) {
    const f = this.field;
    if (!f.fort) return true;
    const ia = f.inside(a.x, a.z);
    const ib = f.inside(b.x, b.z);
    if (ia === ib) return !(f.onWall(a.x, a.z) !== f.onWall(b.x, b.z) && !a.climbing && !b.climbing && Math.abs(a.y - b.y) > 3);
    if (a.climbing || b.climbing) return true;
    return f.passable((a.x + b.x) / 2) && Math.abs(a.z - b.z) < 6;
  }

  // ------------------------------------------------------------------ main update
  update(dt: number) {
    if (this.winner !== null) {
      this.time += dt;
      this.updateSoldiers(dt, false);
      return;
    }
    this.time += dt;
    this.rebuildHash();
    this.updateUnits(dt);
    this.updateSoldiers(dt, true);
    this.updateProjectiles(dt);
    this.updateFort(dt);
    this.moraleT -= dt;
    if (this.moraleT <= 0) {
      this.moraleT = 0.5;
      for (const u of this.units) this.updateMorale(u, 0.5);
    }
    this.slotT -= dt;
    if (this.slotT <= 0) {
      this.slotT = 1;
      for (const u of this.units) if (u.state === 'ok' || u.state === 'wavering') this.layoutSlots(u);
    }
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.5;
      this.checkVictory(0.5);
    }
  }

  private updateUnits(dt: number) {
    for (const u of this.units) {
      if (u.state === 'fled' || u.state === 'dead') continue;
      // centroid
      let cx = 0;
      let cz = 0;
      let n = 0;
      for (const s of u.soldiers)
        if (s.alive && !s.fled) {
          cx += s.x;
          cz += s.z;
          n++;
        }
      if (!n) {
        u.state = u.soldiers.some((s) => s.fled) ? 'fled' : 'dead';
        u.order = 'idle';
        continue;
      }
      u.cx = cx / n;
      u.cz = cz / n;
      u.recentLoss = Math.max(0, u.recentLoss - dt * 0.08);
      if (u.state === 'routing') continue;
      // order logic
      const engaged = this.time - u.engagedT < 1.2;
      if (u.order === 'attack' && u.target) {
        const t = u.target;
        if (t.state === 'fled' || t.state === 'dead') {
          u.order = 'idle';
          u.target = null;
          u.dest = null;
        } else {
          const dx = t.cx - u.x;
          const dz = t.cz - u.z;
          const d = Math.hypot(dx, dz);
          if (d > 1) u.facing = Math.atan2(dx, dz);
          // the anchor moves toward the enemy; soldiers break off to fight as they reach it
          const sp = this.unitSpeed(u) * dt;
          if (!engaged || d > 25) {
            const k = Math.min(1, sp / Math.max(d, 0.01));
            u.x += dx * k;
            u.z += dz * k;
          }
        }
      } else if (u.order === 'fire' && u.target) {
        const t = u.target;
        if (t.state === 'fled' || t.state === 'dead' || u.ammo <= 0) {
          u.order = 'idle';
          u.target = null;
        } else {
          const d = Math.hypot(t.cx - u.cx, t.cz - u.cz);
          const range = this.rangeOf(u);
          if (d > range * 0.92) {
            const dx = t.cx - u.x;
            const dz = t.cz - u.z;
            const dd = Math.hypot(dx, dz);
            const k = Math.min(1, (this.unitSpeed(u) * dt) / Math.max(dd, 0.01));
            u.x += dx * k;
            u.z += dz * k;
          }
          u.facing = Math.atan2(t.cx - u.cx, t.cz - u.cz);
        }
      } else if (u.order === 'bombard') {
        const tp = u.targetPt ?? (u.target ? { x: u.target.cx, z: u.target.cz } : null);
        if (!tp || (u.target && (u.target.state === 'fled' || u.target.state === 'dead'))) {
          u.order = 'idle';
          u.target = null;
          u.targetPt = null;
        } else {
          const d = Math.hypot(tp.x - u.cx, tp.z - u.cz);
          const range = this.rangeOf(u);
          if (d > range * 0.95) {
            const dx = tp.x - u.x;
            const dz = tp.z - u.z;
            const dd = Math.hypot(dx, dz);
            const k = Math.min(1, (this.unitSpeed(u) * dt) / Math.max(dd, 0.01));
            u.x += dx * k;
            u.z += dz * k;
          }
          u.facing = Math.atan2(tp.x - u.cx, tp.z - u.cz);
        }
      }
      if (u.dest && (u.order === 'move' || u.order === 'ram')) {
        const dx = u.dest.x - u.x;
        const dz = u.dest.z - u.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          const sp = this.unitSpeed(u) * dt;
          // don't let the anchor run away from its soldiers
          const lag = Math.hypot(u.cx - u.x, u.cz - u.z);
          const k = Math.min(1, (sp * (lag > 14 ? 0.35 : 1)) / d);
          u.x += dx * k;
          u.z += dz * k;
          if (d > 6) u.facing = turnToward(u.facing, Math.atan2(dx, dz), dt * 2.2);
          else u.facing = turnToward(u.facing, u.dest.facing, dt * 2.2);
        } else {
          u.facing = turnToward(u.facing, u.dest.facing, dt * 3);
          if (u.order === 'move') {
            u.order = 'idle';
            u.running = false;
          }
        }
        // anchor must not go through walls
        const f = this.field;
        if (f.fort && f.inside(u.x, u.z) !== f.inside(u.dest.x, u.dest.z) && f.inside(u.cx, u.cz) !== f.inside(u.dest.x, u.dest.z)) {
          // the anchor waits at the wall while soldiers find their way in (through gates/breaches or ladders)
        }
      }
      // idle units with fire-at-will shoot at the nearest enemy in range
      if (u.def.range && u.order === 'idle' && u.fireAtWill && u.ammo > 0 && u.def.category !== 'siege') {
        const t = this.nearestEnemyUnit(u, this.rangeOf(u));
        if (t) {
          u.target = t;
          u.order = 'fire';
          u.dest = null;
        }
      }
      if (u.def.category === 'siege' && u.def.range && u.order === 'idle' && u.fireAtWill) {
        const t = this.nearestEnemyUnit(u, this.rangeOf(u));
        if (t) {
          u.target = t;
          u.order = 'bombard';
        }
      }
      // defend: idle melee units engage enemies that come close
      if (!u.def.range && (u.order === 'idle' || u.order === 'move') && !u.hold && u.def.category !== 'siege') {
        const t = this.nearestEnemyUnit(u, u.def.visual.mounted ? 18 : 14);
        if (t && u.order === 'idle') {
          u.target = t;
          u.order = 'attack';
          u.running = true;
        }
      }
      // ram at the gate
      if (u.order === 'ram' && this.field.fort) {
        const g = this.field.fort.gate;
        const gz = this.field.wallZ(0);
        if (!g.open && Math.hypot(u.cx, u.cz - gz) < 11) {
          u.siegeT -= dt;
          u.engineArm = Math.max(0, u.engineArm - dt * 2);
          if (u.siegeT <= 0) {
            u.siegeT = 3.2;
            u.engineArm = 1;
            const dmg = (u.def.siegeDamage ?? 40) * 1.5 * Math.min(1, 0.4 + u.alive / u.startCount) * this.rng.range(0.8, 1.2);
            g.hp -= dmg;
            this.events.push({ kind: 'gate', x: 0, z: gz, unit: u });
            if (g.hp <= 0) {
              g.hp = 0;
              g.open = true;
              this.events.push({ kind: 'gateOpen', x: 0, z: gz });
            }
          }
        } else if (g.open) {
          u.order = 'idle';
          u.dest = null;
        }
      }
      // ranged fire (unit level: find targets for soldiers)
      if ((u.order === 'fire' || u.order === 'bombard') && !engaged) this.unitShoot(u, dt);
    }
  }

  rangeOf(u: BUnit) {
    let r = u.def.range ?? 0;
    if (u.onWalls) r *= 1.2;
    return r * (u.def.category === 'siege' ? 1 : this.weatherVis);
  }
  unitSpeed(u: BUnit) {
    let v = (u.running ? u.def.run : u.def.walk) * SPEED_MUL;
    if (u.fatigue > 60) v *= u.fatigue > 85 ? 0.72 : 0.86;
    // the anchor moves at the pace of the slowest terrain under it
    v *= this.field.speedMul(u.x, u.z, u.def.visual.mounted);
    return v;
  }
  nearestEnemyUnit(u: BUnit, maxD: number): BUnit | null {
    let best: BUnit | null = null;
    let bd = maxD;
    for (const e of this.units) {
      if (e.side === u.side || e.state === 'fled' || e.state === 'dead') continue;
      let d = Math.hypot(e.cx - u.cx, e.cz - u.cz);
      if (e.state === 'routing') d += 60;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ missiles
  private unitShoot(u: BUnit, dt: number) {
    const def = u.def;
    if (!def.range || u.ammo <= 0) return;
    const range = this.rangeOf(u);
    let tx: number;
    let tz: number;
    let aim: Projectile['aim'] = null;
    let targetUnit: BUnit | null = null;
    if (u.order === 'bombard' && u.targetPt) {
      tx = u.targetPt.x;
      tz = u.targetPt.z;
      aim = { kind: u.targetPt.kind, index: u.targetPt.index };
    } else if (u.target) {
      targetUnit = u.target;
      tx = u.target.cx;
      tz = u.target.cz;
    } else return;
    const dist = Math.hypot(tx - u.cx, tz - u.cz);
    if (dist > range) return;
    // soldiers shouldn't fire while walking
    if (def.category !== 'siege' && Math.hypot(u.dest ? u.dest.x - u.x : 0, u.dest ? u.dest.z - u.z : 0) > 3) return;
    const isEngine = def.category === 'siege';
    const shooters = isEngine ? [u.soldiers.find((s) => s.alive && !s.fled)].filter(Boolean) as Soldier[] : u.soldiers;
    if (isEngine) {
      u.siegeT -= dt;
      u.engineArm = Math.max(0, u.engineArm - dt * 0.8);
      if (u.siegeT > 0 || !shooters.length) return;
      const crewFrac = u.alive / u.startCount;
      u.siegeT = (def.reload ?? 14) / Math.max(0.35, crewFrac);
      u.engineArm = 1;
      u.ammo -= 1;
      u.lastShotT = this.time;
      const scatter = dist * (1 - (def.accuracy ?? 0.3)) * 0.07 + 2;
      const px = tx + this.rng.gauss(0, scatter);
      const pz = tz + this.rng.gauss(0, scatter * 0.7);
      this.launch('stone', u, u.cx, u.cz, this.groundY(u.cx, u.cz) + 6, px, pz, def.missileDamage ?? 40, 0.5, aim, false);
      this.events.push({ kind: 'stone', x: u.cx, z: u.cz, unit: u });
      return;
    }
    let fired = false;
    for (const s of shooters) {
      if (!s.alive || s.fled || s.fighting) continue;
      s.reload -= dt;
      if (s.reload > 0) continue;
      s.reload = (def.reload ?? 6) * this.rng.range(0.85, 1.3) * (u.fatigue > 70 ? 1.15 : 1);
      // aim at a random soldier of the target unit
      let ax = tx;
      let az = tz;
      if (targetUnit) {
        const alive = targetUnit.soldiers;
        for (let tries = 0; tries < 4; tries++) {
          const t = alive[Math.floor(this.rng.next() * alive.length)];
          if (t.alive && !t.fled) {
            const flight = Math.hypot(t.x - s.x, t.z - s.z) / (def.arc ? 34 : 70);
            ax = t.x + t.vx * flight * 0.7;
            az = t.z + t.vz * flight * 0.7;
            break;
          }
        }
      }
      const d = Math.hypot(ax - s.x, az - s.z);
      const acc = (def.accuracy ?? 0.5) * (u.onWalls ? 1.15 : 1) * (u.fatigue > 80 ? 0.85 : 1);
      const scatter = 0.8 + d * (1 - acc) * 0.05;
      ax += this.rng.gauss(0, scatter);
      az += this.rng.gauss(0, scatter);
      this.launch(def.category === 'crossbow' ? 'bolt' : 'arrow', u, s.x, s.z, s.y + 1.5, ax, az, (def.missileDamage ?? 5) * this.weatherRangedMul, def.category === 'crossbow' ? 0.55 : 0.2 + def.ap, null, u.onWalls);
      s.anim = 10;
      s.animT = this.time;
      fired = true;
      u.ammo = Math.max(0, u.ammo - 1 / Math.max(1, u.alive));
    }
    if (fired) {
      u.lastShotT = this.time;
      if (this.rng.chance(0.5)) this.events.push({ kind: 'shoot', x: u.cx, z: u.cz, unit: u });
    }
  }

  launch(kind: Projectile['kind'], from: BUnit | null, x: number, z: number, y: number, tx: number, tz: number, dmg: number, ap: number, aim: Projectile['aim'], fromWall: boolean) {
    const side = from ? from.side : 1;
    let ty = this.groundY(tx, tz);
    if (aim && (aim.kind === 'wall' || aim.kind === 'gate' || aim.kind === 'tower') && this.field.fort) ty += this.field.fort.height * 0.6;
    const d = Math.hypot(tx - x, tz - z);
    const T = kind === 'stone' ? 1.6 + d / 42 : kind === 'bolt' ? 0.25 + d / 75 : 0.6 + d / 40;
    const g = 9.8;
    let p = this.projectiles.find((q) => !q.alive);
    if (!p) {
      p = { alive: true } as Projectile;
      this.projectiles.push(p);
    }
    Object.assign(p, {
      alive: true,
      kind,
      x,
      y,
      z,
      vx: (tx - x) / T,
      vz: (tz - z) / T,
      vy: (ty - y + 0.5 * g * T * T) / T,
      t: 0,
      side,
      from,
      dmg,
      ap,
      splash: kind === 'stone' ? 3.8 : 0,
      siege: kind === 'stone' ? from?.def.siegeDamage ?? 60 : 0,
      aim,
      fromWall,
    });
  }

  private updateProjectiles(dt: number) {
    const f = this.field;
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.t += dt;
      p.vy -= 9.8 * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;
      p.x = nx;
      p.y = ny;
      p.z = nz;
      // wall and tower impacts for engine shots
      if (p.kind === 'stone' && f.fort && p.vy < 0) {
        const wz = f.wallZ(clamp(p.x, -f.fort.halfW, f.fort.halfW));
        const nearWall = Math.abs(p.x) <= f.fort.halfW + 2 && Math.abs(p.z - wz) < 3.5;
        const wallTop = f.heightAt(p.x, wz) + f.fort.height;
        if (nearWall && p.y < wallTop + 1) {
          this.stoneHitsFort(p, p.x, wz);
          p.alive = false;
          continue;
        }
        for (let ti = 0; ti < f.fort.towers.length; ti++) {
          const t = f.fort.towers[ti];
          if (!t.alive) continue;
          if (Math.hypot(p.x - t.x, p.z - t.z) < 6 && p.y < f.heightAt(t.x, t.z) + f.fort.height + 8) {
            t.hp -= p.siege * this.rng.range(0.7, 1.2);
            this.events.push({ kind: 'impact', x: t.x, z: t.z });
            if (t.hp <= 0) {
              t.alive = false;
              this.events.push({ kind: 'towerFall', x: t.x, z: t.z });
            }
            p.alive = false;
            break;
          }
        }
        if (!p.alive) continue;
      }
      const gy = f.heightAt(p.x, p.z);
      // flat shots can hit soldiers mid-flight near the ground
      if (p.y <= gy + (p.kind === 'bolt' ? 1.6 : 0.6) || p.t > 12) {
        this.impact(p);
        p.alive = false;
      }
    }
  }
  private stoneHitsFort(p: Projectile, x: number, z: number) {
    const f = this.field.fort!;
    this.events.push({ kind: 'impact', x, z });
    if (x > f.gate.x0 - 3 && x < f.gate.x1 + 3 && !f.gate.open) {
      f.gate.hp -= p.siege * 0.6;
      if (f.gate.hp <= 0) {
        f.gate.hp = 0;
        f.gate.open = true;
        this.events.push({ kind: 'gateOpen', x: 0, z });
      }
    } else {
      const s = this.field.segAt(x);
      if (s && !s.breached) {
        s.hp -= p.siege * this.rng.range(0.7, 1.25);
        if (s.hp <= 0) {
          s.hp = 0;
          s.breached = true;
          this.events.push({ kind: 'breach', x: (s.x0 + s.x1) / 2, z });
          // defenders standing on the collapsing section fall
          this.query((s.x0 + s.x1) / 2, z, (s.x1 - s.x0) / 2 + 2, (q) => {
            if (q.alive && q.y > this.field.heightAt(q.x, q.z) + 3 && this.rng.chance(0.6)) this.damage(q, 999, null, true);
          });
        }
      }
    }
    // splash onto soldiers on/near the wall
    this.splash(p, x, z);
  }
  private splash(p: Projectile, x: number, z: number) {
    const r = p.splash;
    this.query(x, z, r, (s) => {
      if (!s.alive) return;
      const d = Math.hypot(s.x - x, s.z - z);
      const k = 1 - d / r;
      const friendly = s.side === p.side;
      if (friendly && this.rng.chance(0.7)) return;
      this.damage(s, p.dmg * (0.4 + k) * (1 - (s.u.def.armor / 100) * 0.3), p.from, true);
    });
  }
  private impact(p: Projectile) {
    if (p.kind === 'stone') {
      this.events.push({ kind: 'impact', x: p.x, z: p.z });
      this.splash(p, p.x, p.z);
      return;
    }
    // arrows: hit a soldier near the landing point
    const r = 0.95;
    let victim: Soldier | null = null;
    let bd = r;
    this.query(p.x, p.z, r, (s) => {
      if (!s.alive || s.side === p.side) return;
      const d = Math.hypot(s.x - p.x, s.z - p.z) - (s.mounted ? 0.5 : 0);
      if (d < bd) {
        bd = d;
        victim = s;
      }
    });
    const v = victim as Soldier | null;
    if (!v) return;
    const f = this.field;
    // cover
    if (f.forestAt(v.x, v.z) > 0.35 && this.rng.chance(0.35)) return;
    if (v.u.onWalls && f.onWall(v.x, v.z) && !p.fromWall && this.rng.chance(0.5)) return;
    // shields block missiles from the front
    const hx = -p.vx;
    const hz = -p.vz;
    const hl = Math.hypot(hx, hz) || 1;
    const front = (Math.sin(v.yaw) * hx + Math.cos(v.yaw) * hz) / hl;
    const def = v.u.def;
    let block = def.id === 'ram' ? 0.9 : def.shield * (front > 0.25 ? 1 : front > -0.3 ? 0.35 : 0);
    if (v.u.formation === 'loose') block *= 0.8;
    if (this.rng.chance(block)) return;
    const armor = def.armor / 100;
    let dmg = p.dmg * (1 - armor * (1 - p.ap)) * this.rng.range(0.7, 1.3) * HP_MUL * 0.9;
    if (v.climbing) dmg *= 1.6;
    if (v.u.formation === 'loose') dmg *= 0.85;
    v.u.missileT = this.time;
    this.damage(v, dmg, p.from, true);
    if (this.rng.chance(0.15)) this.events.push({ kind: 'hit', x: v.x, z: v.z });
  }

  damage(s: Soldier, dmg: number, by: BUnit | null, missile: boolean) {
    if (!s.alive) return;
    s.hp -= dmg;
    if (s.hp <= 0) {
      this.kill(s);
      if (by) by.killCount++;
    } else if (!missile || this.rng.chance(0.3)) {
      s.anim = 6;
      s.animT = this.time;
    }
  }
  kill(s: Soldier) {
    if (!s.alive) return;
    s.alive = false;
    s.climbing = false;
    s.deathT = this.time;
    s.anim = 7;
    s.animT = this.time;
    const u = s.u;
    u.alive--;
    u.recentLoss += 1 / Math.max(8, u.startCount);
    if (s.general) {
      // the commander may only be wounded and carried off
      if (this.rng.chance(0.55)) {
        u.generalWounded = true;
        s.alive = true;
        s.fled = true;
        u.alive++;
        u.alive--;
      } else u.generalDead = true;
      this.events.push({ kind: 'generalDied', x: s.x, z: s.z, side: s.side, unit: u });
    }
    if (u.alive <= 0 && u.state !== 'fled') {
      u.state = 'dead';
      u.order = 'idle';
    }
    if (this.rng.chance(0.2)) this.events.push({ kind: 'death', x: s.x, z: s.z });
  }

  // ------------------------------------------------------------------ soldiers
  private updateSoldiers(dt: number, live: boolean) {
    const f = this.field;
    const t = this.time;
    const sp = { x: 0, z: 0, yaw: 0 };
    for (const s of this.soldiers) {
      if (!s.alive || s.fled) continue;
      const u = s.u;
      const def = u.def;
      let wantX = s.x;
      let wantZ = s.z;
      let wantYaw = s.yaw;
      let speed = def.walk * SPEED_MUL;
      s.fighting = false;
      const routing = u.state === 'routing';
      const ended = this.winner !== null;
      if (ended) {
        if (u.side === this.winner) {
          if (s.anim !== 17 && this.rng.chance(dt * 0.5)) {
            s.anim = 17;
            s.animT = t;
          }
          s.speed = 0;
          continue;
        }
      }
      if (routing) {
        // flee toward own map edge
        const ez = u.side === 0 ? PLAY + 30 : -PLAY - 30;
        wantX = s.x + (s.seed - 0.5) * 30;
        wantZ = ez;
        if (f.fort && u.side === 1 && !f.inside(s.x, s.z)) wantZ = -PLAY - 30;
        speed = def.run * SPEED_MUL * 0.95;
        if (Math.abs(s.z) > PLAY - 3 || Math.abs(s.x) > PLAY - 3) {
          s.fled = true;
          continue;
        }
      } else {
        // melee target acquisition
        s.retarget -= dt;
        const engagedUnit = t - u.engagedT < 1.5;
        if (live && s.retarget <= 0 && def.category !== 'siege') {
          s.retarget = 0.35 + this.rng.next() * 0.35;
          let r = 2.6 + s.radius;
          if (u.order === 'attack' && u.target) r = Math.hypot(u.target.cx - s.x, u.target.cz - s.z) < 45 ? 14 : 3;
          if (engagedUnit) r = Math.max(r, 8);
          if (def.range && u.order !== 'attack') r = 2.8;
          let best = -1;
          let bd = r;
          const pref = u.order === 'attack' ? u.target : null;
          this.query(s.x, s.z, r, (e) => {
            if (!e.alive || e.side === s.side || e.fled) return;
            let d = Math.hypot(e.x - s.x, e.z - s.z);
            if (pref && e.u !== pref) d += 3;
            if (e.u.state === 'routing') d += 2;
            if (d < bd && this.reachable(s, e)) {
              bd = d;
              best = e.id;
            }
          });
          s.target = best;
        }
        const tg = s.target >= 0 ? this.soldiers[s.target] : null;
        if (tg && (!tg.alive || tg.fled)) s.target = -1;
        if (tg && tg.alive && !tg.fled) {
          const dx = tg.x - s.x;
          const dz = tg.z - s.z;
          const d = Math.hypot(dx, dz);
          const reach = (s.mounted ? 2.1 : 1.2) + (def.visual.weapon === 6 || def.visual.weapon === 1 ? 0.7 : 0) + tg.radius;
          wantYaw = Math.atan2(dx, dz);
          if (d > reach) {
            wantX = tg.x - (dx / d) * reach * 0.85;
            wantZ = tg.z - (dz / d) * reach * 0.85;
            speed = (u.running || d < 12 ? def.run : def.walk) * SPEED_MUL;
            if (!s.chargeUntil && s.speed > def.run * SPEED_MUL * 0.6 && d < 6) {
              s.chargeUntil = t + 2.5;
              if (s.mounted && this.rng.chance(0.3)) this.events.push({ kind: 'charge', x: s.x, z: s.z, unit: u });
            }
          } else {
            s.fighting = true;
            u.engagedT = t;
            tg.u.engagedT = t;
            wantX = s.x;
            wantZ = s.z;
            if (live) this.melee(s, tg, dt);
          }
        } else {
          s.chargeUntil = 0;
          // formation slot
          this.slotPos(u, s.slot, u.x, u.z, u.facing, sp);
          wantX = sp.x;
          wantZ = sp.z;
          wantYaw = sp.yaw;
          const d = Math.hypot(wantX - s.x, wantZ - s.z);
          speed = (u.running ? def.run : def.walk) * SPEED_MUL;
          if (d > 8 && !u.running) speed = Math.min(def.run, def.walk * 1.8) * SPEED_MUL;
          if ((u.order === 'fire' || u.order === 'bombard') && u.target) wantYaw = Math.atan2(u.target.cx - s.x, u.target.cz - s.z);
        }
        // passing walls: route through the nearest opening or climb
        if (f.fort) {
          const inS = f.inside(s.x, s.z);
          const inW = f.inside(wantX, wantZ);
          if (inS !== inW && !s.climbing) {
            const p = f.nearestPassage((s.x + wantX) / 2);
            if (p) {
              const wz = f.wallZ(p.x);
              const nearX = p.x;
              const nearZ = inS ? wz - 4 : wz + 4;
              if (Math.hypot(s.x - nearX, s.z - nearZ) > 3 && Math.abs(s.x - p.x) > 2.2) {
                wantX = nearX;
                wantZ = nearZ;
              } else {
                wantX = p.x;
                wantZ = inS ? wz + 6 : wz - 6;
              }
            } else if (!inS && u.side === 0 && !s.mounted && def.category !== 'siege') {
              // escalade with ladders
              const cx = clamp(s.x, -f.fort.halfW + 5, f.fort.halfW - 5);
              const wz = f.wallZ(cx);
              if (Math.abs(s.z - wz) < 2.5) {
                s.climbing = true;
                s.climb = (5 + f.fort.height * 0.9) * this.rng.range(0.8, 1.4);
                if (this.rng.chance(0.1)) this.events.push({ kind: 'climb', x: s.x, z: s.z, unit: u });
              } else {
                wantX = cx;
                wantZ = wz + 1.2;
              }
            } else {
              // stop at the wall
              const cx = clamp(s.x, -f.fort.halfW + 3, f.fort.halfW - 3);
              wantX = cx;
              wantZ = f.wallZ(cx) + (inS ? -3 : 3);
            }
          }
          if (s.climbing) {
            s.climb -= dt;
            s.speed = 0;
            s.anim = 15;
            if (s.climb <= 0) {
              s.climbing = false;
              const wz = f.wallZ(s.x);
              s.z = wz - 1.6;
              s.y = this.groundY(s.x, s.z);
            } else {
              s.y = f.heightAt(s.x, s.z) + f.fort.height * (1 - s.climb / (5 + f.fort.height * 0.9));
              continue;
            }
          }
        }
      }
      // integrate
      const dx = wantX - s.x;
      const dz = wantZ - s.z;
      const d = Math.hypot(dx, dz);
      let v = 0;
      if (d > 0.15) {
        const terr = f.speedMul(s.x, s.z, s.mounted);
        const fat = u.fatigue > 85 ? 0.72 : u.fatigue > 60 ? 0.86 : 1;
        v = Math.min(speed * terr * fat, d * 3);
        s.vx = (dx / d) * v;
        s.vz = (dz / d) * v;
        if (!s.fighting) wantYaw = d > 0.8 ? Math.atan2(dx, dz) : wantYaw;
      } else {
        s.vx *= 0.5;
        s.vz *= 0.5;
      }
      let nx = s.x + s.vx * dt;
      let nz = s.z + s.vz * dt;
      // separation
      if (live) {
        const rad = s.radius;
        this.query(nx, nz, rad + 1.0, (o) => {
          if (o === s || !o.alive || o.fled) return;
          const ox = nx - o.x;
          const oz = nz - o.z;
          const dd = Math.hypot(ox, oz);
          const min = rad + o.radius;
          if (dd < min && dd > 1e-4) {
            const push = (min - dd) * (o.side === s.side ? 0.35 : 0.5) * (o.mounted && !s.mounted ? 1.4 : 1);
            nx += (ox / dd) * push;
            nz += (oz / dd) * push;
          }
        });
      }
      f.constrain(s.x, s.z, nx, nz, tmpOut);
      s.x = tmpOut.x;
      s.z = tmpOut.z;
      s.y = this.groundY(s.x, s.z);
      s.speed = v;
      s.yaw = turnToward(s.yaw, wantYaw, dt * (s.mounted ? 4 : 7));
      // animation state
      if (!s.fighting && !(s.anim === 6 && t - s.animT < 0.5) && !(s.anim === 10 && t - s.animT < 0.6)) {
        let a: number;
        if (routing) a = 8;
        else if (s.mounted) a = v > def.run * SPEED_MUL * 0.6 && (u.order === 'attack' || s.chargeUntil > t) ? 14 : 13;
        else if (v > def.walk * SPEED_MUL * 1.3) a = 2;
        else if (v > 0.3) a = 1;
        else if (u.def.range && (u.order === 'fire' || u.fireAtWill) && t - u.lastShotT < 5 && u.def.category !== 'siege') a = u.def.category === 'crossbow' ? 12 : 9;
        else if (u.def.id === 'ram' && u.order === 'ram') a = 18;
        else if (u.def.category === 'siege') a = 15;
        else a = 0;
        if (a !== s.anim) {
          s.anim = a;
          s.animT = t;
        }
      }
    }
  }

  private melee(s: Soldier, e: Soldier, dt: number) {
    s.cd -= dt;
    if (s.cd > 0) return;
    const u = s.u;
    const d = u.def;
    const ed = e.u.def;
    s.cd = (s.mounted ? 1.5 : 1.25) * this.rng.range(0.8, 1.25) * (u.fatigue > 70 ? 1.15 : 1);
    s.anim = d.visual.weapon === 1 || d.visual.weapon === 6 || d.visual.weapon === 5 ? 4 : 3;
    s.animT = this.time;
    let atk = d.attack + (e.mounted ? d.bonusVsCav : d.bonusVsInf) + u.xp * 2;
    let dfn = ed.defense + e.u.xp * 2;
    // facing: attacks into the flank or rear ignore the shield
    const ax = s.x - e.x;
    const az = s.z - e.z;
    const al = Math.hypot(ax, az) || 1;
    const front = (Math.sin(e.yaw) * ax + Math.cos(e.yaw) * az) / al;
    if (front > 0.35) dfn += ed.shield * 25;
    else if (front < -0.35) {
      dfn *= 0.55;
      e.u.flankedT = this.time;
    } else {
      dfn *= 0.8;
      e.u.flankedT = this.time;
    }
    if (e.u.formation === 'square' && s.mounted) dfn += 12;
    if (u.formation === 'loose') atk -= 4;
    if (e.u.formation === 'loose') dfn -= 6;
    // high ground
    const dh = s.y - e.y;
    if (dh > 1.2) atk += 8;
    else if (dh < -1.2) atk -= 6;
    // fatigue
    atk *= 1 - Math.max(0, u.fatigue - 40) * 0.004;
    dfn *= 1 - Math.max(0, e.u.fatigue - 40) * 0.004;
    if (e.climbing) dfn *= 0.4;
    if (e.u.state === 'routing') dfn *= 0.3;
    // generals inspire
    if (this.generalNear(u)) atk += 5;
    const charging = s.chargeUntil > this.time;
    let dmgMul = 1;
    if (charging) {
      const braced = ed.category === 'spear' && front > 0.4 && e.speed < 0.8 && e.u.state === 'ok';
      if (braced && s.mounted) {
        // horses impale themselves on braced spears
        this.damage(s, ed.bonusVsCav * 0.45 * HP_MUL * this.rng.range(0.5, 1.2), e.u, false);
        s.chargeUntil = 0;
      } else {
        dmgMul += d.charge / 22;
        atk += d.charge * 0.4;
        if (s.mounted && this.rng.chance(0.15)) {
          // knock the victim back
          e.x -= (ax / al) * 1.2;
          e.z -= (az / al) * 1.2;
        }
      }
    }
    const p = clamp(0.5 + (atk - dfn) / 75, 0.08, 0.93);
    if (this.rng.chance(p)) {
      const dmg = d.damage * (1 - (ed.armor / 100) * (1 - d.ap)) * this.rng.range(0.7, 1.3) * dmgMul;
      this.damage(e, dmg, u, false);
      if (this.rng.chance(0.06)) this.events.push({ kind: 'clash', x: s.x, z: s.z });
    } else {
      if (e.alive && this.rng.chance(0.5)) {
        e.anim = 5;
        e.animT = this.time;
      }
      if (this.rng.chance(0.04)) this.events.push({ kind: 'clash', x: s.x, z: s.z });
    }
  }

  generalNear(u: BUnit) {
    for (const g of this.units) {
      if (g.side !== u.side || !g.isGeneral || g.generalDead || g.generalWounded || g.state === 'fled' || g.state === 'dead' || g.state === 'routing') continue;
      if (Math.hypot(g.cx - u.cx, g.cz - u.cz) < 90) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ morale & fatigue
  private updateMorale(u: BUnit, dt: number) {
    if (u.state === 'fled' || u.state === 'dead') return;
    const t = this.time;
    const engaged = t - u.engagedT < 1.5;
    // fatigue
    const heavy = u.def.armor > 40 ? 1.35 : 1;
    let moving = 0;
    for (const s of u.soldiers) if (s.alive && !s.fled && s.speed > 1.1) moving++;
    const movFrac = moving / Math.max(1, u.alive);
    if (engaged) u.fatigue += 1.0 * heavy * dt;
    else if (movFrac > 0.3 && (u.running || u.state === 'routing')) u.fatigue += 1.6 * heavy * dt;
    else if (movFrac > 0.3) u.fatigue += 0.18 * heavy * dt;
    else u.fatigue -= 1.4 * dt;
    u.fatigue = clamp(u.fatigue, 0, 100);
    // morale target
    const d = u.def;
    let m = d.morale + 26 + u.xp * 3;
    const lost = 1 - u.alive / u.startCount;
    m -= lost * 55;
    m -= u.recentLoss * 140;
    if (t - u.flankedT < 2) m -= 16;
    if (this.generalNear(u)) m += 10;
    const myGeneral = this.units.find((g) => g.side === u.side && g.isGeneral);
    if (myGeneral && (myGeneral.generalDead || myGeneral.generalWounded)) m -= 14;
    if (u.fatigue > 85) m -= 10;
    if (t - u.missileT < 2) m -= 5;
    if (this.field.fort && u.side === 1 && this.field.inside(u.cx, u.cz)) m += 12;
    if (u.onWalls) m += 6;
    // nearby friends breaking, enemies breaking
    let friendRout = 0;
    let enemyRout = 0;
    let enemyNear = 0;
    let friendNear = 0;
    for (const o of this.units) {
      if (o === u || o.state === 'fled' || o.state === 'dead') continue;
      const dd = Math.hypot(o.cx - u.cx, o.cz - u.cz);
      if (dd > 70) continue;
      if (o.side === u.side) {
        if (o.state === 'routing') friendRout++;
        else friendNear += o.alive * o.menPer;
      } else {
        if (o.state === 'routing') enemyRout++;
        else enemyNear += o.alive * o.menPer;
      }
    }
    m -= friendRout * 9;
    m += enemyRout * 4;
    const mine = u.alive * u.menPer + friendNear;
    if (engaged && enemyNear > mine * 2) m -= 10;
    // whole side collapsing
    const all = this.sideUnits(u.side);
    const broken = all.filter((o) => o.state === 'routing' || o.state === 'fled' || o.state === 'dead').length / Math.max(1, all.length);
    m -= broken * 22;
    const k = m < u.morale ? 0.22 : 0.08;
    u.morale += (m - u.morale) * k;
    // state transitions
    if (u.state === 'routing') {
      u.rallyT -= dt;
      const enemyClose = this.nearestEnemyUnit(u, 55);
      if (u.rallyT <= 0 && !enemyClose && u.routCount < 3 && m > 30 && u.alive > u.startCount * 0.15) {
        u.state = 'wavering';
        u.morale = 28;
        u.order = 'idle';
        u.dest = { x: u.cx, z: u.cz, facing: u.facing };
        u.x = u.cx;
        u.z = u.cz;
        this.events.push({ kind: 'rally', x: u.cx, z: u.cz, side: u.side, unit: u });
      }
      return;
    }
    if (u.morale < 12) this.rout(u, false);
    else u.state = u.morale < 28 ? 'wavering' : 'ok';
  }
  rout(u: BUnit, forced: boolean) {
    if (u.state === 'routing' || u.state === 'fled' || u.state === 'dead') return;
    u.state = 'routing';
    u.routCount += forced ? 3 : 1;
    u.rallyT = 14 + this.rng.range(0, 10);
    u.order = 'idle';
    u.target = null;
    u.dest = null;
    u.running = true;
    for (const s of u.soldiers) s.climbing = false;
    this.events.push({ kind: 'rout', x: u.cx, z: u.cz, side: u.side, unit: u });
  }

  // ------------------------------------------------------------------ fortifications
  private updateFort(dt: number) {
    const f = this.field.fort;
    if (!f) return;
    // towers shoot at attackers
    for (const tw of f.towers) {
      if (!tw.alive) continue;
      tw.reload -= dt;
      if (tw.reload > 0) continue;
      tw.reload = 2.6 + this.rng.range(0, 0.8);
      let target: Soldier | null = null;
      let bd = 150;
      this.query(tw.x, tw.z, 150, (s) => {
        if (!s.alive || s.side !== 0 || s.fled) return;
        const d = Math.hypot(s.x - tw.x, s.z - tw.z) + this.rng.range(0, 25);
        if (d < bd) {
          bd = d;
          target = s;
        }
      });
      const tg = target as Soldier | null;
      if (!tg) continue;
      const ty = this.field.heightAt(tw.x, tw.z) + f.height + 6;
      for (let k = 0; k < 3; k++) this.launch('arrow', null, tw.x, tw.z + 1, ty, tg.x + this.rng.gauss(0, 2), tg.z + this.rng.gauss(0, 2), 7 * this.weatherRangedMul, 0.2, null, true);
    }
    // defenders standing on intact wall sections
    for (const u of this.units) {
      if (u.side !== 1) continue;
      let on = 0;
      for (const s of u.soldiers) if (s.alive && this.field.onWall(s.x, s.z)) on++;
      u.onWalls = on > u.alive * 0.5;
    }
    // capture of the plaza
    const pl = f.plaza;
    let att = 0;
    let def = 0;
    this.query(pl.x, pl.z, pl.r, (s) => {
      if (!s.alive || s.fled || s.u.state === 'routing') return;
      if (s.side === 0) att++;
      else def++;
    });
    if (att > 4 && def === 0) this.capture = Math.min(1, this.capture + dt / 40);
    else if (def > att) this.capture = Math.max(0, this.capture - dt / 30);
  }

  // ------------------------------------------------------------------ victory
  private checkVictory(dt: number) {
    if (!this.started) return;
    const broken = (side: Side) => this.units.filter((u) => u.side === side).every((u) => u.state === 'routing' || u.state === 'fled' || u.state === 'dead');
    // a side reduced to a remnant of its starting strength quits the field
    if (!this.startStr) this.startStr = [Math.max(1, this.sideStrength(0)), Math.max(1, this.sideStrength(1))];
    const spent = (side: Side) => this.sideStrength(side) < this.startStr![side] * 0.1;
    const b0 = broken(0) || spent(0);
    const b1 = broken(1) || spent(1);
    if (b0 && b1) this.finish(1, 'Both armies have fled the field.');
    else if (b0) this.finish(1, 'The attackers have been driven from the field.');
    else if (b1) this.finish(0, this.siege ? 'The defenders have broken. The town is taken.' : 'The enemy army has been routed.');
    else if (this.siege && this.capture >= 1) this.finish(0, 'The town square has been seized.');
    else if (this.time >= this.timeLimit) this.finish(1, 'Time has run out; the attack has failed.');
    void dt;
  }
  finish(w: Side, reason: string) {
    if (this.winner !== null) return;
    this.winner = w;
    this.endReason = reason;
    this.events.push({ kind: 'horn', x: 0, z: 0, side: w });
  }
}

export function turnToward(a: number, b: number, maxStep: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}
