import * as THREE from 'three';
import { ALL_FACTION_DEFS } from '../../data/factions';
import { drawHeraldry } from '../../data/heraldry';
import { unitDef } from '../../data/units';
import { buildHorseGeometry, buildSoldierGeometry } from './figureGeometry';

/** Animation states understood by the figure vertex shader. */
export const ANIM = {
  idle: 0,
  walk: 1,
  run: 2,
  attack: 3,
  thrust: 4,
  block: 5,
  hit: 6,
  dead: 7,
  flee: 8,
  bowDraw: 9,
  bowRelease: 10,
  xbowAim: 11,
  xbowReload: 12,
  ride: 13,
  charge: 14,
  work: 15,
  carry: 16,
  cheer: 17,
  push: 18,
};
export const HANIM = { idle: 0, walk: 1, trot: 2, gallop: 3, dead: 7 };

export const figureUniforms = { uTime: { value: 0 }, uEmblem: { value: null as THREE.Texture | null } };

let emblemTex: THREE.CanvasTexture | null = null;
export function emblemAtlas(): THREE.CanvasTexture {
  if (emblemTex) return emblemTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ALL_FACTION_DEFS.forEach((f, i) => {
    const x = (i % 4) * 128;
    const y = Math.floor(i / 4) * 128;
    drawHeraldry(ctx, f.heraldry, x, y, 128, 128, false);
  });
  emblemTex = new THREE.CanvasTexture(c);
  emblemTex.colorSpace = THREE.SRGBColorSpace;
  figureUniforms.uEmblem.value = emblemTex;
  return emblemTex;
}
export const emblemIndex = (faction: string) => Math.max(0, ALL_FACTION_DEFS.findIndex((f) => f.id === faction));

