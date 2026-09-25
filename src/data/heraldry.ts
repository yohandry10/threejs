/** Original heraldic charges drawn as SVG paths in a 100x100 box. */
export const CHARGES: Record<string, string> = {
  sheaf:
    'M50 18 L54 30 L58 20 L60 34 L66 24 L64 40 L72 32 L66 48 L60 50 L62 58 L68 84 L60 84 L55 62 L52 86 L48 86 L45 62 L40 84 L32 84 L38 58 L40 50 L34 48 L28 32 L36 40 L34 24 L40 34 L42 20 L46 30 Z M36 52 L64 52 L64 57 L36 57 Z',
  knight:
    'M34 86 L36 72 Q30 66 32 58 L40 50 Q34 50 28 54 Q22 52 24 44 L40 26 Q42 16 50 14 L54 22 Q66 24 72 40 Q78 56 72 72 L74 86 Z M44 30 A3 3 0 1 0 44.1 30 Z',
  tower:
    'M28 86 L28 40 L24 40 L24 22 L32 22 L32 28 L38 28 L38 22 L46 22 L46 28 L54 28 L54 22 L62 22 L62 28 L68 28 L68 22 L76 22 L76 40 L72 40 L72 86 Z M42 86 L42 66 Q50 56 58 66 L58 86 Z M46 44 L54 44 L54 54 L46 54 Z',
  anvil:
    'M18 34 L70 34 Q84 34 86 26 L88 40 Q80 48 66 48 L60 48 L60 60 L70 70 L70 80 L30 80 L30 70 L40 60 L40 48 L30 48 Q20 46 18 40 Z',
  oak:
    'M46 86 L47 64 Q36 70 26 62 Q14 56 20 42 Q16 28 30 24 Q34 12 50 14 Q66 12 70 24 Q84 28 80 42 Q86 56 74 62 Q64 70 53 64 L54 86 Z',
  key:
    'M50 12 A14 14 0 1 1 49.9 12 Z M50 20 A6 6 0 1 0 50.1 20 Z M46 38 L54 38 L54 70 L66 70 L66 76 L58 76 L58 80 L66 80 L66 88 L46 88 Z',
  anchor:
    'M50 10 A8 8 0 1 1 49.9 10 Z M50 15 A3 3 0 1 0 50.1 15 Z M47 25 L53 25 L53 34 L66 34 L66 40 L53 40 L53 80 Q66 78 74 64 L68 62 L80 52 L82 68 L77 66 Q68 86 50 88 Q32 86 23 66 L18 68 L20 52 L32 62 L26 64 Q34 78 47 80 L47 40 L34 40 L34 34 L47 34 Z',
  ship:
    'M48 12 L52 12 L52 20 Q72 30 74 52 L52 52 L52 60 L86 60 Q80 80 60 84 L40 84 Q20 80 14 60 L48 60 L48 52 L28 52 Q34 30 48 20 Z',
  sun:
    'M50 30 A20 20 0 1 1 49.9 30 Z M50 6 L55 24 L45 24 Z M50 94 L45 76 L55 76 Z M6 50 L24 45 L24 55 Z M94 50 L76 55 L76 45 Z M19 19 L34 30 L30 34 Z M81 81 L66 70 L70 66 Z M81 19 L70 34 L66 30 Z M19 81 L30 66 L34 70 Z',
  crown:
    'M20 70 L16 34 L32 50 L40 26 L50 44 L60 26 L68 50 L84 34 L80 70 Z M22 74 L78 74 L78 82 L22 82 Z',
  swords:
    'M20 14 L26 12 L62 60 L68 56 L72 60 L64 66 L70 74 L66 78 L58 70 L52 78 L48 74 L54 66 L56 64 Z M80 14 L74 12 L38 60 L32 56 L28 60 L36 66 L30 74 L34 78 L42 70 L48 78 L52 74 L46 66 L44 64 Z',
  star:
    'M50 12 L59 38 L86 38 L64 54 L72 82 L50 66 L28 82 L36 54 L14 38 L41 38 Z',
};

export type FieldDivision = 'plain' | 'per_pale' | 'per_fess' | 'per_bend' | 'quarterly' | 'chevron' | 'bordure' | 'chief';

export interface Heraldry {
  field: FieldDivision;
  tincture: string; // main field colour
  tincture2: string; // secondary field colour
  charge: keyof typeof CHARGES;
  chargeColor: string;
}

