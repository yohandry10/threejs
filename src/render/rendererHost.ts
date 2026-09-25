import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Settings } from '../persistence/settings';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.28 }, uSat: { value: 1.06 }, uContrast: { value: 1.04 }, uWarm: { value: 0.0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSat; uniform float uContrast; uniform float uWarm;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      c.rgb += vec3(0.02, 0.01, -0.01) * uWarm;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * uVignette * 1.6;
      gl_FragColor = c;
    }`,
};

/** Owns the WebGL renderer and post-processing chain. Scenes render through it. */
export class RendererHost {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  fxaa: ShaderPass;
  output: OutputPass;
  width = 1;
  height = 1;
  contextLost = false;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  constructor(public canvas: HTMLCanvasElement, public settings: Settings) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = settings.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera();
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: settings.antialias ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(scene, cam);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextRestored?.();
    });
    this.applySettings(settings);
    this.resize();
  }
  applySettings(s: Settings) {
    this.settings = s;
    this.renderer.shadowMap.enabled = s.shadows > 0;
    this.bloom.enabled = s.postprocessing && s.bloom;
    this.grade.enabled = s.postprocessing;
    this.fxaa.enabled = !s.antialias;
    const rt = this.composer.renderTarget1;
    const samples = s.antialias ? 4 : 0;
    if (rt.samples !== samples) {
      this.composer.renderTarget1.samples = samples;
      this.composer.renderTarget2.samples = samples;
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    this.resize();
  }
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = Math.min(2, window.devicePixelRatio || 1) * this.settings.resolutionScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    (this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / (w * pr), 1 / (h * pr));
  }
  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.contextLost) return;
    this.renderer.info.reset();
    const env = scene.userData.environment as { needsBake(): boolean; bake(r: THREE.WebGLRenderer): void } | undefined;
    if (env && env.needsBake()) env.bake(this.renderer);
    const ocean = scene.userData.ocean as { renderReflection(r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera): void } | undefined;
    if (ocean && this.settings.water >= 1) ocean.renderReflection(this.renderer, scene, camera);
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }
  get stats() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
  }
  dispose() {
    this.composer.dispose();
    this.renderer.dispose();
  }
}
