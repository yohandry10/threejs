import * as THREE from 'three';
import type { WorldGeo } from '../../sim/world/geo';
import type { WorldTextures } from './worldTextures';
import { noiseTexture } from '../textures';

export function makeTerrainUniforms(tex: WorldTextures, g: WorldGeo) {
  return {
    tMatA: { value: tex.matA },
    tMatB: { value: tex.matB },
    tMatC: { value: tex.matC },
    tProvId: { value: tex.provId },
    tProvColor: { value: tex.provColor },
    tProvColorPrev: { value: tex.provColorPrev },
    tProvOwner: { value: tex.provOwner },
    tFog: { value: tex.fog },
    tRange: { value: tex.range },
    tNoise: { value: noiseTexture() },
    uWorldSize: { value: new THREE.Vector2(g.W, g.H) },
    uModeMix: { value: 1 },
    uBorderWidth: { value: 6 },
    uBorderAlpha: { value: 1 },
    uProvBorder: { value: 0.35 },
    uWinter: { value: 0 },
    uAutumn: { value: 0 },
    uSpring: { value: 0 },
    uSelProv: { value: 0 },
    uHoverProv: { value: 0 },
    uTime: { value: 0 },
    uFogEnabled: { value: 1 },
    uRangeAlpha: { value: 0 },
    uLamp: { value: 0 },
  };
}
export type TerrainUniforms = ReturnType<typeof makeTerrainUniforms>;

