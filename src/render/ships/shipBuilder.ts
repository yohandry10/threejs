import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { factionDef } from '../../data/factions';
import { drawHeraldry } from '../../data/heraldry';
import { shipDef } from '../../data/units';
import { bandTexture, darkWoodTexture, deckPlankTexture, fittingWoodTexture, hullPlankTexture, pennantTexture, sailTexture, windowTextures, type SailKind } from './shipTextures';

/*
 * Procedural ship generator.
 *
 * Hulls are lofted from station sections (keel → sheer) with rake, tumblehome, transoms and
 * optional clinker laps. Carracks get multi-tier stern castles with galleries and leaded
 * windows, overhanging forecastles, balustrades, painted heraldic bands and gilded mouldings.
 * Masts carry fighting tops, topmasts and yards with billowing sails; standing rigging is
 * modelled as rope tubes with channels and deadeyes, running rigging and ratlines as lines.
 * Three LODs are produced and geometry is shared between ships of the same class.
 */

// ---------------------------------------------------------------- design parameters

export interface HullDef {
  L: number;
  B: number;
  draft: number;
  depth: number; // deck height above the waterline amidships
  bulwark: number;
  sheerAft: number;
  sheerFwd: number;
  transom: number; // stern width fraction
  bowRake: number;
  sternRake: number;
  tumble: number;
  sternFine: number;
  clinker: boolean;
}
interface CastleTier {
  t0: number;
  t1: number;
  h: number;
}
interface MastDef {
  t: number;
  h: number;
  squares: number;
  lateen: boolean;
  yard: number;
  top: boolean;
}
export interface ShipDesign {
  hull: HullDef;
  aft?: { style: 'carrack' | 'cog'; tiers: CastleTier[]; gallery: boolean };
  fore?: { style: 'carrack' | 'cog'; t0: number; h: number; overhang: number; tier2?: number };
  masts: MastDef[];
  bowsprit?: { len: number; angle: number; sprit: boolean };
  oars: number;
  ram: boolean;
  awning: boolean;
  shields: boolean;
  boat: boolean;
  lanterns: number;
  beak: boolean;
}

/** Legacy parameter summary used by actors (buoyancy, crew placement). */
export interface ShipParams {
  length: number;
  beam: number;
  depth: number;
  draft: number;
  oars: number;
}

export function designFor(type: string, faction: string): ShipDesign {
  const L = shipDef(type).length;
  const raider = faction === 'ostrevan' || faction === 'korr' || faction === 'pirates';
  switch (type) {
    case 'galley':
      return {
        hull: { L, B: L / 5.6, draft: 1.3, depth: 1.5, bulwark: 0.75, sheerAft: 1.6, sheerFwd: 0.9, transom: 0.34, bowRake: 1.2, sternRake: 2.6, tumble: 0.02, sternFine: 0.5, clinker: raider },
        masts: [
          { t: 0.62, h: L * 0.56, squares: 0, lateen: true, yard: L * 0.62, top: false },
          { t: 0.84, h: L * 0.36, squares: 0, lateen: true, yard: L * 0.38, top: false },
        ],
        oars: 14,
        ram: true,
        awning: true,
        shields: raider,
        boat: false,
        lanterns: 1,
        beak: false,
      };
    case 'cog':
      return {
        hull: { L, B: L / 3.1, draft: 2.4, depth: 2.9, bulwark: 1.05, sheerAft: 1.4, sheerFwd: 1.6, transom: 0.16, bowRake: 3.4, sternRake: 1.6, tumble: 0.03, sternFine: 0.9, clinker: true },
        aft: { style: 'cog', tiers: [{ t0: 0, t1: 0.23, h: 2.4 }], gallery: false },
        fore: { style: 'cog', t0: 0.84, h: 1.9, overhang: 1.8 },
        masts: [{ t: 0.52, h: L * 0.92, squares: 1, lateen: false, yard: L * 0.52, top: true }],
        bowsprit: { len: L * 0.26, angle: 0.36, sprit: false },
        oars: 0,
        ram: false,
        awning: false,
        shields: raider,
        boat: false,
        lanterns: 1,
        beak: false,
      };
    case 'hulk':
      return {
        hull: { L, B: L / 3.0, draft: 2.6, depth: 3.1, bulwark: 1.0, sheerAft: 2.8, sheerFwd: 2.8, transom: 0.0, bowRake: 2.6, sternRake: 2.8, tumble: 0.07, sternFine: 1.0, clinker: true },
        aft: { style: 'cog', tiers: [{ t0: 0.0, t1: 0.2, h: 2.2 }], gallery: false },
        fore: { style: 'cog', t0: 0.86, h: 1.7, overhang: 1.2 },
        masts: [
          { t: 0.54, h: L * 0.88, squares: 2, lateen: false, yard: L * 0.48, top: true },
          { t: 0.22, h: L * 0.5, squares: 0, lateen: true, yard: L * 0.34, top: false },
        ],
        bowsprit: { len: L * 0.22, angle: 0.4, sprit: true },
        oars: 0,
        ram: false,
        awning: false,
        shields: false,
        boat: true,
        lanterns: 1,
        beak: false,
      };
    case 'carrack':
      return {
        hull: { L, B: L / 3.35, draft: 3.0, depth: 2.9, bulwark: 1.2, sheerAft: 2.3, sheerFwd: 1.8, transom: 0.6, bowRake: 4.2, sternRake: 1.6, tumble: 0.15, sternFine: 0.7, clinker: false },
        aft: { style: 'carrack', tiers: [{ t0: 0, t1: 0.29, h: 2.5 }, { t0: 0, t1: 0.15, h: 2.3 }], gallery: true },
        fore: { style: 'carrack', t0: 0.82, h: 2.4, overhang: 4.8 },
        masts: [
          { t: 0.79, h: L * 0.66, squares: 2, lateen: false, yard: L * 0.28, top: true },
          { t: 0.5, h: L * 0.86, squares: 2, lateen: false, yard: L * 0.4, top: true },
          { t: 0.24, h: L * 0.56, squares: 0, lateen: true, yard: L * 0.4, top: true },
        ],
        bowsprit: { len: L * 0.3, angle: 0.45, sprit: true },
        oars: 0,
        ram: false,
        awning: false,
        shields: true,
        boat: true,
        lanterns: 3,
        beak: true,
      };
    case 'flagship':
    default:
      return {
        hull: { L, B: L / 3.5, draft: 3.6, depth: 3.3, bulwark: 1.3, sheerAft: 3.1, sheerFwd: 2.3, transom: 0.62, bowRake: 5.4, sternRake: 2.2, tumble: 0.16, sternFine: 0.7, clinker: false },
        aft: { style: 'carrack', tiers: [{ t0: 0, t1: 0.31, h: 2.7 }, { t0: 0, t1: 0.19, h: 2.5 }, { t0: 0, t1: 0.08, h: 2.2 }], gallery: true },
        fore: { style: 'carrack', t0: 0.8, h: 2.6, overhang: 6.4, tier2: 2.1 },
        masts: [
          { t: 0.8, h: L * 0.64, squares: 2, lateen: false, yard: L * 0.27, top: true },
          { t: 0.5, h: L * 0.86, squares: 3, lateen: false, yard: L * 0.38, top: true },
          { t: 0.27, h: L * 0.54, squares: 0, lateen: true, yard: L * 0.36, top: true },
          { t: 0.11, h: L * 0.4, squares: 0, lateen: true, yard: L * 0.26, top: false },
        ],
        bowsprit: { len: L * 0.3, angle: 0.42, sprit: true },
        oars: 0,
        ram: false,
        awning: false,
        shields: true,
        boat: true,
        lanterns: 3,
        beak: true,
      };
  }
}

export function paramsFor(type: string, faction: string): ShipParams {
  const d = designFor(type, faction);
  return { length: d.hull.L, beam: d.hull.B, depth: d.hull.depth, draft: d.hull.draft, oars: d.oars };
}

// ---------------------------------------------------------------- hull shape

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class HullShape {
  constructor(public d: HullDef) {}
  deckY(t: number) {
    const d = this.d;
    const a = Math.max(0, 1 - t / 0.5);
    const f = Math.max(0, (t - 0.5) / 0.5);
    return d.depth + d.sheerAft * a * a + d.sheerFwd * Math.pow(f, 2.2);
  }
  sheerY(t: number) {
    return this.deckY(t) + this.d.bulwark;
  }
  keelY(t: number) {
    const d = this.d;
    return -d.draft * (1 - 0.72 * Math.pow(smooth(0.74, 1.0, t), 1.4) - 0.12 * smooth(0.2, 0, t));
  }
  maxHB(t: number) {
    const d = this.d;
    const bowU = Math.max(0, (t - 0.46) / 0.54);
    const bow = Math.pow(Math.max(0, 1 - Math.pow(bowU, 1.9)), 0.58);
    const sternU = Math.min(1, t / 0.46);
    const stern = d.transom + (1 - d.transom) * Math.pow(Math.sin((sternU * Math.PI) / 2), 0.85);
    return (d.B / 2) * bow * stern;
  }
  sec(t: number, s: number) {
    const d = this.d;
    const endBow = smooth(0.58, 1.0, t);
    const endStern = (1 - smooth(0.0, 0.42, t)) * d.sternFine;
    const e = Math.max(endBow, endStern);
    const p = 0.28 + e * 1.35;
    let f = Math.pow(Math.sin((Math.min(1, s) * Math.PI) / 2), p);
    f *= 1 - d.tumble * Math.pow(smooth(0.55, 1, s), 1.2);
    return f;
  }
  zAt(t: number, s: number) {
    const d = this.d;
    s = Math.max(0, s);
    return -d.L / 2 + t * d.L + d.bowRake * smooth(0.72, 1, t) * Math.pow(s, 1.6) - d.sternRake * (1 - smooth(0, 0.24, t)) * Math.pow(s, 1.35);
  }
  point(t: number, s: number, side: number, out = new THREE.Vector3()) {
    const kY = this.keelY(t);
    const sY = this.sheerY(t);
    const y = kY + (sY - kY) * s;
    let x = this.maxHB(t) * this.sec(t, s);
    if (this.d.clinker && s > 0.04) {
      const n = 11;
      const f = (s * n) % 1;
      x += 0.045 * f * Math.min(1, this.maxHB(t) / 1.5);
    }
    return out.set(side * x, y, this.zAt(t, s));
  }
  /** Section parameter for a given height at a station. */
  sFor(t: number, y: number) {
    const kY = this.keelY(t);
    return (y - kY) / (this.sheerY(t) - kY);
  }
  /** Outer half-breadth at the top of the bulwark. */
  topX(t: number) {
    return this.maxHB(t) * this.sec(t, 1);
  }
}

// ---------------------------------------------------------------- geometry toolkit

type MatKey = 'hull' | 'deck' | 'wood' | 'fitting' | 'band' | 'gold' | 'iron' | 'rope' | 'window' | 'glass' | 'shield' | 'canvas' | 'bronze' | 'dark' | 'oar';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WHITE = new THREE.Color(1, 1, 1);

