import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTool, planTool, TOOLS } from '../src/game/actions.ts';
import { BOX, CONE, PALETTE, buildingBlueprint, roadBlueprint, treeBlueprint, type Blueprint } from '../src/game/blueprints.ts';
import {
  CLINIC, DIR_COUNT, FIRE, FLAG_ACCESS, GRASS, NONE, PARK, PLANT, POLICE, ROAD, SCHOOL, TOWER, WATER, WIND, ZONE_C, ZONE_I, ZONE_NONE, ZONE_R,
  tileIndex, type City,
} from '../src/game/city.ts';
import { bricksNeeded, derive, isComplete } from '../src/game/derive.ts';
import { advice, dateLabel, tileInfo } from '../src/game/info.ts';
import { loadCity, saveCity } from '../src/game/save.ts';
import { SERVICES } from '../src/game/services.ts';
import { newCity, tick } from '../src/game/sim.ts';
import { activeVehicles, createTraffic, findRoute, stepTraffic } from '../src/game/traffic.ts';
import { BRIDGE_COST, DAYS_PER_MONTH, MAP_SIZE, MAX_TAX, ROAD_COST, START_MONEY, TILE_STUDS } from '../src/game/tuning.ts';
import { ZONE_SPECS, maxLevel } from '../src/game/zones.ts';

const SEED = 7;
const VARIANTS_CHECKED = 32;
const TREE_LOOKS = 4;
const EPSILON = 1e-6;

/** A flat, empty, all-grass city, so tests choose their own ground. */
function meadow(): City {
  const city = newCity(SEED);
  city.terrain.fill(GRASS); city.tree.fill(0);
  derive(city);
  return city;
}

function run(city: City, days: number) { for (let day = 0; day < days; day++) tick(city); }

/** A small working town: one street with homes on one side, shops and industry on the other, power and water. */
function town(): City {
  const city = meadow();
  applyTool(city, 'road', 10, 20, 30, 20);
  applyTool(city, 'homes', 10, 18, 30, 19);
  applyTool(city, 'shops', 10, 21, 20, 22);
  applyTool(city, 'industry', 22, 21, 30, 22);
  applyTool(city, 'wind', 0, 0, 9, 21);
  applyTool(city, 'wind', 0, 0, 9, 19);
  applyTool(city, 'tower', 0, 0, 9, 18);
  return city;
}

// --- Blueprints ------------------------------------------------------------------

function everyBlueprint(): { name: string; blueprint: Blueprint }[] {
  const all: { name: string; blueprint: Blueprint }[] = [];
  for (const zone of [ZONE_R, ZONE_C, ZONE_I]) {
    for (let level = 1; level <= maxLevel(zone); level++) {
      for (let variant = 0; variant < VARIANTS_CHECKED; variant++) all.push({ name: `zone ${zone} level ${level} variant ${variant}`, blueprint: buildingBlueprint(NONE, zone, level, variant) });
    }
  }
  for (const service of [WIND, PLANT, TOWER, PARK, SCHOOL, CLINIC, POLICE, FIRE]) all.push({ name: SERVICES[service]!.name, blueprint: buildingBlueprint(service, ZONE_NONE, 0, 1) });
  for (let links = 0; links < 1 << DIR_COUNT; links++) {
    all.push({ name: `road ${links}`, blueprint: roadBlueprint(links, false) }, { name: `bridge ${links}`, blueprint: roadBlueprint(links, true) });
  }
  for (let look = 1; look <= TREE_LOOKS; look++) all.push({ name: `trees ${look}`, blueprint: treeBlueprint(look) });
  return all;
}

