import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import type { BattleSetup } from '../sim/battles';

/** Battlefield extents (metres). Units may only move inside PLAY. */
export const FIELD_SIZE = 1100;
export const PLAY = 400;
const N = 221; // height samples per side (5 m)
const CELL = FIELD_SIZE / (N - 1);

export interface WallSeg {
  x0: number;
  x1: number;
  hp: number;
  maxHp: number;
  breached: boolean;
}
export interface Tower {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  reload: number;
}
export interface Fort {
  halfW: number;
  baseZ: number;
  curve: number;
  height: number;
  level: number;
  segs: WallSeg[];
  gate: { x0: number; x1: number; hp: number; maxHp: number; open: boolean };
  towers: Tower[];
  plaza: { x: number; z: number; r: number };
  houses: { x: number; z: number; w: number; d: number; h: number; rot: number }[];
}

export interface Ford {
  x: number;
  w: number;
}

/**
 * Pure battlefield description used by the tactical simulation and the renderer:
 * height, forest cover, marsh, river and fortifications. Deterministic from the setup seed.
 */
export class BattleField {
  heights = new Float32Array(N * N);
  forest = new Float32Array(N * N);
  marsh = new Float32Array(N * N);
  river: { enabled: boolean; width: number; fords: Ford[]; level: number } = { enabled: false, width: 16, fords: [], level: 0 };
  fort: Fort | null = null;
  trees: { x: number; z: number; s: number; kind: number }[] = [];
  rocks: { x: number; z: number; s: number }[] = [];
  readonly terrain: string;
  readonly snowy: boolean;
  readonly arid: boolean;
  constructor(public setup: Pick<BattleSetup, 'kind' | 'terrain' | 'river' | 'walls' | 'towers' | 'gateHp' | 'seed' | 'season' | 'settlement'>) {
    this.terrain = setup.terrain;
    this.snowy = setup.season === 3 && setup.terrain !== 'dry' && setup.terrain !== 'coast';
    this.arid = setup.terrain === 'dry';
    const siege = setup.kind === 'siege';
    if (siege) this.buildFort();
    this.river.enabled = !siege && setup.river;
    if (this.river.enabled) {
      const r = new Rng(setup.seed ^ 0x51f0);
      this.river.fords = [{ x: r.range(-260, -80), w: 26 }, { x: r.range(60, 260), w: 26 }];
    }
    this.buildHeights();
    this.buildCover();
  }

