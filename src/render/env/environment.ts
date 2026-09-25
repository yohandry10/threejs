import * as THREE from 'three';
import { SkyDome, makeSkyUniforms, type SkyUniforms } from './sky';
import { noiseTexture } from '../textures';
import type { WeatherKind } from '../../sim/types';
import { clamp, lerp, smoothstep } from '../../core/math';

/**
 * Time of day, sun/moon lighting, sky, fog and weather presentation.
 * Visual time is independent from campaign turns.
 */
export class Environment {
  sky: SkyDome;
  uniforms: SkyUniforms;
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd6ff, 0x3a3326, 0.6);
  fog = new THREE.FogExp2(0x9fb2c4, 0.00012);
  /** 0..1, 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset */
  t = 0.7;
  dayLength = 720; // seconds per full visual day
  paused = false;
  time = 0;
  weather: WeatherKind = 'clear';
  season = 0;
  /** smoothed weather params */
  overcast = 0;
  rain = 0;
  snow = 0;
  fogAmt = 0;
  storm = 0;
  waveScale = 1;
  baseFogDensity = 0.00009;
  lightning = 0;
  private lightningTimer = 4;
  sunDir = new THREE.Vector3();
  nightFactor = 0;
  shadowTarget = new THREE.Object3D();

  constructor(public scene: THREE.Scene) {
    this.uniforms = makeSkyUniforms();
    this.sky = new SkyDome(this.uniforms, noiseTexture());
    scene.add(this.sky.mesh);
    scene.add(this.sun, this.hemi, this.shadowTarget);
    this.sun.target = this.shadowTarget;
    scene.fog = this.fog;
  }

  setWeather(w: WeatherKind, season: number, instant = false) {
    this.weather = w;
    this.season = season;
    if (instant) {
      const t = this.targets();
      this.overcast = t.overcast;
      this.rain = t.rain;
      this.snow = t.snow;
      this.fogAmt = t.fog;
      this.storm = t.storm;
    }
  }

  private targets() {
    const w = this.weather;
    return {
      overcast: w === 'clear' ? 0.05 : w === 'cloudy' ? 0.55 : w === 'fog' ? 0.5 : w === 'rain' ? 0.75 : w === 'snow' ? 0.7 : 0.95,
      rain: w === 'rain' ? 0.7 : w === 'storm' ? 1 : 0,
      snow: w === 'snow' ? 1 : 0,
      fog: w === 'fog' ? 1 : w === 'rain' || w === 'storm' ? 0.35 : w === 'snow' ? 0.4 : 0,
      storm: w === 'storm' ? 1 : 0,
    };
  }

  update(dt: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3, viewRadius: number) {
    this.time += dt;
    if (!this.paused) this.t = (this.t + dt / this.dayLength) % 1;
    const tg = this.targets();
    const k = 1 - Math.exp(-dt * 0.5);
    this.overcast = lerp(this.overcast, tg.overcast, k);
    this.rain = lerp(this.rain, tg.rain, k);
    this.snow = lerp(this.snow, tg.snow, k);
    this.fogAmt = lerp(this.fogAmt, tg.fog, k);
    this.storm = lerp(this.storm, tg.storm, k);
    this.waveScale = 1 + this.storm * 1.4 + this.overcast * 0.25;

    // sun path: rises east (+x), culminates south (+z), sets west (-x)
    const theta = (this.t - 0.25) * Math.PI * 2;
    const sd = this.sunDir.set(Math.cos(theta), Math.sin(theta) * 0.82, 0.18 + 0.45 * Math.max(0, Math.sin(theta))).normalize();
    const sunH = sd.y;
    const night = 1 - smoothstep(-0.18, 0.04, sunH);
    const sunset = (1 - smoothstep(0.02, 0.32, sunH)) * smoothstep(-0.2, 0.0, sunH);
    this.nightFactor = night;
    const u = this.uniforms;
    u.uSunDir.value.copy(sd);
    u.uMoonDir.value.set(-sd.x, Math.max(0.25, -sd.y * 0.8 + 0.2), -0.3 + sd.z * 0.2).normalize();
    u.uNight.value = night;
    u.uSunset.value = sunset * (1 - this.overcast * 0.6);
    u.uOvercast.value = this.overcast;
    const sunCol = new THREE.Color().setRGB(1.0, lerp(0.95, 0.52, sunset), lerp(0.88, 0.26, sunset));
    u.uSunColor.value.copy(sunCol);

    // directional light: sun by day, moon by night
    const lightDir = night > 0.5 ? u.uMoonDir.value : sd;
    const dayI = smoothstep(-0.02, 0.2, sunH) * (1 - this.overcast * 0.65);
    const moonI = night * 0.55 * (1 - this.overcast * 0.5);
    this.sun.intensity = dayI * 3.1 + moonI;
    this.sun.color.copy(night > 0.5 ? new THREE.Color(0.55, 0.65, 0.95) : sunCol);
    // light position relative to focus (for shadows)
    this.shadowTarget.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(lightDir, Math.max(400, viewRadius * 2));
    this.shadowTarget.updateMatrixWorld();
    // ambient (never pitch black)
    const skyAmb = new THREE.Color().setRGB(lerp(0.55, 0.16, night), lerp(0.66, 0.2, night), lerp(0.82, 0.34, night));
    skyAmb.lerp(new THREE.Color(0.95, 0.62, 0.45), sunset * 0.35);
    this.hemi.color.copy(skyAmb);
    this.hemi.groundColor.setRGB(lerp(0.34, 0.07, night), lerp(0.3, 0.08, night), lerp(0.24, 0.1, night));
    this.hemi.intensity = lerp(0.85, 1.25, night) * (1 + this.overcast * 0.35);

    // lightning
    this.lightning = Math.max(0, this.lightning - dt * 4);
    if (this.storm > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightning = 1;
        this.lightningTimer = 3 + Math.random() * 9;
      }
    }
    if (this.lightning > 0) this.hemi.intensity += this.lightning * 2.5;

    // fog colour follows the horizon
    const horizon = new THREE.Color().setRGB(lerp(0.58, 0.035, night), lerp(0.68, 0.055, night), lerp(0.8, 0.11, night));
    horizon.lerp(new THREE.Color(0.95, 0.55, 0.32), sunset * 0.45);
    const grey = new THREE.Color(0.52, 0.55, 0.6).multiplyScalar(1 - night * 0.8);
    horizon.lerp(grey, this.overcast * 0.6);
    this.fog.color.copy(horizon);
    u.uFogTint.value.copy(horizon);
    const scaleFog = clamp(1500 / Math.max(300, viewRadius), 0.4, 3);
    this.fog.density = this.baseFogDensity * scaleFog * (1 + this.fogAmt * 6 + this.rain * 1.5 + this.snow * 2);
    this.sky.update(camera, this.time, clamp(this.overcast + 0.25, 0, 1));
  }

  /** Emissive boost for windows / torches at dusk and night. */
  get lampFactor() {
    return smoothstep(0.25, 0.85, this.nightFactor + this.overcast * 0.25 + this.uniforms.uSunset.value * 0.35);
  }

  dispose() {
    this.scene.remove(this.sky.mesh, this.sun, this.hemi, this.shadowTarget);
    this.sky.dispose();
    this.sun.dispose();
    this.hemi.dispose();
  }
}
