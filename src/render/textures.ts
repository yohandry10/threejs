import * as THREE from 'three';
import { Noise2D } from '../core/noise';

/**
 * Procedurally generated textures (no external image assets needed).
 * All textures are cached; call disposeTextures() when shutting down.
 */
const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement | OffscreenCanvas, CanvasRenderingContext2D] {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  return [c, ctx];
}

function tex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Tileable value noise RGBA texture: R,G,B,A = 4 independent octave sets. */
export function noiseTexture(): THREE.Texture {
  return tex('noise', () => {
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    const noises = [new Noise2D(11), new Noise2D(23), new Noise2D(37), new Noise2D(51)];
    // tileable by sampling a torus in 4D -> approximate with periodic blending
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        for (let c = 0; c < 4; c++) {
          const n = noises[c];
          const f = [4, 8, 16, 32][c];
          const u = x / N;
          const v = y / N;
          // periodic via weighted blend of shifted samples
          const s = (a: number, b: number) => n.fbm(a * f, b * f, 3 + (c < 2 ? 1 : 0));
          const v00 = s(u, v);
          const v10 = s(u - 1, v);
          const v01 = s(u, v - 1);
          const v11 = s(u - 1, v - 1);
          const val = v00 * (1 - u) * (1 - v) + v10 * u * (1 - v) + v01 * (1 - u) * v + v11 * u * v;
          data[(y * N + x) * 4 + c] = Math.max(0, Math.min(255, Math.round((val * 0.5 + 0.5) * 255)));
        }
      }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  });
}

/** Tileable water detail normal map. */
export function waterNormalTexture(): THREE.Texture {
  return tex('waterNormal', () => {
    const N = 256;
    const hgt = new Float32Array(N * N);
    const n = new Noise2D(99);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const v = y / N;
        let h = 0;
        // sum of periodic sin waves + periodic noise for a tileable ripple field
        for (let k = 0; k < 14; k++) {
          const a = (k * 2.39996) % (Math.PI * 2);
          const fx = Math.round(Math.cos(a) * (3 + k * 1.3));
          const fy = Math.round(Math.sin(a) * (3 + k * 1.3));
          h += Math.sin((u * fx + v * fy) * Math.PI * 2 + k * 1.7) / (1 + k * 0.35);
        }
        const nn = n.fbm(Math.cos(u * Math.PI * 2) * 2 + Math.sin(v * Math.PI * 2), Math.sin(u * Math.PI * 2) * 2 + Math.cos(v * Math.PI * 2) * 1.5, 3);
        hgt[y * N + x] = h * 0.12 + nn * 0.6;
      }
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const hL = hgt[y * N + ((x - 1 + N) % N)];
        const hR = hgt[y * N + ((x + 1) % N)];
        const hD = hgt[((y - 1 + N) % N) * N + x];
        const hU = hgt[((y + 1) % N) * N + x];
        let nx = (hL - hR) * 2.2;
        let ny = (hD - hU) * 2.2;
        let nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l;
        ny /= l;
        nz /= l;
        const i = (y * N + x) * 4;
        data[i] = Math.round((nx * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        data[i + 3] = 255;
      }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  });
}

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true, repeat = true): THREE.Texture {
  return tex(key, () => {
    const [c, ctx] = canvas(w, h);
    draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c as HTMLCanvasElement);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  });
}

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wooden hull planking. */
export function planksTexture(): THREE.Texture {
  return canvasTexture('planks', 256, 256, (ctx, w, h) => {
    const r = rnd(5);
    ctx.fillStyle = '#6b4a2e';
    ctx.fillRect(0, 0, w, h);
    const rows = 16;
    for (let i = 0; i < rows; i++) {
      const y = (i * h) / rows;
      let x = -r() * 80;
      while (x < w) {
        const len = 60 + r() * 90;
        const shade = 0.75 + r() * 0.35;
        ctx.fillStyle = `rgb(${Math.round(150 * shade)},${Math.round(108 * shade)},${Math.round(68 * shade)})`;
        ctx.fillRect(x, y + 1, len - 1, h / rows - 2);
        // grain
        ctx.strokeStyle = `rgba(40,25,12,${0.12 + r() * 0.12})`;
        for (let g = 0; g < 3; g++) {
          ctx.beginPath();
          const gy = y + 2 + r() * (h / rows - 4);
          ctx.moveTo(x, gy);
          ctx.bezierCurveTo(x + len * 0.3, gy + r() * 2 - 1, x + len * 0.6, gy + r() * 2 - 1, x + len, gy);
          ctx.stroke();
        }
        // treenails
        ctx.fillStyle = 'rgba(30,20,10,0.5)';
        ctx.fillRect(x + 3, y + h / rows / 2 - 1, 2, 2);
        x += len;
      }
      ctx.fillStyle = 'rgba(20,12,6,0.8)';
      ctx.fillRect(0, y, w, 1.2);
    }
  });
}

