import * as THREE from 'three';
import { SKY_GLSL, type SkyUniforms } from './sky';
import { waterNormalTexture, noiseTexture } from '../textures';

/** Gerstner wave definitions (direction x,z, steepness, wavelength). */
export const WAVES: [number, number, number, number][] = [
  [1.0, 0.35, 0.11, 78],
  [0.7, 0.9, 0.09, 43],
  [-0.4, 1.0, 0.075, 24],
  [0.95, -0.3, 0.06, 14],
  [-0.8, 0.6, 0.05, 8.3],
  [0.3, -1.0, 0.04, 5.1],
];
const G = 9.8;

/** CPU replica of the ocean vertex displacement for buoyancy. */
export class WaveSampler {
  scale = 1;
  time = 0;
  private dirs = WAVES.map(([x, z]) => {
    const l = Math.hypot(x, z);
    return [x / l, z / l];
  });
  /** Height and normal at world x,z (approximate: evaluates at the undisplaced point). */
  sample(x: number, z: number, out: { h: number; nx: number; nz: number }) {
    let h = 0;
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      const [ddx, ddz] = this.dirs[i];
      const k = (2 * Math.PI) / w[3];
      const c = Math.sqrt(G / k) * 0.55;
      const steep = w[2] * this.scale;
      const a = steep / k;
      const f = k * (ddx * x + ddz * z - c * this.time);
      h += a * Math.sin(f);
      const d = steep * Math.cos(f);
      dx += ddx * d;
      dz += ddz * d;
    }
    out.h = h;
    out.nx = -dx;
    out.nz = -dz;
    return out;
  }
}