test('every blueprint stays on its lot, is built bottom up and uses real colours', () => {
  for (const { name, blueprint } of everyBlueprint()) {
    assert.ok(blueprint.bricks.length > 0, name);
    let below = -Infinity;
    for (const brick of blueprint.bricks) {
      const turned = brick.rot % 2 === 1, halfX = (turned ? brick.d : brick.w) / 2, halfZ = (turned ? brick.w : brick.d) / 2;
      // Tree canopies (cones) may hang over the edge of a lot; nothing else may.
      if (brick.shape !== CONE) {
        assert.ok(brick.cx - halfX >= -EPSILON && brick.cx + halfX <= TILE_STUDS + EPSILON, `${name}: brick leaves the lot in x`);
        assert.ok(brick.cz - halfZ >= -EPSILON && brick.cz + halfZ <= TILE_STUDS + EPSILON, `${name}: brick leaves the lot in z`);
      }
      assert.ok(brick.w > 0 && brick.h > 0 && brick.d > 0, `${name}: brick has no size`);
      assert.ok(brick.y >= below, `${name}: bricks are not in bottom-up order`);
      assert.ok(PALETTE[brick.color], `${name}: unknown colour ${brick.color}`);
      below = brick.y;
    }
  }
});

test('no two cuboid bricks of a building occupy the same space', () => {
  for (const { name, blueprint } of everyBlueprint()) {
    const boxes = blueprint.bricks.filter(brick => brick.shape === BOX);
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const p = boxes[a], q = boxes[b];
        const apart = Math.abs(p.cx - q.cx) >= (p.w + q.w) / 2 - EPSILON || Math.abs(p.cz - q.cz) >= (p.d + q.d) / 2 - EPSILON
          || p.y >= q.y + q.h - EPSILON || q.y >= p.y + p.h - EPSILON;
        assert.ok(apart, `${name}: bricks ${a} and ${b} overlap`);
      }
    }
  }
});

test('a stud shows only between its own brick being placed and the brick above it', () => {
  for (const { name, blueprint } of everyBlueprint()) {
    for (const stud of blueprint.studs) {
      assert.ok(stud.cover > stud.owner, `${name}: a stud is covered before its brick exists`);
      const owner = blueprint.bricks[stud.owner];
      assert.equal(stud.y, owner.y + owner.h, `${name}: stud is not on top of its brick`);
      assert.ok(Math.abs(stud.x - owner.cx) < owner.w / 2 && Math.abs(stud.z - owner.cz) < owner.d / 2, `${name}: stud is off its brick`);
    }
  }
  // The lot plate of a tower is completely covered once it is finished; its roof still shows studs.
  const tower = buildingBlueprint(NONE, ZONE_C, 4, 0);
  assert.equal(tower.studs.filter(stud => stud.owner === 0 && stud.cover === Infinity).length, 0);
  assert.ok(tower.studs.some(stud => stud.cover === Infinity));
});

test('taller levels take more bricks', () => {
  for (const zone of [ZONE_R, ZONE_C, ZONE_I]) {
    for (let level = 2; level <= maxLevel(zone); level++) {
      assert.ok(buildingBlueprint(NONE, zone, level, 0).bricks.length > buildingBlueprint(NONE, zone, level - 1, 0).bricks.length, `zone ${zone} level ${level}`);
    }
  }
});

// --- Map -------------------------------------------------------------------------

test('a new map has a river from edge to edge, a lake, trees and mostly grass', () => {
  const city = newCity(SEED), tiles = MAP_SIZE * MAP_SIZE;
  let water = 0, trees = 0;
  for (let z = 0; z < MAP_SIZE; z++) {
    let rowWater = 0;
    for (let x = 0; x < MAP_SIZE; x++) {
      const i = tileIndex(city, x, z);
      if (city.terrain[i] === WATER) { rowWater++; water++; assert.equal(city.tree[i], 0); } else if (city.tree[i]) trees++;
    }
    assert.ok(rowWater >= 2, `row ${z} has no river`);
  }
  assert.ok(water / tiles > 0.05 && water / tiles < 0.25, `water share ${water / tiles}`);
  assert.ok(trees / tiles > 0.03 && trees / tiles < 0.4, `tree share ${trees / tiles}`);
  assert.deepEqual(Array.from(newCity(SEED).terrain), Array.from(city.terrain), 'same seed, same map');
  assert.notDeepEqual(Array.from(newCity(SEED + 1).terrain), Array.from(city.terrain), 'different seed, different map');
});

