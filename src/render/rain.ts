/**
 * Rain on the bricks, drawn in the light rather than in geometry: no drop is a mesh or a particle.
 *
 *   pools   on anything that faces up: drops that have pooled into beads, each a small dome that stays where it fell
 *   cling   on anything upright: fine beads clinging to the wall
 *   runs    on anything upright: drops that have gathered enough to run down, each leaving a wet trail that wipes
 *           the clinging beads in its path; on something moving they are blown back along its sides
 *   puddles on roads: standing water that spreads as the rain collects, ringed by falling drops and stirred up by
 *           whatever drives through it (where the puddles are is the PuddleField's business)
 *
 * Every drop is placed by a hash of where it is in the world, so it stays put as the camera moves and costs a few
 * hash lookups per pixel whatever the size of the city. Far from the camera, where a drop would be smaller than a
 * pixel, it fades out instead of shimmering.
 *
 * Each of the three is built into the shader only when asked for (`RainFeatures`), so one that is off costs nothing;
 * everything else is a number that can be changed while it runs (`RainSettings`).
 */
import { atan, cameraViewMatrix, float, mix, mx_cell_noise_float, normalWorldGeometry, positionWorld, smoothstep, step, texture, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { PLATE_HEIGHT, TILE_STUDS } from '../game/tuning.ts';
import type { PuddleField } from './puddle-field.ts';

export type RainFeatures = { pools: boolean; cling: boolean; runs: boolean; puddles: boolean };
export const NO_RAIN: RainFeatures = { pools: false, cling: false, runs: false, puddles: false };
export const ALL_RAIN: RainFeatures = { pools: true, cling: true, runs: true, puddles: true };

/** One number that can be turned while the rain is running: its starting value, its range, and what it does. */
export type RainDial = { value: number; min: number; max: number; step: number; label: string; group: 'all' | keyof RainFeatures };
/** Sizes are in studs. */
export const RAIN_DIALS = {
  amount: { value: 0.8, min: 0, max: 1, step: 0.01, label: 'Rain collected', group: 'all' },
  dome: { value: 1.5, min: 0, max: 4, step: 0.05, label: 'Drop bulge', group: 'all' },
  waterRoughness: { value: 0.03, min: 0, max: 0.3, step: 0.005, label: 'Water roughness', group: 'all' },
  poolDensity: { value: 1.6, min: 0.4, max: 5, step: 0.1, label: 'Big drops per stud', group: 'pools' },
  poolSize: { value: 0.46, min: 0.1, max: 0.49, step: 0.01, label: 'Big drop size', group: 'pools' },
  beadDensity: { value: 4.5, min: 1, max: 12, step: 0.1, label: 'Small drops per stud', group: 'pools' },
  beadSize: { value: 0.4, min: 0.1, max: 0.49, step: 0.01, label: 'Small drop size', group: 'pools' },
  clingDensity: { value: 6, min: 1, max: 14, step: 0.1, label: 'Wall beads per stud', group: 'cling' },
  clingSize: { value: 0.36, min: 0.1, max: 0.49, step: 0.01, label: 'Wall bead size', group: 'cling' },
  runColumns: { value: 2.6, min: 0.5, max: 8, step: 0.1, label: 'Run columns per stud', group: 'runs' },
  runShare: { value: 0.75, min: 0, max: 1, step: 0.01, label: 'Columns with runs', group: 'runs' },
  runSpeed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Run speed', group: 'runs' },
  runSpacing: { value: 5.5, min: 1, max: 14, step: 0.1, label: 'Studs between drops', group: 'runs' },
  headSize: { value: 0.075, min: 0.02, max: 0.2, step: 0.005, label: 'Running drop size', group: 'runs' },
  trailLength: { value: 0.55, min: 0, max: 0.85, step: 0.01, label: 'Trail length', group: 'runs' },
  trailWidth: { value: 0.032, min: 0.005, max: 0.12, step: 0.001, label: 'Trail width', group: 'runs' },
  wander: { value: 0.16, min: 0, max: 0.4, step: 0.01, label: 'Run wander', group: 'runs' },
  windAngle: { value: 52, min: 0, max: 75, step: 1, label: 'Blown back on cars (°)', group: 'runs' },
  puddleSize: { value: 1, min: 0.2, max: 1.6, step: 0.01, label: 'Puddle size', group: 'puddles' },
  falling: { value: 0, min: 0, max: 1, step: 0.01, label: 'Rain hitting puddles', group: 'puddles' },
  ringStrength: { value: 0.7, min: 0, max: 2, step: 0.05, label: 'Raindrop rings', group: 'puddles' },
  wakeStrength: { value: 0.9, min: 0, max: 2.5, step: 0.05, label: 'Wake from cars', group: 'puddles' },
} as const satisfies Record<string, RainDial>;
export type RainDialName = keyof typeof RAIN_DIALS;
export type RainSettings = Record<RainDialName, { value: number }>;

/** The slowest and fastest a run falls, in studs a second, before the speed dial. */
const RUN_SPEED = [0.5, 1.9] as const;
/** A running drop is this much longer than it is wide. */
const HEAD_STRETCH = 1.6;
/** How often a run swings from side to side, per stud of height. */
const WANDER_RATE = 2.3;
/** Share of the passes down a column that have a drop in them. */
const PASS_SHARE = 0.7;
/**
 * Every surface that is not an underside is one or the other: it holds pooled drops if its normal points up more
 * than this, and is a wall that drops cling to and run down if less, blending across the range between. The line is
 * low, so that a pitched roof, however steep, is a roof.
 */
const FACING_FROM = 0.25;
const FACING_FULL = 0.45;
/** A drop fades out between this many pixels across and this many. */
const FADE_PIXELS = [1.5, 4] as const;
/** A drop first appears somewhere in the first share of the rain, then takes this much more to reach full size. */
const APPEAR_SPAN = 0.7;
const SWELL_SPAN = 0.3;
/** A bead's full size varies from this share of the largest up to all of it. */
const SMALLEST_SHARE = 0.45;
/** Puddles start to form once this much rain has collected, and are full at 1. */
const PUDDLE_FROM = 0.2;
/** Road surfaces lie between these heights (studs): where puddles can be. */
const ROAD_LOW = PLATE_HEIGHT - 0.08;
const ROAD_HIGH = PLATE_HEIGHT + 0.1;
const HEIGHT_EDGE = 0.02;
/** A puddle's outline wanders in and out by these shares of its radius, in three lobes and in five. */
const OUTLINE = [0.16, 0.08] as const;
/** How steeply the water curves down to the road at a puddle's edge. */
const MENISCUS = 0.7;
/** Rings from falling drops: cells per stud, how many a second start in a cell, how far they spread (in cells) and how wide the ring is. */
const RING_CELLS = 1.4;
const RING_RATE = 1.1;
const RING_REACH = 0.46;
const RING_WIDTH = 0.07;
/** Waves from something driving through: how many to a stud, and how fast they run. */
const WAKE_WAVES = 9;
const WAKE_SPEED = 14;
const RADIANS = Math.PI / 180;
const EPSILON = 1e-4;

/** How far a puddle has spread, as a share of its full radius, once `amount` of rain has collected (before the size dial). */
export function puddleGrowth(amount: number) {
  const t = Math.max(0, Math.min(1, (amount - PUDDLE_FROM) / (1 - PUDDLE_FROM)));
  return t * t * (3 - 2 * t);
}

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;
type Amount = Float | number;

/**
 * The frame drops are fixed in. For the city that is the world; for something that moves, like a car, it is the
 * thing itself, or the car would drive out from under its own raindrops.
 */
export type RainFrame = {
  /** Where this point of the surface is, and which way the surface faces, in the frame. */
  position: Vec3;
  flat: Vec3;
  /** Turns a direction in the frame into the same direction in the world. */
  toWorld: (direction: Vec3) => Vec3;
  /** On something moving: which way along a wall the wind pushes a running drop, -1 to 1 (0 on its front and back). */
  wind?: Float;
  /** 1 where something keeps the surface clear of drops (a wiper), else 0. */
  cleared?: Float;
};
export const WORLD_FRAME: RainFrame = {
  position: positionWorld as unknown as Vec3, flat: normalWorldGeometry as unknown as Vec3, toWorld: direction => direction,
};

/** What a material needs from the rain: its lit normal with drops on it, and its roughness with water on it. */
export type RainSurface = {
  /** The lit normal for a surface whose own normal (in the world) is `base`, in the camera's frame. */
  normal: (base: Vec3) => Vec3;
  /** The roughness of a surface whose own is `dry`: smoother where there is water. */
  roughness: (dry: number) => Float;
};

export function createRainSettings(): RainSettings {
  return Object.fromEntries(Object.entries(RAIN_DIALS).map(([name, dial]) => [name, uniform(dial.value)])) as unknown as RainSettings;
}

/** Builds the drops asked for. With none, returns null: the materials are then exactly what they are in the dry. */
/** `puddles` is where the puddles are; without it, or in a frame that is not the world, there are none. */
export function buildRain(settings: RainSettings, features: RainFeatures, frame: RainFrame = WORLD_FRAME, puddles: PuddleField | null = null): RainSurface | null {
  const pooling = features.puddles && puddles !== null;
  if (!features.pools && !features.cling && !features.runs && !pooling) return null;
  const dial = settings as unknown as Record<RainDialName, Float>;
  const flat = frame.flat, place = frame.position;
  const up = smoothstep(FACING_FROM, FACING_FULL, flat.y);
  const upright = smoothstep(FACING_FROM, FACING_FULL, flat.y.abs()).oneMinus();
  // Studs covered by one pixel here, to fade drops that are too small to draw.
  const pixel = positionWorld.fwidth().length().max(EPSILON);
  const drawn = (radius: Amount) => smoothstep(FADE_PIXELS[0], FADE_PIXELS[1], float(radius).mul(2).div(pixel));
  const random = (cell: Vec2, seed: Amount, salt: number) => mx_cell_noise_float(vec3(cell.add(0.5), float(seed).add(salt)));

  /** Beads on a grid of `cells` to the stud over `at`: how the surface leans here (across the two axes of `at`), and whether there is water here. */
  const beads = (at: Vec2, cells: Float, radiusShare: Float, seed: Amount) => {
    const grid = at.mul(cells), cell = grid.floor(), within = grid.fract();
    const grown = dial.amount.sub(random(cell, seed, 3.1).mul(APPEAR_SPAN)).div(SWELL_SPAN).clamp(0, 1);
    const full = random(cell, seed, 7.7).mul(1 - SMALLEST_SHARE).add(SMALLEST_SHARE).mul(radiusShare);
    const radius = full.mul(grown).max(EPSILON);
    // The middle is kept far enough from the cell's edge that the whole bead lies inside it.
    const middle = vec2(random(cell, seed, 11.3), random(cell, seed, 17.9)).mul(float(1).sub(full.mul(2))).add(full);
    const offset = within.sub(middle).div(radius), reach = offset.length();
    const here = smoothstep(0.82, 1, reach).oneMinus().mul(step(EPSILON * 2, radius)).mul(drawn(radiusShare.div(cells)));
    return { lean: offset.mul(here), water: here };
  };

  let bend: Vec3 = vec3(0, 0, 0) as unknown as Vec3, water: Float = float(0) as unknown as Float;

  if (features.pools) {
    const ground = place.xz as unknown as Vec2;
    const big = beads(ground, dial.poolDensity, dial.poolSize, 1);
    const small = beads(ground.add(vec2(0.37, 0.61)) as unknown as Vec2, dial.beadDensity, dial.beadSize, 2);
    // Where a big bead sits it has swallowed the small ones under it.
    const lean = big.lean.add(small.lean.mul(big.water.oneMinus())).mul(up);
    bend = bend.add(vec3(lean.x, 0, lean.y)) as unknown as Vec3;
    water = water.max(big.water.max(small.water).mul(up)) as unknown as Float;
  }

  if (features.cling || features.runs) {
    // Along the wall and up it; walls at different depths get different drops.
    const along = vec3(flat.z, 0, flat.x.negate()).normalize();
    const across = place.dot(along) as unknown as Float, height = place.y as unknown as Float;
    const wall = place.xz.dot(flat.xz).mul(2).round() as unknown as Float;
    let wallLean: Vec2 = vec2(0, 0) as unknown as Vec2, wallWater: Float = float(0) as unknown as Float;
    let kept: Float = float(1) as unknown as Float;

    if (features.runs) {
      // On something moving the wind lays the runs back: a run keeps to a line that slants, not to an upright one.
      const blown = frame.wind ? across.add(height.mul(frame.wind).mul(dial.windAngle.mul(RADIANS).tan())) : across;
      const column = blown.mul(dial.runColumns), columnCell = vec2(column.floor(), wall) as unknown as Vec2;
      const carries = step(random(columnCell, 5, 1.3), dial.amount.mul(dial.runShare));
      const speed = mix(RUN_SPEED[0], RUN_SPEED[1], random(columnCell, 5, 2.9)).mul(dial.runSpeed);
      // Time carries each drop down: a fixed point on the wall sees `pass` rise, so what is above a drop is where it has been.
      const pass = height.add(time.mul(speed)).div(dial.runSpacing).add(random(columnCell, 5, 4.4));
      const filled = step(random(vec2(pass.floor(), column.floor()) as unknown as Vec2, wall, 6.6), PASS_SHARE);
      const behind = pass.fract().sub(0.12).mul(dial.runSpacing);
      const swing = height.mul(WANDER_RATE).add(random(columnCell, 5, 8.8).mul(20)).sin().mul(dial.wander);
      const sideways = column.fract().sub(0.5).sub(swing).div(dial.runColumns);
      const head = vec2(sideways.div(dial.headSize), behind.div(dial.headSize.mul(HEAD_STRETCH)));
      const headWater = smoothstep(0.8, 1, head.length()).oneMinus().mul(drawn(dial.headSize));
      const trailFade = behind.div(dial.runSpacing.mul(dial.trailLength).max(EPSILON)).clamp(0, 1).oneMinus().mul(step(0, behind));
      const trailWater = smoothstep(0.6, 1, sideways.abs().div(dial.trailWidth)).oneMinus().mul(trailFade).mul(drawn(dial.trailWidth));
      const running = carries.mul(filled);
      wallLean = head.mul(headWater).add(vec2(sideways.div(dial.trailWidth).mul(trailWater).mul(0.5), 0)).mul(running) as unknown as Vec2;
      wallWater = headWater.max(trailWater).mul(running) as unknown as Float;
      // A run has just swept its path clear: the beads there are gone, and come back the further behind it they are.
      const swept = smoothstep(1, 2.2, sideways.abs().div(dial.headSize)).oneMinus().mul(trailFade).mul(running);
      kept = swept.oneMinus().mul(wallWater.oneMinus()) as unknown as Float;
    }
    if (features.cling) {
      const cling = beads(vec2(across, height) as unknown as Vec2, dial.clingDensity, dial.clingSize, wall.add(9) as unknown as Float);
      wallLean = wallLean.add(cling.lean.mul(kept)) as unknown as Vec2;
      wallWater = wallWater.max(cling.water.mul(kept)) as unknown as Float;
    }
    bend = bend.add(along.mul(wallLean.x.mul(upright))).add(vec3(0, wallLean.y.mul(upright), 0)) as unknown as Vec3;
    water = water.max(wallWater.mul(upright)) as unknown as Float;
  }

  let standing: Vec3 = vec3(0, 0, 0) as unknown as Vec3;
  if (pooling && puddles) {
    const half = puddles.size * TILE_STUDS / 2;
    const tile = place.xz.add(half).div(TILE_STUDS), cell = tile.floor(), within = tile.fract().mul(TILE_STUDS);
    const laid = texture(puddles.texture, cell.add(0.5).div(puddles.size));
    const offset = within.sub(laid.xy), reach = offset.length().max(EPSILON), outward = offset.div(reach);
    const turn = atan(offset.y, offset.x);
    const outline = turn.mul(3).add(laid.x.mul(7)).sin().mul(OUTLINE[0]).add(turn.mul(5).add(laid.y.mul(11)).sin().mul(OUTLINE[1])).add(1);
    const grown = smoothstep(PUDDLE_FROM, 1, dial.amount).mul(dial.puddleSize);
    const radius = laid.z.mul(grown).mul(outline);
    const share = reach.div(radius.max(EPSILON));
    const onRoad = smoothstep(ROAD_LOW, ROAD_LOW + HEIGHT_EDGE, place.y).mul(smoothstep(ROAD_HIGH, ROAD_HIGH + HEIGHT_EDGE, place.y).oneMinus());
    const pool = smoothstep(0.92, 1, share).oneMinus().mul(step(EPSILON * 2, radius)).mul(up).mul(onRoad);
    // Rings where drops land, while it is raining.
    const ringGrid = place.xz.mul(RING_CELLS), ringCell = ringGrid.floor() as unknown as Vec2, ringAt = ringGrid.fract().sub(0.5);
    const age = time.mul(RING_RATE).add(random(ringCell, 31, 1.7)).fract(), ringReach = ringAt.length().max(EPSILON);
    const ring = smoothstep(0, RING_WIDTH, ringReach.sub(age.mul(RING_REACH)).abs()).oneMinus().mul(age.oneMinus());
    const rings = ringAt.div(ringReach).mul(ring).mul(dial.ringStrength).mul(dial.falling);
    // Waves running out from the middle after something has driven through.
    const wake = reach.mul(WAKE_WAVES).sub(time.mul(WAKE_SPEED)).sin().mul(laid.w).mul(dial.wakeStrength).mul(share.oneMinus().max(0));
    const surface = outward.mul(smoothstep(0.7, 1, share).mul(MENISCUS).add(wake)).add(rings);
    // Standing water covers whatever beads were there.
    bend = bend.mul(pool.oneMinus()) as unknown as Vec3;
    standing = vec3(surface.x, 0, surface.y).mul(pool) as unknown as Vec3;
    water = water.max(pool) as unknown as Float;
  }
  if (frame.cleared) { bend = bend.mul(frame.cleared.oneMinus()) as unknown as Vec3; water = water.mul(frame.cleared.oneMinus()) as unknown as Float; }

  const lean = frame.toWorld(bend.mul(dial.dome).add(standing) as unknown as Vec3);
  return {
    normal: base => cameraViewMatrix.mul(vec4(base.add(lean).normalize(), 0)).xyz.normalize() as unknown as Vec3,
    roughness: dry => mix(float(dry), dial.waterRoughness, water) as unknown as Float,
  };
}