const POSE_GLSL = /* glsl */ `
attribute float aBone;
attribute float aMat;
attribute float aVar;
attribute vec2 aUV2;
attribute vec4 iPos;
attribute vec4 iAnim;
attribute vec3 iColA;
attribute vec3 iColB;
attribute vec4 iMisc;
uniform float uTime;
varying float vMat;
varying vec3 vColA;
varying vec3 vColB;
varying vec2 vUV2;
varying float vEmblem;
varying float vSkin;
varying float vSeed;

mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 ry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

void rot(inout vec3 p, inout vec3 n, mat3 m, vec3 pivot) { p = m * (p - pivot) + pivot; n = m * n; }

void poseSoldier(inout vec3 p, inout vec3 n) {
  float b = aBone;
  float st = iAnim.x;
  float tt = uTime - iAnim.y;
  float seed = iAnim.w;
  float ph = uTime * iAnim.z * 6.2831 + seed * 6.2831;
  float hipR = 0.0, hipL = 0.0, kneeR = 0.0, kneeL = 0.0;
  float shR = -0.15, shL = -0.1, elR = -0.55, elL = -0.35, raR = -0.1, raL = 0.12;
  float lean = 0.0, twist = 0.0, nod = 0.0, bob = 0.0, fall = 0.0, side = 0.0;
  float breathe = sin(uTime * 1.6 + seed * 20.0) * 0.02;
  lean = breathe;
  if (st < 0.5) {
    // idle, weapon at rest with small fidgets
    shR = -0.25 + sin(uTime * 0.7 + seed * 9.0) * 0.05;
    nod = sin(uTime * 0.5 + seed * 13.0) * 0.08;
    twist = sin(uTime * 0.3 + seed * 7.0) * 0.08;
  } else if (st < 1.5 || (st > 7.5 && st < 8.5) || (st > 1.5 && st < 2.5)) {
    bool run = st > 1.5;
    bool flee = st > 7.5;
    float amp = run ? 0.75 : 0.42;
    float s = sin(ph);
    hipR = s * amp;
    hipL = -s * amp;
    kneeR = max(0.0, -sin(ph - 1.2)) * (run ? 1.3 : 0.7);
    kneeL = max(0.0, sin(ph - 1.2)) * (run ? 1.3 : 0.7);
    shR = -0.2 - s * amp * 0.5;
    shL = s * amp * 0.6;
    elR = -0.6 - (run ? 0.6 : 0.2);
    elL = -0.4 - (run ? 0.6 : 0.1);
    bob = abs(cos(ph)) * (run ? 0.07 : 0.03);
    lean = run ? 0.22 : 0.05;
    if (flee) { shR = -2.6 + sin(ph * 2.0) * 0.4; shL = -2.4 - sin(ph * 2.0) * 0.4; elR = -0.3; elL = -0.3; lean = 0.35; nod = -0.3; }
  } else if (st < 3.5) {
    // overhead slash
    float c = fract((uTime + seed * 3.0) * 0.85);
    float wind = smoothstep(0.0, 0.45, c);
    float strike = smoothstep(0.45, 0.6, c);
    float rec = smoothstep(0.7, 1.0, c);
    shR = mix(-0.4, -2.7, wind);
    shR = mix(shR, 0.35, strike);
    shR = mix(shR, -0.4, rec);
    elR = mix(-0.4, -1.3, wind) * (1.0 - strike) - 0.1;
    twist = (wind - strike) * 0.45;
    lean = strike * 0.25 - wind * 0.08;
    hipR = -0.35; hipL = 0.3; kneeR = 0.35; kneeL = 0.2;
    shL = -0.9; elL = -1.0;
  } else if (st < 4.5) {
    // thrust (spears, pikes)
    float c = fract((uTime + seed * 3.0) * 0.8);
    float jab = smoothstep(0.3, 0.45, c) * (1.0 - smoothstep(0.55, 0.95, c));
    shR = -1.35 - jab * 0.25;
    elR = mix(-1.5, -0.1, jab);
    shL = -1.2; elL = -0.8;
    lean = 0.15 + jab * 0.2;
    hipR = -0.4; hipL = 0.35; kneeR = 0.4; kneeL = 0.3;
  } else if (st < 5.5) {
    // block / brace
    shL = -1.3; elL = -1.3; raL = 0.25;
    shR = -1.25; elR = -0.6;
    hipR = -0.3; hipL = 0.25; kneeR = 0.5; kneeL = 0.45; lean = 0.2;
  } else if (st < 6.5) {
    float k = exp(-tt * 5.0);
    lean = -0.45 * k; nod = -0.4 * k; shR = -0.2 + 0.6 * k; shL = 0.5 * k;
  } else if (st < 7.5) {
    // death: collapse backwards or sideways and stay down
    float k = smoothstep(0.0, 0.75, tt);
    fall = -1.5 * k;
    side = (fract(seed * 7.13) - 0.5) * 1.2 * k;
    shR = -0.4 - 1.6 * k; shL = -0.3 - 1.4 * k; kneeR = 0.6 * k; kneeL = 0.1 * k; hipR = -0.3 * k;
  } else if (st < 9.5) {
    // draw bow and aim (arc follows the volley)
    float d = smoothstep(0.0, 0.8, tt);
    shL = -1.5; elL = -0.08; raL = 0.05;
    shR = mix(-0.6, -1.55, d); elR = mix(-0.6, -2.3, d); raR = -0.25 * d;
    twist = 0.45 * d; lean = -0.12;
    hipR = -0.25; hipL = 0.25;
  } else if (st < 10.5) {
    float k = exp(-tt * 6.0);
    shL = -1.5; elL = -0.08;
    shR = -1.55 + 0.4 * (1.0 - k); elR = -0.6 - 1.7 * k; raR = -0.4 * (1.0 - k);
    twist = 0.45 * k + 0.1; hipR = -0.25; hipL = 0.25;
  } else if (st < 11.5) {
    shR = -1.45; elR = -0.9; shL = -1.35; elL = -0.5; twist = 0.1; nod = 0.1; hipR = -0.3; hipL = 0.25;
  } else if (st < 12.5) {
    float c = fract(tt * 0.35);
    lean = 0.55; shR = -0.2 - sin(c * 6.28) * 0.5; elR = -1.2; shL = -0.3; elL = -1.0; kneeR = 0.5; kneeL = 0.5; hipR = -0.4; hipL = -0.4;
  } else if (st < 14.5) {
    // mounted: sit, bob with the gait, couch lance when charging
    hipR = -1.35; hipL = -1.35; kneeR = 1.45; kneeL = 1.45; raR = -0.25; raL = 0.25;
    bob = abs(sin(ph)) * 0.05 * min(iAnim.z, 1.5);
    lean = 0.05 + (st > 13.5 ? 0.25 : 0.0);
    shL = -0.7; elL = -0.9;
    if (st > 13.5) { shR = -0.95; elR = -1.35; } else { shR = -0.4 + sin(ph) * 0.05; elR = -0.9; }
  } else if (st < 15.5) {
    // work: hoeing / hammering
    float c = sin(uTime * 2.4 + seed * 12.0);
    shR = -1.2 - c * 0.9; shL = -1.0 - c * 0.9; elR = -0.5; elL = -0.6; lean = 0.35 + c * 0.1; kneeR = 0.2; kneeL = 0.2; hipR = -0.2; hipL = -0.2;
  } else if (st < 16.5) {
    // carry goods
    float s = sin(ph);
    hipR = s * 0.35; hipL = -s * 0.35; kneeR = max(0.0, -sin(ph - 1.2)) * 0.6; kneeL = max(0.0, sin(ph - 1.2)) * 0.6;
    shR = -1.0; shL = -1.0; elR = -1.2; elL = -1.2; bob = abs(cos(ph)) * 0.03;
  } else if (st < 17.5) {
    float c = sin(uTime * 5.0 + seed * 10.0);
    shR = -2.8 + c * 0.2; elR = -0.2; shL = -0.3; nod = -0.2;
  } else {
    // pushing (ram / crew)
    float s = sin(ph * 0.6);
    shR = -1.3; shL = -1.3; elR = -0.3; elL = -0.3; lean = 0.45; hipR = s * 0.3 - 0.2; hipL = -s * 0.3 - 0.2; kneeR = 0.4; kneeL = 0.4;
  }
  // --- apply the limb chain
  vec3 hipRP = vec3(-0.1, 0.92, 0.0), hipLP = vec3(0.1, 0.92, 0.0);
  vec3 kneeRP = vec3(-0.1, 0.5, 0.01), kneeLP = vec3(0.1, 0.5, 0.01);
  vec3 shRP = vec3(-0.25, 1.42, 0.0), shLP = vec3(0.25, 1.42, 0.0);
  vec3 elRP = vec3(-0.27, 1.14, 0.0), elLP = vec3(0.27, 1.14, 0.0);
  vec3 waist = vec3(0.0, 0.98, 0.0);
  vec3 neck = vec3(0.0, 1.5, 0.0);
  if (b > 7.5 && b < 8.5) rot(p, n, rx(kneeR), kneeRP);
  if (b > 9.5) rot(p, n, rx(kneeL), kneeLP);
  if (b > 6.5 && b < 8.5) rot(p, n, rx(hipR), hipRP);
  if (b > 8.5) rot(p, n, rx(hipL), hipLP);
  if (b > 3.5 && b < 4.5) rot(p, n, rx(elR), elRP);
  if (b > 5.5 && b < 6.5) rot(p, n, rx(elL), elLP);
  if (b > 2.5 && b < 4.5) { rot(p, n, rz(raR), shRP); rot(p, n, rx(shR), shRP); }
  if (b > 4.5 && b < 6.5) { rot(p, n, rz(raL), shLP); rot(p, n, rx(shL), shLP); }
  if (b > 1.5 && b < 2.5) rot(p, n, rx(nod), neck);
  if (b > 0.5 && b < 6.5) rot(p, n, ry(twist) * rx(lean), waist);
  p.y += bob;
  if (fall != 0.0) { rot(p, n, rz(side) * rx(fall), vec3(0.0)); p.y += 0.12 * smoothstep(-0.2, -1.4, fall); }
}

void poseHorse(inout vec3 p, inout vec3 n) {
  float b = aBone;
  float st = iAnim.x;
  float tt = uTime - iAnim.y;
  float seed = iAnim.w;
  float ph = uTime * iAnim.z * 6.2831 + seed * 6.2831;
  float fl = 0.0, fr = 0.0, bl = 0.0, br = 0.0;
  float flk = 0.0, frk = 0.0, blk = 0.0, brk = 0.0;
  float neckA = 0.0, tail = sin(uTime * 1.3 + seed * 5.0) * 0.15, pitch = 0.0, bob = 0.0, fall = 0.0;
  if (st < 0.5) {
    neckA = sin(uTime * 0.6 + seed * 9.0) * 0.12 + 0.05;
  } else if (st < 3.5) {
    float amp = st < 1.5 ? 0.35 : st < 2.5 ? 0.5 : 0.8;
    float o1 = 0.0, o2 = 0.5, o3 = 0.25, o4 = 0.75;
    if (st > 1.5 && st < 2.5) { o1 = 0.0; o2 = 0.5; o3 = 0.5; o4 = 0.0; }
    if (st > 2.5) { o1 = 0.0; o2 = 0.12; o3 = 0.55; o4 = 0.65; }
    fl = sin(ph + o1 * 6.2831) * amp; fr = sin(ph + o2 * 6.2831) * amp;
    bl = sin(ph + o3 * 6.2831) * amp; br = sin(ph + o4 * 6.2831) * amp;
    flk = max(0.0, cos(ph + o1 * 6.2831)) * amp * 1.6; frk = max(0.0, cos(ph + o2 * 6.2831)) * amp * 1.6;
    blk = -max(0.0, cos(ph + o3 * 6.2831)) * amp * 0.9; brk = -max(0.0, cos(ph + o4 * 6.2831)) * amp * 0.9;
    bob = abs(sin(ph)) * (st > 2.5 ? 0.12 : 0.04);
    pitch = sin(ph) * (st > 2.5 ? 0.08 : 0.02);
    neckA = -sin(ph) * (st > 2.5 ? 0.15 : 0.06) + (st > 2.5 ? -0.25 : 0.0);
  } else {
    float k = smoothstep(0.0, 0.9, tt);
    fall = 1.45 * k;
    fl = -0.8 * k; fr = -0.6 * k; bl = 0.6 * k; br = 0.4 * k;
  }
  vec3 fShould = vec3(0.0, 1.1, 0.5), bHip = vec3(0.0, 1.1, -0.5);
  vec3 fKnee = vec3(0.0, 0.62, 0.52), bKnee = vec3(0.0, 0.62, -0.48);
  if (b > 3.5 && b < 4.5) rot(p, n, rx(flk), fKnee);
  if (b > 4.5 && b < 5.5) rot(p, n, rx(frk), fKnee);
  if (b > 7.5 && b < 8.5) rot(p, n, rx(blk), bKnee);
  if (b > 8.5 && b < 9.5) rot(p, n, rx(brk), bKnee);
  if ((b > 1.5 && b < 2.5) || (b > 3.5 && b < 4.5)) rot(p, n, rx(-fl), fShould);
  if ((b > 2.5 && b < 3.5) || (b > 4.5 && b < 5.5)) rot(p, n, rx(-fr), fShould);
  if ((b > 5.5 && b < 6.5) || (b > 7.5 && b < 8.5)) rot(p, n, rx(-bl), bHip);
  if ((b > 6.5 && b < 7.5) || (b > 8.5 && b < 9.5)) rot(p, n, rx(-br), bHip);
  if (b > 0.5 && b < 1.5) rot(p, n, rx(neckA), vec3(0.0, 1.35, 0.62));
  if (b > 9.5) rot(p, n, rz(tail) * rx(-0.2), vec3(0.0, 1.35, -0.8));
  rot(p, n, rx(pitch), vec3(0.0, 1.1, 0.0));
  p.y += bob;
  if (fall > 0.0) { rot(p, n, rz(fall * (fract(seed * 3.7) > 0.5 ? 1.0 : -1.0)), vec3(0.0)); p.y += 0.3 * smoothstep(0.0, 1.4, fall); }
}

vec3 gPosed;
vec3 poseAll(vec3 pos, inout vec3 nrm) {
  vec3 p = pos;
  if (aVar > 0.5 && abs(aVar - iMisc.w) > 0.5) return vec3(0.0, -1000.0, 0.0);
  #ifdef FIGURE_HORSE
  poseHorse(p, nrm);
  #else
  poseSoldier(p, nrm);
  #endif
  mat3 yaw = ry(iPos.w);
  nrm = yaw * nrm;
  return yaw * (p * iMisc.z) + iPos.xyz;
}
`;

