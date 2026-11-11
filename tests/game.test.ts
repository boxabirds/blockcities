import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/game/balance.ts';
import { applyTool, planTool, TOOLS } from '../src/game/actions.ts';
import { BOX, CONE, PALETTE, buildingBlueprint, roadBlueprint, treeBlueprint, type Blueprint } from '../src/game/blueprints.ts';
import {
  AVENUE, CLINIC, DIR_COUNT, FIRE, FLAG_ACCESS, GRASS, NONE, PARK, PLANT, POLICE, ROAD, SCHOOL, TOWER, WATER, WIND, ZONE_C, ZONE_I, ZONE_NONE, ZONE_R,
  hasBuilding, tileIndex, type City,
} from '../src/game/city.ts';
import { bricksNeeded, congestion, derive, desirability, isComplete, isOccupied, staffing, trafficNoise } from '../src/game/derive.ts';
import { MISSING_POWER, MISSING_WATER, advice, dateLabel, tileInfo } from '../src/game/info.ts';
import { loadCity, saveCity } from '../src/game/save.ts';
import { SERVICES } from '../src/game/services.ts';
import { newCity, tick } from '../src/game/sim.ts';
import { activeVehicles, createTraffic, findRoute, stepTraffic } from '../src/game/traffic.ts';
import { AVENUE_CAPACITY, DAYS_PER_MONTH, ROAD_CAPACITY, WORKFORCE_SHARE, MAP_SIZE, MAX_TAX, TILE_STUDS } from '../src/game/tuning.ts';
import { ZONE_SPECS, maxLevel } from '../src/game/zones.ts';
import { HOURS_PER_DAY, NOON, clockLabel, daylightAt } from '../src/world/daylight.ts';
import { missingNeeds } from '../src/world/need-icons.ts';

const { startMoney: START_MONEY, roadCost: ROAD_COST, bridgeCost: BRIDGE_COST, avenueCost: AVENUE_COST, staffingPopulation: STAFFING_POPULATION } = BALANCE;
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
    all.push({ name: `avenue ${links}`, blueprint: roadBlueprint(links, false, true) }, { name: `avenue bridge ${links}`, blueprint: roadBlueprint(links, true, true) });
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
  assert.equal(tileInfo(city, tileIndex(city, 6, 5)).title, 'Road bridge');
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

