import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../core/rng';

/*
 * Procedural tree models shared by the campaign map and the battlefields. Crowns are built from
 * clumps of jittered, ellipsoid-shaded icosahedra; spruces from drooping, ragged branch tiers.
 * Vertex colours bake the lighting a tree gives itself: dark, cool interiors and undersides,
 * warm sunlit tops and lighter tips. Types (indices are relied upon by the placers):
 *   0 conifer · 1 broadleaf · 2 cypress · 3 olive/scrub tree · 4 bush · 5 rock
 */

export type TreeDetail = 'hi' | 'lo';

interface Crown {
  yMin: number;
  yMax: number;
  rMax: number;
}

function finish(g: THREE.BufferGeometry, crown: number, colorAt: (p: THREE.Vector3, n: THREE.Vector3, i: number) => THREE.Color) {
  if (g.index) g = g.toNonIndexed();
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const cr = new Float32Array(pos.count).fill(crown);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    const c = colorAt(p, n, i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aCrown', new THREE.BufferAttribute(cr, 1));
  return g;
}

/** Foliage shading: darker toward the bottom and the core of the crown, lighter where it faces the sky. */
function foliageColor(base: THREE.Color, cr: Crown, vary: number) {
  const out = new THREE.Color();
  return (p: THREE.Vector3, n: THREE.Vector3, i: number) => {
    const h = THREE.MathUtils.clamp((p.y - cr.yMin) / Math.max(0.01, cr.yMax - cr.yMin), 0, 1);
    const radial = THREE.MathUtils.clamp(Math.hypot(p.x, p.z) / cr.rMax, 0, 1);
    const ao = 0.4 + 0.6 * (0.62 * h + 0.38 * radial);
    const sky = 0.8 + 0.3 * n.y;
    const k = ao * sky * (1 + (((i * 7919) % 17) / 17 - 0.5) * 0.16);
    out.copy(base).multiplyScalar(k);
    // sunlit tops drift toward yellow-green, shaded cores toward blue-green
    out.r += (h - 0.5) * 0.03 * vary;
    out.b += (0.5 - h) * 0.025 * vary;
    return out;
  };
}

function barkColor(base: THREE.Color, yMax: number) {
  const out = new THREE.Color();
  return (p: THREE.Vector3, _n: THREE.Vector3, i: number) => {
    const k = 0.55 + 0.45 * THREE.MathUtils.clamp(p.y / yMax, 0, 1);
    return out.copy(base).multiplyScalar(k * (0.92 + ((i * 131) % 7) * 0.025));
  };
}

/** A clump of foliage: an icosahedron with per-vertex jitter and ellipsoid normals. */
function clump(r: Rng, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, detail: number, jit: number) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const offs = new Map<string, number>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let o = offs.get(key);
    if (o === undefined) offs.set(key, (o = 1 + r.range(-jit, jit)));
    const x = v.x * o;
    const y = v.y * o;
    const z = v.z * o;
    // ellipsoid normal, softened toward the radial direction so clumps read round
    const nx = x / (rx * rx) + v.x * 0.3;
    const ny = y / (ry * ry) + v.y * 0.3;
    const nz = z / (rz * rz) + v.z * 0.3;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(i, nx / l, ny / l, nz / l);
    pos.setXYZ(i, cx + x * rx, cy + y * ry, cz + z * rz);
  }
  return g;
}

/** Tapered, slightly bent trunk. */
function trunk(r0: number, r1: number, h: number, seg: number, bendX: number, bendZ: number, y0 = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 4, true);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;
    pos.setXYZ(i, pos.getX(i) + bendX * t * t, pos.getY(i) + h / 2 + y0, pos.getZ(i) + bendZ * t * t);
  }
  g.computeVertexNormals();
  return g;
}