function prep(g: THREE.BufferGeometry, color: THREE.Color = WHITE): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const n = geo.getAttribute('position').count;
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.getAttribute('color')) {
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = color.r;
      c[i * 3 + 1] = color.g;
      c[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color', 'aOar'].includes(k)) geo.deleteAttribute(k);
  geo.morphAttributes = {};
  if ((globalThis as { __SHIP_NAN_CHECK?: boolean }).__SHIP_NAN_CHECK) {
    const a = geo.getAttribute('position').array;
    for (let i = 0; i < a.length; i++)
      if (!Number.isFinite(a[i])) {
        console.log(new Error('NaN geometry').stack?.split('\n').slice(2, 5).join(' | '));
        break;
      }
  }
  return geo;
}

class Parts {
  items: { key: MatKey; geo: THREE.BufferGeometry; detail: number; only?: number }[] = [];
  /** detail: 0 = only the close LOD, 1 = close + medium, 2 = every LOD */
  add(key: MatKey, geo: THREE.BufferGeometry, detail = 0, color?: THREE.Color) {
    this.items.push({ key, geo: prep(geo, color), detail });
  }
  /** geometry used only at one LOD level */
  addOnly(key: MatKey, geo: THREE.BufferGeometry, level: number, color?: THREE.Color) {
    this.items.push({ key, geo: prep(geo, color), detail: -1, only: level });
  }
  build(level: number) {
    const by = new Map<MatKey, THREE.BufferGeometry[]>();
    for (const it of this.items) {
      if (it.only !== undefined ? it.only !== level : it.detail < level) continue;
      let l = by.get(it.key);
      if (!l) by.set(it.key, (l = []));
      l.push(it.geo);
    }
    const out: [MatKey, THREE.BufferGeometry][] = [];
    for (const [k, list] of by) {
      const withOar = list.some((g) => g.getAttribute('aOar'));
      const clean = withOar ? list : list.map((g) => g);
      const m = mergeGeometries(clean, false);
      if (m) {
        m.computeBoundingSphere();
        out.push([k, m]);
      }
    }
    return out;
  }
}

/** Grid surface from rows of points (rows[i][j]); uv and colour per point. */
function surface(rows: THREE.Vector3[][], uv: (i: number, j: number) => [number, number], color: ((i: number, j: number, p: THREE.Vector3) => THREE.Color) | null, flip: boolean): THREE.BufferGeometry {
  const ni = rows.length;
  const nj = rows[0].length;
  const pos = new Float32Array(ni * nj * 3);
  const uvs = new Float32Array(ni * nj * 2);
  const col = new Float32Array(ni * nj * 3);
  for (let i = 0; i < ni; i++)
    for (let j = 0; j < nj; j++) {
      const k = i * nj + j;
      const p = rows[i][j];
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = p.z;
      const [u, v] = uv(i, j);
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = v;
      const c = color ? color(i, j, p) : WHITE;
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  const idx: number[] = [];
  for (let i = 0; i < ni - 1; i++)
    for (let j = 0; j < nj - 1; j++) {
      const a = i * nj + j;
      const b = (i + 1) * nj + j;
      if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b);
      else idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sweep a 2D profile (x = outward, y = up) along a path; `out(i)` gives the outward direction. */
function sweep(path: THREE.Vector3[], profile: [number, number][], out: (i: number) => THREE.Vector3, closedProfile = true, uvScale = 0.5): THREE.BufferGeometry {
  const rows: THREE.Vector3[][] = [];
  let acc = 0;
  const us: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const T = next.clone().sub(prev).normalize();
    const O = out(i).clone();
    O.addScaledVector(T, -O.dot(T)).normalize();
    const U = T.clone().cross(O).normalize().multiplyScalar(-1);
    if (U.y < 0) U.multiplyScalar(-1);
    if (i > 0) acc += p.distanceTo(path[i - 1]);
    us.push(acc);
    const ring: THREE.Vector3[] = [];
    const prof = closedProfile ? [...profile, profile[0]] : profile;
    for (const [px, py] of prof) ring.push(p.clone().addScaledVector(O, px).addScaledVector(U, py));
    rows.push(ring);
  }
  const n = rows[0].length;
  const g = surface(rows, (i, j) => [us[i] * uvScale, j / (n - 1)], null, false);
  // make sure faces point outward (away from the path centre)
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  let dot = 0;
  for (let k = 0; k < Math.min(pos.count, 40); k++) {
    const i = Math.floor(k / n);
    const c = path[Math.min(i, path.length - 1)];
    dot += (pos.getX(k) - c.x) * nor.getX(k) + (pos.getY(k) - c.y) * nor.getY(k) + (pos.getZ(k) - c.z) * nor.getZ(k);
  }
  if (dot < 0) {
    const idx = g.getIndex()!;
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let k = 0; k < arr.length; k += 3) {
      const t = arr[k + 1];
      arr[k + 1] = arr[k + 2];
      arr[k + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

function tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, sides = 6, capped = false): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, Math.max(0.001, len), sides, 1, !capped);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Box oriented along a→b with width (horizontal) and height. */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const z = b.clone().sub(a).normalize();
  let x = V(0, 1, 0).cross(z);
  if (x.lengthSq() < 1e-6) x = V(1, 0, 0);
  x.normalize();
  const y = z.clone().cross(x).normalize();
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')));
  g.translate(x, y, z);
  return g;
}

function lathe(profile: [number, number][], segs: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)),
    segs,
  );
}

/** Polygon fan (roughly convex outline) at its own heights. */
function fan(pts: THREE.Vector3[], up: boolean, uvScale = 0.2): THREE.BufferGeometry {
  const c = V();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const tri = up ? [c, b, a] : [c, a, b];
    for (const p of tri) {
      pos.push(p.x, p.y, p.z);
      uv.push(p.x * uvScale, p.z * uvScale);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // orient
  const n = g.getAttribute('normal');
  let sum = 0;
  for (let i = 0; i < n.count; i++) sum += n.getY(i);
  if ((sum > 0) !== up && Math.abs(sum) > 1e-3) {
    const p = g.getAttribute('position').array as Float32Array;
    for (let k = 0; k < p.length; k += 9) {
      for (let q = 0; q < 3; q++) {
        const t = p[k + 3 + q];
        p[k + 3 + q] = p[k + 6 + q];
        p[k + 6 + q] = t;
      }
    }
    g.computeVertexNormals();
  }
  return g;
}

/** Vertical wall strip between two height profiles along a path of (x,z) points. */
function wall(path: THREE.Vector3[], bottom: number[], top: number[], lean: number, outward: (i: number) => THREE.Vector3, uvScale = 0.25, unitV = false): THREE.BufferGeometry {
  const rows: THREE.Vector3[][] = [];
  const us: number[] = [];
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i > 0) acc += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z);
    us.push(acc);
    const o = outward(i);
    const b = V(p.x, bottom[i], p.z);
    const t = V(p.x - o.x * lean, top[i], p.z - o.z * lean);
    rows.push([b, t]);
  }
  const g = surface(rows, (i, j) => [us[i] * uvScale, unitV ? j : (j ? top[i] : bottom[i]) * uvScale], null, false);
  // orient outward
  const n = g.getAttribute('normal');
  const o0 = outward(Math.floor(path.length / 2));
  const k = Math.floor(path.length / 2) * 2;
  if (n.getX(k) * o0.x + n.getZ(k) * o0.z < 0) {
    const idx = g.getIndex()!.array as Uint16Array | Uint32Array;
    for (let q = 0; q < idx.length; q += 3) {
      const t = idx[q + 1];
      idx[q + 1] = idx[q + 2];
      idx[q + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

// ---------------------------------------------------------------- sails

interface SailBuild {
  geo: THREE.BufferGeometry;
  kind: SailKind;
}

function squareSail(topW: number, botW: number, h: number, belly: number, yard: THREE.Vector3): THREE.BufferGeometry {
  const NX = 14;
  const NY = 12;
  const pos: number[] = [];
  const uv: number[] = [];
  const sa: number[] = [];
  const bl: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const v = j / NY;
      const w = topW + (botW - topW) * v;
      const x = (u - 0.5) * w;
      // the foot curves up a little (roach) at the clews
      const y = -v * h + Math.pow(Math.abs(u - 0.5) * 2, 3) * v * h * 0.05;
      const b = belly * Math.sin(u * Math.PI) * Math.sin((0.12 + v * 0.8) * Math.PI) * (0.35 + 0.65 * v);
      pos.push(yard.x + x, yard.y + y, yard.z + b);
      uv.push(u, 1 - v);
      sa.push(u, v);
      bl.push(0, 0, b);
    }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const c = a + NX + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSail', new THREE.Float32BufferAttribute(sa, 2));
  g.setAttribute('aBelly', new THREE.Float32BufferAttribute(bl, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lateenSail(F: THREE.Vector3, A: THREE.Vector3, C: THREE.Vector3, belly: number, side: number): THREE.BufferGeometry {
  const NU = 14;
  const NV = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  const sa: number[] = [];
  const bl: number[] = [];
  const idx: number[] = [];
  const nrm = A.clone().sub(F).cross(C.clone().sub(F)).normalize();
  if (nrm.x * side < 0) nrm.multiplyScalar(-1);
  for (let j = 0; j <= NV; j++)
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const v = j / NV;
      const top = F.clone().lerp(A, u);
      const p = top.lerp(C, v * (0.25 + 0.75 * u) + v * (1 - u) * 0.0);
      // blend the foot from the tack (F) to the clew (C)
      const foot = F.clone().lerp(C, u);
      const q = top.clone().lerp(foot, v);
      p.copy(q);
      const b = belly * Math.sin(u * Math.PI) * Math.sin(v * Math.PI * 0.9 + 0.1) * (1 - v * 0.3);
      p.addScaledVector(nrm, b);
      pos.push(p.x, p.y, p.z);
      uv.push(u, 1 - v);
      sa.push(u, v);
      bl.push(nrm.x * b, nrm.y * b, nrm.z * b);
    }
  for (let j = 0; j < NV; j++)
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i;
      const c = a + NU + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSail', new THREE.Float32BufferAttribute(sa, 2));
  g.setAttribute('aBelly', new THREE.Float32BufferAttribute(bl, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function pennantGeometry(len: number, w: number, fork: boolean): THREE.BufferGeometry {
  const N = 24;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const ww = w * (1 - u * 0.75);
    const x = u * len;
    let top = ww / 2;
    let bot = -ww / 2;
    if (fork && u > 0.82) {
      const k = (u - 0.82) / 0.18;
      top = ww / 2;
      bot = -ww / 2;
      // notch in the middle
      pos.push(x, top, 0, x, top - ww * 0.5 * (1 - k * 0.8), 0, x, bot + ww * 0.5 * (1 - k * 0.8), 0, x, bot, 0);
    } else pos.push(x, top, 0, x, top * 0.33 + bot * 0.67 + (top - bot) * 0.33, 0, x, bot + (top - bot) * 0.33, 0, x, bot, 0);
    uv.push(u, 1, u, 0.66, u, 0.33, u, 0);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4;
    const b = a + 4;
    const forked = fork && i / N >= 0.82;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
    if (!forked) idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- materials

export const shipUniforms = {
  uTime: { value: 0 },
  uLamp: { value: 0 },
  uBacklight: { value: 0.08 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.5, 0.2).normalize() },
  uSunCol: { value: new THREE.Color(1, 0.9, 0.8) },
};

type Mats = Record<Exclude<MatKey, 'band' | 'shield' | 'canvas'>, THREE.MeshStandardMaterial> & { rope: THREE.MeshStandardMaterial; ropeLine: THREE.LineBasicMaterial };
let mats: Mats | null = null;

export function shipMaterials(): Mats {
  if (mats) return mats;
  const hullT = hullPlankTexture();
  const darkT = darkWoodTexture();
  const deckT = deckPlankTexture();
  const fitT = fittingWoodTexture();
  const win = windowTextures();
  const lampify = (m: THREE.MeshStandardMaterial, min: number, k: number) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uLamp = shipUniforms.uLamp;
      sh.fragmentShader = sh.fragmentShader
        .replace('uniform vec3 emissive;', 'uniform vec3 emissive;\nuniform float uLamp;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance *= max(uLamp, ${min.toFixed(2)}) * ${k.toFixed(2)};`);
    };
    m.customProgramCacheKey = () => `lamp${min}${k}`;
    return m;
  };
  mats = {
    hull: new THREE.MeshStandardMaterial({ map: hullT, bumpMap: hullT, bumpScale: 1.6, vertexColors: true, roughness: 0.78, metalness: 0 }),
    deck: new THREE.MeshStandardMaterial({ map: deckT, bumpMap: deckT, bumpScale: 1.0, roughness: 0.82, vertexColors: true }),
    wood: new THREE.MeshStandardMaterial({ map: darkT, bumpMap: darkT, bumpScale: 1.0, roughness: 0.7, vertexColors: true }),
    fitting: new THREE.MeshStandardMaterial({ map: fitT, roughness: 0.85, vertexColors: true }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd8a948, metalness: 0.88, roughness: 0.3, vertexColors: true, emissive: 0x2a1a04 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x3b3d40, metalness: 0.7, roughness: 0.5, vertexColors: true }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xa8763a, metalness: 0.85, roughness: 0.35, vertexColors: true }),
    rope: new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.9, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b140e, roughness: 0.95, vertexColors: true }),
    window: lampify(new THREE.MeshStandardMaterial({ map: win.map, emissiveMap: win.emissive, emissive: new THREE.Color(1.0, 0.72, 0.38), roughness: 0.4, vertexColors: true }), 0.35, 2.4),
    glass: lampify(new THREE.MeshStandardMaterial({ color: 0x3a2610, emissive: new THREE.Color(1.0, 0.66, 0.3), roughness: 0.3, vertexColors: true }), 0.45, 3.2),
    oar: new THREE.MeshStandardMaterial({ map: fitT, color: 0xb89a70, roughness: 0.8, vertexColors: true }),
    ropeLine: new THREE.LineBasicMaterial({ color: 0x2a2016, transparent: true, opacity: 0.9 }),
  } as Mats;
  // oars rotate around their tholes with a rowing stroke
  mats.oar.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shipUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 aOar;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float ph = uTime * 1.9 + aOar.w;
          float sweep = sin(ph) * 0.42;
          float lift = max(0.0, cos(ph)) * 0.16;
          vec3 pv = aOar.xyz;
          vec3 q = transformed - pv;
          float side = sign(q.x + 1e-4);
          float cs = cos(sweep), sn = sin(sweep);
          q = vec3(q.x * cs - q.z * sn * side, q.y, q.x * sn * side + q.z * cs);
          float cl = cos(lift), sl = sin(lift);
          q = vec3(q.x * cl + q.y * sl * side, -q.x * sl * side + q.y * cl, q.z);
          transformed = pv + q;
        }`,
      );
  };
  mats.oar.customProgramCacheKey = () => 'oar';
  return mats;
}

const facMats = new Map<string, { band: THREE.MeshStandardMaterial; shield: THREE.MeshStandardMaterial; canvas: THREE.MeshStandardMaterial; pennant: THREE.MeshStandardMaterial }>();
function factionMats(faction: string) {
  let m = facMats.get(faction);
  if (m) return m;
  const def = factionDef(faction);
  // heater shield painted with the arms
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 160);
  drawHeraldry(ctx, def.heraldry, 4, 4, 120, 152, true);
  // dark rim around the painted shield
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#2a1d10';
  ctx.beginPath();
  ctx.moveTo(1, 1);
  ctx.lineTo(127, 1);
  ctx.lineTo(127, 70);
  ctx.quadraticCurveTo(122, 128, 64, 159);
  ctx.quadraticCurveTo(6, 128, 1, 70);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const st = new THREE.CanvasTexture(c);
  st.colorSpace = THREE.SRGBColorSpace;
  // awning cloth with stripes
  const a = document.createElement('canvas');
  a.width = 256;
  a.height = 64;
  const actx = a.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    actx.fillStyle = i % 2 ? def.color : '#e9dfc8';
    actx.fillRect(i * 32, 0, 32, 64);
  }
  const at = new THREE.CanvasTexture(a);
  at.colorSpace = THREE.SRGBColorSpace;
  at.wrapS = at.wrapT = THREE.RepeatWrapping;
  m = {
    band: new THREE.MeshStandardMaterial({ map: bandTexture(faction), roughness: 0.55, metalness: 0.05, vertexColors: true }),
    shield: new THREE.MeshStandardMaterial({ map: st, roughness: 0.5, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    canvas: new THREE.MeshStandardMaterial({ map: at, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true }),
    pennant: makeWaving(new THREE.MeshStandardMaterial({ map: pennantTexture(faction), side: THREE.DoubleSide, roughness: 0.85 }), 'pennant', 1.6),
  };
  facMats.set(faction, m);
  return m;
}

function makeWaving(m: THREE.MeshStandardMaterial, key: string, amp: number) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shipUniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float fx = uv.x;
      transformed.z += sin(uTime * 5.5 - fx * 9.0 + position.y * 0.6) * 0.22 * ${amp.toFixed(2)} * fx;
      transformed.y += sin(uTime * 3.7 - fx * 6.0) * 0.08 * ${amp.toFixed(2)} * fx - fx * fx * 0.25 * ${amp.toFixed(2)};`,
    );
  };
  m.customProgramCacheKey = () => key;
  return m;
}

