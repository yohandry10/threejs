import * as THREE from 'three';
import { buildShip, type ShipModel, type SailUniforms } from './shipBuilder';
import type { WaveSampler } from '../env/ocean';
import { noiseTexture } from '../textures';

const wakeMat = () =>
  new THREE.ShaderMaterial({
    uniforms: { uNoise: { value: noiseTexture() }, uTime: { value: 0 }, uLight: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute float aSide;
      varying float vAge;
      varying float vSide;
      varying vec3 vW;
      void main() {
        vAge = aAge; vSide = aSide;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform float uTime;
      uniform float uLight;
      varying float vAge;
      varying float vSide;
      varying vec3 vW;
      void main() {
        float n = texture2D(uNoise, vW.xz * 0.06 + uTime * 0.02).r;
        float n2 = texture2D(uNoise, vW.xz * 0.19 - uTime * 0.03).g;
        float edge = 1.0 - abs(vSide);
        float trail = smoothstep(0.0, 0.35, edge) * (1.0 - vAge);
        float lines = smoothstep(0.55, 1.0, abs(vSide)) * (1.0 - vAge) * 0.9;
        float birth = smoothstep(0.0, 0.06, vAge);
        float a = max(trail * (0.25 + 0.75 * n * n2), lines * n2) * smoothstep(0.62, 0.25, n * vAge + vAge * 0.6) * birth;
        gl_FragColor = vec4(vec3(0.92, 0.95, 0.97) * uLight, a * 0.6);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

let sharedWakeMat: THREE.ShaderMaterial | null = null;

/** Foam wake ribbon trailing a ship. Width and opacity depend on speed and ship size. */
export class WakeTrail {
  mesh: THREE.Mesh;
  private pts: { x: number; z: number; age: number; w: number }[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private age: Float32Array;
  private side: Float32Array;
  constructor(public beam: number, private max = 48) {
    if (!sharedWakeMat) sharedWakeMat = wakeMat();
    this.pos = new Float32Array(max * 2 * 3);
    this.age = new Float32Array(max * 2);
    this.side = new Float32Array(max * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.geo.setIndex(idx);
    for (let i = 0; i < max; i++) {
      this.side[i * 2] = -1;
      this.side[i * 2 + 1] = 1;
    }
    this.mesh = new THREE.Mesh(this.geo, sharedWakeMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  static updateShared(time: number, light: number) {
    if (sharedWakeMat) {
      sharedWakeMat.uniforms.uTime.value = time;
      sharedWakeMat.uniforms.uLight.value = light;
    }
  }
  update(dt: number, sx: number, sz: number, heading: number, speed: number) {
    const life = 7;
    for (const p of this.pts) {
      p.age += dt / life;
      p.w += dt * (1.2 + speed * 0.15);
    }
    this.pts = this.pts.filter((p) => p.age < 1);
    const last = this.pts[0];
    if (speed > 0.3 && (!last || Math.hypot(last.x - sx, last.z - sz) > 1.6)) {
      this.pts.unshift({ x: sx, z: sz, age: 0, w: this.beam * 0.55 });
      if (this.pts.length > this.max) this.pts.length = this.max;
    }
    const n = this.pts.length;
    const intensity = Math.min(1, speed / 4);
    for (let i = 0; i < this.max; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      if (!p) {
        this.pos.fill(0);
        break;
      }
      const q = this.pts[Math.min(i + 1, n - 1)] ?? p;
      const r = this.pts[Math.max(i - 1, 0)] ?? p;
      let dx = r.x - q.x;
      let dz = r.z - q.z;
      const l = Math.hypot(dx, dz);
      if (l < 1e-4) {
        dx = Math.sin(heading);
        dz = Math.cos(heading);
      } else {
        dx /= l;
        dz /= l;
      }
      const w = i < n ? p.w : 0;
      this.pos[i * 6] = p.x - dz * w;
      this.pos[i * 6 + 1] = 0.25;
      this.pos[i * 6 + 2] = p.z + dx * w;
      this.pos[i * 6 + 3] = p.x + dz * w;
      this.pos[i * 6 + 4] = 0.25;
      this.pos[i * 6 + 5] = p.z - dx * w;
      const a = i < n ? Math.min(1, p.age + (1 - intensity) * 0.6) : 1;
      this.age[i * 2] = a;
      this.age[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAge.needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
  }
}

const tmp = { h: 0, nx: 0, nz: 0 };

/** A ship floating on the ocean: buoyancy (pitch/roll/heave), wake, sails reacting to wind and speed. */
export class ShipActor {
  model: ShipModel;
  wake: WakeTrail;
  group = new THREE.Group();
  x = 0;
  z = 0;
  heading = 0; // radians, 0 = +z
  speed = 0;
  roll = 0;
  pitch = 0;
  heave = 0;
  sinking = 0; // 0..1
  listSide = 1;
  scale = 1;
  constructor(type: string, faction: string) {
    this.model = buildShip(type, faction);
    this.group.add(this.model.root);
    this.wake = new WakeTrail(this.model.params.beam);
  }
  addTo(scene: THREE.Object3D) {
    scene.add(this.group);
    scene.add(this.wake.mesh);
  }
  removeFrom(scene: THREE.Object3D) {
    scene.remove(this.group);
    scene.remove(this.wake.mesh);
  }
  update(dt: number, waves: WaveSampler, windDir: number, windStrength: number) {
    const L = this.model.length * this.scale;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    // sample waves at bow, stern, port, starboard
    const bowH = waves.sample(this.x + sh * L * 0.4, this.z + ch * L * 0.4, tmp).h;
    const sternH = waves.sample(this.x - sh * L * 0.4, this.z - ch * L * 0.4, tmp).h;
    const B = this.model.params.beam * this.scale;
    const portH = waves.sample(this.x - ch * B * 0.5, this.z + sh * B * 0.5, tmp).h;
    const stbdH = waves.sample(this.x + ch * B * 0.5, this.z - sh * B * 0.5, tmp).h;
    const k = 1 - Math.exp(-dt * 2.2);
    const targetPitch = Math.atan2(sternH - bowH, L * 0.8) * 0.8;
    const targetRoll = Math.atan2(stbdH - portH, B) * 0.7 + Math.sin(performance.now() * 0.0007 + this.x) * 0.02 - this.turnRate * 0.12;
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
    this.heave += ((bowH + sternH + portH + stbdH) / 4 - this.heave) * k;
    let y = this.heave;
    let roll = this.roll;
    let pitch = this.pitch;
    if (this.sinking > 0) {
      y -= this.sinking * (this.model.params.depth + this.model.params.draft + 6) * this.scale;
      roll += this.sinking * 0.9 * this.listSide;
      pitch += this.sinking * 0.35;
    }
    this.group.position.set(this.x, y, this.z);
    this.group.rotation.set(0, 0, 0);
    this.group.rotateY(this.heading);
    this.group.rotateX(pitch);
    this.group.rotateZ(roll);
    this.group.scale.setScalar(this.scale);
    // sails: belly depends on apparent wind relative to heading; flutter when luffing
    const rel = Math.cos(windDir - this.heading);
    const belly = Math.max(0.15, 0.4 + 0.6 * Math.max(0, rel)) * windStrength * (this.sinking > 0 ? 0.2 : 1);
    for (const s of this.model.sails) {
      const su = s.userData.sail as SailUniforms;
      const base = (su as SailUniforms & { base?: number }).base ?? su.uBelly.value;
      (su as SailUniforms & { base?: number }).base = base;
      su.uBelly.value = base * belly;
      su.uWind.value = windStrength;
    }
    const sternX = this.x - sh * L * 0.45;
    const sternZ = this.z - ch * L * 0.45;
    this.wake.update(dt, sternX, sternZ, this.heading, this.sinking > 0 ? 0 : this.speed);
  }
  turnRate = 0;
  setLampVisible(v: boolean) {
    for (const l of this.model.lanterns) l.visible = v;
  }
  dispose() {
    this.wake.dispose();
    for (const s of this.model.sails) s.dispose();
  }
}
