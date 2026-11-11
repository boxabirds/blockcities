/**
 * The city: one square grid of tiles held as flat arrays, plus the few numbers
 * that are not per tile. Nothing here draws; world/ reads it.
 */
import { BALANCE } from './balance.ts';
import { DEFAULT_TAX, MAP_SIZE } from './tuning.ts';

// Ground under a tile.
export const GRASS = 0, WATER = 1;

// What the mayor zoned a tile for.
export const ZONE_NONE = 0, ZONE_R = 1, ZONE_C = 2, ZONE_I = 3;
export const ZONE_COUNT = 4;

// What the mayor placed on a tile. Zoned buildings are not structures: they are `level > 0` on a zoned tile.
export const NONE = 0, ROAD = 1, WIND = 2, PLANT = 3, TOWER = 4, PARK = 5, SCHOOL = 6, CLINIC = 7, POLICE = 8, FIRE = 9, AVENUE = 10;
export const STRUCTURE_COUNT = 11;

/** Roads and avenues: what cars drive on and lots are reached from. */
export function isRoad(structure: number) { return structure === ROAD || structure === AVENUE; }

// Derived each day (see derive.ts).
export const FLAG_ACCESS = 1, FLAG_POWER = 2, FLAG_WATER = 4;

/** A building that has not yet been turned to face a road. */
export const NO_FACING = 255;

/** Step to the neighbour in each facing: 0 is +z, then +x, -z, -x (quarter turns about the vertical). */
export const DIR_X = [0, 1, 0, -1] as const;
export const DIR_Z = [1, 0, -1, 0] as const;
export const DIR_COUNT = 4;

export type Stats = {
  population: number;
  /** Jobs in finished shops and finished industry. */
  commercialJobs: number;
  industrialJobs: number;
  powerSupply: number; powerUse: number;
  waterSupply: number; waterUse: number;
  /** Money per day. */
  income: number; expenses: number;
  /** -1..1 for each zone; index 0 is unused. */
  demand: [number, number, number, number];
  zonedLots: number;
  /** Finished buildings currently without each need. */
  withoutRoad: number; withoutPower: number; withoutWater: number;
  /** Road tiles carrying more trips than they have room for. */
  congested: number;
};

export type City = {
  readonly size: number;
  seed: number;
  rng: number;
  money: number;
  day: number;
  /** Percent. */
  tax: number;
  /** How many of the population milestones have been reached; they are never taken back. */
  milestone: number;
  /** Bumped when anything that changes the ground or the road network changes. */
  revision: number;
  /** Bumped when any building gains or loses bricks. */
  buildRevision: number;

  readonly terrain: Uint8Array;
  /** 0 for none, otherwise a look for the clump of trees on the tile. */
  readonly tree: Uint8Array;
  readonly structure: Uint8Array;
  readonly zone: Uint8Array;
  /** Level of the zoned building on the tile; 0 is an empty lot. */
  readonly level: Uint8Array;
  /** Bricks placed so far of the building or service on the tile. */
  readonly progress: Uint16Array;
  readonly variant: Uint8Array;
  readonly facing: Uint8Array;
  /** Days a finished zoned building has gone without a need. */
  readonly distress: Uint8Array;
  /** The power and water flags a building had when supply was last shared out: whoever had it is served first. */
  readonly served: Uint8Array;

  // Derived.
  readonly flags: Uint8Array;
  /** Index of the road tile a lot reaches, or -1. */
  readonly roadOf: Int32Array;
  /** Facing toward that road, or NO_FACING. */
  readonly frontDir: Uint8Array;
  readonly landValue: Float32Array;
  readonly pollution: Float32Array;
  /** Trips a day over each road tile, on the way from homes to the nearest jobs. */
  readonly traffic: Float32Array;
  readonly stats: Stats;
};

export function createCity(seed: number, size = MAP_SIZE): City {
  const tiles = size * size;
  return {
    size, seed, rng: seed >>> 0, money: BALANCE.startMoney, day: 0, tax: DEFAULT_TAX, milestone: 0, revision: 1, buildRevision: 1,
    terrain: new Uint8Array(tiles), tree: new Uint8Array(tiles), structure: new Uint8Array(tiles), zone: new Uint8Array(tiles),
    level: new Uint8Array(tiles), progress: new Uint16Array(tiles), variant: new Uint8Array(tiles),
    facing: new Uint8Array(tiles).fill(NO_FACING), distress: new Uint8Array(tiles), served: new Uint8Array(tiles),
    flags: new Uint8Array(tiles), roadOf: new Int32Array(tiles).fill(-1), frontDir: new Uint8Array(tiles).fill(NO_FACING),
    landValue: new Float32Array(tiles), pollution: new Float32Array(tiles), traffic: new Float32Array(tiles),
    stats: {
      population: 0, commercialJobs: 0, industrialJobs: 0, powerSupply: 0, powerUse: 0, waterSupply: 0, waterUse: 0,
      income: 0, expenses: 0, demand: [0, 0, 0, 0], zonedLots: 0, withoutRoad: 0, withoutPower: 0, withoutWater: 0, congested: 0,
    },
  };
}

export function tileIndex(city: City, x: number, z: number) { return z * city.size + x; }
export function inMap(city: City, x: number, z: number) { return x >= 0 && z >= 0 && x < city.size && z < city.size; }

/** True when the tile holds a zoned building or a service: something built of bricks over time. */
export function hasBuilding(city: City, i: number) {
  const structure = city.structure[i];
  return structure === NONE ? city.level[i] > 0 : !isRoad(structure);
}

/** Removes whatever is built on the tile, leaving its zone. */
export function clearBuilding(city: City, i: number) {
  city.level[i] = 0; city.progress[i] = 0; city.distress[i] = 0; city.served[i] = 0; city.facing[i] = NO_FACING;
}
