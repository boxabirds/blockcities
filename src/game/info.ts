/** What a tile is and what it is waiting for, in words. Shown in the inspector and used by the checks. */
import { AVENUE, FLAG_ACCESS, FLAG_POWER, FLAG_WATER, WATER, ZONE_C, ZONE_I, ZONE_NONE, ZONE_R, isRoad, type City } from './city.ts';
import { bricksNeeded, congestion, desirability, isComplete, isOccupied, spareSupply, staffing, trafficNoise } from './derive.ts';
import { SERVICES } from './services.ts';
import { levelAllowed } from './sim.ts';
import { DAYS_PER_MONTH, DEFAULT_TAX, INDUSTRY_GATES, LAND_GATES, MONTHS_PER_YEAR, POPULATION_GATES, QUIET_SHARE, TRAFFIC_NOISE_WEIGHT } from './tuning.ts';
import { ZONE_SPECS, maxLevel } from './zones.ts';

export type TileInfo = { title: string; lines: string[] };

/** What the flashing marks over an empty building mean; the inspector says the same words. */
export const MISSING_POWER = 'Missing power';
export const MISSING_WATER = 'Missing water';

const PERCENT = 100;
/** Spare power and water below which buildings have in practice stopped growing. */
const POWER_HEADROOM = 12;
const WATER_HEADROOM = 12;
/** Demand above which the advisor asks for more of a zone. */
const WANTED_DEMAND = 0.3;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

function landLine(city: City, i: number, zone: number) {
  const value = Math.round(desirability(city, i, zone) * PERCENT), smoke = Math.round(city.pollution[i] * PERCENT);
  const noise = Math.round(trafficNoise(city, i) * TRAFFIC_NOISE_WEIGHT[zone] * PERCENT);
  const against = [smoke > 0 ? `pollution ${smoke}` : '', noise > 0 ? `traffic noise ${noise}` : ''].filter(Boolean).join(', ');
  return against ? `Land value ${value} (${against})` : `Land value ${value}`;
}

export function tileInfo(city: City, i: number): TileInfo {
  const structure = city.structure[i], zone = city.zone[i], service = SERVICES[structure];
  if (isRoad(structure)) {
    const load = congestion(city, i), kind = structure === AVENUE ? 'Avenue' : 'Road';
    const state = load > 1 ? 'over capacity' : load > QUIET_SHARE ? 'busy' : 'quiet';
    const lines = [`${Math.round(city.traffic[i])} trips a day · ${state}`];
    if (load > QUIET_SHARE && structure !== AVENUE) lines.push('Homes along a busy road lose land value: make it an avenue.');
    return { title: city.terrain[i] === WATER ? `${kind} bridge` : kind, lines };
  }
  if (service) {
    const lines = [service.blurb];
    if (!isComplete(city, i)) lines.push(`Under construction: ${city.progress[i]} of ${bricksNeeded(city, i)} bricks`);
    else if (service.needsRoad && !(city.flags[i] & FLAG_ACCESS)) lines.push('Needs a road within two tiles to serve anyone');
    else if (service.power) lines.push(`Supplies ${service.power} power`);
    else if (service.water) lines.push(`Supplies ${service.water} water`);
    lines.push(`Upkeep ${Math.round(service.upkeep * staffing(city))} a day`);
    return { title: service.name, lines };
  }
  if (city.terrain[i] === WATER) return { title: 'Water', lines: ['Roads can cross it as bridges.'] };
  if (zone === ZONE_NONE) return { title: city.tree[i] ? 'Trees' : 'Grass', lines: [landLine(city, i, ZONE_R)] };

  const spec = ZONE_SPECS[zone], level = city.level[i], lines: string[] = [];
  const unit = zone === ZONE_R ? 'residents' : 'jobs';
  if (level === 0) {
    if (!(city.flags[i] & FLAG_ACCESS)) lines.push('Waiting for a road within two tiles');
    else if (!levelAllowed(city, i, 1)) lines.push('Too polluted to build on');
    else if (city.stats.demand[zone] <= 0) lines.push(`Waiting for demand for ${spec.name.toLowerCase()}`);
    else lines.push('Ready: a building will start soon');
  } else if (!isComplete(city, i)) {
    lines.push(`Under construction: ${city.progress[i]} of ${bricksNeeded(city, i)} bricks`);
  } else {
    const size = `${spec.capacity[level]} ${unit} · level ${level} of ${maxLevel(zone)}`;
    lines.push(isOccupied(city, i) ? size : `Standing empty: room for ${size}`);
    if (!(city.flags[i] & FLAG_POWER)) lines.push(`${MISSING_POWER}: add a turbine or a power station`);
    if (!(city.flags[i] & FLAG_WATER)) lines.push(`${MISSING_WATER}: add a water tower`);
    if (!(city.flags[i] & FLAG_ACCESS)) lines.push('No road: it will be abandoned');
    if (level < maxLevel(zone) && !levelAllowed(city, i, level + 1)) {
      const next = level + 1;
      if (zone === ZONE_I) lines.push(`Grows at ${INDUSTRY_GATES[next]} residents in the city`);
      else if (city.stats.population < POPULATION_GATES[next]) lines.push(`Grows at ${POPULATION_GATES[next]} residents in the city`);
      else lines.push(`Grows at land value ${Math.round(LAND_GATES[next] * PERCENT)}: add parks and services`);
    }
  }
  if (zone !== ZONE_I) lines.push(landLine(city, i, zone));
  return { title: level === 0 ? `${spec.name} lot` : spec.buildings[level], lines };
}

