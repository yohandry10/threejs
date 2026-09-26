import * as THREE from 'three';
import { heightAt, type WorldGeo } from '../../sim/world/geo';
import { SKY_GLSL, type SkyUniforms } from '../env/sky';
import { roadTexture, stoneTexture, waterNormalTexture } from '../textures';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const riverFrag = /* glsl */ `
${SKY_GLSL}
uniform float uTime;
uniform sampler2D uNormalTex;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform sampler2D tFog;
uniform vec2 uWorldSize;
uniform vec3 uMistColor;
varying float vFade;
varying vec2 vUv;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec2 flow = vec2(vUv.x * 0.6, vUv.y * 0.045 - uTime * 0.12);
  vec3 n1 = texture2D(uNormalTex, flow).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalTex, flow * 1.9 + vec2(0.3, -uTime * 0.05)).xyz * 2.0 - 1.0;
  vec3 N = normalize(vec3((n1.x + n2.x) * 0.18, 1.0, (n1.y + n2.y) * 0.18));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = skyBase(R);
  vec3 body = vec3(0.035, 0.1, 0.11) * (uAmbient + uLightColor * 0.5);
  vec3 col = mix(body, refl * 0.7, clamp(fres * 0.7 + 0.08, 0.0, 0.85));
  col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 300.0) * 3.0 * (1.0 - uNight);
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = smoothstep(0.0, 0.16, edge);
  vec2 fg = smoothstep(vec2(0.3), vec2(0.7), texture2D(tFog, vWorld.xz / uWorldSize).rg);
  col = mix(col, vec3(dot(col, vec3(0.33))) * 0.6, (1.0 - fg.g) * 0.55);
  col = mix(col, uMistColor, (1.0 - fg.r) * 0.96);
  gl_FragColor = vec4(col, a * 0.97 * vFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const riverVert = /* glsl */ `
attribute float aFade;
varying float vFade;
varying vec2 vUv;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vFade = aFade;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