// --- Tools -----------------------------------------------------------------------

test('a road drag lays an L of tiles and charges for each', () => {
  const city = meadow();
  const plan = applyTool(city, 'road', 5, 5, 9, 8);
  assert.ok(plan.ok);
  assert.equal(plan.tiles.length, 8);
  assert.equal(city.money, START_MONEY - 8 * ROAD_COST);
  for (const [x, z] of [[5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [9, 6], [9, 7], [9, 8]]) assert.equal(city.structure[tileIndex(city, x, z)], ROAD);
  // Laying it again changes nothing and costs nothing.
  const again = applyTool(city, 'road', 5, 5, 9, 8);
  assert.equal(again.ok, false);
  assert.equal(city.money, START_MONEY - 8 * ROAD_COST);
});

test('a road over water is a bridge and costs more', () => {
  const city = meadow();
  city.terrain[tileIndex(city, 6, 5)] = WATER;
  const plan = applyTool(city, 'road', 5, 5, 7, 5);
  assert.equal(plan.cost, 2 * ROAD_COST + BRIDGE_COST);
  assert.equal(tileInfo(city, tileIndex(city, 6, 5)).title, 'Bridge');
});

test('zoning fills a rectangle, skips water and roads, and is free', () => {
  const city = meadow();
  applyTool(city, 'road', 4, 4, 8, 4);
  city.terrain[tileIndex(city, 5, 5)] = WATER;
  const plan = applyTool(city, 'homes', 4, 4, 8, 6);
  assert.ok(plan.ok);
  assert.equal(plan.cost, 0);
  assert.equal(plan.changes.filter(Boolean).length, 15 - 5 - 1);
  assert.equal(city.zone[tileIndex(city, 4, 5)], ZONE_R);
  assert.equal(city.zone[tileIndex(city, 5, 5)], ZONE_NONE);
  assert.equal(city.zone[tileIndex(city, 6, 4)], ZONE_NONE);
  applyTool(city, 'dezone', 4, 5, 4, 5);
  assert.equal(city.zone[tileIndex(city, 4, 5)], ZONE_NONE);
});

test('nothing is built without the money for all of it', () => {
  const city = meadow();
  city.money = 3 * ROAD_COST;
  const plan = applyTool(city, 'road', 0, 0, 9, 0);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'Not enough money');
  assert.equal(city.structure[0], NONE);
  assert.equal(city.money, 3 * ROAD_COST);
});

test('a service cannot be placed on water or on top of something, and says why', () => {
  const city = meadow();
  city.terrain[tileIndex(city, 2, 2)] = WATER;
  assert.equal(planTool(city, 'park', 0, 0, 2, 2).reason, 'Cannot build on water');
  assert.ok(applyTool(city, 'park', 0, 0, 3, 3).ok);
  assert.equal(city.structure[tileIndex(city, 3, 3)], PARK);
  assert.equal(planTool(city, 'school', 0, 0, 3, 3).reason, 'Something is built here');
  assert.equal(planTool(city, 'park', 0, 0, -1, 3).reason, 'Off the map');
});

test('bulldozing clears a building but keeps its zone; every tool plans without throwing', () => {
  const city = town();
  run(city, 2 * DAYS_PER_MONTH);
  const built = Array.from(city.level).findIndex(level => level > 0);
  assert.ok(built >= 0);
  const x = built % city.size, z = Math.floor(built / city.size), zone = city.zone[built];
  assert.ok(applyTool(city, 'bulldoze', x, z, x, z).ok);
  assert.equal(city.level[built], 0);
  assert.equal(city.zone[built], zone);
  for (const tool of TOOLS) planTool(city, tool, 0, 0, 5, 5);
});

