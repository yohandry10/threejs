import * as THREE from 'three';
import { Biome, heightAt, type WorldGeo } from '../../sim/world/geo';
import { Rng } from '../../core/rng';
import { buildTreeGeometries, type TreeDetail } from '../env/trees';

/** Tree geometries by type (0 conifer, 1 broadleaf, 2 cypress, 3 olive, 4 bush, 5 rock). */
export function treeGeometries(detail: TreeDetail = 'hi'): THREE.BufferGeometry[] {
  return buildTreeGeometries(detail);
}

export const vegUniforms = {
  uTime: { value: 0 },
  uFadeStart: { value: 1300 },
  uFadeEnd: { value: 1900 },
  uWinter: { value: 0 },
  uAutumn: { value: 0 },
  uWind: { value: 1 },
};

export function makeVegMaterial(): THREE.MeshStandardMaterial {
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
  hi: THREE.InstancedMesh[];
  lo: THREE.InstancedMesh[];
  center: THREE.Vector3;
  radius: number;
}

export class Vegetation {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  geoms: THREE.BufferGeometry[];
  geomsLo: THREE.BufferGeometry[];
  chunks: Chunk[] = [];
  count = 0;
  constructor(g: WorldGeo, density: number, castShadow: boolean) {
    this.material = makeVegMaterial();
    this.geoms = treeGeometries('hi');
    this.geomsLo = treeGeometries('lo');
    const r = new Rng(4242);
    const CX = 16;
    const CZ = 11;
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
      const hiList: THREE.InstancedMesh[] = [];
      const loList: THREE.InstancedMesh[] = [];
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
        im.receiveShadow = true;
        im.computeBoundingSphere();
        // the far version shares the instance buffers
        const lo = new THREE.InstancedMesh(this.geomsLo[t], this.material, list.length);
        lo.instanceMatrix = im.instanceMatrix;
        lo.instanceColor = im.instanceColor;
        lo.castShadow = im.castShadow;
        lo.receiveShadow = false;
        lo.computeBoundingSphere();
        hiList.push(im);
        loList.push(lo);
        this.group.add(im, lo);
      }
      this.chunks.push({ hi: hiList, lo: loList, center: new THREE.Vector3(ccx, 50, ccz), radius: Math.hypot(cw, cz) / 2 });
    }
  }
  update(camera: THREE.Camera, time: number, camDistance: number) {
    vegUniforms.uTime.value = time;
    const fadeEnd = Math.min(2600, Math.max(900, camDistance * 1.35));
    vegUniforms.uFadeEnd.value = fadeEnd;
    vegUniforms.uFadeStart.value = fadeEnd * 0.7;
    const visibleAll = camDistance < 2400;
    const hiDist = 380 + camDistance * 0.25;
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - camera.position.x, c.center.z - camera.position.z) - c.radius;
      const vis = visibleAll && d < fadeEnd + 50;
      const hi = vis && d < hiDist;
      for (const m of c.hi) m.visible = hi;
      for (const m of c.lo) m.visible = vis && !hi;
    }
  }
  dispose() {
    for (const g of this.geoms) g.dispose();
    for (const g of this.geomsLo) g.dispose();
    this.material.dispose();
    for (const c of this.chunks) for (const m of c.hi) m.dispose();
  }
}
