import * as THREE from 'three';
import { Bucket, box, gableRoof, cylinder, cone, pyramid, merlons, frame } from './meshBuilder';
import { heightAt, type ProvinceGeo, type WorldGeo } from '../../sim/world/geo';
import { factionDef, type ArchStyle } from '../../data/factions';
import { Rng } from '../../core/rng';
import { stoneTexture, plasterTexture, roofTexture, planksTexture, windowMaskTexture } from '../textures';
import { makeFlagMaterial } from '../ships/shipBuilder';

export const archUniforms = { uLamp: { value: 0 } };

let mats: Record<'stone' | 'plaster' | 'roof' | 'wood' | 'cloth' | 'dark', THREE.MeshStandardMaterial> | null = null;
export function archMaterials() {
  if (mats) return mats;
  const plaster = new THREE.MeshStandardMaterial({ map: plasterTexture(), vertexColors: true, roughness: 0.92, emissiveMap: windowMaskTexture(), emissive: new THREE.Color(1, 0.72, 0.38) });
  plaster.onBeforeCompile = (sh) => {
    sh.uniforms.uLamp = archUniforms.uLamp;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLamp;\nvarying vec3 vWP;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float lit = step(0.45, fract(sin(dot(floor(vWP.xz / 3.0) + floor(vWP.y / 3.0), vec2(12.9898, 78.233))) * 43758.5453));
        totalEmissiveRadiance *= uLamp * lit * 2.2;`,
      );
  };
  plaster.customProgramCacheKey = () => 'plaster-lamp';
  mats = {
    stone: new THREE.MeshStandardMaterial({ map: stoneTexture(), vertexColors: true, roughness: 0.93 }),
    plaster,
    roof: new THREE.MeshStandardMaterial({ map: roofTexture(), vertexColors: true, roughness: 0.82 }),
    wood: new THREE.MeshStandardMaterial({ map: planksTexture(), vertexColors: true, roughness: 0.88 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a130d, roughness: 1 }),
  };
  return mats;
}

export interface SettlementInput {
  geo: WorldGeo;
  pg: ProvinceGeo;
  tier: number;
  walls: number;
  fortress: boolean;
  isCapital: boolean;
  buildings: Set<string>;
  owner: string;
}

export interface SettlementVisual {
  group: THREE.Group;
  flags: THREE.Mesh[];
  lamps: THREE.Vector3[];
  walkPoints: THREE.Vector3[];
  plaza: THREE.Vector3;
  gates: THREE.Vector3[];
  docks: THREE.Vector3[];
  fields: THREE.Vector3[];
  mills: THREE.Object3D[];
  bannerTop: THREE.Vector3;
  radius: number;
  dispose(): void;
}

interface Buckets {
  stone: Bucket;
  plaster: Bucket;
  roof: Bucket;
  wood: Bucket;
  cloth: Bucket;
  dark: Bucket;
}
const newBuckets = (): Buckets => ({ stone: new Bucket(), plaster: new Bucket(), roof: new Bucket(), wood: new Bucket(), cloth: new Bucket(), dark: new Bucket() });

const C = (hex: string) => new THREE.Color(hex);
const vary = (c: THREE.Color, r: Rng, amt = 0.08) => c.clone().multiplyScalar(1 + r.range(-amt, amt));

export function buildSettlement(inp: SettlementInput): SettlementVisual {
  const { geo, pg } = inp;
  const style: ArchStyle = factionDef(pg.anchor.owner).arch;
  const r = new Rng(pg.id * 7919 + 13);
  const hi = newBuckets();
  const lo = newBuckets();
  const cx = pg.x;
  const cz = pg.z;
  const R = pg.radius;
  const H = (x: number, z: number) => heightAt(geo, x, z);
  const stoneC = C(style.stone);
  const plasterC = C(style.plaster);
  const roofC = C(style.roof);
  const roof2C = C(style.roof2);
  const timberC = C(style.timber);
  const flagsAt: { pos: THREE.Vector3; size: number }[] = [];
  const lamps: THREE.Vector3[] = [];
  const walk: THREE.Vector3[] = [];
  const mills: { x: number; z: number; y: number; yaw: number }[] = [];
  const occupied: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, rad: number) => !occupied.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + rad) ** 2);
  const isWater = (x: number, z: number) => H(x, z) < 1.4;
  const isRiver = (x: number, z: number) => {
    const c = Math.floor(z / geo.navStep) * geo.navW + Math.floor(x / geo.navStep);
    return geo.river[c] === 1;
  };
  const footprintOk = (x: number, z: number, w: number, d: number, yaw: number) => {
    const f = frame(x, z, yaw);
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
      if (isWater(p.x, p.z) || isRiver(p.x, p.z)) return null;
      const h = H(p.x, p.z);
      mn = Math.min(mn, h);
      mx = Math.max(mx, h);
    }
    if (mx - mn > 5) return null;
    return mn;
  };

  // --- directions: gates toward roads, harbour toward the sea
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
        gateDirs.push(Math.atan2(z - cz, x - cx));
        break;
      }
    }
  }
  if (!gateDirs.length) gateDirs.push(r.range(0, Math.PI * 2));
  if (gateDirs.length < 2) gateDirs.push(gateDirs[0] + Math.PI + r.range(-0.4, 0.4));
  const harbor = pg.port ? pg.coastAngle : null;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const inHarborSector = (a: number) => harbor !== null && angDiff(a, harbor) < 0.85;

  // --- the keep / hall
  const keepOff = pg.port ? -R * 0.22 : 0;
  const kx = cx + Math.cos(harbor ?? 0) * keepOff;
  const kz = cz + Math.sin(harbor ?? 0) * keepOff;
  const kyaw = r.range(0, Math.PI / 2);
  const big = inp.isCapital || inp.fortress || inp.tier >= 2;
  const baseK = H(kx, kz);
  let keepTop = baseK;
  if (big) {
    const kw = inp.isCapital ? 22 : inp.fortress ? 20 : 17;
    const kh = inp.isCapital ? 34 : inp.fortress ? 30 : 24;
    box(hi.stone, kx, baseK - 3, kz, kw, kh + 3, kw, kyaw, vary(stoneC, r, 0.04), 0.12);
    box(lo.stone, kx, baseK - 3, kz, kw, kh + 3, kw, kyaw, stoneC, 0.12);
    const f = frame(kx, kz, kyaw);
    const top = baseK + kh;
    keepTop = top;
    // merlons around the top
    const corners = [f(-kw / 2, 0, -kw / 2), f(kw / 2, 0, -kw / 2), f(kw / 2, 0, kw / 2), f(-kw / 2, 0, kw / 2)];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      merlons(hi.stone, a.x, a.z, b.x, b.z, top, 1.2, stoneC, 1.3);
    }
    // corner turrets
    for (const c of corners) {
      const th = kh + 8;
      cylinder(hi.stone, c.x, baseK - 2, c.z, 3.4, 3.0, th + 2, 10, vary(stoneC, r, 0.05), true, 0.15);
      cylinder(lo.stone, c.x, baseK - 2, c.z, 3.4, 3.0, th + 2, 6, stoneC, true, 0.15);
      if (style.towerTop === 'cone' || style.towerTop === 'spire') {
        cone(hi.roof, c.x, baseK + th, c.z, 4.0, style.towerTop === 'spire' ? 11 : 7, 10, roofC);
        cone(lo.roof, c.x, baseK + th, c.z, 4.0, style.towerTop === 'spire' ? 11 : 7, 6, roofC);
      } else if (style.towerTop === 'dome') {
        cone(hi.roof, c.x, baseK + th, c.z, 3.8, 4.5, 10, roofC);
      } else {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          box(hi.stone, c.x + Math.cos(a) * 2.9, baseK + th, c.z + Math.sin(a) * 2.9, 1.2, 1.4, 1.0, -a, stoneC);
        }
      }
    }
    // central roof on the keep for some styles
    if (style.towerTop !== 'crenel') pyramid(hi.roof, kx, top, kz, kw - 2, kw - 2, style.towerTop === 'spire' ? 12 : 8, kyaw, roof2C);
    flagsAt.push({ pos: new THREE.Vector3(kx, top + (style.towerTop !== 'crenel' ? 12 : 1), kz), size: inp.isCapital ? 1.6 : 1.2 });
    // windows & door
    for (let i = 0; i < 4; i++) {
      const g = frame(kx, kz, kyaw + (i * Math.PI) / 2);
      for (let k = 0; k < 3; k++) {
        const p = g(-4 + k * 4, baseK + kh * 0.55, kw / 2 + 0.05);
        box(hi.dark, p.x, p.y, p.z, 1.3, 2.4, 0.1, kyaw + (i * Math.PI) / 2, C('#1a130d'));
      }
    }
    lamps.push(new THREE.Vector3(kx, baseK + kh * 0.6, kz));
    occupied.push({ x: kx, z: kz, r: kw * 0.9 + 4 });
    // inner bailey wall for capitals and fortresses
    if (inp.isCapital || inp.fortress) {
      const bw = kw + 22;
      const g = frame(kx, kz, kyaw);
      const bc = [g(-bw / 2, 0, -bw / 2), g(bw / 2, 0, -bw / 2), g(bw / 2, 0, bw / 2), g(-bw / 2, 0, bw / 2)];
      for (let i = 0; i < 4; i++) {
        const a = bc[i];
        const b = bc[(i + 1) % 4];
        wallRun(hi, lo, geo, a.x, a.z, b.x, b.z, 9, 2.2, stoneC, i === 1 ? 0.5 : -1);
        cylinder(hi.stone, a.x, H(a.x, a.z) - 2, a.z, 2.6, 2.4, 14, 8, stoneC, true, 0.15);
        cylinder(lo.stone, a.x, H(a.x, a.z) - 2, a.z, 2.6, 2.4, 14, 6, stoneC, true, 0.15);
        if (style.towerTop !== 'crenel') cone(hi.roof, a.x, H(a.x, a.z) + 12, a.z, 3.2, 6, 8, roofC);
      }
      occupied.push({ x: kx, z: kz, r: bw * 0.72 + 2 });
    }
  } else if (inp.tier === 1) {
    // manor hall with tower
    const y = footprintOk(kx, kz, 18, 10, kyaw) ?? baseK;
    box(hi.stone, kx, y - 2, kz, 18, 9, 10, kyaw, vary(stoneC, r), 0.2);
    box(lo.stone, kx, y - 2, kz, 18, 9, 10, kyaw, stoneC, 0.2);
    gableRoof(hi.roof, hi.stone, kx, y + 7, kz, 18, 10, 5, kyaw, roofC, stoneC);
    gableRoof(lo.roof, lo.stone, kx, y + 7, kz, 18, 10, 5, kyaw, roofC, stoneC);
    const t = frame(kx, kz, kyaw)(10, 0, 0);
    box(hi.stone, t.x, y - 2, t.z, 7, 20, 7, kyaw, stoneC, 0.2);
    box(lo.stone, t.x, y - 2, t.z, 7, 20, 7, kyaw, stoneC, 0.2);
    merlons(hi.stone, t.x - 3.5, t.z, t.x + 3.5, t.z, y + 18, 1, stoneC);
    keepTop = y + 18;
    flagsAt.push({ pos: new THREE.Vector3(t.x, y + 18, t.z), size: 1.0 });
    occupied.push({ x: kx, z: kz, r: 14 });
    lamps.push(new THREE.Vector3(kx, y + 4, kz));
  } else {
    // village chapel with belfry
    const y = footprintOk(kx, kz, 7, 12, kyaw) ?? baseK;
    box(hi.stone, kx, y - 1, kz, 7, 6, 12, kyaw, vary(stoneC, r), 0.25);
    box(lo.stone, kx, y - 1, kz, 7, 6, 12, kyaw, stoneC, 0.25);
    gableRoof(hi.roof, hi.stone, kx, y + 5, kz, 12, 7, 3.5, kyaw + Math.PI / 2, roofC, stoneC);
    const t = frame(kx, kz, kyaw)(0, 0, 7);
    box(hi.stone, t.x, y - 1, t.z, 3.5, 11, 3.5, kyaw, stoneC, 0.25);
    pyramid(hi.roof, t.x, y + 10, t.z, 4, 4, 4, kyaw, roofC);
    keepTop = y + 14;
    flagsAt.push({ pos: new THREE.Vector3(t.x, y + 14, t.z), size: 0.8 });
    occupied.push({ x: kx, z: kz, r: 9 });
  }

  // --- plaza & market
  const plazaDir = gateDirs[0];
  const plazaDist = big ? R * 0.42 : R * 0.35;
  let px = cx + Math.cos(plazaDir) * plazaDist;
  let pz = cz + Math.sin(plazaDir) * plazaDist;
  if (isWater(px, pz)) {
    px = cx - Math.cos(harbor ?? 0) * R * 0.15;
    pz = cz - Math.sin(harbor ?? 0) * R * 0.15;
  }
  const plazaR = inp.tier >= 2 ? 16 : inp.tier === 1 ? 11 : 7;
  const plaza = new THREE.Vector3(px, H(px, pz), pz);
  occupied.push({ x: px, z: pz, r: plazaR });
  walk.push(plaza.clone());
  // well
  cylinder(hi.stone, px, H(px, pz) - 0.5, pz, 1.4, 1.4, 1.6, 8, stoneC, true);
  box(hi.wood, px, H(px, pz) + 1, pz, 3.2, 0.3, 0.3, 0, timberC);
  if (inp.buildings.has('market') || inp.tier >= 1) {
    const nStalls = inp.tier >= 2 ? 10 : 5;
    const canopy = [C('#8c2f2a'), C('#2f5d8c'), C('#c9a14a'), C('#4f7a3a'), C('#e6dcc6'), C('#6b3f7a')];
    for (let i = 0; i < nStalls; i++) {
      const a = (i / nStalls) * Math.PI * 2 + r.range(-0.1, 0.1);
      const sx = px + Math.cos(a) * (plazaR - 3.5);
      const sz = pz + Math.sin(a) * (plazaR - 3.5);
      const y = H(sx, sz);
      const yaw = -a + Math.PI / 2;
      box(hi.wood, sx, y, sz, 3, 1.1, 2, yaw, vary(timberC, r, 0.15), 0.4);
      // canopy
      const f = frame(sx, sz, yaw);
      const cc = canopy[i % canopy.length];
      const a1 = f(-1.8, y + 2.6, -1.4);
      const b1 = f(1.8, y + 2.6, -1.4);
      const c1 = f(1.8, y + 2.0, 1.6);
      const d1 = f(-1.8, y + 2.0, 1.6);
      hi.cloth.quad(d1, c1, b1, a1, 1, 1, cc);
      for (const [lx, lz] of [
        [-1.6, -1.2],
        [1.6, -1.2],
        [-1.6, 1.4],
        [1.6, 1.4],
      ])
        {
          const p = f(lx, y, lz);
          box(hi.wood, p.x, y, p.z, 0.15, 2.5, 0.15, yaw, timberC);
        }
      walk.push(new THREE.Vector3(sx, y, sz));
    }
  }
  lamps.push(plaza.clone().setY(plaza.y + 3));

  // --- temple (city+)
  if (inp.tier >= 2) {
    const a = plazaDir + Math.PI * 0.55;
    const tx = cx + Math.cos(a) * R * 0.38;
    const tz = cz + Math.sin(a) * R * 0.38;
    const yaw = -a;
    const y = footprintOk(tx, tz, 11, 26, yaw);
    if (y !== null && free(tx, tz, 12)) {
      box(hi.stone, tx, y - 2, tz, 11, 13, 26, yaw, vary(C('#d2c6ae'), r, 0.03), 0.18);
      box(lo.stone, tx, y - 2, tz, 11, 13, 26, yaw, C('#d2c6ae'), 0.18);
      gableRoof(hi.roof, hi.stone, tx, y + 11, tz, 26, 11, 6, yaw + Math.PI / 2, roof2C, C('#d2c6ae'));
      gableRoof(lo.roof, lo.stone, tx, y + 11, tz, 26, 11, 6, yaw + Math.PI / 2, roof2C, C('#d2c6ae'));
      const t = frame(tx, tz, yaw)(0, 0, 15);
      box(hi.stone, t.x, y - 2, t.z, 7, 24, 7, yaw, C('#d2c6ae'), 0.18);
      box(lo.stone, t.x, y - 2, t.z, 7, 24, 7, yaw, C('#d2c6ae'), 0.18);
      pyramid(hi.roof, t.x, y + 22, t.z, 7.5, 7.5, style.towerTop === 'dome' ? 6 : 16, yaw, roof2C);
      pyramid(lo.roof, t.x, y + 22, t.z, 7.5, 7.5, style.towerTop === 'dome' ? 6 : 16, yaw, roof2C);
      // rose window
      const rw = frame(tx, tz, yaw)(0, 0, -13.1);
      box(hi.dark, rw.x, y + 6, rw.z, 3, 3, 0.2, yaw, C('#1a130d'));
      occupied.push({ x: tx, z: tz, r: 15 });
      lamps.push(new THREE.Vector3(tx, y + 6, tz));
    }
  }

  // --- walls
  const wallR = R * 0.97;
  const hasWalls = inp.walls > 0;
  const gates: THREE.Vector3[] = [];
  const wallH = inp.walls >= 3 ? 14 : inp.walls === 2 ? 10 : 6;
  const wallT = inp.walls >= 3 ? 3.6 : inp.walls === 2 ? 2.8 : 1.2;
  if (hasWalls) {
    const N = Math.max(8, Math.round((2 * Math.PI * wallR) / (inp.walls >= 2 ? 34 : 26)));
    const verts: { x: number; z: number; a: number }[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.13;
      const rr = wallR * (1 + r.range(-0.05, 0.05));
      verts.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr, a });
    }
    for (let i = 0; i < N; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % N];
      const mid = Math.atan2((a.z + b.z) / 2 - cz, (a.x + b.x) / 2 - cx);
      if (inHarborSector(mid)) continue;
      if (isWater(a.x, a.z) || isWater(b.x, b.z)) continue;
      {
        let crossesRiver = false;
        for (let t = 0; t <= 1; t += 0.1) if (isRiver(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) || isWater(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) crossesRiver = true;
        if (crossesRiver) continue;
      }
      // gate?
      const isGate = gateDirs.some((g) => angDiff(g, mid) < Math.PI / N + 0.02);
      if (isGate) {
        const gx = (a.x + b.x) / 2;
        const gz = (a.z + b.z) / 2;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const gapH = 7;
        const yawSeg = Math.atan2(b.x - a.x, b.z - a.z);
        // walls either side of the gate
        const ux = (b.x - a.x) / len;
        const uz = (b.z - a.z) / len;
        wallRun(hi, lo, geo, a.x, a.z, gx - ux * 6, gz - uz * 6, wallH, wallT, stoneC, inp.walls === 1 ? 1 : 0, inp.walls === 1 ? timberC : undefined);
        wallRun(hi, lo, geo, gx + ux * 6, gz + uz * 6, b.x, b.z, wallH, wallT, stoneC, inp.walls === 1 ? 1 : 0, inp.walls === 1 ? timberC : undefined);
        const gy = H(gx, gz);
        const mat = inp.walls === 1 ? hi.wood : hi.stone;
        const col = inp.walls === 1 ? timberC : stoneC;
        // gatehouse towers
        for (const s of [-1, 1]) {
          const tx = gx + ux * 6.5 * s;
          const tz = gz + uz * 6.5 * s;
          if (inp.walls === 1) {
            box(mat, tx, H(tx, tz) - 1, tz, 3.5, wallH + 4, 3.5, yawSeg, col, 0.3);
            box(lo.wood, tx, H(tx, tz) - 1, tz, 3.5, wallH + 4, 3.5, yawSeg, col, 0.3);
            pyramid(hi.roof, tx, H(tx, tz) + wallH + 3, tz, 4.4, 4.4, 2.5, yawSeg, roofC);
          } else {
            cylinder(hi.stone, tx, H(tx, tz) - 2, tz, 4.2, 3.8, wallH + 8, 10, vary(stoneC, r, 0.04), true, 0.15);
            cylinder(lo.stone, tx, H(tx, tz) - 2, tz, 4.2, 3.8, wallH + 8, 6, stoneC, true, 0.15);
            if (style.towerTop === 'crenel') for (let k = 0; k < 6; k++) box(hi.stone, tx + Math.cos((k / 6) * 6.28) * 3.4, H(tx, tz) + wallH + 6, tz + Math.sin((k / 6) * 6.28) * 3.4, 1.2, 1.4, 1, -(k / 6) * 6.28, stoneC);
            else cone(hi.roof, tx, H(tx, tz) + wallH + 6, tz, 4.6, style.towerTop === 'spire' ? 10 : 6, 10, roofC);
          }
          flagsAt.push({ pos: new THREE.Vector3(tx, H(tx, tz) + wallH + (inp.walls === 1 ? 5.5 : 12), tz), size: 0.8 });
        }
        // arch over the gate
        box(mat, gx, gy + gapH, gz, 3.6, wallH - gapH + 3, 9.5, yawSeg, col, 0.25);
        box(hi.dark, gx, gy - 0.5, gz, 3.8, gapH + 0.5, 6.2, yawSeg, C('#1a130d'));
        const inward = new THREE.Vector3(cx - gx, 0, cz - gz).normalize();
        gates.push(new THREE.Vector3(gx + inward.x * 8, gy, gz + inward.z * 8));
        lamps.push(new THREE.Vector3(gx + inward.x * 3, gy + 5, gz + inward.z * 3));
        lamps.push(new THREE.Vector3(gx - inward.x * 3, gy + 5, gz - inward.z * 3));
      } else {
        wallRun(hi, lo, geo, a.x, a.z, b.x, b.z, wallH, wallT, stoneC, inp.walls === 1 ? 1 : 0, inp.walls === 1 ? timberC : undefined);
      }
    }
    // towers at vertices (stone walls)
    for (let i = 0; i < N; i++) {
      const v = verts[i];
      if (inHarborSector(v.a) && !isWater(v.x, v.z)) {
        /* harbour-side corner tower still useful */
      } else if (inHarborSector(v.a)) continue;
      if (isWater(v.x, v.z) || isRiver(v.x, v.z)) continue;
      const nearGate = gateDirs.some((g) => angDiff(g, v.a) < 0.12);
      if (nearGate) continue;
      const y = H(v.x, v.z);
      if (inp.walls === 1) {
        box(hi.wood, v.x, y - 1, v.z, 3, wallH + 3, 3, v.a, timberC, 0.3);
        pyramid(hi.roof, v.x, y + wallH + 2, v.z, 3.8, 3.8, 2.4, v.a, roofC);
      } else {
        const tr = inp.walls >= 3 ? 5 : 4;
        cylinder(hi.stone, v.x, y - 2, v.z, tr, tr * 0.9, wallH + 5, 10, vary(stoneC, r, 0.04), true, 0.15);
        cylinder(lo.stone, v.x, y - 2, v.z, tr, tr * 0.9, wallH + 5, 6, stoneC, true, 0.15);
        if (style.towerTop === 'crenel') {
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2;
            box(hi.stone, v.x + Math.cos(a) * tr * 0.8, y + wallH + 3, v.z + Math.sin(a) * tr * 0.8, 1.2, 1.4, 1, -a, stoneC);
          }
        } else {
          cone(hi.roof, v.x, y + wallH + 3, v.z, tr * 1.15, style.towerTop === 'spire' ? 9 : style.towerTop === 'dome' ? 4 : 6, 10, roofC);
          cone(lo.roof, v.x, y + wallH + 3, v.z, tr * 1.15, style.towerTop === 'spire' ? 9 : 6, 6, roofC);
        }
        if (i % 3 === 0) flagsAt.push({ pos: new THREE.Vector3(v.x, y + wallH + (style.towerTop === 'crenel' ? 4.5 : 9), v.z), size: 0.7 });
      }
    }
  }
  if (!gates.length)
    for (const g of gateDirs) {
      const gx = cx + Math.cos(g) * R * 0.95;
      const gz = cz + Math.sin(g) * R * 0.95;
      gates.push(new THREE.Vector3(gx, H(gx, gz), gz));
    }
  // keep streets clear: avoid gate rays
  const onStreet = (x: number, z: number) => {
    for (const g of gateDirs) {
      const dx = x - cx;
      const dz = z - cz;
      const along = dx * Math.cos(g) + dz * Math.sin(g);
      const across = Math.abs(-dx * Math.sin(g) + dz * Math.cos(g));
      if (along > 0 && across < 4.5) return true;
    }
    if (harbor !== null) {
      const dx = x - cx;
      const dz = z - cz;
      const along = dx * Math.cos(harbor) + dz * Math.sin(harbor);
      const across = Math.abs(-dx * Math.sin(harbor) + dz * Math.cos(harbor));
      if (along > 0 && across < 4.5) return true;
    }
    return false;
  };
  for (const g of gateDirs) for (let k = 1; k <= 4; k++) walk.push(new THREE.Vector3(cx + Math.cos(g) * R * 0.22 * k, 0, cz + Math.sin(g) * R * 0.22 * k));

  // --- houses in rings facing the centre
  const houseCount = [14, 55, 130, 210][inp.tier] ?? 20;
  let placed = 0;
  const inner = big ? 26 : 16;
  const outer = hasWalls ? wallR - wallT - 5 : R * 1.05;
  const stoneHouseChance = inp.tier >= 2 ? 0.35 : 0.12;
  const placeHouse = (x: number, z: number, yaw: number, scale: number, lod: boolean) => {
    const w = r.range(5, 7.5) * scale;
    const d = r.range(6, 9) * scale;
    const floors = inp.tier >= 2 ? r.int(2, 3) : inp.tier === 1 ? r.int(1, 2) : 1;
    const hgt = 3.2 * floors + r.range(0.5, 1.5);
    const y = footprintOk(x, z, w, d, yaw);
    if (y === null || !free(x, z, Math.max(w, d) * 0.55)) return false;
    occupied.push({ x, z, r: Math.max(w, d) * 0.5 });
    const stoneHouse = r.chance(stoneHouseChance);
    const wallB = stoneHouse ? hi.stone : hi.plaster;
    const wallCol = stoneHouse ? vary(stoneC, r, 0.06) : vary(plasterC, r, 0.07);
    box(wallB, x, y - 1.5, z, w, hgt + 1.5, d, yaw, wallCol, stoneHouse ? 0.22 : 0.16, false);
    const rc = r.chance(0.5) ? vary(roofC, r, 0.1) : vary(roof2C, r, 0.1);
    gableRoof(hi.roof, wallB, x, y + hgt, z, w, d, Math.min(4.5, d * 0.45), yaw, rc, wallCol);
    if (r.chance(0.5)) box(hi.stone, ...(() => {
      const p = frame(x, z, yaw)(w * 0.3, 0, d * 0.15);
      return [p.x, y + hgt, p.z] as [number, number, number];
    })(), 0.9, 2.6, 0.9, yaw, stoneC);
    if (lod) {
      box(stoneHouse ? lo.stone : lo.plaster, x, y - 1.5, z, w, hgt + 1.5, d, yaw, wallCol, 0.16, false);
      gableRoof(lo.roof, stoneHouse ? lo.stone : lo.plaster, x, y + hgt, z, w, d, Math.min(4.5, d * 0.45), yaw, rc, wallCol);
    }
    placed++;
    return true;
  };
  if (inp.tier === 0) {
    for (let t = 0; t < 120 && placed < houseCount; t++) {
      const a = r.range(0, Math.PI * 2);
      const rr = r.range(12, R * 1.1);
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (onStreet(x, z)) continue;
      placeHouse(x, z, -a + r.range(-0.3, 0.3), 0.9, placed % 2 === 0);
    }
  } else {
    for (let ring = inner; ring < outer && placed < houseCount; ring += r.range(9, 11)) {
      const circ = 2 * Math.PI * ring;
      const n = Math.floor(circ / 9.5);
      const off = r.range(0, Math.PI * 2);
      for (let k = 0; k < n && placed < houseCount; k++) {
        const a = off + (k / n) * Math.PI * 2 + r.range(-0.02, 0.02);
        const x = cx + Math.cos(a) * ring;
        const z = cz + Math.sin(a) * ring;
        if (onStreet(x, z)) continue;
        if (r.chance(0.12)) continue;
        placeHouse(x, z, -a + Math.PI / 2 + r.range(-0.08, 0.08), 1, k % 3 === 0);
      }
      walk.push(new THREE.Vector3(cx + Math.cos(off) * (ring + 5), 0, cz + Math.sin(off) * (ring + 5)));
    }
    // suburbs along the roads outside the walls
    if (inp.tier >= 2)
      for (const g of gateDirs) {
        for (let k = 0; k < 10; k++) {
          const along = R + 10 + k * 9;
          for (const s of [-1, 1]) {
            const x = cx + Math.cos(g) * along - Math.sin(g) * 8 * s;
            const z = cz + Math.sin(g) * along + Math.cos(g) * 8 * s;
            if (r.chance(0.3)) continue;
            placeHouse(x, z, -g + (s > 0 ? 0 : Math.PI), 0.9, false);
          }
        }
      }
  }

  // --- barracks yard, stables
  if (inp.buildings.has('barracks') && inp.tier >= 1) {
    const a = gateDirs[gateDirs.length - 1] + 0.7;
    const bx = cx + Math.cos(a) * R * 0.62;
    const bz = cz + Math.sin(a) * R * 0.62;
    const y = footprintOk(bx, bz, 16, 7, -a);
    if (y !== null && free(bx, bz, 10)) {
      box(hi.stone, bx, y - 1, bz, 16, 5, 7, -a, vary(stoneC, r), 0.2);
      gableRoof(hi.roof, hi.stone, bx, y + 4, bz, 16, 7, 3, -a, roof2C, stoneC);
      box(lo.stone, bx, y - 1, bz, 16, 5, 7, -a, stoneC, 0.2);
      occupied.push({ x: bx, z: bz, r: 11 });
      walk.push(new THREE.Vector3(bx, y, bz));
    }
  }
  if (inp.buildings.has('stables')) {
    const a = gateDirs[0] + 0.5;
    const sx = cx + Math.cos(a) * (R + 22);
    const sz = cz + Math.sin(a) * (R + 22);
    const y = footprintOk(sx, sz, 18, 6, -a);
    if (y !== null) {
      box(hi.wood, sx, y - 1, sz, 18, 4, 6, -a, vary(timberC, r, 0.1), 0.25);
      gableRoof(hi.roof, hi.wood, sx, y + 3, sz, 18, 6, 2.5, -a, roofC, timberC);
      // paddock fence
      const f = frame(sx, sz, -a);
      const corners = [f(-10, 0, 5), f(10, 0, 5), f(10, 0, 18), f(-10, 0, 18)];
      for (let i = 0; i < 4; i++) {
        const p = corners[i];
        const q = corners[(i + 1) % 4];
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        box(hi.wood, (p.x + q.x) / 2, H((p.x + q.x) / 2, (p.z + q.z) / 2) + 0.7, (p.z + q.z) / 2, 0.2, 0.25, len, Math.atan2(q.x - p.x, q.z - p.z), timberC);
      }
    }
  }

  // --- docks
  const docks: THREE.Vector3[] = [];
  if (pg.port && (inp.buildings.has('harbor') || inp.buildings.has('fishery') || inp.tier >= 1)) {
    const ca = harbor!;
    const dx = Math.cos(ca);
    const dz = Math.sin(ca);
    // find the shoreline
    let s = R * 0.3;
    while (s < R * 3 && H(cx + dx * s, cz + dz * s) > 0.8) s += 2;
    const shx = cx + dx * s;
    const shz = cz + dz * s;
    const pierLen = inp.buildings.has('harbor') ? (inp.tier >= 2 ? 52 : 38) : 24;
    const deckY = 1.8;
    const piers: [number, number, number][] = [[0, pierLen, 5]];
    if (inp.buildings.has('trade_docks') || inp.tier >= 3) piers.push([-22, pierLen * 0.8, 4.5], [22, pierLen * 0.7, 4.5]);
    for (const [off, len, w] of piers) {
      const ox = shx - dz * off;
      const oz = shz + dx * off;
      const sx = ox - dx * 8;
      const sz = oz - dz * 8;
      const ex = ox + dx * len;
      const ez = oz + dz * len;
      const yaw = Math.atan2(dx, dz);
      box(hi.wood, (sx + ex) / 2, deckY - 0.4, (sz + ez) / 2, w, 0.5, len + 8, yaw, vary(C('#8a6a48'), r, 0.05), 0.3);
      box(lo.wood, (sx + ex) / 2, deckY - 0.4, (sz + ez) / 2, w, 0.5, len + 8, yaw, C('#8a6a48'), 0.3);
      for (let k = 0; k <= len; k += 6)
        for (const sd of [-1, 1]) {
          const px2 = ox + dx * k - dz * (w / 2) * sd;
          const pz2 = oz + dz * k + dx * (w / 2) * sd;
          cylinder(hi.wood, px2, -6, pz2, 0.3, 0.3, deckY + 6.3, 5, C('#4a3525'), true);
        }
      // T-head
      box(hi.wood, ex, deckY - 0.4, ez, 18, 0.5, 4, yaw + Math.PI / 2, C('#8a6a48'), 0.3);
      docks.push(new THREE.Vector3(ox + dx * len * 0.5, deckY, oz + dz * len * 0.5), new THREE.Vector3(ex, deckY, ez));
      // barrels & crates
      for (let k = 0; k < 6; k++) {
        const t = r.range(0.1, 0.9) * len;
        const side = r.chance(0.5) ? 1 : -1;
        const bx = ox + dx * t - dz * side * (w / 2 - 0.8);
        const bz = oz + dz * t + dx * side * (w / 2 - 0.8);
        if (r.chance(0.5)) cylinder(hi.wood, bx, deckY - 0.15, bz, 0.45, 0.45, 1.1, 7, C('#6a4a2a'), true);
        else box(hi.wood, bx, deckY - 0.15, bz, 1.1, 1.1, 1.1, yaw + r.range(0, 1), C('#7a5a38'), 0.5);
      }
    }
    // warehouses along the shore
    const nW = inp.tier >= 2 ? 4 : 2;
    for (let k = 0; k < nW; k++) {
      const off = (k - (nW - 1) / 2) * 16;
      const wx = shx - dx * 14 - dz * off;
      const wz = shz - dz * 14 + dx * off;
      const yaw = Math.atan2(dx, dz) + Math.PI / 2;
      const y = footprintOk(wx, wz, 14, 8, yaw);
      if (y === null || !free(wx, wz, 7)) continue;
      box(hi.stone, wx, y - 1.5, wz, 14, 7.5, 8, yaw, vary(stoneC, r, 0.05), 0.2, false);
      gableRoof(hi.roof, hi.stone, wx, y + 6, wz, 14, 8, 3.2, yaw, vary(roof2C, r), stoneC);
      box(lo.stone, wx, y - 1.5, wz, 14, 7.5, 8, yaw, stoneC, 0.2, false);
      gableRoof(lo.roof, lo.stone, wx, y + 6, wz, 14, 8, 3.2, yaw, roof2C, stoneC);
      occupied.push({ x: wx, z: wz, r: 8 });
    }
    // crane at the pier root
    {
      const crx = shx + dx * 3 - dz * 4;
      const crz = shz + dz * 3 + dx * 4;
      const y = Math.max(deckY, H(crx, crz));
      box(hi.wood, crx, y, crz, 3.2, 3, 3.2, 0, timberC, 0.3);
      box(hi.wood, crx, y + 3, crz, 0.6, 9, 0.6, 0, timberC, 0.3);
      const f = frame(crx, crz, Math.atan2(dx, dz));
      const tip = f(0, 0, 6);
      const beamLen = 8;
      const mid = f(0, 0, 3);
      box(hi.wood, mid.x, y + 10.5, mid.z, 0.45, 0.45, beamLen, Math.atan2(dx, dz), timberC);
      cylinder(hi.wood, tip.x, y + 4, tip.z, 0.05, 0.05, 6.5, 4, C('#2b2118'), false);
      // treadwheel
      const wheel = f(-2.2, 0, 0);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        box(hi.wood, wheel.x, y + 3 + 2 + Math.sin(a) * 2, wheel.z + Math.cos(a) * 2 * 0, 0.3, 0.4, 1.4, Math.atan2(dx, dz), timberC);
      }
    }
    // shipyard slipway
    if (inp.buildings.has('shipyard')) {
      const sx = shx - dz * 30;
      const sz = shz + dx * 30;
      const yaw = Math.atan2(dx, dz);
      box(hi.wood, sx, -1, sz, 8, 1.5, 34, yaw, C('#7a5a3c'), 0.3);
      for (let k = 0; k < 9; k++) {
        const p = frame(sx, sz, yaw)(0, 0, -12 + k * 3);
        for (const sd of [-1, 1]) {
          const q = frame(p.x, p.z, yaw)(sd * 2.6, 0, 0);
          box(hi.wood, q.x, 0.5, q.z, 0.35, 5.5 - Math.abs(k - 4) * 0.4, 0.35, yaw + sd * 0.25, C('#8a6a48'));
        }
      }
      box(hi.wood, sx, 0.4, sz, 0.8, 0.6, 26, yaw, C('#6a4a2a'));
    }
    // sea towers
    if (inp.walls >= 2) {
      for (const sd of [-1, 1]) {
        const tx = shx - dz * sd * 34 + dx * 2;
        const tz = shz + dx * sd * 34 + dz * 2;
        const y = Math.max(0, H(tx, tz));
        cylinder(hi.stone, tx, y - 4, tz, 4.5, 4, wallH + 10, 10, stoneC, true, 0.15);
        cylinder(lo.stone, tx, y - 4, tz, 4.5, 4, wallH + 10, 6, stoneC, true, 0.15);
        lamps.push(new THREE.Vector3(tx, y + wallH + 5, tz));
        flagsAt.push({ pos: new THREE.Vector3(tx, y + wallH + 7, tz), size: 0.8 });
      }
    }
    lamps.push(new THREE.Vector3(shx, 4, shz));
  }

  // --- farmsteads & windmills in the countryside
  const fields: THREE.Vector3[] = [];
  const farmN = inp.tier === 0 ? 3 : inp.tier === 1 ? 5 : 7;
  for (let k = 0; k < farmN * 3 && fields.length < farmN; k++) {
    const a = r.range(0, Math.PI * 2);
    if (inHarborSector(a)) continue;
    const rr = R * r.range(1.35, 2.6);
    const fx = cx + Math.cos(a) * rr;
    const fz = cz + Math.sin(a) * rr;
    const y = footprintOk(fx, fz, 8, 6, -a);
    if (y === null) continue;
    box(hi.plaster, fx, y - 1, fz, 7, 4.5, 6, -a, vary(plasterC, r), 0.16, false);
    gableRoof(hi.roof, hi.plaster, fx, y + 3.5, fz, 7, 6, 2.8, -a, vary(roofC, r), plasterC);
    const b2 = frame(fx, fz, -a)(9, 0, 1);
    box(hi.wood, b2.x, y - 1, b2.z, 9, 5, 6, -a, vary(timberC, r, 0.1), 0.25, false);
    gableRoof(hi.roof, hi.wood, b2.x, y + 4, b2.z, 9, 6, 2.6, -a, vary(roof2C, r), timberC);
    box(lo.plaster, fx, y - 1, fz, 7, 4.5, 6, -a, plasterC, 0.16, false);
    fields.push(new THREE.Vector3(fx + Math.cos(a) * 18, y, fz + Math.sin(a) * 18));
  }
  const grain = pg.resources.includes('grain') || inp.buildings.has('farm');
  if (grain) {
    const nm = inp.tier >= 2 ? 3 : 1;
    for (let k = 0; k < nm * 4 && mills.length < nm; k++) {
      const a = r.range(0, Math.PI * 2);
      if (inHarborSector(a)) continue;
      const rr = R * r.range(1.4, 2.2);
      const mx = cx + Math.cos(a) * rr;
      const mz = cz + Math.sin(a) * rr;
      const y = footprintOk(mx, mz, 5, 5, 0);
      if (y === null) continue;
      cylinder(hi.stone, mx, y - 1, mz, 2.8, 2.2, 10, 10, C('#d8cfbc'), false, 0.2);
      cylinder(lo.stone, mx, y - 1, mz, 2.8, 2.2, 10, 6, C('#d8cfbc'), false, 0.2);
      cone(hi.roof, mx, y + 9, mz, 2.7, 3.2, 10, roofC);
      mills.push({ x: mx, z: mz, y: y + 8.2, yaw: -a + Math.PI / 2 });
    }
  }

  // --- assemble meshes
  const m = archMaterials();
  const makeGroup = (b: Buckets, shadows: boolean) => {
    const g = new THREE.Group();
    for (const k of Object.keys(b) as (keyof Buckets)[]) {
      const geo2 = b[k].build();
      if (!geo2) continue;
      const mesh = new THREE.Mesh(geo2, m[k]);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      mesh.matrixAutoUpdate = false;
      g.add(mesh);
    }
    return g;
  };
  const hiG = makeGroup(hi, true);
  const loG = makeGroup(lo, false);
  const lod = new THREE.LOD();
  lod.addLevel(hiG, 0);
  lod.addLevel(loG, 1100);
  const group = new THREE.Group();
  group.add(lod);
  // windmill sails (animated)
  const millObjs: THREE.Object3D[] = [];
  const sailGeo = new THREE.BoxGeometry(0.25, 7, 1.4);
  sailGeo.translate(0, 3.8, 0);
  const sailMat = m.wood;
  for (const ml of mills) {
    const hub = new THREE.Object3D();
    hub.position.set(ml.x + Math.sin(ml.yaw) * 2.9, ml.y, ml.z + Math.cos(ml.yaw) * 2.9);
    hub.rotation.y = ml.yaw;
    const rot = new THREE.Object3D();
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(sailGeo, sailMat);
      blade.rotation.z = (k * Math.PI) / 2;
      blade.castShadow = true;
      rot.add(blade);
    }
    hub.add(rot);
    hiG.add(hub);
    millObjs.push(rot);
  }
  // flags
  const flagGeo = new THREE.PlaneGeometry(6, 4, 8, 2);
  flagGeo.translate(3, 0, 0);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 4);
  poleGeo.translate(0, 3, 0);
  const flagMat = makeFlagMaterial(inp.owner);
  const flags: THREE.Mesh[] = [];
  for (const f of flagsAt) {
    const pole = new THREE.Mesh(poleGeo, m.wood);
    pole.position.copy(f.pos);
    pole.scale.setScalar(f.size);
    hiG.add(pole);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.copy(f.pos).add(new THREE.Vector3(0, 6 * f.size - 2 * f.size, 0));
    flag.scale.setScalar(f.size);
    flag.rotation.y = r.range(0, 0.4);
    hiG.add(flag);
    flags.push(flag);
    // far LOD keeps the main flags
    if (f === flagsAt[0]) {
      const f2 = new THREE.Mesh(flagGeo, flagMat);
      f2.position.copy(flag.position);
      f2.scale.setScalar(f.size * 1.6);
      loG.add(f2);
      flags.push(f2);
    }
  }
  for (const w of walk) w.y = H(w.x, w.z);
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
    bannerTop: new THREE.Vector3(kx, keepTop + 14, kz),
    radius: R,
    dispose() {
      for (const g of [hiG, loG])
        g.traverse((o) => {
          const mm = o as THREE.Mesh;
          if (mm.isMesh && mm.geometry !== sailGeo && mm.geometry !== flagGeo && mm.geometry !== poleGeo) mm.geometry.dispose();
        });
      sailGeo.dispose();
      flagGeo.dispose();
      poleGeo.dispose();
    },
  };
}

/** A wall run that follows the terrain, with walkway merlons. palisade=1 uses timber stakes. */
function wallRun(hi: Buckets, lo: Buckets, geo: WorldGeo, ax: number, az: number, bx: number, bz: number, h: number, t: number, col: THREE.Color, palisade: number, timber?: THREE.Color) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.5) return;
  const segs = Math.max(1, Math.ceil(len / 7));
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
    const sl = len / segs + 0.3;
    if (palisade === 1) {
      const n = Math.max(2, Math.round(sl / 0.8));
      for (let k = 0; k < n; k++) {
        const tt = (k + 0.5) / n;
        const px = x0 + (x1 - x0) * tt;
        const pz = z0 + (z1 - z0) * tt;
        const yy = heightAt(geo, px, pz);
        cylinder(hi.wood, px, yy - 1, pz, 0.4, 0.35, h + 1, 5, timber ?? col, false);
        cone(hi.wood, px, yy + h, pz, 0.35, 0.9, 5, timber ?? col);
      }
      box(lo.wood, mx, y - 1, mz, 0.8, h + 1, sl, yaw, timber ?? col, 0.25);
    } else {
      box(hi.stone, mx, y - 2, mz, t, h + 2, sl, yaw, col, 0.18);
      box(lo.stone, mx, y - 2, mz, t, h + 2, sl, yaw, col, 0.18);
      // merlons on the outer edge
      const nx = Math.cos(yaw);
      const nz = -Math.sin(yaw);
      merlons(hi.stone, x0 + nx * (t / 2 - 0.3), z0 + nz * (t / 2 - 0.3), x1 + nx * (t / 2 - 0.3), z1 + nz * (t / 2 - 0.3), y + h, 0.6, col, 1.0);
    }
  }
}
