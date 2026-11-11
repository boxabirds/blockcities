/**
 * Everything worked out from what is built: which lots a road reaches, who has
 * power and water, land value, pollution, the head counts and the demand for
 * each zone. Run after every change and at the start of every day.
 */
import {
  DIR_COUNT, DIR_X, DIR_Z, FLAG_ACCESS, FLAG_POWER, FLAG_WATER, NO_FACING, NONE, ROAD, STRUCTURE_COUNT, WATER, ZONE_C, ZONE_I,
  ZONE_NONE, ZONE_R, hasBuilding, type City,
} from './city.ts';
import { buildingBlueprint } from './blueprints.ts';
import { SERVICES } from './services.ts';
import {
  BRIDGE_UPKEEP, COMMERCIAL_JOBS_PER_RESIDENT, DEFAULT_TAX, DEMAND_SCALE_SHARE, INDUSTRIAL_JOBS_PER_RESIDENT, INDUSTRY_POLLUTION,
  INDUSTRY_POLLUTION_RADIUS, MIN_DEMAND_SCALE, NEWCOMER_SHARE, POLLUTION_WEIGHT, ROAD_REACH, ROAD_UPKEEP, STARTER_HOMES,
  TAX_DEMAND_PER_POINT, WORKFORCE_SHARE,
} from './tuning.ts';
import { ZONE_SPECS } from './zones.ts';

/** Bricks in the finished building or service on a tile (0 when there is none). */
export function bricksNeeded(city: City, i: number) {
  if (!hasBuilding(city, i)) return 0;
  return buildingBlueprint(city.structure[i], city.zone[i], city.level[i], city.variant[i]).bricks.length;
}

export function isComplete(city: City, i: number) {
  return hasBuilding(city, i) && city.progress[i] >= bricksNeeded(city, i);
}

/** Residents or jobs of the zoned building on a tile, finished or not. */
export function capacityOf(city: City, i: number) {
  return city.structure[i] === NONE && city.zone[i] !== ZONE_NONE ? ZONE_SPECS[city.zone[i]].capacity[city.level[i]] : 0;
}

/** Land value as a lot of `zone` feels it: services nearby, less the pollution that zone minds. */
export function desirability(city: City, i: number, zone: number) {
  return city.landValue[i] - city.pollution[i] * POLLUTION_WEIGHT[zone];
}

let queue = new Int32Array(0);
let distance = new Uint8Array(0);
let best = new Float32Array(0);

function reachRoads(city: City) {
  const { size, structure, roadOf, frontDir, flags, terrain } = city, tiles = size * size;
  if (queue.length < tiles) { queue = new Int32Array(tiles); distance = new Uint8Array(tiles); }
  let head = 0, tail = 0;
  for (let i = 0; i < tiles; i++) {
    flags[i] = 0; frontDir[i] = NO_FACING;
    if (structure[i] === ROAD) { roadOf[i] = i; distance[i] = 0; queue[tail++] = i; } else roadOf[i] = -1;
  }
  while (head < tail) {
    const i = queue[head++], x = i % size, z = (i - x) / size;
    if (distance[i] >= ROAD_REACH) continue;
    for (let facing = 0; facing < DIR_COUNT; facing++) {
      const nx = x + DIR_X[facing], nz = z + DIR_Z[facing];
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const n = nz * size + nx;
      if (roadOf[n] >= 0 || terrain[n] === WATER) continue;
      roadOf[n] = roadOf[i]; distance[n] = distance[i] + 1;
      // The lot faces back the way the road was reached from.
      frontDir[n] = (facing + DIR_COUNT / 2) % DIR_COUNT;
      flags[n] |= FLAG_ACCESS;
      queue[tail++] = n;
    }
  }
}

/** Adds `strength` at tile (cx, cz) falling linearly to nothing at `radius`, into `out`: summed, or the larger when `max`. */
function spread(city: City, cx: number, cz: number, strength: number, radius: number, out: Float32Array, max: boolean) {
  const { size } = city, reach = Math.ceil(radius);
  for (let z = Math.max(0, cz - reach); z <= Math.min(size - 1, cz + reach); z++) {
    for (let x = Math.max(0, cx - reach); x <= Math.min(size - 1, cx + reach); x++) {
      const share = 1 - Math.hypot(x - cx, z - cz) / radius;
      if (share <= 0) continue;
      const j = z * size + x, value = strength * share;
      out[j] = max ? Math.max(out[j], value) : out[j] + value;
    }
  }
}

function surveyLand(city: City) {
  const { size, structure, landValue, pollution, flags } = city, tiles = size * size;
  if (best.length < tiles) best = new Float32Array(tiles);
  landValue.fill(0); pollution.fill(0);
  // Two parks do not count twice: each kind of service gives a lot its best single reach.
  for (let kind = 0; kind < STRUCTURE_COUNT; kind++) {
    const service = SERVICES[kind];
    if (!service) continue;
    const valued = service.value > 0;
    if (valued) best.fill(0);
    for (let i = 0; i < tiles; i++) {
      if (structure[i] !== kind || !isComplete(city, i)) continue;
      const x = i % size, z = (i - x) / size;
      if (service.pollution > 0) spread(city, x, z, service.pollution, service.pollutionRadius, pollution, false);
      if (valued && (!service.needsRoad || flags[i] & FLAG_ACCESS)) spread(city, x, z, service.value, service.radius, best, true);
    }
    if (valued) for (let i = 0; i < tiles; i++) landValue[i] += best[i];
  }
  for (let i = 0; i < tiles; i++) {
    if (city.zone[i] !== ZONE_I || structure[i] !== NONE || !isComplete(city, i)) continue;
    const x = i % size, z = (i - x) / size;
    spread(city, x, z, INDUSTRY_POLLUTION[city.level[i]], INDUSTRY_POLLUTION_RADIUS, pollution, false);
  }
}