const TERRAIN_FUNCS = /* glsl */ `
uniform sampler2D tMatA;
uniform sampler2D tMatB;
uniform sampler2D tMatC;
uniform sampler2D tProvId;
uniform sampler2D tProvColor;
uniform sampler2D tProvColorPrev;
uniform sampler2D tProvOwner;
uniform sampler2D tFog;
uniform sampler2D tRange;
uniform sampler2D tNoise;
uniform vec2 uWorldSize;
uniform float uModeMix;
uniform float uBorderWidth;
uniform float uBorderAlpha;
uniform float uProvBorder;
uniform float uWinter;
uniform float uAutumn;
uniform float uSpring;
uniform float uSelProv;
uniform float uHoverProv;
uniform float uTime;
uniform float uFogEnabled;
uniform float uRangeAlpha;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float thash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float provAt(vec2 wp) {
  return floor(texture2D(tProvId, wp / uWorldSize).r * 255.0 + 0.5);
}
vec4 ownerOf(float id) { return texture2D(tProvOwner, vec2((id + 0.5) / 256.0, 0.5)); }

vec3 fieldColor(vec2 p, float n) {
  vec2 region = floor(p / 260.0);
  float ang = thash(region + 7.3) * 3.14159;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = mat2(ca, -sa, sa, ca) * (p - region * 260.0) / vec2(52.0, 31.0) + region * 17.0;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float h = thash(cell);
  vec3 wheat = mix(vec3(0.62, 0.52, 0.22), vec3(0.72, 0.6, 0.28), n);
  vec3 green = vec3(0.26, 0.38, 0.12);
  vec3 plough = vec3(0.34, 0.25, 0.16);
  vec3 pale = vec3(0.45, 0.5, 0.22);
  vec3 c = h < 0.32 ? wheat : h < 0.55 ? green : h < 0.75 ? plough : pale;
  // seasons: spring green, summer mixed, autumn golden stubble, winter bare
  c = mix(c, vec3(0.3, 0.42, 0.15), uSpring * 0.55 * step(0.3, h));
  c = mix(c, mix(vec3(0.6, 0.48, 0.24), plough, step(0.55, h)), uAutumn * 0.6);
  c = mix(c, vec3(0.36, 0.3, 0.22), uWinter * 0.7);
  float fur = sin(f.x * 6.2831 * (7.0 + floor(h * 5.0))) * 0.5 + 0.5;
  c *= 0.86 + 0.14 * fur;
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  c = mix(vec3(0.16, 0.22, 0.09), c, smoothstep(0.0, 0.035, edge));
  return c;
}

vec3 terrainAlbedo(vec3 wp, vec3 nw, out float rough, out float snowOut) {
  vec2 uv = wp.xz / uWorldSize;
  vec4 a = texture2D(tMatA, uv);
  vec4 b = texture2D(tMatB, uv);
  vec4 c3 = texture2D(tMatC, uv);
  float n1 = texture2D(tNoise, wp.xz * 0.0021).r;
  float n2 = texture2D(tNoise, wp.xz * 0.013).g;
  float n3 = texture2D(tNoise, wp.xz * 0.061).b;
  float n4 = texture2D(tNoise, wp.xz * 0.19).a;
  float slope = 1.0 - clamp(nw.y, 0.0, 1.0);
  // palette
  vec3 grass = mix(vec3(0.19, 0.3, 0.09), vec3(0.33, 0.41, 0.15), n1 * 0.7 + n3 * 0.3);
  // meadow patches: dry grass, darker lush clumps, bare earth
  grass = mix(grass, vec3(0.42, 0.42, 0.2), smoothstep(0.55, 0.8, n2) * 0.55);
  grass = mix(grass, vec3(0.13, 0.22, 0.07), smoothstep(0.62, 0.85, n3) * 0.5);
  grass = mix(grass, vec3(0.36, 0.3, 0.2), smoothstep(0.72, 0.9, n4 * n2 * 1.6) * 0.5);
  grass = mix(grass, vec3(0.5, 0.4, 0.16), uAutumn * 0.45);
  grass = mix(grass, vec3(0.34, 0.33, 0.24), uWinter * 0.5);
  grass = mix(grass, vec3(0.22, 0.36, 0.1), uSpring * 0.3);
  vec3 dry = mix(vec3(0.55, 0.47, 0.26), vec3(0.64, 0.56, 0.33), n2);
  vec3 rock = mix(vec3(0.33, 0.31, 0.28), vec3(0.5, 0.47, 0.42), n2);
  rock *= 0.92 + 0.1 * sin(wp.y * 0.22 + n1 * 9.0 + n3 * 3.0);
  vec3 sand = mix(vec3(0.7, 0.62, 0.45), vec3(0.8, 0.72, 0.54), n3);
  vec3 snow = vec3(0.9, 0.92, 0.96);
  vec3 farm = fieldColor(wp.xz, n3);
  vec3 forest = mix(vec3(0.08, 0.14, 0.06), vec3(0.14, 0.19, 0.08), n2);
  forest = mix(forest, vec3(0.28, 0.17, 0.07), uAutumn * 0.4);
  vec3 tundra = mix(vec3(0.36, 0.38, 0.3), vec3(0.45, 0.44, 0.35), n2);
  vec3 ground = mix(vec3(0.42, 0.36, 0.28), vec3(0.5, 0.46, 0.4), n4);
  vec3 mud = vec3(0.28, 0.24, 0.17);
  vec3 ash = mix(vec3(0.16, 0.14, 0.13), vec3(0.24, 0.21, 0.19), n2);
  float wRock = a.b + smoothstep(0.45, 0.8, slope) * 1.5;
  float wSnow = b.r;
  // seasonal snow cover: winter blankets the north and uplands
  float northness = 1.0 - smoothstep(0.15, 0.55, uv.y);
  float snowLine = mix(160.0, 40.0, northness);
  float winterSnow = uWinter * smoothstep(snowLine - 30.0, snowLine + 30.0, wp.y + n1 * 40.0) * (1.0 - smoothstep(0.55, 0.9, slope));
  wSnow = max(wSnow, winterSnow);
  vec4 w1 = vec4(a.r, a.g, wRock, a.a);
  vec4 w2 = vec4(wSnow, b.g, b.b, b.a);
  vec3 w3 = vec3(c3.r * 1.2, c3.g * 0.8, c3.b);
  float tot = dot(w1, vec4(1.0)) + dot(w2, vec4(1.0)) + dot(w3, vec3(1.0)) + 1e-4;
  vec3 col = (grass * w1.x + dry * w1.y + rock * w1.z + sand * w1.w + snow * w2.x + farm * w2.y + forest * w2.z + tundra * w2.w + ground * w3.x + mud * w3.y + ash * w3.z) / tot;
  // wet shoreline / sea floor
  float wet = 1.0 - smoothstep(0.2, 2.2, wp.y);
  col *= 1.0 - wet * 0.35;
  if (wp.y < 0.0) {
    float depth = -wp.y;
    col = mix(col, vec3(0.1, 0.2, 0.2), smoothstep(0.0, 12.0, depth));
  }
  col *= 0.88 + 0.24 * n4;
  rough = mix(0.95, 0.72, w2.x / tot) * (1.0 - wet * 0.35);
  snowOut = w2.x / tot;
  return col;
}
`;

