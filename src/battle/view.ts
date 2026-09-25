import * as THREE from 'three';
import { factionDef } from '../data/factions';
import { FigureBatch, ANIM, HANIM, emblemIndex, emblemAtlas, figureUniforms } from '../render/figures/figures';
import { Environment } from '../render/env/environment';
import { StrategyCamera } from '../render/campaign/campaignCamera';
import { treeGeometries, makeVegMaterial, vegUniforms } from '../render/campaign/vegetation';
import { archMaterials, archUniforms } from '../render/architecture/settlementBuilder';
import { Bucket, box, cylinder, cone, gableRoof, merlons } from '../render/architecture/meshBuilder';
import { makeFlagMaterial, shipUniforms } from '../render/ships/shipBuilder';
import { noiseTexture, planksTexture, puffTexture, ringTexture, waterNormalTexture } from '../render/textures';
import { Noise2D } from '../core/noise';
import { Rng, hash01 } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import type { Settings } from '../persistence/settings';
import { BattleField, FIELD_SIZE, PLAY } from './field';
import type { BattleSim, BUnit, Soldier } from './sim';

const tmpC = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ particles
class Particles {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private n = 0;
  constructor(
    private cap: number,
    blending: THREE.Blending = THREE.NormalBlending,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: puffTexture() }, uScale: { value: 600 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale; varying vec3 vC; varying float vA; varying float vFog;
        uniform float fogDensity;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(1.0, -mv.z);
        float d = length(mv.xyz); vFog = 1.0 - exp(-fogDensity * fogDensity * d * d); }`,
      fragmentShader: `uniform sampler2D tMap; uniform vec3 fogColor; varying vec3 vC; varying float vA; varying float vFog;
        void main(){ vec4 t = texture2D(tMap, gl_PointCoord); float a = t.a * vA; if (a < 0.01) discard; gl_FragColor = vec4(mix(vC, fogColor, vFog), a); }`,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, r: number, g: number, b: number, grow = 1) {
    let i = this.n;
    if (i >= this.cap) {
      // replace the oldest-ish particle
      i = Math.floor(Math.random() * this.cap);
    } else this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.size[i] = size;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.grow[i] = grow;
  }
  update(dt: number, fog: THREE.FogExp2, viewH: number) {
    const m = this.points.material as THREE.ShaderMaterial;
    m.uniforms.uScale.value = viewH * 0.9;
    m.uniforms.fogColor.value.copy(fog.color);
    m.uniforms.fogDensity.value = fog.density;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i] + dt;
      if (l >= this.maxLife[i]) continue;
      const k = l / this.maxLife[i];
      if (w !== i) {
        this.pos.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.vel.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.col.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.size[w] = this.size[i];
        this.maxLife[w] = this.maxLife[i];
        this.grow[w] = this.grow[i];
      }
      this.life[w] = l;
      this.pos[w * 3] += this.vel[w * 3] * dt;
      this.pos[w * 3 + 1] += this.vel[w * 3 + 1] * dt;
      this.pos[w * 3 + 2] += this.vel[w * 3 + 2] * dt;
      this.vel[w * 3] *= 1 - dt * 0.8;
      this.vel[w * 3 + 2] *= 1 - dt * 0.8;
      this.size[w] *= 1 + dt * this.grow[w] * 0.6;
      this.alpha[w] = Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * (1 - k);
      w++;
    }
    this.n = w;
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const a of ['position', 'aColor', 'aSize', 'aAlpha']) (g.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ------------------------------------------------------------------ precipitation
class Precipitation {
  group = new THREE.Group();
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rp: Float32Array;
  private sp: Float32Array;
  private N = 3000;
  constructor() {
    this.rp = new Float32Array(this.N * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rp, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.sp = new Float32Array(this.N * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sp, 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.85, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.group.add(this.rain, this.snow);
    for (let i = 0; i < this.N; i++) {
      this.sp[i * 3] = (Math.random() - 0.5) * 160;
      this.sp[i * 3 + 1] = Math.random() * 80;
      this.sp[i * 3 + 2] = (Math.random() - 0.5) * 160;
      this.rp[i * 6] = this.sp[i * 3];
      this.rp[i * 6 + 1] = this.sp[i * 3 + 1];
      this.rp[i * 6 + 2] = this.sp[i * 3 + 2];
    }
  }
  update(dt: number, cam: THREE.Vector3, rain: number, snow: number, wind: number) {
    this.rain.visible = rain > 0.05;
    this.snow.visible = snow > 0.05;
    const R = 80;
    if (this.rain.visible) {
      const n = Math.floor(this.N * rain);
      const p = this.rp;
      for (let i = 0; i < this.N; i++) {
        let x = p[i * 6];
        let y = p[i * 6 + 1];
        let z = p[i * 6 + 2];
        y -= dt * 38;
        x += dt * wind * 6;
        if (y < cam.y - 40 || i >= n) {
          x = cam.x + (Math.random() - 0.5) * R * 2;
          z = cam.z + (Math.random() - 0.5) * R * 2;
          y = cam.y + 20 + Math.random() * 40;
        }
        if (Math.abs(x - cam.x) > R) x = cam.x + (Math.random() - 0.5) * R * 2;
        if (Math.abs(z - cam.z) > R) z = cam.z + (Math.random() - 0.5) * R * 2;
        p[i * 6] = x;
        p[i * 6 + 1] = y;
        p[i * 6 + 2] = z;
        p[i * 6 + 3] = x - wind * 0.15;
        p[i * 6 + 4] = i < n ? y + 1.1 : y;
        p[i * 6 + 5] = z;
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.snow.visible) {
      const p = this.sp;
      const n = Math.floor(this.N * snow);
      for (let i = 0; i < this.N; i++) {
        let x = p[i * 3];
        let y = p[i * 3 + 1];
        let z = p[i * 3 + 2];
        y -= dt * (1.5 + (i % 7) * 0.2);
        x += dt * (wind * 1.5 + Math.sin(y * 0.3 + i) * 0.6);
        if (y < cam.y - 40 || Math.abs(x - cam.x) > R || Math.abs(z - cam.z) > R) {
          x = cam.x + (Math.random() - 0.5) * R * 2;
          z = cam.z + (Math.random() - 0.5) * R * 2;
          y = cam.y + Math.random() * 50 - 10;
        }
        p[i * 3] = x;
        p[i * 3 + 1] = i < n ? y : -9999;
        p[i * 3 + 2] = z;
      }
      (this.snow.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
  dispose() {
    this.rain.geometry.dispose();
    this.snow.geometry.dispose();
  }
}

// ------------------------------------------------------------------ siege engines
interface EngineVis {
  unit: BUnit;
  group: THREE.Group;
  arm?: THREE.Object3D;
  log?: THREE.Object3D;
}

function woodMat() {
  return new THREE.MeshStandardMaterial({ map: planksTexture(), color: 0x9a7a55, roughness: 0.9 });
}
function buildEngine(type: string, mat: THREE.Material, iron: THREE.Material, hide: THREE.Material): EngineVis['group'] & { arm?: THREE.Object3D; log?: THREE.Object3D } {
  const g = new THREE.Group() as THREE.Group & { arm?: THREE.Object3D; log?: THREE.Object3D };
  const beam = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, rz = 0, m: THREE.Material = mat) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.rotation.set(rx, 0, rz);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  const wheel = (x: number, z: number, r = 0.7) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 10), mat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, r, z);
    w.castShadow = true;
    g.add(w);
  };
  if (type === 'ram') {
    // roofed shed on wheels with a swinging iron-capped log
    for (const x of [-1.6, 1.6]) for (const z of [-3, 0, 3]) beam(0.3, 3.2, 0.3, x, 1.6, z);
    beam(0.3, 0.3, 7.4, -1.6, 3.2, 0);
    beam(0.3, 0.3, 7.4, 1.6, 3.2, 0);
    const roofL = beam(2.4, 0.15, 7.6, -0.9, 3.8, 0, 0, 0.6, hide);
    const roofR = beam(2.4, 0.15, 7.6, 0.9, 3.8, 0, 0, -0.6, hide);
    void roofL;
    void roofR;
    for (const x of [-1.6, 1.6]) for (const z of [-2.6, 2.6]) wheel(x * 1.1, z, 0.6);
    const logPivot = new THREE.Group();
    logPivot.position.set(0, 3.0, 0);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 8.5, 8), mat);
    log.rotation.x = Math.PI / 2;
    log.position.set(0, -1.3, 0.6);
    log.castShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 8), iron);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, -1.3, 5.2);
    logPivot.add(log, cap);
    g.add(logPivot);
    g.log = logPivot;
  } else {
    const tre = type === 'trebuchet';
    const H = tre ? 7 : 3.2;
    beam(0.4, 0.4, 6, -1.4, 0.5, 0);
    beam(0.4, 0.4, 6, 1.4, 0.5, 0);
    beam(3.2, 0.4, 0.4, 0, 0.5, -2.6);
    beam(3.2, 0.4, 0.4, 0, 0.5, 2.6);
    for (const x of [-1.4, 1.4]) {
      beam(0.35, H, 0.35, x, H / 2 + 0.5, -0.6, 0.18);
      beam(0.35, H, 0.35, x, H / 2 + 0.5, 0.6, -0.18);
    }
    beam(3.4, 0.35, 0.35, 0, H + 0.4, 0);
    if (!tre) for (const x of [-1.6, 1.6]) for (const z of [-2.2, 2.2]) wheel(x, z, 0.55);
    const armPivot = new THREE.Group();
    armPivot.position.set(0, H + 0.4, 0);
    const L = tre ? 12 : 6;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, L), mat);
    arm.position.set(0, 0, tre ? L * 0.3 : L * 0.4);
    arm.castShadow = true;
    armPivot.add(arm);
    if (tre) {
      const cw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), mat);
      cw.position.set(0, -1.1, -2.2);
      cw.castShadow = true;
      armPivot.add(cw);
    } else {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.4, 8), mat);
      cup.position.set(0, 0.25, L * 0.88);
      armPivot.add(cup);
    }
    g.add(armPivot);
    g.arm = armPivot;
  }
  return g;
}

// ------------------------------------------------------------------ the view
export class BattleView {
  scene = new THREE.Scene();
  env: Environment;
  cam: StrategyCamera;
  private batches = new Map<string, FigureBatch>();
  private soldierSlot: { batch: FigureBatch; index: number; horse?: FigureBatch; hIndex?: number }[] = [];
  private arrows: THREE.InstancedMesh;
  private stones: THREE.InstancedMesh;
  private selRings: THREE.InstancedMesh;
  private ghosts: THREE.InstancedMesh;
  private ladders: THREE.InstancedMesh;
  private dust: Particles;
  private smoke: Particles;
  private sparks: Particles;
  private precip = new Precipitation();
  private engines: EngineVis[] = [];
  private banners = new Map<number, { pole: THREE.Mesh; flag: THREE.Mesh }>();
  private wallMeshes: { seg: number; intact: THREE.Mesh[]; rubble: THREE.Mesh[] }[] = [];
  private towerMeshes: { intact: THREE.Object3D[]; ruin: THREE.Object3D[] }[] = [];
  private gateDoors: THREE.Mesh | null = null;
  private gateBroken: THREE.Mesh | null = null;
  private captureRing: THREE.Mesh | null = null;
  private water: THREE.Mesh | null = null;
  private disposables: { dispose(): void }[] = [];
  time = 0;
  selected = new Set<BUnit>();
  hovered: BUnit | null = null;
  ghostPts: { x: number; z: number }[] = [];
  private lastEvents = 0;
  constructor(
    public sim: BattleSim,
    public field: BattleField,
    public settings: Settings,
    aspect: number,
    weather: string,
    season: number,
    timeOfDay: number,
    defenderFaction: string,
  ) {
    const scene = this.scene;
    this.env = new Environment(scene);
    this.env.t = timeOfDay;
    this.env.paused = true;
    this.env.baseFogDensity = 0.0006;
    this.env.setWeather(weather as never, season, true);
    const sun = this.env.sun;
    sun.castShadow = settings.shadows > 0;
    const sz = settings.shadows >= 2 ? 4096 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.25;
    const bounds = new THREE.Box2(new THREE.Vector2(-PLAY - 40, -PLAY - 40), new THREE.Vector2(PLAY + 40, PLAY + 40));
    this.cam = new StrategyCamera(aspect, bounds, (x, z) => field.heightAt(x, z), settings.keys);
    this.cam.minDist = 14;
    this.cam.maxDist = 1000;
    this.cam.minPitch = 0.32;
    this.cam.maxPitch = 1.15;
    this.cam.sensitivity = settings.mouseSensitivity;
    this.cam.edgeScroll = settings.edgeScroll;
    this.cam.camera.far = 6000;
    emblemAtlas();
    this.buildTerrain(season);
    this.buildVegetation(season);
    if (field.river.enabled) this.buildRiver();
    if (field.fort) this.buildFort(defenderFaction);
    // projectiles
    const arrowGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 3).rotateX(Math.PI / 2);
    this.arrows = new THREE.InstancedMesh(arrowGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 }), 4000);
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    const stoneGeo = new THREE.DodecahedronGeometry(0.55, 0);
    this.stones = new THREE.InstancedMesh(stoneGeo, new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.95 }), 200);
    this.stones.frustumCulled = false;
    this.stones.count = 0;
    this.stones.castShadow = true;
    // selection rings under each selected soldier
    const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, vertexColors: false });
    this.selRings = new THREE.InstancedMesh(ringGeo, ringMat, 5000);
    this.selRings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(5000 * 3), 3);
    this.selRings.frustumCulled = false;
    this.selRings.count = 0;
    this.selRings.renderOrder = 3;
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0xf2d98a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.ghosts = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2), ghostMat, 5000);
    this.ghosts.frustumCulled = false;
    this.ghosts.count = 0;
    const ladderGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const b = new Bucket();
      const c = new THREE.Color(0.55, 0.42, 0.28);
      box(b, -0.35, 0, 0, 0.12, 1, 0.12, 0, c);
      box(b, 0.35, 0, 0, 0.12, 1, 0.12, 0, c);
      for (let i = 1; i < 10; i++) box(b, 0, i / 10, 0, 0.7, 0.03, 0.06, 0, c);
      parts.push(b.build()!);
      return parts[0];
    })();
    this.ladders = new THREE.InstancedMesh(ladderGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 300);
    this.ladders.count = 0;
    this.ladders.frustumCulled = false;
    this.ladders.castShadow = true;
    this.dust = new Particles(1800);
    this.smoke = new Particles(700);
    this.sparks = new Particles(300, THREE.AdditiveBlending);
    scene.add(this.arrows, this.stones, this.selRings, this.ghosts, this.ladders, this.dust.points, this.smoke.points, this.sparks.points, this.precip.group);
    this.disposables.push(arrowGeo, stoneGeo, ringGeo, this.dust, this.smoke, this.sparks, this.precip);
    this.buildFigures();
  }

  // ------------------------------------------------------------------ terrain
  private buildTerrain(season: number) {
    const f = this.field;
    const { N } = BattleField.resolution;
    const geo = new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE, N - 1, N - 1).rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, f.heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    // splat texture
    const T = 1024;
    const data = new Uint8Array(T * T * 4);
    const n1 = new Noise2D(f.setup.seed + 3);
    const n2 = new Noise2D(f.setup.seed + 5);
    const snow = f.snowy;
    const arid = f.arid;
    const grass = snow ? [0.82, 0.84, 0.88] : arid ? [0.6, 0.52, 0.36] : season === 0 ? [0.27, 0.4, 0.15] : season === 1 ? [0.36, 0.41, 0.17] : season === 2 ? [0.44, 0.37, 0.18] : [0.34, 0.33, 0.2];
    const grass2 = snow ? [0.7, 0.74, 0.8] : arid ? [0.52, 0.43, 0.28] : season === 2 ? [0.5, 0.33, 0.14] : [0.22, 0.33, 0.12];
    const dirt = [0.36, 0.29, 0.2];
    const rock = [0.43, 0.41, 0.38];
    const mud = [0.28, 0.23, 0.16];
    const cobble = [0.46, 0.43, 0.39];
    const forestC = snow ? [0.6, 0.64, 0.66] : [0.17, 0.21, 0.1];
    const road = [0.5, 0.42, 0.3];
    const fort = f.fort;
    for (let j = 0; j < T; j++)
      for (let i = 0; i < T; i++) {
        const x = -FIELD_SIZE / 2 + ((i + 0.5) / T) * FIELD_SIZE;
        const z = -FIELD_SIZE / 2 + ((j + 0.5) / T) * FIELD_SIZE;
        const nv = n1.noise(x / 40, z / 40) * 0.6 + n1.noise(x / 9, z / 9) * 0.4;
        const t0 = smoothstep(-0.4, 0.6, nv);
        let r = grass[0] + (grass2[0] - grass[0]) * t0;
        let g = grass[1] + (grass2[1] - grass[1]) * t0;
        let b = grass[2] + (grass2[2] - grass[2]) * t0;
        const mix = (c: number[], k: number) => {
          r += (c[0] - r) * k;
          g += (c[1] - g) * k;
          b += (c[2] - b) * k;
        };
        mix(dirt, smoothstep(0.35, 0.7, n2.noise(x / 70, z / 70)) * 0.6);
        mix(forestC, f.forestAt(x, z) * 0.85);
        const slope = f.slopeAt(x, z);
        mix(rock, smoothstep(0.35, 0.8, slope));
        if (f.marshAt(x, z) > 0) mix([0.22, 0.26, 0.2], f.marshAt(x, z) * 0.7);
        if (f.river.enabled) {
          const d = Math.abs(z - f.riverZ(x));
          mix(mud, 1 - smoothstep(f.river.width * 0.5, f.river.width * 1.6, d));
          if (f.fordAt(x)) mix(dirt, (1 - smoothstep(4, 30, d)) * 0.4);
        }
        if (fort) {
          const wz = f.wallZ(clamp(x, -fort.halfW, fort.halfW));
          if (f.inside(x, z)) mix(cobble, 0.75 + nv * 0.1);
          // main road to the gate
          if (z > wz && Math.abs(x) < 6 + (z - wz) * 0.01) mix(road, 0.85 - smoothstep(4, 7, Math.abs(x)) * 0.5);
          if (Math.abs(z - wz) < 14 && Math.abs(x) < fort.halfW + 8) mix(dirt, 0.45);
        } else {
          // a country track across the field
          const rz = x * 0.25 + 30 * Math.sin(x / 120);
          if (Math.abs(z - rz) < 3.5) mix(road, 0.7);
        }
        const k = 0.9 + n2.noise(x / 3, z / 3) * 0.1;
        const o = (j * T + i) * 4;
        data[o] = clamp(r * k * 255, 0, 255);
        data[o + 1] = clamp(g * k * 255, 0, 255);
        data[o + 2] = clamp(b * k * 255, 0, 255);
        data[o + 3] = 255;
      }
    const tex = new THREE.DataTexture(data, T, T, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tNoise = { value: noiseTexture() };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise;\nvarying vec3 vWPos;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec4 nA = texture2D(tNoise, vWPos.xz * 0.045);
          vec4 nB = texture2D(tNoise, vWPos.xz * 0.31);
          float detail = 0.82 + nA.g * 0.22 + (nB.b - 0.5) * 0.28;
          diffuseColor.rgb *= detail;`,
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.disposables.push(geo, mat, tex);
    // distant ground skirt so the horizon doesn't show the edge
    const skirt = new THREE.Mesh(new THREE.RingGeometry(FIELD_SIZE * 0.5, FIELD_SIZE * 4, 32, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(grass2[0], grass2[1], grass2[2]).convertSRGBToLinear().multiplyScalar(0.9), roughness: 1 }));
    skirt.position.y = f.heightAt(FIELD_SIZE / 2, 0) - 2;
    this.scene.add(skirt);
    this.disposables.push(skirt.geometry, skirt.material as THREE.Material);
  }

  private buildVegetation(season: number) {
    const f = this.field;
    const geoms = treeGeometries();
    const mat = makeVegMaterial();
    this.savedFade = [vegUniforms.uFadeStart.value, vegUniforms.uFadeEnd.value];
    vegUniforms.uFadeStart.value = 2500;
    vegUniforms.uFadeEnd.value = 3500;
    vegUniforms.uWinter.value = f.snowy ? 1 : 0;
    vegUniforms.uAutumn.value = season === 2 && !f.snowy ? 1 : 0;
    const density = Math.max(0.3, this.settings.vegetation);
    const r = new Rng(f.setup.seed + 17);
    for (let kind = 0; kind < 6; kind++) {
      const list = kind === 5 ? f.rocks.map((q) => ({ ...q, kind: 5 })) : f.trees.filter((t) => t.kind === kind && (Math.abs(t.x) > PLAY || Math.abs(t.z) > PLAY || r.chance(density)));
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geoms[kind], mat, list.length);
      list.forEach((t, i) => {
        const y = f.heightAt(t.x, t.z) - 0.3;
        tmpQ.setFromAxisAngle(UP, hash01(t.x, t.z) * Math.PI * 2);
        const s = t.s * (kind === 5 ? 1 : 0.9);
        tmpM.compose(tmpP.set(t.x, y, t.z), tmpQ, tmpS.set(s, s * (kind === 5 ? 0.8 : 1), s));
        im.setMatrixAt(i, tmpM);
      });
      im.castShadow = this.settings.shadows >= 1;
      im.receiveShadow = true;
      this.scene.add(im);
      this.disposables.push(geoms[kind]);
    }
    this.disposables.push(mat);
    // grass tufts for close-up detail
    if (!f.snowy) {
      const tuft = new THREE.BufferGeometry();
      const verts: number[] = [];
      const cols: number[] = [];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI;
        const dx = Math.cos(a) * 0.22;
        const dz = Math.sin(a) * 0.22;
        const lean = (k % 2 ? 0.08 : -0.08) * 1;
        verts.push(-dx, 0, -dz, dx, 0, dz, lean, 0.55 + (k % 3) * 0.1, 0);
        cols.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 1.25, 1.25, 1.1);
      }
      tuft.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      tuft.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      tuft.computeVertexNormals();
      const gc = f.arid ? new THREE.Color(0.62, 0.55, 0.36) : season === 2 ? new THREE.Color(0.55, 0.45, 0.22) : new THREE.Color(0.33, 0.45, 0.16);
      const gm = new THREE.MeshStandardMaterial({ color: gc, vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
      const count = Math.floor(26000 * density);
      const im = new THREE.InstancedMesh(tuft, gm, count);
      let n = 0;
      for (let k = 0; k < count * 2 && n < count; k++) {
        const x = r.range(-PLAY - 60, PLAY + 60);
        const z = r.range(-PLAY - 60, PLAY + 60);
        if (f.fort && (f.inside(x, z) || Math.abs(z - f.wallZ(clamp(x, -f.fort.halfW, f.fort.halfW))) < 12)) continue;
        if (f.waterDepth(x, z) > 0 || f.slopeAt(x, z) > 0.5) continue;
        const y = f.heightAt(x, z);
        tmpQ.setFromAxisAngle(UP, r.next() * 6.28);
        const s = r.range(0.7, 1.5);
        tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(s, s * r.range(0.8, 1.3), s));
        im.setMatrixAt(n++, tmpM);
      }
      im.count = n;
      im.receiveShadow = true;
      this.scene.add(im);
      this.disposables.push(tuft, gm);
    }
  }

  private buildRiver() {
    const f = this.field;
    const pts: number[] = [];
    const idx: number[] = [];
    const W = f.river.width * 1.6;
    let k = 0;
    for (let x = -FIELD_SIZE / 2; x <= FIELD_SIZE / 2; x += 4) {
      const z = f.riverZ(x);
      pts.push(x, f.river.level, z - W, x, f.river.level, z + W);
      if (k > 0) {
        const a = (k - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nm = waterNormalTexture();
    const m = new THREE.MeshStandardMaterial({ color: 0x2c4a52, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82, normalMap: nm, normalScale: new THREE.Vector2(0.4, 0.4) });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shipUniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP2;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP2 = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWP2;')
        .replace('#include <normal_fragment_maps>', `vec3 mapN = texture2D(normalMap, vWP2.xz * 0.06 + vec2(uTime * 0.05, 0.0)).xyz * 2.0 - 1.0; mapN.xy *= normalScale; normal = normalize(tbn * mapN);`);
    };
    this.water = new THREE.Mesh(g, m);
    this.water.renderOrder = 1;
    this.scene.add(this.water);
    this.disposables.push(g, m);
  }

  // ------------------------------------------------------------------ fortifications
  private buildFort(faction: string) {
    const f = this.field;
    const fort = f.fort!;
    const style = factionDef(faction).arch;
    const mats = archMaterials();
    const stoneC = new THREE.Color(style.stone);
    const dark = new THREE.Color(style.stone).multiplyScalar(0.75);
    const H = fort.height;
    const thick = 3.4;
    const add = (b: Bucket, m: THREE.Material, list?: THREE.Mesh[]) => {
      const g = b.build();
      if (!g) return null;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.disposables.push(g);
      list?.push(mesh);
      return mesh;
    };
    // wall segments (intact and pre-built rubble)
    fort.segs.forEach((s, si) => {
      const b = new Bucket();
      const rb = new Bucket();
      const steps = Math.max(2, Math.ceil((s.x1 - s.x0) / 3));
      const r = new Rng(si * 97 + 5);
      for (let k = 0; k < steps; k++) {
        const xa = s.x0 + ((s.x1 - s.x0) * k) / steps;
        const xb = s.x0 + ((s.x1 - s.x0) * (k + 1)) / steps;
        const za = f.wallZ(xa);
        const zb = f.wallZ(xb);
        const cx = (xa + xb) / 2;
        const cz = (za + zb) / 2;
        const len = Math.hypot(xb - xa, zb - za) + 0.05;
        const yaw = Math.atan2(xb - xa, zb - za) - Math.PI / 2;
        const gy = Math.min(f.heightAt(xa, za), f.heightAt(xb, zb)) - 1.5;
        const top = f.heightAt(cx, cz) + H;
        box(b, cx, gy, cz, len, top - gy, thick, yaw, stoneC, 0.2);
        // parapet merlons on the outer (attacker) edge
        const ox = Math.sin(yaw) * (thick / 2 - 0.3);
        const oz = Math.cos(yaw) * (thick / 2 - 0.3);
        merlons(b, xa + ox, za + oz, xb + ox, zb + oz, top, 0.6, stoneC, 0.9);
        // rubble
        const rh = r.range(0.25, 0.45) * H;
        box(rb, cx, gy, cz, len, rh + r.range(-1, 1), thick * 1.3, yaw + r.range(-0.1, 0.1), dark, 0.2);
        for (let q = 0; q < 3; q++) box(rb, cx + r.range(-3, 3), gy + 1.2, cz + r.range(2, 7), r.range(0.8, 1.8), r.range(0.6, 1.4), r.range(0.8, 1.6), r.range(0, 3), dark, 0.25);
      }
      const intact: THREE.Mesh[] = [];
      const rubble: THREE.Mesh[] = [];
      add(b, mats.stone, intact);
      add(rb, mats.stone, rubble);
      for (const m of rubble) m.visible = false;
      this.wallMeshes.push({ seg: si, intact, rubble });
    });
    // gate arch above the opening and the doors
    {
      const b = new Bucket();
      const gz = f.wallZ(0);
      const gy = f.heightAt(0, gz);
      box(b, 0, gy + 6.2, gz, fort.gate.x1 - fort.gate.x0 + 0.2, H - 6.2 + 0.5, thick, 0, stoneC, 0.2);
      merlons(b, fort.gate.x0, gz + thick / 2 - 0.3, fort.gate.x1, gz + thick / 2 - 0.3, gy + H + 0.5, 0.6, stoneC, 0.9);
      add(b, mats.stone);
      const d = new Bucket();
      const wood = new THREE.Color(0.45, 0.32, 0.2);
      box(d, 0, gy - 0.5, gz + 0.4, fort.gate.x1 - fort.gate.x0, 6.9, 0.7, 0, wood, 0.3);
      for (let y = 1; y < 6; y += 1.8) box(d, 0, gy + y, gz + 0.85, fort.gate.x1 - fort.gate.x0, 0.25, 0.1, 0, new THREE.Color(0.2, 0.2, 0.22), 0.3);
      this.gateDoors = add(d, mats.wood);
      const bd = new Bucket();
      const r = new Rng(3);
      for (let q = 0; q < 7; q++) box(bd, r.range(-6, 6), gy, gz + r.range(-1, 4), r.range(0.4, 0.8), 0.25, r.range(2, 4), r.range(-1, 1), wood, 0.3);
      this.gateBroken = add(bd, mats.wood);
      if (this.gateBroken) this.gateBroken.visible = false;
    }
    // towers
    for (const t of fort.towers) {
      const b = new Bucket();
      const roof = new Bucket();
      const ruin = new Bucket();
      const gy = f.heightAt(t.x, t.z) - 1.5;
      const th = H + 6;
      cylinder(b, t.x, gy, t.z, 5.4, 5.0, th + 1.5, 12, stoneC, true, 0.2);
      if (style.towerTop === 'crenel' || style.towerTop === 'dome') {
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          box(b, t.x + Math.cos(a) * 4.7, gy + th + 1.5, t.z + Math.sin(a) * 4.7, 1.3, 1.2, 0.7, -a + Math.PI / 2, stoneC, 0.25);
        }
      } else cone(roof, t.x, gy + th + 1.5, t.z, 6.2, style.towerTop === 'spire' ? 9 : 6, 12, new THREE.Color(style.roof));
      cylinder(ruin, t.x, gy, t.z, 5.6, 4.6, th * 0.35, 10, dark, true, 0.2);
      const intact: THREE.Object3D[] = [];
      const ruinL: THREE.Object3D[] = [];
      const m1 = add(b, mats.stone);
      const m2 = add(roof, mats.roof);
      const m3 = add(ruin, mats.stone);
      if (m1) intact.push(m1);
      if (m2) intact.push(m2);
      if (m3) {
        m3.visible = false;
        ruinL.push(m3);
      }
      // defender banner on each tower
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6, 5), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
      pole.position.set(t.x, gy + th + (style.towerTop === 'spire' ? 13 : 10), t.z);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2, 8, 2).translate(1.6, 0, 0), makeFlagMaterial(faction));
      flag.position.set(t.x, pole.position.y + 1.8, t.z);
      this.scene.add(pole, flag);
      intact.push(pole, flag);
      this.towerMeshes.push({ intact, ruin: ruinL });
    }
    // houses
    const plaster = new Bucket();
    const roofB = new Bucket();
    const timber = new Bucket();
    const r = new Rng(77);
    const plasterC = new THREE.Color(style.plaster);
    const roofC = new THREE.Color(style.roof);
    const roofC2 = new THREE.Color(style.roof2);
    for (const h of fort.houses) {
      const gy = f.heightAt(h.x, h.z) - 0.8;
      const pc = plasterC.clone().multiplyScalar(r.range(0.85, 1.08));
      const rc = (r.chance(0.5) ? roofC : roofC2).clone().multiplyScalar(r.range(0.85, 1.1));
      box(plaster, h.x, gy, h.z, h.w, h.h + 0.8, h.d, h.rot, pc, 0.25, false);
      gableRoof(roofB, plaster, h.x, gy + h.h + 0.8, h.z, h.w, h.d, h.d * 0.45, h.rot, rc, pc, 0.5);
      if (r.chance(0.4)) box(timber, h.x, gy + h.h * 0.55, h.z, h.w + 0.1, 0.3, h.d + 0.1, h.rot, new THREE.Color(0.3, 0.2, 0.12), 0.3);
    }
    add(plaster, mats.plaster);
    add(roofB, mats.roof);
    add(timber, mats.wood);
    // the town square: a banner and a capture ring
    const pl = fort.plaza;
    const py = f.heightAt(pl.x, pl.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 14, 6), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
    pole.position.set(pl.x, py + 7, pl.z);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.4, 8, 2).translate(2.5, 0, 0), makeFlagMaterial(faction));
    flag.position.set(pl.x, py + 12, pl.z);
    this.scene.add(pole, flag);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(pl.r * 2, pl.r * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, color: 0xf2d98a, polygonOffset: true, polygonOffsetFactor: -4 }));
    ring.position.set(pl.x, py + 0.3, pl.z);
    this.scene.add(ring);
    this.captureRing = ring;
  }

  // ------------------------------------------------------------------ figures
  private batch(key: string, cap: number): FigureBatch {
    let b = this.batches.get(key);
    if (!b) {
      b = new FigureBatch(key, cap, this.settings.shadows > 0);
      this.batches.set(key, b);
      this.scene.add(b.mesh);
    } else b.ensure(b.count + cap);
    return b;
  }
  private buildFigures() {
    const wood = woodMat();
    const iron = new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.6, roughness: 0.5 });
    const hide = new THREE.MeshStandardMaterial({ color: 0x6b5238, roughness: 1 });
    this.disposables.push(wood, iron, hide);
    for (const u of this.sim.units) {
      const def = factionDef(u.faction);
      const ca = new THREE.Color(def.color);
      const cb = new THREE.Color(def.color2);
      const emb = emblemIndex(u.faction);
      const key = u.def.category === 'siege' ? 'crew' : u.def.id;
      const b = this.batch(key, u.soldiers.length);
      let hb: FigureBatch | undefined;
      if (u.def.visual.mounted) hb = this.batch(u.def.visual.barded ? 'horse_barded' : 'horse', u.soldiers.length);
      for (const s of u.soldiers) {
        const i = b.count++;
        const skin = Math.floor(s.seed * 5.99);
        const variant = 1 + Math.floor(hash01(s.id, 3) * 2.99);
        b.set(i, s.x, s.y, s.z, s.yaw, 0, 0, 1, s.seed, ca, cb, skin, emb, s.general ? 1.08 : 1, variant);
        const slot: (typeof this.soldierSlot)[0] = { batch: b, index: i };
        if (hb) {
          const hi = hb.count++;
          hb.set(hi, s.x, s.y, s.z, s.yaw, 0, 0, 1, s.seed, ca, cb, 0, emb, 1, 1);
          slot.horse = hb;
          slot.hIndex = hi;
        }
        this.soldierSlot[s.id] = slot;
      }
      if (u.def.category === 'siege') {
        const g = buildEngine(u.def.id, wood, iron, hide);
        this.scene.add(g);
        this.engines.push({ unit: u, group: g, arm: g.arm, log: g.log });
      }
      // unit banner
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 5), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.05, 6, 2).translate(0.75, 0, 0), makeFlagMaterial(u.faction));
      this.scene.add(pole, flag);
      this.banners.set(u.id, { pole, flag });
    }
    for (const b of this.batches.values()) b.commit(true);
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, simDt: number, audio: ((kind: string, x: number, z: number, vol?: number) => void) | null) {
    this.time += simDt;
    figureUniforms.uTime.value = this.sim.time;
    shipUniforms.uTime.value += dt;
    vegUniforms.uTime.value += dt;
    archUniforms.uLamp.value = this.env.lampFactor;
    this.cam.update(dt);
    const cam = this.cam.camera;
    this.env.update(dt, cam, this.cam.target, this.cam.distance);
    const sc = this.env.sun.shadow.camera as THREE.OrthographicCamera;
    const r = clamp(this.cam.distance * 0.9, 80, 520);
    if (sc.right !== r) {
      sc.left = -r;
      sc.right = r;
      sc.top = r;
      sc.bottom = -r;
      sc.near = 10;
      sc.far = r * 6 + 1200;
      sc.updateProjectionMatrix();
    }
    this.updateFigures();
    this.updateProjectiles();
    this.updateEngines(dt);
    this.updateFortVisuals();
    this.updateSelection();
    this.handleEvents(audio);
    // ambient dust from moving cavalry
    if (simDt > 0) {
      for (const u of this.sim.units) {
        if (!u.def.visual.mounted || u.state === 'dead' || u.state === 'fled') continue;
        for (const s of u.soldiers) {
          if (!s.alive || s.fled || s.speed < 6) continue;
          if (Math.random() < simDt * 1.2 && !this.field.snowy) this.dust.emit(s.x, s.y + 0.4, s.z, -s.vx * 0.1, 0.6, -s.vz * 0.1, 2.2, 2.5, 0.55, 0.48, 0.38, 1.4);
        }
      }
    }
    const fog = this.scene.fog as THREE.FogExp2;
    const h = window.innerHeight;
    this.dust.update(dt, fog, h);
    this.smoke.update(dt, fog, h);
    this.sparks.update(dt, fog, h);
    this.precip.update(dt, cam.position, this.env.rain, this.env.snow, 1 + this.env.storm * 2);
  }

  private updateFigures() {
    const sim = this.sim;
    const t = sim.time;
    for (const s of sim.soldiers) {
      const slot = this.soldierSlot[s.id];
      if (!slot) continue;
      const def = s.u.def;
      if (s.fled) {
        slot.batch.setMotion(slot.index, 0, -200, 0, 0, 0, 0, 0);
        if (slot.horse) slot.horse.setMotion(slot.hIndex!, 0, -200, 0, 0, 0, 0, 0);
        continue;
      }
      const v = s.speed;
      if (slot.horse) {
        const hs = !s.alive ? HANIM.dead : v > 6 ? HANIM.gallop : v > 2.6 ? HANIM.trot : v > 0.3 ? HANIM.walk : HANIM.idle;
        const hsp = hs === HANIM.gallop ? v / 5.5 : hs === HANIM.trot ? v / 3.2 : v / 1.8;
        slot.horse.setMotion(slot.hIndex!, s.x, s.y, s.z, s.yaw, hs, hs === HANIM.dead ? s.deathT : 0, Math.max(0.4, hsp));
        const ra = !s.alive ? ANIM.dead : s.anim === ANIM.attack || s.anim === ANIM.thrust || s.anim === ANIM.hit ? s.anim : s.anim === ANIM.charge ? ANIM.charge : s.anim === 17 ? ANIM.cheer : ANIM.ride;
        const ry = !s.alive ? s.y : s.y + 0.72;
        slot.batch.setMotion(slot.index, s.x, ry, s.z, s.yaw, ra, s.animT, Math.max(0.3, hsp));
      } else {
        let a = s.alive ? s.anim : ANIM.dead;
        let sp = 1;
        if (a === ANIM.walk) sp = Math.max(0.5, v / 1.5);
        else if (a === ANIM.run || a === ANIM.flee) sp = Math.max(0.8, v / 2.8);
        else if (a === 18) sp = 1.2;
        if (def.category === 'siege' && s.alive && a === 0 && s.u.engineArm > 0.5) a = ANIM.work;
        slot.batch.setMotion(slot.index, s.x, s.climbing ? s.y : s.y, s.z, s.yaw, a, s.alive ? s.animT : s.deathT, sp);
      }
    }
    for (const b of this.batches.values()) b.commit(false);
    // banners follow unit centroids
    for (const u of sim.units) {
      const bn = this.banners.get(u.id);
      if (!bn) continue;
      const vis = u.state !== 'dead' && u.state !== 'fled';
      bn.pole.visible = bn.flag.visible = vis;
      if (!vis) continue;
      // carried by a soldier near the front centre
      let bx = u.cx;
      let bz = u.cz;
      let by = this.sim.groundY(u.cx, u.cz);
      const carrier = u.soldiers.find((s) => s.alive && !s.fled && s.slot === Math.floor(Math.min(u.alive, u.cols) / 2));
      if (carrier) {
        bx = carrier.x - Math.sin(carrier.yaw) * 0.3;
        bz = carrier.z - Math.cos(carrier.yaw) * 0.3;
        by = carrier.y + (carrier.mounted ? 0.9 : 0);
      }
      bn.pole.position.set(bx, by + 2.1 + (u.def.visual.mounted ? 1 : 0), bz);
      bn.flag.position.set(bx, by + 3.7 + (u.def.visual.mounted ? 1 : 0), bz);
      bn.flag.rotation.y = -0.6 + Math.sin(t * 0.3 + u.id) * 0.2;
      bn.flag.visible = u.state !== 'routing';
    }
  }

  private updateProjectiles() {
    let na = 0;
    let ns = 0;
    const dir = new THREE.Vector3();
    for (const p of this.sim.projectiles) {
      if (!p.alive) continue;
      if (p.kind === 'stone') {
        if (ns >= 200) continue;
        tmpQ.setFromEuler(new THREE.Euler(p.t * 3, p.t * 2, 0));
        tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(1, 1, 1));
        this.stones.setMatrixAt(ns++, tmpM);
        if (Math.random() < 0.3) this.smoke.emit(p.x, p.y, p.z, 0, 0.2, 0, 1.2, 1.2, 0.6, 0.58, 0.55, 1);
      } else {
        if (na >= 4000) continue;
        dir.set(p.vx, p.vy, p.vz).normalize();
        tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(1, 1, p.kind === 'bolt' ? 0.6 : 1));
        this.arrows.setMatrixAt(na++, tmpM);
      }
    }
    this.arrows.count = na;
    this.stones.count = ns;
    this.arrows.instanceMatrix.needsUpdate = true;
    this.stones.instanceMatrix.needsUpdate = true;
    // ladders for climbing soldiers
    let nl = 0;
    const f = this.field;
    if (f.fort) {
      const seen = new Set<number>();
      for (const s of this.sim.soldiers) {
        if (!s.alive || !s.climbing || nl >= 300) continue;
        const key = Math.round(s.x / 2.5);
        if (seen.has(key)) continue;
        seen.add(key);
        const x = key * 2.5;
        const wz = f.wallZ(x);
        const gy = f.heightAt(x, wz + 2);
        tmpQ.setFromEuler(new THREE.Euler(-0.28, 0, 0));
        tmpM.compose(tmpP.set(x, gy, wz + 2.6), tmpQ, tmpS.set(1, f.fort.height + 1.5, 1));
        this.ladders.setMatrixAt(nl++, tmpM);
      }
    }
    this.ladders.count = nl;
    this.ladders.instanceMatrix.needsUpdate = true;
  }

  private updateEngines(dt: number) {
    for (const e of this.engines) {
      const u = e.unit;
      const vis = u.state !== 'dead' && u.alive > 0;
      if (!vis) {
        // abandoned engine stays where it stopped
        continue;
      }
      const f = this.field;
      let ex = u.cx;
      let ez = u.cz;
      if (u.def.id === 'ram') {
        // the crew are under the shed
      } else {
        ex = u.cx + Math.sin(u.facing) * 4;
        ez = u.cz + Math.cos(u.facing) * 4;
      }
      const gy = f.heightAt(ex, ez);
      e.group.position.set(ex, gy, ez);
      e.group.rotation.y = u.facing;
      if (e.arm) {
        const k = u.engineArm;
        const tre = u.def.id === 'trebuchet';
        e.arm.rotation.x = tre ? -0.9 + (1 - k) * 0 + k * 2.2 : 0.9 - k * 1.6;
      }
      if (e.log) e.log.position.z = -Math.sin(u.engineArm * Math.PI) * 1.4;
      void dt;
    }
  }

  private updateFortVisuals() {
    const f = this.field.fort;
    if (!f) return;
    this.wallMeshes.forEach((w) => {
      const s = f.segs[w.seg];
      for (const m of w.intact) m.visible = !s.breached;
      for (const m of w.rubble) m.visible = s.breached;
    });
    f.towers.forEach((t, i) => {
      const tm = this.towerMeshes[i];
      if (!tm) return;
      for (const m of tm.intact) m.visible = t.alive;
      for (const m of tm.ruin) m.visible = !t.alive;
    });
    if (this.gateDoors) this.gateDoors.visible = !f.gate.open;
    if (this.gateBroken) this.gateBroken.visible = f.gate.open;
    if (this.captureRing) {
      const m = this.captureRing.material as THREE.MeshBasicMaterial;
      const c = this.sim.capture;
      m.color.setRGB(0.95, 0.85 - c * 0.6, 0.54 - c * 0.4);
      m.opacity = 0.5 + c * 0.5 + Math.sin(this.sim.time * 4) * 0.1 * c;
    }
  }

  private updateSelection() {
    let n = 0;
    const col = this.selRings.instanceColor!;
    const put = (s: Soldier, r: number, g: number, b: number) => {
      if (n >= 5000) return;
      const size = s.mounted ? 2.6 : 1.2;
      tmpM.compose(tmpP.set(s.x, s.y + 0.12, s.z), tmpQ.identity(), tmpS.set(size, 1, size));
      this.selRings.setMatrixAt(n, tmpM);
      col.setXYZ(n, r, g, b);
      n++;
    };
    for (const u of this.selected) {
      if (u.state === 'dead' || u.state === 'fled') continue;
      for (const s of u.soldiers) if (s.alive && !s.fled) put(s, 0.95, 0.85, 0.5);
    }
    const h = this.hovered;
    if (h && !this.selected.has(h) && h.state !== 'dead' && h.state !== 'fled') {
      const enemy = h.side !== this.playerSide;
      for (const s of h.soldiers) if (s.alive && !s.fled) put(s, enemy ? 0.9 : 0.8, enemy ? 0.3 : 0.8, enemy ? 0.25 : 0.8);
    }
    this.selRings.count = n;
    this.selRings.instanceMatrix.needsUpdate = true;
    col.needsUpdate = true;
    // order preview
    let g = 0;
    for (const p of this.ghostPts) {
      if (g >= 5000) break;
      tmpM.compose(tmpP.set(p.x, this.sim.groundY(p.x, p.z) + 0.15, p.z), tmpQ.identity(), tmpS.set(1, 1, 1));
      this.ghosts.setMatrixAt(g++, tmpM);
    }
    this.ghosts.count = g;
    this.ghosts.instanceMatrix.needsUpdate = true;
  }
  playerSide: number | null = null;

  private handleEvents(audio: ((kind: string, x: number, z: number, vol?: number) => void) | null) {
    const ev = this.sim.events;
    for (const e of ev) {
      const y = this.sim.groundY(e.x, e.z);
      switch (e.kind) {
        case 'impact':
          for (let k = 0; k < 10; k++) this.dust.emit(e.x + (Math.random() - 0.5) * 3, y + 1, e.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 3.5, 3.5, 0.5, 0.46, 0.4, 1.6);
          audio?.('impact', e.x, e.z);
          break;
        case 'breach':
        case 'towerFall':
          for (let k = 0; k < 40; k++) this.dust.emit(e.x + (Math.random() - 0.5) * 20, y + Math.random() * 8, e.z + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 3, 7, 7, 0.55, 0.5, 0.44, 1.5);
          audio?.('impact', e.x, e.z, 1.6);
          audio?.('horn', e.x, e.z);
          break;
        case 'gate':
          for (let k = 0; k < 6; k++) this.sparks.emit(e.x + (Math.random() - 0.5) * 5, y + 2, e.z + 1, (Math.random() - 0.5) * 3, Math.random() * 3, 2, 0.5, 0.5, 1, 0.8, 0.5, 0);
          audio?.('wood', e.x, e.z, 1.3);
          break;
        case 'gateOpen':
          for (let k = 0; k < 25; k++) this.dust.emit(e.x + (Math.random() - 0.5) * 12, y + 2, e.z + (Math.random() - 0.5) * 6, 0, 1.5, 0, 5, 4, 0.5, 0.45, 0.38, 1.3);
          audio?.('wood', e.x, e.z, 1.8);
          audio?.('horn', e.x, e.z);
          break;
        case 'clash':
          audio?.('clash', e.x, e.z);
          break;
        case 'hit':
          audio?.('hit', e.x, e.z);
          break;
        case 'shoot':
          audio?.(e.unit?.def.category === 'crossbow' ? 'bow' : 'arrow', e.x, e.z);
          break;
        case 'stone':
          audio?.('wood', e.x, e.z, 1.2);
          break;
        case 'charge':
          audio?.('hooves', e.x, e.z, 1.3);
          audio?.('shout', e.x, e.z);
          break;
        case 'rout':
        case 'rally':
        case 'shout':
          audio?.('shout', e.x, e.z);
          break;
        case 'horn':
          audio?.('horn', e.x, e.z);
          break;
        case 'death':
          if (Math.random() < 0.3) audio?.('hit', e.x, e.z, 0.6);
          break;
      }
    }
    this.lastEvents = ev.length;
  }

  /** Ray-march the battlefield heightfield. */
  pickGround(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.cam.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    let t = 0;
    let prev = 0;
    let step = Math.max(0.5, this.cam.distance * 0.004);
    const f = this.field;
    while (t < 5000) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      if (y <= f.heightAt(x, z)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m <= f.heightAt(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        return new THREE.Vector3(o.x + d.x * hi, f.heightAt(o.x + d.x * hi, o.z + d.z * hi), o.z + d.z * hi);
      }
      prev = t;
      t += step;
      step *= 1.01;
    }
    return null;
  }

  private savedFade: [number, number] = [1300, 1900];
  dispose() {
    vegUniforms.uFadeStart.value = this.savedFade[0];
    vegUniforms.uFadeEnd.value = this.savedFade[1];
    for (const b of this.batches.values()) b.dispose();
    for (const d of this.disposables) d.dispose();
    this.env.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !this.disposables.includes(m.geometry)) m.geometry.dispose();
    });
  }
}