const sailBase = new Map<string, THREE.MeshStandardMaterial>();
export interface SailUniforms {
  uWind: { value: number };
  uBelly: { value: number };
  uTime: { value: number };
}

export function makeSailMaterial(faction: string, kind: SailKind): THREE.MeshStandardMaterial {
  const key = `${faction}:${kind}`;
  let base = sailBase.get(key);
  if (!base) {
    base = new THREE.MeshStandardMaterial({ map: sailTexture(faction, kind), side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    sailBase.set(key, base);
  }
  const m = base.clone();
  const su: SailUniforms = { uWind: { value: 1 }, uBelly: { value: 1 }, uTime: shipUniforms.uTime };
  m.userData.sail = su;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, su);
    sh.uniforms.uBacklight = shipUniforms.uBacklight;
    sh.uniforms.uSunDirW = shipUniforms.uSunDir;
    sh.uniforms.uSunColS = shipUniforms.uSunCol;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;\nuniform float uBelly;\nuniform float uTime;\nattribute vec2 aSail;\nattribute vec3 aBelly;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 bd = aBelly;
          transformed += bd * (uBelly - 1.0);
          float edge = 1.0 - sin(aSail.x * 3.14159) * 0.7;
          float flutter = sin(uTime * 3.3 + aSail.x * 8.0 + aSail.y * 6.0) * 0.06 * uWind * (1.15 - min(uBelly, 1.0) * 0.8) * (0.3 + aSail.y) * edge;
          vec3 nd = length(bd) > 1e-4 ? normalize(bd) : vec3(0.0, 0.0, 1.0);
          transformed += nd * flutter;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform vec3 emissive;', 'uniform vec3 emissive;\nuniform float uBacklight;\nuniform vec3 uSunDirW;\nuniform vec3 uSunColS;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // light shining through the canvas when the sun is behind the sail
          vec3 sv = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
          float through = max(0.0, -dot(normal, sv));
          float day = smoothstep(-0.05, 0.12, uSunDirW.y);
          totalEmissiveRadiance += diffuseColor.rgb * (uSunColS * through * 0.26 * day + uBacklight);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'sail2';
  return m;
}

const flagMatCache = new Map<string, THREE.MeshStandardMaterial>();
export function makeFlagMaterial(faction: string): THREE.MeshStandardMaterial {
  let m = flagMatCache.get(faction);
  if (m) return m;
  const def = factionDef(faction);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = def.color;
  ctx.fillRect(0, 0, 256, 192);
  drawHeraldry(ctx, def.heraldry, 64, 12, 128, 168, false);
  ctx.strokeStyle = def.color2;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 184);
  // fringe
  ctx.fillStyle = '#d9b056';
  for (let y = 0; y < 192; y += 8) ctx.fillRect(248, y, 8, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  m = makeWaving(new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.85 }), 'flag', 1);
  flagMatCache.set(faction, m);
  return m;
}

// ---------------------------------------------------------------- the builder

interface Built {
  levels: [MatKey, THREE.BufferGeometry][][];
  lines: THREE.BufferGeometry[]; // hi, mid
  sails: { geo: THREE.BufferGeometry; geoLo: THREE.BufferGeometry; kind: SailKind }[];
  pennants: { geo: THREE.BufferGeometry; pos: THREE.Vector3; rotY: number }[];
  ensign: { pos: THREE.Vector3; size: number } | null;
  lanterns: THREE.Vector3[];
  deckH: number;
  crew: THREE.Vector3[];
}

const cache = new Map<string, Built>();

class ShipGen {
  parts = new Parts();
  lines: number[] = [];
  linesMid: number[] = [];
  shape: HullShape;
  sails: Built['sails'] = [];
  pennants: Built['pennants'] = [];
  ensign: Built['ensign'] = null;
  lanterns: THREE.Vector3[] = [];
  crew: THREE.Vector3[] = [];
  aftTop = 0;
  foreTop = 0;
  constructor(public D: ShipDesign) {
    this.shape = new HullShape(D.hull);
  }
  line(a: THREE.Vector3, b: THREE.Vector3, mid = false) {
    this.lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
    if (mid) this.linesMid.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  build(): Built {
    this.hull();
    this.castles();
    this.deckGear();
    this.masts();
    this.fittings();
    if (this.D.oars) this.oars();
    const levels = [this.parts.build(0), this.parts.build(1), this.parts.build(2)];
    const mk = (arr: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return g;
    };
    return { levels, lines: [mk(this.lines), mk(this.linesMid)], sails: this.sails, pennants: this.pennants, ensign: this.ensign, lanterns: this.lanterns, deckH: this.shape.deckY(0.5), crew: this.crew };
  }

  // -------------------------------------------------------------- hull
  private hull() {
    const S = this.shape;
    const D = this.D.hull;
    const bottomC = new THREE.Color(0.42, 0.33, 0.27);
    const bootC = new THREE.Color(0.14, 0.12, 0.11);
    const topC = new THREE.Color(1, 0.98, 0.95);
    const colorAt = (p: THREE.Vector3) => {
      if (p.y < -0.18) return bottomC;
      if (p.y < 0.32) return bootC;
      return topC;
    };
    for (const res of [
      { ns: 72, nv: 26, detail: 1 },
      { ns: 26, nv: 9, detail: 2 },
    ]) {
      for (const side of [-1, 1]) {
        const rows: THREE.Vector3[][] = [];
        const arcs: number[][] = [];
        for (let i = 0; i <= res.ns; i++) {
          const t = (1 - Math.cos((Math.PI * i) / res.ns)) / 2;
          const row: THREE.Vector3[] = [];
          const arc: number[] = [];
          let acc = 0;
          for (let j = 0; j <= res.nv; j++) {
            const s = (1 - Math.cos((Math.PI * j) / res.nv)) / 2;
            const p = S.point(t, s, side);
            if (j > 0) acc += p.distanceTo(row[j - 1]);
            row.push(p);
            arc.push(acc);
          }
          rows.push(row);
          arcs.push(arc);
        }
        const g = surface(
          rows,
          (i, j) => [rows[i][j].z / 7.5, arcs[i][j] / 3.9],
          (_i, _j, p) => colorAt(p),
          side > 0,
        );
        // detailed hull for the close and medium LODs, a coarse one for distance
        if (res.detail === 1) this.parts.add('hull', g, 1);
        else this.parts.addOnly('hull', g, 2);
      }
      // transom / stern closure
      const t0 = 0;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= res.nv; j++) pts.push(S.point(t0, (1 - Math.cos((Math.PI * j) / res.nv)) / 2, 1));
      for (let j = res.nv; j >= 0; j--) pts.push(S.point(t0, (1 - Math.cos((Math.PI * j) / res.nv)) / 2, -1));
      const tr = fan(pts, false, 0.26);
      // face aft
      const tn = tr.getAttribute('normal');
      if (tn.getZ(0) > 0) {
        const p = tr.getAttribute('position').array as Float32Array;
        for (let k = 0; k < p.length; k += 9)
          for (let q = 0; q < 3; q++) {
            const tmp = p[k + 3 + q];
            p[k + 3 + q] = p[k + 6 + q];
            p[k + 6 + q] = tmp;
          }
        tr.computeVertexNormals();
      }
      // uv: planks running across the transom
      const tp = tr.getAttribute('position');
      const tuv = new Float32Array(tp.count * 2);
      for (let k = 0; k < tp.count; k++) {
        tuv[k * 2] = tp.getX(k) / 7.5;
        tuv[k * 2 + 1] = tp.getY(k) / 3.9;
      }
      tr.setAttribute('uv', new THREE.BufferAttribute(tuv, 2));
      const tc = new Float32Array(tp.count * 3);
      for (let k = 0; k < tp.count; k++) {
        const c = colorAt(V(0, tp.getY(k), 0));
        tc[k * 3] = c.r * 0.92;
        tc[k * 3 + 1] = c.g * 0.92;
        tc[k * 3 + 2] = c.b * 0.92;
      }
      tr.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      if (res.detail === 1) this.parts.add('hull', tr, 1);
      else this.parts.addOnly('hull', tr, 2);
    }
    // keel, stem and sternpost timbers
    const keelPath: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = 0.02 + (i / 40) * 0.96;
      keelPath.push(V(0, S.keelY(t) - 0.12, S.zAt(t, 0)));
    }
    this.parts.add('wood', sweep(keelPath, [[-0.2, -0.25], [0.2, -0.25], [0.2, 0.2], [-0.2, 0.2]], () => V(1, 0, 0)), 1, new THREE.Color(0.35, 0.3, 0.27));
    const stem: THREE.Vector3[] = [];
    for (let j = 0; j <= 16; j++) {
      const s = j / 16;
      stem.push(S.point(0.999, s, 0).add(V(0, 0, 0.12)));
    }
    stem.push(stem[stem.length - 1].clone().add(V(0, 0.9, 0.35)));
    this.parts.add('wood', sweep(stem, [[-0.2, -0.22], [0.2, -0.22], [0.2, 0.22], [-0.2, 0.22]], () => V(1, 0, 0)), 1);
    const stern: THREE.Vector3[] = [];
    for (let j = 0; j <= 12; j++) stern.push(S.point(0.0, j / 12, 0).add(V(0, 0, -0.15)));
    this.parts.add('wood', sweep(stern, [[-0.22, -0.2], [0.22, -0.2], [0.22, 0.2], [-0.22, 0.2]], () => V(1, 0, 0)), 1);