/** Deck boards (lighter). */
export function deckTexture(): THREE.Texture {
  return canvasTexture('deck', 256, 256, (ctx, w, h) => {
    const r = rnd(9);
    ctx.fillStyle = '#9a7a55';
    ctx.fillRect(0, 0, w, h);
    const cols = 12;
    for (let i = 0; i < cols; i++) {
      const x = (i * w) / cols;
      const shade = 0.82 + r() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(160 * shade)},${Math.round(128 * shade)},${Math.round(88 * shade)})`;
      ctx.fillRect(x + 1, 0, w / cols - 1.5, h);
      ctx.fillStyle = 'rgba(40,28,16,0.7)';
      ctx.fillRect(x, 0, 1.2, h);
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = 'rgba(40,28,16,0.5)';
        ctx.fillRect(x, r() * h, w / cols, 1);
      }
    }
  });
}

/** Stone masonry blocks. */
export function stoneTexture(): THREE.Texture {
  return canvasTexture('stone', 256, 256, (ctx, w, h) => {
    const r = rnd(17);
    ctx.fillStyle = '#cfc9bd';
    ctx.fillRect(0, 0, w, h);
    const rows = 10;
    for (let i = 0; i < rows; i++) {
      const y = (i * h) / rows;
      let x = i % 2 ? -18 : 0;
      while (x < w) {
        const len = 24 + r() * 26;
        const s = 0.8 + r() * 0.35;
        ctx.fillStyle = `rgb(${Math.min(255, Math.round(222 * s))},${Math.min(255, Math.round(216 * s))},${Math.min(255, Math.round(204 * s))})`;
        ctx.fillRect(x + 1.5, y + 1.5, len - 3, h / rows - 3);
        ctx.fillStyle = `rgba(255,255,255,${r() * 0.08})`;
        ctx.fillRect(x + 2, y + 2, len - 5, 3);
        ctx.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
        ctx.fillRect(x + 2, y + h / rows - 6, len - 5, 3);
        x += len;
      }
    }
    // weathering speckles
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '40,40,30' : '220,220,200'},${r() * 0.12})`;
      ctx.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
  });
}

/** Clay roof tiles. */
export function roofTexture(): THREE.Texture {
  return canvasTexture('roof', 256, 256, (ctx, w, h) => {
    const r = rnd(29);
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(0, 0, w, h);
    const rows = 14;
    for (let i = 0; i < rows; i++) {
      const y = (i * h) / rows;
      const cols = 16;
      for (let j = 0; j < cols + 1; j++) {
        const x = (j + (i % 2) * 0.5) * (w / cols);
        const s = 0.75 + r() * 0.4;
        ctx.fillStyle = `rgb(${Math.round(210 * s)},${Math.round(210 * s)},${Math.round(210 * s)})`;
        ctx.beginPath();
        ctx.ellipse(x, y + h / rows * 0.6, w / cols / 2 - 0.5, h / rows * 0.62, 0, 0, Math.PI);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.stroke();
      }
    }
  });
}

