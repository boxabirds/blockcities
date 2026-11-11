/** Lays out a fresh map: a river down one side, a lake, and clumps of trees. Fixed by the city's seed. */
import { GRASS, WATER, tileIndex, type City } from './city.ts';
import { hash3 } from './rng.ts';

/** The river runs along z at this share of the map's width, wandering by the two amplitudes (in tiles). */
const RIVER_POSITION = 0.72;
const RIVER_SWING = 3.2;
const RIVER_RIPPLE = 1.3;
const RIVER_SWING_PERIOD = 31;
const RIVER_RIPPLE_PERIOD = 11;
const RIVER_HALF_WIDTH = 1.3;
/** The lake: centre as shares of the map, and its two radii in tiles. */
const LAKE_X = 0.22;
const LAKE_Z = 0.7;
const LAKE_RADIUS_X = 4.2;
const LAKE_RADIUS_Z = 3;
/** Trees grow where a smooth noise of this cell size is above the threshold, and then only on some tiles. */
const WOOD_CELL = 6;
const WOOD_THRESHOLD = 0.56;
const WOOD_DENSITY = 0.7;
const TREE_LOOKS = 4;
const TAU = Math.PI * 2;
// Salts that separate the uses of the position hash.
const SALT_WOOD = 11, SALT_TREE = 23, SALT_LOOK = 37, SALT_PHASE = 53;

function smooth(t: number) { return t * t * (3 - 2 * t); }

/** Value noise in [0, 1) over cells of `cell` tiles. */
function valueNoise(seed: number, x: number, z: number, cell: number) {
  const fx = x / cell, fz = z / cell, x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = smooth(fx - x0), tz = smooth(fz - z0);
  const corner = (cx: number, cz: number) => hash3(seed + SALT_WOOD, cx, cz);
  const near = corner(x0, z0) + (corner(x0 + 1, z0) - corner(x0, z0)) * tx;
  const far = corner(x0, z0 + 1) + (corner(x0 + 1, z0 + 1) - corner(x0, z0 + 1)) * tx;
  return near + (far - near) * tz;
}

export function generateTerrain(city: City) {
  const { size, seed } = city;
  const phase = hash3(seed, SALT_PHASE, 0) * TAU, phase2 = hash3(seed, SALT_PHASE, 1) * TAU;
  const lakeX = size * LAKE_X, lakeZ = size * LAKE_Z;
  for (let z = 0; z < size; z++) {
    const river = size * RIVER_POSITION + Math.sin(z / RIVER_SWING_PERIOD * TAU + phase) * RIVER_SWING
      + Math.sin(z / RIVER_RIPPLE_PERIOD * TAU + phase2) * RIVER_RIPPLE;
    for (let x = 0; x < size; x++) {
      const i = tileIndex(city, x, z);
      const inRiver = Math.abs(x + 0.5 - river) < RIVER_HALF_WIDTH;
      const lx = (x + 0.5 - lakeX) / LAKE_RADIUS_X, lz = (z + 0.5 - lakeZ) / LAKE_RADIUS_Z;
      const water = inRiver || lx * lx + lz * lz < 1;
      city.terrain[i] = water ? WATER : GRASS;
      const wooded = !water && valueNoise(seed, x, z, WOOD_CELL) > WOOD_THRESHOLD && hash3(seed + SALT_TREE, x, z) < WOOD_DENSITY;
      city.tree[i] = wooded ? 1 + Math.floor(hash3(seed + SALT_LOOK, x, z) * TREE_LOOKS) : 0;
    }
  }
}