/** A limb between two points. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg: number) {
  const d = b.clone().sub(a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

/** One drooping, ragged tier of spruce branches: a skirt with an underside. */
function skirt(r: Rng, yTop: number, yRim: number, rad: number, seg: number) {
  const pos: number[] = [];
  const apex = new THREE.Vector3(0, yTop, 0);
  const rim: THREE.Vector3[] = [];
  const inner: THREE.Vector3[] = [];
  const a0 = r.range(0, Math.PI * 2);
  for (let i = 0; i < seg; i++) {
    const a = a0 + (i / seg) * Math.PI * 2;
    const rr = rad * (i % 2 ? 0.72 + r.range(-0.06, 0.06) : 1 + r.range(-0.08, 0.1));
    const droop = (i % 2 ? -0.1 : 0.12) * rad;
    rim.push(new THREE.Vector3(Math.cos(a) * rr, yRim - droop, Math.sin(a) * rr));
    inner.push(new THREE.Vector3(Math.cos(a) * rad * 0.28, yRim + (yTop - yRim) * 0.42, Math.sin(a) * rad * 0.28));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    pos.push(apex.x, apex.y, apex.z, rim[j].x, rim[j].y, rim[j].z, rim[i].x, rim[i].y, rim[i].z);
    // underside back up toward the stem
    pos.push(rim[i].x, rim[i].y, rim[i].z, rim[j].x, rim[j].y, rim[j].z, inner[j].x, inner[j].y, inner[j].z);
    pos.push(rim[i].x, rim[i].y, rim[i].z, inner[j].x, inner[j].y, inner[j].z, inner[i].x, inner[i].y, inner[i].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // tilt normals outward so the skirt shades like a mass of needles rather than a flat cone
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const ox = p.getX(i);
    const oz = p.getZ(i);
    const l = Math.hypot(ox, oz) || 1;
    const nx = n.getX(i) * 0.5 + (ox / l) * 0.6;
    const ny = n.getY(i) * 0.5 + 0.35;
    const nz = n.getZ(i) * 0.5 + (oz / l) * 0.6;
    const k = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / k, ny / k, nz / k);
  }
  return g;
}

const BARK = new THREE.Color(0.3, 0.22, 0.15);
const BARK_GREY = new THREE.Color(0.36, 0.33, 0.3);

function conifer(detail: TreeDetail) {
  const r = new Rng(101);
  const parts: THREE.BufferGeometry[] = [];
  const H = 13;
  parts.push(finish(trunk(0.42, 0.12, H * 0.9, detail === 'hi' ? 6 : 5, 0, 0), 0, barkColor(BARK, H)));
  const tiers = detail === 'hi' ? 7 : 4;
  const cr: Crown = { yMin: 1.8, yMax: H + 1, rMax: 3.8 };
  const base = new THREE.Color(0.1, 0.2, 0.12);
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const yRim = 1.8 + t * (H - 3.2);
    const rad = 3.8 * (1 - t * 0.78) + 0.35;
    const yTop = yRim + (detail === 'hi' ? 3.3 : 4.2) * (1 - t * 0.35);
    const g = detail === 'hi' ? skirt(r, yTop, yRim, rad, 12) : new THREE.ConeGeometry(rad, yTop - yRim, 7, 1, false).translate(0, (yTop + yRim) / 2, 0);
    parts.push(finish(g, 1, foliageColor(base, cr, 1)));
  }
  return mergeGeometries(parts)!;
}

function broadleaf(detail: TreeDetail) {
  const r = new Rng(202);
  const parts: THREE.BufferGeometry[] = [];
  const trunkH = 4.6;
  parts.push(finish(trunk(0.55, 0.32, trunkH + 1.2, detail === 'hi' ? 7 : 5, 0.25, -0.1), 0, barkColor(BARK, 8)));
  const cr: Crown = { yMin: 3.4, yMax: 11.2, rMax: 5.2 };
  const base = new THREE.Color(0.17, 0.3, 0.1);
  if (detail === 'hi') {
    // limbs spreading into the crown
    const fork = new THREE.Vector3(0.25, trunkH, -0.1);
    const ends = [new THREE.Vector3(2.6, 8.2, 1.0), new THREE.Vector3(-2.2, 8.6, -1.4), new THREE.Vector3(0.6, 9.4, 2.4), new THREE.Vector3(-0.6, 9.0, -0.4)];
    for (const e of ends) parts.push(finish(limb(fork, e, 0.3, 0.12, 5), 0, barkColor(BARK, 10)));
    const clumps: [number, number, number, number, number, number][] = [
      [0, 8.6, 0, 3.4, 2.7, 3.3],
      [2.5, 7.6, 1.2, 2.5, 2.1, 2.4],
      [-2.4, 7.9, -1.3, 2.6, 2.2, 2.5],
      [0.7, 8.2, 2.7, 2.3, 2.0, 2.2],
      [-1.0, 7.2, -2.6, 2.2, 1.9, 2.2],
      [-2.3, 7.0, 1.8, 2.0, 1.7, 2.0],
      [1.8, 6.6, -2.2, 2.0, 1.7, 2.0],
      [0.3, 10.0, -0.4, 2.3, 1.8, 2.3],
    ];
    clumps.forEach(([x, y, z, rx, ry, rz], i) => parts.push(finish(clump(r, x, y, z, rx, ry, rz, i < 5 ? 1 : 0, 0.16), 1, foliageColor(base, cr, 1))));
  } else {
    parts.push(finish(clump(r, 0, 8.2, 0, 4.4, 3.4, 4.3, 1, 0.14), 1, foliageColor(base, cr, 1)));
    parts.push(finish(clump(r, 1.6, 7.0, 1.4, 2.6, 2.1, 2.5, 0, 0.12), 1, foliageColor(base, cr, 1)));
  }
  return mergeGeometries(parts)!;
}