// --- Simulation ------------------------------------------------------------------

test('lots within two tiles of a road are reached and face it', () => {
  const city = meadow();
  applyTool(city, 'road', 10, 10, 14, 10);
  const near = tileIndex(city, 12, 11), far = tileIndex(city, 12, 12), tooFar = tileIndex(city, 12, 13);
  assert.ok(city.flags[near] & FLAG_ACCESS);
  assert.ok(city.flags[far] & FLAG_ACCESS);
  assert.equal(city.flags[tooFar] & FLAG_ACCESS, 0);
  // The road is toward -z from these lots: facing 2.
  assert.equal(city.frontDir[near], 2);
  assert.equal(city.frontDir[far], 2);
  assert.equal(city.frontDir[tileIndex(city, 12, 9)], 0);
  assert.equal(city.roadOf[far], tileIndex(city, 12, 10));
});

test('nothing grows without a road, or without power and water', () => {
  const total = (city: City) => city.level.reduce((sum, level) => sum + level, 0);
  const noRoad = meadow();
  applyTool(noRoad, 'homes', 10, 10, 14, 14);
  applyTool(noRoad, 'wind', 0, 0, 20, 20);
  applyTool(noRoad, 'tower', 0, 0, 21, 20);
  run(noRoad, 3 * DAYS_PER_MONTH);
  assert.equal(total(noRoad), 0);
  assert.equal(tileInfo(noRoad, tileIndex(noRoad, 12, 12)).lines[0], 'Waiting for a road within two tiles');

  const noPower = meadow();
  applyTool(noPower, 'road', 10, 10, 20, 10);
  applyTool(noPower, 'homes', 10, 11, 20, 12);
  run(noPower, 3 * DAYS_PER_MONTH);
  assert.equal(total(noPower), 0);
  assert.equal(tileInfo(noPower, tileIndex(noPower, 12, 11)).lines[0], 'Waiting for spare power');
  applyTool(noPower, 'wind', 0, 0, 9, 10);
  run(noPower, DAYS_PER_MONTH);
  assert.equal(total(noPower), 0);
  assert.equal(tileInfo(noPower, tileIndex(noPower, 12, 11)).lines[0], 'Waiting for spare water');
});

test('a town with roads, zones, power and water grows, brick by brick, and pays its way', () => {
  const city = town();
  // Utilities are themselves built brick by brick, so the first homes start a little after they finish.
  let site = -1;
  for (let day = 0; day < DAYS_PER_MONTH && site < 0; day++) { tick(city); site = Array.from(city.level).findIndex(level => level > 0); }
  assert.ok(site >= 0, 'a building has started within a month');
  tick(city);
  assert.ok(city.progress[site] > 0 && !isComplete(city, site), 'it is part built');
  assert.match(tileInfo(city, site).lines[0], /^Under construction: \d+ of \d+ bricks$/);
  run(city, 12 * DAYS_PER_MONTH);
  assert.ok(city.progress[site] === bricksNeeded(city, site) || city.level[site] === 0);
  const { stats } = city;
  assert.ok(stats.population >= 150, `population ${stats.population}`);
  assert.ok(stats.commercialJobs > 0 && stats.industrialJobs > 0, 'shops and industry both opened');
  assert.ok(stats.income > stats.expenses, `income ${stats.income} against ${stats.expenses}`);
  assert.ok(city.money > START_MONEY - 3000, `money ${city.money}`);
  assert.ok(stats.powerUse <= stats.powerSupply && stats.waterUse <= stats.waterSupply, 'growth stops at what the utilities can serve');
});

test('nobody lives or works in a building site', () => {
  const city = town();
  let started = false;
  for (let day = 0; day < DAYS_PER_MONTH && !started; day++) { tick(city); started = city.level.some(level => level > 0); }
  assert.ok(started);
  assert.equal(city.stats.population + city.stats.commercialJobs + city.stats.industrialJobs, 0);
});