/** Shield outline in 100x120 box. */
export const SHIELD_PATH = 'M4 4 L96 4 L96 52 Q96 96 50 116 Q4 96 4 52 Z';

export function heraldrySVG(h: Heraldry, size = 64, id = 'h'): string {
  const clip = `clip-${id}-${Math.floor(Math.random() * 1e9)}`;
  let division = '';
  switch (h.field) {
    case 'per_pale':
      division = `<rect x="50" y="0" width="50" height="120" fill="${h.tincture2}"/>`;
      break;
    case 'per_fess':
      division = `<rect x="0" y="60" width="100" height="60" fill="${h.tincture2}"/>`;
      break;
    case 'per_bend':
      division = `<path d="M0 0 L100 120 L0 120 Z" fill="${h.tincture2}"/>`;
      break;
    case 'quarterly':
      division = `<rect x="50" y="0" width="50" height="60" fill="${h.tincture2}"/><rect x="0" y="60" width="50" height="60" fill="${h.tincture2}"/>`;
      break;
    case 'chevron':
      division = `<path d="M0 100 L50 50 L100 100 L100 80 L50 30 L0 80 Z" fill="${h.tincture2}"/>`;
      break;
    case 'bordure':
      division = `<path d="${SHIELD_PATH}" fill="none" stroke="${h.tincture2}" stroke-width="14"/>`;
      break;
    case 'chief':
      division = `<rect x="0" y="0" width="100" height="30" fill="${h.tincture2}"/>`;
      break;
  }
  const scale = h.field === 'chief' ? 0.62 : 0.72;
  const ty = h.field === 'chief' ? 36 : 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="${size}" height="${size * 1.2}">
<defs><clipPath id="${clip}"><path d="${SHIELD_PATH}"/></clipPath>
<linearGradient id="${clip}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.3"/></linearGradient></defs>
<g clip-path="url(#${clip})"><rect width="100" height="120" fill="${h.tincture}"/>${division}
<g transform="translate(${50 - 50 * scale} ${ty}) scale(${scale})"><path d="${CHARGES[h.charge]}" fill="${h.chargeColor}" fill-rule="evenodd" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/></g>
<rect width="100" height="120" fill="url(#${clip}g)"/></g>
<path d="${SHIELD_PATH}" fill="none" stroke="#2a2418" stroke-width="3"/>
<path d="${SHIELD_PATH}" fill="none" stroke="#b89a58" stroke-width="1.2" opacity="0.7"/>
</svg>`;
}

/** Draw heraldry to a 2D canvas context (used for banner / sail / shield textures). */
export function drawHeraldry(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  h: Heraldry,
  x: number,
  y: number,
  w: number,
  hgt: number,
  shieldShape = false,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / 100, hgt / 120);
  if (shieldShape) {
    ctx.clip(new Path2D(SHIELD_PATH));
  }
  ctx.fillStyle = h.tincture;
  ctx.fillRect(0, 0, 100, 120);
  ctx.fillStyle = h.tincture2;
  switch (h.field) {
    case 'per_pale':
      ctx.fillRect(50, 0, 50, 120);
      break;
    case 'per_fess':
      ctx.fillRect(0, 60, 100, 60);
      break;
    case 'per_bend':
      ctx.fill(new Path2D('M0 0 L100 120 L0 120 Z'));
      break;
    case 'quarterly':
      ctx.fillRect(50, 0, 50, 60);
      ctx.fillRect(0, 60, 50, 60);
      break;
    case 'chevron':
      ctx.fill(new Path2D('M0 100 L50 50 L100 100 L100 80 L50 30 L0 80 Z'));
      break;
    case 'bordure':
      ctx.strokeStyle = h.tincture2;
      ctx.lineWidth = 14;
      ctx.stroke(new Path2D(shieldShape ? SHIELD_PATH : 'M0 0 L100 0 L100 120 L0 120 Z'));
      break;
    case 'chief':
      ctx.fillRect(0, 0, 100, 30);
      break;
  }
  const scale = h.field === 'chief' ? 0.62 : 0.72;
  const ty = h.field === 'chief' ? 36 : 18;
  ctx.translate(50 - 50 * scale, ty);
  ctx.scale(scale, scale);
  ctx.fillStyle = h.chargeColor;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  const p = new Path2D(CHARGES[h.charge]);
  ctx.fill(p, 'evenodd');
  ctx.stroke(p);
  ctx.restore();
}