function patchFigure(m: THREE.Material, horse: boolean, depth: boolean) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = figureUniforms.uTime;
    sh.uniforms.uEmblem = figureUniforms.uEmblem;
    if (horse) sh.defines = { ...(sh.defines ?? {}), FIGURE_HORSE: 1 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + POSE_GLSL);
    if (!depth) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normal;\ngPosed = poseAll(position, objectNormal);\nvMat = aMat; vColA = iColA; vColB = iColB; vUV2 = aUV2; vEmblem = iMisc.y; vSkin = iMisc.x; vSeed = iAnim.w;')
        .replace('#include <begin_vertex>', 'vec3 transformed = gPosed;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uEmblem;
          varying float vMat; varying vec3 vColA; varying vec3 vColB; varying vec2 vUV2; varying float vEmblem; varying float vSkin; varying float vSeed;
          vec3 skinCol(float i) {
            if (i < 0.5) return vec3(0.93, 0.78, 0.66);
            if (i < 1.5) return vec3(0.86, 0.68, 0.54);
            if (i < 2.5) return vec3(0.76, 0.58, 0.44);
            if (i < 3.5) return vec3(0.62, 0.45, 0.32);
            if (i < 4.5) return vec3(0.48, 0.34, 0.24);
            return vec3(0.36, 0.25, 0.18);
          }
          vec3 hairCol(float s) {
            float k = fract(s * 17.3);
            if (k < 0.2) return vec3(0.08, 0.06, 0.05);
            if (k < 0.45) return vec3(0.25, 0.16, 0.09);
            if (k < 0.65) return vec3(0.45, 0.3, 0.16);
            if (k < 0.8) return vec3(0.72, 0.58, 0.34);
            if (k < 0.9) return vec3(0.52, 0.2, 0.08);
            return vec3(0.55, 0.53, 0.5);
          }
          vec3 coatCol(float s) {
            float k = fract(s * 11.7);
            if (k < 0.3) return vec3(0.33, 0.19, 0.1);
            if (k < 0.5) return vec3(0.45, 0.25, 0.12);
            if (k < 0.65) return vec3(0.08, 0.07, 0.07);
            if (k < 0.8) return vec3(0.55, 0.53, 0.5);
            if (k < 0.9) return vec3(0.82, 0.8, 0.76);
            return vec3(0.62, 0.48, 0.3);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 fc = vec3(1.0);
          float mt = vMat;
          if (mt < 0.5) fc = skinCol(vSkin);
          else if (mt < 1.5) fc = vColA;
          else if (mt < 2.5) fc = vColB;
          else if (mt < 3.5) fc = vec3(0.5, 0.52, 0.55);
          else if (mt < 4.5) fc = vec3(0.3, 0.2, 0.12);
          else if (mt < 5.5) fc = vec3(0.42, 0.3, 0.18);
          else if (mt < 6.5) fc = hairCol(vSeed);
          else if (mt < 7.5) {
            vec2 cell = vec2(mod(vEmblem, 4.0), floor(vEmblem / 4.0));
            vec2 uv = (cell + clamp(vUV2, 0.02, 0.98)) / 4.0;
            fc = texture2D(uEmblem, vec2(uv.x, 1.0 - uv.y)).rgb;
          }
          else if (mt < 8.5) fc = vec3(0.1, 0.085, 0.07);
          else if (mt < 9.5) fc = vec3(0.78, 0.8, 0.84);
          else if (mt < 10.5) fc = coatCol(vSeed);
          else fc = vec3(0.07, 0.055, 0.05);
          diffuseColor.rgb = fc;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = (vMat > 2.5 && vMat < 3.5) || (vMat > 8.5 && vMat < 9.5) ? 0.38 : 0.85;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = (vMat > 2.5 && vMat < 3.5) || (vMat > 8.5 && vMat < 9.5) ? 0.75 : 0.0;');
    } else {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 dn = vec3(0.0, 1.0, 0.0);\nvec3 transformed = poseAll(position, dn);');
    }
  };
  m.customProgramCacheKey = () => `figure-${horse ? 'h' : 's'}-${depth ? 'd' : 'c'}`;
}

