import * as THREE from 'three';

/** Shared GLSL: analytic sky radiance used by the sky dome and water reflections. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uSunset;
uniform float uOvercast;
uniform vec3 uFogTint;

vec3 skyBase(vec3 d) {
  float sunH = uSunDir.y;
  float up = clamp(d.y, 0.0, 1.0);
  vec3 zenithDay = vec3(0.10, 0.28, 0.62);
  vec3 horizonDay = vec3(0.58, 0.70, 0.84);
  vec3 zenithSet = vec3(0.12, 0.16, 0.36);
  vec3 horizonSet = vec3(1.0, 0.46, 0.18);
  vec3 zenithNight = vec3(0.010, 0.018, 0.045);
  vec3 horizonNight = vec3(0.035, 0.055, 0.11);
  float day = smoothstep(-0.08, 0.3, sunH);
  vec2 dh = normalize(d.xz + 1e-5);
  vec2 sh = normalize(uSunDir.xz + 1e-5);
  float sunward = pow(max(dot(dh, sh), 0.0), 2.5);
  vec3 zenith = mix(zenithSet, zenithDay, day);
  vec3 horizon = mix(horizonDay, mix(vec3(0.62, 0.5, 0.52), horizonSet, sunward), uSunset);
  zenith = mix(zenith, zenithNight, uNight);
  horizon = mix(horizon, horizonNight, uNight);
  float t = pow(1.0 - up, 3.5);
  vec3 col = mix(zenith, horizon, t);
  // overcast desaturates
  vec3 grey = vec3(dot(col, vec3(0.3, 0.55, 0.15)));
  col = mix(col, grey * vec3(0.9, 0.95, 1.0) * (1.0 - uNight * 0.7), uOvercast * 0.75);
  // sun / mie glow
  float cs = max(dot(d, uSunDir), 0.0);
  float glow = pow(cs, 6.0) * 0.28 + pow(cs, 48.0) * 0.55;
  col += uSunColor * glow * (1.0 - uNight) * (1.0 - uOvercast * 0.6);
  // moon glow
  float cm = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.35, 0.42, 0.6) * pow(cm, 24.0) * 0.25 * uNight;
  // below-horizon fade toward haze
  col = mix(col, uFogTint, smoothstep(0.02, -0.25, d.y));
  return col;
}
`;

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const skyFrag = /* glsl */ `
${SKY_GLSL}
uniform float uTime;
uniform float uCloudCover;
uniform sampler2D uNoise;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float cloudNoise(vec2 p) {
  float n = texture2D(uNoise, p).r * 0.55 + texture2D(uNoise, p * 2.3 + 0.37).g * 0.3 + texture2D(uNoise, p * 5.1 - 0.21).b * 0.15;
  return n;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);
  // sun disc
  float cs = dot(d, uSunDir);
  float disc = smoothstep(0.99955, 0.99975, cs);
  col += uSunColor * disc * 18.0 * (1.0 - uNight) * (1.0 - uOvercast);
  // stars
  if (uNight > 0.01 && d.y > 0.0) {
    vec3 sp = floor(d * 380.0);
    float h = hash13(sp);
    float star = step(0.9975, h) * (0.5 + 0.5 * sin(uTime * (2.0 + h * 5.0) + h * 40.0));
    col += vec3(0.85, 0.9, 1.0) * star * uNight * (1.0 - uOvercast) * smoothstep(0.0, 0.15, d.y) * 1.6;
  }
  // moon disc
  float cm = dot(d, uMoonDir);
  float moon = smoothstep(0.9991, 0.9994, cm);
  col = mix(col, vec3(0.85, 0.88, 0.95) * 1.4, moon * uNight * (1.0 - uOvercast * 0.8));
  // clouds on a virtual plane
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.08) * 0.35;
    vec2 wind = vec2(uTime * 0.0035, uTime * 0.0012);
    float n = cloudNoise(cp * 0.55 + wind);
    float cover = mix(0.62, 0.28, uCloudCover);
    float c = smoothstep(cover, cover + 0.22, n);
    float thick = smoothstep(cover, cover + 0.5, n);
    float fade = smoothstep(0.0, 0.12, d.y);
    vec3 lit = mix(vec3(1.0), uSunColor * 1.2 + vec3(0.25), 0.55 * (1.0 - uNight));
    vec3 cloudCol = mix(lit, vec3(0.42, 0.44, 0.5), thick * 0.7);
    cloudCol = mix(cloudCol, vec3(0.05, 0.06, 0.09), uNight * 0.85);
    // sunset rim lighting
    float toward = pow(max(dot(normalize(d.xz), normalize(uSunDir.xz + 1e-4)), 0.0), 3.0);
    cloudCol += uSunColor * vec3(1.0, 0.55, 0.3) * uSunset * toward * (1.0 - thick) * 0.9;
    cloudCol *= mix(1.0, 0.55, uOvercast);
    col = mix(col, cloudCol, c * fade * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSkyUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(0.3, 0.5, 0.2).normalize() },
    uMoonDir: { value: new THREE.Vector3(-0.3, 0.5, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
    uNight: { value: 0 },
    uSunset: { value: 0 },
    uOvercast: { value: 0 },
    uFogTint: { value: new THREE.Color(0.6, 0.65, 0.7) },
  };
}
export type SkyUniforms = ReturnType<typeof makeSkyUniforms>;

export class SkyDome {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  constructor(shared: SkyUniforms, noise: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uTime: { value: 0 }, uCloudCover: { value: 0.35 }, uNoise: { value: noise } },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }
  update(camera: THREE.PerspectiveCamera, time: number, cloudCover: number) {
    this.mesh.position.copy(camera.position);
    const s = camera.far * 0.9;
    this.mesh.scale.setScalar(s);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uCloudCover.value = cloudCover;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