test('the same seed and the same orders give the same city', () => {
  const a = town(), b = town();
  run(a, 200); run(b, 200);
  assert.equal(saveCity(a), saveCity(b));
});

test('homes stay small without services and grow tall with them', () => {
  const tallest = (city: City, zone: number) => Math.max(...Array.from(city.level).filter((_, i) => city.zone[i] === zone));
  const plain = town();
  run(plain, 20 * DAYS_PER_MONTH);
  assert.equal(tallest(plain, ZONE_R), 1, 'no services: cottages only');

  const served = town();
  // Two more streets of lots, far more power and water, and every service among the homes.
  served.money = 1e6;
  applyTool(served, 'road', 9, 15, 30, 15); applyTool(served, 'road', 9, 25, 30, 25); applyTool(served, 'road', 9, 12, 9, 28);
  applyTool(served, 'homes', 10, 13, 30, 14); applyTool(served, 'homes', 10, 16, 30, 17);
  applyTool(served, 'shops', 10, 23, 20, 24); applyTool(served, 'industry', 22, 23, 30, 24);
  for (let n = 0; n < 3; n++) applyTool(served, 'plant', 0, 0, 34 + n, 27);
  for (let n = 0; n < 8; n++) applyTool(served, 'tower', 0, 0, 8, 12 + n);
  applyTool(served, 'park', 0, 0, 15, 17); applyTool(served, 'park', 0, 0, 25, 17);
  applyTool(served, 'school', 0, 0, 20, 16); applyTool(served, 'clinic', 0, 0, 19, 16);
  applyTool(served, 'police', 0, 0, 21, 16); applyTool(served, 'fire', 0, 0, 22, 16);
  run(served, 40 * DAYS_PER_MONTH);
  assert.ok(tallest(served, ZONE_R) >= 3, `tallest home level ${tallest(served, ZONE_R)}`);
  assert.ok(served.stats.population > plain.stats.population * 2, `${served.stats.population} against ${plain.stats.population}`);
});

test('pollution from industry lowers the land value homes feel next to it', () => {
  const city = town();
  run(city, 12 * DAYS_PER_MONTH);
  const besideIndustry = tileIndex(city, 26, 19), farAway = tileIndex(city, 11, 19);
  assert.ok(city.pollution[besideIndustry] > 0);
  assert.ok(city.pollution[besideIndustry] > city.pollution[farAway]);
});

test('a town that loses its power is abandoned', () => {
  const city = town();
  run(city, 6 * DAYS_PER_MONTH);
  assert.ok(city.stats.population > 0);
  applyTool(city, 'bulldoze', 9, 19, 9, 21);
  assert.equal(city.stats.powerSupply, 0);
  assert.ok(city.stats.withoutPower > 0);
  run(city, 2 * DAYS_PER_MONTH);
  assert.equal(city.stats.population, 0);
  assert.ok(city.zone.some(zone => zone === ZONE_R), 'the zoning is still there');
});

test('high taxes turn demand negative and the town shrinks', () => {
  const city = town();
  run(city, 12 * DAYS_PER_MONTH);
  const before = city.stats.population;
  city.tax = MAX_TAX;
  run(city, 12 * DAYS_PER_MONTH);
  assert.ok(city.stats.demand[ZONE_R] < 0);
  assert.ok(city.stats.population < before, `${city.stats.population} from ${before}`);
});

test('capacities rise with level in every zone', () => {
  for (const zone of [ZONE_R, ZONE_C, ZONE_I]) {
    const { capacity } = ZONE_SPECS[zone];
    for (let level = 1; level < capacity.length; level++) assert.ok(capacity[level] > capacity[level - 1]);
  }
});

// --- Save ------------------------------------------------------------------------

