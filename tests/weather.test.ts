import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTool } from '../src/game/actions.ts';
import { GRASS, isRoad, tileIndex, type City } from '../src/game/city.ts';
import { derive } from '../src/game/derive.ts';
import { newCity } from '../src/game/sim.ts';
import { createTraffic } from '../src/game/traffic.ts';
import { PLATE_HEIGHT, TILE_STUDS, WINDSCREEN_FORWARD, WIPER_LENGTH, WIPER_PIVOT_HEIGHT } from '../src/game/tuning.ts';
import { PuddleField } from '../src/render/puddle-field.ts';
import { ALL_RAIN, NO_RAIN, RAIN_DIALS, puddleGrowth } from '../src/render/rain.ts';
import { Splashes, layPuddles } from '../src/world/puddles.ts';

const SEED = 7;
const FRAME = 1 / 60;

function roads(): City {
  const city = newCity(SEED);
  city.terrain.fill(GRASS); city.tree.fill(0);
  derive(city);
  for (let z = 4; z <= 40; z += 6) applyTool(city, 'road', 2, z, 45, z);
  return city;
}
const puddled = (city: City, field: PuddleField) => {
  const found: number[] = [];
  for (let tile = 0; tile < city.size * city.size; tile++) if (field.reach(tile, TILE_STUDS / 2, TILE_STUDS / 2, 100) < Infinity) found.push(tile);
  return found;
};

test('puddles are laid only on roads, on the share asked for, and the same every time', () => {
  const city = roads(), field = new PuddleField(city.size);
  const roadTiles = city.structure.reduce((count, structure) => count + (isRoad(structure) ? 1 : 0), 0);
  layPuddles(city, field, 0);
  assert.equal(puddled(city, field).length, 0);
  layPuddles(city, field, 1);
  assert.equal(puddled(city, field).length, roadTiles);
  layPuddles(city, field, 0.4);
  const some = puddled(city, field);
  assert.ok(some.every(tile => isRoad(city.structure[tile])), 'no puddle off a road');
  assert.ok(Math.abs(some.length / roadTiles - 0.4) < 0.08, `${some.length} of ${roadTiles}`);
  const again = new PuddleField(city.size);
  layPuddles(city, again, 0.4);
  assert.deepEqual(puddled(city, again), some);
  // Turning the share up only adds puddles: the ones already there stay where they are.
  layPuddles(city, again, 0.7);
  const more = new Set(puddled(city, again));
  assert.ok(some.every(tile => more.has(tile)) && more.size > some.length);
});

test('a puddle spreads as rain collects, and a point is in it or out of it by its distance from the middle', () => {
  assert.equal(puddleGrowth(0), 0);
  assert.equal(puddleGrowth(0.2), 0, 'beads come before puddles');
  assert.equal(puddleGrowth(1), 1);
  let before = 0;
  for (let amount = 0; amount <= 1.001; amount += 0.05) { const now = puddleGrowth(amount); assert.ok(now >= before); before = now; }

  const field = new PuddleField(4);
  field.set(5, 2, 2, 1.5);
  assert.equal(field.reach(5, 2, 2, 1), 0);
  assert.ok(Math.abs(field.reach(5, 3.5, 2, 1) - 1) < 1e-6, 'the edge at full size');
  assert.ok(field.reach(5, 3, 2, 0.5) > 1, 'outside while the puddle is half grown');
  assert.equal(field.reach(5, 2, 2, 0), Infinity, 'no water yet');
  assert.equal(field.reach(6, 2, 2, 1), Infinity, 'no puddle on the next tile');
});

test('a car with its wheels in a puddle stirs it and throws spray, which falls back and is gone', () => {
  const city = roads(), field = new PuddleField(city.size), traffic = createTraffic(city.size * city.size, 1), splashes = new Splashes();
  const tileX = 20, tileZ = 4, tile = tileIndex(city, tileX, tileZ);
  field.set(tile, TILE_STUDS / 2, TILE_STUDS / 2, 1.9);
  const car = traffic.vehicles[0];
  car.active = true; car.x = (tileX + 0.5) * TILE_STUDS; car.z = (tileZ + 0.5) * TILE_STUDS; car.dirX = 1; car.dirZ = 0;

  // Before the puddle has formed there is nothing to splash in.
  for (let n = 0; n < 30; n++) splashes.update(FRAME, city, traffic, field, 0, 1);
  assert.equal(splashes.wheelsInWater, 0);
  assert.equal(splashes.airborne, 0);

  for (let n = 0; n < 30; n++) splashes.update(FRAME, city, traffic, field, 1, 1);
  assert.equal(splashes.wheelsInWater, 4, 'all four wheels are in it');
  assert.ok(splashes.airborne > 20, `${splashes.airborne} drops`);
  assert.equal(splashes.mesh.count, splashes.airborne);
  // Spray is thrown out to both sides of the car, and never below the road.
  const matrices = splashes.mesh.instanceMatrix.array, origin = -city.size * TILE_STUDS / 2, carZ = origin + car.z;
  let left = 0, right = 0;
  for (let n = 0; n < splashes.mesh.count; n++) {
    assert.ok(matrices[n * 16 + 13] >= PLATE_HEIGHT - 1e-6);
    if (matrices[n * 16 + 14] > carZ) left++; else right++;
  }
  assert.ok(left > 0 && right > 0, `${left} one side, ${right} the other`);

  // With no spray asked for the wheels still stir the puddle, and throw nothing.
  const quiet = new Splashes();
  for (let n = 0; n < 30; n++) quiet.update(FRAME, city, traffic, field, 1, 0);
  assert.equal(quiet.wheelsInWater, 4);
  assert.equal(quiet.airborne, 0);

  // The car drives off: the drops come down and the pool is empty again.
  car.active = false;
  for (let n = 0; n < 120; n++) splashes.update(FRAME, city, traffic, field, 1, 1);
  assert.equal(splashes.wheelsInWater, 0);
  assert.equal(splashes.airborne, 0);
  assert.equal(splashes.mesh.visible, false);
});

test('the dials start inside their ranges, and the wiper fits the windscreen it sweeps', () => {
  for (const [name, dial] of Object.entries(RAIN_DIALS)) {
    assert.ok(dial.min <= dial.value && dial.value <= dial.max && dial.step > 0, name);
    assert.ok(dial.group === 'all' || dial.group in ALL_RAIN, name);
  }
  assert.deepEqual(Object.keys(NO_RAIN), Object.keys(ALL_RAIN));
  assert.ok(Object.values(NO_RAIN).every(on => !on) && Object.values(ALL_RAIN).every(on => on));
  // The cabin is 1.15 studs wide and 0.45 high with its front 0.45 ahead of the car's middle (city-view.ts).
  const CABIN_HEIGHT = 0.45, CABIN_HALF_WIDTH = 1.15 / 2, CABIN_BASE = PLATE_HEIGHT + 0.72;
  assert.equal(WINDSCREEN_FORWARD, 0.45);
  assert.equal(WIPER_PIVOT_HEIGHT, CABIN_BASE);
  assert.ok(WIPER_LENGTH <= CABIN_HEIGHT && WIPER_LENGTH <= CABIN_HALF_WIDTH);
});
