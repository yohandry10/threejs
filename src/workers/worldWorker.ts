import { generateWorld } from '../sim/world/worldGen';

self.onmessage = () => {
  const g = generateWorld((p, l) => (self as unknown as Worker).postMessage({ type: 'progress', p, l }));
  const transfer = [g.height.buffer, g.biome.buffer, g.moisture.buffer, g.nav.buffer, g.road.buffer, g.river.buffer, g.province.buffer, g.landmass.buffer, g.seaZone.buffer, g.coastDist.buffer];
  (self as unknown as Worker).postMessage({ type: 'done', geo: g }, transfer as Transferable[]);
};
