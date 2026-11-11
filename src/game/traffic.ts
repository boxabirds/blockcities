/**
 * Cars on the roads. Each one drives the shortest way between the roads of two
 * buildings and then disappears. This is for show: congestion is not modelled
 * and nothing in the simulation depends on it.
 */
import { DIR_COUNT, DIR_X, DIR_Z, ROAD, hasBuilding, type City } from './city.ts';
import { nextInt, nextRandom, type RandomState } from './rng.ts';
import { LANE_OFFSET, MAX_VEHICLES, RESIDENTS_PER_VEHICLE, TILE_STUDS, VEHICLE_SPAWNS_PER_SECOND, VEHICLE_SPEED } from './tuning.ts';

/** Car body colours, as indices into the brick palette. */
const BODY_COLORS = [0, 4, 5, 6, 8, 12, 14, 3, 1] as const;
/** Tries at picking two different buildings before giving up on a spawn. */
const PICK_ATTEMPTS = 4;
/** Share of spawn slots left unused, so cars do not leave in convoys. */
const SKIP_SHARE = 0.5;
/** A journey shorter than this many tiles is not worth drawing. */
const MIN_JOURNEY_TILES = 3;

export type Vehicle = {
  active: boolean;
  /** Lane points in studs from the map's corner: x then z for each. */
  points: Float32Array;
  pointCount: number;
  /** Road tiles under the lane points, to notice a road being removed. */
  tiles: Int32Array;
  /** Index of the point being left, and how far along to the next (0..1). */
  segment: number;
  along: number;
  x: number; z: number;
  /** Heading as a unit vector. */
  dirX: number; dirZ: number;
  color: number;
};

export type Traffic = RandomState & {
  readonly vehicles: Vehicle[];
  spawnDebt: number;
  /** Scratch for the search: the tile each tile was reached from, and the queue. */
  from: Int32Array;
  queue: Int32Array;
};

export function createTraffic(tiles: number, seed: number): Traffic {
  const vehicles: Vehicle[] = [];
  for (let n = 0; n < MAX_VEHICLES; n++) {
    vehicles.push({
      active: false, points: new Float32Array(tiles * 2), pointCount: 0, tiles: new Int32Array(tiles), segment: 0, along: 0,
      x: 0, z: 0, dirX: 0, dirZ: 1, color: 0,
    });
  }
  return { rng: seed >>> 0, vehicles, spawnDebt: 0, from: new Int32Array(tiles), queue: new Int32Array(tiles) };
}

const UNSEEN = -1, START = -2;

/** Shortest run of road tiles from `from` to `to`, written to `out` in travel order. Returns its length, or 0 when there is none. */
export function findRoute(city: City, traffic: Traffic, from: number, to: number, out: Int32Array) {
  const { size, structure } = city, { queue } = traffic, seen = traffic.from;
  if (structure[from] !== ROAD || structure[to] !== ROAD) return 0;
  seen.fill(UNSEEN);
  // Search backwards from the destination, so following `seen` from the start walks forwards.
  let head = 0, tail = 0;
  seen[to] = START; queue[tail++] = to;
  while (head < tail && seen[from] === UNSEEN) {
    const i = queue[head++], x = i % size, z = (i - x) / size;
    for (let facing = 0; facing < DIR_COUNT; facing++) {
      const nx = x + DIR_X[facing], nz = z + DIR_Z[facing];
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const n = nz * size + nx;
      if (structure[n] !== ROAD || seen[n] !== UNSEEN) continue;
      seen[n] = i; queue[tail++] = n;
    }
  }
  if (seen[from] === UNSEEN) return 0;
  let count = 0;
  for (let i = from; i !== START; i = seen[i]) out[count++] = i;
  return count;
}

