import * as THREE from 'three';
import type { WorldGeo } from '../../sim/world/geo';
import { heightAt } from '../../sim/world/geo';
import { Environment } from '../env/environment';
import { Ocean } from '../env/ocean';
import { buildWorldTextures, disposeWorldTextures, type WorldTextures } from './worldTextures';
import { makeTerrainUniforms, Terrain, type TerrainUniforms } from './terrain';
import { Waterways } from './waterways';
import { Vegetation, vegUniforms } from './vegetation';
import { Settlements } from './settlements';
import { Forces } from './forces';
import type { Sim } from '../../sim/context';
import { StrategyCamera } from './campaignCamera';
import { shipUniforms } from '../ships/shipBuilder';
import { WakeTrail } from '../ships/shipActor';
import type { Settings } from '../../persistence/settings';

/** Static + dynamic visual world of the campaign map. */
export class CampaignView {
  scene = new THREE.Scene();
  env: Environment;
  ocean: Ocean;
  tex: WorldTextures;
  terrainU: TerrainUniforms;
  terrain: Terrain;
  water: Waterways;
  veg: Vegetation;
  settlements: Settlements;
  forces: Forces;
  cam: StrategyCamera;
  time = 0;
  geo: WorldGeo;
  constructor(
    public sim: Sim,
    public settings: Settings,
    aspect: number,
  ) {
    const geo = sim.geo;
    this.geo = geo;
    this.env = new Environment(this.scene);
    this.env.baseFogDensity = 0.00006;
    this.tex = buildWorldTextures(geo);
    this.terrainU = makeTerrainUniforms(this.tex, geo);
    this.terrain = new Terrain(geo, this.terrainU);
    this.scene.add(this.terrain.group);
    this.ocean = new Ocean(this.env.uniforms, this.tex.height, new THREE.Vector2(geo.W, geo.H), settings.water);
    this.ocean.material.uniforms.tFogW.value = this.tex.fog;
    this.ocean.material.uniforms.uFogW.value = 1;
    this.ocean.material.uniforms.uWorldSizeF.value.set(geo.W, geo.H);
    this.scene.add(this.ocean.mesh);
    this.water = new Waterways(geo, this.env.uniforms, this.tex.fog);
    this.scene.add(this.water.group);
    this.veg = new Vegetation(geo, settings.vegetation, settings.shadows >= 2);
    this.scene.add(this.veg.group);
    this.settlements = new Settlements(sim);
    this.scene.add(this.settlements.group);
    this.forces = new Forces(sim);
    this.forces.plazaOf = (pid) => this.settlements.entries.get(pid)?.vis.plaza ?? null;
    this.scene.add(this.forces.group);
    this.forces.sync();
    const bounds = new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(geo.W, geo.H));
    this.cam = new StrategyCamera(aspect, bounds, (x, z) => heightAt(geo, x, z), settings.keys);
    this.setupShadows();
  }
  setupShadows() {
    const sun = this.env.sun;
    sun.castShadow = this.settings.shadows > 0;
    const size = this.settings.shadows >= 2 ? 4096 : 2048;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
  }
  groundAt(x: number, z: number) {
    return heightAt(this.geo, x, z);
  }
  /** Ray-march the heightfield to find the ground point under a screen position. */
  pickGround(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.cam.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    let t = 0;
    const maxT = this.cam.camera.far;
    let step = Math.max(2, this.cam.distance * 0.004);
    let prevT = 0;
    while (t < maxT) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const gh = Math.max(0, this.groundAt(x, z));
      if (y <= gh) {
        // refine
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) / 2;
          const yy = o.y + d.y * m;
          const gg = Math.max(0, this.groundAt(o.x + d.x * m, o.z + d.z * m));
          if (yy <= gg) hi = m;
          else lo = m;
        }
        const p = new THREE.Vector3(o.x + d.x * hi, 0, o.z + d.z * hi);
        p.y = Math.max(0, this.groundAt(p.x, p.z));
        return p;
      }
      prevT = t;
      t += step;
      step *= 1.01;
    }
    return null;
  }
  update(dt: number) {
    this.time += dt;
    this.cam.update(dt);
    const cam = this.cam.camera;
    this.env.update(dt, cam, this.cam.target, this.cam.distance);
    // shadow frustum scaled with the view
    const sc = this.env.sun.shadow.camera as THREE.OrthographicCamera;
    const r = Math.min(900, Math.max(120, this.cam.distance * 0.7));
    if (sc.right !== r) {
      sc.left = -r;
      sc.right = r;
      sc.top = r;
      sc.bottom = -r;
      sc.near = 10;
      sc.far = r * 6 + 2000;
      sc.updateProjectionMatrix();
    }
    this.env.sun.castShadow = this.settings.shadows > 0 && this.cam.distance < 1600;
    this.ocean.update(this.time, cam, this.env.waveScale, this.env.sun.color, this.env.sun.intensity, this.env.hemi.color, this.env.lightning);
    this.water.update(this.time, this.env.sun.color, this.env.hemi.color);
    this.terrainU.uTime.value = this.time;
    this.veg.update(cam, this.time, this.cam.distance);
    this.settlements.update(dt, this.env.lampFactor, 1 + this.env.storm);
    this.forces.update(dt, this.cam.distance, this.ocean.sampler, 0.6);
    vegUniforms.uWinter.value = this.terrainU.uWinter.value;
    vegUniforms.uAutumn.value = this.terrainU.uAutumn.value;
    vegUniforms.uWind.value = 1 + this.env.storm * 2;
    this.terrainU.uBorderWidth.value = Math.min(28, Math.max(4, this.cam.distance * 0.0055));
    shipUniforms.uTime.value = this.time;
    shipUniforms.uLamp.value = this.env.lampFactor;
    shipUniforms.uBacklight.value = 0.08 + this.env.sun.intensity * 0.05;
    WakeTrail.updateShared(this.time, 0.35 + Math.min(1, this.env.sun.intensity * 0.3));
  }
  dispose() {
    this.terrain.dispose();
    this.veg.dispose();
    this.settlements.dispose();
    this.forces.dispose();
    this.water.dispose();
    this.ocean.dispose();
    this.env.dispose();
    disposeWorldTextures(this.tex);
  }
}