export function makeTerrainMaterial(u: TerrainUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_FUNCS)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float tRough; float tSnow;
        vec3 albedo = terrainAlbedo(vWorldPos, normalize(vWorldNormal), tRough, tSnow);
        // map-mode tint
        float pid = provAt(vWorldPos.xz);
        vec4 mcNew = texture2D(tProvColor, vec2((pid + 0.5) / 256.0, 0.5));
        vec4 mcOld = texture2D(tProvColorPrev, vec2((pid + 0.5) / 256.0, 0.5));
        vec4 mc = mix(mcOld, mcNew, uModeMix);
        float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
        albedo = mix(albedo, mc.rgb * (0.55 + 0.9 * lum), mc.a);
        if (pid > 0.5 && abs(pid - uSelProv) < 0.5) albedo = mix(albedo, albedo * 1.35 + vec3(0.04, 0.035, 0.02), 0.6);
        else if (pid > 0.5 && abs(pid - uHoverProv) < 0.5) albedo *= 1.12;
        diffuseColor.rgb = albedo;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 e = vec2(1.5, 0.0);
          float h0 = texture2D(tNoise, vWorldPos.xz * 0.045).a;
          float hx = texture2D(tNoise, (vWorldPos.xz + e.xy) * 0.045).a;
          float hz = texture2D(tNoise, (vWorldPos.xz + e.yx) * 0.045).a;
          vec3 bumpW = vec3(h0 - hx, 0.0, h0 - hz) * 1.6 * (1.0 - tSnow * 0.6);
          normal = normalize(normal + (viewMatrix * vec4(bumpW, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          vec2 wuv = vWorldPos.xz / uWorldSize;
          float pidC = provAt(vWorldPos.xz);
          vec4 own = ownerOf(pidC);
          // borders: realm (owner change) and province lines
          float bw = uBorderWidth;
          float realm = 0.0; float prov = 0.0;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.7853982;
            vec2 o = vec2(cos(a), sin(a)) * bw;
            float q = provAt(vWorldPos.xz + o);
            if (q > 0.5 && pidC > 0.5 && q != pidC) {
              prov = 1.0;
              if (abs(ownerOf(q).a - own.a) > 0.001) realm = 1.0;
            }
          }
          float realmOuter = 0.0;
          if (realm < 0.5 && pidC > 0.5) {
            for (int i = 0; i < 8; i++) {
              float a = float(i) * 0.7853982 + 0.39;
              vec2 o = vec2(cos(a), sin(a)) * bw * 1.9;
              float q = provAt(vWorldPos.xz + o);
              if (q > 0.5 && abs(ownerOf(q).a - own.a) > 0.001) realmOuter = 1.0;
            }
          }
          vec3 lineCol = own.rgb * 1.25 + vec3(0.08);
          outgoingLight = mix(outgoingLight, lineCol * (0.55 + 0.45 * max(dot(outgoingLight, vec3(0.33)), 0.25)) + lineCol * 0.18, realm * 0.85 * uBorderAlpha);
          outgoingLight = mix(outgoingLight, outgoingLight * 0.6, realmOuter * 0.5 * uBorderAlpha);
          outgoingLight = mix(outgoingLight, outgoingLight * 0.55, prov * (1.0 - realm) * uProvBorder);
          if (pidC > 0.5 && abs(pidC - uSelProv) < 0.5 && prov > 0.5) outgoingLight = mix(outgoingLight, vec3(1.0, 0.86, 0.45), 0.8);
          // movement range
          float rg = texture2D(tRange, wuv).r;
          float edge = 1.0 - abs(rg - 0.5) * 2.0;
          outgoingLight = mix(outgoingLight, outgoingLight * 1.18 + vec3(0.05, 0.045, 0.02), step(0.5, rg) * 0.45 * uRangeAlpha);
          outgoingLight = mix(outgoingLight, vec3(0.95, 0.82, 0.42), smoothstep(0.35, 0.95, edge) * 0.75 * uRangeAlpha);
          // fog of war
          if (uFogEnabled > 0.5) {
            vec2 fg = texture2D(tFog, wuv).rg;
            float hidden = 1.0 - fg.g;
            float unexplored = 1.0 - fg.r;
            vec3 grey = vec3(dot(outgoingLight, vec3(0.3, 0.59, 0.11)));
            outgoingLight = mix(outgoingLight, grey * 0.62 + vec3(0.015, 0.013, 0.01), hidden * 0.6);
            float pn = texture2D(tNoise, vWorldPos.xz * 0.004).r;
            vec3 parchment = vec3(0.16, 0.145, 0.12) * (0.7 + 0.5 * pn) * (0.35 + 0.65 * smoothstep(-5.0, 60.0, vWorldPos.y));
            outgoingLight = mix(outgoingLight, parchment, unexplored * 0.94);
          }
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'terrain-v1';
  return m;
}

export class Terrain {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  chunks: THREE.Mesh[] = [];
  constructor(
    public geo: WorldGeo,
    public uniforms: TerrainUniforms,
  ) {
    this.material = makeTerrainMaterial(uniforms);
    const CX = 12;
    const CZ = 8;
    const W = geo.hmW;
    const H = geo.hmH;
    const step = geo.hmStep;
    const cw = Math.ceil((W - 1) / CX);
    const chh = Math.ceil((H - 1) / CZ);
    const hAt = (x: number, z: number) => geo.height[Math.min(H - 1, Math.max(0, z)) * W + Math.min(W - 1, Math.max(0, x))];
    for (let cz = 0; cz < CZ; cz++)
      for (let cx = 0; cx < CX; cx++) {
        const x0 = cx * cw;
        const z0 = cz * chh;
        const x1 = Math.min(W - 1, x0 + cw);
        const z1 = Math.min(H - 1, z0 + chh);
        const nx = x1 - x0 + 1;
        const nz = z1 - z0 + 1;
        const pos = new Float32Array(nx * nz * 3);
        const nrm = new Float32Array(nx * nz * 3);
        let minY = 1e9;
        let maxY = -1e9;
        for (let z = 0; z < nz; z++)
          for (let x = 0; x < nx; x++) {
            const gx = x0 + x;
            const gz = z0 + z;
            const i = (z * nx + x) * 3;
            const h = hAt(gx, gz);
            pos[i] = gx * step;
            pos[i + 1] = h;
            pos[i + 2] = gz * step;
            minY = Math.min(minY, h);
            maxY = Math.max(maxY, h);
            const dx = hAt(gx - 1, gz) - hAt(gx + 1, gz);
            const dz = hAt(gx, gz - 1) - hAt(gx, gz + 1);
            const l = Math.hypot(dx, 2 * step, dz);
            nrm[i] = dx / l;
            nrm[i + 1] = (2 * step) / l;
            nrm[i + 2] = dz / l;
          }
        const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
        let k = 0;
        for (let z = 0; z < nz - 1; z++)
          for (let x = 0; x < nx - 1; x++) {
            const a = z * nx + x;
            const b = a + 1;
            const c = a + nx;
            const d = c + 1;
            idx[k++] = a;
            idx[k++] = c;
            idx[k++] = b;
            idx[k++] = b;
            idx[k++] = c;
            idx[k++] = d;
          }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.boundingBox = new THREE.Box3(new THREE.Vector3(x0 * step, minY, z0 * step), new THREE.Vector3(x1 * step, maxY, z1 * step));
        g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
        const mesh = new THREE.Mesh(g, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        this.chunks.push(mesh);
        this.group.add(mesh);
      }
  }
  dispose() {
    for (const c of this.chunks) c.geometry.dispose();
    this.material.dispose();
  }
}