export class Waterways {
  group = new THREE.Group();
  riverMat: THREE.ShaderMaterial;
  roadMat: THREE.MeshStandardMaterial;
  bridgeMat: THREE.MeshStandardMaterial;
  constructor(g: WorldGeo, sky: SkyUniforms, fogTex: THREE.Texture) {
    this.riverMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uNormalTex: { value: null }, uLightColor: { value: new THREE.Color() }, uAmbient: { value: new THREE.Color() }, tFog: { value: null }, uWorldSize: { value: new THREE.Vector2(g.W, g.H) }, uMistColor: { value: new THREE.Color(0.3, 0.32, 0.35) } }]),
      vertexShader: riverVert,
      fragmentShader: riverFrag,
      transparent: true,
      fog: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    Object.assign(this.riverMat.uniforms, sky);
    this.riverMat.uniforms.uNormalTex.value = waterNormalTexture();
    this.riverMat.uniforms.tFog.value = fogTex;
    // rivers
    for (const r of g.rivers) {
      const n = r.widths.length;
      const pos: number[] = [];
      const uv: number[] = [];
      const fade: number[] = [];
      const idx: number[] = [];
      let along = 0;
      for (let i = 0; i < n; i++) {
        const x = r.pts[i * 2];
        const z = r.pts[i * 2 + 1];
        const j0 = Math.max(0, i - 1);
        const j1 = Math.min(n - 1, i + 1);
        let tx = r.pts[j1 * 2] - r.pts[j0 * 2];
        let tz = r.pts[j1 * 2 + 1] - r.pts[j0 * 2 + 1];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        const w = r.widths[i] * 0.5 * 1.3 + 5;
        const y = r.levels[i] - 0.2;
        if (i > 0) along += Math.hypot(x - r.pts[(i - 1) * 2], z - r.pts[(i - 1) * 2 + 1]);
        pos.push(x - tz * w, y, z + tx * w, x + tz * w, y, z - tx * w);
        uv.push(0, along / 10, 1, along / 10);
        const mouth = r.mouth ?? n - 1;
        const f = 1 - Math.min(1, Math.max(0, (i - (mouth - 4)) / 6));
        fade.push(f, f);
        if (i < n - 1) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, this.riverMat);
      m.renderOrder = 1;
      this.group.add(m);
    }
    // roads
    this.roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), transparent: true, roughness: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const roadGeos: THREE.BufferGeometry[] = [];
    const ribbon = (sx: number[], sz: number[]) => {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      let along = 0;
      const m = sx.length;
      for (let i = 0; i < m; i++) {
        const j0 = Math.max(0, i - 1);
        const j1 = Math.min(m - 1, i + 1);
        let tx = sx[j1] - sx[j0];
        let tz = sz[j1] - sz[j0];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        const w = 4.2;
        if (i > 0) along += Math.hypot(sx[i] - sx[i - 1], sz[i] - sz[i - 1]);
        const lx = sx[i] - tz * w;
        const lz = sz[i] + tx * w;
        const rx = sx[i] + tz * w;
        const rz = sz[i] - tx * w;
        pos.push(lx, Math.max(heightAt(g, lx, lz), 0.6) + 0.45, lz, rx, Math.max(heightAt(g, rx, rz), 0.6) + 0.45, rz);
        uv.push(0, along / 30, 1, along / 30);
        if (i < m - 1) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      return geo;
    };
    const shortBridges = g.bridges.filter((b) => b.length <= 110);
    const onBridge = (x: number, z: number) =>
      shortBridges.some((b) => {
        const dx = x - b.x;
        const dz = z - b.z;
        const along = dx * Math.cos(b.angle) + dz * Math.sin(b.angle);
        const across = -dx * Math.sin(b.angle) + dz * Math.cos(b.angle);
        return Math.abs(along) < b.length / 2 + 8 && Math.abs(across) < 10;
      });
    for (const rd of g.roads) {
      const pts = rd.pts;
      const n = pts.length / 2;
      // resample every ~5 units
      const sx: number[] = [];
      const sz: number[] = [];
      for (let i = 0; i < n - 1; i++) {
        const ax = pts[i * 2];
        const az = pts[i * 2 + 1];
        const bx = pts[i * 2 + 2];
        const bz = pts[i * 2 + 3];
        const segs = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
        for (let s = 0; s < segs; s++) {
          sx.push(ax + ((bx - ax) * s) / segs);
          sz.push(az + ((bz - az) * s) / segs);
        }
      }
      sx.push(pts[(n - 1) * 2]);
      sz.push(pts[(n - 1) * 2 + 1]);
      // split into runs over land: crossings of open water are ferry links, not causeways
      let cx: number[] = [];
      let cz: number[] = [];
      for (let i = 0; i < sx.length; i++) {
        const wet = heightAt(g, sx[i], sz[i]) < -0.8 && !onBridge(sx[i], sz[i]);
        if (wet) {
          if (cx.length > 1) roadGeos.push(ribbon(cx, cz));
          cx = [];
          cz = [];
        } else {
          cx.push(sx[i]);
          cz.push(sz[i]);
        }
      }
      if (cx.length > 1) roadGeos.push(ribbon(cx, cz));
    }
    if (roadGeos.length) {
      const merged = mergeGeometries(roadGeos)!;
      merged.computeVertexNormals();
      const mesh = new THREE.Mesh(merged, this.roadMat);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      roadGeos.forEach((r) => r.dispose());
    }
    // bridges
    this.bridgeMat = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.9, color: 0xc8bba4 });
    const bparts: THREE.BufferGeometry[] = [];
    for (const b of g.bridges) {
      if (b.length > 110) continue;
      const local: THREE.BufferGeometry[] = [];
      const L = b.length + 12;
      const deck = new THREE.BoxGeometry(L, 1.6, 9);
      deck.translate(0, b.y, 0);
      local.push(deck);
      for (const s of [-1, 1]) {
        const par = new THREE.BoxGeometry(L, 1.4, 0.8);
        par.translate(0, b.y + 1.4, s * 4.2);
        local.push(par);
      }
      const piers = Math.max(1, Math.round(L / 16));
      for (let i = 0; i < piers; i++) {
        const x = -L / 2 + ((i + 0.5) * L) / piers;
        const pier = new THREE.BoxGeometry(2.4, b.y + 6, 8.4);
        pier.translate(x, (b.y - 6) / 2, 0);
        local.push(pier);
      }
      const rot = new THREE.Matrix4().makeRotationY(-b.angle);
      const tr = new THREE.Matrix4().makeTranslation(b.x, 0, b.z);
      for (const p of local) {
        p.applyMatrix4(rot).applyMatrix4(tr);
        bparts.push(p);
      }
    }
    if (bparts.length) {
      for (const p of bparts) {
        p.deleteAttribute('uv');
        const n = p.attributes.position.count;
        const uv = new Float32Array(n * 2);
        const pos = p.attributes.position;
        for (let i = 0; i < n; i++) {
          uv[i * 2] = (pos.getX(i) + pos.getZ(i)) / 8;
          uv[i * 2 + 1] = pos.getY(i) / 8;
        }
        p.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      const mesh = new THREE.Mesh(mergeGeometries(bparts)!, this.bridgeMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }
  update(time: number, light: THREE.Color, ambient: THREE.Color) {
    this.riverMat.uniforms.uTime.value = time;
    this.riverMat.uniforms.uLightColor.value.copy(light);
    this.riverMat.uniforms.uAmbient.value.copy(ambient);
  }
  dispose() {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
    this.riverMat.dispose();
    this.roadMat.dispose();
    this.bridgeMat.dispose();
  }
}