test('a saved city loads back identical and keeps running identically', () => {
  const city = town();
  run(city, 100);
  const copy = loadCity(saveCity(city));
  assert.ok(copy);
  assert.equal(saveCity(copy), saveCity(city));
  assert.deepEqual(copy.stats, city.stats);
  run(city, 50); run(copy, 50);
  assert.equal(saveCity(copy), saveCity(city));
  assert.equal(loadCity('not json'), null);
  assert.equal(loadCity('{"version":99}'), null);
  assert.equal(loadCity(saveCity(city).replace('"terrain":[', '"terrain":[null,')), null);
});

test('dates count thirty-day months', () => {
  assert.equal(dateLabel(0), '1 January, year 1');
  assert.equal(dateLabel(DAYS_PER_MONTH + 2), '3 February, year 1');
  assert.equal(dateLabel(DAYS_PER_MONTH * 12), '1 January, year 2');
});

// --- Traffic ---------------------------------------------------------------------

test('a route follows the road and there is none across a gap', () => {
  const city = meadow();
  applyTool(city, 'road', 5, 5, 9, 8);
  applyTool(city, 'road', 20, 20, 22, 20);
  const traffic = createTraffic(city.size * city.size, 1), out = new Int32Array(city.size * city.size);
  const count = findRoute(city, traffic, tileIndex(city, 5, 5), tileIndex(city, 9, 8), out);
  assert.equal(count, 8);
  assert.equal(out[0], tileIndex(city, 5, 5));
  assert.equal(out[count - 1], tileIndex(city, 9, 8));
  for (let n = 1; n < count; n++) {
    const step = Math.abs(out[n] % city.size - out[n - 1] % city.size) + Math.abs(Math.floor(out[n] / city.size) - Math.floor(out[n - 1] / city.size));
    assert.equal(step, 1);
    assert.equal(city.structure[out[n]], ROAD);
  }
  assert.equal(findRoute(city, traffic, tileIndex(city, 5, 5), tileIndex(city, 21, 20), out), 0);
});

test('cars appear in a living town, keep to the right of the road, and vanish when it is bulldozed', () => {
  const city = town();
  run(city, 12 * DAYS_PER_MONTH);
  const traffic = createTraffic(city.size * city.size, 3), STEP = 1 / 60, FRAMES = 600, ROAD_Z = 20, STRAIGHT = 0.99;
  let seen = 0;
  for (let frame = 0; frame < FRAMES; frame++) {
    stepTraffic(traffic, city, STEP);
    for (const vehicle of traffic.vehicles) {
      if (!vehicle.active) continue;
      seen++;
      const tileX = Math.floor(vehicle.x / TILE_STUDS), tileZ = Math.floor(vehicle.z / TILE_STUDS);
      assert.equal(city.structure[tileIndex(city, tileX, tileZ)], ROAD, 'a car is on a road tile');
      // On this east-west street, heading +x means keeping to the +z half, and the other way round.
      const offset = vehicle.z - (ROAD_Z + 0.5) * TILE_STUDS;
      if (Math.abs(vehicle.dirX) > STRAIGHT) assert.ok(offset * vehicle.dirX > 0, 'a car is on the wrong side');
    }
  }
  assert.ok(seen > 0 && activeVehicles(traffic) > 0, 'there are cars');
  applyTool(city, 'bulldoze', 10, 20, 30, 20);
  stepTraffic(traffic, city, STEP);
  assert.equal(activeVehicles(traffic), 0);
});

test('the advisor names the next thing a new mayor has to do', () => {
  const city = meadow();
  assert.match(advice(city), /laying a road/);
  applyTool(city, 'road', 10, 20, 30, 20);
  assert.match(advice(city), /Zone some homes/);
  applyTool(city, 'homes', 10, 18, 30, 19);
  assert.match(advice(city), /wind turbine/);
  applyTool(city, 'wind', 0, 0, 9, 21);
  assert.match(advice(city), /water tower/);
  applyTool(city, 'tower', 0, 0, 9, 18);
  run(city, 4 * DAYS_PER_MONTH);
  assert.match(advice(city), /^(Shops|Industry) are wanted/);
});
