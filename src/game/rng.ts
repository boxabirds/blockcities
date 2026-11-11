/** Deterministic randomness: a position hash for placement and a stepping generator for the simulation. */

const HASH_A = 0x9e3779b1;
const HASH_B = 0x85ebca6b;
const HASH_C = 0xc2b2ae35;
const MIX_1 = 0x21f0aaad;
const MIX_2 = 0x735a2d97;
const UINT32_RANGE = 0x1_0000_0000;
const MULBERRY_STEP = 0x6d2b79f5;

function mix(h: number) {
  h ^= h >>> 16; h = Math.imul(h, MIX_1);
  h ^= h >>> 15; h = Math.imul(h, MIX_2);
  h ^= h >>> 15;
  return h >>> 0;
}

/** A number in [0, 1) fixed by three integers. */
export function hash3(a: number, b: number, c: number) {
  return mix(Math.imul(a | 0, HASH_A) ^ Math.imul(b | 0, HASH_B) ^ Math.imul(c | 0, HASH_C)) / UINT32_RANGE;
}

/** Anything holding a 32 bit generator state. */
export type RandomState = { rng: number };

/** Steps the generator (mulberry32) and returns a number in [0, 1). */
export function nextRandom(state: RandomState) {
  state.rng = (state.rng + MULBERRY_STEP) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
}

/** An integer in [0, count). */
export function nextInt(state: RandomState, count: number) {
  return Math.min(count - 1, Math.floor(nextRandom(state) * count));
}
