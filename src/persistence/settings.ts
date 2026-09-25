export interface Settings {
  resolutionScale: number; // 0.5..1.5 of devicePixelRatio
  shadows: 0 | 1 | 2; // off, low, high
  vegetation: number; // 0..1 density
  water: 0 | 1; // low, high
  particles: number; // 0..1
  postprocessing: boolean;
  bloom: boolean;
  antialias: boolean;
  uiScale: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  mouseSensitivity: number;
  edgeScroll: boolean;
  invertRotate: boolean;
  dayLength: number; // seconds of visual day
  lockTime: boolean;
  tutorial: boolean;
  keys: Record<string, string>;
  autoDetected?: boolean;
}

export const DEFAULT_KEYS: Record<string, string> = {
  panUp: 'KeyW',
  panDown: 'KeyS',
  panLeft: 'KeyA',
  panRight: 'KeyD',
  rotateLeft: 'KeyQ',
  rotateRight: 'KeyE',
  endTurn: 'Enter',
  pause: 'Space',
  mapMode: 'KeyM',
  diplomacy: 'KeyP',
  family: 'KeyF',
};

export const DEFAULT_SETTINGS: Settings = {
  resolutionScale: 1,
  shadows: 1,
  vegetation: 0.8,
  water: 1,
  particles: 1,
  postprocessing: true,
  bloom: true,
  antialias: true,
  uiScale: 1,
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  ambientVolume: 0.7,
  mouseSensitivity: 1,
  edgeScroll: false,
  invertRotate: false,
  dayLength: 720,
  lockTime: false,
  tutorial: true,
  keys: { ...DEFAULT_KEYS },
};

const KEY = 'crownandtide.settings.v1';

export function detectSettings(): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } };
  try {
    const cores = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    let renderer = '';
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
    const low = software || cores <= 2 || mem <= 2;
    if (low) {
      s.resolutionScale = 0.75;
      s.shadows = 0;
      s.vegetation = 0.45;
      s.water = 0;
      s.particles = 0.5;
      s.bloom = false;
      s.antialias = false;
    } else if (cores <= 4 || mem <= 4) {
      s.shadows = 1;
      s.vegetation = 0.65;
    } else {
      s.shadows = 2;
      s.vegetation = 1;
    }
  } catch {
    /* keep defaults */
  }
  s.autoDetected = true;
  return s;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...parsed, keys: { ...DEFAULT_KEYS, ...(parsed.keys ?? {}) } };
    }
  } catch {
    /* ignore */
  }
  const s = detectSettings();
  saveSettings(s);
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
