/** A city to and from JSON. Only what the mayor and the simulation decided is kept; the rest is derived again on load. */
import { createCity, type City } from './city.ts';
import { derive } from './derive.ts';
import { milestonesReached } from './sim.ts';

const SAVE_VERSION = 1;
const PER_TILE = ['terrain', 'tree', 'structure', 'zone', 'level', 'progress', 'variant', 'facing', 'distress', 'served'] as const;
/** Kept since the first saves were written; a save without one of these loads with it empty. */
const ADDED_LATER: readonly string[] = ['served'];

type Saved = { version: number; size: number; seed: number; rng: number; money: number; day: number; tax: number; milestone?: number } & Record<(typeof PER_TILE)[number], number[]>;

export function saveCity(city: City): string {
  const saved = { version: SAVE_VERSION, size: city.size, seed: city.seed, rng: city.rng, money: city.money, day: city.day, tax: city.tax, milestone: city.milestone } as Saved;
  for (const key of PER_TILE) saved[key] = Array.from(city[key]);
  return JSON.stringify(saved);
}

/** The saved city, or null when the text is not a save this version can read. */
export function loadCity(text: string): City | null {
  let saved: Saved;
  try { saved = JSON.parse(text) as Saved; } catch { return null; }
  if (!saved || saved.version !== SAVE_VERSION || !Number.isInteger(saved.size) || saved.size <= 0) return null;
  const city = createCity(saved.seed, saved.size), tiles = saved.size * saved.size;
  for (const key of PER_TILE) {
    const values = saved[key];
    if (values === undefined && ADDED_LATER.includes(key)) continue;
    if (!Array.isArray(values) || values.length !== tiles || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
    city[key].set(values);
  }
  for (const key of ['rng', 'money', 'day', 'tax'] as const) if (!Number.isFinite(saved[key])) return null;
  city.rng = saved.rng >>> 0; city.money = saved.money; city.day = saved.day; city.tax = saved.tax;
  derive(city);
  // A save from before milestones were kept has reached whatever its population says, without a celebration for each.
  city.milestone = Number.isInteger(saved.milestone) ? Math.max(0, saved.milestone!) : milestonesReached(city.stats.population);
  return city;
}