/** Turns a run of road tiles into the points of the lane a car keeps to (it drives on the right). */
function layLane(city: City, vehicle: Vehicle, count: number) {
  const { size } = city, { tiles, points } = vehicle;
  const centre = (i: number, axis: 0 | 1) => ((axis === 0 ? i % size : Math.floor(i / size)) + 0.5) * TILE_STUDS;
  for (let n = 0; n < count; n++) {
    const before = tiles[Math.max(0, n - 1)], here = tiles[n], after = tiles[Math.min(count - 1, n + 1)];
    // Direction of travel into and out of this tile; at either end the one that exists serves for both.
    let inX = Math.sign(centre(here, 0) - centre(before, 0)), inZ = Math.sign(centre(here, 1) - centre(before, 1));
    let outX = Math.sign(centre(after, 0) - centre(here, 0)), outZ = Math.sign(centre(after, 1) - centre(here, 1));
    if (n === 0) { inX = outX; inZ = outZ; }
    if (n === count - 1) { outX = inX; outZ = inZ; }
    // The right of a heading (x, z) is (-z, x). Through a bend the lane keeps its offset from both legs.
    const straight = inX === outX && inZ === outZ;
    const rightX = straight ? -inZ : -inZ - outZ, rightZ = straight ? inX : inX + outX;
    points[n * 2] = centre(here, 0) + rightX * LANE_OFFSET;
    points[n * 2 + 1] = centre(here, 1) + rightZ * LANE_OFFSET;
  }
  vehicle.pointCount = count;
}

let buildings = new Int32Array(0);

function spawn(city: City, traffic: Traffic, vehicle: Vehicle, buildingCount: number) {
  for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
    const from = city.roadOf[buildings[nextInt(traffic, buildingCount)]], to = city.roadOf[buildings[nextInt(traffic, buildingCount)]];
    if (from < 0 || to < 0 || from === to) continue;
    const count = findRoute(city, traffic, from, to, vehicle.tiles);
    if (count < MIN_JOURNEY_TILES) continue;
    layLane(city, vehicle, count);
    vehicle.active = true; vehicle.segment = 0; vehicle.along = 0;
    vehicle.x = vehicle.points[0]; vehicle.z = vehicle.points[1];
    const dx = vehicle.points[2] - vehicle.x, dz = vehicle.points[3] - vehicle.z, length = Math.hypot(dx, dz);
    vehicle.dirX = dx / length; vehicle.dirZ = dz / length;
    vehicle.color = BODY_COLORS[nextInt(traffic, BODY_COLORS.length)];
    return;
  }
}

export function activeVehicles(traffic: Traffic) {
  let count = 0;
  for (const vehicle of traffic.vehicles) if (vehicle.active) count++;
  return count;
}

/** Moves every car by `dt` seconds and starts new ones while the city has fewer on the road than it should. */
export function stepTraffic(traffic: Traffic, city: City, dt: number) {
  const tiles = city.size * city.size;
  let active = 0;
  for (const vehicle of traffic.vehicles) {
    if (!vehicle.active) continue;
    let travel = VEHICLE_SPEED * TILE_STUDS * dt;
    while (vehicle.active) {
      const a = vehicle.segment * 2, b = a + 2;
      if (vehicle.segment >= vehicle.pointCount - 1 || city.structure[vehicle.tiles[vehicle.segment + 1]] !== ROAD) { vehicle.active = false; break; }
      const dx = vehicle.points[b] - vehicle.points[a], dz = vehicle.points[b + 1] - vehicle.points[a + 1];
      const length = Math.hypot(dx, dz), left = length * (1 - vehicle.along);
      if (travel >= left) { travel -= left; vehicle.segment++; vehicle.along = 0; continue; }
      vehicle.along += travel / length;
      vehicle.x = vehicle.points[a] + dx * vehicle.along; vehicle.z = vehicle.points[a + 1] + dz * vehicle.along;
      vehicle.dirX = dx / length; vehicle.dirZ = dz / length;
      break;
    }
    if (vehicle.active) active++;
  }

  const wanted = Math.min(MAX_VEHICLES, Math.floor(city.stats.population / RESIDENTS_PER_VEHICLE));
  traffic.spawnDebt = Math.min(VEHICLE_SPAWNS_PER_SECOND, traffic.spawnDebt + dt * VEHICLE_SPAWNS_PER_SECOND);
  if (active >= wanted || traffic.spawnDebt < 1) return;
  if (buildings.length < tiles) buildings = new Int32Array(tiles);
  let buildingCount = 0;
  for (let i = 0; i < tiles; i++) if (hasBuilding(city, i) && city.roadOf[i] >= 0) buildings[buildingCount++] = i;
  if (buildingCount < 2) return;
  for (const vehicle of traffic.vehicles) {
    if (active >= wanted || traffic.spawnDebt < 1) break;
    if (vehicle.active) continue;
    traffic.spawnDebt--;
    if (nextRandom(traffic) < SKIP_SHARE) continue;
    spawn(city, traffic, vehicle, buildingCount);
    if (vehicle.active) active++;
  }
}
