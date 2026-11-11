/**
 * What a well-balanced game looks like, as numbers. Each target is a band a
 * measurement should fall in; the loss is how far outside its band each one is.
 * These are design intent, not facts: change them here and re-run the tuner.
 *
 * Two players are measured. The careful mayor reads the budget: the game should
 * be winnable for them, but never loose. The generous mayor builds services the
 * city cannot keep: that should hurt, and be recoverable.
 */
import { MILESTONES, type Summary } from './run.ts';

export type Job = { seed: number; style: string; years: number };
export type Result = Job & { summary: Summary };

export const YEARS = 15;
const MONTHS = YEARS * 12;
/** What "never" counts as, in months, for a milestone or break-even that was not reached. */
const NEVER = MONTHS * 1.5;
const SEEDS = [7, 21] as const;

/** The games one evaluation of a balance plays. */
export const JOBS: readonly Job[] = SEEDS.flatMap(seed => [{ seed, style: 'careful', years: YEARS }, { seed, style: 'generous', years: YEARS }]);

export type Target = {
  readonly name: string;
  readonly style: string;
  readonly value: (summary: Summary) => number;
  /** The band the value should fall in. */
  readonly low: number;
  readonly high: number;
  /** How far outside the band counts as one unit of badness. */
  readonly scale: number;
  /** Reported but left out of the loss: the knobs the tuner has cannot move it. */
  readonly watchedOnly?: boolean;
};

const monthsTo = (population: number) => (summary: Summary) => summary.monthsTo[MILESTONES.indexOf(population as (typeof MILESTONES)[number])] ?? NEVER;

export const TARGETS: readonly Target[] = [
  // A new city loses money for a while, but not for long. Watched only: a careful mayor's first upkeep is two
  // turbines and a water tower, which a dozen cottages cover, whatever the prices. Moving this needs a design change.
  { name: 'careful: month income first covers upkeep', style: 'careful', value: s => s.breakEven ?? NEVER, low: 4, high: 14, scale: 6, watchedOnly: true },
  // Pace: a town in a year or two, a city in six to eleven. Watched only: how fast lots fill is set by the growth
  // rates in tuning.ts, which the money knobs do not reach. A careful mayor is rarely short of money for a block.
  { name: 'careful: months to 500 residents', style: 'careful', value: monthsTo(500), low: 10, high: 30, scale: 10, watchedOnly: true },
  { name: 'careful: months to 5,000 residents', style: 'careful', value: monthsTo(5000), low: 70, high: 130, scale: 30, watchedOnly: true },
  { name: 'careful: residents at the end', style: 'careful', value: s => s.finalPopulation, low: 8000, high: Infinity, scale: 4000 },
  // Money stays worth thinking about: a profit, but a thin one, and no hoard.
  { name: 'careful: profit margin, middle years', style: 'careful', value: s => s.margins[1], low: 0.08, high: 0.22, scale: 0.1 },
  { name: 'careful: profit margin, last years', style: 'careful', value: s => s.margins[2], low: 0.05, high: 0.18, scale: 0.1 },
  { name: 'careful: months of income in the bank at the end', style: 'careful', value: s => s.cashMonths, low: 4, high: 14, scale: 6 },
  { name: 'careful: months in debt', style: 'careful', value: s => s.debtMonths, low: 0, high: 0, scale: 6 },
  // Overspending is felt, and can be climbed out of.
  { name: 'generous: months in debt', style: 'generous', value: s => s.debtMonths, low: 3, high: 48, scale: 12 },
  { name: 'generous: residents at the end', style: 'generous', value: s => s.finalPopulation, low: 2500, high: Infinity, scale: 2000 },
];

export type Score = { loss: number; lines: { name: string; value: number; low: number; high: number; miss: number; watchedOnly: boolean }[] };

/** How far a set of results is from the targets: 0 is every target met. Values are averaged over the maps played. */
export function score(results: readonly Result[]): Score {
  let loss = 0;
  const lines = TARGETS.map(target => {
    const values = results.filter(result => result.style === target.style).map(result => target.value(result.summary));
    const value = values.reduce((sum, each) => sum + each, 0) / Math.max(1, values.length);
    const outside = value < target.low ? target.low - value : value > target.high ? value - target.high : 0;
    const miss = outside / target.scale;
    if (!target.watchedOnly) loss += miss * miss;
    return { name: target.name, value, low: target.low, high: target.high, miss, watchedOnly: target.watchedOnly === true };
  });
  return { loss, lines };
}