/** Plaster wall with timber framing (half-timbered). */
export function plasterTexture(): THREE.Texture {
  return canvasTexture('plaster', 256, 256, (ctx, w, h) => {
    const r = rnd(41);
    ctx.fillStyle = '#e8e0cc';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '120,100,70' : '255,255,245'},${r() * 0.07})`;
      ctx.fillRect(r() * w, r() * h, 2, 2);
    }
    // timbers (dark) as a tileable pattern: posts, beams and braces
    ctx.fillStyle = '#4a3322';
    const post = 9;
    for (const x of [0, w / 2]) ctx.fillRect(x, 0, post, h);
    for (const y of [0, h / 2]) ctx.fillRect(0, y, w, post);
    ctx.strokeStyle = '#4a3322';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(post, h / 2);
    ctx.lineTo(w / 2, post);
    ctx.moveTo(w / 2 + post, h);
    ctx.lineTo(w, h / 2 + post);
    ctx.stroke();
    // windows
    ctx.fillStyle = '#231a12';
    ctx.fillRect(w * 0.62, h * 0.12, 26, 36);
    ctx.fillRect(w * 0.12, h * 0.62, 26, 36);
    ctx.fillStyle = '#5a4630';
    ctx.fillRect(w * 0.62 + 12, h * 0.12, 3, 36);
    ctx.fillRect(w * 0.12 + 12, h * 0.62, 3, 36);
  });
}

/** Emissive mask for windows (matches plasterTexture window positions). */
export function windowMaskTexture(): THREE.Texture {
  return canvasTexture(
    'windowMask',
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffb45a';
      ctx.fillRect(w * 0.62 + 2, h * 0.12 + 2, 22, 32);
      ctx.fillRect(w * 0.12 + 2, h * 0.62 + 2, 22, 32);
    },
    true,
  );
}

/** Sailcloth base (off-white canvas with seams). */
export function canvasClothTexture(): THREE.Texture {
  return canvasTexture('sailcloth', 128, 128, (ctx, w, h) => {
    const r = rnd(61);
    ctx.fillStyle = '#e9e1cf';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = 'rgba(120,100,70,0.18)';
      ctx.fillRect((i * w) / 8, 0, 1.5, h);
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(90,70,40,${r() * 0.06})`;
      ctx.fillRect(r() * w, r() * h, 1, 1);
    }
  });
}

/** Dirt road texture: alpha fades at the edges (u across the road). */
export function roadTexture(): THREE.Texture {
  return canvasTexture('road', 64, 256, (ctx, w, h) => {
    const r = rnd(71);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(128,116,96,0)');
    g.addColorStop(0.18, 'rgba(132,120,98,0.8)');
    g.addColorStop(0.5, 'rgba(150,138,114,0.92)');
    g.addColorStop(0.82, 'rgba(132,120,98,0.8)');
    g.addColorStop(1, 'rgba(128,116,96,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const x = w * (0.2 + r() * 0.6);
      ctx.fillStyle = `rgba(${r() < 0.5 ? '70,55,38' : '180,160,125'},${r() * 0.25})`;
      ctx.fillRect(x, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    // wheel ruts
    ctx.fillStyle = 'rgba(70,52,34,0.35)';
    ctx.fillRect(w * 0.33, 0, 3, h);
    ctx.fillRect(w * 0.64, 0, 3, h);
  });
}

/** Radial soft glow sprite. */
export function glowTexture(): THREE.Texture {
  return canvasTexture(
    'glow',
    64,
    64,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    false,
    false,
  );
}

/** Soft puff for smoke/dust/spray particles. */
export function puffTexture(): THREE.Texture {
  return canvasTexture(
    'puff',
    64,
    64,
    (ctx, w, h) => {
      const r = rnd(83);
      for (let i = 0; i < 14; i++) {
        const x = w / 2 + (r() - 0.5) * w * 0.4;
        const y = h / 2 + (r() - 0.5) * h * 0.4;
        const rad = w * (0.15 + r() * 0.2);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    },
    false,
    false,
  );
}

/** Selection ring decal. */
export function ringTexture(): THREE.Texture {
  return canvasTexture(
    'ring',
    128,
    128,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 16, 0, Math.PI * 2);
      ctx.stroke();
      // tick marks
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(a) * (w / 2 - 2), h / 2 + Math.sin(a) * (h / 2 - 2));
        ctx.lineTo(w / 2 + Math.cos(a) * (w / 2 - 20), h / 2 + Math.sin(a) * (h / 2 - 20));
        ctx.stroke();
      }
    },
    false,
    false,
  );
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
