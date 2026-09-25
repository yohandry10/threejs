import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Biome, heightAt, type WorldGeo } from '../../sim/world/geo';
import { Rng } from '../../core/rng';

function withColor(g: THREE.BufferGeometry, c: THREE.Color, crown: number): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = 0.85 + ((i * 7919) % 13) / 60;
    col[i * 3] = c.r * k;
    col[i * 3 + 1] = c.g * k;
    col[i * 3 + 2] = c.b * k;
    cr[i] = crown;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aCrown', new THREE.BufferAttribute(cr, 1));
  return g;
}

function jitter(g: THREE.BufferGeometry, amt: number, seed: number) {
  const r = new Rng(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = map.get(key);
    if (!d) map.set(key, (d = [r.range(-amt, amt), r.range(-amt, amt), r.range(-amt, amt)]));
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  return g;
}

const trunkC = new THREE.Color(0.32, 0.22, 0.14);

export function treeGeometries(): THREE.BufferGeometry[] {
  // 0 conifer
  const con: THREE.BufferGeometry[] = [];
  con.push(withColor(new THREE.CylinderGeometry(0.35, 0.5, 3, 5).translate(0, 1.5, 0), trunkC, 0));
  const layers = [
    [3.6, 5.5, 2.2],
    [2.9, 4.6, 5.0],
    [2.0, 4.0, 7.6],
  ];
  layers.forEach(([r, h, y], i) => con.push(withColor(jitter(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0), 0.25, i), new THREE.Color(0.13, 0.25, 0.14), 1)));
  // 1 broadleaf
  const bl: THREE.BufferGeometry[] = [];
  bl.push(withColor(new THREE.CylinderGeometry(0.3, 0.55, 4.5, 5).translate(0, 2.25, 0), trunkC, 0));
  bl.push(withColor(jitter(new THREE.IcosahedronGeometry(3.6, 1).scale(1, 0.85, 1).translate(0, 7, 0), 0.5, 11), new THREE.Color(0.2, 0.34, 0.12), 1));
  bl.push(withColor(jitter(new THREE.IcosahedronGeometry(2.4, 0).translate(1.8, 5.8, 0.8), 0.3, 12), new THREE.Color(0.22, 0.36, 0.13), 1));
  // 2 cypress
  const cy: THREE.BufferGeometry[] = [];
  cy.push(withColor(new THREE.CylinderGeometry(0.2, 0.3, 1.5, 5).translate(0, 0.75, 0), trunkC, 0));
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.8)) * 1.3 * (1 - t * 0.3) + 0.01, t * 10));
  }
  cy.push(withColor(new THREE.LatheGeometry(pts, 7).translate(0, 1.2, 0), new THREE.Color(0.12, 0.22, 0.1), 1));
  // 3 olive / scrub tree (southern)
  const ol: THREE.BufferGeometry[] = [];
  ol.push(withColor(new THREE.CylinderGeometry(0.3, 0.5, 2.6, 5).rotateZ(0.2).translate(0.2, 1.3, 0), trunkC, 0));
  ol.push(withColor(jitter(new THREE.IcosahedronGeometry(2.6, 1).scale(1.3, 0.7, 1.2).translate(0.4, 4.0, 0), 0.4, 21), new THREE.Color(0.34, 0.38, 0.2), 1));
  // 4 bush
  const bu = [withColor(jitter(new THREE.IcosahedronGeometry(1.3, 0).scale(1.2, 0.8, 1.2).translate(0, 0.8, 0), 0.25, 31), new THREE.Color(0.22, 0.3, 0.12), 1)];
  // 5 rock
  const ro = [withColor(jitter(new THREE.DodecahedronGeometry(2.2, 0).scale(1.3, 0.8, 1).translate(0, 0.6, 0), 0.5, 41), new THREE.Color(0.45, 0.43, 0.4), 0)];
  return [con, bl, cy, ol, bu, ro].map((parts) => mergeGeometries(parts)!);
}

export const vegUniforms = {
  uTime: { value: 0 },
  uFadeStart: { value: 1300 },
  uFadeEnd: { value: 1900 },
  uWinter: { value: 0 },
  uAutumn: { value: 0 },
  uWind: { value: 1 },
};

function makeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, vegUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uFadeStart;\nuniform float uFadeEnd;\nuniform float uWinter;\nuniform float uAutumn;\nuniform float uWind;\nattribute float aCrown;\nvarying float vCrown;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCrown = aCrown;
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float d = distance(ip, cameraPosition);
          float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, d);
          transformed *= fade;
          float sway = sin(uTime * 1.7 + ip.x * 0.11 + ip.z * 0.07) * 0.04 * uWind * aCrown;
          transformed.x += sway * transformed.y;
          transformed.z += sway * 0.6 * transformed.y;
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWinter;\nuniform float uAutumn;\nvarying float vCrown;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 autumnCol = mix(diffuseColor.rgb, vec3(0.62, 0.34, 0.1) * (0.6 + diffuseColor.g * 1.5), 0.65);
        diffuseColor.rgb = mix(diffuseColor.rgb, autumnCol, uAutumn * vCrown * step(0.18, diffuseColor.r));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.8, vec3(0.86, 0.88, 0.92), 0.45), uWinter * vCrown);`,
      );
  };
  m.customProgramCacheKey = () => 'veg';
  return m;
}

interface Chunk {
  meshes: THREE.InstancedMesh[];
  center: THREE.Vector3;
  radius: number;
}

export class Vegetation {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  geoms: THREE.BufferGeometry[];
  chunks: Chunk[] = [];
  count = 0;
  constructor(g: WorldGeo, density: number, castShadow: boolean) {
    this.material = makeMaterial();
    this.geoms = treeGeometries();
    const r = new Rng(4242);
    const CX = 8;
    const CZ = 6;
    const cw = g.W / CX;
    const cz = g.H / CZ;
    type Inst = { x: number; y: number; z: number; s: number; rot: number; c: THREE.Color };
    const buckets: Inst[][][] = [];
    for (let i = 0; i < CX * CZ; i++) buckets.push([[], [], [], [], [], []]);
    const avoid = g.provinces.map((p) => ({ x: p.x, z: p.z, r2: (p.radius * 1.25) ** 2 }));
    const step = g.hmStep;
    for (let iz = 1; iz < g.hmH - 1; iz++)
      for (let ix = 1; ix < g.hmW - 1; ix++) {
        const b = g.biome[iz * g.hmW + ix];
        let dens = 0;
        let types: number[] = [];
        const moist = g.moisture[iz * g.hmW + ix] / 255;
        switch (b) {
          case Biome.Forest:
            dens = 1.4;
            types = [1, 1, 1, 0, 4];
            break;
          case Biome.Conifer:
            dens = 1.5;
            types = [0, 0, 0, 0, 4];
            break;
          case Biome.Grass:
            dens = 0.05 + moist * 0.05;
            types = [1, 4, 4, 5];
            break;
          case Biome.Farm:
            dens = 0.025;
            types = [1, 4];
            break;
          case Biome.Hills:
            dens = 0.1;
            types = [0, 1, 4, 5, 5];
            break;
          case Biome.Dry:
            dens = 0.12;
            types = [2, 3, 3, 4, 5];
            break;
          case Biome.Tundra:
            dens = 0.1;
            types = [0, 4, 5];
            break;
          case Biome.Rock:
            dens = 0.05;
            types = [5, 5, 0];
            break;
          case Biome.Ash:
            dens = 0.04;
            types = [5, 0];
            break;
          case Biome.Beach:
            dens = 0.01;
            types = [4];
            break;
          default:
            dens = 0;
        }
        dens *= density;
        if (dens <= 0) continue;
        let n = Math.floor(dens) + (r.chance(dens - Math.floor(dens)) ? 1 : 0);
        while (n-- > 0) {
          const x = (ix + r.range(-0.5, 0.5)) * step;
          const z = (iz + r.range(-0.5, 0.5)) * step;
          const y = heightAt(g, x, z);
          if (y < 1.5) continue;
          const c = Math.floor(z / g.navStep) * g.navW + Math.floor(x / g.navStep);
          if (g.road[c] || g.river[c]) continue;
          if (avoid.some((a) => (a.x - x) ** 2 + (a.z - z) ** 2 < a.r2)) continue;
          const hx = heightAt(g, x + 4, z) - heightAt(g, x - 4, z);
          const hz = heightAt(g, x, z + 4) - heightAt(g, x, z - 4);
          if (Math.hypot(hx, hz) / 8 > 1.1) continue;
          const t = r.pick(types);
          const ci = Math.min(CX - 1, Math.floor(x / cw)) + Math.min(CZ - 1, Math.floor(z / cz)) * CX;
          const tint = new THREE.Color().setHSL(0.25 + r.range(-0.04, 0.05), 0.2 + r.range(0, 0.2), 0.5 + r.range(-0.08, 0.08));
          const mul = new THREE.Color(0.85 + tint.r * 0.3, 0.85 + tint.g * 0.3, 0.85 + tint.b * 0.3);
          buckets[ci][t].push({ x, y: y - 0.3, z, s: t === 5 ? r.range(0.5, 1.6) : r.range(0.75, 1.35), rot: r.range(0, Math.PI * 2), c: mul });
          this.count++;
        }
      }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < CX * CZ; i++) {
      const meshes: THREE.InstancedMesh[] = [];
      const ccx = (i % CX) * cw + cw / 2;
      const ccz = Math.floor(i / CX) * cz + cz / 2;
      for (let t = 0; t < 6; t++) {
        const list = buckets[i][t];
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(this.geoms[t], this.material, list.length);
        list.forEach((it, k) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
          m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.s, it.s * (t === 5 ? 0.8 : 1), it.s));
          im.setMatrixAt(k, m4);
          im.setColorAt(k, it.c);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = castShadow && t !== 5;
        im.receiveShadow = false;
        im.computeBoundingSphere();
        meshes.push(im);
        this.group.add(im);
      }
      this.chunks.push({ meshes, center: new THREE.Vector3(ccx, 50, ccz), radius: Math.hypot(cw, cz) / 2 });
    }
  }
  update(camera: THREE.Camera, time: number, camDistance: number) {
    vegUniforms.uTime.value = time;
    const fadeEnd = Math.min(2600, Math.max(900, camDistance * 1.35));
    vegUniforms.uFadeEnd.value = fadeEnd;
    vegUniforms.uFadeStart.value = fadeEnd * 0.7;
    const visibleAll = camDistance < 2400;
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - camera.position.x, c.center.z - camera.position.z) - c.radius;
      const vis = visibleAll && d < fadeEnd + 50;
      for (const m of c.meshes) m.visible = vis;
    }
  }
  dispose() {
    for (const g of this.geoms) g.dispose();
    this.material.dispose();
    for (const c of this.chunks) for (const m of c.meshes) m.dispose();
  }
}
