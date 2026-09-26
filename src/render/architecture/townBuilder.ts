import * as THREE from 'three';
import { heightAt, type WorldGeo } from '../../sim/world/geo';
import { factionDef, type ArchStyle } from '../../data/factions';
import { Rng } from '../../core/rng';
import { Bucket } from './meshBuilder';
import { archUniforms, type SettlementInput, type SettlementVisual, type TownGround } from './settlementBuilder';
import { makeFlagMaterial } from '../ships/shipBuilder';
import { ashlarTexture, cobbleTexture, plasterTexture2, roofTilesTexture, rubbleTexture, shopTextures, thatchTexture, timberTextures } from './archTextures';
import { planksTexture } from '../textures';
import { buildTreeGeometries } from '../env/trees';

/*
 * Town generator: lays out a street network (gates → square, ring lane, side streets), packs
 * house lots along the streets using an occupancy raster, and builds detailed timber-framed and
 * stone houses with jettied storeys, steep tiled roofs, chimneys, shops and doors; a church with
 * a spire, a guild hall, a castle with curtain wall and keep, town walls with towers and
 * gatehouses, a market, docks with cranes and warehouses, and farms and windmills outside.
 */

type BK = 'ashlar' | 'rubble' | 'timber' | 'shop' | 'plaster' | 'roof' | 'thatch' | 'wood' | 'dark' | 'cobble' | 'cloth' | 'leaf' | 'slate' | 'glass';
type Buckets = Record<BK, Bucket>;
const newBuckets = (): Buckets => ({
  ashlar: new Bucket(),
  rubble: new Bucket(),
  timber: new Bucket(),
  shop: new Bucket(),
  plaster: new Bucket(),
  roof: new Bucket(),
  thatch: new Bucket(),
  wood: new Bucket(),
  dark: new Bucket(),
  cobble: new Bucket(),
  cloth: new Bucket(),
  leaf: new Bucket(),
  slate: new Bucket(),
  glass: new Bucket(),
});

