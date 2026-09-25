import * as THREE from 'three';
import { buildShip, waterlineOutline, type ShipModel, type SailUniforms } from './shipBuilder';
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
        // frothy foam: high-frequency cells that break up as the trail ages
        float n = texture2D(uNoise, vW.xz * 0.21 + uTime * 0.015).r;
        float n2 = texture2D(uNoise, vW.xz * 0.63 - uTime * 0.03).g;
        float n3 = texture2D(uNoise, vW.xz * 1.7 + uTime * 0.05).b;
        float froth = smoothstep(0.38, 0.72, n * 0.55 + n2 * 0.3 + n3 * 0.25);
        float edge = 1.0 - abs(vSide);
        float core = smoothstep(0.15, 0.85, edge) * (1.0 - vAge);
        float rims = smoothstep(0.6, 0.95, abs(vSide)) * (1.0 - vAge);
        float birth = smoothstep(0.0, 0.04, vAge);
        float breakup = smoothstep(0.75, 0.2, vAge + (1.0 - froth) * 0.55);
        float a = (core * froth * 0.8 + rims * froth * 0.6) * breakup * birth;
        gl_FragColor = vec4(vec3(0.9, 0.94, 0.96) * uLight, a * 0.55);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

let sharedWakeMat: THREE.ShaderMaterial | null = null;
const tmpW = { h: 0, nx: 0, nz: 0 };

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
    HullFoam.updateShared(time, light);
  }
  update(dt: number, sx: number, sz: number, heading: number, speed: number, waves?: WaveSampler) {
    const life = 7;
    for (const p of this.pts) {
      p.age += dt / life;
      p.w += dt * (0.35 + speed * 0.08);
    }
    this.pts = this.pts.filter((p) => p.age < 1);
    const last = this.pts[0];
    if (speed > 0.3 && (!last || Math.hypot(last.x - sx, last.z - sz) > 1.6)) {
      this.pts.unshift({ x: sx, z: sz, age: 0, w: this.beam * 0.32 });
      if (this.pts.length > this.max) this.pts.length = this.max;
    }
    const n = this.pts.length;
    const intensity = Math.min(1, speed / 4);
    for (let i = 0; i < this.max; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      if (!p) {
        // no trail yet: collapse every vertex onto the stern instead of the world origin
        for (let k = 0; k < this.max * 2; k++) {
          this.pos[k * 3] = sx;
          this.pos[k * 3 + 1] = -5;
          this.pos[k * 3 + 2] = sz;
          this.age[k] = 1;
        }
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
      const ax = p.x - dz * w;
      const az = p.z + dx * w;
      const bx = p.x + dz * w;
      const bz = p.z - dx * w;
      // follow the swell so the foam never floats above or sinks below the surface
      const ya = waves ? waves.sample(ax, az, tmpW).h + 0.12 : 0.25;
      const yb = waves ? waves.sample(bx, bz, tmpW).h + 0.12 : 0.25;
      this.pos[i * 6] = ax;
      this.pos[i * 6 + 1] = ya;
      this.pos[i * 6 + 2] = az;
      this.pos[i * 6 + 3] = bx;
      this.pos[i * 6 + 4] = yb;
      this.pos[i * 6 + 5] = bz;
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

let foamMat: THREE.ShaderMaterial | null = null;
/** Foam collar hugging the hull at the waterline, with a bow wave that grows with speed. */
export class HullFoam {
  mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private outline: { x: number; z: number; bow: number }[];
  constructor(type: string, faction: string) {
    this.outline = waterlineOutline(type, faction);
    const n = this.outline.length;
    this.pos = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2);
    const bow = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      side[i * 2] = 0;
      side[i * 2 + 1] = 1;
      bow[i * 2] = this.outline[i].bow;
      bow[i * 2 + 1] = this.outline[i].bow;
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    idx.push((n - 1) * 2, (n - 1) * 2 + 1, 0, (n - 1) * 2 + 1, 1, 0);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.geo.setAttribute('aBow', new THREE.BufferAttribute(bow, 1));
    this.geo.setIndex(idx);
    if (!foamMat)
      foamMat = new THREE.ShaderMaterial({
        uniforms: { uNoise: { value: noiseTexture() }, uTime: { value: 0 }, uLight: { value: 1 }, uSpeed: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aSide; attribute float aBow;
          varying float vSide; varying float vBow; varying vec3 vW;
          void main(){ vSide = aSide; vBow = aBow; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uNoise; uniform float uTime; uniform float uLight; uniform float uSpeed;
          varying float vSide; varying float vBow; varying vec3 vW;
          void main(){
            float n = texture2D(uNoise, vW.xz * 0.32 + uTime * 0.03).r;
            float n2 = texture2D(uNoise, vW.xz * 0.9 - uTime * 0.05).g;
            float froth = smoothstep(0.3, 0.62, n * 0.6 + n2 * 0.4);
            float near = 1.0 - smoothstep(0.1, 1.0, vSide);
            float a = near * (0.35 + froth * 0.65) * (0.55 + vBow * 0.45 * min(1.0, uSpeed / 3.0));
            gl_FragColor = vec4(vec3(0.93, 0.96, 0.98) * uLight, clamp(a, 0.0, 1.0) * 0.85);
          }`,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
      });
    this.mesh = new THREE.Mesh(this.geo, foamMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  static updateShared(time: number, light: number) {
    if (foamMat) {
      foamMat.uniforms.uTime.value = time;
      foamMat.uniforms.uLight.value = light;
    }
  }
  update(x: number, z: number, heading: number, speed: number, scale: number, waves: WaveSampler, sinking: number) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const n = this.outline.length;
    const cx = this.outline.reduce((a, p) => a + p.z, 0) / n;
    this.mesh.visible = sinking < 0.3;
    for (let i = 0; i < n; i++) {
      const o = this.outline[i];
      // push the outer edge out further at the bow as speed builds
      const grow = 1.4 + o.bow * Math.min(3.5, speed * 0.7);
      const lx = o.x * scale;
      const lz = o.z * scale;
      const ox = (o.x + Math.sign(o.x || 1) * grow) * scale;
      const oz = (o.z + (o.z > cx ? o.bow * grow * 0.8 : -0.4)) * scale;
      const ax = x + lx * c + lz * s;
      const az = z - lx * s + lz * c;
      const bx = x + ox * c + oz * s;
      const bz = z - ox * s + oz * c;
      this.pos[i * 6] = ax;
      this.pos[i * 6 + 1] = waves.sample(ax, az, tmp).h + 0.3;
      this.pos[i * 6 + 2] = az;
      this.pos[i * 6 + 3] = bx;
      this.pos[i * 6 + 4] = waves.sample(bx, bz, tmp).h + 0.3;
      this.pos[i * 6 + 5] = bz;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uSpeed.value = speed;
  }
  dispose() {
    this.geo.dispose();
  }
}

/** A ship floating on the ocean: buoyancy (pitch/roll/heave), wake, sails reacting to wind and speed. */
export class ShipActor {
  model: ShipModel;
  wake: WakeTrail;
  foam: HullFoam;
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
    this.foam = new HullFoam(type, faction);
  }
  addTo(scene: THREE.Object3D) {
    this.group.traverse((o) => o.layers.enable(1));
    scene.add(this.group);
    scene.add(this.wake.mesh);
    scene.add(this.foam.mesh);
  }
  removeFrom(scene: THREE.Object3D) {
    scene.remove(this.group);
    scene.remove(this.wake.mesh);
    scene.remove(this.foam.mesh);
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
    this.wake.update(dt, sternX, sternZ, this.heading, this.sinking > 0 ? 0 : this.speed, waves);
    this.foam.update(this.x, this.z, this.heading, this.speed, this.scale, waves, this.sinking);
  }
  turnRate = 0;
  setLampVisible(v: boolean) {
    for (const l of this.model.lanterns) l.visible = v;
  }
  dispose() {
    this.wake.dispose();
    this.foam.dispose();
    for (const s of this.model.sails) s.dispose();
  }
}