const clampDemand = (value: number) => Math.max(-1, Math.min(1, value));

function countAndSupply(city: City) {
  const { size, structure, zone, flags, stats } = city, tiles = size * size;
  let powerSupply = 0, waterSupply = 0, upkeep = 0, zonedLots = 0;
  for (let i = 0; i < tiles; i++) {
    const kind = structure[i];
    if (kind === ROAD) { upkeep += city.terrain[i] === WATER ? BRIDGE_UPKEEP : ROAD_UPKEEP; continue; }
    const service = SERVICES[kind];
    if (service) {
      upkeep += service.upkeep;
      if (isComplete(city, i)) { powerSupply += service.power; waterSupply += service.water; }
    } else if (zone[i] !== ZONE_NONE) zonedLots++;
  }
  // Power and water go to buildings in map order until they run out.
  let powerLeft = powerSupply, waterLeft = waterSupply, powerUse = 0, waterUse = 0;
  let population = 0, commercialJobs = 0, industrialJobs = 0;
  let plannedHomes = 0, plannedShops = 0, plannedIndustry = 0;
  let withoutRoad = 0, withoutPower = 0, withoutWater = 0;
  for (let i = 0; i < tiles; i++) {
    if (structure[i] !== NONE || zone[i] === ZONE_NONE || city.level[i] === 0) continue;
    const spec = ZONE_SPECS[zone[i]], capacity = spec.capacity[city.level[i]];
    if (zone[i] === ZONE_R) plannedHomes += capacity; else if (zone[i] === ZONE_C) plannedShops += capacity; else plannedIndustry += capacity;
    if (!isComplete(city, i)) continue;
    const power = capacity * spec.powerPerUnit, water = capacity * spec.waterPerUnit;
    powerUse += power; waterUse += water;
    if (powerLeft >= power) { powerLeft -= power; flags[i] |= FLAG_POWER; } else withoutPower++;
    if (waterLeft >= water) { waterLeft -= water; flags[i] |= FLAG_WATER; } else withoutWater++;
    if (!(flags[i] & FLAG_ACCESS)) withoutRoad++;
    if (zone[i] === ZONE_R) population += capacity; else if (zone[i] === ZONE_C) commercialJobs += capacity; else industrialJobs += capacity;
  }
  const jobs = commercialJobs + industrialJobs, workers = population * WORKFORCE_SHARE;
  const employed = jobs > 0 ? Math.min(1, workers / jobs) : 0;
  const taxScale = city.tax / DEFAULT_TAX;
  stats.population = population; stats.commercialJobs = commercialJobs; stats.industrialJobs = industrialJobs;
  stats.powerSupply = powerSupply; stats.powerUse = powerUse; stats.waterSupply = waterSupply; stats.waterUse = waterUse;
  stats.zonedLots = zonedLots; stats.withoutRoad = withoutRoad; stats.withoutPower = withoutPower; stats.withoutWater = withoutWater;
  stats.expenses = upkeep;
  stats.income = taxScale * (population * ZONE_SPECS[ZONE_R].taxPerUnit
    + employed * (commercialJobs * ZONE_SPECS[ZONE_C].taxPerUnit + industrialJobs * ZONE_SPECS[ZONE_I].taxPerUnit));

  // Demand looks at what is planned, not only what is finished, so a wave of building sites is not started twice.
  const scale = Math.max(MIN_DEMAND_SCALE, plannedHomes * DEMAND_SCALE_SHARE);
  const taxPull = (DEFAULT_TAX - city.tax) * TAX_DEMAND_PER_POINT;
  const homesWanted = plannedShops + plannedIndustry - plannedHomes * WORKFORCE_SHARE + STARTER_HOMES + plannedHomes * NEWCOMER_SHARE;
  stats.demand[ZONE_R] = clampDemand(homesWanted / scale + taxPull);
  stats.demand[ZONE_C] = clampDemand((plannedHomes * COMMERCIAL_JOBS_PER_RESIDENT - plannedShops) / scale + taxPull);
  stats.demand[ZONE_I] = clampDemand((plannedHomes * INDUSTRIAL_JOBS_PER_RESIDENT - plannedIndustry) / scale + taxPull);
}

export function derive(city: City) {
  reachRoads(city);
  // A building turns to face the road once, the first time one reaches it.
  const tiles = city.size * city.size;
  for (let i = 0; i < tiles; i++) {
    if (city.facing[i] === NO_FACING && city.frontDir[i] !== NO_FACING && hasBuilding(city, i)) { city.facing[i] = city.frontDir[i]; city.buildRevision++; }
  }
  surveyLand(city);
  countAndSupply(city);
}

/** Power and water still unallocated, for deciding whether something new can be connected. */
export function spareSupply(city: City) {
  return { power: city.stats.powerSupply - city.stats.powerUse, water: city.stats.waterSupply - city.stats.waterUse };
}
