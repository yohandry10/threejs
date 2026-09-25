import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { planksTexture, deckTexture, canvasClothTexture } from '../textures';
import { factionDef } from '../../data/factions';
import { drawHeraldry } from '../../data/heraldry';
import { shipDef } from '../../data/units';

export interface ShipParams {
  length: number;
  beam: number;
  depth: number;
  draft: number;
  sheer: number;
  masts: { z: number; h: number; yard: number; sail: 'square' | 'lateen'; sails: number }[];
  foreCastle: number; // fraction of length
  aftCastle: number;
  castleH: number;
  oars: number;
  bowsprit: boolean;
  shields: boolean;
  transom: number;
}

export function paramsFor(type: string, faction: string): ShipParams {
  const d = shipDef(type);
  const L = d.length;
  switch (type) {
    case 'galley':
      return { length: L, beam: L / 5.8, depth: 3.0, draft: 1.2, sheer: 1.4, masts: [{ z: 0.12, h: L * 0.62, yard: L * 0.62, sail: 'lateen', sails: 1 }], foreCastle: 0.12, aftCastle: 0.14, castleH: 1.8, oars: 14, bowsprit: false, shields: faction === 'ostrevan' || faction === 'korr', transom: 0.25 };
    case 'cog':
      return { length: L, beam: L / 3.0, depth: 5.2, draft: 2.4, sheer: 1.6, masts: [{ z: 0.05, h: L * 0.95, yard: L * 0.62, sail: 'square', sails: 1 }], foreCastle: 0.18, aftCastle: 0.24, castleH: 2.6, oars: 0, bowsprit: true, shields: false, transom: 0.55 };
    case 'hulk':
      return { length: L, beam: L / 3.1, depth: 5.6, draft: 2.6, sheer: 2.2, masts: [{ z: 0.08, h: L * 0.9, yard: L * 0.55, sail: 'square', sails: 1 }, { z: -0.3, h: L * 0.5, yard: L * 0.3, sail: 'lateen', sails: 1 }], foreCastle: 0.15, aftCastle: 0.22, castleH: 2.4, oars: 0, bowsprit: true, shields: false, transom: 0.5 };
    case 'carrack':
      return { length: L, beam: L / 3.3, depth: 6.4, draft: 3.0, sheer: 3.0, masts: [{ z: 0.3, h: L * 0.62, yard: L * 0.34, sail: 'square', sails: 1 }, { z: 0.02, h: L * 0.88, yard: L * 0.48, sail: 'square', sails: 2 }, { z: -0.3, h: L * 0.58, yard: L * 0.34, sail: 'lateen', sails: 1 }], foreCastle: 0.2, aftCastle: 0.28, castleH: 3.2, oars: 0, bowsprit: true, shields: false, transom: 0.6 };
    case 'flagship':
    default:
      return { length: L, beam: L / 3.4, depth: 7.4, draft: 3.4, sheer: 3.6, masts: [{ z: 0.32, h: L * 0.6, yard: L * 0.33, sail: 'square', sails: 2 }, { z: 0.03, h: L * 0.86, yard: L * 0.46, sail: 'square', sails: 3 }, { z: -0.28, h: L * 0.58, yard: L * 0.3, sail: 'lateen', sails: 1 }], foreCastle: 0.22, aftCastle: 0.3, castleH: 3.8, oars: 0, bowsprit: true, shields: false, transom: 0.62 };
  }
}

// ---------------------------------------------------------------- materials (shared)

let mats: {
  hull: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  rope: THREE.LineBasicMaterial;
  metal: THREE.MeshStandardMaterial;
  lantern: THREE.MeshStandardMaterial;
  oar: THREE.MeshStandardMaterial;
} | null = null;

type MatKey = 'hull' | 'deck' | 'wood' | 'darkWood' | 'rope' | 'metal' | 'lantern' | 'oar';

export const shipUniforms = {
  uTime: { value: 0 },
  uLamp: { value: 0 },
  uBacklight: { value: 0.25 },
};

