import type { Character } from '../sim/types';
import { factionDef } from '../data/factions';

const SKIN = ['#f1d2bb', '#e3b899', '#cf9f7c', '#b07d58', '#8a5d3e', '#6a4530'];
const HAIR = ['#e3d3a6', '#c49a58', '#8a5a2b', '#4f3219', '#241710', '#9c3f1c'];

/** Procedural painted-style portrait (original art, generated from the character's genes). */
export function portraitSVG(c: Character, age: number, w = 64, h = 78): string {
  const g = c.genes;
  const skin = SKIN[Math.max(0, Math.min(5, g.skin))];
  let hair = HAIR[g.hair % HAIR.length];
  const grey = age > 45 ? Math.min(1, (age - 45) / 25) : 0;
  const fdef = c.faction ? factionDef(c.faction) : factionDef('free');
  const cloth = fdef.color;
  const trim = fdef.color2;
  if (grey > 0.2) hair = grey > 0.7 ? '#c8c4bc' : '#8f8a80';
  const male = c.gender === 'm';
  const faceW = [30, 32, 28, 34][g.face % 4];
  const jaw = [0, 3, -2, 4][g.face % 4];
  const cx = 50;
  const cy = 52;
  const eyeY = cy - 3;
  const dead = !c.alive;
  const bgId = `bg${c.id}`;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="${w}" height="${h}">`;
  s += `<defs><radialGradient id="${bgId}" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${shade(cloth, 0.35)}"/><stop offset="1" stop-color="#0d0c0b"/></radialGradient>
  <linearGradient id="${bgId}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.25"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient></defs>`;
  s += `<rect width="100" height="120" fill="url(#${bgId})"/>`;
  // shoulders / clothing
  s += `<path d="M8 120 Q12 88 50 84 Q88 88 92 120 Z" fill="${cloth}"/>`;
  s += `<path d="M36 86 L50 100 L64 86" fill="none" stroke="${trim}" stroke-width="3"/>`;
  if (c.role === 'general' || c.traits.includes('brave') || c.isKnight) s += `<path d="M14 120 Q16 94 34 88 L30 120 Z M86 120 Q84 94 66 88 L70 120 Z" fill="#8d9196" opacity="0.9"/>`;
  // neck
  s += `<rect x="${cx - 8}" y="${cy + 18}" width="16" height="16" fill="${shade(skin, -0.08)}"/>`;
  // hair back (long hair for women / some men)
  if (!male || g.hairStyle >= 4) s += `<path d="M${cx - faceW / 2 - 5} ${cy - 10} Q${cx - faceW / 2 - 8} ${cy + 30} ${cx - 16} ${cy + 36} L${cx + 16} ${cy + 36} Q${cx + faceW / 2 + 8} ${cy + 30} ${cx + faceW / 2 + 5} ${cy - 10} Z" fill="${shade(hair, -0.15)}"/>`;
  // face
  s += `<path d="M${cx - faceW / 2} ${cy - 16} Q${cx - faceW / 2 - 1} ${cy + 10 + jaw} ${cx} ${cy + 22 + jaw} Q${cx + faceW / 2 + 1} ${cy + 10 + jaw} ${cx + faceW / 2} ${cy - 16} Q${cx} ${cy - 34} ${cx - faceW / 2} ${cy - 16} Z" fill="${skin}"/>`;
  s += `<path d="M${cx - faceW / 2} ${cy - 16} Q${cx - faceW / 2 - 1} ${cy + 10 + jaw} ${cx} ${cy + 22 + jaw} Q${cx + faceW / 2 + 1} ${cy + 10 + jaw} ${cx + faceW / 2} ${cy - 16} Q${cx} ${cy - 34} ${cx - faceW / 2} ${cy - 16} Z" fill="url(#${bgId}s)"/>`;
  // ears
  s += `<ellipse cx="${cx - faceW / 2 - 1}" cy="${eyeY + 3}" rx="3" ry="5" fill="${shade(skin, -0.1)}"/><ellipse cx="${cx + faceW / 2 + 1}" cy="${eyeY + 3}" rx="3" ry="5" fill="${shade(skin, -0.1)}"/>`;
  // eyes
  const eyeCol = ['#3b4b5c', '#4a3524', '#3e5a3a', '#6b7c8c'][g.eyes % 4];
  for (const sx of [-7, 7]) {
    s += `<ellipse cx="${cx + sx}" cy="${eyeY}" rx="3.6" ry="2" fill="#f4efe6"/><circle cx="${cx + sx}" cy="${eyeY}" r="1.6" fill="${eyeCol}"/>`;
    s += `<path d="M${cx + sx - 5} ${eyeY - 4 - g.brow} Q${cx + sx} ${eyeY - 6 - g.brow} ${cx + sx + 5} ${eyeY - 4 - g.brow + (sx < 0 ? 1 : 0)}" stroke="${shade(hair, -0.3)}" stroke-width="${male ? 2 : 1.2}" fill="none"/>`;
  }
  // nose & mouth
  const nl = [7, 9, 8, 10][g.nose % 4];
  s += `<path d="M${cx} ${eyeY + 1} L${cx - 2.5} ${eyeY + nl} Q${cx} ${eyeY + nl + 1.5} ${cx + 2.5} ${eyeY + nl}" stroke="${shade(skin, -0.25)}" stroke-width="1.2" fill="none"/>`;
  s += `<path d="M${cx - 5} ${eyeY + nl + 7} Q${cx} ${eyeY + nl + 8.5} ${cx + 5} ${eyeY + nl + 7}" stroke="#7a4636" stroke-width="1.6" fill="none"/>`;
  // wrinkles with age
  if (age > 40) s += `<path d="M${cx - 12} ${eyeY + 9} q2 4 1 7 M${cx + 12} ${eyeY + 9} q-2 4 -1 7" stroke="${shade(skin, -0.2)}" stroke-width="0.8" fill="none" opacity="${Math.min(1, (age - 40) / 20)}"/>`;
  // beard
  if (male && g.beard >= 2 && age >= 18) {
    const bl = [0, 0, 6, 10, 14, 18][g.beard];
    s += `<path d="M${cx - faceW / 2 + 1} ${cy} Q${cx - faceW / 2 + 2} ${cy + 14 + bl} ${cx} ${cy + 22 + jaw + bl} Q${cx + faceW / 2 - 2} ${cy + 14 + bl} ${cx + faceW / 2 - 1} ${cy} Q${cx} ${cy + 8} ${cx - faceW / 2 + 1} ${cy} Z" fill="${hair}" opacity="0.95"/>`;
    s += `<path d="M${cx - 6} ${eyeY + nl + 5} Q${cx} ${eyeY + nl + 2} ${cx + 6} ${eyeY + nl + 5}" stroke="${hair}" stroke-width="3" fill="none"/>`;
  }
  // hair top
  const hs = g.hairStyle % 6;
  if (male && hs === 0 && age > 35) {
    s += `<path d="M${cx - faceW / 2} ${cy - 10} Q${cx - faceW / 2} ${cy - 22} ${cx - 10} ${cy - 24} M${cx + faceW / 2} ${cy - 10} Q${cx + faceW / 2} ${cy - 22} ${cx + 10} ${cy - 24}" stroke="${hair}" stroke-width="4" fill="none"/>`;
  } else {
    s += `<path d="M${cx - faceW / 2 - 2} ${cy - 8} Q${cx - faceW / 2 - 4} ${cy - 36} ${cx} ${cy - 37} Q${cx + faceW / 2 + 4} ${cy - 36} ${cx + faceW / 2 + 2} ${cy - 8} Q${cx + 6} ${cy - 26 + hs} ${cx - faceW / 2 - 2} ${cy - 8} Z" fill="${hair}"/>`;
  }
  // crown / circlet
  if (c.role === 'ruler') s += `<path d="M${cx - 17} ${cy - 24} L${cx - 15} ${cy - 36} L${cx - 8} ${cy - 29} L${cx} ${cy - 40} L${cx + 8} ${cy - 29} L${cx + 15} ${cy - 36} L${cx + 17} ${cy - 24} Z" fill="#d9b24a" stroke="#6d5418" stroke-width="1"/><circle cx="${cx}" cy="${cy - 30}" r="2" fill="#b3261e"/>`;
  else if (c.role === 'heir' || c.role === 'consort') s += `<path d="M${cx - 16} ${cy - 23} Q${cx} ${cy - 28} ${cx + 16} ${cy - 23}" stroke="#d9b24a" stroke-width="2.5" fill="none"/>`;
  if (dead) s += `<rect width="100" height="120" fill="#000" opacity="0.35"/><path d="M10 10 L90 110" stroke="#6b1a14" stroke-width="2" opacity="0.6"/>`;
  s += `</svg>`;
  return s;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
  } else {
    r = Math.round(r * (1 + amt));
    g = Math.round(g * (1 + amt));
    b = Math.round(b * (1 + amt));
  }
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