/** "3 March, year 2" for a day count; months are 30 days. */
export function dateLabel(day: number) {
  const month = Math.floor(day / DAYS_PER_MONTH), year = Math.floor(month / MONTHS_PER_YEAR);
  return `${(day % DAYS_PER_MONTH) + 1} ${MONTHS[month % MONTHS_PER_YEAR]}, year ${year + 1}`;
}

/** The one thing most worth doing next, for a mayor who is not sure. Empty when the city is ticking over. */
export function advice(city: City): string {
  const { stats } = city, tiles = city.size * city.size;
  let roads = 0, readyLots = 0, powerSources = 0, waterSources = 0;
  const emptyByZone = [0, 0, 0, 0];
  for (let i = 0; i < tiles; i++) {
    const service = SERVICES[city.structure[i]];
    // A utility still being built counts: the advice is to place one, not to wait.
    if (service?.power) powerSources++;
    if (service?.water) waterSources++;
    if (isRoad(city.structure[i])) roads++;
    else if (city.zone[i] !== ZONE_NONE && city.level[i] === 0 && city.flags[i] & FLAG_ACCESS) { emptyByZone[city.zone[i]]++; readyLots++; }
  }
  if (city.money < 0) return 'The city is in debt: raise taxes or bulldoze what it cannot afford.';
  if (roads === 0) return 'Start by laying a road.';
  if (stats.zonedLots === 0) return 'Zone some homes beside the road: lots within two tiles of a road get built on.';
  if (powerSources === 0) return 'Buildings stand empty without power: place a wind turbine.';
  if (waterSources === 0) return 'Buildings stand empty without water: place a water tower.';
  if (stats.withoutPower > 0) return `${stats.withoutPower} buildings stand empty for want of power, and pay no tax: add turbines or a power station.`;
  if (stats.withoutWater > 0) return `${stats.withoutWater} buildings stand empty for want of water, and pay no tax: add a water tower.`;
  if (stats.withoutRoad > 0) return `${stats.withoutRoad} buildings have lost their road and will be abandoned.`;
  const spare = spareSupply(city);
  if (readyLots > 0 && spare.power < POWER_HEADROOM) return 'Power is nearly all used, so buildings have stopped growing: add turbines or a power station.';
  if (readyLots > 0 && spare.water < WATER_HEADROOM) return 'Water is nearly all used, so buildings have stopped growing: add a water tower.';
  if (stats.congested > 0) return `${stats.congested} road tiles carry more traffic than they can take: upgrade them to avenues, or put jobs nearer the homes.`;
  // A city that put tax up to get out of debt and left it there stops growing, and stays small for good.
  if (city.tax > DEFAULT_TAX && stats.demand[ZONE_R] <= 0 && stats.income > stats.expenses) {
    return `Nobody wants to move in at ${city.tax}% tax, so the city has stopped growing. You are out of debt: lower it in Budget.`;
  }
  for (const zone of [ZONE_R, ZONE_C, ZONE_I]) {
    if (stats.demand[zone] > WANTED_DEMAND && emptyByZone[zone] === 0) return `${ZONE_SPECS[zone].name} are wanted: zone more lots for them near a road.`;
  }
  if (stats.income < stats.expenses && stats.population > 0) return 'The city spends more than it earns: grow, or raise taxes a little.';
  return '';
}