  // ------------------------------------------------------------------ heights
  private buildHeights() {
    const n1 = new Noise2D(this.setup.seed);
    const n2 = new Noise2D(this.setup.seed + 7);
    const t = this.terrain;
    const amp = t === 'mountain' ? 46 : t === 'hills' ? 26 : t === 'forest' ? 11 : t === 'coast' ? 4 : t === 'farmland' ? 5 : 7;
    const f = this.fort;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -FIELD_SIZE / 2 + i * CELL;
        const z = -FIELD_SIZE / 2 + j * CELL;
        let h = 0;
        let a = 1;
        let fr = 1 / 420;
        for (let o = 0; o < 4; o++) {
          h += n1.noise(x * fr, z * fr) * a;
          a *= 0.48;
          fr *= 2.1;
        }
        h *= amp;
        // gentle rolling detail
        h += n2.noise(x / 60, z / 60) * 0.8;
        if (t === 'mountain') {
          // a pass: flatter valley along the axis of battle, peaks on the sides
          const side = smoothstep(160, 420, Math.abs(x));
          h = h * 0.45 + side * 120 + Math.abs(n2.noise(x / 200, z / 200)) * side * 60;
        }
        if (t === 'hills') h += 14 * smoothstep(60, -260, z); // defender holds higher ground
        // raise terrain beyond the play area into framing hills
        const edge = Math.max(Math.abs(x), Math.abs(z));
        h += smoothstep(PLAY + 40, FIELD_SIZE / 2, edge) * (40 + n2.noise(x / 90, z / 90) * 25);
        if (f) {
          // level ground around the walls and within the town
          const wz = this.wallZ(x);
          const dz = z - wz;
          const nearWall = 1 - smoothstep(30, 90, Math.abs(dz));
          const inside = Math.abs(x) < f.halfW + 20 && dz < 0 ? 1 : 0;
          const flat = Math.max(nearWall * (Math.abs(x) < f.halfW + 30 ? 1 : 0), inside);
          h = h * (1 - flat * 0.85) + flat * 2;
          if (inside) h += 1.5 * smoothstep(0, -200, dz);
        }
        this.heights[j * N + i] = h;
      }
    }
    if (this.river.enabled) {
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const x = -FIELD_SIZE / 2 + i * CELL;
          const z = -FIELD_SIZE / 2 + j * CELL;
          const d = Math.abs(z - this.riverZ(x));
          const w = this.river.width;
          const ford = this.fordAt(x);
          const depth = ford ? 1.2 : 3.2;
          const carve = (1 - smoothstep(w * 0.35, w * 1.4, d)) * depth + (1 - smoothstep(w, w * 4, d)) * 1.2;
          this.heights[j * N + i] -= carve;
        }
      // water level relative to the carved bank around the centre line
      let sum = 0;
      for (let k = -8; k <= 8; k++) sum += this.heightAt(k * 40, this.riverZ(k * 40) + this.river.width * 1.3);
      this.river.level = sum / 17 - 0.9;
    }
  }

  riverZ(x: number) {
    return 20 * Math.sin(x / 95 + this.setup.seed * 0.001) + 9 * Math.sin(x / 37 + 1.3);
  }
  fordAt(x: number): Ford | undefined {
    return this.river.fords.find((f) => Math.abs(x - f.x) < f.w / 2);
  }
  /** 0 dry .. 1 deep water */
  waterDepth(x: number, z: number): number {
    if (!this.river.enabled) return 0;
    const d = this.river.level - this.heightAt(x, z);
    return d > 0 ? clamp(d / 1.6, 0, 1) : 0;
  }

  heightAt(x: number, z: number): number {
    const fx = clamp((x + FIELD_SIZE / 2) / CELL, 0, N - 1.001);
    const fz = clamp((z + FIELD_SIZE / 2) / CELL, 0, N - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heights;
    const a = h[j * N + i];
    const b = h[j * N + i + 1];
    const c = h[(j + 1) * N + i];
    const d = h[(j + 1) * N + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  slopeAt(x: number, z: number) {
    const e = 3;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }
  sample(arr: Float32Array, x: number, z: number) {
    const i = clamp(Math.round((x + FIELD_SIZE / 2) / CELL), 0, N - 1);
    const j = clamp(Math.round((z + FIELD_SIZE / 2) / CELL), 0, N - 1);
    return arr[j * N + i];
  }
  forestAt(x: number, z: number) {
    return this.sample(this.forest, x, z);
  }
  marshAt(x: number, z: number) {
    return this.sample(this.marsh, x, z);
  }
  /** Movement multiplier for a soldier at a location. */
  speedMul(x: number, z: number, mounted: boolean) {
    let m = 1;
    const f = this.forestAt(x, z);
    if (f > 0.3) m *= mounted ? 0.55 : 0.75;
    const w = this.waterDepth(x, z);
    if (w > 0) m *= 1 - w * 0.6;
    if (this.marshAt(x, z) > 0.4) m *= 0.65;
    const s = this.slopeAt(x, z);
    m *= clamp(1 - s * 0.8, 0.45, 1);
    if (this.snowy) m *= 0.9;
    return m;
  }

  static get resolution() {
    return { N, CELL };
  }

  // ------------------------------------------------------------------ cover
  private buildCover() {
    const n = new Noise2D(this.setup.seed + 99);
    const r = new Rng(this.setup.seed ^ 0x77aa);
    const t = this.terrain;
    const thr = t === 'forest' ? 0.02 : t === 'mountain' ? 0.35 : t === 'dry' || t === 'coast' ? 0.75 : t === 'farmland' ? 0.55 : 0.42;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = -FIELD_SIZE / 2 + i * CELL;
        const z = -FIELD_SIZE / 2 + j * CELL;
        let v = n.noise(x / 170, z / 170) * 0.7 + n.noise(x / 55, z / 55) * 0.3;
        // keep the deployment zones and the centre mostly open
        v -= (Math.abs(x) < 240 && Math.abs(z - 200) < 90 ? 0.5 : 0) + (Math.abs(x) < 240 && Math.abs(z + 200) < 90 ? 0.5 : 0);
        v -= Math.abs(x) < 180 && Math.abs(z) < 60 ? 0.2 : 0;
        if (this.fort) {
          const dz = z - this.wallZ(x);
          if (Math.abs(x) < this.fort.halfW + 40 && dz < 60) v = -1;
        }
        if (this.river.enabled && Math.abs(z - this.riverZ(x)) < this.river.width * 1.2) v = -1;
        this.forest[j * N + i] = clamp((v - thr) * 4, 0, 1);
        if (t === 'coast') this.marsh[j * N + i] = clamp((n.noise(x / 40 + 9, z / 40) - 0.35) * 3, 0, 1) * 0.6;
      }
    // tree instances
    const kindFor = () => (this.snowy || t === 'mountain' ? 0 : this.arid ? 3 : t === 'coast' ? (r.chance(0.5) ? 2 : 4) : r.chance(0.35) ? 0 : 1);
    for (let k = 0; k < 16000 && this.trees.length < 5200; k++) {
      const x = r.range(-FIELD_SIZE / 2, FIELD_SIZE / 2);
      const z = r.range(-FIELD_SIZE / 2, FIELD_SIZE / 2);
      const f = this.forestAt(x, z);
      if (f < 0.05 || !r.chance(f)) {
        // sparse lone trees and bushes in the open
        if (r.chance(0.012) && this.forestAt(x, z) === 0 && !this.blockedForScenery(x, z)) this.trees.push({ x, z, s: r.range(0.7, 1.2), kind: r.chance(0.5) ? 4 : kindFor() });
        continue;
      }
      if (this.blockedForScenery(x, z)) continue;
      this.trees.push({ x, z, s: r.range(0.75, 1.35), kind: kindFor() });
    }
    const rockN = t === 'mountain' ? 260 : t === 'hills' ? 120 : 40;
    for (let k = 0; k < rockN; k++) {
      const x = r.range(-FIELD_SIZE / 2, FIELD_SIZE / 2);
      const z = r.range(-FIELD_SIZE / 2, FIELD_SIZE / 2);
      if (this.blockedForScenery(x, z)) continue;
      if (Math.abs(x) < PLAY && Math.abs(z) < PLAY && r.chance(0.6)) continue;
      this.rocks.push({ x, z, s: r.range(0.5, 2.2) });
    }
  }
  private blockedForScenery(x: number, z: number) {
    if (this.fort && Math.abs(x) < this.fort.halfW + 40 && z - this.wallZ(x) < 60) return true;
    if (this.river.enabled && Math.abs(z - this.riverZ(x)) < this.river.width * 1.1) return true;
    return false;
  }

  // ------------------------------------------------------------------ fortifications
  wallZ(x: number) {
    const f = this.fort!;
    return f.baseZ - f.curve * x * x;
  }
  private buildFort() {
    const s = this.setup;
    const r = new Rng(s.seed ^ 0x3131);
    const level = Math.max(1, s.walls);
    const halfW = 300;
    const f: Fort = {
      halfW,
      baseZ: -80,
      curve: 0.0004,
      height: 6 + level * 2.2,
      level,
      segs: [],
      gate: { x0: -7, x1: 7, hp: Math.max(400, s.gateHp), maxHp: Math.max(400, s.gateHp), open: false },
      towers: [],
      plaza: { x: 0, z: -230, r: 22 },
      houses: [],
    };
    this.fort = f;
    // wall segments of ~40 m, excluding the gate
    const segW = 40;
    for (let x = -halfW; x < halfW - 0.1; x += segW) {
      const x0 = x;
      const x1 = Math.min(halfW, x + segW);
      const hp = 700 * level;
      if (x1 <= f.gate.x0 || x0 >= f.gate.x1) f.segs.push({ x0, x1, hp, maxHp: hp, breached: false });
      else {
        if (x0 < f.gate.x0) f.segs.push({ x0, x1: f.gate.x0, hp, maxHp: hp, breached: false });
        if (x1 > f.gate.x1) f.segs.push({ x0: f.gate.x1, x1, hp, maxHp: hp, breached: false });
      }
    }
    const towerXs = [-14, 14, -halfW, halfW, -90, 90, -190, 190, -250, 250, -45, 45];
    const nT = clamp(2 + s.towers * 2, 2, towerXs.length);
    for (let k = 0; k < nT; k++) {
      const x = towerXs[k];
      const hp = 900 + level * 400;
      f.towers.push({ x, z: f.baseZ - f.curve * x * x, hp, maxHp: hp, alive: true, reload: r.range(0, 2) });
    }
    // houses in blocks leaving streets to the plaza
    const cz0 = f.plaza.z;
    for (let k = 0; k < 900 && f.houses.length < 170; k++) {
      const x = r.range(-halfW + 20, halfW - 20);
      const wz = f.baseZ - f.curve * x * x;
      const z = r.range(-FIELD_SIZE / 2 + 60, wz - 22);
      if (Math.abs(x) < 16) continue; // main street
      if (Math.hypot(x - f.plaza.x, z - cz0) < f.plaza.r + 16) continue;
      if (Math.abs(z - cz0) < 9) continue; // cross street
      if (Math.abs(x % 70) < 7) continue; // side streets
      const w = r.range(7, 12);
      const d = r.range(6, 10);
      const rot = r.chance(0.5) ? 0 : Math.PI / 2;
      if (f.houses.some((h) => Math.abs(h.x - x) < (h.w + w) / 2 + 2.5 && Math.abs(h.z - z) < (h.d + d) / 2 + 2.5)) continue;
      f.houses.push({ x, z, w, d, h: r.range(5, 9), rot });
    }
  }
  /** True if the point lies inside the town walls. */
  inside(x: number, z: number) {
    const f = this.fort;
    if (!f) return false;
    return Math.abs(x) < f.halfW && z < this.wallZ(x);
  }
  /** Front-wall passages currently open (gate and breaches), as x intervals. */
  passages(): { x0: number; x1: number; gate: boolean }[] {
    const f = this.fort;
    if (!f) return [];
    const out: { x0: number; x1: number; gate: boolean }[] = [];
    if (f.gate.open) out.push({ x0: f.gate.x0, x1: f.gate.x1, gate: true });
    for (const s of f.segs) if (s.breached) out.push({ x0: s.x0 + 4, x1: s.x1 - 4, gate: false });
    return out;
  }
  passable(x: number) {
    const f = this.fort;
    if (!f) return true;
    if (f.gate.open && x > f.gate.x0 + 0.8 && x < f.gate.x1 - 0.8) return true;
    for (const s of f.segs) if (s.breached && x > s.x0 + 3 && x < s.x1 - 3) return true;
    return false;
  }
  segAt(x: number): WallSeg | undefined {
    return this.fort?.segs.find((s) => x >= s.x0 && x < s.x1);
  }
  /** Standing on the wall-walk? */
  onWall(x: number, z: number) {
    const f = this.fort;
    if (!f || Math.abs(x) > f.halfW) return false;
    const dz = this.wallZ(x) - z;
    if (dz < 0.2 || dz > 3.2) return false;
    if (x > f.gate.x0 - 1 && x < f.gate.x1 + 1) return false;
    const s = this.segAt(x);
    return !!s && !s.breached;
  }
  /** Constrain movement from (ox,oz) to (nx,nz) against walls and houses; returns corrected position. */
  constrain(ox: number, oz: number, nx: number, nz: number, out: { x: number; z: number }) {
    out.x = clamp(nx, -PLAY, PLAY);
    out.z = clamp(nz, -PLAY, PLAY);
    const f = this.fort;
    if (!f) return out;
    const a = this.inside(ox, oz);
    const b = this.inside(out.x, out.z);
    if (a !== b) {
      // crossing: allowed only through the front wall at an open passage
      const front = Math.abs(out.x) < f.halfW - 0.5 && Math.abs(ox) < f.halfW - 0.5;
      if (!(front && this.passable((ox + out.x) / 2))) {
        out.x = ox;
        out.z = oz;
        // slide along the wall
        if (this.inside(nx, oz) === a) out.x = clamp(nx, -PLAY, PLAY);
        else if (this.inside(ox, nz) === a) out.z = clamp(nz, -PLAY, PLAY);
      }
    }
    // houses (axis aligned boxes; rot is 0 or 90 degrees)
    if (b || a) {
      for (const h of f.houses) {
        const hw = (h.rot ? h.d : h.w) / 2 + 0.4;
        const hd = (h.rot ? h.w : h.d) / 2 + 0.4;
        const dx = out.x - h.x;
        const dz = out.z - h.z;
        if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
          const px = hw - Math.abs(dx);
          const pz = hd - Math.abs(dz);
          if (px < pz) out.x = h.x + Math.sign(dx || 1) * hw;
          else out.z = h.z + Math.sign(dz || 1) * hd;
        }
      }
    }
    return out;
  }
  /** Best passage for moving between inside/outside, near a reference x. */
  nearestPassage(x: number): { x: number; gate: boolean } | null {
    let best: { x: number; gate: boolean } | null = null;
    let bd = Infinity;
    for (const p of this.passages()) {
      const px = clamp(x, p.x0 + 1, p.x1 - 1);
      const d = Math.abs(px - x) + (p.gate ? 0 : 0);
      if (d < bd) {
        bd = d;
        best = { x: (p.x0 + p.x1) / 2 + clamp(x - (p.x0 + p.x1) / 2, -(p.x1 - p.x0) / 2 + 2, (p.x1 - p.x0) / 2 - 2), gate: p.gate };
      }
    }
    return best;
  }
}
