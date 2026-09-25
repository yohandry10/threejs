import { Noise2D } from '../../core/noise';
import { MinHeap, clamp, smoothstep } from '../../core/math';
import { ANCHORS, BAYS, LANDMASSES, RANGES, RIVERS, SEA_ZONES, WORLD_H, WORLD_W, type Blob } from '../../data/worldLayout';
import { Biome, NavT, type BridgeGeo, type ProvinceGeo, type RiverGeo, type RoadGeo, type TerrainKind, type WorldGeo } from './geo';

export const WORLD_SEED = 1337;
const HM_STEP = 8;
const NAV_STEP = 16;

type Progress = (p: number, label: string) => void;

function ellipseField(u: number, v: number, b: Blob): number {
  const du = (u - b.u) / b.ru;
  const dv = (v - b.v) / b.rv;
  return 1 - Math.sqrt(du * du + dv * dv);
}

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return [Math.sqrt(qx * qx + qz * qz), t];
}

function catmull(points: [number, number][], samplesPerSeg: number): [number, number][] {
  const out: [number, number][] = [];
  const p = points;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

/**
 * Generates the deterministic geography of the realm. Pure function: no DOM or three.js.
 */
export function generateWorld(progress: Progress = () => {}): WorldGeo {
  const W = WORLD_W;
  const H = WORLD_H;
  const hmW = W / HM_STEP;
  const hmH = H / HM_STEP;
  const navW = W / NAV_STEP;
  const navH = H / NAV_STEP;
  const n1 = new Noise2D(WORLD_SEED);
  const n2 = new Noise2D(WORLD_SEED * 7 + 3);
  const n3 = new Noise2D(WORLD_SEED * 13 + 11);

  const height = new Float32Array(hmW * hmH);
  const landField = new Float32Array(hmW * hmH);
  const massOf = new Uint8Array(hmW * hmH);

  // Pre-convert ranges to world coords
  const ranges = RANGES.map((r) => ({
    ...r,
    pts: r.points.map(([u, v]) => [u * W, v * H] as [number, number]),
    passesW: r.passes.map(([u, v]) => [u * W, v * H] as [number, number]),
    minX: Math.min(...r.points.map((p) => p[0] * W)) - r.width * 3,
    maxX: Math.max(...r.points.map((p) => p[0] * W)) + r.width * 3,
    minZ: Math.min(...r.points.map((p) => p[1] * H)) - r.width * 3,
    maxZ: Math.max(...r.points.map((p) => p[1] * H)) + r.width * 3,
  }));

  progress(0.02, 'Raising the continents');
  for (let iz = 0; iz < hmH; iz++) {
    for (let ix = 0; ix < hmW; ix++) {
      const x = ix * HM_STEP;
      const z = iz * HM_STEP;
      const u0 = x / W;
      const v0 = z / H;
      // domain warp
      const wu = 0.016 * n1.fbm(u0 * 5 + 11.3, v0 * 5 + 2.1, 3);
      const wv = 0.016 * n1.fbm(u0 * 5 - 4.7, v0 * 5 + 8.9, 3);
      const u = u0 + wu;
      const v = v0 + wv;
      let f = -1;
      let mass = 0;
      let rugged = 0;
      for (const lm of LANDMASSES) {
        let lf = -1;
        for (const b of lm.blobs) lf = Math.max(lf, ellipseField(u, v, b));
        if (lf > f) {
          f = lf;
          mass = lm.id;
          rugged = lm.rugged;
        }
      }
      for (const b of BAYS) {
        const bf = ellipseField(u, v, b);
        if (bf > 0) f -= bf * 1.5;
      }
      // anchors guarantee land
      for (const a of ANCHORS) {
        const du = (u0 - a.u) / 0.02;
        const dv = (v0 - a.v) / 0.03;
        const d = Math.sqrt(du * du + dv * dv);
        if (d < 1) f = Math.max(f, 0.18 * (1 - d));
      }
      const cont = mass === 1 ? 1 : 0.55;
      f += cont * 0.12 * n2.fbm(u * 6.5 + 1.7, v * 6.5 - 3.1, 4) + 0.06 * n2.fbm(u * 16, v * 16, 4) + 0.03 * n2.fbm(u * 45 + 3, v * 45 - 7, 3);
      // ocean at the map edges
      const edge = Math.min(u0, 1 - u0, v0 * 1.5, (1 - v0) * 1.5);
      f -= (1 - smoothstep(0.0, 0.05, edge)) * 0.6;
      const i = iz * W / HM_STEP + ix;
      landField[i] = f;
      massOf[i] = mass;

      let h: number;
      if (f < 0) {
        h = -(0.6 + -f * 110 + Math.max(0, -f - 0.05) * 420) + n3.fbm(u * 30, v * 30, 2) * 1.5;
        h = Math.max(h, -170);
      } else {
        const inland = smoothstep(0, 0.12, f);
        const cliffs = rugged > 0.3 ? rugged : 0;
        h = 0.9 + 55 * Math.pow(f, 1.5) + cliffs * 90 * smoothstep(0.0, 0.08, f);
        h += n3.fbm(u * 14, v * 14, 4) * 11 * smoothstep(0.02, 0.2, f);
        const hm = smoothstep(0.15, 0.55, n1.fbm(u * 3.2 + 7, v * 3.2 + 3, 3));
        if (hm > 0) h += n1.ridged(u * 11, v * 11, 4) * 70 * hm * smoothstep(0.03, 0.2, f);
        for (const r of ranges) {
          if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
          let dmin = 1e9;
          for (let s = 0; s < r.pts.length - 1; s++) {
            const [d] = distToSeg(x, z, r.pts[s][0], r.pts[s][1], r.pts[s + 1][0], r.pts[s + 1][1]);
            if (d < dmin) dmin = d;
          }
          if (dmin > r.width * 2.8) continue;
          let m = Math.exp(-((dmin / r.width) ** 2) * 1.1);
          for (const p of r.passesW) {
            const dp = Math.hypot(x - p[0], z - p[1]);
            m *= 1 - 0.78 * Math.exp(-((dp / (r.width * 0.85)) ** 2));
          }
          const rid = 0.45 + 0.75 * n2.ridged(u * 20 + 5, v * 20 + 1, 5);
          h += r.height * m * rid * inland;
        }
      }
      height[i] = h;
    }
    if (iz % 64 === 0) progress(0.02 + (iz / hmH) * 0.3, 'Raising the continents');
  }

  // ---------------------------------------------------------------- rivers
  progress(0.34, 'Carving rivers');
  const rivers: RiverGeo[] = [];
  const hAt = (x: number, z: number) => {
    const ix = clamp(Math.round(x / HM_STEP), 0, hmW - 1);
    const iz = clamp(Math.round(z / HM_STEP), 0, hmH - 1);
    return height[iz * hmW + ix];
  };
  for (const rd of RIVERS) {
    const raw = catmull(rd.points.map(([u, v]) => [u * W, v * H]), 1);
    // resample at ~12 units with meander noise
    const spline = catmull(raw, 10);
    const dense: [number, number][] = [spline[0]];
    {
      const STEP = 7;
      let carry = 0;
      for (let i = 1; i < spline.length; i++) {
        const [ax, az] = spline[i - 1];
        const [bx, bz] = spline[i];
        const segLen = Math.hypot(bx - ax, bz - az);
        let t = STEP - carry;
        while (t <= segLen) {
          dense.push([ax + ((bx - ax) * t) / segLen, az + ((bz - az) * t) / segLen]);
          t += STEP;
        }
        carry = segLen - (t - STEP);
      }
      dense.push(spline[spline.length - 1]);
    }
    // meander
    for (let i = 1; i < dense.length - 1; i++) {
      const [ax, az] = dense[i - 1];
      const [bx, bz] = dense[i + 1];
      const tx = bx - ax;
      const tz = bz - az;
      const l = Math.hypot(tx, tz) || 1;
      const m = n3.noise(i * 0.012 + rivers.length * 10, 0.5) * 38 + n3.noise(i * 0.05 + 3.3, rivers.length) * 9;
      dense[i] = [dense[i][0] + (-tz / l) * m, dense[i][1] + (tx / l) * m];
    }
    const n = dense.length;
    const pts = new Float32Array(n * 2);
    const widths = new Float32Array(n);
    const levels = new Float32Array(n);
    let level = 1e9;
    for (let i = 0; i < n; i++) {
      pts[i * 2] = dense[i][0];
      pts[i * 2 + 1] = dense[i][1];
      const t = i / (n - 1);
      widths[i] = 7 + 30 * t;
      const th = hAt(dense[i][0], dense[i][1]);
      level = Math.min(level, th - 3);
      level = Math.max(level, -1);
      levels[i] = level;
    }
    // ensure monotonic descent and smooth
    for (let i = 1; i < n; i++) levels[i] = Math.min(levels[i], levels[i - 1] - 0.02);
    for (let i = 0; i < n; i++) if (levels[i] < 0.6) levels[i] = 0.6 - i * 0.0001;
    rivers.push({ name: rd.name, pts, widths, levels });
  }
  // ---------------------------------------------------------------- nav coarse pass
  progress(0.42, 'Charting coasts');
  const nav = new Uint8Array(navW * navH);
  const navH0 = new Float32Array(navW * navH);
  const sampleNavHeight = (cx: number, cz: number) => {
    // average of the 2x2 hm samples within the cell + center
    const ix = cx * 2;
    const iz = cz * 2;
    let s = 0;
    for (let dz = 0; dz <= 2; dz++) for (let dx = 0; dx <= 2; dx++) s += height[Math.min(hmH - 1, iz + dz) * hmW + Math.min(hmW - 1, ix + dx)];
    return s / 9;
  };
  for (let cz = 0; cz < navH; cz++)
    for (let cx = 0; cx < navW; cx++) {
      const h = sampleNavHeight(cx, cz);
      navH0[cz * navW + cx] = h;
      nav[cz * navW + cx] = h < 0.3 ? (h < -22 ? NavT.Deep : NavT.Shallow) : NavT.Plains;
    }
  const coastDist = computeCoastDist(nav, navW, navH);

  // landmass labelling on nav grid
  const landmass = new Uint8Array(navW * navH);
  labelLandmasses(nav, navW, navH, landmass, massOf, hmW);

  // ---------------------------------------------------------------- settlement placement
  progress(0.48, 'Founding settlements');
  const provinces: ProvinceGeo[] = [];
  const radiusFor = (k: string, tier?: number) => (k === 'capital' ? (tier === 3 ? 125 : 105) : k === 'city' ? 95 : k === 'fortress' ? 70 : k === 'town' ? 70 : 48);
  ANCHORS.forEach((a, id) => {
    const ax = a.u * W;
    const az = a.v * H;
    const acx = Math.floor(ax / NAV_STEP);
    const acz = Math.floor(az / NAV_STEP);
    let best = -1;
    let bestScore = -1e9;
    const R = 14;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const cx = acx + dx;
        const cz = acz + dz;
        if (cx < 2 || cz < 2 || cx >= navW - 2 || cz >= navH - 2) continue;
        const c = cz * navW + cx;
        if (nav[c] < NavT.Plains) continue;
        const cd = coastDist[c];
        const d = Math.hypot(dx, dz);
        let score = -d;
        // flatness
        let hmin = 1e9;
        let hmax = -1e9;
        for (let oz = -2; oz <= 2; oz++)
          for (let ox = -2; ox <= 2; ox++) {
            const hh = navH0[(cz + oz) * navW + cx + ox];
            hmin = Math.min(hmin, hh);
            hmax = Math.max(hmax, hh);
          }
        score -= (hmax - hmin) * 0.05;
        if (a.port) {
          if (cd < 3 || cd > 5) score -= 40;
          else score += 4 - Math.abs(cd - 3.5);
        } else if (cd < 4) score -= 20;
        if (navH0[c] > 160 && a.kind !== 'fortress' && a.kind !== 'capital') score -= (navH0[c] - 160) * 0.05;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
    if (best < 0) best = acz * navW + acx;
    const x = ((best % navW) + 0.5) * NAV_STEP;
    const z = (Math.floor(best / navW) + 0.5) * NAV_STEP;
    provinces.push({
      id,
      name: a.name,
      region: a.region,
      landmass: landmass[best],
      anchor: a,
      x,
      z,
      cell: best,
      radius: radiusFor(a.kind, a.tier),
      port: a.port,
      portCell: -1,
      portX: x,
      portZ: z,
      coastAngle: 0,
      cells: 0,
      neighbors: [],
      cx: x,
      cz: z,
      terrain: 'plains',
      resources: a.resources.slice(),
      fertility: 0.5,
      seaZone: 0,
      elevation: 0,
    });
  });

  // flatten settlement sites
  for (const p of provinces) {
    const R = p.radius;
    const R2 = R * 1.9;
    let sum = 0;
    let cnt = 0;
    for (let dz = -R; dz <= R; dz += HM_STEP)
      for (let dx = -R; dx <= R; dx += HM_STEP) {
        if (dx * dx + dz * dz > R * R) continue;
        const hh = hAt(p.x + dx, p.z + dz);
        if (hh > 0) {
          sum += hh;
          cnt++;
        }
      }
    let target = cnt ? sum / cnt : 6;
    if (p.port) target = Math.min(target, 7 + (p.anchor.kind === 'fortress' || p.anchor.kind === 'capital' ? 5 : 0));
    target = Math.max(4.5, target);
    if (p.anchor.region === 'skarholm') target = Math.max(target, 14);
    p.elevation = target;
    const x0 = Math.max(0, Math.floor((p.x - R2) / HM_STEP));
    const x1 = Math.min(hmW - 1, Math.ceil((p.x + R2) / HM_STEP));
    const z0 = Math.max(0, Math.floor((p.z - R2) / HM_STEP));
    const z1 = Math.min(hmH - 1, Math.ceil((p.z + R2) / HM_STEP));
    for (let iz = z0; iz <= z1; iz++)
      for (let ix = x0; ix <= x1; ix++) {
        const d = Math.hypot(ix * HM_STEP - p.x, iz * HM_STEP - p.z);
        const k = smoothstep(R * 0.95, R2, d);
        const idx = iz * hmW + ix;
        if (height[idx] < -1 && d > R * 0.8) continue; // keep the sea
        const noise = n3.noise(ix * 0.2, iz * 0.2) * 0.6;
        height[idx] = target + noise + (height[idx] - target - noise) * k;
      }
  }

  // carve a channel, then raise low banks into levees so the water never floods sideways.
  // Pass 1: nearest river point per heightmap sample; pass 2: shape the terrain.
  const rD = new Float32Array(hmW * hmH).fill(1e9);
  const rH = new Float32Array(hmW * hmH);
  {
    const rL = new Float32Array(hmW * hmH);
    const rB = new Float32Array(hmW * hmH);
    for (const r of rivers) {
      const n = r.widths.length;
      for (let i = 0; i < n; i++) {
        const px = r.pts[i * 2];
        const pz = r.pts[i * 2 + 1];
        const w = r.widths[i];
        const half = w * 0.5 + 3;
        const bank = w * 1.1 + 36;
        const rad = half + bank;
        const x0 = Math.max(0, Math.floor((px - rad) / HM_STEP));
        const x1 = Math.min(hmW - 1, Math.ceil((px + rad) / HM_STEP));
        const z0 = Math.max(0, Math.floor((pz - rad) / HM_STEP));
        const z1 = Math.min(hmH - 1, Math.ceil((pz + rad) / HM_STEP));
        for (let iz = z0; iz <= z1; iz++)
          for (let ix = x0; ix <= x1; ix++) {
            const d = Math.hypot(ix * HM_STEP - px, iz * HM_STEP - pz);
            const idx = iz * hmW + ix;
            if (d < rad && d < rD[idx]) {
              rD[idx] = d;
              rL[idx] = r.levels[i];
              rH[idx] = half;
              rB[idx] = bank;
            }
          }
      }
    }
    for (let idx = 0; idx < hmW * hmH; idx++) {
      const d = rD[idx];
      if (d >= 1e8) continue;
      const lvl = rL[idx];
      const half = rH[idx];
      const w = (half - 3) * 2;
      const bed = lvl - 2.2 - w * 0.05;
      const inner = half + 10;
      if (d <= inner) {
        height[idx] = bed + (lvl + 1.2 - bed) * smoothstep(half * 0.55, inner, d);
      } else {
        const k = smoothstep(inner, inner + rB[idx], d);
        const bankTop = lvl + 1.2 + k * 3;
        const carved = bankTop + (height[idx] - bankTop) * k;
        if (height[idx] > carved) height[idx] = carved;
        if (height[idx] < lvl + 0.7 && lvl > 1.2) height[idx] = Math.max(height[idx], lvl + 0.7);
      }
    }
  }

  // ---------------------------------------------------------------- final nav & biomes
  progress(0.56, 'Surveying the land');
  const biome = new Uint8Array(hmW * hmH);
  const moisture = new Uint8Array(hmW * hmH);
  const grainSites = provinces.filter((p) => p.resources.includes('grain') || p.resources.includes('wool') || p.resources.includes('wine'));
  const forestSites: [number, number, number][] = [
    [0.285, 0.36, 0.07],
    [0.665, 0.33, 0.06],
    [0.56, 0.54, 0.05],
    [0.88, 0.38, 0.05],
    [0.33, 0.27, 0.06],
    [0.9, 0.24, 0.05],
    [0.42, 0.53, 0.035],
    [0.24, 0.62, 0.03],
  ];
  for (let iz = 0; iz < hmH; iz++)
    for (let ix = 0; ix < hmW; ix++) {
      const i = iz * hmW + ix;
      const h = height[i];
      const u = ix / hmW;
      const v = iz / hmH;
      let m = 0.5 + 0.5 * n2.fbm(u * 6 + 20, v * 6 + 20, 4);
      for (const [fu, fv, fr] of forestSites) {
        const d = Math.hypot((u - fu) * 1.5, v - fv) / fr;
        if (d < 1.4) m += 0.35 * (1 - d / 1.4);
      }
      moisture[i] = clamp(Math.round(m * 255), 0, 255);
      if (h < 0) {
        biome[i] = h < -22 ? Biome.Deep : Biome.Sea;
        continue;
      }
      const hx = height[iz * hmW + Math.min(hmW - 1, ix + 1)] - height[iz * hmW + Math.max(0, ix - 1)];
      const hz = height[Math.min(hmH - 1, iz + 1) * hmW + ix] - height[Math.max(0, iz - 1) * hmW + ix];
      const slope = Math.hypot(hx, hz) / (2 * HM_STEP);
      const mass = massOf[i];
      const lm = LANDMASSES.find((l) => l.id === mass);
      const climate = lm?.climate ?? 'temperate';
      const snowline = 175 + v * 330 + (climate === 'north' ? -40 : 0);
      let b: Biome;
      if (h > snowline + n1.noise(u * 40, v * 40) * 25) b = Biome.Snow;
      else if (slope > 0.75 || h > 230 + n1.noise(u * 30, v * 30) * 30) b = Biome.Rock;
      else if (h < 3.2 + n3.noise(u * 60, v * 60) * 1.2 && slope < 0.25) b = Biome.Beach;
      else if (climate === 'volcanic') b = h > 70 ? Biome.Ash : m > 0.62 ? Biome.Conifer : Biome.Ash;
      else if (h > 115 || slope > 0.42) b = v < 0.3 || climate === 'north' ? (m > 0.55 ? Biome.Conifer : Biome.Tundra) : Biome.Hills;
      else if (m > 0.66) b = v < 0.33 || climate === 'north' ? Biome.Conifer : Biome.Forest;
      else if ((v > 0.7 && mass === 1) || climate === 'south') b = Biome.Dry;
      else if (v < 0.24 || climate === 'north') b = Biome.Tundra;
      else b = Biome.Grass;
      // farmland rings around grain settlements
      if (b === Biome.Grass || b === Biome.Dry || b === Biome.Tundra) {
        for (const p of grainSites) {
          const d = Math.hypot(ix * HM_STEP - p.x, iz * HM_STEP - p.z);
          if (d > p.radius * 1.15 && d < p.radius * 3.4 + n1.noise(ix * 0.05, iz * 0.05) * 60 && slope < 0.2) {
            b = Biome.Farm;
            break;
          }
        }
      }
      biome[i] = b;
    }

  progress(0.62, 'Surveying the land');
  for (let cz = 0; cz < navH; cz++)
    for (let cx = 0; cx < navW; cx++) {
      const c = cz * navW + cx;
      const h = sampleNavHeight(cx, cz);
      navH0[c] = h;
      const hi = Math.min(hmH - 1, cz * 2 + 1) * hmW + Math.min(hmW - 1, cx * 2 + 1);
      const inRiver = rD[hi] < rH[hi] + 12;
      if (h < 0.3 && !(inRiver && h > -12)) {
        nav[c] = h < -22 ? NavT.Deep : NavT.Shallow;
        continue;
      }
      if (inRiver && h < 0.3) {
        nav[c] = NavT.Plains;
        continue;
      }
      const b = biome[Math.min(hmH - 1, cz * 2 + 1) * hmW + Math.min(hmW - 1, cx * 2 + 1)];
      // slope over the cell
      const hx = sampleNavHeight(Math.min(navW - 1, cx + 1), cz) - sampleNavHeight(Math.max(0, cx - 1), cz);
      const hz = sampleNavHeight(cx, Math.min(navH - 1, cz + 1)) - sampleNavHeight(cx, Math.max(0, cz - 1));
      const slope = Math.hypot(hx, hz) / (2 * NAV_STEP);
      if (slope > 1.25 || h > 330) nav[c] = NavT.Impassable;
      else if (b === Biome.Rock || b === Biome.Snow || slope > 0.7) nav[c] = NavT.Mountain;
      else if (b === Biome.Hills || slope > 0.35 || h > 110) nav[c] = NavT.Hills;
      else if (b === Biome.Forest || b === Biome.Conifer) nav[c] = NavT.Forest;
      else nav[c] = NavT.Plains;
    }
  // settlement cells always passable plains
  for (const p of provinces) {
    const cx0 = p.cell % navW;
    const cz0 = Math.floor(p.cell / navW);
    const r = Math.ceil(p.radius / NAV_STEP);
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const c = (cz0 + dz) * navW + cx0 + dx;
        if (nav[c] >= NavT.Hills && nav[c] <= NavT.Impassable && Math.hypot(dx, dz) <= r) nav[c] = NavT.Plains;
      }
  }
  const coastDist2 = computeCoastDist(nav, navW, navH);
  labelLandmasses(nav, navW, navH, landmass, massOf, hmW);
  for (const p of provinces) p.landmass = landmass[p.cell];

  // river cells
  const river = new Uint8Array(navW * navH);
  for (const r of rivers) {
    const n = r.widths.length;
    for (let i = 0; i < n; i++) {
      const px = r.pts[i * 2];
      const pz = r.pts[i * 2 + 1];
      const rad = r.widths[i] * 0.5 + 6;
      const x0 = Math.max(0, Math.floor((px - rad) / NAV_STEP));
      const x1 = Math.min(navW - 1, Math.floor((px + rad) / NAV_STEP));
      const z0 = Math.max(0, Math.floor((pz - rad) / NAV_STEP));
      const z1 = Math.min(navH - 1, Math.floor((pz + rad) / NAV_STEP));
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          const c = cz * navW + cx;
          if (nav[c] >= NavT.Plains) river[c] = 1;
        }
    }
  }

  // ---------------------------------------------------------------- ports
  for (const p of provinces) {
    if (!p.port) continue;
    // nearest shallow/deep water cell reachable from open sea with some depth
    let best = -1;
    let bd = 1e9;
    const cx0 = p.cell % navW;
    const cz0 = Math.floor(p.cell / navW);
    for (let dz = -12; dz <= 12; dz++)
      for (let dx = -12; dx <= 12; dx++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= navW || cz >= navH) continue;
        const c = cz * navW + cx;
        if (nav[c] > NavT.Shallow) continue;
        if (coastDist2[c] > -2) continue; // at least 2 cells from land for a berth
        const d = Math.hypot(dx, dz);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    if (best < 0) {
      p.port = false;
      continue;
    }
    p.portCell = best;
    p.portX = ((best % navW) + 0.5) * NAV_STEP;
    p.portZ = (Math.floor(best / navW) + 0.5) * NAV_STEP;
    p.coastAngle = Math.atan2(p.portZ - p.z, p.portX - p.x);
  }

  // ---------------------------------------------------------------- provinces (geodesic voronoi)
  progress(0.7, 'Drawing borders');
  const province = new Int16Array(navW * navH).fill(-1);
  {
    const dist = new Float32Array(navW * navH).fill(1e9);
    const heap = new MinHeap();
    for (const p of provinces) {
      dist[p.cell] = 0;
      province[p.cell] = p.id;
      heap.push(p.cell, 0);
    }
    const nb: number[] = [];
    const tmp: number[] = [];
    while (heap.size) {
      const c = heap.pop();
      const d0 = dist[c];
      const x = c % navW;
      const z = (c / navW) | 0;
      nb.length = 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= navW || nz >= navH) continue;
          nb.push(nz * navW + nx, dx && dz ? 1.414 : 1);
        }
      void tmp;
      for (let k = 0; k < nb.length; k += 2) {
        const n = nb[k];
        if (nav[n] < NavT.Plains) continue;
        const t = nav[n];
        const cost = nb[k + 1] * (t === NavT.Mountain ? 5 : t === NavT.Impassable ? 9 : t === NavT.Hills ? 1.8 : t === NavT.Forest ? 1.3 : 1) + (river[n] && !river[c] ? 6 : 0);
        const nd = d0 + cost;
        if (nd < dist[n]) {
          dist[n] = nd;
          province[n] = province[c];
          heap.push(n, nd);
        }
      }
    }
  }
  // province stats, neighbours
  const adj = provinces.map(() => new Set<number>());
  const sumX = new Float64Array(provinces.length);
  const sumZ = new Float64Array(provinces.length);
  const tcount = provinces.map(() => new Map<string, number>());
  for (let c = 0; c < navW * navH; c++) {
    const pid = province[c];
    if (pid < 0) continue;
    const p = provinces[pid];
    p.cells++;
    sumX[pid] += (c % navW) + 0.5;
    sumZ[pid] += Math.floor(c / navW) + 0.5;
    const x = c % navW;
    const z = (c / navW) | 0;
    if (x + 1 < navW) {
      const q = province[c + 1];
      if (q >= 0 && q !== pid) {
        adj[pid].add(q);
        adj[q].add(pid);
      }
    }
    if (z + 1 < navH) {
      const q = province[c + navW];
      if (q >= 0 && q !== pid) {
        adj[pid].add(q);
        adj[q].add(pid);
      }
    }
    const t = nav[c];
    const bm = biome[Math.min(hmH - 1, z * 2 + 1) * hmW + Math.min(hmW - 1, x * 2 + 1)];
    const key = bm === Biome.Farm ? 'farmland' : bm === Biome.Dry ? 'dry' : bm === Biome.Snow ? 'snow' : t === NavT.Mountain || t === NavT.Impassable ? 'mountain' : t === NavT.Hills ? 'hills' : t === NavT.Forest ? 'forest' : 'plains';
    tcount[pid].set(key, (tcount[pid].get(key) ?? 0) + 1);
  }
  for (const p of provinces) {
    p.neighbors = [...adj[p.id]].sort((a, b) => a - b);
    if (p.cells) {
      p.cx = (sumX[p.id] / p.cells) * NAV_STEP;
      p.cz = (sumZ[p.id] / p.cells) * NAV_STEP;
    }
    const tc = tcount[p.id];
    let best: TerrainKind = 'plains';
    let bestN = -1;
    for (const [k, n] of tc) {
      const w = k === 'farmland' ? n * 0.8 : k === 'mountain' ? n * 1.3 : n;
      if (w > bestN) {
        bestN = w;
        best = k as TerrainKind;
      }
    }
    if (p.port && best === 'plains') best = 'coast';
    p.terrain = best;
    const farm = tc.get('farmland') ?? 0;
    const plains = tc.get('plains') ?? 0;
    p.fertility = clamp((farm * 1.2 + plains * 0.7 + (tc.get('forest') ?? 0) * 0.3) / Math.max(1, p.cells), 0.15, 1);
  }

  // ---------------------------------------------------------------- sea zones
  const seaZone = new Uint8Array(navW * navH);
  for (let c = 0; c < navW * navH; c++) {
    if (nav[c] > NavT.Shallow) continue;
    const x = ((c % navW) + 0.5) / navW;
    const z = (Math.floor(c / navW) + 0.5) / navH;
    let best = 0;
    let bd = 1e9;
    SEA_ZONES.forEach((s, i) => {
      const d = Math.hypot((x - s.u) * 1.5, z - s.v);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    seaZone[c] = best;
  }
  for (const p of provinces) if (p.port) p.seaZone = seaZone[p.portCell];

  // ---------------------------------------------------------------- roads
  progress(0.78, 'Laying roads');
  const road = new Uint8Array(navW * navH);
  const roads: RoadGeo[] = [];
  const bridges: BridgeGeo[] = [];
  const pairs: [number, number][] = [];
  for (const p of provinces)
    for (const q of p.neighbors) {
      if (q <= p.id) continue;
      const pq = provinces[q];
      if (pq.landmass !== p.landmass) continue;
      // Gabriel graph test
      const mx = (p.x + pq.x) / 2;
      const mz = (p.z + pq.z) / 2;
      const r2 = ((p.x - pq.x) ** 2 + (p.z - pq.z) ** 2) / 4;
      let ok = true;
      for (const o of provinces) {
        if (o.id === p.id || o.id === q || o.landmass !== p.landmass) continue;
        if ((o.x - mx) ** 2 + (o.z - mz) ** 2 < r2 * 0.92) {
          ok = false;
          break;
        }
      }
      if (ok) pairs.push([p.id, q]);
    }
  pairs.sort((a, b) => Math.hypot(provinces[a[0]].x - provinces[a[1]].x, provinces[a[0]].z - provinces[a[1]].z) - Math.hypot(provinces[b[0]].x - provinces[b[1]].x, provinces[b[0]].z - provinces[b[1]].z));
  const roadCost = (c: number) => {
    const t = nav[c];
    if (t < NavT.Plains || t === NavT.Impassable) return -1;
    let cost = t === NavT.Mountain ? 7 : t === NavT.Hills ? 2.6 : t === NavT.Forest ? 1.6 : 1;
    if (road[c]) cost *= 0.45;
    else if (river[c]) cost += 14;
    if (coastDist2[c] <= 1) cost += 1.5;
    return cost;
  };
  for (const [a, b] of pairs) {
    const path = astar(navW, navH, provinces[a].cell, provinces[b].cell, roadCost);
    if (!path) continue;
    for (const c of path) if (!road[c]) road[c] = 1;
    // smoothed polyline
    const raw: [number, number][] = path.map((c) => [((c % navW) + 0.5) * NAV_STEP, (Math.floor(c / navW) + 0.5) * NAV_STEP]);
    let sm = raw;
    for (let it = 0; it < 3; it++) sm = chaikin(sm);
    const pts = new Float32Array(sm.length * 2);
    sm.forEach(([x, z], i) => {
      pts[i * 2] = x;
      pts[i * 2 + 1] = z;
    });
    roads.push({ a, b, pts, cells: path });
    // bridges: river crossing runs
    let i = 0;
    while (i < path.length) {
      if (river[path[i]]) {
        let j = i;
        while (j + 1 < path.length && river[path[j + 1]]) j++;
        const c0 = path[Math.max(0, i - 1)];
        const c1 = path[Math.min(path.length - 1, j + 1)];
        const x0 = ((c0 % navW) + 0.5) * NAV_STEP;
        const z0 = (Math.floor(c0 / navW) + 0.5) * NAV_STEP;
        const x1 = ((c1 % navW) + 0.5) * NAV_STEP;
        const z1 = (Math.floor(c1 / navW) + 0.5) * NAV_STEP;
        const bx = (x0 + x1) / 2;
        const bz = (z0 + z1) / 2;
        if (!bridges.some((br) => Math.hypot(br.x - bx, br.z - bz) < 40)) {
          bridges.push({ x: bx, z: bz, angle: Math.atan2(z1 - z0, x1 - x0), length: Math.hypot(x1 - x0, z1 - z0) + 10, y: 0 });
        }
        for (let k = i; k <= j; k++) road[path[k]] = 2;
        i = j + 1;
      } else i++;
    }
  }
  // bridge deck height from bank heights
  const hAtBil = (x: number, z: number) => {
    const fx = clamp(x / HM_STEP, 0, hmW - 1.001);
    const fz = clamp(z / HM_STEP, 0, hmH - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = height[iz * hmW + ix];
    const b2 = height[iz * hmW + ix + 1];
    const c = height[(iz + 1) * hmW + ix];
    const d = height[(iz + 1) * hmW + ix + 1];
    return a + (b2 - a) * tx + (c - a) * tz + (a - b2 - c + d) * tx * tz;
  };
  for (const br of bridges) {
    const hx = Math.cos(br.angle) * br.length * 0.5;
    const hz = Math.sin(br.angle) * br.length * 0.5;
    br.y = Math.max(hAtBil(br.x - hx, br.z - hz), hAtBil(br.x + hx, br.z + hz), 3) + 1.5;
  }

  progress(0.9, 'Finishing the map');
  return {
    W,
    H,
    hmW,
    hmH,
    hmStep: HM_STEP,
    height,
    biome,
    moisture,
    navW,
    navH,
    navStep: NAV_STEP,
    nav,
    road,
    river,
    province,
    landmass,
    seaZone,
    coastDist: coastDist2,
    provinces,
    rivers,
    roads,
    bridges,
  };
}

function chaikin(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
    out.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function computeCoastDist(nav: Uint8Array, w: number, h: number): Int16Array {
  // BFS distance: land cells positive distance to nearest water, water cells negative distance to nearest land
  const out = new Int16Array(w * h);
  const q = new Int32Array(w * h);
  for (const land of [true, false]) {
    let head = 0;
    let tail = 0;
    const seen = new Uint8Array(w * h);
    for (let c = 0; c < w * h; c++) {
      const isLand = nav[c] >= NavT.Plains;
      if (isLand !== land) {
        // seeds: the opposite type adjacent cells
        seen[c] = 1;
        q[tail++] = c;
      }
    }
    const dist = new Int16Array(w * h);
    while (head < tail) {
      const c = q[head++];
      const x = c % w;
      const z = (c / w) | 0;
      const d = dist[c];
      const tryN = (n: number) => {
        if (seen[n]) return;
        seen[n] = 1;
        dist[n] = d + 1;
        q[tail++] = n;
      };
      if (x > 0) tryN(c - 1);
      if (x < w - 1) tryN(c + 1);
      if (z > 0) tryN(c - w);
      if (z < h - 1) tryN(c + w);
    }
    for (let c = 0; c < w * h; c++) {
      const isLand = nav[c] >= NavT.Plains;
      if (isLand === land) out[c] = land ? dist[c] : -dist[c];
    }
  }
  return out;
}

function labelLandmasses(nav: Uint8Array, w: number, h: number, out: Uint8Array, massOf: Uint8Array, hmW: number) {
  out.fill(0);
  const q = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (nav[s] < NavT.Plains || out[s]) continue;
    // determine label from majority mass id of hm samples
    let head = 0;
    let tail = 0;
    q[tail++] = s;
    const members: number[] = [];
    out[s] = 255;
    const votes = new Map<number, number>();
    while (head < tail) {
      const c = q[head++];
      members.push(c);
      const x = c % w;
      const z = (c / w) | 0;
      const m = massOf[(z * 2) * hmW + x * 2];
      votes.set(m, (votes.get(m) ?? 0) + 1);
      const tryN = (n: number) => {
        if (nav[n] >= NavT.Plains && !out[n]) {
          out[n] = 255;
          q[tail++] = n;
        }
      };
      if (x > 0) tryN(c - 1);
      if (x < w - 1) tryN(c + 1);
      if (z > 0) tryN(c - w);
      if (z < h - 1) tryN(c + w);
    }
    let lab = 0;
    let bv = -1;
    for (const [m, v] of votes)
      if (v > bv) {
        bv = v;
        lab = m;
      }
    // tiny islets get label 100+ (unclaimed)
    if (members.length < 30) lab = 100;
    for (const c of members) out[c] = lab;
  }
}

/** Generic grid A* used for roads (8-connected). cost(c) < 0 means blocked. */
export function astar(w: number, h: number, start: number, goal: number, cost: (c: number) => number, maxNodes = 200000): number[] | null {
  const g = new Float32Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heap = new MinHeap();
  const gx = goal % w;
  const gz = (goal / w) | 0;
  const heur = (c: number) => {
    const dx = Math.abs((c % w) - gx);
    const dz = Math.abs(((c / w) | 0) - gz);
    return (dx + dz + (1.414 - 2) * Math.min(dx, dz)) * 0.45;
  };
  g[start] = 0;
  heap.push(start, heur(start));
  let n = 0;
  while (heap.size) {
    const c = heap.pop();
    if (c === goal) break;
    if (closed[c]) continue;
    closed[c] = 1;
    if (++n > maxNodes) return null;
    const x = c % w;
    const z = (c / w) | 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const nc = nz * w + nx;
        if (closed[nc]) continue;
        const cc = cost(nc);
        if (cc < 0 && nc !== goal) continue;
        if (dx && dz) {
          // no corner cutting
          if (cost(z * w + nx) < 0 || cost(nz * w + x) < 0) continue;
        }
        const ng = g[c] + Math.max(0, cc) * (dx && dz ? 1.414 : 1);
        if (ng < g[nc]) {
          g[nc] = ng;
          from[nc] = c;
          heap.push(nc, ng + heur(nc));
        }
      }
  }
  if (from[goal] < 0 && start !== goal) return null;
  const path: number[] = [];
  let c = goal;
  while (c !== start && c >= 0) {
    path.push(c);
    c = from[c];
  }
  path.push(start);
  return path.reverse();
}
