import type { Sim } from './context';
import { seasonOf, type WeatherKind } from './types';

export const WEATHER_REGIONS = ['west', 'center', 'north', 'east', 'south', 'emberfell', 'greenholm', 'lirien', 'skarholm', 'norhaven', 'sea'];
const COLD = new Set(['north', 'norhaven', 'emberfell']);
const WARM = new Set(['south', 'lirien', 'skarholm']);

export function rollWeather(sim: Sim) {
  const season = seasonOf(sim.s.turn);
  const r = sim.rng;
  for (const reg of WEATHER_REGIONS) {
    const table: [WeatherKind, number][] = [
      ['clear', season === 1 ? 5 : 3],
      ['cloudy', 3],
      ['rain', season === 0 || season === 2 ? 2.5 : 1.2],
      ['fog', season === 2 ? 1.5 : 0.6],
      ['storm', reg === 'sea' ? (season >= 2 ? 1.8 : 0.7) : season === 2 ? 0.6 : 0.3],
      ['snow', season === 3 ? (COLD.has(reg) ? 5 : WARM.has(reg) ? 0 : 1.5) : season === 2 && COLD.has(reg) ? 0.6 : 0],
    ];
    if (WARM.has(reg)) table[0][1] += 2;
    sim.s.weather.regions[reg] = r.weighted(table, (t) => t[1])![0];
  }
}

export const WEATHER_LABEL: Record<WeatherKind, string> = { clear: 'Clear skies', cloudy: 'Overcast', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow' };
