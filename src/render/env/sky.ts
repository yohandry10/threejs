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
  float up = clamp(d.y, 0.0, 1.0);
  vec2 dh = normalize(d.xz + 1e-5);
  vec2 sh = normalize(uSunDir.xz + 1e-5);
  float az = dot(dh, sh) * 0.5 + 0.5; // 0 facing away from the sun, 1 toward it
  // day
  vec3 zenD = vec3(0.055, 0.19, 0.5);
  vec3 horD = vec3(0.5, 0.66, 0.85);
  vec3 colD = mix(zenD, horD, pow(1.0 - up, 3.2));
  // sunset: deep blue-violet zenith, purple middle, burning orange horizon toward the sun
  vec3 zenS = vec3(0.03, 0.12, 0.3);
  vec3 midS = mix(vec3(0.16, 0.3, 0.48), vec3(0.95, 0.45, 0.2), pow(az, 2.6));
  vec3 horS = mix(vec3(0.5, 0.36, 0.44), vec3(1.0, 0.52, 0.14), pow(az, 1.8));
  vec3 colS = mix(zenS, midS, pow(1.0 - up, 2.4));
  colS = mix(colS, horS, pow(1.0 - up, 8.0));
  vec3 col = mix(colD, colS, clamp(uSunset, 0.0, 1.0));
  // night
  vec3 colN = mix(vec3(0.006, 0.012, 0.035), vec3(0.03, 0.045, 0.09), pow(1.0 - up, 3.0));
  col = mix(col, colN, uNight);
  // overcast desaturates and flattens
  vec3 grey = vec3(dot(col, vec3(0.3, 0.55, 0.15)));
  col = mix(col, grey * vec3(0.92, 0.96, 1.0) * (1.0 - uNight * 0.7) * 1.1, uOvercast * 0.78);
  // sun glow (mie)
  float c = max(dot(d, uSunDir), 0.0);
  float glow = pow(c, 4.0) * 0.1 + pow(c, 24.0) * 0.32 + pow(c, 160.0) * 0.9;
  col += uSunColor * glow * (1.0 - uNight) * (1.0 - uOvercast * 0.7);
  // a warm band hugging the horizon under the setting sun
  col += vec3(1.0, 0.4, 0.1) * clamp(uSunset, 0.0, 1.0) * pow(az, 4.0) * exp(-up * 16.0) * 0.7 * (1.0 - uOvercast);
  // moon glow
  float cm = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.35, 0.42, 0.6) * pow(cm, 24.0) * 0.25 * uNight;
  // below-horizon haze
  col = mix(col, uFogTint, smoothstep(0.02, -0.2, d.y));
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
float fbmT(vec2 p) {
  return texture2D(uNoise, p).r * 0.5 + texture2D(uNoise, p * 2.03 + 0.17).g * 0.27 + texture2D(uNoise, p * 4.11 - 0.31).b * 0.15 + texture2D(uNoise, p * 8.3 + 0.07).a * 0.08;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);
  float cs = dot(d, uSunDir);
  float day = 1.0 - uNight;
  // sun disc with a hot core and soft limb (bloom does the rest)
  float disc = smoothstep(0.99915, 0.99958, cs);
  float halo = pow(max(cs, 0.0), 900.0);
  vec3 sunTint = mix(vec3(1.0, 0.92, 0.75), vec3(1.0, 0.62, 0.3), clamp(uSunset, 0.0, 1.0));
  col += sunTint * uSunColor * (disc * 4.0 + halo * 1.2) * day * (1.0 - uOvercast);
  // stars
  if (uNight > 0.01 && d.y > 0.0) {
    vec3 sp = floor(d * 380.0);
    float h = hash13(sp);
    float star = step(0.9975, h) * (0.5 + 0.5 * sin(uTime * (2.0 + h * 5.0) + h * 40.0));
    col += vec3(0.85, 0.9, 1.0) * star * uNight * (1.0 - uOvercast) * smoothstep(0.0, 0.15, d.y) * 1.6;
  }
  // moon
  float cm = dot(d, uMoonDir);
  float moon = smoothstep(0.9991, 0.9994, cm);
  col = mix(col, vec3(0.85, 0.88, 0.95) * 1.4, moon * uNight * (1.0 - uOvercast * 0.8));
  if (d.y > -0.01) {
    float up = max(d.y, 0.0);
    vec2 sdir = normalize(uSunDir.xz + 1e-4);
    vec2 dh = normalize(d.xz + 1e-5);
    float az = dot(dh, sdir) * 0.5 + 0.5;
    float sunset = clamp(uSunset, 0.0, 1.0);
    vec2 cp = d.xz / (up + 0.055);
    vec2 wind = vec2(uTime * 0.0022, uTime * 0.0009);
    float fade = smoothstep(0.0, 0.05, up);
    // --- high cirrus streaks
    vec2 q = cp * 0.011 + wind * 0.6;
    q = vec2(q.x * 0.45 + q.y * 0.15, q.y * 1.7 - q.x * 0.2);
    float ci = smoothstep(0.52, 0.86, texture2D(uNoise, q).r * 0.62 + texture2D(uNoise, q * 3.3 + 0.2).g * 0.38);
    vec3 ciCol = mix(vec3(0.98, 0.98, 1.0), vec3(1.0, 0.6, 0.45) * 1.35, sunset * (0.45 + 0.55 * az));
    ciCol = mix(ciCol, vec3(0.06, 0.07, 0.1), uNight * 0.9);
    col = mix(col, ciCol, ci * 0.42 * fade * (1.0 - uOvercast * 0.5));
    // --- cumulus / stratocumulus layer with self-shadowing
    vec2 p = cp * 0.042 + wind;
    vec2 warp = vec2(texture2D(uNoise, p * 0.6).g, texture2D(uNoise, p * 0.6 + 0.37).b) - 0.5;
    p += warp * 0.22;
    float n = fbmT(p);
    float cover = mix(0.6, 0.33, uCloudCover);
    float dens = smoothstep(cover, cover + 0.26, n);
    if (dens > 0.001) {
      float nS = fbmT(p + sdir * 0.018);
      float nS2 = fbmT(p + sdir * 0.045);
      float shade = clamp((nS - n) * 5.5 + (nS2 - n) * 2.5 + 0.42, 0.0, 1.0);
      vec3 litCol = mix(vec3(1.0, 0.985, 0.96) * 1.05, vec3(1.0, 0.62, 0.38) * 1.35, sunset);
      vec3 shadowCol = mix(vec3(0.55, 0.6, 0.7), vec3(0.34, 0.24, 0.42), sunset);
      vec3 cc = mix(litCol, shadowCol, shade);
      cc *= mix(1.0, 0.82, smoothstep(0.5, 1.0, dens));
      // forward scattering rims around the sun
      cc += uSunColor * pow(max(cs, 0.0), 10.0) * (1.0 - dens * 0.55) * 1.3 * day;
      // low clouds on the horizon glow orange at sunset
      cc = mix(cc, vec3(1.0, 0.44, 0.18) * 1.25, sunset * exp(-up * 7.0) * (0.3 + 0.7 * az) * 0.65 * (1.0 - shade * 0.5));
      // night and overcast
      cc = mix(cc, vec3(0.05, 0.06, 0.085) + vec3(0.1, 0.12, 0.16) * (1.0 - shade), uNight * 0.92);
      cc = mix(cc, vec3(0.62, 0.64, 0.68) * (1.0 - shade * 0.35) * (1.0 - uNight * 0.85), uOvercast * 0.7);
      col = mix(col, cc, dens * fade * 0.97);
    }
    // overcast: a uniform grey deck thickening toward the horizon
    col = mix(col, vec3(0.55, 0.57, 0.62) * (1.0 - uNight * 0.85), uOvercast * 0.35 * fade);
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
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.material);
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