    // inner bulwark, cap rail, deck
    for (const side of [-1, 1]) {
      const rows: THREE.Vector3[][] = [];
      const cap: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) {
        const t = 0.012 + (i / 48) * 0.975;
        const x = S.topX(t) - 0.2;
        const zTop = S.zAt(t, 1);
        rows.push([V(side * (S.maxHB(t) * S.sec(t, S.sFor(t, S.deckY(t))) - 0.2), S.deckY(t), S.zAt(t, S.sFor(t, S.deckY(t)))), V(side * x, S.sheerY(t) - 0.02, zTop)]);
        cap.push(V(side * (S.topX(t) - 0.08), S.sheerY(t) + 0.02, zTop));
      }
      this.parts.add('hull', surface(rows, (i, j) => [rows[i][j].z / 7.5, j * 0.3], () => new THREE.Color(0.85, 0.8, 0.75), side < 0), 1);
      this.parts.add('wood', sweep(cap, [[-0.2, -0.05], [0.14, -0.05], [0.14, 0.12], [-0.2, 0.12]], () => V(side, 0, 0)), 1);
    }
    // deck
    {
      const rows: THREE.Vector3[][] = [];
      for (let i = 0; i <= 40; i++) {
        const t = 0.01 + (i / 40) * 0.975;
        const y = S.deckY(t);
        const hw = S.maxHB(t) * S.sec(t, S.sFor(t, y)) - 0.15;
        const z = S.zAt(t, S.sFor(t, y));
        const r: THREE.Vector3[] = [];
        for (let j = 0; j <= 6; j++) r.push(V(-hw + (2 * hw * j) / 6, y, z));
        rows.push(r);
      }
      this.parts.add('deck', surface(rows, (i, j) => [rows[i][j].z / 9, rows[i][j].x / 4.6], null, true), 2);
    }
    // wales following the sheer, a painted band and gilded mouldings
    const waleOff = D.depth > 2.5 ? [0.5, 1.5, 2.5] : [0.45, 1.25];
    const tStart = 0.015;
    const tEnd = 0.965;
    for (const side of [-1, 1]) {
      for (const off of waleOff) {
        const path: THREE.Vector3[] = [];
        for (let i = 0; i <= 56; i++) {
          const t = tStart + (i / 56) * (tEnd - tStart);
          const y = S.sheerY(t) - D.bulwark - off;
          if (y < 0.4) continue;
          const s = S.sFor(t, y);
          const p = S.point(t, s, side);
          p.x += side * 0.02;
          path.push(p);
        }
        if (path.length > 3) this.parts.add('wood', sweep(path, [[0, -0.14], [0.16, -0.12], [0.18, 0.12], [0, 0.14]], () => V(side, 0, 0), false, 0.3), 1, new THREE.Color(0.55, 0.45, 0.38));
      }
      // painted band between the bulwark top and the first wale
      if (D.depth > 1.8) {
        const rows: THREE.Vector3[][] = [];
        const us: number[] = [];
        let acc = 0;
        for (let i = 0; i <= 56; i++) {
          const t = 0.03 + (i / 56) * 0.9;
          const yTop = S.sheerY(t) - 0.12;
          const yBot = S.sheerY(t) - D.bulwark * 0.95;
          const a = S.point(t, S.sFor(t, yBot), side);
          const b = S.point(t, S.sFor(t, yTop), side);
          a.x += side * 0.03;
          b.x += side * 0.03;
          if (i > 0) acc += a.distanceTo(rows[i - 1][0]);
          us.push(acc);
          rows.push([a, b]);
        }
        this.parts.add('band', surface(rows, (i, j) => [us[i] / 11, j], null, side > 0), 1);
        // gilt moulding at the top of the band
        const mould: THREE.Vector3[] = rows.map((r) => r[1].clone().add(V(side * 0.03, 0.02, 0)));
        this.parts.add('gold', sweep(mould, [[0, -0.05], [0.07, -0.04], [0.07, 0.04], [0, 0.05]], () => V(side, 0, 0), false), 0);
        const mould2: THREE.Vector3[] = rows.map((r) => r[0].clone().add(V(side * 0.03, -0.02, 0)));
        this.parts.add('gold', sweep(mould2, [[0, -0.04], [0.06, -0.03], [0.06, 0.03], [0, 0.04]], () => V(side, 0, 0), false), 0);
      }
    }
    // rudder with iron straps
    {
      const topY = S.sheerY(0) - D.bulwark - 0.2;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 10; j++) {
        const y = S.keelY(0.01) + ((topY - S.keelY(0.01)) * j) / 10;
        const s = S.sFor(0.0, y);
        pts.push(V(0, y, S.zAt(0, s) - 0.35));
      }
      const blade: THREE.Vector3[][] = pts.map((p, j) => {
        const w = 1.1 + (1 - j / 10) * 0.7;
        return [p, p.clone().add(V(0, 0, -w))];
      });
      for (const side of [-1, 1]) {
        const rr = blade.map((r) => r.map((p) => p.clone().add(V(side * 0.14, 0, 0))));
        this.parts.add('wood', surface(rr, (i, j) => [j * 0.4, i * 0.2], null, side < 0), 1);
      }
      for (let k = 0; k < 4; k++) {
        const p = pts[2 + k * 2];
        this.parts.add('iron', boxAt(0.34, 0.14, 1.0, 0, p.y, p.z - 0.3), 0);
      }
      this.parts.add('wood', beam(pts[pts.length - 1], pts[pts.length - 1].clone().add(V(0, 1.3, 1.6)), 0.25, 0.25), 0);
    }
    // ram for galleys
    if (this.D.ram) {
      const bowZ = S.zAt(1, 0.2);
      const y = 0.05;
      this.parts.add('bronze', tube(V(0, y, bowZ - 0.8), V(0, y, bowZ + 3.6), 0.55, 0.12, 8, true), 1);
      for (const s of [-1, 1]) this.parts.add('bronze', beam(V(0, y, bowZ + 0.3), V(s * 0.45, y + 0.3, bowZ + 2.4), 0.08, 0.5), 0);
    }
  }

  // -------------------------------------------------------------- castles
  private balustrade(path: THREE.Vector3[], h = 1.0, spacing = 0.42, gilt = true, detail = 0) {
    if (path.length < 2) return;
    // rails
    const top = path.map((p) => p.clone().add(V(0, h, 0)));
    const mid = path.map((p) => p.clone().add(V(0, 0.12, 0)));
    const out = (i: number) => {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(path.length - 1, i + 1)];
      const d = b.clone().sub(a);
      return V(d.z, 0, -d.x).normalize();
    };
    this.parts.add(gilt ? 'gold' : 'wood', sweep(top, [[-0.08, -0.06], [0.08, -0.06], [0.08, 0.06], [-0.08, 0.06]], out), Math.max(detail, 1));
    this.parts.add('wood', sweep(mid, [[-0.1, -0.08], [0.1, -0.08], [0.1, 0.08], [-0.1, 0.08]], out), detail);
    // turned balusters
    const prof: [number, number][] = [
      [0.06, 0],
      [0.06, 0.1],
      [0.035, 0.18],
      [0.075, 0.42],
      [0.045, 0.62],
      [0.035, 0.74],
      [0.06, 0.8],
      [0.06, 0.86],
    ];
    const bal = lathe(prof, 6);
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const len = a.distanceTo(b);
      let d = spacing - (acc % spacing);
      while (d < len) {
        const p = a.clone().lerp(b, d / len);
        const g = bal.clone();
        g.scale(1, (h - 0.2) / 0.86, 1);
        g.translate(p.x, p.y + 0.14, p.z);
        this.parts.add('wood', g, detail, new THREE.Color(0.9, 0.82, 0.72));
        d += spacing;
      }
      acc += len;
    }
    // posts at the corners
    for (const p of [path[0], path[path.length - 1]]) this.parts.add('wood', boxAt(0.2, h + 0.25, 0.2, p.x, p.y + (h + 0.25) / 2, p.z), Math.max(detail, 1));
  }

  private shieldsAlong(path: THREE.Vector3[], outSign: number, spacing = 1.3) {
    const g0 = new THREE.PlaneGeometry(0.75, 0.95);
    let acc = spacing / 2;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const len = a.distanceTo(b);
      while (acc < len) {
        const p = a.clone().lerp(b, acc / len);
        const d = b.clone().sub(a).normalize();
        const n = V(d.z, 0, -d.x).multiplyScalar(outSign);
        const g = g0.clone();
        g.applyMatrix4(new THREE.Matrix4().makeBasis(d.clone().multiplyScalar(outSign), V(0, 1, 0), n));
        g.translate(p.x + n.x * 0.14, p.y + 0.55, p.z + n.z * 0.14);
        this.parts.add('shield', g, 0);
        acc += spacing;
      }
      acc -= len;
    }
  }

  private castles() {
    const S = this.shape;
    const D = this.D;
    const aft = D.aft;
    if (aft) {
      if (aft.style === 'carrack') this.carrackAft(aft.tiers, aft.gallery);
      else this.cogAft(aft.tiers[0]);
    } else {
      this.aftTop = S.sheerY(0.02);
    }
    const fore = D.fore;
    if (fore) {
      if (fore.style === 'carrack') this.carrackFore(fore.t0, fore.h, fore.overhang, fore.tier2);
      else this.cogFore(fore.t0, fore.h, fore.overhang);
    } else this.foreTop = S.sheerY(0.98);
    if (D.awning) this.awning();
  }

  private outlineX(t: number, inset = 0) {
    return this.shape.topX(t) - inset;
  }

  private carrackAft(tiers: CastleTier[], gallery: boolean) {
    const S = this.shape;
    const D = this.D;
    let floorPrev = -1;
    let baseY = (t: number) => S.sheerY(t) - 0.05;
    let inset = 0.02;
    tiers.forEach((tier, k) => {
      const n = 14;
      const ts: number[] = [];
      for (let i = 0; i <= n; i++) ts.push(tier.t0 + ((tier.t1 - tier.t0) * i) / n);
      const floor = k === 0 ? Math.max(S.deckY(tier.t1) + tier.h, S.sheerY(0) + 0.9) : floorPrev + tier.h;
      const lean = 0.12;
      // side walls
      for (const side of [-1, 1]) {
        const path = ts.map((t) => V(side * this.outlineX(t, inset), 0, S.zAt(t, 1) - (k > 0 ? 0 : 0)));
        const bottom = ts.map((t) => (k === 0 ? baseY(t) : floorPrev - 0.05));
        const top = ts.map(() => floor + 0.15);
        this.parts.add('hull', wall(path, bottom, top, lean, () => V(side, 0, 0), 0.26), 1);
        // painted panel band along the castle wall
        const bandPath = ts.map((t) => V(side * (this.outlineX(t, inset) - lean * 0.45 + 0.03), 0, S.zAt(t, 1)));
        const bb = ts.map(() => floor - Math.min(1.6, tier.h * 0.65));
        const bt = ts.map(() => floor - 0.25);
        this.parts.add('band', wall(bandPath, bb, bt, 0.03, () => V(side, 0, 0), 1 / 11, true), 1);
        // gilt edge mouldings
        this.parts.add('gold', sweep(bandPath.map((p, i) => V(p.x + side * 0.02, bt[i] + 0.04, p.z)), [[0, -0.05], [0.08, -0.04], [0.08, 0.04], [0, 0.05]], () => V(side, 0, 0), false), 0);
        this.parts.add('gold', sweep(bandPath.map((p, i) => V(p.x + side * 0.02, bb[i] - 0.04, p.z)), [[0, -0.05], [0.08, -0.04], [0.08, 0.04], [0, 0.05]], () => V(side, 0, 0), false), 0);
        // balustrade on the exposed part of this tier's floor
        const next = tiers[k + 1];
        const rt = next ? ts.filter((t) => t >= next.t1 - 1e-6) : ts;
        const rail = rt.map((t) => V(side * (this.outlineX(t, inset) - lean - 0.05), floor + 0.1, S.zAt(t, 1)));
        this.balustrade(rail);
        if (D.shields && k === 0) this.shieldsAlong(rt.map((t) => V(side * (this.outlineX(t, inset) - lean * 0.2), floor - 1.3, S.zAt(t, 1))), side);
        // square windows / ports in the castle side
        if (tier.h > 2 && k < 2) {
          for (let w = 0; w < 2; w++) {
            const t = tier.t0 + (tier.t1 - tier.t0) * (0.35 + w * 0.3);
            const x = side * (this.outlineX(t, inset) - lean * 0.5 + 0.035);
            const y = floor - tier.h * 0.5 - 0.2;
            const g = new THREE.PlaneGeometry(0.7, 0.9);
            g.rotateY(side * Math.PI / 2);
            g.translate(x, y, S.zAt(t, 1));
            this.parts.add('window', g, 0);
          }
        }
      }
      // floor
      const fl: THREE.Vector3[] = [];
      for (const t of ts) fl.push(V(this.outlineX(t, inset) - lean, floor, S.zAt(t, 1)));
      for (let i = ts.length - 1; i >= 0; i--) fl.push(V(-(this.outlineX(ts[i], inset) - lean), floor, S.zAt(ts[i], 1)));
      const floorGeo = fan(fl, true, 0.2);
      const fp = floorGeo.getAttribute('position');
      const fuv = new Float32Array(fp.count * 2);
      for (let q = 0; q < fp.count; q++) {
        fuv[q * 2] = fp.getZ(q) / 9;
        fuv[q * 2 + 1] = fp.getX(q) / 4.6;
      }
      floorGeo.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
      this.parts.add('deck', floorGeo, 1);
      // front bulkhead at t1 facing forward, with a door and windows
      {
        const t = tier.t1;
        const z = S.zAt(t, 1) + 0.02;
        const xw = this.outlineX(t, inset) - lean * 0.5;
        const y0 = k === 0 ? S.deckY(t) : floorPrev;
        const g = boxAt(xw * 2, floor - y0 + 0.15, 0.2, 0, (floor + y0) / 2 + 0.07, z - 0.1);
        this.parts.add('hull', g, 1);
        // door
        this.parts.add('dark', boxAt(1.0, 1.9, 0.05, 0, y0 + 0.95, z + 0.01), 0);
        this.parts.add('gold', boxAt(1.2, 0.12, 0.06, 0, y0 + 1.95, z + 0.02), 0);
        for (const sx of [-1, 1]) {
          const wg = new THREE.PlaneGeometry(0.7, 0.8);
          wg.translate(sx * xw * 0.55, y0 + (floor - y0) * 0.55, z + 0.03);
          this.parts.add('window', wg, 0);
          // ladder to the castle deck
          if (k === 0) {
            for (let st = 0; st < 7; st++) {
              const sy = y0 + (st + 0.5) * ((floor - y0) / 7);
              this.parts.add('fitting', boxAt(0.9, 0.08, 0.28, sx * xw * 0.25, sy, z + 0.25 + (6 - st) * 0.28), 0);
            }
          }
        }
        // balustrade along the front edge
        const front = [V(-(xw - lean * 0.5), floor + 0.1, z - 0.05), V(xw - lean * 0.5, floor + 0.1, z - 0.05)];
        if (!tiers[k + 1] || tiers[k + 1].t1 < tier.t1 - 0.01) this.balustrade(front);
      }
      floorPrev = floor;
      inset += 0.28;
      this.aftTop = floor;
    });
    // stern face with galleries and windows
    {
      const t = 0.0;
      const z = S.zAt(t, 1) - 0.02;
      const w0 = this.outlineX(t, 0.02);
      const yb = S.sheerY(t) - 0.05;
      const yTop = this.aftTop + 0.15;
      const pts = [V(-w0, yb, z), V(w0, yb, z), V(w0 - 0.12 * 0 - (tiers.length - 1) * 0.28 - 0.12, yTop, z), V(-(w0 - (tiers.length - 1) * 0.28 - 0.12), yTop, z)];
      const g = fan(pts, false, 0.26);
      const gp = g.getAttribute('position');
      const guv = new Float32Array(gp.count * 2);
      for (let q = 0; q < gp.count; q++) {
        guv[q * 2] = gp.getX(q) / 7.5;
        guv[q * 2 + 1] = gp.getY(q) / 3.9;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(guv, 2));
      const gn = g.getAttribute('normal');
      if (gn.getZ(0) > 0) {
        const p = gp.array as Float32Array;
        for (let k2 = 0; k2 < p.length; k2 += 9)
          for (let q = 0; q < 3; q++) {
            const tmp = p[k2 + 3 + q];
            p[k2 + 3 + q] = p[k2 + 6 + q];
            p[k2 + 6 + q] = tmp;
          }
        g.computeVertexNormals();
      }
      this.parts.add('hull', g, 1);
      // rows of stern windows with gilt frames, one row per tier
      let yRow = S.sheerY(0) + 0.1;
      tiers.forEach((tier, k) => {
        const floor = k === 0 ? Math.max(S.deckY(tier.t1) + tier.h, S.sheerY(0) + 0.9) : yRow + tier.h;
        const rowY = (k === 0 ? S.sheerY(0) : yRow) + (floor - (k === 0 ? S.sheerY(0) : yRow)) * 0.5;
        const wIn = w0 - k * 0.28 - 0.5;
        const count = Math.max(2, Math.floor(wIn / 1.1));
        for (let i = 0; i < count; i++) {
          const x = -wIn + ((i + 0.5) * 2 * wIn) / count;
          const wg = new THREE.PlaneGeometry(0.85, 1.15);
          wg.rotateY(Math.PI);
          wg.translate(x, rowY, z - 0.03);
          this.parts.add('window', wg, 1);
          this.parts.add('gold', boxAt(0.12, 1.35, 0.1, x - 0.5, rowY, z - 0.05), 0);
        }
        this.parts.add('gold', boxAt(wIn * 2 + 0.6, 0.12, 0.12, 0, rowY + 0.72, z - 0.06), 0);
        this.parts.add('gold', boxAt(wIn * 2 + 0.6, 0.12, 0.12, 0, rowY - 0.72, z - 0.06), 0);
        // gallery balcony in front of the first row
        if (gallery && k === 0) {
          const by = rowY - 0.85;
          this.parts.add('wood', boxAt(wIn * 2 + 1.0, 0.18, 1.1, 0, by, z - 0.55), 1);
          this.balustrade([V(-(wIn + 0.4), by + 0.09, z - 1.05), V(wIn + 0.4, by + 0.09, z - 1.05)], 0.95, 0.36, true, 0);
          for (const sx of [-1, 1]) this.balustrade([V(sx * (wIn + 0.45), by + 0.09, z - 1.05), V(sx * (wIn + 0.45), by + 0.09, z - 0.1)], 0.95, 0.36, true, 0);
          // carved brackets under the gallery
          for (let i = 0; i <= 4; i++) {
            const x = -wIn + (i * 2 * wIn) / 4;
            this.parts.add('gold', beam(V(x, by - 0.1, z - 1.0), V(x, by - 1.0, z - 0.08), 0.14, 0.14), 0);
          }
        }
        yRow = floor;
      });
      // heraldic panel between the window rows and the counter
      const panel = new THREE.PlaneGeometry(Math.min(3.2, w0), Math.min(2.4, w0 * 0.7));
      panel.rotateY(Math.PI);
      panel.translate(0, S.sheerY(0) - 0.9, z - 0.04);
      this.parts.add('shield', panel, 0);
    }
    // stern lanterns on the taffrail
    const zl = S.zAt(0, 1) + 0.25;
    const topW = this.outlineX(0, 0.02 + (tiers.length - 1) * 0.28) - 0.25;
    const yl = this.aftTop + 1.2;
    if (D.lanterns >= 1) this.lanterns.push(V(0, yl + 0.6, zl));
    if (D.lanterns >= 3) {
      this.lanterns.push(V(-topW + 0.4, yl, zl + 0.4));
      this.lanterns.push(V(topW - 0.4, yl, zl + 0.4));
    }
    // ensign staff
    this.ensign = { pos: V(0, this.aftTop + 1.0, zl + 1.2), size: Math.max(3, this.D.hull.L * 0.1) };
  }

  private cogAft(tier: CastleTier) {
    const S = this.shape;
    const t1 = tier.t1;
    const z0 = S.zAt(0, 1) - 0.5;
    const z1 = S.zAt(t1, 1);
    const hw = Math.max(this.outlineX(t1 * 0.5), this.outlineX(t1)) + 0.12;
    const floor = Math.max(S.sheerY(0) + 0.5, S.deckY(t1) + tier.h);
    // posts supporting the castle
    for (const sx of [-1, 1]) for (const z of [z1 - 0.1]) this.parts.add('wood', boxAt(0.3, floor - S.deckY(t1) + 0.2, 0.3, sx * (hw - 0.3), (floor + S.deckY(t1)) / 2, z), 1);
    // platform
    this.parts.add('deck', boxAt(hw * 2, 0.25, z1 - z0, 0, floor - 0.12, (z0 + z1) / 2), 2);
    // apron boards below the platform and a crenellated parapet around it
    const para = 1.15;
    const pieces: [THREE.Vector3, THREE.Vector3][] = [
      [V(-hw, 0, z1), V(-hw, 0, z0)],
      [V(-hw, 0, z0), V(hw, 0, z0)],
      [V(hw, 0, z0), V(hw, 0, z1)],
    ];
    for (const [a, b] of pieces) {
      const d = b.clone().sub(a);
      const len = d.length();
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const ang = Math.atan2(d.x, d.z);
      this.parts.add('band', (() => {
        const g = new THREE.PlaneGeometry(len, para + 1.3);
        const out = V(d.z, 0, -d.x).normalize();
        g.applyMatrix4(new THREE.Matrix4().makeBasis(d.clone().normalize().multiplyScalar(-1), V(0, 1, 0), out.clone().multiplyScalar(-1)));
        g.translate(mid.x - out.x * 0.12, floor - 1.3 + (para + 1.3) / 2, mid.z - out.z * 0.12);
        const uv = g.getAttribute('uv');
        for (let q = 0; q < uv.count; q++) uv.setX(q, (uv.getX(q) * len) / 11);
        return g;
      })(), 1);
      this.parts.add('wood', beam(V(a.x, floor + para, a.z), V(b.x, floor + para, b.z), 0.3, 0.2), 1);
      const n = Math.max(2, Math.round(len / 1.1));
      for (let i = 0; i < n; i++) {
        const p = a.clone().lerp(b, (i + 0.5) / n);
        this.parts.add('wood', boxAt(0.45, 0.5, 0.3, p.x, floor + para + 0.35, p.z, ang), 0);
      }
    }
    this.aftTop = floor;
    const zl = z0 + 0.3;
    this.lanterns.push(V(0, floor + para + 1.0, zl));
    this.ensign = { pos: V(0, floor + para, zl + 0.6), size: Math.max(2.5, this.D.hull.L * 0.1) };
    if (this.D.shields) this.shieldsAlong([V(-hw, floor - 0.2, z1), V(-hw, floor - 0.2, z0)], -1, 1.2);
  }

  private carrackFore(t0: number, h: number, overhang: number, tier2?: number) {
    const S = this.shape;
    const n = 12;
    const ts: number[] = [];
    for (let i = 0; i <= n; i++) ts.push(t0 + ((0.985 - t0) * i) / n);
    const floor = Math.max(S.deckY(t0) + h, S.sheerY(0.985) + 0.6);
    const apexZ = S.zAt(0.985, 1) + overhang;
    const lean = 0.1;
    // outline: starboard hull points then the apex, then port
    const star = ts.map((t) => V(this.outlineX(t, 0.02), 0, S.zAt(t, 1)));
    const apex = V(0, 0, apexZ);
    for (const side of [-1, 1]) {
      const path = star.map((p) => V(side * p.x, 0, p.z));
      path.push(V(0, 0, apex.z));
      const bottom = ts.map((t) => S.sheerY(t) - 0.05);
      bottom.push(floor - 1.7);
      const top = path.map(() => floor + 0.15);
      this.parts.add('hull', wall(path, bottom, top, lean, (i) => {
        const a = path[Math.max(0, i - 1)];
        const b = path[Math.min(path.length - 1, i + 1)];
        const d = b.clone().sub(a);
        const o = V(d.z, 0, -d.x).normalize();
        return o.x * side < 0 ? o.multiplyScalar(-1) : o;
      }, 0.26), 1);
      const bandP = path.map((p) => V(p.x + side * 0.03, 0, p.z));
      this.parts.add('band', wall(bandP, path.map(() => floor - 1.25), path.map(() => floor - 0.2), 0.02, () => V(side, 0, 0.3).normalize(), 1 / 11, true), 1);
      this.parts.add('gold', sweep(bandP.map((p) => V(p.x + side * 0.02, floor - 0.17, p.z)), [[0, -0.05], [0.08, -0.04], [0.08, 0.04], [0, 0.05]], () => V(side, 0, 0), false), 0);
      const rail = path.map((p) => V(p.x - side * (lean + 0.05), floor + 0.1, p.z - (p.z >= apexZ - 0.01 ? 0.3 : 0)));
      this.balustrade(rail);
      if (this.D.shields) this.shieldsAlong(path.slice(0, -1).map((p) => V(p.x, floor - 1.4, p.z)), side, 1.3);
    }
    // underside of the overhang
    const last = star[star.length - 1];
    const ub = S.sheerY(0.985) - 0.05;
    const under = [V(-last.x, ub, last.z), V(last.x, ub, last.z), V(0, floor - 1.7, apexZ)];
    this.parts.add('wood', fan(under, false), 1);
    // floor
    const fl = [...star.map((p) => V(p.x - lean, floor, p.z)), V(0, floor, apexZ - 0.2), ...[...star].reverse().map((p) => V(-(p.x - lean), floor, p.z))];
    const fg = fan(fl, true);
    const fpos = fg.getAttribute('position');
    const fuv = new Float32Array(fpos.count * 2);
    for (let q = 0; q < fpos.count; q++) {
      fuv[q * 2] = fpos.getZ(q) / 9;
      fuv[q * 2 + 1] = fpos.getX(q) / 4.6;
    }
    fg.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
    this.parts.add('deck', fg, 1);
    // aft bulkhead facing the waist
    {
      const z = S.zAt(t0, 1) - 0.02;
      const xw = this.outlineX(t0, 0.02) - lean * 0.5;
      const y0 = S.deckY(t0);
      this.parts.add('hull', boxAt(xw * 2, floor - y0 + 0.15, 0.2, 0, (floor + y0) / 2 + 0.07, z + 0.1), 1);
      this.parts.add('dark', boxAt(0.95, 1.8, 0.05, 0, y0 + 0.9, z - 0.01), 0);
      this.balustrade([V(-(xw - 0.1), floor + 0.1, z + 0.05), V(xw - 0.1, floor + 0.1, z + 0.05)]);
      for (let st = 0; st < 7; st++) {
        const sy = y0 + (st + 0.5) * ((floor - y0) / 7);
        this.parts.add('fitting', boxAt(0.9, 0.08, 0.28, xw * 0.55, sy, z - 0.25 - (6 - st) * 0.28), 0);
      }
    }
    // a raised second platform toward the bow
    let top = floor;
    if (tier2) {
      const t2 = t0 + (0.985 - t0) * 0.45;
      const f2 = floor + tier2;
      const s2 = star.filter((p) => p.z >= S.zAt(t2, 1));
      const inset = 0.35;
      for (const side of [-1, 1]) {
        const path = s2.map((p) => V(side * (p.x - inset), 0, p.z));
        path.push(V(0, 0, apexZ - 0.6));
        this.parts.add('hull', wall(path, path.map(() => floor), path.map(() => f2 + 0.15), 0.08, () => V(side, 0, 0.2).normalize(), 0.26), 1);
        this.balustrade(path.map((p) => V(p.x - side * 0.15, f2 + 0.1, p.z)));
      }
      const fl2 = [...s2.map((p) => V(p.x - inset - 0.08, f2, p.z)), V(0, f2, apexZ - 0.7), ...[...s2].reverse().map((p) => V(-(p.x - inset - 0.08), f2, p.z))];
      this.parts.add('deck', fan(fl2, true, 0.12), 1);
      const z2 = S.zAt(t2, 1);
      const xw2 = this.outlineX(t2, 0.02) - inset;
      this.parts.add('hull', boxAt(xw2 * 2, tier2 + 0.15, 0.2, 0, floor + tier2 / 2, z2), 1);
      this.balustrade([V(-xw2, f2 + 0.1, z2), V(xw2, f2 + 0.1, z2)]);
      top = f2;
    }
    this.foreTop = top;
    // beakhead ornament: a gilded scroll under the apex
    if (this.D.beak) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 1.6;
        const r = 1.1 * (1 - i / 34);
        pts.push(V(0, floor - 1.6 - Math.sin(a) * r, apexZ - 0.4 + Math.cos(a) * r * 0.9 - 0.4));
      }
      this.parts.add('gold', sweep(pts, [[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]], () => V(1, 0, 0)), 0);
      // lion head: layered spheres
      const hz = apexZ + 0.15;
      const hy = floor - 1.05;
      const head = new THREE.SphereGeometry(0.55, 12, 8);
      head.scale(0.9, 1, 1.2);
      head.translate(0, hy, hz);
      this.parts.add('gold', head, 0);
      const mane = new THREE.TorusGeometry(0.6, 0.18, 6, 14);
      mane.translate(0, hy, hz - 0.2);
      this.parts.add('gold', mane, 0);
      const snout = new THREE.SphereGeometry(0.28, 10, 6);
      snout.translate(0, hy - 0.12, hz + 0.6);
      this.parts.add('gold', snout, 0);
    }
  }

  private cogFore(t0: number, h: number, overhang: number) {
    const S = this.shape;
    const floor = Math.max(S.sheerY(0.98) + 0.4, S.deckY(t0) + h);
    const z0 = S.zAt(t0, 1);
    const z1 = S.zAt(0.985, 1) + overhang;
    const hw = this.outlineX(t0) + 0.1;
    const tri = [V(-hw, floor, z0), V(hw, floor, z0), V(0, floor, z1)];
    this.parts.add('deck', fan(tri, true), 2);
    this.parts.add('wood', fan(tri.map((p) => p.clone().add(V(0, -0.25, 0))), false), 1);
    for (const [a, b] of [
      [tri[0], tri[2]],
      [tri[2], tri[1]],
    ] as const) {
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a).normalize();
      const out = V(d.z, 0, -d.x);
      if (out.x * mid.x < 0 || (Math.abs(mid.x) < 0.01 && out.z < 0)) out.multiplyScalar(-1);
      const g = new THREE.PlaneGeometry(len, 2.1);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(d.clone().multiplyScalar(-1), V(0, 1, 0), out.clone().multiplyScalar(-1)));
      g.translate(mid.x, floor + 0.1, mid.z);
      const uv = g.getAttribute('uv');
      for (let q = 0; q < uv.count; q++) uv.setX(q, (uv.getX(q) * len) / 11);
      this.parts.add('band', g, 1);
      this.parts.add('wood', beam(V(a.x, floor + 1.15, a.z), V(b.x, floor + 1.15, b.z), 0.28, 0.2), 1);
      const n = Math.max(2, Math.round(len / 1.1));
      for (let i = 0; i < n; i++) {
        const p = a.clone().lerp(b, (i + 0.5) / n);
        this.parts.add('wood', boxAt(0.45, 0.5, 0.3, p.x, floor + 1.5, p.z, Math.atan2(d.x, d.z)), 0);
      }
    }
    for (const sx of [-1, 1]) this.parts.add('wood', boxAt(0.28, floor - S.deckY(t0), 0.28, sx * (hw - 0.3), (floor + S.deckY(t0)) / 2, z0 + 0.2), 1);
    this.foreTop = floor;
  }

  private awning() {
    const S = this.shape;
    const t0 = 0.02;
    const t1 = 0.2;
    const rows: THREE.Vector3[][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = t0 + ((t1 - t0) * i) / 10;
      const hw = S.topX(t) - 0.1;
      const y = S.sheerY(t) + 0.2;
      const z = S.zAt(t, 1);
      const r: THREE.Vector3[] = [];
      for (let j = 0; j <= 10; j++) {
        const a = (j / 10) * Math.PI;
        r.push(V(-Math.cos(a) * hw, y + Math.sin(a) * 1.7, z));
      }
      rows.push(r);
    }
    this.parts.add('canvas' as MatKey, surface(rows, (i, j) => [j / 10, i / 10], null, false), 1);
    for (const t of [t0, t1])
      for (const sx of [-1, 1]) {
        const hw = S.topX(t) - 0.1;
        this.parts.add('wood', tube(V(sx * hw, S.sheerY(t) - 0.4, S.zAt(t, 1)), V(sx * hw, S.sheerY(t) + 0.2, S.zAt(t, 1)), 0.06, 0.06, 5), 0);
      }
    this.aftTop = S.sheerY(0.05) + 1.7;
    this.lanterns.push(V(0, S.sheerY(0.01) + 2.4, S.zAt(0.01, 1) - 0.4));
    this.ensign = { pos: V(0, S.sheerY(0.01) + 0.6, S.zAt(0.01, 1) - 0.8), size: 2.4 };
  }

  // -------------------------------------------------------------- deck furniture
  private deckGear() {
    const S = this.shape;
    const D = this.D;
    const L = D.hull.L;
    const deckAt = (t: number) => S.deckY(t);
    const zOf = (t: number) => S.zAt(t, S.sFor(t, S.deckY(t)));
    // hatch gratings amidships
    for (const t of [0.4, 0.62]) {
      if (D.oars) continue;
      const y = deckAt(t);
      const z = zOf(t);
      const w = Math.min(3.2, S.maxHB(t) * 0.8);
      this.parts.add('fitting', boxAt(w, 0.3, 2.6, 0, y + 0.15, z), 1);
      for (let i = -3; i <= 3; i++) this.parts.add('dark', boxAt(0.06, 0.05, 2.4, (i * w) / 8, y + 0.32, z), 0);
      for (let i = -2; i <= 2; i++) this.parts.add('dark', boxAt(w - 0.2, 0.05, 0.06, 0, y + 0.33, z + i * 0.5), 0);
    }
    // capstan
    if (!D.oars && L > 30) {
      const t = 0.34;
      const y = deckAt(t);
      const z = zOf(t);
      this.parts.add('fitting', lathe([[0.55, 0], [0.5, 0.2], [0.35, 0.3], [0.32, 0.9], [0.45, 1.0], [0.45, 1.15], [0.05, 1.2]], 10).translate(0, y, z), 0);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI;
        this.parts.add('fitting', beam(V(Math.cos(a) * 1.6, y + 1.05, z + Math.sin(a) * 1.6), V(-Math.cos(a) * 1.6, y + 1.05, z - Math.sin(a) * 1.6), 0.09, 0.09), 0);
      }
    }
    // barrels and crates
    const barrel = lathe([[0.3, 0], [0.36, 0.2], [0.39, 0.45], [0.36, 0.7], [0.3, 0.9], [0.0, 0.9]], 10);
    const hoop = new THREE.CylinderGeometry(0.385, 0.385, 0.05, 10, 1, true);
    const spots: [number, number][] = D.oars ? [] : [
      [0.45, -0.55],
      [0.47, -0.45],
      [0.56, 0.55],
      [0.58, 0.45],
      [0.7, -0.5],
      [0.3, 0.5],
    ];
    spots.forEach(([t, xf], i) => {
      const y = deckAt(t);
      const x = xf * (S.maxHB(t) - 0.6);
      const z = zOf(t) + (i % 2) * 0.8;
      if (i % 3 === 2) {
        this.parts.add('fitting', boxAt(0.9, 0.8, 0.9, x, y + 0.4, z, i * 0.3), 0, new THREE.Color(0.9, 0.85, 0.8));
        this.parts.add('fitting', boxAt(0.7, 0.6, 0.7, x + 0.1, y + 1.1, z, i * 0.7), 0, new THREE.Color(0.8, 0.75, 0.7));
      } else {
        this.parts.add('fitting', barrel.clone().translate(x, y, z), 0, new THREE.Color(0.75, 0.62, 0.5));
        for (const hy of [0.15, 0.75]) this.parts.add('iron', hoop.clone().translate(x, y + hy, z), 0);
      }
    });
    // coiled ropes
    const coil = new THREE.TorusGeometry(0.35, 0.09, 5, 14).rotateX(Math.PI / 2);
    for (const t of [0.28, 0.52, 0.74]) {
      for (const sx of [-1, 1]) {
        const y = deckAt(t) + 0.09;
        this.parts.add('rope', coil.clone().translate(sx * (S.maxHB(t) - 0.9), y, zOf(t)), 0);
        this.parts.add('rope', coil.clone().scale(0.8, 1, 0.8).translate(sx * (S.maxHB(t) - 0.9), y + 0.14, zOf(t)), 0);
      }
    }
    // ship's boat on chocks
    if (D.boat) {
      const bs = new HullShape({ L: Math.min(9, L * 0.19), B: Math.min(2.6, L * 0.055), draft: 0.5, depth: 0.45, bulwark: 0.25, sheerAft: 0.25, sheerFwd: 0.35, transom: 0.45, bowRake: 0.5, sternRake: 0.2, tumble: 0, sternFine: 0.6, clinker: true });
      const t = 0.56;
      const y = deckAt(t) + 0.55;
      const z = zOf(t);
      for (const side of [-1, 1]) {
        const rows: THREE.Vector3[][] = [];
        for (let i = 0; i <= 16; i++) {
          const tt = (1 - Math.cos((Math.PI * i) / 16)) / 2;
          const r: THREE.Vector3[] = [];
          for (let j = 0; j <= 6; j++) r.push(bs.point(tt, j / 6, side).add(V(0.6, y, z)));
          rows.push(r);
        }
        this.parts.add('fitting', surface(rows, (i, j) => [rows[i][j].z / 3, j / 3], null, side > 0), 0, new THREE.Color(0.8, 0.7, 0.6));
      }
      for (let k = 0; k < 3; k++) this.parts.add('fitting', boxAt(1.6, 0.08, 0.2, 0.6, y + 0.3, z - 2 + k * 2), 0);
      for (const dz of [-1.6, 1.6]) this.parts.add('wood', boxAt(1.8, 0.4, 0.3, 0.6, y - 0.4, z + dz), 0);
    }
    // crew standing points (for figures)
    for (let i = 0; i < 12; i++) {
      const t = 0.22 + (i / 12) * 0.6;
      this.crew.push(V(((i % 3) - 1) * S.maxHB(t) * 0.4, deckAt(t), zOf(t)));
    }
  }

  // -------------------------------------------------------------- masts, yards, sails and rigging
  private masts() {
    const S = this.shape;
    const D = this.D;
    const L = D.hull.L;
    const tops: { z: number; lowerTop: number; head: number; base: number; t: number }[] = [];
    for (const m of D.masts) {
      const t = m.t;
      const base = S.deckY(t) - 0.3;
      const z = S.zAt(t, S.sFor(t, S.deckY(t)));
      const r0 = 0.1 + m.h * 0.012;
      const lowerTop = base + m.h * (m.lateen ? 0.78 : 0.6);
      const head = base + m.h;
      // lower mast with iron bands
      this.parts.add('wood', lathe([[r0, 0], [r0, 0.4], [r0 * 0.96, 2], [r0 * 0.75, lowerTop - base + 0.8], [0.0001, lowerTop - base + 0.85]], 10).translate(0, base, z), 2);
      for (let y = base + 1.4; y < lowerTop - 1; y += 1.7) this.parts.add('iron', new THREE.CylinderGeometry(r0 * 1.06, r0 * 1.06, 0.14, 10, 1, true).translate(0, y, z), 0);
      // mast coat / partners on deck
      this.parts.add('wood', lathe([[r0 * 1.8, 0], [r0 * 1.5, 0.25], [r0, 0.45]], 10).translate(0, S.deckY(t), z), 0);
      if (m.top) {
        // fighting top: round platform with a painted rim
        const rt = 0.75 + m.h * 0.035;
        const ty = lowerTop - 0.15;
        this.parts.add('wood', new THREE.CylinderGeometry(rt, rt * 0.7, 0.3, 14).translate(0, ty, z), 1);
        this.parts.add('wood', new THREE.ConeGeometry(rt * 0.7, 1.2, 12, 1, true).rotateX(Math.PI).translate(0, ty - 0.75, z), 0);
        const rim = new THREE.CylinderGeometry(rt, rt * 0.98, 0.95, 16, 1, true);
        const uv = rim.getAttribute('uv');
        for (let q = 0; q < uv.count; q++) uv.setX(q, uv.getX(q) * ((rt * 2 * Math.PI) / 11));
        rim.translate(0, ty + 0.6, z);
        this.parts.add('band', rim, 1);
        this.parts.add('gold', new THREE.TorusGeometry(rt, 0.06, 5, 20).rotateX(Math.PI / 2).translate(0, ty + 1.08, z), 0);
        this.parts.add('gold', new THREE.TorusGeometry(rt * 0.99, 0.05, 5, 20).rotateX(Math.PI / 2).translate(0, ty + 0.14, z), 0);
      }
      // topmast and topgallant
      let tmTop = lowerTop;
      if (!m.lateen) {
        tmTop = base + m.h * 0.9;
        this.parts.add('wood', lathe([[r0 * 0.6, 0], [r0 * 0.5, tmTop - lowerTop + 1.5], [0.0001, tmTop - lowerTop + 1.55]], 8).translate(0, lowerTop - 1.5, z + r0 * 1.2), 2);
        this.parts.add('wood', lathe([[r0 * 0.32, 0], [r0 * 0.2, head - tmTop + 1], [0.0001, head - tmTop + 1.02]], 6).translate(0, tmTop - 1, z + r0 * 1.2), 1);
        if (m.squares >= 3) this.parts.add('wood', new THREE.CylinderGeometry(0.55, 0.4, 0.2, 10).translate(0, tmTop - 0.2, z + r0 * 1.2), 0);
      } else {
        this.parts.add('wood', lathe([[r0 * 0.5, 0], [r0 * 0.3, head - lowerTop + 0.8], [0.0001, head - lowerTop + 0.85]], 8).translate(0, lowerTop - 0.8, z), 1);
      }
      // truck and pennant
      this.parts.add('wood', new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8).translate(0, head + 0.02, z + (m.lateen ? 0 : r0 * 1.2)), 0);
      this.pennants.push({ geo: pennantGeometry(Math.max(4, m.h * 0.34), Math.max(0.6, m.h * 0.026), m.h > 20), pos: V(0, head - 0.4, z + (m.lateen ? 0 : r0 * 1.2)), rotY: -Math.PI / 2 });
      tops.push({ z, lowerTop, head, base, t });

      const mz = z + r0 + 0.25;
      if (!m.lateen && m.squares > 0) {
        // square sails on yards: course, topsail, topgallant
        const courseYard = lowerTop - 1.1;
        const topYard = base + m.h * 0.84;
        const tgYard = base + m.h * 0.965;
        const yards = [
          { y: courseYard, w: m.yard, bottom: S.deckY(t) + (t > 0.7 ? 3.2 : 2.6), kind: 'course' as SailKind },
          { y: topYard, w: m.yard * 0.66, bottom: lowerTop + 0.3, kind: 'top' as SailKind },
          { y: tgYard, w: m.yard * 0.4, bottom: topYard + 0.15, kind: 'top' as SailKind },
        ].slice(0, m.squares);
        yards.forEach((yd, k) => {
          const zz = mz + (k > 0 ? r0 * 1.2 : 0);
          // yard: thicker in the middle
          const yg = lathe([[0.02, -yd.w / 2 - 0.3], [0.11 + yd.w * 0.004, -yd.w / 2], [0.16 + yd.w * 0.008, 0], [0.11 + yd.w * 0.004, yd.w / 2], [0.02, yd.w / 2 + 0.3]], 7);
          yg.rotateZ(Math.PI / 2);
          yg.translate(0, yd.y, zz);
          this.parts.add('wood', yg, 2);
          const h = yd.y - yd.bottom - 0.25;
          const botW = k === 0 ? yd.w * 1.02 : yards[k - 1] ? yards[k - 1].w * 0.95 : yd.w * 1.2;
          const belly = h * (k === 0 ? 0.17 : 0.14);
          const g = squareSail(yd.w * 0.95, botW, h, belly, V(0, yd.y - 0.2, zz + 0.15));
          this.sails.push({ geo: g, geoLo: g, kind: yd.kind });
          // rigging: lifts, braces, sheets, footropes, buntlines
          for (const s of [-1, 1]) {
            const arm = V((s * yd.w) / 2, yd.y, zz);
            this.line(arm, V(0, k === 0 ? lowerTop + 0.2 : (k === 1 ? tmTop : head) - 0.3, z), true);
            // braces run aft
            const bt = Math.max(0.02, t - 0.2);
            this.line(arm, V(s * (S.topX(bt) - 0.1), S.sheerY(bt) + 0.3, S.zAt(bt, 1)), true);
            // sheets from the clews
            const clew = V((s * botW) / 2, yd.bottom + 0.1, zz + belly * 0.4);
            if (k === 0) {
              const st = Math.max(0.02, t - 0.12);
              this.line(clew, V(s * (S.topX(st) - 0.05), S.sheerY(st), S.zAt(st, 1)), true);
              // bowline forward
              const ft = Math.min(0.98, t + 0.2);
              this.line(V((s * yd.w) / 2, yd.y - h * 0.5, zz + belly * 0.6), V(s * S.topX(ft) * 0.8, S.sheerY(ft) + 0.3, S.zAt(ft, 1)));
            } else {
              this.line(clew, V((s * yards[k - 1].w) / 2, yards[k - 1].y, zz));
            }
            // footrope
            this.line(V((s * yd.w) / 2, yd.y - 0.1, zz + 0.05), V(0, yd.y - 0.9, zz + 0.05));
          }
          // buntlines over the face of the sail
          for (const f of [-0.28, 0, 0.28]) {
            const x = f * yd.w;
            this.line(V(x, yd.y, zz + 0.2), V(x, yd.bottom + 0.2, zz + belly * 0.55 + 0.15));
          }
        });
      } else if (m.lateen) {
        const cross = base + m.h * 0.72;
        const ang = 0.62;
        const d = V(0, Math.sin(ang), -Math.cos(ang));
        const F = V(0.35, cross, z).addScaledVector(d, -m.yard * 0.36);
        const A = V(0.35, cross, z).addScaledVector(d, m.yard * 0.64);
        F.y = Math.max(F.y, S.deckY(Math.min(0.99, t + 0.08)) + 1.5);
        this.parts.add('wood', tube(F, A, 0.16, 0.08, 7), 2);
        const clewT = Math.max(0.01, t - (m.yard * 0.45) / L);
        const C = V(0.5, S.sheerY(clewT) + 1.8, Math.min(S.zAt(clewT, 1) + 0.5, A.z + 1.5));
        const g = lateenSail(F.clone().add(V(0.15, -0.2, 0)), A.clone().add(V(0.15, -0.25, 0)), C, m.yard * 0.08, 1);
        this.sails.push({ geo: g, geoLo: g, kind: 'lateen' });
        this.line(A, V(0, head - 0.2, z), true);
        this.line(C, V(S.topX(clewT) * 0.9, S.sheerY(clewT), S.zAt(clewT, 1)), true);
        this.line(F, V(0, S.deckY(Math.min(0.99, t + 0.1)) + 0.3, F.z), true);
        // halyard
        this.line(V(0, cross, z), V(0, head - 0.3, z));
      }
    }
    // standing rigging: shrouds with channels, deadeyes and ratlines
    for (const tp of tops) {
      const t = tp.t;
      for (const side of [-1, 1]) {
        const n = tp.head - tp.base > 30 ? 6 : tp.head - tp.base > 18 ? 5 : 3;
        const chT0 = Math.max(0.02, t - (n * 0.85) / L);
        const chT1 = Math.min(0.98, t + 0.4 / L);
        const chY = (tt: number) => S.sheerY(tt) - (D.oars ? 0.1 : 0.9);
        // channel board
        const ca = V(side * (S.topX(chT0) + 0.25), chY(chT0), S.zAt(chT0, 1));
        const cb = V(side * (S.topX(chT1) + 0.25), chY(chT1), S.zAt(chT1, 1));
        if (!D.oars) this.parts.add('wood', beam(ca.clone().add(V(side * 0.2, 0, 0)), cb.clone().add(V(side * 0.2, 0, 0)), 0.75, 0.16), 1);
        const shrouds: [THREE.Vector3, THREE.Vector3][] = [];
        for (let k = 0; k < n; k++) {
          const tt = chT1 - ((chT1 - chT0) * k) / Math.max(1, n - 1);
          const foot = V(side * (S.topX(tt) + (D.oars ? 0.05 : 0.45)), chY(tt) + 0.35, S.zAt(tt, 1));
          const headP = V(side * 0.25, tp.lowerTop - 0.4, tp.z);
          shrouds.push([foot, headP]);
          this.parts.add('rope', tube(foot, headP, 0.045, 0.035, 4), 1);
          // deadeye pair and lanyard
          this.parts.add('dark', new THREE.CylinderGeometry(0.16, 0.16, 0.1, 8).rotateZ(Math.PI / 2).translate(foot.x, foot.y, foot.z), 0);
          this.parts.add('dark', new THREE.CylinderGeometry(0.16, 0.16, 0.1, 8).rotateZ(Math.PI / 2).translate(foot.x, foot.y - 0.5, foot.z), 0);
          this.parts.add('iron', beam(V(foot.x, foot.y - 0.55, foot.z), V(foot.x - side * 0.1, foot.y - 1.3, foot.z), 0.06, 0.06), 0);
        }
        // ratlines
        const h0 = shrouds[0][0].y + 0.6;
        const h1 = tp.lowerTop - 1.6;
        for (let y = h0; y < h1; y += 0.42) {
          const pts = shrouds.map(([a, b]) => {
            const f = (y - a.y) / (b.y - a.y);
            return a.clone().lerp(b, f);
          });
          for (let k = 1; k < pts.length; k++) this.line(pts[k - 1], pts[k]);
        }
        // topmast shrouds to the rim of the top
        if (tp.head - tp.lowerTop > 6) {
          for (let k = 0; k < 3; k++) {
            const rim = V(side * (0.75 + (tp.head - tp.base) * 0.03), tp.lowerTop + 0.1, tp.z - 0.4 + k * 0.4);
            const hd = V(side * 0.12, tp.lowerTop + (tp.head - tp.lowerTop) * 0.7, tp.z + 0.3);
            this.parts.add('rope', tube(rim, hd, 0.03, 0.025, 4), 0);
            this.line(rim, hd, true);
          }
          // backstays from the topmast head to the channels aft
          const bt = Math.max(0.02, t - (n + 3) / L);
          this.parts.add('rope', tube(V(side * 0.12, tp.lowerTop + (tp.head - tp.lowerTop) * 0.72, tp.z), V(side * (S.topX(bt) + 0.4), S.sheerY(bt) - 0.5, S.zAt(bt, 1)), 0.035, 0.03, 4), 1);
        }
      }
    }
    // stays between masts and to the bowsprit
    const sorted = [...tops].sort((a, b) => a.z - b.z);
    const bow = this.bowsprit();
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const next = sorted[i + 1];
      const from = V(0, a.lowerTop - 0.2, a.z + 0.1);
      const to = next ? V(0, S.deckY(next.t) + 1.2, next.z - 0.4) : bow.mid;
      this.parts.add('rope', tube(from, to, 0.07, 0.06, 5), 1);
      const tFrom = V(0, a.lowerTop + (a.head - a.lowerTop) * 0.75, a.z + 0.3);
      const tTo = next ? V(0, next.lowerTop, next.z) : bow.end;
      this.parts.add('rope', tube(tFrom, tTo, 0.045, 0.04, 4), 1);
      this.line(V(0, a.head - 0.3, a.z + 0.3), next ? V(0, next.lowerTop + (next.head - next.lowerTop) * 0.7, next.z) : bow.end, true);
    }
  }

  private bowsprit(): { mid: THREE.Vector3; end: THREE.Vector3 } {
    const S = this.shape;
    const D = this.D;
    const stemTop = S.point(0.995, 1, 0);
    if (!D.bowsprit) return { mid: stemTop.clone().add(V(0, 0.5, 0)), end: stemTop.clone().add(V(0, 0.5, 0)) };
    const bsp = D.bowsprit;
    const start = V(0, S.deckY(0.9) + 0.4, S.zAt(0.9, 1));
    const dir = V(0, Math.sin(bsp.angle), Math.cos(bsp.angle));
    const end = stemTop.clone().add(V(0, 0.3, 0)).addScaledVector(dir, bsp.len);
    this.parts.add('wood', tube(start, end, 0.32, 0.14, 8, true), 2);
    for (let k = 0; k < 3; k++) {
      const p = start.clone().lerp(end, 0.35 + k * 0.06);
      this.parts.add('rope', new THREE.TorusGeometry(0.34, 0.06, 4, 10).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir)).translate(p.x, p.y, p.z), 0);
    }
    const mid = start.clone().lerp(end, 0.5);
    if (bsp.sprit) {
      const yardP = start.clone().lerp(end, 0.82).add(V(0, -0.5, 0));
      const w = bsp.len * 0.5;
      const yg = lathe([[0.02, -w / 2 - 0.2], [0.1, -w / 2], [0.14, 0], [0.1, w / 2], [0.02, w / 2 + 0.2]], 6);
      yg.rotateZ(Math.PI / 2);
      yg.translate(yardP.x, yardP.y, yardP.z);
      this.parts.add('wood', yg, 2);
      const h = Math.min(bsp.len * 0.32, yardP.y - 1.8);
      const g = squareSail(w * 0.95, w * 1.05, h, h * 0.18, yardP.clone().add(V(0, -0.2, 0.15)));
      this.sails.push({ geo: g, geoLo: g, kind: 'sprit' });
      for (const s of [-1, 1]) this.line(V((s * w) / 2, yardP.y - h - 0.1, yardP.z), V(s * S.topX(0.9), S.sheerY(0.9), S.zAt(0.9, 1)), true);
    }
    // bobstay to the stem
    this.parts.add('rope', tube(end.clone().lerp(start, 0.1), S.point(0.99, 0.35, 0), 0.05, 0.05, 4), 1);
    return { mid, end };
  }

  // -------------------------------------------------------------- anchors, catheads
  private fittings() {
    const S = this.shape;
    if (this.D.oars) return;
    for (const side of [-1, 1]) {
      const t = 0.88;
      const x = side * (S.topX(t) + 0.3);
      const top = S.sheerY(t) - 0.4;
      const z = S.zAt(t, 1);
      // cathead
      this.parts.add('wood', beam(V(side * (S.topX(t) - 0.6), top + 0.2, z), V(x + side * 0.9, top + 0.35, z + 0.4), 0.3, 0.3), 1);
      const len = 3.2;
      const ring = V(x + side * 0.6, top - 0.2, z + 0.35);
      const crown = ring.clone().add(V(0, -len, 0));
      this.parts.add('iron', tube(ring, crown, 0.09, 0.09, 6), 0);
      for (const a of [-1, 1]) {
        const tip = crown.clone().add(V(0, 0.9, a * 1.1));
        this.parts.add('iron', tube(crown, tip, 0.08, 0.06, 5), 0);
        this.parts.add('iron', boxAt(0.1, 0.5, 0.35, tip.x, tip.y - 0.1, tip.z - a * 0.1, 0, a * 0.5), 0);
      }
      this.parts.add('wood', beam(ring.clone().add(V(0, -0.3, -0.9)), ring.clone().add(V(0, -0.3, 0.9)), 0.2, 0.2), 0);
      // hawse and cable
      this.line(ring, V(side * (S.topX(0.92) + 0.05), S.sheerY(0.92) - 1.8, S.zAt(0.92, 0.8)));
    }
  }

  private oars() {
    const S = this.shape;
    const D = this.D;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < D.oars; i++) {
      const t = 0.24 + (i / (D.oars - 1)) * 0.52;
      for (const s of [-1, 1]) {
        const px = s * S.topX(t);
        const py = S.sheerY(t) - 0.35;
        const pz = S.zAt(t, 1);
        const len = 7.5;
        const g = new THREE.CylinderGeometry(0.06, 0.07, len, 5);
        g.rotateZ(Math.PI / 2);
        g.translate((s * len) / 2 - s * 1.4, 0, 0);
        g.rotateZ(s * -0.42);
        g.translate(px, py, pz);
        const blade = new THREE.BoxGeometry(1.2, 0.05, 0.38);
        blade.translate(s * (len - 1.9), 0, 0);
        blade.rotateZ(s * -0.42);
        blade.translate(px, py, pz);
        for (const gg of [g, blade]) {
          const p = prep(gg);
          const n = p.getAttribute('position').count;
          const a = new Float32Array(n * 4);
          for (let v = 0; v < n; v++) {
            a[v * 4] = px;
            a[v * 4 + 1] = py;
            a[v * 4 + 2] = pz;
            a[v * 4 + 3] = i * 0.05;
          }
          p.setAttribute('aOar', new THREE.BufferAttribute(a, 4));
          parts.push(p);
        }
        // shields along the rail for raiders
        if (D.shields && i % 1 === 0) {
          const sg = new THREE.CircleGeometry(0.5, 12);
          sg.rotateY((s * Math.PI) / 2);
          sg.translate(px + s * 0.08, S.sheerY(t) - 0.2, pz + 0.4);
          this.parts.add('shield', sg, 0);
        }
      }
    }
    const merged = mergeGeometries(parts)!;
    this.parts.items.push({ key: 'oar', geo: merged, detail: 1 });
  }
}

