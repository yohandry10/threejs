import * as THREE from 'three';
import type { GameScene } from '../app/scene';
import { Environment } from '../render/env/environment';
import { Ocean } from '../render/env/ocean';
import { ShipActor, WakeTrail } from '../render/ships/shipActor';
import { shipUniforms } from '../render/ships/shipBuilder';
import { Noise2D } from '../core/noise';

/** Title screen backdrop: the flagship crossing a sunset sea, with a squadron and distant isles. */
export class MenuScene implements GameScene {
  readonly name = 'menu';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.5, 30000);
  env: Environment;
  ocean: Ocean;
  ships: ShipActor[] = [];
  time = 0;
  constructor(faction = 'aldmere') {
    this.env = new Environment(this.scene);
    this.env.t = 0.735;
    this.env.dayLength = 1e9;
    this.env.setWeather('clear', 1, true);
    this.ocean = new Ocean(this.env.uniforms, null, new THREE.Vector2(1, 1));
    this.scene.add(this.ocean.mesh);
    const hero = new ShipActor('flagship', faction);
    hero.heading = -Math.PI * 0.62;
    hero.speed = 4.2;
    hero.addTo(this.scene);
    this.ships.push(hero);
    const escorts: [string, string, number, number][] = [
      ['carrack', faction, -70, -60],
      ['galley', faction, 60, -95],
      ['cog', 'sabeline', -220, 260],
    ];
    for (const [t, f, dx, dz] of escorts) {
      const s = new ShipActor(t, f);
      s.x = dx;
      s.z = dz;
      s.heading = hero.heading + (Math.random() - 0.5) * 0.1;
      s.speed = 4.2;
      s.addTo(this.scene);
      this.ships.push(s);
    }
    this.env.sun.castShadow = true;
    this.env.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.env.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -80;
    sc.right = 80;
    sc.top = 80;
    sc.bottom = -80;
    sc.near = 1;
    sc.far = 800;
    this.env.sun.shadow.bias = -0.0005;
    this.addIsles();
  }
  private addIsles() {
    const n = new Noise2D(7);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b4a3a, roughness: 1, flatShading: true });
    const isles: [number, number, number, number][] = [
      [-2600, -4200, 900, 260],
      [1800, -5200, 1300, 420],
      [4200, -2600, 700, 180],
      [-5200, -1200, 1100, 300],
    ];
    for (const [x, z, r, h] of isles) {
      const g = new THREE.CircleGeometry(r, 48, 0, Math.PI * 2);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const d = Math.hypot(px, pz) / r;
        const hh = Math.max(0, 1 - d) ** 1.4 * h * (0.7 + 0.5 * n.fbm(px * 0.003 + x, pz * 0.003 + z, 4)) - 8;
        pos.setY(i, hh);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, 0, z);
      this.scene.add(m);
    }
  }
  update(dt: number) {
    this.time += dt;
    const hero = this.ships[0];
    for (const s of this.ships) {
      s.heading += Math.sin(this.time * 0.05 + s.x) * 0.0006;
      s.x += Math.sin(s.heading) * s.speed * dt;
      s.z += Math.cos(s.heading) * s.speed * dt;
      s.update(dt, this.ocean.sampler, s.heading + 0.4, 1);
      s.setLampVisible(true);
    }
    // slow cinematic orbit around the flagship
    // keep the setting sun behind the ship for a golden silhouette
    const sd = this.env.sunDir;
    const sunAz = Math.atan2(sd.z, sd.x);
    const a = sunAz + Math.PI + Math.sin(this.time * 0.03) * 0.75;
    const r = 78 + Math.sin(this.time * 0.05) * 14;
    const target = new THREE.Vector3(hero.x, 12, hero.z);
    this.camera.position.set(hero.x + Math.cos(a) * r, 13 + Math.sin(this.time * 0.07) * 4, hero.z + Math.sin(a) * r);
    this.camera.lookAt(target);
    shipUniforms.uTime.value = this.time;
    shipUniforms.uLamp.value = this.env.lampFactor;
    shipUniforms.uBacklight.value = 0.08 + this.env.sun.intensity * 0.06;
    this.env.update(dt, this.camera, target, 120);
    this.ocean.update(this.time, this.camera, this.env.waveScale, this.env.sun.color, this.env.sun.intensity, this.env.hemi.color, this.env.lightning);
    WakeTrail.updateShared(this.time, 0.4 + this.env.sun.intensity * 0.2);
  }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  dispose() {
    for (const s of this.ships) {
      s.removeFrom(this.scene);
      s.dispose();
    }
    this.ocean.dispose();
    this.env.dispose();
  }
}
