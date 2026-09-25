import * as THREE from 'three';
import { Noise2D } from '../../core/noise';
import { factionDef } from '../../data/factions';
import { drawHeraldry } from '../../data/heraldry';

/**
 * High-resolution procedural textures for ships: planked hulls with grain, seams and treenails,
 * deck boards, painted heraldic bands, sailcloth with seams and emblems, and leaded stern windows.
 */

const cache = new Map<string, THREE.Texture>();
function once(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
}
function mkCanvas(w: number, h: number) {
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
function finish(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Planked wood: rows of planks running along u, with per-plank tone, wood grain, butt joints,
 * treenails and caulked seams. Returns colour + a matching bump (height) texture.
 */
function planks(key: string, W: number, H: number, rows: number, base: [number, number, number], seed: number, vertical: boolean) {
  return once(key, () => {
    const [c, ctx] = mkCanvas(W, H);
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const n = new Noise2D(seed);
    const r = rnd(seed);
    const rowH = H / rows;
    // plank layout per row: random butt joint positions
    const joints: number[][] = [];
    const tones: number[][] = [];
    for (let i = 0; i < rows; i++) {
      const js: number[] = [];
      const ts: number[] = [];
      let x = -r() * W * 0.6;
      while (x < W) {
        js.push(x);
        ts.push(0.88 + r() * 0.2);
        x += W * (0.55 + r() * 0.7);
      }
      joints.push(js);
      tones.push(ts);
    }
    for (let py = 0; py < H; py++) {
      const row = Math.floor(py / rowH);
      const fy = (py - row * rowH) / rowH;
      const js = joints[row];
      for (let px = 0; px < W; px++) {
        let k = 0;
        while (k + 1 < js.length && px >= js[k + 1]) k++;
        // wrap: plank before the first joint continues the last one
        const tone = px < js[0] ? tones[row][tones[row].length - 1] : tones[row][k];
        const jx = px < js[0] ? js[js.length - 1] - W : js[k];
        // grain: stretched noise along the plank
        const g1 = n.noise(px * 0.012 + row * 13.1 + k * 7.7, py * 0.22);
        const g2 = n.noise(px * 0.05 + row * 3.3, py * 0.9 + k);
        const knot = Math.max(0, n.noise(px * 0.03 + row * 91 + k * 3, py * 0.08) - 0.62) * 3;
        let v = tone * (0.86 + g1 * 0.12 + g2 * 0.05 - knot * 0.35);
        // caulked seam between rows
        const seam = Math.min(fy, 1 - fy) * rowH;
        if (seam < 1.0) v *= 0.52 + seam * 0.3;
        else if (seam < 2.2) v *= 0.9 + (seam - 1.0) * 0.08;
        // plank edge bevel highlight
        if (fy > 0.08 && fy < 0.2) v *= 1.05;
        // butt joints
        const dx = px - jx;
        if (dx >= 0 && dx < 1.2) v *= 0.6;
        // treenails near the joints and mid-plank
        const tx = ((px - jx) % (W * 0.18)) - 6;
        if (Math.abs(tx) < 1.6 && Math.abs(fy - 0.5) < 0.09) v *= 0.55;
        // grime running down
        v *= 0.92 + n.noise(px * 0.02, py * 0.004) * 0.08;
        const o = (py * W + px) * 4;
        d[o] = Math.min(255, base[0] * v);
        d[o + 1] = Math.min(255, base[1] * v);
        d[o + 2] = Math.min(255, base[2] * v);
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (vertical) {
      const [c2, ctx2] = mkCanvas(H, W);
      ctx2.translate(H / 2, W / 2);
      ctx2.rotate(Math.PI / 2);
      ctx2.drawImage(c, -W / 2, -H / 2);
      return finish(c2);
    }
    return finish(c);
  });
}

/** Hull planking (u along the ship, v up the side). */
export const hullPlankTexture = () => planks('ship.hull', 1024, 512, 14, [150, 106, 68], 11, false);
/** Darker oiled wood for wales, rails, masts and castles' frames. */
export const darkWoodTexture = () => planks('ship.darkwood', 512, 256, 6, [92, 62, 40], 23, false);
/** Deck boards (u across, v along the ship). */
export const deckPlankTexture = () => planks('ship.deck', 1024, 512, 16, [178, 142, 100], 37, false);
/** Grey-brown weathered wood for boats and fittings. */
export const fittingWoodTexture = () => planks('ship.fitting', 256, 256, 8, [140, 112, 82], 51, false);

/** Painted band with the faction's colours: panels framed in gold with lozenges and roundels. */
export function bandTexture(faction: string): THREE.Texture {
  return once(`ship.band.${faction}`, () => {
    const def = factionDef(faction);
    const W = 1024;
    const H = 128;
    const [c, ctx] = mkCanvas(W, H);
    const r = rnd(faction.length * 31);
    ctx.fillStyle = def.color;
    ctx.fillRect(0, 0, W, H);
    // subtle painted texture
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`;
      ctx.fillRect(r() * W, r() * H, 2 + r() * 6, 1 + r() * 2);
    }
    const panels = 4;
    const pw = W / panels;
    for (let i = 0; i < panels; i++) {
      const x = i * pw;
      // gilded frame
      ctx.strokeStyle = '#d9b056';
      ctx.lineWidth = 5;
      ctx.strokeRect(x + 8, 14, pw - 16, H - 28);
      ctx.strokeStyle = '#7a5a20';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 13, 19, pw - 26, H - 38);
      // lozenge in the second colour with a roundel
      ctx.fillStyle = def.color2;
      ctx.beginPath();
      const cx = x + pw / 2;
      const cy = H / 2;
      ctx.moveTo(cx, cy - 36);
      ctx.lineTo(cx + 70, cy);
      ctx.lineTo(cx, cy + 36);
      ctx.lineTo(cx - 70, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e7c46a';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(cx, cy, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e7c46a';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // side scrolls
      for (const sx of [x + 44, x + pw - 44]) {
        ctx.strokeStyle = '#e1bb5e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, cy, 12, 0.3, Math.PI * 1.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx, cy, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // gold edge bands
    const gg = ctx.createLinearGradient(0, 0, 0, 10);
    gg.addColorStop(0, '#f2d27c');
    gg.addColorStop(1, '#8a6424');
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, W, 8);
    ctx.fillRect(0, H - 8, W, 8);
    // wear
    ctx.drawImage(wearOverlay(), 0, 0);
    const t = finish(c);
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Leaded stern windows: colour map and emissive (lit) mask. */
export function windowTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  const map = once('ship.windows', () => {
    const [c, ctx] = mkCanvas(256, 256);
    ctx.fillStyle = '#2a1c10';
    ctx.fillRect(0, 0, 256, 256);
    // arched window with leaded diamond panes
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(28, 250);
    ctx.lineTo(28, 90);
    ctx.arc(128, 90, 100, Math.PI, 0);
    ctx.lineTo(228, 250);
    ctx.closePath();
    ctx.clip();
    const g = ctx.createRadialGradient(128, 150, 10, 128, 150, 170);
    g.addColorStop(0, '#ffd9a0');
    g.addColorStop(1, '#b8743a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(40,26,14,0.9)';
    ctx.lineWidth = 3;
    for (let i = -10; i < 20; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 26, 0);
      ctx.lineTo(i * 26 + 256, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i * 26 + 256, 0);
      ctx.lineTo(i * 26, 256);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#d7ae55';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(28, 250);
    ctx.lineTo(28, 90);
    ctx.arc(128, 90, 100, Math.PI, 0);
    ctx.lineTo(228, 250);
    ctx.stroke();
    ctx.fillStyle = '#5a3d20';
    ctx.fillRect(122, 0, 12, 256);
    return finish(c, true, false);
  });
  const emissive = once('ship.windows.e', () => {
    const [c, ctx] = mkCanvas(256, 256);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(34, 246);
    ctx.lineTo(34, 92);
    ctx.arc(128, 92, 94, Math.PI, 0);
    ctx.lineTo(222, 246);
    ctx.closePath();
    ctx.clip();
    const g = ctx.createRadialGradient(128, 160, 10, 128, 160, 160);
    g.addColorStop(0, '#ffcf80');
    g.addColorStop(1, '#a4541c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    for (let i = -10; i < 20; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 26, 0);
      ctx.lineTo(i * 26 + 256, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i * 26 + 256, 0);
      ctx.lineTo(i * 26, 256);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#000';
    ctx.fillRect(122, 0, 12, 256);
    return finish(c, true, false);
  });
  return { map, emissive };
}

export type SailKind = 'course' | 'top' | 'lateen' | 'sprit';

const clothCache = new Map<string, HTMLCanvasElement>();
function clothBase(kind: SailKind, pirate: boolean): HTMLCanvasElement {
  const key = kind + (pirate ? 'P' : '');
  let cv = clothCache.get(key);
  if (cv) return cv;
  const W = 512;
  const H = 512;
  const [c, ctx] = mkCanvas(W, H);
  const n = new Noise2D(7 + kind.length);
  const img = ctx.createImageData(W, H);
  const base = pirate ? [74, 68, 62] : [224, 206, 172];
  const panels = kind === 'lateen' ? 12 : 10;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const p = u * panels;
      const fp = p - Math.floor(p);
      let k = 0.93 + n.noise(x * 0.03, y * 0.03) * 0.04 + n.noise(x * 0.3, y * 0.3) * 0.015;
      k *= Math.floor(p) % 2 ? 0.975 : 1.0;
      if (fp < 0.018 || fp > 0.982) k *= 0.8;
      if (Math.abs(fp - 0.03) < 0.004) k *= 0.9;
      k *= 1 - Math.pow(v, 3) * 0.14 - Math.pow(Math.abs(u - 0.5) * 2, 6) * 0.08;
      k *= 1 - Math.max(0, n.noise(x * 0.008 + 40, y * 0.012) - 0.45) * 0.3;
      const o = (y * W + x) * 4;
      img.data[o] = base[0] * k;
      img.data[o + 1] = base[1] * k;
      img.data[o + 2] = base[2] * k;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  clothCache.set(key, c);
  cv = c;
  return cv;
}

let wearCanvas: HTMLCanvasElement | null = null;
function wearOverlay(): HTMLCanvasElement {
  if (wearCanvas) return wearCanvas;
  const W = 1024;
  const H = 128;
  const [c, ctx] = mkCanvas(W, H);
  const n = new Noise2D(5);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = n.noise(x * 0.02, y * 0.05);
      const o = (y * W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
      img.data[o + 3] = Math.max(0, Math.min(255, (0.06 - k * 0.1) * 255));
    }
  ctx.putImageData(img, 0, 0);
  wearCanvas = c;
  return c;
}

/** Sailcloth: warm canvas panels with seams, reef bands, bolt ropes, weathering and heraldry. */
export function sailTexture(faction: string, kind: SailKind): THREE.Texture {
  return once(`ship.sail.${faction}.${kind}`, () => {
    const def = factionDef(faction);
    const W = 512;
    const H = 512;
    const [c, ctx] = mkCanvas(W, H);
    const pirate = faction === 'pirates';
    ctx.drawImage(clothBase(kind, pirate), 0, 0);
    // reef band with reef points on courses and topsails
    if (kind === 'course' || kind === 'top') {
      for (const ry of kind === 'course' ? [0.18, 0.3] : [0.22]) {
        ctx.fillStyle = 'rgba(120,100,70,0.35)';
        ctx.fillRect(0, ry * H - 3, W, 6);
        ctx.fillStyle = 'rgba(70,56,40,0.8)';
        for (let x = 12; x < W; x += 22) {
          ctx.fillRect(x, ry * H - 1, 2, 12);
        }
      }
    }
    // bonnet lacing near the foot of courses
    if (kind === 'course') {
      ctx.strokeStyle = 'rgba(90,70,48,0.55)';
      ctx.lineWidth = 2;
      for (let x = 0; x < W; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, H * 0.84);
        ctx.lineTo(x + 8, H * 0.86);
        ctx.lineTo(x + 16, H * 0.84);
        ctx.stroke();
      }
    }
    // heraldry
    if (!pirate) {
      if (kind === 'course') {
        // great painted cross of the house colours behind the arms
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = def.color;
        ctx.fillRect(W * 0.44, H * 0.05, W * 0.12, H * 0.9);
        ctx.fillRect(W * 0.06, H * 0.34, W * 0.88, H * 0.12);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 10;
        drawHeraldry(ctx, def.heraldry, W * 0.3, H * 0.17, W * 0.4, H * 0.48, true);
        ctx.restore();
      } else if (kind === 'top') {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = def.color;
        ctx.fillRect(W * 0.45, 0, W * 0.1, H);
        ctx.fillRect(0, H * 0.45, W, H * 0.1);
        ctx.globalAlpha = 1;
      } else if (kind === 'lateen') {
        // a painted roundel with the arms near the peak of the sail
        ctx.save();
        ctx.fillStyle = def.color;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(W * 0.58, H * 0.3, W * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = def.color2;
        ctx.lineWidth = 6;
        ctx.stroke();
        drawHeraldry(ctx, def.heraldry, W * 0.49, H * 0.18, W * 0.18, H * 0.24, true);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#e8e2d6';
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.4, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(W / 2 - 90, H * 0.6, 180, 16);
    }
    // bolt rope at the edges
    ctx.strokeStyle = 'rgba(80,60,40,0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    const t = finish(c, true, false);
    return t;
  });
}

/** Long streaming pennant / swallow-tail banner in the house colours. */
export function pennantTexture(faction: string): THREE.Texture {
  return once(`ship.pennant.${faction}`, () => {
    const def = factionDef(faction);
    const [c, ctx] = mkCanvas(512, 64);
    ctx.fillStyle = def.color;
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = def.color2;
    ctx.fillRect(0, 26, 512, 12);
    ctx.fillRect(0, 0, 70, 64);
    drawHeraldry(ctx, def.heraldry, 10, 6, 50, 52, false);
    return finish(c, true, false);
  });
}