function buildGeometries(type: string, faction: string): Built {
  const D = designFor(type, faction);
  const key = `${type}:${D.shields ? 's' : 'p'}:${D.hull.clinker ? 'c' : 'k'}`;
  let b = cache.get(key);
  if (!b) {
    b = new ShipGen(D).build();
    cache.set(key, b);
  }
  return b;
}

// ---------------------------------------------------------------- lantern model
let lanternGeo: { glass: THREE.BufferGeometry; frame: THREE.BufferGeometry; gold: THREE.BufferGeometry } | null = null;
function lanternGeometry() {
  if (lanternGeo) return lanternGeo;
  const glass = new THREE.CylinderGeometry(0.34, 0.26, 0.8, 8);
  const frameParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    frameParts.push(prep(beam(V(Math.cos(a) * 0.27, -0.42, Math.sin(a) * 0.27), V(Math.cos(a) * 0.35, 0.42, Math.sin(a) * 0.35), 0.04, 0.04)));
  }
  frameParts.push(prep(new THREE.CylinderGeometry(0.3, 0.2, 0.14, 8).translate(0, -0.46, 0)));
  const gold = mergeGeometries([prep(lathe([[0.4, 0], [0.36, 0.12], [0.22, 0.34], [0.08, 0.52], [0.1, 0.62], [0.001, 0.8]], 8).translate(0, 0.42, 0)), prep(new THREE.SphereGeometry(0.08, 6, 4).translate(0, 1.24, 0)), prep(lathe([[0.001, 0], [0.12, 0.1], [0.05, 0.3], [0.001, 0.36]], 6).translate(0, -0.9, 0))])!;
  lanternGeo = { glass: prep(glass), frame: mergeGeometries(frameParts)!, gold };
  return lanternGeo;
}