export function shipMaterials() {
  if (mats) return mats;
  const planks = planksTexture();
  const deck = deckTexture();
  mats = {
    hull: new THREE.MeshStandardMaterial({ map: planks, vertexColors: true, roughness: 0.82, metalness: 0.0 }),
    deck: new THREE.MeshStandardMaterial({ map: deck, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.8, vertexColors: true }),
    darkWood: new THREE.MeshStandardMaterial({ color: 0x3d2a1a, roughness: 0.85 }),
    rope: new THREE.LineBasicMaterial({ color: 0x2b2118, transparent: true, opacity: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.45, metalness: 0.8 }),
    lantern: new THREE.MeshStandardMaterial({ color: 0x332211, emissive: new THREE.Color(1.0, 0.62, 0.25), emissiveIntensity: 0 }),
    oar: new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 }),
  };
  mats.lantern.onBeforeCompile = (sh) => {
    sh.uniforms.uLamp = shipUniforms.uLamp;
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= uLamp * 3.0;').replace('uniform vec3 emissive;', 'uniform vec3 emissive;\nuniform float uLamp;');
  };
  mats.lantern.emissiveIntensity = 1;
  // oars rotate around their pivot with a rowing stroke
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
          q = vec3(q.x * cl - q.y * sl * side * -1.0, q.x * sl * side * -1.0 + q.y * cl, q.z);
          transformed = pv + q;
        }`,
      );
  };
  return mats;
}

const sailMatCache = new Map<string, THREE.MeshStandardMaterial>();
const flagMatCache = new Map<string, THREE.MeshStandardMaterial>();

function sailTexture(faction: string, lateen: boolean): THREE.Texture {
  const def = factionDef(faction);
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const base = canvasClothTexture().image as CanvasImageSource;
  ctx.drawImage(base, 0, 0, w, h);
  if (faction === 'pirates') {
    ctx.fillStyle = 'rgba(40,36,34,0.92)';
    ctx.fillRect(0, 0, w, h);
  } else {
    // vertical stripes in faction colours
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = def.color;
    for (let i = 0; i < 4; i++) ctx.fillRect((i * w) / 4, 0, w / 8, h);
    ctx.globalAlpha = 1;
  }
  if (!lateen) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 6;
    drawHeraldry(ctx, def.heraldry, w * 0.28, h * 0.2, w * 0.44, h * 0.53, true);
    ctx.restore();
  }
  // weathering
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(60,45,25,0.12)');
  g.addColorStop(1, 'rgba(60,45,25,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface SailUniforms {
  uWind: { value: number };
  uBelly: { value: number };
  uTime: { value: number };
}

export function makeSailMaterial(faction: string, lateen: boolean): THREE.MeshStandardMaterial {
  const key = faction + (lateen ? 'L' : 'S');
  let base = sailMatCache.get(key);
  if (!base) {
    base = new THREE.MeshStandardMaterial({ map: sailTexture(faction, lateen), side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
    sailMatCache.set(key, base);
  }
  const m = base.clone();
  const su: SailUniforms = { uWind: { value: 1 }, uBelly: { value: 1 }, uTime: shipUniforms.uTime };
  m.userData.sail = su;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, su);
    sh.uniforms.uBacklight = shipUniforms.uBacklight;
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform vec3 emissive;', 'uniform vec3 emissive;\nuniform float uBacklight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uBacklight;');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;\nuniform float uBelly;\nuniform float uTime;\nattribute vec2 aSail;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // aSail.x across (0..1), aSail.y down (0..1): billow forward, flutter at the edges
          float bx = sin(aSail.x * 3.14159);
          float by = sin(aSail.y * 3.14159 * 0.85 + 0.25);
          float belly = bx * by * uBelly;
          float flutter = sin(uTime * 3.1 + aSail.x * 7.0 + aSail.y * 5.0) * 0.06 * (1.0 - uBelly * 0.6) * uWind;
          transformed.z += belly + flutter * (0.4 + aSail.y);
          transformed.y += sin(uTime * 2.3 + aSail.x * 5.0) * 0.03 * aSail.y * uWind;
        }`,
      );
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = normalize(objectNormal + vec3(0.0, 0.0, -0.35 * uBelly));');
  };
  m.customProgramCacheKey = () => 'sail';
  return m;
}

