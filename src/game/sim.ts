/** One day in the city: building sites rise, lots fill or empty, the books are balanced. */
import {
  FLAG_ACCESS, NONE, ZONE_I, ZONE_NONE, clearBuilding, createCity, hasBuilding, type City,
} from './city.ts';
import { bricksNeeded, derive, desirability, isComplete, isOccupied, spareSupply } from './derive.ts';
import { nextInt, nextRandom } from './rng.ts';
import { generateTerrain } from './terrain.ts';
import {
  ABANDON_DAYS, BRICKS_PER_DAY, DECLINE_DEMAND, DECLINE_RATE, GROWTH_SAMPLE_FRACTION, INDUSTRY_GATES, LAND_GATES, MILESTONES, MIN_GROWTH_SAMPLES,
  POPULATION_GATES, SPAWN_RATE, UPGRADE_RATE,
} from './tuning.ts';
import { ZONE_SPECS, maxLevel } from './zones.ts';

/** Looks a building of one zone and level can take. */
const VARIANTS = 32;

export function newCity(seed: number): City {
  const city = createCity(seed);
  generateTerrain(city);
  derive(city);
  return city;
}

/** Whether the city and the lot are ready for a building of `level` in the lot's zone. */
export function levelAllowed(city: City, i: number, level: number) {
  const zone = city.zone[i];
  if (level > maxLevel(zone)) return false;
  if (zone === ZONE_I) return city.stats.population >= INDUSTRY_GATES[level];
  return city.stats.population >= POPULATION_GATES[level] && desirability(city, i, zone) >= LAND_GATES[level];
}

function build(city: City, i: number, level: number) {
  city.level[i] = level; city.progress[i] = 0; city.distress[i] = 0;
  city.variant[i] = nextInt(city, VARIANTS);
  if (city.tree[i]) { city.tree[i] = 0; city.revision++; }
  city.facing[i] = city.frontDir[i];
  city.buildRevision++;
}

function raise(city: City) {
  const tiles = city.size * city.size;
  for (let i = 0; i < tiles; i++) {
    if (!hasBuilding(city, i)) continue;
    const needed = bricksNeeded(city, i);
    if (city.progress[i] < needed) { city.progress[i] = Math.min(needed, city.progress[i] + BRICKS_PER_DAY); city.buildRevision++; continue; }
    if (city.structure[i] !== NONE) continue;
    // A finished home, shop or works that has lost its road is cleared after a while. One short of power or water
    // is not: it stands empty, marked, until the mayor connects it.
    if (city.flags[i] & FLAG_ACCESS) { if (city.distress[i] > 0) city.distress[i]--; continue; }
    if (++city.distress[i] > ABANDON_DAYS) { clearBuilding(city, i); city.buildRevision++; }
  }
}

let lots = new Int32Array(0);

function grow(city: City) {
  const tiles = city.size * city.size;
  if (lots.length < tiles) lots = new Int32Array(tiles);
  let count = 0;
  for (let i = 0; i < tiles; i++) if (city.zone[i] !== ZONE_NONE && city.structure[i] === NONE) lots[count++] = i;
  if (count === 0) return;
  const spare = spareSupply(city);
  const samples = Math.max(MIN_GROWTH_SAMPLES, Math.ceil(count * GROWTH_SAMPLE_FRACTION));
  for (let n = 0; n < samples; n++) {
    const i = lots[nextInt(city, count)], zone = city.zone[i], level = city.level[i], spec = ZONE_SPECS[zone];
    const demand = city.stats.demand[zone], roll = nextRandom(city);
    if (level > 0 && !isComplete(city, i)) continue;
    if (level > 0 && demand < DECLINE_DEMAND) {
      if (roll < DECLINE_RATE) { if (level > 1) build(city, i, level - 1); else { clearBuilding(city, i); city.buildRevision++; } }
      continue;
    }
    if (demand <= 0 || !(city.flags[i] & FLAG_ACCESS) || !levelAllowed(city, i, level + 1)) continue;
    if (roll >= demand * (level === 0 ? SPAWN_RATE : UPGRADE_RATE)) continue;
    // An empty lot is built on whether or not there is power and water for it yet. A building only grows when it
    // is lived in and there is enough spare of both for the bigger one.
    if (level > 0) {
      if (!isOccupied(city, i)) continue;
      const extra = spec.capacity[level + 1] - spec.capacity[level];
      const power = extra * spec.powerPerUnit, water = extra * spec.waterPerUnit;
      if (spare.power < power || spare.water < water) continue;
      spare.power -= power; spare.water -= water;
    }
    build(city, i, level + 1);
  }
}

/** How many of the milestones a city of `population` has reached. */
export function milestonesReached(population: number) {
  let reached = 0;
  while (reached < MILESTONES.length && population >= MILESTONES[reached].population) reached++;
  return reached;
}

/**
 * One day. With `settle` the derived state (stats, flags, land value) is brought up to date again afterwards,
 * which the interface wants; a headless run that only ticks can skip it, since the next day starts by deriving.
 */
export function tick(city: City, settle = true) {
  derive(city);
  city.milestone = Math.max(city.milestone, milestonesReached(city.stats.population));
  raise(city);
  grow(city);
  city.money += city.stats.income - city.stats.expenses;
  city.day++;
  if (settle) derive(city);
}
