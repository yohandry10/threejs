import type { WorldGeo } from '../sim/world/geo';
import { generateWorld } from '../sim/world/worldGen';
import WorldWorker from '../workers/worldWorker?worker&inline';

let cached: WorldGeo | null = null;

/** Generates the (deterministic) world geography in a Web Worker, falling back to the main thread. */
export async function loadWorld(onProgress: (p: number, label: string) => void): Promise<WorldGeo> {
  if (cached) return cached;
  try {
    const geo = await new Promise<WorldGeo>((resolve, reject) => {
      const w = new WorldWorker();
      const timer = setTimeout(() => reject(new Error('world worker timeout')), 60000);
      w.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'progress') onProgress(e.data.p, e.data.l);
        else if (e.data.type === 'done') {
          clearTimeout(timer);
          w.terminate();
          resolve(e.data.geo as WorldGeo);
        }
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        w.terminate();
        reject(e);
      };
      w.postMessage('go');
    });
    cached = geo;
    return geo;
  } catch (e) {
    console.warn('World worker unavailable, generating on the main thread', e);
    await new Promise((r) => setTimeout(r, 30));
    cached = generateWorld(onProgress);
    return cached;
  }
}
