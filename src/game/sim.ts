/** One day in the city: building sites rise, lots fill or empty, the books are balanced. */
import {
  FLAG_ACCESS, FLAG_POWER, FLAG_WATER, NONE, ZONE_I, ZONE_NONE, clearBuilding, createCity, hasBuilding, type City,
} from './city.ts';
import { bricksNeeded, derive, desirability, isComplete, spareSupply } from './derive.ts';
import { nextInt, nextRandom } from './rng.ts';
import { generateTerrain } from './terrain.ts';
import {
  ABANDON_DAYS, BRICKS_PER_DAY, DECLINE_DEMAND, DECLINE_RATE, GROWTH_SAMPLE_FRACTION, INDUSTRY_GATES, LAND_GATES, MIN_GROWTH_SAMPLES,
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
    // A finished home, shop or works that has lost its road, power or water empties after a while.
    const served = FLAG_ACCESS | FLAG_POWER | FLAG_WATER;
    if ((city.flags[i] & served) === served) { if (city.distress[i] > 0) city.distress[i]--; continue; }
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
    // Nothing new is connected unless there is power and water to spare for it.
    const extra = spec.capacity[level + 1] - spec.capacity[level];
    const power = extra * spec.powerPerUnit, water = extra * spec.waterPerUnit;
    if (spare.power < power || spare.water < water) continue;
    spare.power -= power; spare.water -= water;
    build(city, i, level + 1);
  }
}

export function tick(city: City) {
  derive(city);
  raise(city);
  grow(city);
  city.money += city.stats.income - city.stats.expenses;
  city.day++;
  derive(city);
}
