import * as THREE from 'three';
import type { GameScene } from '../app/scene';
import { Environment } from '../render/env/environment';
import { Ocean } from '../render/env/ocean';
import { ShipActor, WakeTrail } from '../render/ships/shipActor';
import { shipUniforms } from '../render/ships/shipBuilder';

/**
 * QA / showcase scene (?viewer=ship&type=flagship&faction=aldmere&yaw=..&pitch=..&dist=..&tod=..):
 * a single ship on the open sea with a fixed camera so visual quality can be judged closely.
 */
export class ViewerScene implements GameScene {
  readonly name = 'viewer';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.3, 30000);
  env: Environment;
  ocean: Ocean;
  ships: ShipActor[] = [];
  time = 0;
  yaw: number;
  pitch: number;
  dist: number;
  target: THREE.Vector3;
  constructor(params: URLSearchParams) {
    this.env = new Environment(this.scene);
    this.env.t = Number(params.get('tod') ?? 0.73);
    this.env.paused = true;
    this.env.setWeather((params.get('weather') ?? 'clear') as never, 1, true);
    this.ocean = new Ocean(this.env.uniforms, null, new THREE.Vector2(1, 1));
    this.scene.add(this.ocean.mesh);
    this.ocean.enableReflection(this.scene);
    const type = params.get('type') ?? 'flagship';
    const faction = params.get('faction') ?? 'aldmere';
    const s = new ShipActor(type, faction);
    s.heading = Number(params.get('heading') ?? 0);
    s.speed = Number(params.get('speed') ?? 3);
    s.addTo(this.scene);
    if (params.get('nowake')) s.wake.mesh.visible = false;
    if (params.get('lod')) s.model.lod.autoUpdate = false;
    this.ships.push(s);
    this.yaw = Number(params.get('yaw') ?? 2.4);
    this.pitch = Number(params.get('pitch') ?? 0.12);
    this.dist = Number(params.get('dist') ?? s.model.length * 1.7);
    this.target = new THREE.Vector3(0, Number(params.get('ty') ?? s.model.length * 0.3), 0);
    const sun = this.env.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 1;
    sc.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.3;
    (window as unknown as { __viewer: ViewerScene }).__viewer = this;
  }
  update(dt: number) {
    this.time += dt;
    for (const s of this.ships) {
      s.x += Math.sin(s.heading) * s.speed * dt;
      s.z += Math.cos(s.heading) * s.speed * dt;
      s.update(dt, this.ocean.sampler, s.heading + 0.5, 1);
    }
    const hero = this.ships[0];
    const t = new THREE.Vector3(hero.x, this.target.y, hero.z);
    this.camera.position.set(t.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, t.y + Math.sin(this.pitch) * this.dist, t.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    this.camera.lookAt(t);
    shipUniforms.uTime.value = this.time;
    shipUniforms.uLamp.value = this.env.lampFactor;
    shipUniforms.uSunDir.value.copy(this.env.sunDir);
    shipUniforms.uSunCol.value.copy(this.env.sun.color).multiplyScalar(Math.min(1.5, this.env.sun.intensity / 2.2));
    this.env.update(dt, this.camera, t, 120);
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
