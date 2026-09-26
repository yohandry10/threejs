import * as THREE from 'three';
import { Noise2D } from '../../core/noise';

/**
 * Procedural architecture textures (neutral-toned so vertex colours can tint them per faction):
 * ashlar stone, timber-framed upper floors, ground-floor shopfronts, roof tiles, cobbles and
 * the matching night-time window masks.
 */

const cache = new Map<string, THREE.Texture>();
function once(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
}
function mk(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
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
function fin(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, amt: number, scale = 0.05) {
  const n = new Noise2D(seed);
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = 1 + (n.noise(x * scale, y * scale) * 0.6 + n.noise(x * scale * 4, y * scale * 4) * 0.4) * amt;
      const o = (y * w + x) * 4;
      img.data[o] *= k;
      img.data[o + 1] *= k;
      img.data[o + 2] *= k;
    }
  ctx.putImageData(img, 0, 0);
}

/** Ashlar masonry: 1 tile = 4 m x 4 m, ~10 courses. */
export function ashlarTexture(): THREE.Texture {
  return once('arch.ashlar', () => {
    const W = 512;
    const [c, ctx] = mk(W, W);
    const r = rnd(3);
    ctx.fillStyle = '#6f6a60';
    ctx.fillRect(0, 0, W, W);
    const rows = 10;
    const rh = W / rows;
    for (let i = 0; i < rows; i++) {
      let x = i % 2 ? -r() * 60 : -r() * 30;
      while (x < W) {
        const bw = rh * (1.3 + r() * 1.3);
        const t = 0.8 + r() * 0.3;
        const warm = r() * 14 - 7;
        ctx.fillStyle = `rgb(${Math.round(196 * t + warm)},${Math.round(188 * t)},${Math.round(172 * t - warm)})`;
        ctx.fillRect(x + 2, i * rh + 2, bw - 4, rh - 4);
        // chisel edge highlight and shadow
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(x + 2, i * rh + 2, bw - 4, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        ctx.fillRect(x + 2, i * rh + rh - 5, bw - 4, 3);
        x += bw;
      }
    }
    grain(ctx, W, W, 5, 0.16, 0.04);
    // weathering streaks and moss at the foot
    const g = ctx.createLinearGradient(0, 0, 0, W);
    g.addColorStop(0, 'rgba(40,36,30,0)');
    g.addColorStop(1, 'rgba(60,70,40,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    return fin(c);
  });
}

/** Rough rubble stone for walls, towers and humble houses. 1 tile = 3 m. */
export function rubbleTexture(): THREE.Texture {
  return once('arch.rubble', () => {
    const W = 512;
    const [c, ctx] = mk(W, W);
    const r = rnd(7);
    ctx.fillStyle = '#5e5850';
    ctx.fillRect(0, 0, W, W);
    for (let i = 0; i < 520; i++) {
      const x = r() * W;
      const y = r() * W;
      const rx = 14 + r() * 26;
      const ry = 9 + r() * 14;
      const t = 0.75 + r() * 0.35;
      ctx.fillStyle = `rgb(${Math.round(186 * t)},${Math.round(178 * t)},${Math.round(164 * t)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, r() * 0.4 - 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,36,30,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    grain(ctx, W, W, 9, 0.14, 0.06);
    return fin(c);
  });
}

function timberPattern(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number, emissive: boolean) {
  const bays = 4;
  const bw = W / bays;
  const beam = '#3b2a1c';
  if (!emissive) {
    ctx.fillStyle = '#e4dccb';
    ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H, 13, 0.08, 0.03);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }
  for (let b = 0; b < bays; b++) {
    const x0 = b * bw;
    const variant = b % 4;
    // window in bays 0 and 2, braces in 1 and 3
    if (variant === 0 || variant === 2) {
      const wx = x0 + bw * 0.28;
      const wy = H * 0.24;
      const ww = bw * 0.44;
      const wh = H * 0.42;
      if (emissive) {
        const lit = r() < 0.6;
        ctx.fillStyle = lit ? '#ffb45a' : '#000';
        ctx.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
      } else {
        ctx.fillStyle = '#1b140e';
        ctx.fillRect(wx, wy, ww, wh);
        // leaded panes
        ctx.strokeStyle = 'rgba(120,110,90,0.5)';
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(wx + (ww * k) / 4, wy);
          ctx.lineTo(wx + (ww * k) / 4, wy + wh);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(wx, wy + wh / 2);
        ctx.lineTo(wx + ww, wy + wh / 2);
        ctx.stroke();
        // frame, sill and shutters
        ctx.strokeStyle = beam;
        ctx.lineWidth = 5;
        ctx.strokeRect(wx, wy, ww, wh);
        ctx.fillStyle = r() < 0.5 ? '#5a3b22' : '#35523a';
        ctx.fillRect(wx - bw * 0.14, wy, bw * 0.12, wh);
        ctx.fillRect(wx + ww + bw * 0.02, wy, bw * 0.12, wh);
        ctx.fillStyle = beam;
        ctx.fillRect(wx - 6, wy + wh, ww + 12, 6);
      }
    } else if (!emissive) {
      ctx.strokeStyle = beam;
      ctx.lineWidth = 9;
      ctx.beginPath();
      if (r() < 0.5) {
        ctx.moveTo(x0 + 6, H - 10);
        ctx.lineTo(x0 + bw - 6, 10);
      } else {
        ctx.moveTo(x0 + 6, 10);
        ctx.lineTo(x0 + bw - 6, H - 10);
      }
      ctx.stroke();
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x0 + bw / 2, 10);
      ctx.lineTo(x0 + bw / 2, H - 10);
      ctx.stroke();
    }
    if (!emissive) {
      // posts
      ctx.fillStyle = beam;
      ctx.fillRect(x0, 0, 10, H);
    }
  }
  if (!emissive) {
    // sill beam and top plate
    ctx.fillStyle = beam;
    ctx.fillRect(0, 0, W, 12);
    ctx.fillRect(0, H - 14, W, 14);
    ctx.fillRect(0, H * 0.72, W, 7);
  }
}

/** Timber-framed floor: 4 bays (8.8 m) x one storey (2.8 m). */
export function timberTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  const map = once('arch.timber', () => {
    const [c, ctx] = mk(512, 160);
    timberPattern(ctx, 512, 160, rnd(21), false);
    return fin(c);
  });
  const emissive = once('arch.timber.e', () => {
    const [c, ctx] = mk(512, 160);
    timberPattern(ctx, 512, 160, rnd(21), true);
    return fin(c);
  });
  return { map, emissive };
}

function shopPattern(ctx: CanvasRenderingContext2D, W: number, H: number, emissive: boolean) {
  const r = rnd(33);
  const bays = 4;
  const bw = W / bays;
  if (!emissive) {
    ctx.fillStyle = '#d6cdb9';
    ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H, 17, 0.1, 0.04);
    // stone plinth
    ctx.fillStyle = '#9d948a';
    ctx.fillRect(0, H - 22, W, 22);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }
  for (let b = 0; b < bays; b++) {
    const x0 = b * bw;
    if (b === 1) {
      // door with a round arch
      const dx = x0 + bw * 0.25;
      const dw = bw * 0.5;
      const dy = H * 0.3;
      if (!emissive) {
        ctx.fillStyle = '#4a2f1b';
        ctx.beginPath();
        ctx.moveTo(dx, H);
        ctx.lineTo(dx, dy + dw / 2);
        ctx.arc(dx + dw / 2, dy + dw / 2, dw / 2, Math.PI, 0);
        ctx.lineTo(dx + dw, H);
        ctx.fill();
        ctx.strokeStyle = '#8d8274';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(dx + (dw * k) / 4, dy + dw / 2);
          ctx.lineTo(dx + (dw * k) / 4, H);
          ctx.stroke();
        }
      }
    } else {
      const wx = x0 + bw * 0.22;
      const wy = H * 0.28;
      const ww = bw * 0.56;
      const wh = H * 0.38;
      if (emissive) {
        ctx.fillStyle = r() < 0.55 ? '#ffae55' : '#000';
        ctx.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
      } else {
        ctx.fillStyle = '#1b140e';
        ctx.fillRect(wx, wy, ww, wh);
        ctx.strokeStyle = '#7c7064';
        ctx.lineWidth = 6;
        ctx.strokeRect(wx, wy, ww, wh);
        // shop counter shutter folded down
        ctx.fillStyle = '#6b4a2c';
        ctx.fillRect(wx - 4, wy + wh, ww + 8, 10);
      }
    }
  }
}

/** Ground floor with doors and windows: 4 bays (8.8 m) x 3.2 m. */
export function shopTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  const map = once('arch.shop', () => {
    const [c, ctx] = mk(512, 186);
    shopPattern(ctx, 512, 186, false);
    return fin(c);
  });
  const emissive = once('arch.shop.e', () => {
    const [c, ctx] = mk(512, 186);
    shopPattern(ctx, 512, 186, true);
    return fin(c);
  });
  return { map, emissive };
}

/** Clay / slate roof tiles in overlapping courses: 1 tile = 3 m. */
export function roofTilesTexture(): THREE.Texture {
  return once('arch.tiles', () => {
    const W = 512;
    const [c, ctx] = mk(W, W);
    const r = rnd(41);
    ctx.fillStyle = '#6a5d55';
    ctx.fillRect(0, 0, W, W);
    const rows = 22;
    const rh = W / rows;
    for (let i = 0; i < rows; i++) {
      const tw = rh * 1.25;
      let x = i % 2 ? -tw / 2 : 0;
      while (x < W) {
        const t = 0.78 + r() * 0.34;
        ctx.fillStyle = `rgb(${Math.round(222 * t)},${Math.round(214 * t)},${Math.round(206 * t)})`;
        ctx.beginPath();
        ctx.moveTo(x + 1, i * rh);
        ctx.lineTo(x + tw - 1, i * rh);
        ctx.lineTo(x + tw - 1, i * rh + rh * 0.78);
        ctx.quadraticCurveTo(x + tw / 2, i * rh + rh * 1.08, x + 1, i * rh + rh * 0.78);
        ctx.closePath();
        ctx.fill();
        // shadow line under each course
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x, i * rh + rh * 0.86, tw, rh * 0.14);
        x += tw;
      }
    }
    grain(ctx, W, W, 43, 0.14, 0.05);
    // lichen and soot
    const n = new Noise2D(45);
    const img = ctx.getImageData(0, 0, W, W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const v = n.noise(x * 0.012, y * 0.012);
        const o = (y * W + x) * 4;
        if (v > 0.45) {
          const k = (v - 0.45) * 0.9;
          img.data[o] = img.data[o] * (1 - k) + 140 * k;
          img.data[o + 1] = img.data[o + 1] * (1 - k) + 150 * k;
          img.data[o + 2] = img.data[o + 2] * (1 - k) + 100 * k;
        }
      }
    ctx.putImageData(img, 0, 0);
    return fin(c);
  });
}

/** Cobbled paving for streets and squares: 1 tile = 4 m. */
export function cobbleTexture(): THREE.Texture {
  return once('arch.cobble', () => {
    const W = 512;
    const [c, ctx] = mk(W, W);
    const r = rnd(51);
    ctx.fillStyle = '#4b4540';
    ctx.fillRect(0, 0, W, W);
    const rows = 26;
    const rh = W / rows;
    for (let i = 0; i < rows; i++) {
      let x = (i % 2) * rh * 0.6 - r() * 10;
      while (x < W) {
        const w = rh * (0.9 + r() * 0.6);
        const t = 0.72 + r() * 0.4;
        ctx.fillStyle = `rgb(${Math.round(170 * t)},${Math.round(162 * t)},${Math.round(150 * t)})`;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, i * rh + rh / 2, w / 2 - 1.5, rh / 2 - 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.ellipse(x + w / 2 - 2, i * rh + rh / 2 - 2, w / 2 - 5, rh / 2 - 5, 0, 0, Math.PI * 2);
        ctx.fill();
        x += w;
      }
    }
    grain(ctx, W, W, 53, 0.12, 0.03);
    return fin(c);
  });
}

/** Plain lime plaster with stains (for walls without framing). 1 tile = 4 m. */
export function plasterTexture2(): THREE.Texture {
  return once('arch.plaster', () => {
    const W = 256;
    const [c, ctx] = mk(W, W);
    ctx.fillStyle = '#e2dac8';
    ctx.fillRect(0, 0, W, W);
    grain(ctx, W, W, 61, 0.12, 0.05);
    const g = ctx.createLinearGradient(0, 0, 0, W);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(70,60,40,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    return fin(c);
  });
}

/** Thatch: combed straw running down the slope in courses. 1 tile = 3 m. */
export function thatchTexture(): THREE.Texture {
  return once('arch.thatch', () => {
    const W = 512;
    const [c, ctx] = mk(W, W);
    const r = rnd(71);
    ctx.fillStyle = '#b8a47a';
    ctx.fillRect(0, 0, W, W);
    // straw strands (vertical = down the slope)
    for (let i = 0; i < 5200; i++) {
      const x = r() * W;
      const y = r() * W;
      const len = 18 + r() * 60;
      const t = 0.62 + r() * 0.55;
      ctx.strokeStyle = `rgba(${Math.round(226 * t)},${Math.round(204 * t)},${Math.round(158 * t)},0.55)`;
      ctx.lineWidth = 1 + r() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 4, y + len);
      ctx.stroke();
      if (y + len > W) {
        ctx.beginPath();
        ctx.moveTo(x, y - W);
        ctx.lineTo(x + (r() - 0.5) * 4, y + len - W);
        ctx.stroke();
      }
    }
    // courses: the butt ends of each layer cast a soft shadow line
    const rows = 7;
    for (let k = 0; k < rows; k++) {
      const y = (k / rows) * W;
      const g = ctx.createLinearGradient(0, y, 0, y + 22);
      g.addColorStop(0, 'rgba(40,30,15,0.34)');
      g.addColorStop(1, 'rgba(40,30,15,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, W, 22);
    }
    grain(ctx, W, W, 73, 0.18, 0.02);
    // moss and weathering
    const n = new Noise2D(75);
    const img = ctx.getImageData(0, 0, W, W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const v = n.noise(x * 0.01, y * 0.01);
        const o = (y * W + x) * 4;
        if (v > 0.35) {
          const k = Math.min(0.55, (v - 0.35) * 1.1);
          img.data[o] = img.data[o] * (1 - k) + 96 * k;
          img.data[o + 1] = img.data[o + 1] * (1 - k) + 100 * k;
          img.data[o + 2] = img.data[o + 2] * (1 - k) + 70 * k;
        }
      }
    ctx.putImageData(img, 0, 0);
    return fin(c);
  });
}
