import type { Settings } from '../persistence/settings';

type Mood = 'menu' | 'peace' | 'tension' | 'battle' | 'victory' | 'defeat';

interface AmbientLayer {
  gain: GainNode;
  target: number;
}

const SCALES: Record<string, number[]> = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const MOODS: Record<Mood, { scale: string; root: number; tempo: number; density: number; drums: number; pad: number; lute: number; brass: number }> = {
  menu: { scale: 'dorian', root: 50, tempo: 64, density: 0.55, drums: 0, pad: 0.9, lute: 0.7, brass: 0 },
  peace: { scale: 'mixolydian', root: 52, tempo: 76, density: 0.6, drums: 0.1, pad: 0.6, lute: 0.8, brass: 0 },
  tension: { scale: 'aeolian', root: 45, tempo: 70, density: 0.45, drums: 0.35, pad: 0.8, lute: 0.4, brass: 0.2 },
  battle: { scale: 'phrygian', root: 45, tempo: 112, density: 0.75, drums: 1, pad: 0.5, lute: 0.2, brass: 0.7 },
  victory: { scale: 'ionian', root: 55, tempo: 96, density: 0.8, drums: 0.5, pad: 0.6, lute: 0.6, brass: 1 },
  defeat: { scale: 'aeolian', root: 43, tempo: 54, density: 0.35, drums: 0.15, pad: 0.9, lute: 0.3, brass: 0.1 },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Procedural audio: ambience, sound effects and generative modal music (all synthesised, original). */
export class AudioManager {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  ambBus!: GainNode;
  sfxBus!: GainNode;
  uiBus!: GainNode;
  reverb!: ConvolverNode;
  private noise: Record<string, AudioBuffer> = {};
  private amb: Record<string, AmbientLayer> = {};
  mood: Mood = 'menu';
  private nextNoteTime = 0;
  private beat = 0;
  private chordRoot = 0;
  private melodyDeg = 4;
  private birdTimer = 2;
  private clashTimer = 0;
  private voices = 0;
  failed = false;
  battleIntensity = 0;
  constructor(private settings: Settings) {}

  unlock() {
    if (this.ctx || this.failed) {
      if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.connect(c.destination);
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      comp.connect(this.master);
      this.musicBus = c.createGain();
      this.ambBus = c.createGain();
      this.sfxBus = c.createGain();
      this.uiBus = c.createGain();
      for (const b of [this.musicBus, this.ambBus, this.sfxBus, this.uiBus]) b.connect(comp);
      this.reverb = c.createConvolver();
      this.reverb.buffer = this.impulse(2.6);
      const rv = c.createGain();
      rv.gain.value = 0.35;
      this.reverb.connect(rv);
      rv.connect(comp);
      this.makeNoise();
      this.makeAmbience();
      this.applySettings(this.settings);
      this.nextNoteTime = c.currentTime + 0.3;
    } catch (e) {
      console.warn('Audio unavailable', e);
      this.failed = true;
    }
  }

  applySettings(s: Settings) {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVolume, t, 0.1);
    this.musicBus.gain.setTargetAtTime(s.musicVolume * 0.5, t, 0.1);
    this.ambBus.gain.setTargetAtTime(s.ambientVolume * 0.8, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(s.sfxVolume * 0.9, t, 0.1);
    this.uiBus.gain.setTargetAtTime(s.sfxVolume * 0.6, t, 0.1);
  }

  private impulse(sec: number) {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }

  private makeNoise() {
    const c = this.ctx!;
    const len = c.sampleRate * 4;
    const white = c.createBuffer(1, len, c.sampleRate);
    const pink = c.createBuffer(1, len, c.sampleRate);
    const brown = c.createBuffer(1, len, c.sampleRate);
    const w = white.getChannelData(0);
    const p = pink.getChannelData(0);
    const br = brown.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      last = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      b0 = 0.99765 * b0 + x * 0.099046;
      b1 = 0.963 * b1 + x * 0.2965164;
      b2 = 0.57 * b2 + x * 1.0526913;
      p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.2;
      last = (last + 0.02 * x) / 1.02;
      br[i] = last * 3.5;
    }
    this.noise = { white, pink, brown };
  }

  private loopNoise(kind: string, filter: BiquadFilterType, freq: number, q: number): { src: AudioBufferSourceNode; filt: BiquadFilterNode; gain: GainNode } {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise[kind];
    src.loop = true;
    src.loopStart = Math.random();
    const filt = c.createBiquadFilter();
    filt.type = filter;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filt);
    filt.connect(gain);
    gain.connect(this.ambBus);
    src.start();
    return { src, filt, gain };
  }

  private makeAmbience() {
    const c = this.ctx!;
    // ocean: brown noise with slow surge
    const ocean = this.loopNoise('brown', 'lowpass', 600, 0.5);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = c.createGain();
    lfoG.gain.value = 260;
    lfo.connect(lfoG);
    lfoG.connect(ocean.filt.frequency);
    lfo.start();
    this.amb.ocean = { gain: ocean.gain, target: 0 };
    const wind = this.loopNoise('pink', 'bandpass', 480, 0.6);
    const lfo2 = c.createOscillator();
    lfo2.frequency.value = 0.05;
    const lfo2G = c.createGain();
    lfo2G.gain.value = 250;
    lfo2.connect(lfo2G);
    lfo2G.connect(wind.filt.frequency);
    lfo2.start();
    this.amb.wind = { gain: wind.gain, target: 0 };
    const rain = this.loopNoise('white', 'highpass', 2600, 0.3);
    this.amb.rain = { gain: rain.gain, target: 0 };
    const city = this.loopNoise('pink', 'bandpass', 700, 1.2);
    this.amb.city = { gain: city.gain, target: 0 };
    const battle = this.loopNoise('brown', 'lowpass', 300, 0.8);
    this.amb.battle = { gain: battle.gain, target: 0 };
    const crowd = this.loopNoise('pink', 'bandpass', 900, 2);
    this.amb.crowd = { gain: crowd.gain, target: 0 };
  }

  setAmbient(name: string, v: number) {
    const a = this.amb[name];
    if (a) a.target = v;
  }

  setMood(m: Mood) {
    this.mood = m;
  }

  // ------------------------------------------------------------------ SFX
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private burst(kind: string, t: number, dur: number, filter: BiquadFilterType, freq: number, q: number, peak: number, bus: AudioNode, pan = 0, freqEnd?: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise[kind];
    src.loopStart = Math.random() * 3;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, 0.005, peak, dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(bus);
    src.start(t, Math.random() * 3);
    src.stop(t + dur + 0.1);
  }
  private tone(type: OscillatorType, freq: number, t: number, a: number, peak: number, d: number, bus: AudioNode, freqEnd?: number, pan = 0, detune = 0) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + a + d);
    const g = c.createGain();
    this.env(g, t, a, peak, d);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(bus);
    o.start(t);
    o.stop(t + a + d + 0.05);
    return g;
  }

  ui(kind: 'click' | 'select' | 'order' | 'open' | 'error' | 'coin') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'click':
        this.tone('triangle', 900, t, 0.002, 0.08, 0.05, this.uiBus, 700);
        break;
      case 'select':
        this.tone('triangle', 520, t, 0.003, 0.08, 0.09, this.uiBus, 640);
        break;
      case 'order':
        this.tone('square', 220, t, 0.003, 0.03, 0.08, this.uiBus, 180);
        this.burst('pink', t, 0.08, 'bandpass', 1400, 2, 0.06, this.uiBus);
        break;
      case 'open':
        this.burst('pink', t, 0.18, 'bandpass', 2400, 1, 0.05, this.uiBus, 0, 900);
        break;
      case 'error':
        this.tone('sawtooth', 160, t, 0.005, 0.05, 0.18, this.uiBus, 120);
        break;
      case 'coin':
        this.tone('sine', 1300, t, 0.002, 0.07, 0.25, this.uiBus);
        this.tone('sine', 1950, t + 0.05, 0.002, 0.05, 0.25, this.uiBus);
        break;
    }
  }

  event(kind: 'battle' | 'victory' | 'defeat' | 'notify' | 'war' | 'bell' | 'capture' | 'sack' | 'coronation' | 'marriage') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const bus = this.sfxBus;
    switch (kind) {
      case 'notify':
        this.tone('sine', 660, t, 0.005, 0.08, 0.4, this.uiBus);
        this.tone('sine', 990, t + 0.08, 0.005, 0.06, 0.5, this.uiBus);
        break;
      case 'bell':
      case 'marriage':
      case 'coronation':
        for (const [f, dt] of [
          [392, 0],
          [523, 0.35],
          [659, 0.7],
        ] as const) {
          this.tone('sine', f, t + dt, 0.01, 0.12, 2.2, this.reverb);
          this.tone('sine', f * 2.76, t + dt, 0.01, 0.03, 1.2, this.reverb);
        }
        break;
      case 'war':
      case 'battle':
        this.horn(t, 146.8, 1.4);
        this.horn(t + 0.6, 196, 1.8);
        break;
      case 'victory':
        this.horn(t, 261.6, 0.5);
        this.horn(t + 0.4, 329.6, 0.5);
        this.horn(t + 0.8, 392, 1.6);
        break;
      case 'defeat':
        this.horn(t, 196, 1.2);
        this.horn(t + 0.9, 155.6, 2.2);
        break;
      case 'capture':
        this.drum(t, 1);
        this.drum(t + 0.3, 0.8);
        this.horn(t + 0.5, 220, 1.4);
        break;
      case 'sack':
        for (let i = 0; i < 6; i++) this.clash(t + i * 0.12, (Math.random() - 0.5) * 0.8, 0.5);
        this.burst('brown', t, 2.5, 'lowpass', 400, 0.7, 0.25, bus);
        break;
    }
  }

  private horn(t: number, f: number, d: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.15);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.linearRampToValueAtTime(1600, t + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.12);
    g.gain.setValueAtTime(0.12, t + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(lp).connect(g);
    g.connect(this.sfxBus);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + d + 0.1);
  }
  private drum(t: number, v: number, bus: AudioNode = this.sfxBus) {
    this.tone('sine', 120, t, 0.003, 0.5 * v, 0.35, bus, 42);
    this.burst('brown', t, 0.12, 'lowpass', 900, 0.8, 0.25 * v, bus);
  }
  clash(t: number, pan: number, v = 1) {
    if (!this.ctx) return;
    const f = 1800 + Math.random() * 2200;
    this.burst('white', t, 0.09, 'bandpass', f, 8, 0.22 * v, this.sfxBus, pan);
    this.tone('square', f * 0.51, t, 0.001, 0.02 * v, 0.2, this.sfxBus, f * 0.5, pan);
  }

  /** Battle sound hooks (positional pan in -1..1, volume by distance). */
  battleSound(kind: 'clash' | 'bow' | 'arrow' | 'hit' | 'hooves' | 'horn' | 'impact' | 'shout' | 'wood', pan: number, vol: number) {
    if (!this.ctx || vol < 0.02) return;
    if (this.voices > 40) return;
    this.voices++;
    setTimeout(() => this.voices--, 300);
    const t = this.ctx.currentTime + Math.random() * 0.03;
    switch (kind) {
      case 'clash':
        this.clash(t, pan, vol);
        break;
      case 'bow':
        this.tone('triangle', 180 + Math.random() * 60, t, 0.002, 0.08 * vol, 0.12, this.sfxBus, 120, pan);
        break;
      case 'arrow':
        this.burst('white', t, 0.35, 'bandpass', 3000, 3, 0.05 * vol, this.sfxBus, pan, 900);
        break;
      case 'hit':
        this.burst('brown', t, 0.1, 'lowpass', 600, 1, 0.3 * vol, this.sfxBus, pan);
        break;
      case 'hooves':
        for (let i = 0; i < 4; i++) this.tone('sine', 90 + Math.random() * 30, t + i * 0.09, 0.002, 0.12 * vol, 0.08, this.sfxBus, 60, pan);
        break;
      case 'horn':
        this.horn(t, 164.8, 1.5);
        break;
      case 'impact':
        this.drum(t, vol * 1.4);
        this.burst('brown', t, 0.8, 'lowpass', 500, 0.7, 0.35 * vol, this.sfxBus, pan);
        break;
      case 'shout':
        this.burst('pink', t, 0.5, 'bandpass', 700 + Math.random() * 300, 4, 0.08 * vol, this.sfxBus, pan);
        break;
      case 'wood':
        this.burst('brown', t, 0.2, 'bandpass', 300, 3, 0.35 * vol, this.sfxBus, pan);
        break;
    }
  }

  // ------------------------------------------------------------------ music
  private scheduleMusic() {
    const c = this.ctx!;
    const m = MOODS[this.mood];
    const scale = SCALES[m.scale];
    const spb = 60 / m.tempo;
    while (this.nextNoteTime < c.currentTime + 0.25) {
      const t = this.nextNoteTime;
      const bar = Math.floor(this.beat / 4);
      const inBar = this.beat % 4;
      if (inBar === 0 && bar % 2 === 0) {
        // chord change: i, iv, v, VI style movement in scale degrees
        const prog = [0, 3, 4, 5, 0, 2, 4, 0];
        this.chordRoot = prog[Math.floor(bar / 2) % prog.length];
        if (m.pad > 0) this.padChord(t, spb * 8, m, scale);
      }
      // melody
      if (m.lute > 0 && Math.random() < m.density) {
        this.melodyDeg += Math.floor(Math.random() * 5) - 2;
        this.melodyDeg = Math.max(0, Math.min(11, this.melodyDeg));
        const deg = this.melodyDeg;
        const note = m.root + 12 + scale[deg % 7] + Math.floor(deg / 7) * 12;
        this.pluck(t, midi(note), 0.1 * m.lute, spb * 1.8);
        if (Math.random() < 0.3) this.pluck(t + spb / 2, midi(note + (Math.random() < 0.5 ? scale[2] - scale[0] : -12)), 0.06 * m.lute, spb);
      }
      if (m.drums > 0) {
        if (inBar === 0) this.drum(t, m.drums * 0.7, this.musicBus);
        if (inBar === 2 && Math.random() < m.drums) this.drum(t, m.drums * 0.45, this.musicBus);
        if (this.mood === 'battle' && Math.random() < 0.5) this.burst('white', t + spb / 2, 0.05, 'highpass', 5000, 1, 0.05, this.musicBus);
      }
      if (m.brass > 0 && inBar === 0 && bar % 4 === 0 && Math.random() < m.brass) {
        const n = m.root + scale[this.chordRoot % 7];
        this.brass(t, midi(n), spb * 3, m.brass * 0.07);
      }
      this.nextNoteTime += spb;
      this.beat++;
    }
  }
  private pluck(t: number, f: number, v: number, d: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 6, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + d);
    const g = c.createGain();
    this.env(g, t, 0.004, v, d);
    const g2 = c.createGain();
    g2.gain.value = 0.3;
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverb);
    o.start(t);
    o2.start(t);
    o.stop(t + d + 0.05);
    o2.stop(t + d + 0.05);
  }
  private padChord(t: number, d: number, m: (typeof MOODS)[Mood], scale: number[]) {
    const c = this.ctx!;
    const degs = [0, 2, 4];
    for (const dg of degs) {
      const idx = this.chordRoot + dg;
      const n = m.root - 12 + scale[idx % 7] + Math.floor(idx / 7) * 12;
      for (const det of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 700;
        lp.Q.value = 0.5;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.018 * m.pad, t + d * 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + d);
        o.connect(lp).connect(g);
        g.connect(this.musicBus);
        g.connect(this.reverb);
        o.start(t);
        o.stop(t + d + 0.05);
      }
    }
  }
  private brass(t: number, f: number, d: number, v: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(1400, t + 0.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(lp).connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + d + 0.05);
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, app: { state: string; campaign?: { view: { cam: { distance: number; target: { x: number; z: number } }; env: { rain: number; storm: number; nightFactor: number } }; sim: { geo: { coastDist: Int16Array; navW: number; navStep: number } } } | null; battle?: unknown }) {
    if (!this.ctx) return;
    try {
      this.scheduleMusic();
    } catch {
      /* ignore scheduling errors */
    }
    let ocean = 0.15;
    let wind = 0.1;
    let rain = 0;
    let city = 0;
    let battle = 0;
    let crowd = 0;
    const cs = app.campaign;
    if (app.state === 'campaign' && cs) {
      const d = cs.view.cam.distance;
      const g = cs.sim.geo;
      const c = Math.floor(cs.view.cam.target.z / g.navStep) * g.navW + Math.floor(cs.view.cam.target.x / g.navStep);
      const cd = g.coastDist[c] ?? 0;
      ocean = cd <= 0 ? 0.55 : Math.max(0.05, 0.5 - cd * 0.03);
      wind = 0.12 + Math.min(0.4, d / 6000) + cs.view.env.storm * 0.4;
      rain = cs.view.env.rain * 0.5;
      city = d < 500 ? 0.12 * (1 - d / 500) : 0;
      this.birdTimer -= dt;
      if (this.birdTimer < 0 && d < 900 && cs.view.env.nightFactor < 0.5 && cd > 0) {
        this.birdTimer = 1.5 + Math.random() * 4;
        this.bird();
      }
    } else if (app.state === 'menu' || app.state === 'boot' || app.state === 'factionSelect') {
      ocean = 0.55;
      wind = 0.15;
    } else if (app.state === 'battle') {
      battle = 0.2 + this.battleIntensity * 0.5;
      crowd = 0.05 + this.battleIntensity * 0.15;
      wind = 0.12;
      this.clashTimer -= dt;
    }
    this.setAmbient('ocean', ocean);
    this.setAmbient('wind', wind);
    this.setAmbient('rain', rain);
    this.setAmbient('city', city);
    this.setAmbient('battle', battle);
    this.setAmbient('crowd', crowd);
    const t = this.ctx.currentTime;
    for (const a of Object.values(this.amb)) a.gain.gain.setTargetAtTime(a.target, t, 0.6);
  }
  private bird() {
    const c = this.ctx!;
    const t = c.currentTime;
    const base = 2200 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone('sine', base, t + i * 0.12, 0.005, 0.025, 0.08, this.ambBus, base * (1.2 + Math.random() * 0.3), Math.random() - 0.5);
  }
}
