/**
 * `npm run tune`: searches for a balance that meets the targets.
 *
 *   npm run tune                 search and print the best balance found
 *   npm run tune -- --write      also write it to src/game/balance.json
 *   npm run tune -- --rounds 40  search for longer (default 24)
 *
 * The search is a small evolution strategy over the knobs in knobs.ts: each
 * round it tries a handful of variations on the best settings so far, playing
 * every target game for each in worker threads, and keeps the best. Steps
 * shrink when a round finds nothing better. It is seeded, so the same command
 * gives the same answer.
 */
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BALANCE, type Balance } from '../src/game/balance.ts';
import { nextRandom, type RandomState } from '../src/game/rng.ts';
import { Pool } from './evaluate.ts';
import { KNOBS, MAX_SETTING, MIN_SETTING, NEUTRAL, applySettings, tidy, type Settings } from './knobs.ts';
import { printScore } from './report.ts';
import { JOBS, score, type Score } from './targets.ts';

const DEFAULT_ROUNDS = 24;
/** Variations tried each round. */
const BROOD = 8;
/** Size of a step as a factor (e^step), and how it changes after a round that did or did not improve. */
const FIRST_STEP = 0.3;
const STEP_GROWTH = 1.15;
const STEP_DECAY = 0.8;
const MIN_STEP = 0.02;
/** Each variation changes each knob with this chance, so some change only one or two things. */
const CHANGE_CHANCE = 0.6;
const SEARCH_SEED = 20261111;
const TAU = Math.PI * 2;
const MILLISECONDS = 1000;
const PERCENT = 100;

function gaussian(random: RandomState) {
  return Math.sqrt(-2 * Math.log(1 - nextRandom(random))) * Math.cos(TAU * nextRandom(random));
}

function vary(settings: Settings, step: number, random: RandomState): Settings {
  const next = { ...settings };
  let changed = false;
  for (const knob of KNOBS) {
    if (nextRandom(random) > CHANGE_CHANCE) continue;
    next[knob] = Math.min(MAX_SETTING, Math.max(MIN_SETTING, settings[knob] * Math.exp(gaussian(random) * step)));
    changed = true;
  }
  return changed ? next : vary(settings, step, random);
}

const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? Number(process.argv[at + 1]) : fallback;
};

async function main() {
  const rounds = option('rounds', DEFAULT_ROUNDS), began = performance.now();
  const pool = new Pool(Math.max(1, availableParallelism() - 1)), random: RandomState = { rng: SEARCH_SEED };
  const judge = async (balance: Balance): Promise<Score> => score(await pool.evaluate(balance, JOBS));
  let games = 0;

  let best = NEUTRAL, bestScore = await judge(DEFAULT_BALANCE), step = FIRST_STEP;
  games += JOBS.length;
  console.log(`As shipped: loss ${bestScore.loss.toFixed(3)}`);
  for (let round = 1; round <= rounds && bestScore.loss > 0 && step >= MIN_STEP; round++) {
    const brood = Array.from({ length: BROOD }, () => vary(best, step, random));
    // Every candidate is judged as it would ship: rounded to readable prices.
    const scores = await Promise.all(brood.map(settings => judge(tidy(applySettings(DEFAULT_BALANCE, settings)))));
    games += BROOD * JOBS.length;
    let improved = false;
    scores.forEach((candidate, n) => { if (candidate.loss < bestScore.loss) { best = brood[n]; bestScore = candidate; improved = true; } });
    step *= improved ? STEP_GROWTH : STEP_DECAY;
    console.log(`round ${String(round).padStart(2)}: loss ${bestScore.loss.toFixed(3)}  step ${step.toFixed(2)}  ${KNOBS.map(knob => `${knob} ×${best[knob].toFixed(2)}`).join('  ')}`);
  }
  await pool.close();

  const tuned = tidy(applySettings(DEFAULT_BALANCE, best));
  const seconds = (performance.now() - began) / MILLISECONDS;
  console.log(`\n${games} games of ${JOBS[0].years} years in ${seconds.toFixed(0)} s.\n\nBest balance found:`);
  printScore(bestScore);
  console.log('\nChanges from balance.json:');
  const flat = (balance: Balance) => Object.entries(balance).flatMap(([key, value]) =>
    typeof value === 'number' ? [[key, value] as const] : Object.entries<number>(value).map(([inner, each]) => [`${key}.${inner}`, each] as const));
  const before = new Map(flat(DEFAULT_BALANCE));
  for (const [key, value] of flat(tuned)) {
    const was = before.get(key)!;
    if (was !== value) console.log(`  ${key.padEnd(24)} ${String(was).padStart(8)} → ${String(value).padEnd(8)} (${value > was ? '+' : ''}${Math.round((value / was - 1) * PERCENT)}%)`);
  }
  if (flag('write')) {
    const path = fileURLToPath(new URL('../src/game/balance.json', import.meta.url));
    writeFileSync(path, `${JSON.stringify(tuned, null, 2)}\n`);
    console.log(`\nWritten to ${path}. Run npm test and npm run sim to confirm.`);
  } else console.log('\nNot written. Add -- --write to put it in src/game/balance.json.');
}

if (import.meta.main) await main();