test('a city in debt can still bulldoze, and nothing else', () => {
  const city = meadow();
  applyTool(city, 'school', 0, 0, 5, 5);
  city.money = -500;
  assert.equal(planTool(city, 'road', 0, 0, 3, 0).reason, 'Not enough money');
  assert.ok(applyTool(city, 'bulldoze', 5, 5, 5, 5).ok);
  assert.equal(city.structure[tileIndex(city, 5, 5)], NONE);
  assert.equal(city.money, -500 - BALANCE.bulldozeCost);
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

test('nothing grows without a road', () => {
  const noRoad = meadow();
  applyTool(noRoad, 'homes', 10, 10, 14, 14);
  applyTool(noRoad, 'wind', 0, 0, 20, 20);
  applyTool(noRoad, 'tower', 0, 0, 21, 20);
  run(noRoad, 3 * DAYS_PER_MONTH);
  assert.equal(noRoad.level.reduce((sum, level) => sum + level, 0), 0);
  assert.equal(tileInfo(noRoad, tileIndex(noRoad, 12, 12)).lines[0], 'Waiting for a road within two tiles');
});

test('homes are built before power and water arrive, and stand empty and marked until both do', () => {
  const city = meadow();
  applyTool(city, 'road', 10, 10, 20, 10);
  applyTool(city, 'homes', 10, 11, 20, 12);
  run(city, 3 * DAYS_PER_MONTH);
  const finished = () => { const found: number[] = []; city.level.forEach((level, i) => { if (level > 0 && isComplete(city, i)) found.push(i); }); return found; };
  const homes = finished();
  assert.ok(homes.length > 0, 'houses went up with no utilities');
  assert.equal(city.stats.population, 0, 'nobody lives in them');
  assert.equal(city.stats.income, 0, 'and they pay nothing');
  assert.equal(city.stats.withoutPower, homes.length);
  assert.equal(city.stats.withoutWater, homes.length);
  assert.deepEqual(missingNeeds(city, homes[0]), ['power', 'water']);
  assert.ok(homes.every(i => city.level[i] === 1), 'an empty house does not grow');
  const lines = tileInfo(city, homes[0]).lines;
  assert.match(lines[0], /^Standing empty/);
  assert.ok(lines.some(line => line.startsWith(MISSING_POWER)) && lines.some(line => line.startsWith(MISSING_WATER)));
  assert.match(advice(city), /stand empty without power/);

  // Empty houses wait as long as it takes: nothing is cleared for want of power or water.
  run(city, 12 * DAYS_PER_MONTH);
  assert.ok(finished().length >= homes.length);

  applyTool(city, 'wind', 0, 0, 9, 10);
  run(city, DAYS_PER_MONTH);
  assert.equal(city.stats.withoutPower, 0);
  assert.ok(city.stats.withoutWater > 0);
  assert.deepEqual(missingNeeds(city, homes[0]), ['water']);
  assert.equal(city.stats.population, 0, 'power alone is not enough');

  applyTool(city, 'tower', 0, 0, 9, 11);
  run(city, DAYS_PER_MONTH);
  assert.equal(city.stats.withoutWater, 0);
  assert.deepEqual(missingNeeds(city, homes[0]), []);
  assert.ok(city.stats.population > 0 && city.stats.income > 0, 'people move in and pay tax');
});

test('when supply runs short only the buildings left out stand empty', () => {
  const city = town();
  run(city, 12 * DAYS_PER_MONTH);
  // Power is shared out in map order, so some of the town keeps it and the rest goes dark.
  const lived = () => city.stats.population + city.stats.commercialJobs + city.stats.industrialJobs;
  const before = lived(), income = city.stats.income;
  applyTool(city, 'bulldoze', 9, 19, 9, 19);
  assert.ok(city.stats.powerUse > city.stats.powerSupply, `${city.stats.powerUse} of ${city.stats.powerSupply}`);
  assert.ok(city.stats.withoutPower > 0);
  assert.ok(lived() > 0 && lived() < before, `${lived()} from ${before}`);
  assert.ok(city.stats.income < income, 'the dark buildings pay nothing');
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

test('a new building never takes power or water from one that is lived in', () => {
  const city = meadow();
  applyTool(city, 'road', 10, 20, 30, 20);
  // Homes south of the road come later in map order than the lots zoned north of it afterwards.
  applyTool(city, 'homes', 10, 21, 30, 22);
  applyTool(city, 'wind', 0, 0, 9, 21);
  applyTool(city, 'tower', 0, 0, 9, 22);
  run(city, 4 * DAYS_PER_MONTH);
  const lived: number[] = [];
  city.level.forEach((level, i) => { if (level > 0 && isOccupied(city, i)) lived.push(i); });
  assert.ok(lived.length > 0);
  const supply = city.stats.powerSupply;
  applyTool(city, 'shops', 10, 16, 30, 19);
  applyTool(city, 'industry', 10, 12, 30, 15);
  run(city, 8 * DAYS_PER_MONTH);
  assert.equal(city.stats.powerSupply, supply);
  assert.ok(city.stats.withoutPower > 0, 'the newcomers outran the turbine');
  assert.ok(lived.every(i => city.level[i] === 0 || !isComplete(city, i) || isOccupied(city, i)), 'everyone who had power kept it');
  assert.ok(city.stats.population > 0);
  // The same holds across a save: who is connected is remembered.
  const loaded = loadCity(saveCity(city))!;
  assert.equal(loaded.stats.population, city.stats.population);
  assert.deepEqual(Array.from(loaded.flags), Array.from(city.flags));
});

test('a save written before connections were remembered still loads', () => {
  const city = town();
  run(city, 6 * DAYS_PER_MONTH);
  const old = JSON.parse(saveCity(city)) as Record<string, unknown>;
  delete old.served; delete old.milestone;
  const loaded = loadCity(JSON.stringify(old));
  assert.ok(loaded, 'the old save is accepted');
  assert.equal(loaded!.stats.population, city.stats.population);
});

test('a town that loses its power empties but is not cleared, and fills again when the power is back', () => {
  const city = town();
  run(city, 6 * DAYS_PER_MONTH);
  const before = city.stats.population, buildings = city.level.filter(level => level > 0).length;
  assert.ok(before > 0);
  applyTool(city, 'bulldoze', 9, 19, 9, 21);
  assert.equal(city.stats.powerSupply, 0);
  assert.ok(city.stats.withoutPower > 0);
  assert.equal(city.stats.population, 0);
  assert.equal(city.stats.income, 0);
  run(city, 2 * DAYS_PER_MONTH);
  assert.equal(city.stats.population, 0);
  assert.ok(city.level.filter(level => level > 0).length >= buildings, 'the buildings are still standing');
  applyTool(city, 'wind', 0, 0, 9, 21);
  applyTool(city, 'wind', 0, 0, 9, 19);
  run(city, DAYS_PER_MONTH);
  assert.ok(city.stats.population >= before, `${city.stats.population} from ${before}`);
});

test('a building that loses its road is still abandoned', () => {
  const city = town();
  run(city, 6 * DAYS_PER_MONTH);
  assert.ok(city.level.some(level => level > 0));
  applyTool(city, 'bulldoze', 10, 20, 30, 20);
  run(city, 2 * DAYS_PER_MONTH);
  assert.ok(!city.level.some(level => level > 0), 'everything zoned has been cleared');
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

test('the advisor says when high tax, not debt, is what has stopped the city growing', () => {
  const city = town();
  run(city, 12 * DAYS_PER_MONTH);
  assert.doesNotMatch(advice(city), /tax/);
  city.tax = MAX_TAX;
  run(city, DAYS_PER_MONTH);
  assert.ok(city.money >= 0 && city.stats.income > city.stats.expenses && city.stats.demand[ZONE_R] <= 0);
  assert.match(advice(city), new RegExp(`${MAX_TAX}% tax.*lower it in Budget`));
});

// --- Traffic load, avenues and staffing ------------------------------------------

/** Homes at the west end of one long street and jobs at the east end, all finished at the level given. */
function commuterStreet(homeLevel: number): City {
  const city = meadow();
  applyTool(city, 'road', 5, 20, 40, 20);
  applyTool(city, 'homes', 5, 19, 14, 19);
  applyTool(city, 'shops', 36, 19, 40, 19);
  for (let x = 5; x <= 14; x++) city.level[tileIndex(city, x, 19)] = homeLevel;
  for (let x = 36; x <= 40; x++) city.level[tileIndex(city, x, 19)] = 1;
  applyTool(city, 'plant', 0, 0, 44, 30); applyTool(city, 'tower', 0, 0, 44, 32);
  for (let i = 0; i < city.size * city.size; i++) if (hasBuilding(city, i)) city.progress[i] = bricksNeeded(city, i);
  derive(city);
  return city;
}

test('every working resident makes one trip to the nearest jobs, and the trips add up along the road', () => {
  const city = commuterStreet(3), perHome = ZONE_SPECS[ZONE_R].capacity[3] * WORKFORCE_SHARE;
  const at = (x: number) => city.traffic[tileIndex(city, x, 20)];
  assert.equal(at(5), perHome, 'the far end carries one home');
  assert.equal(at(9), 5 * perHome, 'five homes in');
  assert.equal(at(14), 10 * perHome, 'all ten homes');
  assert.equal(at(25), 10 * perHome, 'the open road carries all of it');
  assert.equal(at(36), 10 * perHome, 'up to the first road with jobs on it');
  assert.equal(at(38), 0, 'nobody drives past the first jobs');
  assert.equal(city.traffic[tileIndex(city, 25, 19)], 0, 'only roads carry traffic');
  // With no jobs to go to, nobody travels.
  applyTool(city, 'dezone', 36, 19, 40, 19);
  assert.equal(at(25), 0);
});

test('a road over capacity is noisy for the homes on it, and an avenue quietens it', () => {
  const quiet = commuterStreet(1), loud = commuterStreet(5);
  const home = tileIndex(loud, 14, 19), road = tileIndex(loud, 14, 20);
  assert.equal(trafficNoise(quiet, home), 0);
  assert.ok(congestion(loud, road) > 1, `congestion ${congestion(loud, road)}`);
  assert.ok(trafficNoise(loud, home) > 0);
  assert.ok(desirability(loud, home, ZONE_R) < desirability(quiet, home, ZONE_R));
  assert.equal(desirability(loud, home, ZONE_C), desirability(quiet, home, ZONE_C), 'shops do not mind');
  assert.ok(loud.stats.congested > 0);
  assert.match(tileInfo(loud, road).lines[0], /trips a day · over capacity$/);
  assert.match(advice(loud), /more traffic than they can take/);

  const noisy = trafficNoise(loud, home), before = loud.money, plan = applyTool(loud, 'avenue', 5, 20, 40, 20);
  assert.ok(plan.ok);
  assert.equal(before - loud.money, 36 * (AVENUE_COST - ROAD_COST), 'widening a road costs the difference');
  assert.equal(loud.structure[road], AVENUE);
  assert.equal(hasBuilding(loud, road), false);
  assert.equal(congestion(loud, road), loud.traffic[road] / AVENUE_CAPACITY);
  assert.ok(AVENUE_CAPACITY > ROAD_CAPACITY);
  assert.ok(trafficNoise(loud, home) < noisy / 2, `noise ${trafficNoise(loud, home)} from ${noisy}`);
  assert.equal(loud.stats.congested, 0);
  assert.equal(tileInfo(loud, road).title, 'Avenue');
  assert.equal(planTool(loud, 'avenue', 5, 20, 40, 20).reason, 'Already an avenue');
  assert.equal(planTool(loud, 'road', 5, 20, 40, 20).reason, 'Already a road');
  // Lots are still reached from an avenue, and cars still drive on it.
  assert.ok(loud.flags[home] & FLAG_ACCESS);
  const traffic = createTraffic(loud.size * loud.size, 1), out = new Int32Array(loud.size * loud.size);
  assert.equal(findRoute(loud, traffic, tileIndex(loud, 5, 20), tileIndex(loud, 40, 20), out), 36);
});

test('services cost more to run as the city grows', () => {
  const small = commuterStreet(1), large = commuterStreet(5);
  for (const city of [small, large]) { applyTool(city, 'school', 0, 0, 20, 19); }
  assert.equal(staffing(large), 1 + large.stats.population / STAFFING_POPULATION);
  assert.ok(staffing(large) > staffing(small));
  const services = SERVICES[SCHOOL]!.upkeep + SERVICES[PLANT]!.upkeep + SERVICES[TOWER]!.upkeep;
  const roads = (city: City) => city.stats.expenses - services * staffing(city);
  assert.ok(Math.abs(roads(large) - roads(small)) < EPSILON, 'road upkeep does not depend on population');
  assert.ok(large.stats.expenses > small.stats.expenses);
});

// --- Daylight --------------------------------------------------------------------

test('the sun is high at noon, a moon is up at midnight, and windows light at night', () => {
  const noon = daylightAt(NOON), midnight = daylightAt(0);
  assert.equal(noon.day, 1);
  assert.equal(noon.sun, 1);
  assert.equal(noon.moon, 0);
  assert.equal(noon.windows, 0);
  assert.ok(noon.toLight[1] > 0.7, 'the noon sun is high');
  assert.equal(midnight.day, 0);
  assert.equal(midnight.sun, 0);
  assert.equal(midnight.moon, 1);
  assert.equal(midnight.windows, 1);
  assert.ok(midnight.toLight[1] > 0.3, 'the moon is above the horizon');
  assert.ok(daylightAt(6.5).twilight > 0.5 && daylightAt(18).twilight > 0.9, 'dawn and dusk are coloured');
  assert.equal(noon.twilight, 0);
  assert.deepEqual(daylightAt(HOURS_PER_DAY + 3), daylightAt(3));
  assert.equal(clockLabel(7.5), '07:30');
  assert.equal(clockLabel(23.99), '23:50');
});

test('light never jumps: whatever is lit changes smoothly round the whole day', () => {
  const STEP = 1 / 60, MAX_CHANGE = 0.08;
  let before = daylightAt(0);
  for (let hour = STEP; hour <= HOURS_PER_DAY; hour += STEP) {
    const now = daylightAt(hour);
    assert.ok(Math.hypot(...now.toLight) > 0.999 && Math.hypot(...now.toLight) < 1.001, 'the direction is a unit vector');
    assert.ok(now.toLight[1] > 0.1, `the light is above the horizon at ${hour}`);
    assert.ok(now.sun === 0 || now.moon === 0, `sun and moon are never both lit, at ${hour}`);
    for (const key of ['day', 'twilight', 'sun', 'moon', 'windows'] as const) {
      assert.ok(Math.abs(now[key] - before[key]) < MAX_CHANGE, `${key} jumps at ${hour}`);
    }
    // While a light is on, it does not jump across the sky.
    const strength = Math.min(before.sun + before.moon, now.sun + now.moon);
    const moved = Math.hypot(now.toLight[0] - before.toLight[0], now.toLight[1] - before.toLight[1], now.toLight[2] - before.toLight[2]);
    assert.ok(moved * strength < MAX_CHANGE, `the light jumps at ${hour}`);
    before = now;
  }
});