const vert = /* glsl */ `
uniform float uTime;
uniform float uWaveScale;
uniform vec4 uWaves[6];
uniform vec3 uCenter;
uniform sampler2D uHeight;
uniform vec2 uWorldSize;
uniform float uHasHeight;
uniform mat4 uReflMatrix;
varying vec4 vReflCoord;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying float vDepth;
#include <fog_pars_vertex>

float terrainAt(vec2 p) {
  if (uHasHeight < 0.5) return -200.0;
  vec2 uv = p / uWorldSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -200.0;
  return texture2D(uHeight, uv).r;
}

void main() {
  vec3 p = position + vec3(uCenter.x, 0.0, uCenter.z);
  float dist = length(position.xz);
  float att = 1.0 - smoothstep(900.0, 5000.0, dist);
  float th = terrainAt(p.xz);
  float depth = -th;
  float shoreAtt = smoothstep(0.0, 10.0, depth);
  float amp = uWaveScale * att * mix(0.25, 1.0, shoreAtt);
  vec3 disp = vec3(0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  float crest = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 w = uWaves[i];
    vec2 d = normalize(w.xy);
    float k = 6.2831853 / w.w;
    float c = sqrt(9.8 / k) * 0.55;
    float steep = w.z * amp;
    float a = steep / k;
    float f = k * (dot(d, p.xz) - c * uTime);
    float sf = sin(f);
    float cf = cos(f);
    disp += vec3(d.x * a * cf, a * sf, d.y * a * cf);
    tangent += vec3(-d.x * d.x * steep * sf, d.x * steep * cf, -d.x * d.y * steep * sf);
    binormal += vec3(-d.x * d.y * steep * sf, d.y * steep * cf, -d.y * d.y * steep * sf);
    crest += steep * sf;
  }
  p += disp;
  vWorld = p;
  vReflCoord = uReflMatrix * vec4(p.x, 0.0, p.z, 1.0);
  vNormalW = normalize(cross(binormal, tangent));
  vCrest = crest;
  vDepth = depth;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
${SKY_GLSL}
uniform float uTime;
uniform float uWaveScale;
uniform sampler2D uNormalTex;
uniform sampler2D uNoise;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform float uFoamAmount;
uniform float uLightning;
uniform sampler2D tFogW;
uniform float uFogW;
uniform vec2 uWorldSizeF;
uniform sampler2D tReflect;
uniform float uUseRefl;
varying vec4 vReflCoord;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying float vDepth;
#include <fog_pars_fragment>

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  vec2 uv1 = vWorld.xz * 0.021 + vec2(uTime * 0.012, uTime * 0.007);
  vec2 uv2 = vWorld.xz * 0.0071 - vec2(uTime * 0.005, -uTime * 0.009);
  vec2 uv3 = vWorld.xz * 0.075 + vec2(-uTime * 0.02, uTime * 0.015);
  vec3 n1 = texture2D(uNormalTex, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalTex, uv2).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(uNormalTex, uv3).xyz * 2.0 - 1.0;
  float detailFade = 1.0 - smoothstep(200.0, 3500.0, dist);
  vec2 pert = (n1.xy * 0.5 + n2.xy * 0.6 + n3.xy * 0.3 * (1.0 - smoothstep(20.0, 300.0, dist))) * (0.12 + 0.1 * uWaveScale) * detailFade;
  vec3 N = normalize(vNormalW + vec3(pert.x, 0.0, pert.y));
  float NdV = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  fresnel = mix(fresnel, 0.55, smoothstep(2000.0, 12000.0, dist) * 0.5) * 0.85;
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyBase(R);
  // body colour
  float depth = vDepth;
  vec3 deep = vec3(0.008, 0.04, 0.07);
  vec3 mid = vec3(0.02, 0.13, 0.16);
  vec3 shallow = vec3(0.07, 0.30, 0.30);
  vec3 body = mix(shallow, mid, smoothstep(0.5, 8.0, depth));
  body = mix(body, deep, smoothstep(8.0, 60.0, depth));
  float light = max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0);
  vec3 lit = body * (uAmbient * 0.9 + uLightColor * (0.35 + 0.65 * light) * 0.6);
  // subsurface scattering on crests facing away from the sun
  float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 4.0) * clamp(vCrest * 1.4 + 0.3, 0.0, 1.0);
  lit += vec3(0.05, 0.28, 0.24) * sss * uLightColor * 0.5 * (1.0 - uNight);
  vec3 col = mix(lit, refl, fresnel);
  // planar reflection of ships and nearby objects, rippled by the surface normal
  if (uUseRefl > 0.5) {
    vec2 rip = (N.xz - vNormalW.xz * 0.6) * 0.11 + pert * 0.35;
    vec2 ruv = vReflCoord.xy / vReflCoord.w + rip * (1.0 - smoothstep(80.0, 900.0, dist));
    vec4 rc = texture2D(tReflect, ruv);
    // reflections are darker and break up on the rougher facets
    float k = rc.a * clamp(0.14 + fresnel * 0.75, 0.0, 0.7);
    col = mix(col, rc.rgb * 0.82, k);
  }
  // sun specular (long glitter path at sunset)
  vec3 L = normalize(uSunDir + vec3(0.0, 0.02, 0.0));
  float spec = pow(max(dot(R, L), 0.0), 1400.0) * 7.0 + pow(max(dot(R, L), 0.0), 160.0) * 0.18;
  spec *= smoothstep(-0.05, 0.05, uSunDir.y) * (1.0 - uOvercast * 0.85);
  col += uSunColor * spec;
  vec3 Lm = normalize(uMoonDir);
  col += vec3(0.6, 0.7, 0.9) * pow(max(dot(R, Lm), 0.0), 400.0) * 2.0 * uNight;
  // foam: whitecaps + shoreline
  float n = texture2D(uNoise, vWorld.xz * 0.03 + uTime * 0.01).r;
  float n2f = texture2D(uNoise, vWorld.xz * 0.11 - uTime * 0.02).g;
  float whitecap = smoothstep(0.75, 1.05, vCrest * (0.6 + uWaveScale * 0.4) + n * 0.3) * smoothstep(0.9, 1.6, uWaveScale + n * 0.5) * uFoamAmount * (1.0 - smoothstep(600.0, 3000.0, dist));
  float shore = 1.0 - smoothstep(0.0, 3.2, depth);
  float bands = smoothstep(0.35, 0.75, sin(depth * 2.8 - uTime * 1.6 + n * 6.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.0, 4.5, depth));
  float foam = clamp(max(whitecap, shore * 0.85 * (0.55 + 0.45 * n2f) + bands * 0.45 * n2f), 0.0, 1.0);
  vec3 foamCol = vec3(0.92, 0.95, 0.96) * (uAmbient + uLightColor * 0.6) * 0.8;
  col = mix(col, foamCol, foam * (1.0 - uNight * 0.5));
  col += vec3(0.6, 0.65, 0.8) * uLightning * 0.35;
  float seaMask = 1.0;
  if (uFogW > 0.5) {
    vec2 fuv = vWorld.xz / uWorldSizeF;
    bool outside = fuv.x < 0.0 || fuv.y < 0.0 || fuv.x > 1.0 || fuv.y > 1.0;
    vec3 fs = outside ? vec3(0.0, 0.0, 1.0) : texture2D(tFogW, fuv).rgb;
    vec2 fg = fs.rg;
    seaMask = smoothstep(0.25, 0.6, fs.b);
    col = mix(col, vec3(dot(col, vec3(0.33))) * 0.65, (1.0 - fg.g) * 0.5);
    col = mix(col, vec3(0.055, 0.065, 0.075) * (0.8 + 0.4 * n), (1.0 - fg.r) * 0.9);
  }
  float alpha = mix(0.0, 1.0, smoothstep(-0.2, 1.6, depth));
  alpha = max(alpha, foam * smoothstep(-0.3, 0.4, depth));
  alpha *= seaMask;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function radialGrid(rings: number, segments: number, r0: number, growth: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  let r = r0;
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    r = r * growth + r0 * 0.5;
  }
  for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segments;
    const b0 = 1 + (i + 1) * segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx.push(a0 + s, a0 + s1, b0 + s);
      idx.push(a0 + s1, b0 + s1, b0 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

/** Objects on this layer are mirrored in the water. */
export const REFLECT_LAYER = 1;

const _plane = new THREE.Plane();
const _normal = new THREE.Vector3(0, 1, 0);
const _rwp = new THREE.Vector3();
const _cwp = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _look = new THREE.Vector3();
const _clip = new THREE.Vector4();
const _view = new THREE.Vector3();
const _target = new THREE.Vector3();
const _q = new THREE.Vector4();
const _cc = new THREE.Color();
const _size = new THREE.Vector2();

/** Planar reflection of the REFLECT_LAYER objects about the sea plane (oblique near-plane clipping). */
export class OceanReflection {
  rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  camera = new THREE.PerspectiveCamera();
  textureMatrix = new THREE.Matrix4();
  level = 0.2;
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(4, Math.floor(_size.x * 0.5));
    const h = Math.max(4, Math.floor(_size.y * 0.5));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    _rwp.set(0, this.level, 0);
    _cwp.setFromMatrixPosition(camera.matrixWorld);
    _view.subVectors(_rwp, _cwp);
    if (_view.dot(_normal) > 0) return false;
    _view.reflect(_normal).negate().add(_rwp);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cwp);
    _target.subVectors(_rwp, _look).reflect(_normal).negate().add(_rwp);
    const vc = this.camera;
    vc.position.copy(_view);
    vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_normal);
    vc.lookAt(_target);
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy((camera as THREE.PerspectiveCamera).projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    _plane.setFromNormalAndCoplanarPoint(_normal, _rwp).applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = vc.projectionMatrix;
    _q.x = (Math.sign(_clip.x) + pm.elements[8]) / pm.elements[0];
    _q.y = (Math.sign(_clip.y) + pm.elements[9]) / pm.elements[5];
    _q.z = -1.0;
    _q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    _clip.multiplyScalar(2.0 / _clip.dot(_q));
    pm.elements[2] = _clip.x;
    pm.elements[6] = _clip.y;
    pm.elements[10] = _clip.z + 1.0;
    pm.elements[14] = _clip.w;
    vc.projectionMatrixInverse.copy(pm).invert();
    vc.layers.set(REFLECT_LAYER);
    const prevRT = renderer.getRenderTarget();
    const prevShadows = renderer.shadowMap.enabled;
    renderer.getClearColor(_cc);
    const prevAlpha = renderer.getClearAlpha();
    const prevBg = scene.background;
    // reflections don't need shadows (and must not touch the shadow maps of the main pass)
    renderer.shadowMap.enabled = false;
    scene.background = null;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(_cc, prevAlpha);
    renderer.shadowMap.enabled = prevShadows;
    scene.background = prevBg;
    return true;
  }
  dispose() {
    this.rt.dispose();
  }
}

export class Ocean {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  sampler = new WaveSampler();
  constructor(sky: SkyUniforms, heightTex: THREE.Texture | null, worldSize: THREE.Vector2, quality = 1) {
    const rings = quality >= 1 ? 170 : 120;
    const segs = quality >= 1 ? 220 : 150;
    const geo = radialGrid(rings, segs, 1.6, 1.047);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uWaveScale: { value: 1 },
          uWaves: { value: WAVES.map((w) => new THREE.Vector4(...w)) },
          uCenter: { value: new THREE.Vector3() },
          uHeight: { value: heightTex },
          uHasHeight: { value: heightTex ? 1 : 0 },
          uWorldSize: { value: worldSize },
          uNormalTex: { value: waterNormalTexture() },
          uNoise: { value: noiseTexture() },
          uLightColor: { value: new THREE.Color(1, 1, 1) },
          uAmbient: { value: new THREE.Color(0.4, 0.45, 0.5) },
          uFoamAmount: { value: 1 },
          uLightning: { value: 0 },
          tFogW: { value: null },
          uFogW: { value: 0 },
          uWorldSizeF: { value: new THREE.Vector2(1, 1) },
          tReflect: { value: null },
          uReflMatrix: { value: new THREE.Matrix4() },
          uUseRefl: { value: 0 },
        },
      ]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      fog: true,
      depthWrite: true,
    });
    // share sky uniforms by reference
    Object.assign(this.material.uniforms, sky);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  reflection: OceanReflection | null = null;
  /** Turn on planar reflections (ships etc. on REFLECT_LAYER) for this ocean in the given scene. */
  enableReflection(scene: THREE.Scene) {
    if (!this.reflection) this.reflection = new OceanReflection();
    this.material.uniforms.tReflect.value = this.reflection.rt.texture;
    scene.userData.ocean = this;
  }
  /** Called by the renderer before the main pass. */
  renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.reflection) return;
    const ok = this.reflection.render(renderer, scene, camera);
    this.material.uniforms.uUseRefl.value = ok ? 1 : 0;
    this.material.uniforms.uReflMatrix.value.copy(this.reflection.textureMatrix);
  }
  update(time: number, camera: THREE.Camera, waveScale: number, sunColor: THREE.Color, sunI: number, ambient: THREE.Color, lightning: number) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uWaveScale.value = waveScale;
    this.sampler.time = time;
    this.sampler.scale = waveScale;
    const snap = 8;
    u.uCenter.value.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
    u.uLightColor.value.copy(sunColor).multiplyScalar(Math.min(1.4, sunI / 2.4));
    u.uAmbient.value.copy(ambient);
    u.uLightning.value = lightning;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.reflection?.dispose();
  }
}