let mats: Record<BK, THREE.Material> | null = null;
function lampify(m: THREE.MeshStandardMaterial, k: number, key: string) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLamp = archUniforms.uLamp;
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform vec3 emissive;', 'uniform vec3 emissive;\nuniform float uLamp;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance *= uLamp * ${k.toFixed(2)};`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}
export function townMaterials(): Record<BK, THREE.Material> {
  if (mats) return mats;
  const tim = timberTextures();
  const shop = shopTextures();
  const ash = ashlarTexture();
  const rub = rubbleTexture();
  const tiles = roofTilesTexture();
  const cob = cobbleTexture();
  mats = {
    ashlar: new THREE.MeshStandardMaterial({ map: ash, bumpMap: ash, bumpScale: 1.2, vertexColors: true, roughness: 0.9 }),
    rubble: new THREE.MeshStandardMaterial({ map: rub, bumpMap: rub, bumpScale: 1.6, vertexColors: true, roughness: 0.95 }),
    timber: lampify(new THREE.MeshStandardMaterial({ map: tim.map, emissiveMap: tim.emissive, emissive: new THREE.Color(1, 0.7, 0.36), vertexColors: true, roughness: 0.88 }), 2.2, 'town-timber'),
    shop: lampify(new THREE.MeshStandardMaterial({ map: shop.map, emissiveMap: shop.emissive, emissive: new THREE.Color(1, 0.7, 0.36), vertexColors: true, roughness: 0.88 }), 2.2, 'town-shop'),
    plaster: new THREE.MeshStandardMaterial({ map: plasterTexture2(), vertexColors: true, roughness: 0.92 }),
    roof: new THREE.MeshStandardMaterial({ map: tiles, bumpMap: tiles, bumpScale: 1.4, vertexColors: true, roughness: 0.8 }),
    slate: new THREE.MeshStandardMaterial({ map: tiles, bumpMap: tiles, bumpScale: 1.2, vertexColors: true, roughness: 0.55, metalness: 0.05 }),
    thatch: new THREE.MeshStandardMaterial({ map: thatchTexture(), bumpMap: thatchTexture(), bumpScale: 2.2, vertexColors: true, roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ map: planksTexture(), vertexColors: true, roughness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x19120c, roughness: 0.95, vertexColors: true }),
    cobble: new THREE.MeshStandardMaterial({ map: cob, bumpMap: cob, bumpScale: 1.0, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    leaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    glass: lampify(new THREE.MeshStandardMaterial({ color: 0x2a2030, emissive: new THREE.Color(1, 0.62, 0.3), vertexColors: true, roughness: 0.3 }), 1.6, 'town-glass'),
  };
  return mats;
}

// ---------------------------------------------------------------- geometry helpers

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Local → world transform: +z local is the front of a building facing yaw. */
function fr(cx: number, cz: number, yaw: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (lx: number, y: number, lz: number) => V(cx + lx * c + lz * s, y, cz - lx * s + lz * c);
}
function quad(b: Bucket, a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number], col: THREE.Color) {
  b.tri(a, bb, c, ua, ub, uc, col);
  b.tri(a, c, d, ua, uc, ud, col);
}

/**
 * Four walls of a storey. UVs: u runs along each face in metres / uScale, v = 0..1 over the storey
 * (so a texture holds exactly one storey), offset by the face so neighbouring bays differ.
 */
function storey(b: Bucket, f: ReturnType<typeof fr>, w: number, d: number, y0: number, h: number, col: THREE.Color, uScale: number, uOff = 0, vFull = true, jetFront = 0, jetBack = 0, ao = 0) {
  const hw = w / 2;
  const z0 = -d / 2 - jetBack;
  const z1 = d / 2 + jetFront;
  const y1 = y0 + h;
  const v0 = 0;
  const v1 = vFull ? 1 : h / 2.8;
  const bot = ao > 0 ? col.clone().multiplyScalar(1 - ao) : col;
  const faces: [number, number, number, number, number][] = [
    // x0,z0 -> x1,z1 (counter-clockwise seen from outside), length
    [-hw, z1, hw, z1, w],
    [hw, z1, hw, z0, d + jetFront + jetBack],
    [hw, z0, -hw, z0, w],
    [-hw, z0, -hw, z1, d + jetFront + jetBack],
  ];
  faces.forEach(([ax, az, bx, bz, len], i) => {
    const u0 = uOff + i * 0.37;
    const u1 = u0 + len / uScale;
    const A = f(ax, y0, az);
    const B = f(bx, y0, bz);
    const Cc = f(bx, y1, bz);
    const D = f(ax, y1, az);
    if (ao > 0) {
      b.tri3(A, B, Cc, [u0, v0], [u1, v0], [u1, v1], bot, bot, col);
      b.tri3(A, Cc, D, [u0, v0], [u1, v1], [u0, v1], bot, col, col);
    } else quad(b, A, B, Cc, D, [u0, v0], [u1, v0], [u1, v1], [u0, v1], col);
  });
  return y1;
}

function slab(b: Bucket, f: ReturnType<typeof fr>, w: number, d: number, y: number, col: THREE.Color, up = true) {
  const hw = w / 2;
  const hd = d / 2;
  if (up) quad(b, f(-hw, y, hd), f(hw, y, hd), f(hw, y, -hd), f(-hw, y, -hd), [0, 0], [w / 3, 0], [w / 3, d / 3], [0, d / 3], col);
  else quad(b, f(-hw, y, -hd), f(hw, y, -hd), f(hw, y, hd), f(-hw, y, hd), [0, 0], [w / 3, 0], [w / 3, d / 3], [0, d / 3], col);
}

/** Axis box (all 6 faces except bottom) in local frame with world-scaled UVs. */
function lbox(b: Bucket, f: ReturnType<typeof fr>, lx: number, lz: number, w: number, d: number, y0: number, h: number, col: THREE.Color, s = 0.25) {
  const g = (x: number, y: number, z: number) => f(lx + x, y, lz + z);
  const hw = w / 2;
  const hd = d / 2;
  const y1 = y0 + h;
  quad(b, g(-hw, y0, hd), g(hw, y0, hd), g(hw, y1, hd), g(-hw, y1, hd), [0, 0], [w * s, 0], [w * s, h * s], [0, h * s], col);
  quad(b, g(hw, y0, -hd), g(-hw, y0, -hd), g(-hw, y1, -hd), g(hw, y1, -hd), [0, 0], [w * s, 0], [w * s, h * s], [0, h * s], col);
  quad(b, g(hw, y0, hd), g(hw, y0, -hd), g(hw, y1, -hd), g(hw, y1, hd), [0, 0], [d * s, 0], [d * s, h * s], [0, h * s], col);
  quad(b, g(-hw, y0, -hd), g(-hw, y0, hd), g(-hw, y1, hd), g(-hw, y1, -hd), [0, 0], [d * s, 0], [d * s, h * s], [0, h * s], col);
  quad(b, g(-hw, y1, hd), g(hw, y1, hd), g(hw, y1, -hd), g(-hw, y1, -hd), [0, 0], [w * s, 0], [w * s, d * s], [0, d * s], col);
}

/**
 * Gable roof with the ridge along local x (slopes face ±z), eaves overhang, gable triangles
 * (into `gable`, UV continuing the wall texture), barge boards and a ridge cap.
 */
function gable(roofB: Bucket, gableB: Bucket | null, trim: Bucket, f: ReturnType<typeof fr>, w: number, d: number, y0: number, rh: number, roofC: THREE.Color, wallC: THREE.Color, oh = 0.45, gableUScale = 8.8) {
  const hw = w / 2 + oh;
  const hd = d / 2 + oh;
  const drop = oh * (rh / (d / 2));
  const yE = y0 - drop;
  const yR = y0 + rh;
  const slope = Math.hypot(hd, rh + drop);
  const s = 1 / 3;
  // slopes
  quad(roofB, f(-hw, yE, hd), f(hw, yE, hd), f(hw, yR, 0), f(-hw, yR, 0), [0, 0], [2 * hw * s, 0], [2 * hw * s, slope * s], [0, slope * s], roofC);
  quad(roofB, f(hw, yE, -hd), f(-hw, yE, -hd), f(-hw, yR, 0), f(hw, yR, 0), [0, 0], [2 * hw * s, 0], [2 * hw * s, slope * s], [0, slope * s], roofC);
  // undersides of the eaves (dark)
  quad(trim, f(hw, yE, hd), f(-hw, yE, hd), f(-hw, y0, d / 2), f(hw, y0, d / 2), [0, 0], [1, 0], [1, 1], [0, 1], wallC.clone().multiplyScalar(0.25));
  quad(trim, f(-hw, yE, -hd), f(hw, yE, -hd), f(hw, y0, -d / 2), f(-hw, y0, -d / 2), [0, 0], [1, 0], [1, 1], [0, 1], wallC.clone().multiplyScalar(0.25));
  // gable triangles
  if (gableB) {
    const vTop = rh / 2.8;
    gableB.tri(f(-w / 2, y0, d / 2), f(-w / 2, y0, -d / 2), f(-w / 2, yR, 0), [0, 0], [d / gableUScale, 0], [d / (2 * gableUScale), vTop], wallC);
    gableB.tri(f(w / 2, y0, -d / 2), f(w / 2, y0, d / 2), f(w / 2, yR, 0), [0, 0], [d / gableUScale, 0], [d / (2 * gableUScale), vTop], wallC);
  }
  // fascia boards along the eaves
  const fc = roofC.clone().multiplyScalar(0.45);
  quad(trim, f(-hw, yE - 0.24, hd + 0.02), f(hw, yE - 0.24, hd + 0.02), f(hw, yE + 0.02, hd + 0.02), f(-hw, yE + 0.02, hd + 0.02), [0, 0], [1, 0], [1, 1], [0, 1], fc);
  quad(trim, f(hw, yE - 0.24, -hd - 0.02), f(-hw, yE - 0.24, -hd - 0.02), f(-hw, yE + 0.02, -hd - 0.02), f(hw, yE + 0.02, -hd - 0.02), [0, 0], [1, 0], [1, 1], [0, 1], fc);
  // barge boards along the verges (the tile verge reads as a slightly darker roof edge) and a ridge cap
  const bc = roofC.clone().multiplyScalar(0.62);
  for (const sx of [-1, 1]) {
    const x = sx * hw;
    for (const sz of [-1, 1]) {
      const a = f(x, yE, sz * hd);
      const bpt = f(x, yR + 0.1, 0);
      trimBeam(roofB, a, bpt, 0.2, 0.1, bc);
    }
  }
  trimBeam(trim, f(-hw, yR + 0.05, 0), f(hw, yR + 0.05, 0), 0.3, 0.24, roofC.clone().multiplyScalar(0.55));
}

/** Hip roof over a rectangle (ridge along x). */
function hip(roofB: Bucket, f: ReturnType<typeof fr>, w: number, d: number, y0: number, rh: number, roofC: THREE.Color, oh = 0.45) {
  const hw = w / 2 + oh;
  const hd = d / 2 + oh;
  const drop = oh * (rh / (d / 2));
  const yE = y0 - drop;
  const ridge = Math.max(0, hw - hd);
  const s = 1 / 3;
  const A = f(-hw, yE, hd);
  const B = f(hw, yE, hd);
  const Cc = f(hw, yE, -hd);
  const D = f(-hw, yE, -hd);
  const R1 = f(-ridge, y0 + rh, 0);
  const R2 = f(ridge, y0 + rh, 0);
  quad(roofB, A, B, R2, R1, [0, 0], [2 * hw * s, 0], [(hw + ridge) * s, hd * s], [(hw - ridge) * s, hd * s], roofC);
  quad(roofB, Cc, D, R1, R2, [0, 0], [2 * hw * s, 0], [(hw + ridge) * s, hd * s], [(hw - ridge) * s, hd * s], roofC);
  roofB.tri(B, Cc, R2, [0, 0], [2 * hd * s, 0], [hd * s, hd * s], roofC);
  roofB.tri(D, A, R1, [0, 0], [2 * hd * s, 0], [hd * s, hd * s], roofC);
}

function trimBeam(b: Bucket, a: THREE.Vector3, c: THREE.Vector3, w: number, h: number, col: THREE.Color) {
  const dir = c.clone().sub(a);
  const len = dir.length();
  if (len < 1e-3) return;
  dir.normalize();
  let side = V(0, 1, 0).cross(dir);
  if (side.lengthSq() < 1e-6) side = V(1, 0, 0);
  side.normalize().multiplyScalar(w / 2);
  const up = dir.clone().cross(side).normalize().multiplyScalar(h / 2);
  const p = [a.clone().sub(side).sub(up), a.clone().add(side).sub(up), a.clone().add(side).add(up), a.clone().sub(side).add(up)];
  const q = p.map((v) => v.clone().addScaledVector(dir, len));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(b, p[i], p[j], q[j], q[i], [0, 0], [1, 0], [1, len * 0.3], [0, len * 0.3], col);
  }
}

function cyl(b: Bucket, x: number, z: number, y0: number, r0: number, r1: number, h: number, seg: number, col: THREE.Color, uS = 0.25, cap = true) {
  const circ = 2 * Math.PI * Math.max(r0, r1);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = V(x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0);
    const p1 = V(x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0);
    const p2 = V(x + Math.cos(a1) * r1, y0 + h, z + Math.sin(a1) * r1);
    const p3 = V(x + Math.cos(a0) * r1, y0 + h, z + Math.sin(a0) * r1);
    const u0 = (i / seg) * circ * uS;
    const u1 = ((i + 1) / seg) * circ * uS;
    quad(b, p1, p0, p3, p2, [u1, 0], [u0, 0], [u0, h * uS], [u1, h * uS], col);
    if (cap) b.tri(V(x, y0 + h, z), p2, p3, [0, 0], [r1 * uS, 0], [0, r1 * uS], col);
  }
}
function coneR(b: Bucket, x: number, z: number, y0: number, r: number, h: number, seg: number, col: THREE.Color) {
  const apex = V(x, y0 + h, z);
  const sl = Math.hypot(r, h);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = V(x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r);
    const p1 = V(x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r);
    const u0 = (i / seg) * r * 2;
    b.tri(p1, p0, apex, [u0 + (2 * r) / seg, 0], [u0, 0], [u0 + r / seg, sl / 3], col);
  }
}
function merlonRow(b: Bucket, ax: number, az: number, bx: number, bz: number, y: number, t: number, col: THREE.Color, size = 1.0) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.floor(len / (size * 2)));
  const yaw = Math.atan2(bx - ax, bz - az);
  for (let i = 0; i < n; i++) {
    const tt = (i + 0.5) / n;
    const f = fr(ax + (bx - ax) * tt, az + (bz - az) * tt, yaw + Math.PI / 2);
    lbox(b, f, 0, 0, size, t, y, size * 1.15, col);
  }
}

// ---------------------------------------------------------------- occupancy raster

class Occ {
  n: number;
  data: Uint8Array;
  constructor(
    public cx: number,
    public cz: number,
    public half: number,
  ) {
    this.n = Math.ceil(half * 2);
    this.data = new Uint8Array(this.n * this.n);
  }
  private idx(x: number, z: number) {
    const i = Math.floor(x - (this.cx - this.half));
    const j = Math.floor(z - (this.cz - this.half));
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }
  get(x: number, z: number) {
    const k = this.idx(x, z);
    return k < 0 ? 1 : this.data[k];
  }
  /** Test/mark an oriented rectangle (centre, half extents, yaw). */
  rect(x: number, z: number, hw: number, hd: number, yaw: number, mark: number | null): boolean {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const ex = Math.abs(hw * c) + Math.abs(hd * s);
    const ez = Math.abs(hw * s) + Math.abs(hd * c);
    for (let zz = Math.floor(z - ez); zz <= Math.ceil(z + ez); zz++)
      for (let xx = Math.floor(x - ex); xx <= Math.ceil(x + ex); xx++) {
        const dx = xx + 0.5 - x;
        const dz = zz + 0.5 - z;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
        const k = this.idx(xx + 0.5, zz + 0.5);
        if (mark === null) {
          if (k < 0 || this.data[k]) return false;
        } else if (k >= 0) this.data[k] = Math.max(this.data[k], mark);
      }
    return true;
  }
  disc(x: number, z: number, r: number, mark: number) {
    for (let zz = Math.floor(z - r); zz <= Math.ceil(z + r); zz++)
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        if ((xx + 0.5 - x) ** 2 + (zz + 0.5 - z) ** 2 > r * r) continue;
        const k = this.idx(xx + 0.5, zz + 0.5);
        if (k >= 0) this.data[k] = Math.max(this.data[k], mark);
      }
  }
  line(pts: { x: number; z: number }[], w: number, mark: number) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / 0.8));
      for (let k = 0; k <= steps; k++) this.disc(a.x + ((b.x - a.x) * k) / steps, a.z + ((b.z - a.z) * k) / steps, w / 2, mark);
    }
  }
}

// ---------------------------------------------------------------- palettes

interface Pal {
  plaster(): THREE.Color;
  roof(): THREE.Color;
  thatch(): THREE.Color;
  timber(): THREE.Color;
  stone(): THREE.Color;
}
/** sRGB-space brighten so faction colours read as sunlit tiles rather than mud. */
function lift(hex: string, k: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.min(0.92, hsl.l * k), THREE.SRGBColorSpace);
  return c;
}
function makePalette(style: ArchStyle, r: Rng): Pal {
  const pick = <T,>(arr: T[]) => arr[Math.floor(r.next() * arr.length)];
  const jitter = (c: THREE.Color, a: number) => c.clone().multiplyScalar(1 + r.range(-a, a));
  const plasters = [style.plaster, style.plaster, style.plaster, '#efe8d8', '#ebdfc4', '#e6cfa2', '#e3c6b4', '#d8d6cc', '#ecd9a8', '#f3eee2', '#d6c7a9', '#e8d6c6'].map((h) => new THREE.Color(h));
  const base = new THREE.Color(style.roof);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl, THREE.SRGBColorSpace);
  const slaty = hsl.s < 0.22 || (hsl.h > 0.45 && hsl.h < 0.75);
  const extra = slaty ? ['#5c636d', '#6a7079', '#535b66', '#766355', '#686b70', '#7b8088'] : ['#b8633f', '#a8563a', '#c47a52', '#95503a', '#8a654e', '#a06e4c', '#7c7068'];
  const roofs = [lift(style.roof, 1.45), lift(style.roof, 1.3), lift(style.roof2, 1.4), ...extra.map((h) => new THREE.Color(h))];
  const thatches = ['#f2e3c2', '#e6d4ae', '#dccaa4', '#eadcc0', '#d2c3a6'].map((h) => new THREE.Color(h));
  const timbers = [style.timber, style.timber, '#2c211a', '#5a4634', '#3b3631'].map((h) => new THREE.Color(h));
  const stone = new THREE.Color(style.stone);
  return {
    plaster: () => jitter(pick(plasters), 0.05),
    roof: () => jitter(pick(roofs), 0.09),
    thatch: () => jitter(pick(thatches), 0.07),
    timber: () => jitter(pick(timbers), 0.08),
    stone: () => jitter(stone, 0.08),
  };
}

// ---------------------------------------------------------------- the generator

interface Street {
  pts: { x: number; z: number }[];
  w: number;
  main: boolean;
}

export function buildTown(inp: SettlementInput): SettlementVisual {
  const { geo, pg } = inp;
  const style: ArchStyle = factionDef(pg.anchor.owner).arch;
  const r = new Rng(pg.id * 7919 + 17);
  const hi = newBuckets();
  const lo = newBuckets();
  const cx = pg.x;
  const cz = pg.z;
  const R = pg.radius;
  const H = (x: number, z: number) => heightAt(geo, x, z);
  const C = (h: string) => new THREE.Color(h);
  const vary = (c: THREE.Color, a = 0.07) => c.clone().multiplyScalar(1 + r.range(-a, a));
  const stoneC = C(style.stone);
  const plasterC = C(style.plaster);
  const roofC = lift(style.roof, 1.3);
  const roof2C = lift(style.roof2, 1.3);
  const timberC = C(style.timber);
  const flagsAt: { pos: THREE.Vector3; size: number }[] = [];
  const lamps: THREE.Vector3[] = [];
  const walk: THREE.Vector3[] = [];
  const occ = new Occ(cx, cz, R * 2.6 + 40);
  const big = inp.isCapital || inp.fortress || inp.tier >= 2;
  const walled = inp.walls > 0;
  const wallR = R * 0.96;
  const riverAt = (x: number, z: number) => {
    const c = Math.floor(z / geo.navStep) * geo.navW + Math.floor(x / geo.navStep);
    return geo.river[c] === 1;
  };
  // mark water, rivers and steep ground as unbuildable
  {
    const n = occ.n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = occ.cx - occ.half + i + 0.5;
        const z = occ.cz - occ.half + j + 0.5;
        const h = H(x, z);
        if (h < 1.3 || riverAt(x, z)) occ.data[j * n + i] = 2;
      }
    for (const rv of geo.rivers)
      for (let k = 0; k < rv.widths.length; k++) {
        const px = rv.pts[k * 2];
        const pz = rv.pts[k * 2 + 1];
        if (Math.abs(px - cx) > occ.half || Math.abs(pz - cz) > occ.half) continue;
        occ.disc(px, pz, rv.widths[k] * 0.5 + 6, 2);
      }
  }
  const footprint = (x: number, z: number, w: number, d: number, yaw: number) => {
    const f = fr(x, z, yaw);
    let mn = 1e9;
    let mx = -1e9;
    for (const [lx, lz] of [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
      [0, 0],
    ]) {
      const p = f(lx, 0, lz);
      const h = H(p.x, p.z);
      if (h < 1.2) return null;
      mn = Math.min(mn, h);
      mx = Math.max(mx, h);
    }
    if (mx - mn > 4.5) return null;
    return mn;
  };
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const dir = (a: number) => ({ x: Math.cos(a), z: Math.sin(a) });
  const harbor = pg.port ? pg.coastAngle : null;

  // ---- gate directions from the roads
  const gateDirs: number[] = [];
  for (const rd of geo.roads) {
    if (rd.a !== pg.id && rd.b !== pg.id) continue;
    const pts = rd.pts;
    const n = pts.length / 2;
    const fromStart = rd.a === pg.id;
    for (let k = 0; k < n; k++) {
      const i = fromStart ? k : n - 1 - k;
      const x = pts[i * 2];
      const z = pts[i * 2 + 1];
      if (Math.hypot(x - cx, z - cz) > R * 1.15) {
        const a = Math.atan2(z - cz, x - cx);
        if (!gateDirs.some((g) => angDiff(g, a) < 0.5)) gateDirs.push(a);
        break;
      }
    }
  }
  if (!gateDirs.length) gateDirs.push(r.range(0, Math.PI * 2));
  if (gateDirs.length < 2) gateDirs.push(gateDirs[0] + Math.PI + r.range(-0.4, 0.4));
  const inHarbor = (a: number) => harbor !== null && angDiff(a, harbor) < 0.8;

  // ---- the square, castle and church positions
  const g0 = dir(gateDirs[0]);
  let px = cx + g0.x * R * 0.12;
  let pz = cz + g0.z * R * 0.12;
  if (H(px, pz) < 1.5) {
    px = cx;
    pz = cz;
  }
  const plazaR = inp.tier >= 3 ? 21 : inp.tier === 2 ? 18 : inp.tier === 1 ? 13 : 9;
  const plaza = V(px, H(px, pz), pz);
  occ.disc(px, pz, plazaR, 1);
  walk.push(plaza.clone());

  // ---- streets
  const streets: Street[] = [];
  const gatePts: { x: number; z: number; a: number }[] = [];
  const edgeR = walled ? wallR : R * 1.15;
  for (const ga of gateDirs) {
    const d0 = dir(ga);
    const gx = cx + d0.x * edgeR;
    const gz = cz + d0.z * edgeR;
    gatePts.push({ x: gx, z: gz, a: ga });
    const pts: { x: number; z: number }[] = [];
    const wig = r.range(-1, 1) * R * 0.06;
    const startX = px + d0.x * plazaR;
    const startZ = pz + d0.z * plazaR;
    const endX = walled ? gx : cx + d0.x * R * 1.6;
    const endZ = walled ? gz : cz + d0.z * R * 1.6;
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const bx = startX + (endX - startX) * t;
      const bz = startZ + (endZ - startZ) * t;
      const off = Math.sin(t * Math.PI) * wig;
      pts.push({ x: bx - d0.z * off, z: bz + d0.x * off });
    }
    streets.push({ pts, w: inp.tier >= 2 ? 7 : 5.5, main: true });
  }
  if (harbor !== null) {
    const d0 = dir(harbor);
    const pts: { x: number; z: number }[] = [];
    for (let k = 0; k <= 10; k++) {
      const s = plazaR + k * (R * 0.11);
      const x = px + d0.x * s;
      const z = pz + d0.z * s;
      if (H(x, z) < 1.4) break;
      pts.push({ x, z });
    }
    if (pts.length > 2) streets.push({ pts, w: 6, main: true });
  }
  if (walled && inp.tier >= 1) {
    const ring: { x: number; z: number }[] = [];
    const rr = wallR - 9;
    for (let k = 0; k <= 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      ring.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr });
    }
    streets.push({ pts: ring, w: 4.5, main: false });
  }
  // side streets branching off the main streets
  if (inp.tier >= 1) {
    for (const st of streets.filter((s) => s.main)) {
      for (let k = 3; k < st.pts.length - 1; k += inp.tier >= 2 ? 3 : 4) {
        const a = st.pts[k];
        const b = st.pts[k + 1];
        const tx = b.x - a.x;
        const tz = b.z - a.z;
        const tl = Math.hypot(tx, tz) || 1;
        for (const sd of [-1, 1]) {
          if (r.chance(0.25)) continue;
          const nx = (-tz / tl) * sd;
          const nz = (tx / tl) * sd;
          const pts = [{ x: a.x, z: a.z }];
          let x = a.x;
          let z = a.z;
          let hx = nx;
          let hz = nz;
          for (let s = 0; s < 14; s++) {
            const turn = r.range(-0.12, 0.12);
            const c = Math.cos(turn);
            const sn = Math.sin(turn);
            [hx, hz] = [hx * c - hz * sn, hx * sn + hz * c];
            x += hx * 6;
            z += hz * 6;
            const dc = Math.hypot(x - cx, z - cz);
            if (dc > (walled ? wallR - 10 : R * 1.2) || H(x, z) < 1.5) break;
            pts.push({ x, z });
          }
          if (pts.length > 3) streets.push({ pts, w: 4, main: false });
        }
      }
    }
  }
  for (const st of streets) occ.line(st.pts, st.w, 1);

  // ---- town walls: circuit, towers, gatehouses
  const gates: THREE.Vector3[] = [];
  const wallH = inp.walls >= 3 ? 13 : inp.walls === 2 ? 10 : 6;
  const wallT = inp.walls >= 3 ? 3.4 : inp.walls === 2 ? 2.6 : 1.2;
  if (walled) {
    const N = Math.max(10, Math.round((2 * Math.PI * wallR) / (inp.walls >= 2 ? 32 : 24)));
    const verts: { x: number; z: number; a: number }[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.11;
      const rr = wallR * (1 + r.range(-0.04, 0.04));
      verts.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr, a });
    }
    const wetSeg = (a: { x: number; z: number }, b: { x: number; z: number }) => {
      for (let t = 0; t <= 1; t += 0.1) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (H(x, z) < 1.3 || riverAt(x, z)) return true;
      }
      return false;
    };
    for (let i = 0; i < N; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % N];
      const mid = Math.atan2((a.z + b.z) / 2 - cz, (a.x + b.x) / 2 - cx);
      if (inHarbor(mid) || wetSeg(a, b)) continue;
      const isGate = gateDirs.some((gd) => angDiff(gd, mid) < Math.PI / N + 0.03);
      if (isGate) {
        const gx = (a.x + b.x) / 2;
        const gz = (a.z + b.z) / 2;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len;
        const uz = (b.z - a.z) / len;
        wallRun(hi, lo, geo, a.x, a.z, gx - ux * 7, gz - uz * 7, wallH, wallT, stoneC, inp.walls, timberC);
        wallRun(hi, lo, geo, gx + ux * 7, gz + uz * 7, b.x, b.z, wallH, wallT, stoneC, inp.walls, timberC);
        const gy = H(gx, gz);
        gatehouse(hi, lo, gx, gz, gy, Math.atan2(ux, uz), wallH, inp.walls, stoneC, roofC, timberC, style, flagsAt);
        const inward = V(cx - gx, 0, cz - gz).normalize();
        gates.push(V(gx + inward.x * 10, gy, gz + inward.z * 10));
        lamps.push(V(gx + inward.x * 4, gy + 5, gz + inward.z * 4), V(gx - inward.x * 4, gy + 5, gz - inward.z * 4));
        occ.disc(gx, gz, 9, 1);
      } else {
        wallRun(hi, lo, geo, a.x, a.z, b.x, b.z, wallH, wallT, stoneC, inp.walls, timberC);
      }
      occ.line([a, b], wallT + 6, 2);
    }
    for (let i = 0; i < N; i++) {
      const v = verts[i];
      if (inHarbor(v.a) || H(v.x, v.z) < 1.3 || riverAt(v.x, v.z)) continue;
      if (gateDirs.some((gd) => angDiff(gd, v.a) < 0.14)) continue;
      wallTower(hi, lo, v.x, v.z, H(v.x, v.z), wallH, inp.walls, stoneC, roofC, timberC, style, i % 3 === 0 ? flagsAt : null);
    }
  }
  if (!gates.length) for (const gp of gatePts) gates.push(V(gp.x, H(gp.x, gp.z), gp.z));

  // ---- castle for capitals, fortresses and great cities
  let keepTop = plaza.y + 10;
  let kx = cx;
  let kz = cz;
  if (big) {
    let ka = gateDirs[0] + Math.PI;
    if (harbor !== null && angDiff(ka, harbor) < 0.9) ka += 1.2;
    kx = cx + Math.cos(ka) * R * 0.46;
    kz = cz + Math.sin(ka) * R * 0.46;
    for (let tries = 0; tries < 8 && H(kx, kz) < 2; tries++) {
      ka += 0.7;
      kx = cx + Math.cos(ka) * R * 0.42;
      kz = cz + Math.sin(ka) * R * 0.42;
    }
    const yaw = Math.atan2(cx - kx, cz - kz);
    keepTop = castle(hi, lo, geo, kx, kz, yaw, inp.isCapital ? 1.15 : inp.fortress ? 1.05 : 0.9, stoneC, roofC, roof2C, style, flagsAt, lamps);
    occ.disc(kx, kz, inp.isCapital ? 36 : 31, 1);
  } else if (inp.tier === 1) {
    const ka = gateDirs[0] + Math.PI + 0.6;
    kx = cx + Math.cos(ka) * R * 0.35;
    kz = cz + Math.sin(ka) * R * 0.35;
    const y = footprint(kx, kz, 18, 10, -ka) ?? H(kx, kz);
    keepTop = manor(hi, lo, kx, kz, y, -ka + Math.PI / 2, stoneC, roofC, style, flagsAt);
    occ.disc(kx, kz, 15, 1);
  }

  // ---- church with spire near the square
  {
    const side = gateDirs[0] + Math.PI / 2;
    const d0 = dir(side);
    const dist = plazaR + (inp.tier >= 2 ? 22 : inp.tier === 1 ? 15 : 12);
    const chx = px + d0.x * dist;
    const chz = pz + d0.z * dist;
    const yaw = Math.atan2(px - chx, pz - chz);
    const scale = inp.tier >= 2 ? 1 : inp.tier === 1 ? 0.72 : 0.5;
    const w = 11 * scale;
    const d = 28 * scale;
    if (occ.rect(chx, chz, w / 2 + 4, d / 2 + 8, yaw, null)) {
      const y = footprint(chx, chz, w, d, yaw) ?? H(chx, chz);
      church(hi, lo, chx, chz, y, yaw, scale, stoneC, roof2C, flagsAt, lamps);
      occ.rect(chx, chz, w / 2 + 3, d / 2 + 7, yaw, 1);
    }
  }
  // ---- guild hall on the square
  if (inp.tier >= 2) {
    const a = gateDirs[0] - Math.PI / 2 + 0.3;
    const d0 = dir(a);
    const hx = px + d0.x * (plazaR + 9);
    const hz = pz + d0.z * (plazaR + 9);
    const yaw = Math.atan2(px - hx, pz - hz);
    if (occ.rect(hx, hz, 9, 7, yaw, null)) {
      const y = footprint(hx, hz, 16, 12, yaw) ?? H(hx, hz);
      guildHall(hi, lo, hx, hz, y, yaw, stoneC, roofC, flagsAt, lamps);
      occ.rect(hx, hz, 9.5, 7.5, yaw, 1);
    }
  }
  // ---- market: stalls, well, cross
  market(hi, px, pz, H, plazaR, inp.tier, timberC, stoneC, r, walk, lamps);

  // ---- houses: continuous frontages along the streets, outbuildings behind, gardens between
  const pal = makePalette(style, r);
  const budget = [26, 120, 260, 420][inp.tier] ?? 30;
  let placed = 0;
  const floorsFor = () => (inp.tier >= 3 ? r.int(2, 4) : inp.tier === 2 ? r.int(2, 3) : inp.tier === 1 ? r.int(1, 3) : 1);
  const tryHouse = (x: number, z: number, yaw: number, w: number, d: number, kind: HouseKind, lod: boolean) => {
    // neighbours may share a party wall: test a slightly shrunk footprint, mark the full one
    if (!occ.rect(x, z, w / 2 - 0.3, d / 2 - 0.3, yaw, null)) return false;
    const y = footprint(x, z, w, d, yaw);
    if (y === null) return false;
    occ.rect(x, z, w / 2, d / 2, yaw, 1);
    const floors = kind === 'back' ? Math.max(1, floorsFor() - 1) : kind === 'farm' || kind === 'shed' ? 1 : floorsFor();
    house(hi, lo, x, z, y, yaw, w, d, floors, inp.tier, pal, r, lod, kind);
    placed++;
    return true;
  };
  const segs: { ax: number; az: number; ux: number; uz: number; len: number }[] = [];
  const order = [...streets].sort((a, b) => Number(b.main) - Number(a.main));
  for (const st of order)
    for (let i = 0; i < st.pts.length - 1; i++) {
      const a = st.pts[i];
      const b = st.pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len >= 0.5) segs.push({ ax: a.x, az: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len, len });
    }
  for (const st of order) {
    if (placed >= budget) break;
    for (const sd of [-1, 1]) {
      let carry = r.range(0, 1.5);
      for (let i = 0; i < st.pts.length - 1 && placed < budget; i++) {
        const a = st.pts[i];
        const b = st.pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.5) continue;
        const ux = (b.x - a.x) / len;
        const uz = (b.z - a.z) / len;
        const nx = -uz * sd;
        const nz = ux * sd;
        let s = carry;
        while (s < len && placed < budget) {
          const w = inp.tier >= 2 ? r.range(5, 7.5) : r.range(5.5, 8.5);
          const d = inp.tier >= 2 ? r.range(8, 12) : r.range(7, 10);
          const off = st.w / 2 + 0.4 + d / 2;
          const x = a.x + ux * (s + w / 2) + nx * off;
          const z = a.z + uz * (s + w / 2) + nz * off;
          const yaw = Math.atan2(-nx, -nz);
          if (tryHouse(x, z, yaw, w, d, 'street', placed % 3 === 0)) {
            // a workshop, stable or store in the yard behind
            if (r.chance(inp.tier >= 2 ? 0.35 : 0.5)) {
              const sw = r.range(3.5, Math.min(6.5, w));
              const sdp = r.range(3, 4.5);
              const back = off + d / 2 + r.range(1.5, 5) + sdp / 2;
              const bx = a.x + ux * (s + w / 2 + r.range(-0.8, 0.8)) + nx * back;
              const bz = a.z + uz * (s + w / 2) + nz * back;
              tryHouse(bx, bz, yaw + (r.chance(0.3) ? Math.PI / 2 : 0), sw, sdp, 'shed', false);
            }
            s += w;
          } else s += 1.5;
        }
        carry = Math.max(0, s - len);
      }
    }
  }
  // infill: back-lane houses aligned with the nearest street
  const nearestSeg = (x: number, z: number) => {
    let best = segs[0];
    let bd = 1e9;
    for (const sg of segs) {
      const t = Math.min(sg.len, Math.max(0, (x - sg.ax) * sg.ux + (z - sg.az) * sg.uz));
      const dd = Math.hypot(sg.ax + sg.ux * t - x, sg.az + sg.uz * t - z);
      if (dd < bd) {
        bd = dd;
        best = sg;
      }
    }
    return { sg: best, d: bd };
  };
  for (let t = 0; t < 1400 && placed < budget * 1.12 && segs.length; t++) {
    const a = r.range(0, Math.PI * 2);
    const rr = Math.sqrt(r.next()) * (walled ? wallR - 8 : R * 1.05);
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    if (occ.get(x, z)) continue;
    const ns = nearestSeg(x, z);
    if (ns.d > 34) continue;
    const yaw = Math.atan2(-ns.sg.uz, ns.sg.ux) + (r.chance(0.6) ? 0 : Math.PI / 2);
    tryHouse(x, z, yaw, r.range(4.5, 6.5), r.range(5.5, 8), 'back', false);
  }
  // orchard and garden trees in the leftover plots
  for (let t = 0; t < (inp.tier + 1) * 45; t++) {
    const a = r.range(0, Math.PI * 2);
    const rr = Math.sqrt(r.next()) * (walled ? wallR - 6 : R * 1.3);
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    if (occ.get(x, z) || H(x, z) < 1.5) continue;
    tree(hi, x, z, H(x, z), r);
    occ.disc(x, z, 1.6, 4);
  }
  // suburbs along the roads outside the walls
  if (walled && inp.tier >= 2) {
    for (const gp of gatePts) {
      const d0 = dir(gp.a);
      for (let k = 0; k < 9; k++) {
        const along = wallR + 14 + k * 8;
        for (const sd of [-1, 1]) {
          if (r.chance(0.3)) continue;
          const x = cx + d0.x * along - d0.z * 9 * sd;
          const z = cz + d0.z * along + d0.x * 9 * sd;
          if (tryHouse(x, z, Math.atan2(d0.z * sd, -d0.x * sd), r.range(5.5, 7.5), r.range(6.5, 9), 'back', false) && r.chance(0.5)) {
            const bx = cx + d0.x * (along + r.range(-2, 2)) - d0.z * 17 * sd;
            const bz = cz + d0.z * along + d0.x * 17 * sd;
            tryHouse(bx, bz, Math.atan2(d0.z * sd, -d0.x * sd), r.range(3.5, 5), r.range(3, 4.5), 'shed', false);
          }
        }
      }
    }
  }

  // ---- streets & square paving (villages keep beaten-earth lanes and a green)
  for (const st of streets) if (inp.tier >= 2 || (inp.tier === 1 && st.main)) paveStreet(hi, lo, st, H);
  if (inp.tier >= 1) paveDisc(hi, lo, px, pz, plazaR, H);

  // ---- ground mask: packed earth under lanes and yards, gardens in the free plots
  const ground: TownGround = (() => {
    const step = 4;
    const gx0 = Math.floor((occ.cx - occ.half) / step);
    const gz0 = Math.floor((occ.cz - occ.half) / step);
    const gw = Math.ceil((occ.half * 2) / step) + 2;
    const gh = gw;
    const built = new Float32Array(gw * gh);
    const free = new Float32Array(gw * gh);
    for (let j = 0; j < occ.n; j++)
      for (let i = 0; i < occ.n; i++) {
        const ti = Math.floor((occ.cx - occ.half + i + 0.5) / step) - gx0;
        const tj = Math.floor((occ.cz - occ.half + j + 0.5) / step) - gz0;
        if (ti < 0 || tj < 0 || ti >= gw || tj >= gh) continue;
        const v = occ.data[j * occ.n + i];
        if (v === 1) built[tj * gw + ti] += 1 / 16;
        else if (v === 0 || v === 4) free[tj * gw + ti] += 1 / 16;
      }
    const data = new Uint8Array(gw * gh * 2);
    const inner = walled ? wallR - 3 : R * 1.3;
    for (let tj = 0; tj < gh; tj++)
      for (let ti = 0; ti < gw; ti++) {
        const k = tj * gw + ti;
        const wx = (gx0 + ti + 0.5) * step;
        const wz = (gz0 + tj + 0.5) * step;
        const dc = Math.hypot(wx - cx, wz - cz);
        let near = 0;
        if (!walled && dc < inner)
          for (let dj = -3; dj <= 3; dj++)
            for (let di = -3; di <= 3; di++) {
              const a = ti + di;
              const b = tj + dj;
              if (a >= 0 && b >= 0 && a < gw && b < gh) near = Math.max(near, built[b * gw + a]);
            }
        const inside = walled ? dc < inner : dc < inner && near > 0.3;
        const soft = walled ? 1 - Math.min(1, Math.max(0, (dc - (inner - 10)) / 10)) : 1;
        data[k * 2] = Math.round(Math.min(1, built[k] * 1.5) * 255);
        data[k * 2 + 1] = inside ? Math.round(Math.min(1, free[k] * 1.2) * soft * 255) : 0;
      }
    return { x0: gx0 * step, z0: gz0 * step, w: gw, h: gh, step, data };
  })();

  // ---- docks
  const docks: THREE.Vector3[] = [];
  if (pg.port && harbor !== null) buildDocks(hi, lo, geo, cx, cz, R, harbor, inp, stoneC, roof2C, timberC, r, docks, lamps, flagsAt, walled ? wallH : 0);

  // ---- countryside: farmsteads and windmills
  const fields: THREE.Vector3[] = [];
  const mills: { x: number; z: number; y: number; yaw: number }[] = [];
  const farmN = inp.tier === 0 ? 3 : inp.tier === 1 ? 5 : 7;
  for (let k = 0; k < farmN * 4 && fields.length < farmN; k++) {
    const a = r.range(0, Math.PI * 2);
    if (inHarbor(a)) continue;
    const rr = R * r.range(1.4, 2.4);
    const fx = cx + Math.cos(a) * rr;
    const fz = cz + Math.sin(a) * rr;
    const y = footprint(fx, fz, 9, 7, -a);
    if (y === null || !occ.rect(fx, fz, 12, 10, -a, null)) continue;
    farmstead(hi, lo, fx, fz, y, -a, plasterC, roofC, timberC, r);
    occ.rect(fx, fz, 12, 10, -a, 1);
    fields.push(V(fx + Math.cos(a) * 18, y, fz + Math.sin(a) * 18));
  }
  if (pg.resources.includes('grain') || inp.buildings.has('farm') || inp.tier >= 1) {
    const nm = inp.tier >= 2 ? 3 : 1;
    for (let k = 0; k < nm * 6 && mills.length < nm; k++) {
      const a = r.range(0, Math.PI * 2);
      if (inHarbor(a)) continue;
      const rr = R * r.range(1.35, 2.1);
      const mx = cx + Math.cos(a) * rr;
      const mz = cz + Math.sin(a) * rr;
      const y = footprint(mx, mz, 6, 6, 0);
      if (y === null || !occ.rect(mx, mz, 5, 5, 0, null)) continue;
      cyl(hi.plaster, mx, mz, y - 1, 3.0, 2.3, 11, 12, C('#dcd2bf'), 0.25, false);
      cyl(lo.plaster, mx, mz, y - 1, 3.0, 2.3, 11, 6, C('#dcd2bf'), 0.25, false);
      coneR(hi.roof, mx, mz, y + 10, 2.9, 3.4, 12, vary(roofC));
      coneR(lo.roof, mx, mz, y + 10, 2.9, 3.4, 6, roofC);
      const f = fr(mx, mz, -a + Math.PI / 2);
      const door = f(0, y, 2.4);
      lbox(hi.dark, fr(door.x, door.z, -a + Math.PI / 2), 0, 0, 1.2, 0.2, y - 0.2, 2.2, C('#1a120b'));
      mills.push({ x: mx, z: mz, y: y + 9, yaw: -a + Math.PI / 2 });
      occ.disc(mx, mz, 6, 1);
    }
  }

  // ---- assemble
  const m = townMaterials();
  const makeGroup = (b: Buckets, shadows: boolean) => {
    const g = new THREE.Group();
    for (const k of Object.keys(b) as BK[]) {
      const geo2 = b[k].build();
      if (!geo2) continue;
      const mesh = new THREE.Mesh(geo2, m[k]);
      mesh.castShadow = shadows && k !== 'cobble';
      mesh.receiveShadow = shadows;
      mesh.matrixAutoUpdate = false;
      g.add(mesh);
    }
    return g;
  };
  const hiG = makeGroup(hi, true);
  const loG = makeGroup(lo, false);
  // geometry is baked in world space; the LOD node sits at the town centre so its distance test
  // measures camera→town, and the level groups undo that offset.
  const lod = new THREE.LOD();
  lod.position.set(cx, plaza.y, cz);
  hiG.position.set(-cx, -plaza.y, -cz);
  loG.position.set(-cx, -plaza.y, -cz);
  lod.addLevel(hiG, 0);
  lod.addLevel(loG, 900);
  const group = new THREE.Group();
  group.add(lod);
  // windmill sails
  const millObjs: THREE.Object3D[] = [];
  const sailGeo = (() => {
    const b = new Bucket();
    const f = fr(0, 0, 0);
    // lattice frame + canvas
    lbox(b, f, 0, 0, 0.3, 0.3, 0, 8.2, C('#5b4330'));
    for (let k = 1; k < 8; k++) lbox(b, f, 0.75, 0, 1.5, 0.12, k * 1.0, 0.1, C('#5b4330'));
    const g = b.build()!;
    return g;
  })();
  const canvasGeo = new THREE.PlaneGeometry(1.5, 6.6);
  canvasGeo.translate(0.75, 4.6, 0.12);
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0xe8dfca, roughness: 0.95, side: THREE.DoubleSide });
  for (const ml of mills) {
    const hub = new THREE.Object3D();
    hub.position.set(ml.x + Math.sin(ml.yaw) * 3.1, ml.y, ml.z + Math.cos(ml.yaw) * 3.1);
    hub.rotation.y = ml.yaw;
    const rot = new THREE.Object3D();
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      const frameM = new THREE.Mesh(sailGeo, m.wood);
      frameM.castShadow = true;
      const cv = new THREE.Mesh(canvasGeo, canvasMat);
      cv.castShadow = true;
      arm.add(frameM, cv);
      arm.rotation.z = (k * Math.PI) / 2;
      rot.add(arm);
    }
    hub.add(rot);
    hiG.add(hub);
    millObjs.push(rot);
  }
  // flags
  const flagGeo = new THREE.PlaneGeometry(6, 4, 8, 2);
  flagGeo.translate(3, 0, 0);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 5);
  poleGeo.translate(0, 3, 0);
  const flagMat = makeFlagMaterial(inp.owner);
  const flags: THREE.Mesh[] = [];
  flagsAt.forEach((f, i) => {
    const pole = new THREE.Mesh(poleGeo, m.wood);
    pole.position.copy(f.pos);
    pole.scale.setScalar(f.size);
    hiG.add(pole);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.copy(f.pos).add(V(0, 4 * f.size, 0));
    flag.scale.setScalar(f.size);
    flag.rotation.y = r.range(0, 0.4);
    hiG.add(flag);
    flags.push(flag);
    if (i === 0) {
      const f2 = new THREE.Mesh(flagGeo, flagMat);
      f2.position.copy(flag.position);
      f2.scale.setScalar(f.size * 1.6);
      loG.add(f2);
      flags.push(f2);
    }
  });
  for (const w of walk) w.y = H(w.x, w.z);
  for (const st of streets) for (let k = 0; k < st.pts.length; k += 3) walk.push(V(st.pts[k].x, H(st.pts[k].x, st.pts[k].z), st.pts[k].z));
  return {
    group,
    flags,
    lamps,
    walkPoints: walk,
    plaza,
    gates,
    docks,
    fields,
    mills: millObjs,
    bannerTop: V(kx, keepTop + 14, kz),
    radius: R,
    ground,
    dispose() {
      for (const g of [hiG, loG])
        g.traverse((o) => {
          const mm = o as THREE.Mesh;
          if (mm.isMesh && mm.geometry !== sailGeo && mm.geometry !== flagGeo && mm.geometry !== poleGeo && mm.geometry !== canvasGeo) mm.geometry.dispose();
        });
      sailGeo.dispose();
      canvasGeo.dispose();
      canvasMat.dispose();
      flagGeo.dispose();
      poleGeo.dispose();
    },
  };
}

// ---------------------------------------------------------------- building types

type HouseKind = 'street' | 'back' | 'farm' | 'shed';
function house(hi: Buckets, lo: Buckets, x: number, z: number, y: number, yaw: number, w: number, d: number, floors: number, tier: number, pal: Pal, r: Rng, lod: boolean, kind: HouseKind) {
  const f = fr(x, z, yaw);
  const shed = kind === 'shed';
  const stoneHouse = !shed && r.chance(tier >= 2 ? 0.2 : 0.08);
  const humble = tier === 0 || kind === 'farm' || shed;
  const thatched = humble && r.chance(shed ? 0.45 : tier === 0 ? 0.75 : 0.5);
  const wallC = pal.plaster();
  const stoneC = pal.stone();
  const timberC = pal.timber();
  const groundH = shed ? 2.5 : humble ? 3.0 : 3.3;
  let yy = y - 1.2;
  // plinth into the slope
  lbox(hi.rubble, f, 0, 0, w + 0.1, d + 0.1, yy, 1.4, stoneC.clone().multiplyScalar(0.8));
  yy += 1.2;
  // ground floor: shops on the street, plain walls elsewhere; darkened toward the ground
  const gB = shed ? (r.chance(0.5) ? hi.wood : hi.plaster) : stoneHouse ? hi.ashlar : kind === 'street' && !humble ? hi.shop : humble ? hi.plaster : r.chance(0.5) ? hi.shop : hi.plaster;
  const gC = gB === hi.wood ? timberC.clone().lerp(new THREE.Color(0.55, 0.45, 0.33), 0.5) : stoneHouse ? stoneC : wallC;
  storey(gB, f, w, d, yy, groundH, gC, gB === hi.ashlar ? 4 : gB === hi.wood ? 3 : gB === hi.plaster ? 4 : 8.8, r.next(), gB !== hi.plaster && gB !== hi.wood, 0, 0, 0.42);
  yy += groundH;
  // upper storeys, each jettied out a little over the street
  const jet = stoneHouse || humble ? 0 : r.range(0.3, 0.55);
  let jf = 0;
  const upperB = stoneHouse ? hi.ashlar : hi.timber;
  for (let k = 1; k < floors; k++) {
    jf += jet;
    if (jet > 0) slab(hi.dark, f, w, jet, yy, timberC.clone().multiplyScalar(0.5), false);
    storey(upperB, f, w, d, yy, 2.8, stoneHouse ? stoneC : wallC, stoneHouse ? 4 : 8.8, r.next(), true, jf, jf * 0.5);
    yy += 2.8;
  }
  // roof: gable to the street in towns, eaves to the street in villages
  const rc = thatched ? pal.thatch() : pal.roof();
  const roofB = thatched ? hi.thatch : hi.roof;
  const pitch = thatched ? r.range(0.95, 1.15) : humble ? r.range(0.7, 0.85) : r.range(0.85, 1.1);
  const gableFront = !humble && kind === 'street' && r.chance(0.6);
  const deepD = d + jf * 1.5;
  const zc = (jf - jf * 0.5) / 2;
  const rf = fr(f(0, 0, zc).x, f(0, 0, zc).z, gableFront ? yaw + Math.PI / 2 : yaw);
  const spanW = gableFront ? deepD : w;
  const spanD = gableFront ? w : deepD;
  const rh = (spanD / 2) * pitch;
  const oh = thatched ? 0.7 : 0.5;
  const gableB = stoneHouse ? hi.ashlar : humble ? hi.plaster : hi.timber;
  if ((thatched && r.chance(0.35)) || (!humble && r.chance(0.12) && !gableFront)) hip(roofB, rf, spanW, spanD, yy, rh, rc, oh);
  else gable(roofB, gableB, hi.dark, rf, spanW, spanD, yy, rh, rc, stoneHouse ? stoneC : wallC, oh, stoneHouse ? 4 : humble ? 4 : 8.8);
  // dormer on big roofs
  if (!humble && !gableFront && w > 6.5 && r.chance(0.4)) {
    const df = fr(rf(0, 0, spanD * 0.2).x, rf(0, 0, spanD * 0.2).z, yaw);
    const dy = yy + rh * 0.25;
    storey(hi.timber, df, 1.8, 1.6, dy, 1.6, wallC, 8.8, 0.25, true);
    gable(roofB, hi.timber, hi.dark, fr(df(0, 0, 0).x, df(0, 0, 0).z, yaw + Math.PI / 2), 2.2, 1.8, dy + 1.6, 0.9, rc, wallC, 0.15);
  }
  // chimney
  if (!shed && r.chance(humble ? 0.5 : 0.8)) {
    const cxl = r.range(-spanW * 0.3, spanW * 0.3);
    const czl = r.range(-0.4, 0.4) * spanD * 0.3;
    const p = rf(cxl, 0, czl);
    const cf = fr(p.x, p.z, yaw);
    lbox(hi.rubble, cf, 0, 0, 0.9, 0.9, yy + rh * 0.3, rh * 0.75 + 1.4, stoneC.clone().multiplyScalar(0.8));
    lbox(hi.dark, cf, 0, 0, 1.1, 1.1, yy + rh * 1.05 + 1.4, 0.18, new THREE.Color(0.2, 0.18, 0.16));
  }
  // a hanging sign or a flower box now and then on the street front
  if (kind === 'street' && r.chance(0.22)) {
    const p = f(w * 0.3, 0, d / 2 + 0.5);
    lbox(hi.wood, fr(p.x, p.z, yaw), 0, 0, 0.08, 0.9, y + groundH + 0.2, 0.08, timberC);
    lbox(hi.cloth, fr(p.x, p.z, yaw), 0, 0.5, 0.06, 0.7, y + groundH - 0.8, 0.6, new THREE.Color().setHSL(r.next(), 0.55, 0.35));
  }
  if (lod || kind === 'street') {
    const lf = fr(x, z, yaw);
    const hTot = yy - y;
    lbox(stoneHouse ? lo.ashlar : lo.plaster, lf, 0, 0, w, d, y - 1, hTot + 1, stoneHouse ? stoneC : wallC, 0.25);
    gable(thatched ? lo.thatch : lo.roof, null, lo.dark, fr(x, z, gableFront ? yaw + Math.PI / 2 : yaw), gableFront ? d : w, gableFront ? w : d, yy, rh, rc, wallC, 0.4);
  }
}

function church(hi: Buckets, lo: Buckets, x: number, z: number, y: number, yaw: number, s: number, stoneC: THREE.Color, roofC: THREE.Color, flagsAt: { pos: THREE.Vector3; size: number }[], lamps: THREE.Vector3[]) {
  const f = fr(x, z, yaw);
  const pale = stoneC.clone().lerp(new THREE.Color(0.86, 0.82, 0.74), 0.5);
  const slate = new THREE.Color(0.42, 0.44, 0.5);
  const w = 11 * s;
  const d = 28 * s;
  const h = 13 * s;
  // nave: ridge along the length (local z) → roof built in a frame rotated 90°
  lbox(hi.rubble, f, 0, 0, w + 0.2, d + 0.2, y - 2, 2.2, pale.clone().multiplyScalar(0.85));
  storey(hi.ashlar, f, w, d, y, h, pale, 4, 0.3, false);
  const nf = fr(x, z, yaw + Math.PI / 2);
  gable(hi.slate, hi.ashlar, hi.dark, nf, d, w, y + h, w * 0.62, slate, pale, 0.4, 4);
  // aisles
  for (const sd of [-1, 1]) {
    const af = fr(f(sd * (w / 2 + 2.2 * s), 0, 0).x, f(sd * (w / 2 + 2.2 * s), 0, 0).z, yaw);
    storey(hi.ashlar, af, 4.4 * s, d * 0.8, y, h * 0.55, pale, 4, 0.1, false);
    // lean-to roof
    const a1 = af(-sd * 2.2 * s, y + h * 0.55 + 2 * s, d * 0.4);
    const b1 = af(-sd * 2.2 * s, y + h * 0.55 + 2 * s, -d * 0.4);
    const c1 = af(sd * 2.6 * s, y + h * 0.55 - 0.3, -d * 0.4);
    const d1 = af(sd * 2.6 * s, y + h * 0.55 - 0.3, d * 0.4);
    if (sd > 0) quad(hi.slate, a1, d1, c1, b1, [0, 0], [1.5, 0], [1.5, 8], [0, 8], slate);
    else quad(hi.slate, a1, b1, c1, d1, [0, 0], [8, 0], [8, 1.5], [0, 1.5], slate);
    // buttresses and lancet windows
    for (let k = 0; k < 6; k++) {
      const lz = -d * 0.4 + (k * d * 0.8) / 5;
      const bp = f(sd * (w / 2 + 4.6 * s), 0, lz);
      lbox(hi.ashlar, fr(bp.x, bp.z, yaw), 0, 0, 1.0 * s, 1.4 * s, y - 1, h * 0.5 + 1, pale);
      if (k < 5) {
        const wp = f(sd * (w / 2 + 0.03), 0, lz + d * 0.08);
        const wf = fr(wp.x, wp.z, yaw + (sd * Math.PI) / 2);
        const gw = 1.1 * s;
        quad(hi.glass, wf(-gw / 2, y + h * 0.58, 0), wf(gw / 2, y + h * 0.58, 0), wf(gw / 2, y + h * 0.92, 0), wf(-gw / 2, y + h * 0.92, 0), [0, 0], [1, 0], [1, 1], [0, 1], new THREE.Color(0.6, 0.5, 0.7));
      }
    }
  }
  // west tower with belfry and spire (at local -z end)
  const tw = 7 * s;
  const tp = f(0, 0, -d / 2 - tw / 2 + 0.5);
  const tf = fr(tp.x, tp.z, yaw);
  const th = 26 * s;
  storey(hi.ashlar, tf, tw, tw, y - 1, th, pale, 4, 0.7, false);
  for (let k = 0; k < 4; k++) {
    const bf = fr(tp.x, tp.z, yaw + (k * Math.PI) / 2);
    quad(hi.dark, bf(-tw * 0.22, y + th - 5 * s, tw / 2 + 0.03), bf(tw * 0.22, y + th - 5 * s, tw / 2 + 0.03), bf(tw * 0.22, y + th - 1.5 * s, tw / 2 + 0.03), bf(-tw * 0.22, y + th - 1.5 * s, tw / 2 + 0.03), [0, 0], [1, 0], [1, 1], [0, 1], new THREE.Color(0.08, 0.06, 0.05));
  }
  // corner pinnacles and the spire
  for (const [ax, az] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const p = tf(ax * tw * 0.42, 0, az * tw * 0.42);
    coneR(hi.slate, p.x, p.z, y + th - 1, 0.7 * s, 3.2 * s, 5, slate);
  }
  coneR(hi.slate, tp.x, tp.z, y + th - 1, tw * 0.52, 20 * s, 8, slate);
  cyl(lo.ashlar, tp.x, tp.z, y - 1, tw * 0.55, tw * 0.55, th, 4, pale);
  coneR(lo.slate, tp.x, tp.z, y + th - 1, tw * 0.52, 20 * s, 4, slate);
  // rose window over the west door
  const rw = tf(0, 0, -tw / 2 - 0.03);
  const rf = fr(rw.x, rw.z, yaw + Math.PI);
  const rr = 1.6 * s;
  for (let k = 0; k < 12; k++) {
    const a0 = (k / 12) * Math.PI * 2;
    const a1 = ((k + 1) / 12) * Math.PI * 2;
    hi.glass.tri(rf(0, y + th * 0.45, 0), rf(Math.cos(a0) * rr, y + th * 0.45 + Math.sin(a0) * rr, 0), rf(Math.cos(a1) * rr, y + th * 0.45 + Math.sin(a1) * rr, 0), [0.5, 0.5], [1, 0], [1, 1], new THREE.Color(0.55, 0.45, 0.8));
  }
  quad(hi.dark, rf(-1.2 * s, y, 0), rf(1.2 * s, y, 0), rf(1.2 * s, y + 3.6 * s, 0), rf(-1.2 * s, y + 3.6 * s, 0), [0, 0], [1, 0], [1, 1], [0, 1], new THREE.Color(0.18, 0.11, 0.06));
  // apse at the east end
  const ap = f(0, 0, d / 2);
  cyl(hi.ashlar, ap.x, ap.z, y, w * 0.45, w * 0.45, h * 0.8, 10, pale, 0.25, false);
  coneR(hi.slate, ap.x, ap.z, y + h * 0.8, w * 0.5, w * 0.45, 10, slate);
  // lo
  lbox(lo.ashlar, f, 0, 0, w, d, y - 1, h + 1, pale);
  gable(lo.slate, null, lo.dark, nf, d, w, y + h, w * 0.62, slate, pale, 0.3);
  flagsAt.push({ pos: V(tp.x, y + th + 19 * s, tp.z), size: 0.6 * s + 0.4 });
  lamps.push(V(x, y + h * 0.7, z));
}

function guildHall(hi: Buckets, lo: Buckets, x: number, z: number, y: number, yaw: number, stoneC: THREE.Color, roofC: THREE.Color, flagsAt: { pos: THREE.Vector3; size: number }[], lamps: THREE.Vector3[]) {
  const f = fr(x, z, yaw);
  const w = 16;
  const d = 12;
  const pale = stoneC.clone().lerp(new THREE.Color(0.9, 0.84, 0.72), 0.45);
  lbox(hi.rubble, f, 0, 0, w, d, y - 2, 2.2, pale.clone().multiplyScalar(0.8));
  // arcaded ground floor
  storey(hi.ashlar, f, w, d, y, 4.5, pale, 4, 0, false);
  for (let k = 0; k < 4; k++) {
    const lx = -w / 2 + 2 + k * 4;
    quad(hi.dark, f(lx - 1.3, y, d / 2 + 0.03), f(lx + 1.3, y, d / 2 + 0.03), f(lx + 1.3, y + 3.4, d / 2 + 0.03), f(lx - 1.3, y + 3.4, d / 2 + 0.03), [0, 0], [1, 0], [1, 1], [0, 1], new THREE.Color(0.1, 0.08, 0.06));
  }
  storey(hi.shop, f, w, d, y + 4.5, 3.2, pale, 8.8, 0.5, true);
  storey(hi.timber, f, w, d, y + 7.7, 2.8, pale, 8.8, 0.2, true, 0.4, 0.2);
  const top = y + 10.5;
  // stepped gable facing the square (ridge runs front-to-back)
  const gf = fr(x, z, yaw + Math.PI / 2);
  gable(hi.roof, null, hi.dark, gf, d + 0.6, w, top, w * 0.5, roofC.clone().multiplyScalar(0.9), pale, 0.1);
  for (let k = 0; k < 6; k++) {
    const sw = w * (1 - k / 6);
    lbox(hi.ashlar, f, 0, d / 2 + 0.2, sw, 0.6, top + k * 1.25, 1.35, pale);
  }
  // bell turret on the ridge
  const bt = f(0, 0, -1);
  cyl(hi.wood, bt.x, bt.z, top + w * 0.35, 1.2, 1.2, 3, 8, new THREE.Color(0.5, 0.36, 0.22), 0.3, false);
  coneR(hi.slate, bt.x, bt.z, top + w * 0.35 + 3, 1.6, 3.5, 8, new THREE.Color(0.35, 0.37, 0.42));
  lbox(lo.ashlar, f, 0, 0, w, d, y - 1, 11.5, pale);
  flagsAt.push({ pos: V(bt.x, top + w * 0.35 + 6.5, bt.z), size: 0.7 });
  lamps.push(V(x, y + 5, z));
}

function manor(hi: Buckets, lo: Buckets, x: number, z: number, y: number, yaw: number, stoneC: THREE.Color, roofC: THREE.Color, style: ArchStyle, flagsAt: { pos: THREE.Vector3; size: number }[]) {
  const f = fr(x, z, yaw);
  lbox(hi.rubble, f, 0, 0, 18.2, 10.2, y - 2, 2.2, stoneC.clone().multiplyScalar(0.8));
  storey(hi.ashlar, f, 18, 10, y, 7, stoneC, 4, 0, false);
  gable(hi.roof, hi.ashlar, hi.dark, f, 18, 10, y + 7, 5, roofC, stoneC, 0.4, 4);
  const t = f(10, 0, 0);
  const tf = fr(t.x, t.z, yaw);
  storey(hi.ashlar, tf, 7, 7, y - 1, 19, stoneC, 4, 0.4, false);
  for (const [a, b] of [
    [tf(-3.5, 0, 3.5), tf(3.5, 0, 3.5)],
    [tf(3.5, 0, 3.5), tf(3.5, 0, -3.5)],
    [tf(3.5, 0, -3.5), tf(-3.5, 0, -3.5)],
    [tf(-3.5, 0, -3.5), tf(-3.5, 0, 3.5)],
  ])
    merlonRow(hi.ashlar, a.x, a.z, b.x, b.z, y + 18, 0.7, stoneC, 1.0);
  if (style.towerTop !== 'crenel') coneR(hi.roof, t.x, t.z, y + 18, 4.2, 6, 4, roofC);
  lbox(lo.ashlar, f, 0, 0, 18, 10, y - 1, 8, stoneC);
  lbox(lo.ashlar, tf, 0, 0, 7, 7, y - 1, 20, stoneC);
  flagsAt.push({ pos: V(t.x, y + 19, t.z), size: 1.0 });
  return y + 19;
}

function castle(hi: Buckets, lo: Buckets, geo: WorldGeo, x: number, z: number, yaw: number, s: number, stoneC: THREE.Color, roofC: THREE.Color, roof2C: THREE.Color, style: ArchStyle, flagsAt: { pos: THREE.Vector3; size: number }[], lamps: THREE.Vector3[]): number {
  const H = (px: number, pz: number) => heightAt(geo, px, pz);
  const f = fr(x, z, yaw);
  const y = H(x, z);
  const bw = 46 * s;
  const cw = 2.8;
  const wh = 11 * s;
  // curtain wall around the bailey
  const corners = [f(-bw / 2, 0, -bw / 2), f(bw / 2, 0, -bw / 2), f(bw / 2, 0, bw / 2), f(-bw / 2, 0, bw / 2)];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    if (i === 2) {
      // gatehouse in the side facing the town (local +z)
      const m = f(0, 0, bw / 2);
      const u = V(b.x - a.x, 0, b.z - a.z).normalize();
      wallRun(hi, lo, geo, a.x, a.z, m.x - u.x * 6, m.z - u.z * 6, wh, cw, stoneC, 2, stoneC);
      wallRun(hi, lo, geo, m.x + u.x * 6, m.z + u.z * 6, b.x, b.z, wh, cw, stoneC, 2, stoneC);
      gatehouse(hi, lo, m.x, m.z, H(m.x, m.z), Math.atan2(u.x, u.z), wh, 2, stoneC, roofC, stoneC, style, flagsAt);
    } else wallRun(hi, lo, geo, a.x, a.z, b.x, b.z, wh, cw, stoneC, 2, stoneC);
  }
  for (const c of corners) wallTower(hi, lo, c.x, c.z, H(c.x, c.z), wh, 3, stoneC, roofC, stoneC, style, flagsAt);
  // the keep
  const kw = 18 * s;
  const kh = 30 * s;
  const kp = f(0, 0, -bw * 0.12);
  const kf = fr(kp.x, kp.z, yaw);
  const ky = H(kp.x, kp.z);
  lbox(hi.rubble, kf, 0, 0, kw + 2, kw + 2, ky - 3, 4, stoneC.clone().multiplyScalar(0.8));
  storey(hi.ashlar, kf, kw, kw, ky, kh, stoneC, 4, 0.2, false);
  slab(hi.ashlar, kf, kw, kw, ky + kh, stoneC);
  // corbelled parapet with machicolations
  const top = ky + kh;
  lbox(hi.ashlar, kf, 0, 0, kw + 1.4, kw + 1.4, top - 0.2, 1.6, stoneC.clone().multiplyScalar(1.03));
  for (let k = 0; k < 4; k++) {
    const ff = fr(kp.x, kp.z, yaw + (k * Math.PI) / 2);
    const n = Math.floor(kw / 1.6);
    for (let i = 0; i < n; i++) {
      const lx = -kw / 2 + (i + 0.5) * (kw / n);
      lbox(hi.ashlar, ff, lx, kw / 2 + 0.35, 0.5, 0.7, top - 1.3, 1.1, stoneC.clone().multiplyScalar(0.9));
    }
  }
  const kc = [kf(-kw / 2 - 0.7, 0, -kw / 2 - 0.7), kf(kw / 2 + 0.7, 0, -kw / 2 - 0.7), kf(kw / 2 + 0.7, 0, kw / 2 + 0.7), kf(-kw / 2 - 0.7, 0, kw / 2 + 0.7)];
  for (let i = 0; i < 4; i++) merlonRow(hi.ashlar, kc[i].x, kc[i].z, kc[(i + 1) % 4].x, kc[(i + 1) % 4].z, top + 1.4, 0.8, stoneC, 1.2);
  // arrow slits and windows
  for (let k = 0; k < 4; k++) {
    const ff = fr(kp.x, kp.z, yaw + (k * Math.PI) / 2);
    for (let row = 0; row < 3; row++)
      for (let i = -1; i <= 1; i++) {
        const wy = ky + kh * (0.3 + row * 0.22);
        const big = row === 2;
        const ww = big ? 1.1 : 0.35;
        const whh = big ? 2.0 : 1.6;
        quad(big ? hi.glass : hi.dark, ff(i * kw * 0.28 - ww / 2, wy, kw / 2 + 0.03), ff(i * kw * 0.28 + ww / 2, wy, kw / 2 + 0.03), ff(i * kw * 0.28 + ww / 2, wy + whh, kw / 2 + 0.03), ff(i * kw * 0.28 - ww / 2, wy + whh, kw / 2 + 0.03), [0, 0], [1, 0], [1, 1], [0, 1], big ? new THREE.Color(0.7, 0.6, 0.5) : new THREE.Color(0.05, 0.04, 0.03));
      }
  }
  // corner turrets rising above the keep
  for (const c of [kf(-kw / 2, 0, -kw / 2), kf(kw / 2, 0, -kw / 2), kf(kw / 2, 0, kw / 2), kf(-kw / 2, 0, kw / 2)]) {
    cyl(hi.ashlar, c.x, c.z, ky + kh * 0.5, 2.6 * s, 2.4 * s, kh * 0.5 + 7, 12, stoneC, 0.25);
    if (style.towerTop === 'crenel') {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const cp = V(c.x + Math.cos(a) * 2.3 * s, 0, c.z + Math.sin(a) * 2.3 * s);
        lbox(hi.ashlar, fr(cp.x, cp.z, -a), 0, 0, 1, 0.7, ky + kh + 7, 1.1, stoneC);
      }
    } else coneR(hi.roof, c.x, c.z, ky + kh + 7, 3.1 * s, style.towerTop === 'spire' ? 9 : 6, 12, roofC);
    cyl(lo.ashlar, c.x, c.z, ky + kh * 0.5, 2.6 * s, 2.4 * s, kh * 0.5 + 7, 6, stoneC);
  }
  let roofTop = top + 2.5;
  if (style.towerTop !== 'crenel') {
    const pr = fr(kp.x, kp.z, yaw);
    hip(hi.roof, pr, kw - 1, kw - 1, top + 0.2, style.towerTop === 'spire' ? 11 : 7, roof2C, 0);
    roofTop = top + (style.towerTop === 'spire' ? 11 : 7);
  }
  lbox(lo.ashlar, kf, 0, 0, kw, kw, ky - 1, kh + 2, stoneC);
  // great hall and chapel inside the bailey
  const hp = f(-bw * 0.22, 0, bw * 0.18);
  const hf = fr(hp.x, hp.z, yaw + Math.PI / 2);
  const hy = H(hp.x, hp.z);
  storey(hi.ashlar, hf, 20 * s, 9 * s, hy - 1, 8 * s, stoneC, 4, 0.5, false);
  gable(hi.roof, hi.ashlar, hi.dark, hf, 20 * s, 9 * s, hy - 1 + 8 * s, 4.5 * s, roofC, stoneC, 0.4, 4);
  lbox(lo.ashlar, hf, 0, 0, 20 * s, 9 * s, hy - 1, 9 * s, stoneC);
  flagsAt.unshift({ pos: V(kp.x, roofTop, kp.z), size: 1.7 * s });
  lamps.push(V(kp.x, ky + kh * 0.7, kp.z), V(hp.x, hy + 4, hp.z));
  return roofTop;
}

function wallRun(hi: Buckets, lo: Buckets, geo: WorldGeo, ax: number, az: number, bx: number, bz: number, h: number, t: number, col: THREE.Color, level: number, timber: THREE.Color) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.5) return;
  const segs = Math.max(1, Math.ceil(len / 6));
  const yaw = Math.atan2(bx - ax, bz - az);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const x0 = ax + (bx - ax) * t0;
    const z0 = az + (bz - az) * t0;
    const x1 = ax + (bx - ax) * t1;
    const z1 = az + (bz - az) * t1;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const y = Math.min(heightAt(geo, x0, z0), heightAt(geo, x1, z1), heightAt(geo, mx, mz));
    const sl = len / segs + 0.25;
    const f = fr(mx, mz, yaw);
    if (level === 1) {
      // palisade of sharpened stakes with a walkway
      const n = Math.max(2, Math.round(sl / 0.7));
      for (let k = 0; k < n; k++) {
        const tt = (k + 0.5) / n;
        const px = x0 + (x1 - x0) * tt;
        const pz = z0 + (z1 - z0) * tt;
        const yy = heightAt(geo, px, pz);
        cyl(hi.wood, px, pz, yy - 1, 0.35, 0.32, h + 1, 5, timber.clone().multiplyScalar(0.9 + (k % 3) * 0.06), 0.3, false);
        coneR(hi.wood, px, pz, yy + h, 0.32, 0.8, 5, timber);
      }
      lbox(lo.wood, f, 0, 0, 0.7, sl, y - 1, h + 1, timber, 0.3);
    } else {
      storey(hi.rubble, f, t, sl, y - 2, h + 2, col, 3, i * 0.21, false);
      slab(hi.ashlar, f, t, sl, y + h, col.clone().multiplyScalar(0.95));
      // crenellations on the field side, a low parapet on the town side
      const nx = Math.cos(yaw);
      const nz = -Math.sin(yaw);
      merlonRow(hi.ashlar, x0 + nx * (t / 2 - 0.3), z0 + nz * (t / 2 - 0.3), x1 + nx * (t / 2 - 0.3), z1 + nz * (t / 2 - 0.3), y + h, 0.6, col, 1.05);
      lbox(hi.ashlar, f, -t / 2 + 0.25, 0, 0.5, sl, y + h, 0.7, col);
      // string course
      lbox(hi.ashlar, f, 0, 0, t + 0.3, sl, y + h * 0.85, 0.35, col.clone().multiplyScalar(1.05));
      lbox(lo.rubble, f, 0, 0, t, sl, y - 2, h + 2.8, col, 0.3);
    }
  }
}

function wallTower(hi: Buckets, lo: Buckets, x: number, z: number, y: number, wallH: number, level: number, stoneC: THREE.Color, roofC: THREE.Color, timberC: THREE.Color, style: ArchStyle, flagsAt: { pos: THREE.Vector3; size: number }[] | null) {
  if (level === 1) {
    const f = fr(x, z, 0);
    storey(hi.wood, f, 3.2, 3.2, y - 1, wallH + 3.5, timberC, 3, 0, false);
    const rf = fr(x, z, 0);
    hip(hi.roof, rf, 4, 4, y + wallH + 2.5, 2.6, roofC, 0.2);
    lbox(lo.wood, f, 0, 0, 3.2, 3.2, y - 1, wallH + 4, timberC);
    return;
  }
  const tr = level >= 3 ? 5.2 : 4.3;
  const th = wallH + 6;
  cyl(hi.rubble, x, z, y - 3, tr * 1.08, tr, th + 3, 14, stoneC, 0.3);
  // string course and arrow slits
  cyl(hi.ashlar, x, z, y + th * 0.7, tr + 0.2, tr + 0.2, 0.4, 14, stoneC.clone().multiplyScalar(1.05), 0.3);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const p = V(x + Math.cos(a) * (tr + 0.02), 0, z + Math.sin(a) * (tr + 0.02));
    const f = fr(p.x, p.z, Math.PI / 2 - a);
    quad(hi.dark, f(-0.18, y + th * 0.4, 0), f(0.18, y + th * 0.4, 0), f(0.18, y + th * 0.4 + 1.6, 0), f(-0.18, y + th * 0.4 + 1.6, 0), [0, 0], [1, 0], [1, 1], [0, 1], new THREE.Color(0.05, 0.04, 0.03));
  }
  if (style.towerTop === 'crenel' || style.towerTop === 'dome') {
    cyl(hi.ashlar, x, z, y + th, tr + 0.5, tr + 0.5, 0.6, 14, stoneC, 0.3);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const p = V(x + Math.cos(a) * (tr + 0.1), 0, z + Math.sin(a) * (tr + 0.1));
      lbox(hi.ashlar, fr(p.x, p.z, -a + Math.PI / 2), 0, 0, 1.2, 0.8, y + th + 0.6, 1.2, stoneC);
    }
    if (style.towerTop === 'dome') coneR(hi.roof, x, z, y + th + 0.6, tr * 0.8, 3.2, 12, roofC);
  } else {
    coneR(hi.roof, x, z, y + th, tr * 1.22, style.towerTop === 'spire' ? tr * 2.6 : tr * 1.7, 14, roofC);
  }
  cyl(lo.rubble, x, z, y - 3, tr, tr, th + 3, 6, stoneC);
  if (style.towerTop !== 'crenel') coneR(lo.roof, x, z, y + th, tr * 1.2, tr * 1.7, 6, roofC);
  if (flagsAt) flagsAt.push({ pos: V(x, y + th + (style.towerTop === 'crenel' ? 1.2 : style.towerTop === 'spire' ? tr * 2.6 : tr * 1.7), z), size: 0.7 });
}

function gatehouse(hi: Buckets, lo: Buckets, x: number, z: number, y: number, yawAlong: number, wallH: number, level: number, stoneC: THREE.Color, roofC: THREE.Color, timberC: THREE.Color, style: ArchStyle, flagsAt: { pos: THREE.Vector3; size: number }[]) {
  const f = fr(x, z, yawAlong);
  if (level === 1) {
    for (const s of [-1, 1]) {
      const p = f(0, 0, s * 5);
      storey(hi.wood, fr(p.x, p.z, yawAlong), 3.4, 3.4, y - 1, wallH + 5, timberC, 3, 0, false);
      hip(hi.roof, fr(p.x, p.z, yawAlong), 4.2, 4.2, y + wallH + 4, 2.8, roofC, 0.2);
    }
    lbox(hi.wood, f, 0, 0, 2.5, 10, y + 5, 1.2, timberC);
    flagsAt.push({ pos: V(x, y + wallH + 3, z), size: 0.8 });
    return;
  }
  const gw = 5;
  // flanking towers
  for (const s of [-1, 1]) {
    const p = f(0, 0, s * (gw / 2 + 3.4));
    cyl(hi.rubble, p.x, p.z, y - 3, 4.4, 4.0, wallH + 10, 14, stoneC, 0.3);
    if (style.towerTop === 'crenel') {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const q = V(p.x + Math.cos(a) * 3.9, 0, p.z + Math.sin(a) * 3.9);
        lbox(hi.ashlar, fr(q.x, q.z, -a + Math.PI / 2), 0, 0, 1.2, 0.8, y + wallH + 7, 1.2, stoneC);
      }
    } else coneR(hi.roof, p.x, p.z, y + wallH + 7, 5, style.towerTop === 'spire' ? 11 : 7, 14, roofC);
    cyl(lo.rubble, p.x, p.z, y - 3, 4.2, 4.2, wallH + 10, 6, stoneC);
    flagsAt.push({ pos: V(p.x, y + wallH + (style.towerTop === 'crenel' ? 8 : style.towerTop === 'spire' ? 18 : 14), p.z), size: 0.9 });
  }
  // the gate block with an arched passage
  const depth = 8;
  const arch = 6;
  lbox(hi.ashlar, f, 0, 0, depth, gw + 1, y + arch, wallH + 2 - arch, stoneC);
  for (const sd of [-1, 1]) {
    const p = f(sd * depth * 0.5 + sd * 0.03, 0, 0);
    const af = fr(p.x, p.z, yawAlong + (sd * Math.PI) / 2);
    const n = 8;
    // dark arched opening and the portcullis
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI;
      const a1 = ((k + 1) / n) * Math.PI;
      hi.dark.tri(af(0, y + arch - 1.6, 0), af(Math.cos(a0) * gw * 0.45, y + arch - 1.6 + Math.sin(a0) * 1.6, 0), af(Math.cos(a1) * gw * 0.45, y + arch - 1.6 + Math.sin(a1) * 1.6, 0), [0, 0], [1, 0], [1, 1], new THREE.Color(0.06, 0.05, 0.04));
    }
    quad(hi.dark, af(-gw * 0.45, y - 0.2, 0), af(gw * 0.45, y - 0.2, 0), af(gw * 0.45, y + arch - 1.6, 0), af(-gw * 0.45, y + arch - 1.6, 0), [0, 0], [1, 0], [1, 1], [0, 1], new THREE.Color(0.06, 0.05, 0.04));
    for (let k = 0; k < 6; k++) {
      const lx = -gw * 0.4 + (k * gw * 0.8) / 5;
      trimBeam(hi.dark, af(lx, y + 1.5, 0.05), af(lx, y + arch - 1.2, 0.05), 0.12, 0.08, new THREE.Color(0.2, 0.2, 0.22));
    }
    for (let k = 0; k < 4; k++) trimBeam(hi.dark, af(-gw * 0.42, y + 1.8 + k * 1.1, 0.07), af(gw * 0.42, y + 1.8 + k * 1.1, 0.07), 0.1, 0.08, new THREE.Color(0.2, 0.2, 0.22));
  }
  // side walls of the passage
  for (const sd of [-1, 1]) lbox(hi.ashlar, f, 0, sd * (gw / 2 + 0.4), depth, 0.8, y - 1, arch + 1, stoneC);
  const bf = [f(-depth / 2, 0, -gw / 2 - 0.5), f(-depth / 2, 0, gw / 2 + 0.5)];
  merlonRow(hi.ashlar, bf[0].x, bf[0].z, bf[1].x, bf[1].z, y + wallH + 2, 0.7, stoneC, 1.05);
  lbox(lo.ashlar, f, 0, 0, depth, gw + 1, y - 1, wallH + 3, stoneC);
}

function market(hi: Buckets, px: number, pz: number, H: (x: number, z: number) => number, plazaR: number, tier: number, timberC: THREE.Color, stoneC: THREE.Color, r: Rng, walk: THREE.Vector3[], lamps: THREE.Vector3[]) {
  const y = H(px, pz);
  // well with a tiled canopy, or a market cross on small greens
  cyl(hi.rubble, px, pz, y - 0.5, 1.5, 1.5, 1.4, 12, stoneC, 0.3, false);
  cyl(hi.dark, px, pz, y + 0.7, 1.2, 1.2, 0.05, 12, new THREE.Color(0.05, 0.08, 0.1), 0.3, true);
  for (const s of [-1, 1]) {
    const p = V(px + s * 1.3, 0, pz);
    lbox(hi.wood, fr(p.x, p.z, 0), 0, 0, 0.25, 0.25, y + 0.9, 2.2, timberC);
  }
  gable(hi.roof, null, hi.dark, fr(px, pz, 0), 3.2, 3.0, y + 3.1, 1.1, new THREE.Color(0.55, 0.3, 0.22), timberC, 0.25);
  if (tier < 1) return;
  const n = tier >= 3 ? 14 : tier === 2 ? 11 : 6;
  const canopy = ['#8c2f2a', '#2f5d8c', '#c9a14a', '#4f7a3a', '#e6dcc6', '#6b3f7a', '#b8612e'];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.08, 0.08);
    const rr = plazaR - 4 - (i % 2) * 3.5;
    const sx = px + Math.cos(a) * rr;
    const sz = pz + Math.sin(a) * rr;
    const sy = H(sx, sz);
    const yaw = -a - Math.PI / 2;
    const f = fr(sx, sz, yaw);
    lbox(hi.wood, f, 0, 0, 2.8, 1.4, sy, 0.95, timberC.clone().multiplyScalar(1.1));
    // goods on the counter
    for (let k = 0; k < 4; k++) lbox(hi.cloth, f, -1 + k * 0.65, 0, 0.45, 0.45, sy + 0.95, 0.3, new THREE.Color().setHSL(r.next(), 0.5, 0.45));
    const cc = new THREE.Color(canopy[i % canopy.length]);
    const stripe = cc.clone().lerp(new THREE.Color(0.95, 0.92, 0.85), 0.8);
    // striped awning in panels
    for (let k = 0; k < 4; k++) {
      const x0 = -1.7 + k * 0.85;
      const col = k % 2 ? cc : stripe;
      quad(hi.cloth, f(x0, sy + 2.0, 1.3), f(x0 + 0.85, sy + 2.0, 1.3), f(x0 + 0.85, sy + 2.6, -1.0), f(x0, sy + 2.6, -1.0), [0, 0], [1, 0], [1, 1], [0, 1], col);
    }
    for (const [lx, lz] of [
      [-1.6, 1.2],
      [1.6, 1.2],
      [-1.6, -0.9],
      [1.6, -0.9],
    ])
      lbox(hi.wood, f, lx, lz, 0.14, 0.14, sy, 2.55, timberC);
    walk.push(V(sx, sy, sz));
  }
  lamps.push(V(px, y + 3, pz));
}

let townTrees: THREE.BufferGeometry[] | null = null;
function tree(hi: Buckets, x: number, z: number, y: number, r: Rng) {
  townTrees ??= buildTreeGeometries('lo');
  const t = r.chance(0.78) ? 1 : r.chance(0.6) ? 0 : 2;
  const s = t === 1 ? r.range(0.5, 0.8) : r.range(0.45, 0.65);
  const m = new THREE.Matrix4().compose(V(x, y - 0.2, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r.range(0, Math.PI * 2)), V(s, s * r.range(0.9, 1.1), s));
  const k = 0.9 + r.range(0, 0.25);
  hi.leaf.addGeometry(townTrees[t], m, new THREE.Color(k, k * r.range(0.95, 1.05), k * 0.95));
}

function farmstead(hi: Buckets, lo: Buckets, x: number, z: number, y: number, yaw: number, plasterC: THREE.Color, roofC: THREE.Color, timberC: THREE.Color, r: Rng) {
  const f = fr(x, z, yaw);
  const thatch = new THREE.Color('#e8d7b4');
  storey(hi.plaster, f, 8, 6, y - 0.8, 3.6, plasterC, 4, r.next(), false);
  gable(hi.thatch, hi.plaster, hi.dark, f, 8, 6, y + 2.8, 3.2, thatch, plasterC, 0.7, 4);
  const b = f(9.5, 0, 1.5);
  const bf = fr(b.x, b.z, yaw);
  storey(hi.wood, bf, 9, 6.5, y - 0.8, 4.2, timberC, 3, 0, false);
  gable(hi.roof, hi.wood, hi.dark, bf, 9, 6.5, y + 3.4, 3.2, roofC.clone().multiplyScalar(0.9), timberC, 0.5, 3);
  // haystacks and a fenced yard
  for (let k = 0; k < 3; k++) {
    const p = f(-6 - k * 2.6, 0, 5 + (k % 2) * 2);
    cyl(hi.leaf, p.x, p.z, y - 0.2, 1.3, 0.2, 2.6, 8, thatch.clone().multiplyScalar(0.95), 0.3, false);
  }
  const corners = [f(-10, 0, 3), f(3, 0, 3), f(3, 0, 12), f(-10, 0, 12)];
  for (let i = 0; i < 3; i++) {
    const a = corners[i];
    const b2 = corners[i + 1];
    trimBeam(hi.wood, V(a.x, y + 0.8, a.z), V(b2.x, y + 0.8, b2.z), 0.12, 0.12, timberC);
    trimBeam(hi.wood, V(a.x, y + 0.4, a.z), V(b2.x, y + 0.4, b2.z), 0.12, 0.12, timberC);
  }
  lbox(lo.plaster, f, 0, 0, 8, 6, y - 0.8, 3.6, plasterC);
  gable(lo.thatch, null, lo.dark, f, 8, 6, y + 2.8, 3.2, thatch, plasterC, 0.5);
}

function paveStreet(hi: Buckets, lo: Buckets, st: Street, H: (x: number, z: number) => number) {
  const pts = st.pts;
  const col = new THREE.Color(0.6, 0.54, 0.47);
  let along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.1) continue;
    const segs = Math.max(1, Math.ceil(len / 3));
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs;
      const t1 = (k + 1) / segs;
      const p0x = a.x + (b.x - a.x) * t0;
      const p0z = a.z + (b.z - a.z) * t0;
      const p1x = a.x + (b.x - a.x) * t1;
      const p1z = a.z + (b.z - a.z) * t1;
      const w = st.w / 2;
      const q = [
        [p0x - nx * w, p0z - nz * w],
        [p0x + nx * w, p0z + nz * w],
        [p1x + nx * w, p1z + nz * w],
        [p1x - nx * w, p1z - nz * w],
      ].map(([x, z]) => V(x, Math.max(H(x, z), 1.2) + 0.25, z));
      const u0 = along / 4;
      const u1 = (along + len / segs) / 4;
      quad(hi.cobble, q[0], q[3], q[2], q[1], [0, u0], [0, u1], [st.w / 4, u1], [st.w / 4, u0], col);
      along += len / segs;
    }
  }
  void lo;
}

function paveDisc(hi: Buckets, lo: Buckets, x: number, z: number, r: number, H: (x: number, z: number) => number) {
  const col = new THREE.Color(0.66, 0.6, 0.52);
  const rings = 5;
  const seg = 28;
  for (let i = 0; i < rings; i++) {
    const r0 = (i / rings) * r;
    const r1 = ((i + 1) / rings) * r;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      const pts = [
        [r0, a0],
        [r1, a0],
        [r1, a1],
        [r0, a1],
      ].map(([rr, a]) => {
        const px = x + Math.cos(a) * rr;
        const pz = z + Math.sin(a) * rr;
        return V(px, Math.max(H(px, pz), 1.2) + 0.28, pz);
      });
      quad(hi.cobble, pts[0], pts[3], pts[2], pts[1], [pts[0].x / 4, pts[0].z / 4], [pts[3].x / 4, pts[3].z / 4], [pts[2].x / 4, pts[2].z / 4], [pts[1].x / 4, pts[1].z / 4], col);
    }
  }
  void lo;
}

function buildDocks(hi: Buckets, lo: Buckets, geo: WorldGeo, cx: number, cz: number, R: number, harbor: number, inp: SettlementInput, stoneC: THREE.Color, roofC: THREE.Color, timberC: THREE.Color, r: Rng, docks: THREE.Vector3[], lamps: THREE.Vector3[], flagsAt: { pos: THREE.Vector3; size: number }[], wallH: number) {
  const H = (x: number, z: number) => heightAt(geo, x, z);
  const dx = Math.cos(harbor);
  const dz = Math.sin(harbor);
  let s = R * 0.3;
  while (s < R * 3 && H(cx + dx * s, cz + dz * s) > 0.8) s += 2;
  const shx = cx + dx * s;
  const shz = cz + dz * s;
  const yaw = Math.atan2(dx, dz);
  const deckY = 1.8;
  const plank = new THREE.Color(0.62, 0.5, 0.36);
  // stone quay along the shore
  const qf = fr(shx - dx * 3, shz - dz * 3, yaw);
  lbox(hi.ashlar, qf, 0, 0, 70, 8, -3, deckY + 3, stoneC);
  lbox(lo.ashlar, qf, 0, 0, 70, 8, -3, deckY + 3, stoneC);
  const pierLen = inp.buildings.has('harbor') ? (inp.tier >= 2 ? 52 : 38) : 26;
  const piers: [number, number, number][] = [[0, pierLen, 5]];
  if (inp.buildings.has('trade_docks') || inp.tier >= 3) piers.push([-24, pierLen * 0.8, 4.5], [24, pierLen * 0.7, 4.5]);
  for (const [off, len, w] of piers) {
    const ox = shx - dz * off;
    const oz = shz + dx * off;
    const pf = fr(ox + dx * len * 0.5, oz + dz * len * 0.5, yaw);
    lbox(hi.wood, pf, 0, 0, w, len, deckY - 0.45, 0.45, plank, 0.3);
    lbox(lo.wood, pf, 0, 0, w, len, deckY - 0.45, 0.45, plank, 0.3);
    for (let k = 0; k <= len; k += 5)
      for (const sd of [-1, 1]) {
        const px2 = ox + dx * k - dz * (w / 2) * sd;
        const pz2 = oz + dz * k + dx * (w / 2) * sd;
        cyl(hi.wood, px2, pz2, -6, 0.3, 0.28, deckY + 7, 6, new THREE.Color(0.32, 0.24, 0.16), 0.4, true);
      }
    const ex = ox + dx * len;
    const ez = oz + dz * len;
    lbox(hi.wood, fr(ex, ez, yaw + Math.PI / 2), 0, 0, 18, 4, deckY - 0.45, 0.45, plank, 0.3);
    docks.push(V(ox + dx * len * 0.5, deckY, oz + dz * len * 0.5), V(ex, deckY, ez));
    // barrels, crates and nets
    for (let k = 0; k < 7; k++) {
      const t = r.range(0.1, 0.9) * len;
      const side = r.chance(0.5) ? 1 : -1;
      const bx = ox + dx * t - dz * side * (w / 2 - 0.8);
      const bz = oz + dz * t + dx * side * (w / 2 - 0.8);
      if (r.chance(0.5)) cyl(hi.wood, bx, bz, deckY, 0.45, 0.4, 1.0, 8, new THREE.Color(0.45, 0.32, 0.2), 0.4, true);
      else lbox(hi.wood, fr(bx, bz, yaw + r.range(0, 1)), 0, 0, 1.1, 1.1, deckY, 1.0, new THREE.Color(0.55, 0.42, 0.28));
    }
    lamps.push(V(ex, deckY + 3, ez));
  }
  // warehouses: stone ground floor, timber loft with hoist beams
  const nW = inp.tier >= 2 ? 5 : 2;
  for (let k = 0; k < nW; k++) {
    const off = (k - (nW - 1) / 2) * 15;
    const wx = shx - dx * 14 - dz * off;
    const wz = shz - dz * 14 + dx * off;
    const f = fr(wx, wz, yaw + Math.PI);
    const y = Math.max(deckY, H(wx, wz));
    storey(hi.ashlar, f, 12, 9, y - 1.5, 5, stoneC, 4, k * 0.3, false);
    storey(hi.timber, f, 12, 9, y + 3.5, 2.8, stoneC.clone().lerp(new THREE.Color(1, 1, 1), 0.4), 8.8, k * 0.2);
    gable(hi.roof, hi.timber, hi.dark, f, 12, 9, y + 6.3, 3.6, roofC, stoneC, 0.45);
    lbox(hi.wood, f, 0, 5.2, 0.3, 1.6, y + 6.6, 0.3, timberC);
    quad(hi.dark, f(-1.3, y - 0.2, 4.53), f(1.3, y - 0.2, 4.53), f(1.3, y + 3, 4.53), f(-1.3, y + 3, 4.53), [0, 0], [1, 0], [1, 1], [0, 1], new THREE.Color(0.1, 0.07, 0.05));
    lbox(lo.ashlar, f, 0, 0, 12, 9, y - 1.5, 8, stoneC);
  }
  // treadwheel crane on the quay
  {
    const crx = shx + dx * 2 - dz * 8;
    const crz = shz + dz * 2 + dx * 8;
    const y = deckY;
    const f = fr(crx, crz, yaw);
    storey(hi.wood, f, 4, 4, y, 4, timberC, 3, 0, false);
    gable(hi.roof, hi.wood, hi.dark, f, 4, 4, y + 4, 1.6, roofC, timberC, 0.3, 3);
    trimBeam(hi.wood, f(0, y + 5, 0), f(0, y + 11, 6), 0.45, 0.45, timberC);
    trimBeam(hi.dark, f(0, y + 11, 6), f(0, y + 4, 6), 0.06, 0.06, new THREE.Color(0.15, 0.12, 0.08));
    cyl(hi.wood, f(-2.4, 0, 0).x, f(-2.4, 0, 0).z, y + 1, 2.1, 2.1, 0.5, 14, timberC, 0.3, false);
  }
  // sea towers guarding the harbour mouth
  if (wallH > 0) {
    for (const sd of [-1, 1]) {
      const tx = shx - dz * sd * 40 + dx * 3;
      const tz = shz + dx * sd * 40 + dz * 3;
      const y = Math.max(0, H(tx, tz));
      cyl(hi.rubble, tx, tz, y - 5, 4.8, 4.3, wallH + 12, 14, stoneC, 0.3);
      coneR(hi.roof, tx, tz, y + wallH + 7, 5.4, 7, 14, roofC);
      cyl(lo.rubble, tx, tz, y - 5, 4.6, 4.6, wallH + 12, 6, stoneC);
      lamps.push(V(tx, y + wallH + 5, tz));
      flagsAt.push({ pos: V(tx, y + wallH + 14, tz), size: 0.8 });
    }
  }
  lamps.push(V(shx, 4, shz));
}