let mats: { soldier: THREE.MeshStandardMaterial; horse: THREE.MeshStandardMaterial; dSoldier: THREE.MeshDepthMaterial; dHorse: THREE.MeshDepthMaterial } | null = null;
function figureMaterials() {
  if (mats) return mats;
  emblemAtlas();
  const soldier = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const horse = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const dSoldier = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const dHorse = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchFigure(soldier, false, false);
  patchFigure(horse, true, false);
  patchFigure(dSoldier, false, true);
  patchFigure(dHorse, true, true);
  mats = { soldier, horse, dSoldier, dHorse };
  return mats;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
export function figureBaseGeometry(key: string): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (g) return g;
  if (key === 'horse') g = buildHorseGeometry(false);
  else if (key === 'horse_barded') g = buildHorseGeometry(true);
  else if (key === 'villager') g = buildSoldierGeometry({ helmet: 0, body: 0, shield: 0, weapon: 7, mounted: false }, true);
  else if (key === 'crew') g = buildSoldierGeometry({ helmet: 5, body: 1, shield: 0, weapon: 7, mounted: false }, true);
  else g = buildSoldierGeometry(unitDef(key).visual);
  geoCache.set(key, g);
  return g;
}

/** A dynamic batch of GPU-animated figures sharing one geometry. */
export class FigureBatch {
  geo: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  capacity = 0;
  count = 0;
  pos!: Float32Array;
  anim!: Float32Array;
  colA!: Float32Array;
  colB!: Float32Array;
  misc!: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[] = [];
  readonly horse: boolean;
  constructor(public key: string, capacity: number, shadows = true) {
    const base = figureBaseGeometry(key);
    this.horse = key.startsWith('horse');
    this.geo = new THREE.InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) this.geo.setAttribute(name, base.attributes[name]);
    const m = figureMaterials();
    this.mesh = new THREE.Mesh(this.geo, this.horse ? m.horse : m.soldier);
    this.mesh.customDepthMaterial = this.horse ? m.dHorse : m.dSoldier;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = false;
    this.grow(Math.max(8, capacity));
  }
  private grow(cap: number) {
    const old = { pos: this.pos, anim: this.anim, colA: this.colA, colB: this.colB, misc: this.misc };
    this.capacity = cap;
    this.pos = new Float32Array(cap * 4);
    this.anim = new Float32Array(cap * 4);
    this.colA = new Float32Array(cap * 3);
    this.colB = new Float32Array(cap * 3);
    this.misc = new Float32Array(cap * 4);
    if (old.pos) {
      this.pos.set(old.pos);
      this.anim.set(old.anim);
      this.colA.set(old.colA);
      this.colB.set(old.colB);
      this.misc.set(old.misc);
    }
    const mk = (name: string, arr: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [mk('iPos', this.pos, 4), mk('iAnim', this.anim, 4), mk('iColA', this.colA, 3), mk('iColB', this.colB, 3), mk('iMisc', this.misc, 4)];
  }
  ensure(n: number) {
    if (n > this.capacity) this.grow(Math.ceil(n * 1.5));
  }
  set(i: number, x: number, y: number, z: number, yaw: number, state: number, stateStart: number, speed: number, seed: number, ca: THREE.Color, cb: THREE.Color, skin: number, emblem: number, scale: number, variant: number) {
    const p = this.pos;
    const a = this.anim;
    p[i * 4] = x;
    p[i * 4 + 1] = y;
    p[i * 4 + 2] = z;
    p[i * 4 + 3] = yaw;
    a[i * 4] = state;
    a[i * 4 + 1] = stateStart;
    a[i * 4 + 2] = speed;
    a[i * 4 + 3] = seed;
    this.colA[i * 3] = ca.r;
    this.colA[i * 3 + 1] = ca.g;
    this.colA[i * 3 + 2] = ca.b;
    this.colB[i * 3] = cb.r;
    this.colB[i * 3 + 1] = cb.g;
    this.colB[i * 3 + 2] = cb.b;
    this.misc[i * 4] = skin;
    this.misc[i * 4 + 1] = emblem;
    this.misc[i * 4 + 2] = scale;
    this.misc[i * 4 + 3] = variant;
  }
  /** Fast path used every frame: position/yaw and animation only. */
  setMotion(i: number, x: number, y: number, z: number, yaw: number, state: number, stateStart: number, speed: number) {
    const p = this.pos;
    const a = this.anim;
    p[i * 4] = x;
    p[i * 4 + 1] = y;
    p[i * 4 + 2] = z;
    p[i * 4 + 3] = yaw;
    a[i * 4] = state;
    a[i * 4 + 1] = stateStart;
    a[i * 4 + 2] = speed;
  }
  commit(all = true) {
    this.geo.instanceCount = this.count;
    this.attrs[0].needsUpdate = true;
    this.attrs[1].needsUpdate = true;
    if (all) for (let k = 2; k < 5; k++) this.attrs[k].needsUpdate = true;
    this.mesh.visible = this.count > 0;
  }
  dispose() {
    this.geo.dispose();
  }
}