export function makeFlagMaterial(faction: string): THREE.MeshStandardMaterial {
  let m = flagMatCache.get(faction);
  if (m) return m;
  const def = factionDef(faction);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = def.color;
  ctx.fillRect(0, 0, 128, 96);
  drawHeraldry(ctx, def.heraldry, 32, 6, 64, 84, false);
  ctx.strokeStyle = def.color2;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shipUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fx = uv.x;
        transformed.z += sin(uTime * 6.0 - fx * 7.0 + position.y * 0.5) * 0.18 * fx * (length(transformed.xz) * 0.02 + 1.0);
        transformed.y += sin(uTime * 4.0 - fx * 5.0) * 0.05 * fx;`,
      );
  };
  m.customProgramCacheKey = () => 'flag';
  flagMatCache.set(faction, m);
  return m;
}

// ---------------------------------------------------------------- geometry helpers

function colorize(g: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function cyl(r1: number, r2: number, h: number, seg: number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg, 1);
  if (rx || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
  g.translate(x, y, z);
  return g;
}

function stripAttrs(g: THREE.BufferGeometry, keep: string[]) {
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  return g;
}

interface HullInfo {
  halfBeam: (t: number) => number;
  deckY: (t: number) => number;
  keelY: (t: number) => number;
  zAt: (t: number) => number;
}

function hullGeometry(p: ShipParams): { hull: THREE.BufferGeometry; deck: THREE.BufferGeometry; info: HullInfo } {
  const NS = 36;
  const NJ = 10;
  const L = p.length;
  const halfBeam = (t: number) => {
    // t: 0 stern .. 1 bow
    const stern = p.transom;
    const tt = Math.min(1, Math.max(0, t));
    const bow = Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (tt - 0.45) / 0.55), 1.8)), 0.62);
    const aft = stern + (1 - stern) * Math.pow(Math.min(1, tt / 0.42), 0.5);
    return (p.beam / 2) * Math.min(bow, aft);
  };
  const deckY = (t: number) => p.depth - p.draft + p.sheer * (Math.pow(Math.abs(t - 0.45) / 0.55, 2) * (t > 0.45 ? 1.1 : 0.85));
  const keelY = (t: number) => -p.draft * (1 - 0.55 * Math.pow(Math.abs(t - 0.5) * 2, 3));
  const zAt = (t: number) => (t - 0.5) * L;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const ring = NJ + 1;
  for (let side = -1; side <= 1; side += 2) {
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      const t = i / NS;
      const hb = halfBeam(t);
      const dy = deckY(t);
      const ky = keelY(t);
      for (let j = 0; j <= NJ; j++) {
        const a = (j / NJ) * Math.PI * 0.5;
        const tumble = 1 - 0.05 * Math.sin(Math.min(1, j / 3) * Math.PI);
        const x = side * hb * Math.pow(Math.cos(a), 0.45) * tumble;
        const y = dy - (dy - ky) * Math.pow(Math.sin(a), 1.2);
        const z = zAt(t);
        pos.push(x, y, z);
        uv.push(z / 5, y / 2.4);
        // dark tarred bottom, lighter wales
        let c = y < 0.25 ? 0.42 : 0.95;
        const fromDeck = dy - y;
        if (Math.abs(fromDeck - 0.7) < 0.18 || Math.abs(fromDeck - 2.1) < 0.15) c = 0.55;
        col.push(c, c * 0.97, c * 0.93);
      }
    }
    for (let i = 0; i < NS; i++)
      for (let j = 0; j < NJ; j++) {
        const a = base + i * ring + j;
        const b = base + (i + 1) * ring + j;
        if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  // transom (stern closure)
  {
    const t = 0;
    const hb = halfBeam(t);
    const dy = deckY(t);
    const ky = keelY(t);
    const base = pos.length / 3;
    const z = zAt(t);
    for (let j = 0; j <= NJ; j++) {
      const a = (j / NJ) * Math.PI * 0.5;
      const y = dy - (dy - ky) * Math.pow(Math.sin(a), 1.2);
      const x = hb * Math.pow(Math.cos(a), 0.45);
      pos.push(-x, y, z, x, y, z);
      uv.push(-x / 3, y / 2.4, x / 3, y / 2.4);
      const c = y < 0.25 ? 0.42 : 0.8;
      col.push(c, c, c, c, c, c);
    }
    for (let j = 0; j < NJ; j++) {
      const a = base + j * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hull.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  // deck
  const dpos: number[] = [];
  const duv: number[] = [];
  const didx: number[] = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const hb = halfBeam(t) * 0.97;
    const y = deckY(t) - 0.35;
    const z = zAt(t);
    dpos.push(-hb, y, z, hb, y, z);
    duv.push(-hb / 6, z / 6, hb / 6, z / 6);
  }
  for (let i = 0; i < NS; i++) {
    const a = i * 2;
    didx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  deck.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  deck.setIndex(didx);
  deck.computeVertexNormals();
  return { hull, deck, info: { halfBeam, deckY, keelY, zAt } };
}

function sailGeometry(w: number, h: number, belly: number, lateen: boolean): THREE.BufferGeometry {
  const NX = 10;
  const NY = 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const sail: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const v = j / NY;
      let x = (u - 0.5) * w;
      let y = -v * h;
      if (lateen) {
        // triangle: top edge along the yard, narrowing toward the bottom-aft corner
        x = (u - 0.5) * w * (1 - v * 0.85) - v * w * 0.35;
        y = -v * h + u * h * 0.25;
      } else {
        x *= 1 + v * 0.08;
      }
      pos.push(x, y, 0);
      uv.push(u, 1 - v);
      sail.push(u, v);
    }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + NX + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSail', new THREE.Float32BufferAttribute(sail, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  void belly;
  return g;
}

export interface ShipModel {
  root: THREE.Object3D; // positioned by the owner
  hi: THREE.Group;
  lo: THREE.Group;
  lod: THREE.LOD;
  sails: THREE.MeshStandardMaterial[];
  params: ShipParams;
  lanterns: THREE.Object3D[];
  length: number;
  deckHeight: number;
  type: string;
  faction: string;
}

const geoCache = new Map<string, { hi: [THREE.BufferGeometry, MatKey][]; lo: [THREE.BufferGeometry, MatKey][]; rigging: THREE.BufferGeometry; sails: { geo: THREE.BufferGeometry; pos: THREE.Vector3; rotY: number; rotZ: number; lateen: boolean; belly: number }[]; flags: { geo: THREE.BufferGeometry; pos: THREE.Vector3 }[]; lanterns: THREE.Vector3[]; oars?: THREE.BufferGeometry; deckH: number }>();

function buildGeometries(type: string, faction: string) {
  const key = `${type}:${faction === 'ostrevan' || faction === 'korr' ? 'shield' : 'plain'}`;
  const cached = geoCache.get(key);
  if (cached) return cached;
  const p = paramsFor(type, faction);
  const { hull, deck, info } = hullGeometry(p);
  const hi: [THREE.BufferGeometry, MatKey][] = [];
  const lo: [THREE.BufferGeometry, MatKey][] = [];
  hi.push([hull, 'hull']);
  lo.push([hull, 'hull']);
  hi.push([deck, 'deck']);
  lo.push([deck, 'deck']);
  const woodParts: THREE.BufferGeometry[] = [];
  const woodLo: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const metalParts: THREE.BufferGeometry[] = [];
  const L = p.length;
  const tFor = (z: number) => z / L + 0.5;
  const woodC = new THREE.Color(0.62, 0.45, 0.28);
  const woodD = new THREE.Color(0.48, 0.34, 0.2);
  // bulwarks + rail posts
  const NR = 30;
  for (let i = 0; i < NR; i++) {
    const t0 = 0.02 + (i / NR) * 0.94;
    const t1 = 0.02 + ((i + 1) / NR) * 0.94;
    for (const s of [-1, 1]) {
      const x0 = s * info.halfBeam(t0) * 0.98;
      const x1 = s * info.halfBeam(t1) * 0.98;
      const y0 = info.deckY(t0);
      const y1 = info.deckY(t1);
      const z0 = info.zAt(t0);
      const z1 = info.zAt(t1);
      const len = Math.hypot(x1 - x0, z1 - z0, y1 - y0);
      const g = new THREE.BoxGeometry(0.12, 0.85, len);
      const ang = Math.atan2(x1 - x0, z1 - z0);
      const pitch = -Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0));
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, ang, 0, 'YXZ')));
      g.translate((x0 + x1) / 2, (y0 + y1) / 2 + 0.3, (z0 + z1) / 2);
      woodParts.push(colorize(stripAttrs(g, ['position', 'normal']), woodD));
      woodLo.push(colorize(stripAttrs(g.clone(), ['position', 'normal']), woodD));
      if (i % 2 === 0) woodParts.push(colorize(stripAttrs(box(0.14, 1.0, 0.14, x0, y0 + 0.4, z0), ['position', 'normal']), woodC));
      // shields along the rail (raider style)
      if (p.shields && i % 2 === 1 && t0 > 0.2 && t0 < 0.82) {
        const sg = new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10);
        sg.rotateZ(Math.PI / 2);
        sg.translate(x0 + s * 0.12, y0 + 0.2, z0);
        woodParts.push(colorize(stripAttrs(sg, ['position', 'normal']), new THREE.Color().setHSL((i * 0.13) % 1, 0.45, 0.4)));
      }
    }
  }
  // castles
  const castle = (t0: number, t1: number, hgt: number, crenel: boolean) => {
    const zA = info.zAt(t0);
    const zB = info.zAt(t1);
    const tm = (t0 + t1) / 2;
    const w = info.halfBeam(tm) * 2 * 0.95;
    const yb = Math.max(info.deckY(t0), info.deckY(t1)) - 0.3;
    const g = box(w, hgt, Math.abs(zB - zA), 0, yb + hgt / 2, (zA + zB) / 2);
    woodParts.push(colorize(stripAttrs(g, ['position', 'normal']), woodC));
    woodLo.push(colorize(stripAttrs(g.clone(), ['position', 'normal']), woodC));
    // floor of the castle deck
    const fl = box(w * 1.04, 0.2, Math.abs(zB - zA) * 1.04, 0, yb + hgt + 0.1, (zA + zB) / 2);
    woodParts.push(colorize(stripAttrs(fl, ['position', 'normal']), woodD));
    // parapet
    const ph = 1.0;
    const n = Math.max(3, Math.round(Math.abs(zB - zA) / 1.4));
    for (const s of [-1, 1]) {
      woodParts.push(colorize(stripAttrs(box(0.18, ph, Math.abs(zB - zA), (s * w) / 2, yb + hgt + ph / 2, (zA + zB) / 2), ['position', 'normal']), woodD));
      if (crenel) for (let k = 0; k < n; k++) woodParts.push(colorize(stripAttrs(box(0.22, 0.5, 0.6, (s * w) / 2, yb + hgt + ph + 0.25, zA + ((k + 0.5) / n) * (zB - zA)), ['position', 'normal']), woodD));
    }
    const endZ = t0 < 0.5 ? zA : zB;
    woodParts.push(colorize(stripAttrs(box(w, ph, 0.18, 0, yb + hgt + ph / 2, endZ), ['position', 'normal']), woodD));
    const innerZ = t0 < 0.5 ? zB : zA;
    woodParts.push(colorize(stripAttrs(box(w, ph * 0.9, 0.16, 0, yb + hgt + ph / 2, innerZ), ['position', 'normal']), woodD));
    // windows (dark squares) on the stern castle
    if (t0 < 0.1) {
      for (let k = -1; k <= 1; k++) darkParts.push(stripAttrs(box(0.7, 0.8, 0.05, k * w * 0.28, yb + hgt * 0.55, zA - 0.04), ['position', 'normal']));
    }
    return yb + hgt;
  };
  let lanternY = info.deckY(0.02) + 1;
  if (p.aftCastle > 0) lanternY = castle(0.0, p.aftCastle, p.castleH, true) + 1.8;
  if (p.foreCastle > 0) castle(1 - p.foreCastle - 0.04, 0.97, p.castleH * 0.85, true);
  // masts, yards, tops
  const rigPts: number[] = [];
  const sails: { geo: THREE.BufferGeometry; pos: THREE.Vector3; rotY: number; rotZ: number; lateen: boolean; belly: number }[] = [];
  const flags: { geo: THREE.BufferGeometry; pos: THREE.Vector3 }[] = [];
  for (const m of p.masts) {
    const z = m.z * L;
    const t = tFor(z);
    const baseY = info.deckY(t) - 0.4;
    const r = 0.18 + m.h * 0.008;
    const mast = cyl(r * 0.6, r, m.h, 8, 0, baseY + m.h / 2, z);
    woodParts.push(colorize(stripAttrs(mast, ['position', 'normal']), woodD));
    woodLo.push(colorize(stripAttrs(mast.clone(), ['position', 'normal']), woodD));
    const topY = baseY + m.h;
    // fighting top
    const top = cyl(r * 4.5, r * 3.2, 0.9, 10, 0, baseY + m.h * 0.84, z);
    woodParts.push(colorize(stripAttrs(top, ['position', 'normal']), woodC));
    // pennant
    const pg = new THREE.PlaneGeometry(4, 0.8, 8, 1);
    pg.translate(2, 0, 0);
    flags.push({ geo: stripAttrs(pg, ['position', 'normal', 'uv']), pos: new THREE.Vector3(0, topY + 0.2, z) });
    if (m.sail === 'square') {
      for (let k = 0; k < m.sails; k++) {
        const yardY = baseY + m.h * (0.8 - k * 0.3);
        const yl = m.yard * (1 - k * 0.22);
        const yard = cyl(0.12, 0.12, yl, 6, 0, yardY, z + 0.3, 0, Math.PI / 2);
        woodParts.push(colorize(stripAttrs(yard, ['position', 'normal']), woodD));
        woodLo.push(colorize(stripAttrs(yard.clone(), ['position', 'normal']), woodD));
        const sh = m.h * (k === 0 ? 0.4 : 0.26);
        sails.push({ geo: sailGeometry(yl * 0.92, sh, 1, false), pos: new THREE.Vector3(0, yardY - 0.1, z + 0.45), rotY: 0, rotZ: 0, lateen: false, belly: sh * 0.22 });
        // braces from yard ends aft to the deck
        for (const s of [-1, 1]) rigPts.push((s * yl) / 2, yardY, z + 0.3, s * info.halfBeam(t - 0.12) * 0.95, info.deckY(t - 0.12) + 0.5, z - L * 0.12);
      }
    } else {
      // lateen yard angled
      const yardY = baseY + m.h * 0.72;
      const yl = m.yard;
      const g = new THREE.CylinderGeometry(0.1, 0.14, yl, 6);
      g.rotateZ(Math.PI / 2);
      g.rotateY(Math.PI / 2);
      g.rotateX(0.5);
      g.translate(0, yardY, z);
      woodParts.push(colorize(stripAttrs(g, ['position', 'normal']), woodD));
      woodLo.push(colorize(stripAttrs(g.clone(), ['position', 'normal']), woodD));
      const sg = sailGeometry(yl * 0.9, m.h * 0.55, 1, true);
      sg.rotateY(Math.PI / 2);
      sails.push({ geo: sg, pos: new THREE.Vector3(0.35, yardY + yl * 0.2, z), rotY: 0, rotZ: 0, lateen: true, belly: m.h * 0.05 });
    }
    // shrouds with ratlines
    const shroudT = [-0.06, -0.02, 0.02];
    for (const s of [-1, 1]) {
      for (const dt of shroudT) {
        const tt = t + dt;
        const bx = s * info.halfBeam(tt) * 1.0;
        const by = info.deckY(tt) + 0.2;
        const bz = info.zAt(tt);
        rigPts.push(0, baseY + m.h * 0.84, z, bx, by, bz);
      }
      // ratlines between first and last shroud
      const a0 = info.zAt(t + shroudT[0]);
      const a1 = info.zAt(t + shroudT[2]);
      const bx0 = s * info.halfBeam(t + shroudT[0]);
      const bx1 = s * info.halfBeam(t + shroudT[2]);
      const by0 = info.deckY(t) + 0.2;
      for (let k = 1; k < 9; k++) {
        const f = k / 10;
        const y = by0 + (baseY + m.h * 0.84 - by0) * f;
        rigPts.push(bx0 * (1 - f), y, a0 + (z - a0) * f, bx1 * (1 - f), y, a1 + (z - a1) * f);
      }
    }
  }
  // stays between mast tops and to the bow/bowsprit
  const tops = p.masts.map((m) => ({ z: m.z * L, y: info.deckY(tFor(m.z * L)) - 0.4 + m.h * 0.95 }));
  tops.sort((a, b) => a.z - b.z);
  for (let i = 0; i < tops.length - 1; i++) rigPts.push(0, tops[i].y, tops[i].z, 0, tops[i + 1].y * 0.85, tops[i + 1].z);
  const bowZ = info.zAt(1) + (p.bowsprit ? L * 0.14 : 0);
  const bowY = info.deckY(1) + (p.bowsprit ? 2.2 : 0);
  rigPts.push(0, tops[tops.length - 1].y, tops[tops.length - 1].z, 0, bowY, bowZ);
  rigPts.push(0, tops[0].y, tops[0].z, 0, info.deckY(0) + 1, info.zAt(0));
  if (p.bowsprit) {
    const g = new THREE.CylinderGeometry(0.12, 0.2, L * 0.24, 6);
    g.rotateX(Math.PI / 2 - 0.35);
    g.translate(0, info.deckY(0.97) + 0.8, info.zAt(0.97) + L * 0.08);
    woodParts.push(colorize(stripAttrs(g, ['position', 'normal']), woodD));
  }
  // rudder
  {
    const top = info.deckY(0) - 0.2;
    const bot = info.keelY(0.02) + 0.2;
    darkParts.push(stripAttrs(box(0.3, top - bot, 1.3, 0, (top + bot) / 2, info.zAt(0) - 0.55), ['position', 'normal']));
  }
  // anchors at the bow
  for (const s of [-1, 1]) {
    const ax = s * info.halfBeam(0.85) * 1.02;
    const ay = info.deckY(0.85) - 1.2;
    const az = info.zAt(0.85);
    metalParts.push(stripAttrs(cyl(0.07, 0.07, 1.6, 5, ax, ay, az), ['position', 'normal']));
    metalParts.push(stripAttrs(box(1.1, 0.12, 0.12, ax, ay - 0.8, az, 0, 0, 0), ['position', 'normal']));
    metalParts.push(stripAttrs(box(0.12, 0.5, 0.12, ax - 0.5, ay - 0.6, az), ['position', 'normal']));
    metalParts.push(stripAttrs(box(0.12, 0.5, 0.12, ax + 0.5, ay - 0.6, az), ['position', 'normal']));
  }
  // cargo: barrels & crates on deck
  for (let k = 0; k < 6; k++) {
    const t = 0.3 + (k / 6) * 0.35;
    const x = (k % 2 ? 1 : -1) * info.halfBeam(t) * 0.5;
    const y = info.deckY(t) - 0.35;
    if (k % 3 === 0) woodParts.push(colorize(stripAttrs(box(0.9, 0.9, 0.9, x, y + 0.45, info.zAt(t)), ['position', 'normal']), new THREE.Color(0.55, 0.4, 0.25)));
    else woodParts.push(colorize(stripAttrs(cyl(0.38, 0.38, 0.9, 8, x, y + 0.45, info.zAt(t)), ['position', 'normal']), new THREE.Color(0.45, 0.32, 0.2)));
  }
  // stern lantern posts
  const lanterns = [new THREE.Vector3(0, lanternY, info.zAt(0.01))];
  woodParts.push(colorize(stripAttrs(cyl(0.06, 0.06, 1.8, 4, 0, lanternY - 0.9, info.zAt(0.01)), ['position', 'normal']), woodD));
  if (p.length > 35) {
    lanterns.push(new THREE.Vector3(-info.halfBeam(0.05) * 0.8, lanternY - 0.5, info.zAt(0.03)));
    lanterns.push(new THREE.Vector3(info.halfBeam(0.05) * 0.8, lanternY - 0.5, info.zAt(0.03)));
  }
  // oars
  let oars: THREE.BufferGeometry | undefined;
  if (p.oars) {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < p.oars; i++) {
      const t = 0.22 + (i / (p.oars - 1)) * 0.55;
      for (const s of [-1, 1]) {
        const px = s * info.halfBeam(t);
        const py = info.deckY(t) - 0.2;
        const pz = info.zAt(t);
        const len = 6.5;
        const g = new THREE.BoxGeometry(len, 0.1, 0.12);
        g.translate((s * len) / 2 - s * 1.2, 0, 0);
        g.rotateZ(s * -0.45);
        g.translate(px, py, pz);
        const blade = new THREE.BoxGeometry(0.9, 0.05, 0.35);
        blade.translate(s * (len - 1.6), 0, 0);
        blade.rotateZ(s * -0.45);
        blade.translate(px, py, pz);
        for (const gg of [g, blade]) {
          stripAttrs(gg, ['position', 'normal']);
          const n = gg.attributes.position.count;
          const a = new Float32Array(n * 4);
          for (let v = 0; v < n; v++) {
            a[v * 4] = px;
            a[v * 4 + 1] = py;
            a[v * 4 + 2] = pz;
            a[v * 4 + 3] = i * 0.05;
          }
          gg.setAttribute('aOar', new THREE.BufferAttribute(a, 4));
          parts.push(gg);
        }
      }
    }
    oars = mergeGeometries(parts)!;
  }
  hi.push([mergeGeometries(woodParts)!, 'wood']);
  lo.push([mergeGeometries(woodLo)!, 'wood']);
  if (darkParts.length) hi.push([mergeGeometries(darkParts)!, 'darkWood']);
  if (metalParts.length) hi.push([mergeGeometries(metalParts)!, 'metal']);
  const rigging = new THREE.BufferGeometry();
  rigging.setAttribute('position', new THREE.Float32BufferAttribute(rigPts, 3));
  const out = { hi, lo, rigging, sails, flags, lanterns, oars, deckH: info.deckY(0.5) };
  geoCache.set(key, out);
  return out;
}

/** Build a ship model (hi and lo LOD). Geometry is shared between ships of the same class. */
export function buildShip(type: string, faction: string): ShipModel {
  const m = shipMaterials();
  const g = buildGeometries(type, faction);
  const hi = new THREE.Group();
  const lo = new THREE.Group();
  for (const [geo, mat] of g.hi) {
    const mesh = new THREE.Mesh(geo, m[mat] as THREE.Material);
    mesh.castShadow = true;
    mesh.receiveShadow = mat === 'deck';
    hi.add(mesh);
  }
  for (const [geo, mat] of g.lo) lo.add(new THREE.Mesh(geo, m[mat] as THREE.Material));
  const rig = new THREE.LineSegments(g.rigging, m.rope);
  hi.add(rig);
  const sails: THREE.MeshStandardMaterial[] = [];
  for (const s of g.sails) {
    const mat = makeSailMaterial(faction, s.lateen);
    (mat.userData.sail as SailUniforms).uBelly.value = s.belly;
    sails.push(mat);
    const mesh = new THREE.Mesh(s.geo, mat);
    mesh.position.copy(s.pos);
    mesh.castShadow = true;
    hi.add(mesh);
    const meshLo = new THREE.Mesh(s.geo, mat);
    meshLo.position.copy(s.pos);
    lo.add(meshLo);
  }
  const flagMat = makeFlagMaterial(faction);
  for (const f of g.flags) {
    const mesh = new THREE.Mesh(f.geo, flagMat);
    mesh.position.copy(f.pos);
    hi.add(mesh);
  }
  // stern ensign
  {
    const fg = new THREE.PlaneGeometry(3.2, 2.2, 8, 2);
    fg.translate(1.6, 0, 0);
    const mesh = new THREE.Mesh(fg, flagMat);
    mesh.position.set(0, g.lanterns[0].y + 2.2, g.lanterns[0].z - 0.2);
    mesh.rotation.y = Math.PI / 2;
    hi.add(mesh);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 4), m.darkWood);
    pole.position.set(0, g.lanterns[0].y + 1.3, g.lanterns[0].z - 0.2);
    hi.add(pole);
  }
  const lanterns: THREE.Object3D[] = [];
  for (const lp of g.lanterns) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.45), m.lantern);
    l.position.copy(lp);
    hi.add(l);
    lanterns.push(l);
  }
  if (g.oars) {
    const oars = new THREE.Mesh(g.oars, m.oar);
    hi.add(oars);
  }
  const lod = new THREE.LOD();
  lod.addLevel(hi, 0);
  lod.addLevel(lo, 420);
  const root = new THREE.Object3D();
  root.add(lod);
  return { root, hi, lo, lod, sails, params: paramsFor(type, faction), lanterns, length: paramsFor(type, faction).length, deckHeight: g.deckH, type, faction };
}

export function disposeShipCaches() {
  for (const g of geoCache.values()) {
    for (const [geo] of [...g.hi, ...g.lo]) geo.dispose();
    g.rigging.dispose();
    g.oars?.dispose();
    for (const s of g.sails) s.geo.dispose();
    for (const f of g.flags) f.geo.dispose();
  }
  geoCache.clear();
}
