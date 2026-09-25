import * as THREE from 'three';
import type { GameScene } from '../app/scene';
import { Environment } from '../render/env/environment';
import { Ocean } from '../render/env/ocean';
import { ShipActor, WakeTrail } from '../render/ships/shipActor';
import { syncShipLighting } from '../render/ships/shipBuilder';
import { Noise2D } from '../core/noise';
import { Birds } from '../render/env/birds';

/** Title screen backdrop: the flagship crossing a sunset sea, with a squadron and distant isles. */
export class MenuScene implements GameScene {
  readonly name = 'menu';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.5, 30000);
  env: Environment;
  ocean: Ocean;
  ships: ShipActor[] = [];
  time = 0;
  private phi = 0;
  private birds = new Birds(9, new THREE.Vector3(0, 0, 0), 90, 7);
  constructor(faction = 'aldmere') {
    this.env = new Environment(this.scene);
    this.env.t = 0.737;
    this.env.dayLength = 1e9;
    this.env.setWeather('clear', 1, true);
    this.ocean = new Ocean(this.env.uniforms, null, new THREE.Vector2(1, 1));
    this.scene.add(this.ocean.mesh);
    this.ocean.enableReflection(this.scene);
    // composition: view direction phi sits just right of the sun's azimuth so the sun shows left
    // of centre (clear of the menu column); the hero sails toward the camera's right.
    this.env.update(0, this.camera, new THREE.Vector3(), 120);
    const sd = this.env.sunDir;
    const sigma = Math.atan2(sd.x, sd.z);
    this.phi = sigma - 0.2;
    const dirAt = (a: number) => new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const hero = new ShipActor('flagship', faction);
    hero.heading = this.phi - Math.PI / 2 - 0.62;
    hero.speed = 3.2;
    hero.addTo(this.scene);
    this.ships.push(hero);
    const escorts: [string, string, number, number][] = [
      ['carrack', faction, 0.3, 230],
      ['galley', faction, 0.52, 330],
      ['cog', 'sabeline', 0.18, 520],
      ['hulk', 'tamsin', -0.32, 700],
    ];
    for (const [t, f, da, d] of escorts) {
      const sh = new ShipActor(t, f);
      const p = dirAt(this.phi + da).multiplyScalar(d);
      sh.x = p.x;
      sh.z = p.z;
      sh.heading = hero.heading + (Math.random() - 0.5) * 0.15;
      sh.speed = 3.2;
      sh.addTo(this.scene);
      this.ships.push(sh);
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
    this.scene.add(this.birds.mesh);
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
    // slow drift of the camera around the fixed composition
    const phi = this.phi + Math.sin(this.time * 0.03) * 0.025;
    const toShip = phi - 0.22 + Math.sin(this.time * 0.021) * 0.02;
    const dist = 125 + Math.sin(this.time * 0.04) * 6;
    const cam = new THREE.Vector3(hero.x, 0, hero.z).addScaledVector(new THREE.Vector3(Math.sin(toShip), 0, Math.cos(toShip)), -dist);
    cam.y = 11 + Math.sin(this.time * 0.05) * 1.2;
    this.camera.position.copy(cam);
    const look = cam.clone().add(new THREE.Vector3(Math.sin(phi), -0.02, Math.cos(phi)).multiplyScalar(100));
    look.y = cam.y + 2.5;
    this.camera.lookAt(look);
    const target = new THREE.Vector3(hero.x, 12, hero.z);
    syncShipLighting(this.env, this.time);
    this.birds.update(this.time, new THREE.Vector3(hero.x, 0, hero.z));
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
    this.birds.dispose();
    this.env.dispose();
  }
}