function cypress(detail: TreeDetail) {
  const r = new Rng(303);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(finish(trunk(0.25, 0.18, 1.8, 5, 0, 0), 0, barkColor(BARK, 2)));
  const pts: THREE.Vector2[] = [];
  const n = detail === 'hi' ? 12 : 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.75)) * 1.35 * (1 - t * 0.35) + 0.02, 1.2 + t * 10.5));
  }
  const g = new THREE.LatheGeometry(pts, detail === 'hi' ? 10 : 6);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + r.range(-0.12, 0.12);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  parts.push(finish(g, 1, foliageColor(new THREE.Color(0.09, 0.18, 0.09), { yMin: 1.2, yMax: 11.7, rMax: 1.4 }, 1)));
  return mergeGeometries(parts)!;
}

function olive(detail: TreeDetail) {
  const r = new Rng(404);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(finish(trunk(0.5, 0.3, 2.8, 6, 0.6, 0.2), 0, barkColor(BARK_GREY, 4)));
  const cr: Crown = { yMin: 2.6, yMax: 5.6, rMax: 3.6 };
  const base = new THREE.Color(0.3, 0.35, 0.2);
  const cl: [number, number, number, number, number, number][] =
    detail === 'hi'
      ? [
          [0.6, 4.2, 0, 2.4, 1.3, 2.2],
          [-1.4, 3.8, 1.0, 1.7, 1.0, 1.6],
          [1.8, 3.6, -1.3, 1.6, 1.0, 1.5],
          [0.2, 4.8, -1.2, 1.5, 0.9, 1.4],
        ]
      : [[0.4, 4.0, 0, 3.0, 1.5, 2.8]];
  cl.forEach(([x, y, z, rx, ry, rz]) => parts.push(finish(clump(r, x, y, z, rx, ry, rz, detail === 'hi' ? 1 : 0, 0.18), 1, foliageColor(base, cr, 0.6))));
  return mergeGeometries(parts)!;
}

function bush(detail: TreeDetail) {
  const r = new Rng(505);
  const parts: THREE.BufferGeometry[] = [];
  const cr: Crown = { yMin: 0, yMax: 2.0, rMax: 1.8 };
  const base = new THREE.Color(0.18, 0.27, 0.1);
  const cl: [number, number, number, number, number, number][] =
    detail === 'hi'
      ? [
          [0, 0.9, 0, 1.4, 1.0, 1.3],
          [0.9, 0.7, 0.5, 0.9, 0.7, 0.9],
          [-0.8, 0.6, -0.4, 0.9, 0.7, 0.9],
        ]
      : [[0, 0.8, 0, 1.6, 1.0, 1.5]];
  cl.forEach(([x, y, z, rx, ry, rz]) => parts.push(finish(clump(r, x, y, z, rx, ry, rz, detail === 'hi' ? 1 : 0, 0.2), 1, foliageColor(base, cr, 1))));
  return mergeGeometries(parts)!;
}

function rock(detail: TreeDetail) {
  const r = new Rng(606);
  const g = clump(r, 0, 0.5, 0, 2.4, 1.5, 2.0, detail === 'hi' ? 1 : 0, 0.28);
  // rocks read faceted: recompute flat normals
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  const grey = new THREE.Color(0.44, 0.42, 0.39);
  const moss = new THREE.Color(0.24, 0.3, 0.15);
  const out = new THREE.Color();
  return finish(flat, 0, (p, n, i) => {
    const k = 0.7 + 0.3 * THREE.MathUtils.clamp(p.y / 1.8, 0, 1);
    out.copy(grey).multiplyScalar(k * (0.9 + ((i * 37) % 9) * 0.025));
    return out.lerp(moss, THREE.MathUtils.smoothstep(n.y, 0.55, 0.95) * 0.6);
  });
}

const cache = new Map<TreeDetail, THREE.BufferGeometry[]>();
/** Tree geometries by type (see header). The returned array is shared; clone before disposing. */
export function buildTreeGeometries(detail: TreeDetail): THREE.BufferGeometry[] {
  let g = cache.get(detail);
  if (!g) cache.set(detail, (g = [conifer(detail), broadleaf(detail), cypress(detail), olive(detail), bush(detail), rock(detail)]));
  return g.map((x) => x.clone());
}
