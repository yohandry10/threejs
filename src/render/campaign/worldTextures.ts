import * as THREE from 'three';
import { Biome, type WorldGeo } from '../../sim/world/geo';

export interface WorldTextures {
  height: THREE.DataTexture;
  matA: THREE.DataTexture; // grass, dry, rock, sand
  matB: THREE.DataTexture; // snow, farm, forest, tundra
  matC: THREE.DataTexture; // settlement ground, mud, ash, -
  provId: THREE.DataTexture; // province id + 1 (nearest)
  provColor: THREE.DataTexture; // per-province mode colour (256 x 1)
  provColorPrev: THREE.DataTexture;
  provOwner: THREE.DataTexture; // per-province owner colour + owner index (alpha)
  fog: THREE.DataTexture; // R explored, G visible (nav res)
  range: THREE.DataTexture; // movement range overlay (nav res)
}

function dataTex(data: ArrayBufferView, w: number, h: number, format: THREE.PixelFormat, type: THREE.TextureDataType, filter: THREE.MagnificationTextureFilter, mips = false): THREE.DataTexture {
  const t = new THREE.DataTexture(data as never, w, h, format, type);
  t.magFilter = filter;
  t.minFilter = filter === THREE.NearestFilter ? THREE.NearestFilter : mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export function buildWorldTextures(g: WorldGeo): WorldTextures {
  const W = g.hmW;
  const H = g.hmH;
  // height (half float)
  const hdata = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) hdata[i] = THREE.DataUtils.toHalfFloat(g.height[i]);
  const height = dataTex(hdata, W, H, THREE.RedFormat, THREE.HalfFloatType, THREE.LinearFilter);

  // splat weights
  const A = new Float32Array(W * H * 4);
  const B = new Float32Array(W * H * 4);
  const C = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const b = g.biome[i];
    const a4 = i * 4;
    switch (b) {
      case Biome.Deep:
      case Biome.Sea:
      case Biome.Beach:
        A[a4 + 3] = 1;
        break;
      case Biome.Grass:
        A[a4] = 1;
        break;
      case Biome.Farm:
        B[a4 + 1] = 1;
        A[a4] = 0.15;
        break;
      case Biome.Forest:
        B[a4 + 2] = 1;
        A[a4] = 0.25;
        break;
      case Biome.Conifer:
        B[a4 + 2] = 1;
        B[a4 + 3] = 0.25;
        break;
      case Biome.Hills:
        A[a4] = 0.55;
        A[a4 + 1] = 0.2;
        A[a4 + 2] = 0.25;
        break;
      case Biome.Rock:
        A[a4 + 2] = 1;
        break;
      case Biome.Snow:
        B[a4] = 1;
        A[a4 + 2] = 0.25;
        break;
      case Biome.Dry:
        A[a4 + 1] = 1;
        A[a4] = 0.1;
        break;
      case Biome.Tundra:
        B[a4 + 3] = 1;
        break;
      case Biome.Ash:
        C[a4 + 2] = 1;
        A[a4 + 2] = 0.3;
        break;
      case Biome.Marsh:
        A[a4] = 0.6;
        B[a4 + 2] = 0.4;
        break;
    }
  }
  // settlement grounds & river mud
  for (const p of g.provinces) {
    const R = p.radius * 1.05;
    const x0 = Math.max(0, Math.floor((p.x - R) / g.hmStep));
    const x1 = Math.min(W - 1, Math.ceil((p.x + R) / g.hmStep));
    const z0 = Math.max(0, Math.floor((p.z - R) / g.hmStep));
    const z1 = Math.min(H - 1, Math.ceil((p.z + R) / g.hmStep));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x * g.hmStep - p.x, z * g.hmStep - p.z) / R;
        if (d < 1) C[(z * W + x) * 4] = Math.max(C[(z * W + x) * 4], Math.min(1, (1 - d) * 3));
      }
  }
  for (const r of g.rivers) {
    for (let i = 0; i < r.widths.length; i++) {
      const px = r.pts[i * 2];
      const pz = r.pts[i * 2 + 1];
      const rad = r.widths[i] * 0.5 + 16;
      const x0 = Math.max(0, Math.floor((px - rad) / g.hmStep));
      const x1 = Math.min(W - 1, Math.ceil((px + rad) / g.hmStep));
      const z0 = Math.max(0, Math.floor((pz - rad) / g.hmStep));
      const z1 = Math.min(H - 1, Math.ceil((pz + rad) / g.hmStep));
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x * g.hmStep - px, z * g.hmStep - pz) / rad;
          if (d < 1) C[(z * W + x) * 4 + 1] = Math.max(C[(z * W + x) * 4 + 1], 1 - d);
        }
    }
  }
  // blur + pack
  const blur = (src: Float32Array) => {
    const out = new Float32Array(src.length);
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        for (let c = 0; c < 4; c++) {
          let s = 0;
          let n = 0;
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = Math.min(W - 1, Math.max(0, x + dx));
              const zz = Math.min(H - 1, Math.max(0, z + dz));
              const w = dx === 0 && dz === 0 ? 2 : 1;
              s += src[(zz * W + xx) * 4 + c] * w;
              n += w;
            }
          out[(z * W + x) * 4 + c] = s / n;
        }
      }
    return out;
  };
  const pack = (src: Float32Array) => {
    const u = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) u[i] = Math.max(0, Math.min(255, Math.round(src[i] * 255)));
    return u;
  };
  const matA = dataTex(pack(blur(A)), W, H, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter, true);
  const matB = dataTex(pack(blur(B)), W, H, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter, true);
  const matC = dataTex(pack(blur(C)), W, H, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter, true);

  // province ids at 4x nav resolution with bilinear-majority contours (smooth borders)
  const PW = g.navW * 4;
  const PH = g.navH * 4;
  const pid = new Uint8Array(PW * PH);
  const nv = (x: number, z: number) => {
    const cx = Math.max(0, Math.min(g.navW - 1, x));
    const cz = Math.max(0, Math.min(g.navH - 1, z));
    return g.province[cz * g.navW + cx];
  };
  for (let z = 0; z < PH; z++)
    for (let x = 0; x < PW; x++) {
      const fx = (x + 0.5) / 4 - 0.5;
      const fz = (z + 0.5) / 4 - 0.5;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const ids = [nv(ix, iz), nv(ix + 1, iz), nv(ix, iz + 1), nv(ix + 1, iz + 1)];
      const ws = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
      let best = -1;
      let bw = -1;
      for (let k = 0; k < 4; k++) {
        let w = 0;
        for (let j = 0; j < 4; j++) if (ids[j] === ids[k]) w += ws[j];
        if (w > bw) {
          bw = w;
          best = ids[k];
        }
      }
      pid[z * PW + x] = best >= 0 ? best + 1 : 0;
    }
  const provId = dataTex(pid, PW, PH, THREE.RedFormat, THREE.UnsignedByteType, THREE.NearestFilter);
  const provColor = dataTex(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.NearestFilter);
  const provColorPrev = dataTex(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.NearestFilter);
  const provOwner = dataTex(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.NearestFilter);
  const fogData = new Uint8Array(g.navW * g.navH * 4);
  // B channel: static sea mask (ocean is only drawn over sea cells, never in river channels)
  for (let c = 0; c < g.navW * g.navH; c++) fogData[c * 4 + 2] = g.nav[c] <= 1 || g.coastDist[c] <= 1 ? 255 : 0;
  const fog = dataTex(fogData, g.navW, g.navH, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter);
  const range = dataTex(new Uint8Array(g.navW * g.navH), g.navW, g.navH, THREE.RedFormat, THREE.UnsignedByteType, THREE.LinearFilter);
  return { height, matA, matB, matC, provId, provColor, provColorPrev, provOwner, fog, range };
}

export function disposeWorldTextures(t: WorldTextures) {
  for (const v of Object.values(t)) (v as THREE.Texture).dispose();
}