// ---------------------------------------------------------------- public API

export interface ShipModel {
  root: THREE.Object3D;
  hi: THREE.Group;
  mid: THREE.Group;
  lo: THREE.Group;
  lod: THREE.LOD;
  sails: THREE.MeshStandardMaterial[];
  params: ShipParams & { beam: number };
  lanterns: THREE.Object3D[];
  length: number;
  deckHeight: number;
  type: string;
  faction: string;
  crewSpots: THREE.Vector3[];
}

/** Build a ship model with three LODs. Geometry is shared between ships of the same class. */
export function buildShip(type: string, faction: string): ShipModel {
  const m = shipMaterials();
  const fm = factionMats(faction);
  const g = buildGeometries(type, faction);
  const matFor = (k: MatKey): THREE.Material => (k === 'band' ? fm.band : k === 'shield' ? fm.shield : k === 'canvas' ? fm.canvas : (m as unknown as Record<string, THREE.Material>)[k]);
  const groups = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
  g.levels.forEach((lvl, li) => {
    for (const [k, geo] of lvl) {
      const mesh = new THREE.Mesh(geo, matFor(k));
      mesh.castShadow = li < 2 && k !== 'window' && k !== 'glass';
      mesh.receiveShadow = li === 0 && (k === 'deck' || k === 'hull');
      groups[li].add(mesh);
    }
  });
  // rigging lines (close and medium LODs)
  groups[0].add(new THREE.LineSegments(g.lines[0], m.ropeLine));
  groups[1].add(new THREE.LineSegments(g.lines[1], m.ropeLine));
  // sails: one material per sail so each ship can fill its sails independently
  const sails: THREE.MeshStandardMaterial[] = [];
  for (const s of g.sails) {
    const mat = makeSailMaterial(faction, s.kind);
    sails.push(mat);
    const hi = new THREE.Mesh(s.geo, mat);
    hi.castShadow = true;
    groups[0].add(hi);
    groups[1].add(new THREE.Mesh(s.geo, mat));
    groups[2].add(new THREE.Mesh(s.geoLo, mat));
  }
  // pennants and ensign
  for (const p of g.pennants) {
    for (const li of [0, 1]) {
      const mesh = new THREE.Mesh(p.geo, fm.pennant);
      mesh.position.copy(p.pos);
      mesh.rotation.y = p.rotY;
      groups[li].add(mesh);
    }
  }
  if (g.ensign) {
    const flagMat = makeFlagMaterial(faction);
    const sz = g.ensign.size;
    const fg = new THREE.PlaneGeometry(sz * 1.5, sz, 12, 4);
    fg.translate(sz * 0.75, 0, 0);
    for (const li of [0, 1]) {
      const mesh = new THREE.Mesh(fg, flagMat);
      mesh.position.set(g.ensign.pos.x, g.ensign.pos.y + sz * 1.3, g.ensign.pos.z);
      mesh.rotation.y = Math.PI / 2;
      groups[li].add(mesh);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, sz * 2.0, 6), m.wood);
      pole.position.set(g.ensign.pos.x, g.ensign.pos.y + sz * 0.9, g.ensign.pos.z);
      groups[li].add(pole);
    }
  }
  // lanterns
  const lg = lanternGeometry();
  const lanterns: THREE.Object3D[] = [];
  g.lanterns.forEach((lp, i) => {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(lg.glass, m.glass), new THREE.Mesh(lg.frame, m.dark), new THREE.Mesh(lg.gold, m.gold));
    grp.position.copy(lp);
    grp.scale.setScalar(i === 0 ? 1.35 : 1.0);
    groups[0].add(grp);
    lanterns.push(grp);
    const simple = new THREE.Mesh(lg.glass, m.glass);
    simple.position.copy(lp);
    groups[1].add(simple);
  });
  const lod = new THREE.LOD();
  lod.addLevel(groups[0], 0);
  lod.addLevel(groups[1], 170);
  lod.addLevel(groups[2], 650);
  const root = new THREE.Object3D();
  root.add(lod);
  const params = paramsFor(type, faction);
  return { root, hi: groups[0], mid: groups[1], lo: groups[2], lod, sails, params, lanterns, length: params.length, deckHeight: g.deckH, type, faction, crewSpots: g.crew };
}

export function disposeShipCaches() {
  for (const b of cache.values()) {
    for (const lvl of b.levels) for (const [, geo] of lvl) geo.dispose();
    for (const l of b.lines) l.dispose();
    for (const s of b.sails) s.geo.dispose();
    for (const p of b.pennants) p.geo.dispose();
  }
  cache.clear();
}

/** Exposed for tests and QA tooling. */
export function shipGeometriesForTest(type: string, faction: string) {
  return buildGeometries(type, faction);
}

/** Closed waterline outline of a hull (local x,z), used for the foam collar around ships. */
export function waterlineOutline(type: string, faction: string): { x: number; z: number; bow: number }[] {
  const D = designFor(type, faction);
  const S = new HullShape(D.hull);
  const star: { x: number; z: number; bow: number }[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = 0.005 + (i / 28) * 0.99;
    const s = Math.min(1, Math.max(0, S.sFor(t, 0.05)));
    const p = S.point(t, s, 1);
    star.push({ x: p.x, z: p.z, bow: Math.max(0, (t - 0.6) / 0.4) });
  }
  const port = [...star].reverse().map((p) => ({ x: -p.x, z: p.z, bow: p.bow }));
  return [...star, ...port];
}
