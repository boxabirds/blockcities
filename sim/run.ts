/**
 * Plays whole games with no renderer and measures how the money went. One run
 * is a seed, a mayor's style and a number of years; `measure` boils the run
 * down to the handful of numbers the targets (targets.ts) are written against.
 */
import { newCity, tick } from '../src/game/sim.ts';
import { Mayor, type MayorStyle } from './mayor.ts';

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
/** The mayor makes a decision this often, in days: about what a player manages at normal speed. */
const DECISION_DAYS = 5;
const QUARTER = 3;
/** Populations whose month of first arrival is recorded. */
export const MILESTONES = [500, 2000, 5000] as const;
const MILLISECONDS = 1000;

export type Month = { month: number; money: number; population: number; jobs: number; income: number; expenses: number; tax: number };

export type Summary = {
  years: number;
  finalPopulation: number;
  peakPopulation: number;
  /** Month each milestone population was first reached, or null. */
  monthsTo: (number | null)[];
  /** First month from which income covered upkeep for a quarter running, or null if it never did. */
  breakEven: number | null;
  minMoney: number;
  /** Months that ended in debt. */
  debtMonths: number;
  /** (income - expenses) / income, averaged over the last year of each third of the run; 0 where there was no income. */
  margins: [number, number, number];
  /** Money at the end, in months of final income. */
  cashMonths: number;
  finalMoney: number;
  finalTax: number;
};

export type Run = { seed: number; style: string; months: Month[]; summary: Summary; actions: Record<string, number>; daysPerSecond: number };

function marginOver(months: Month[], from: number, to: number) {
  let income = 0, expenses = 0;
  for (const month of months.slice(from, to)) { income += month.income; expenses += month.expenses; }
  return income > 0 ? (income - expenses) / income : 0;
}

export function measure(months: Month[], years: number): Summary {
  const last = months[months.length - 1], third = Math.floor(months.length / 3);
  let breakEven: number | null = null;
  for (let n = 0; n + QUARTER <= months.length && breakEven === null; n++) {
    if (months.slice(n, n + QUARTER).every(month => month.income >= month.expenses)) breakEven = months[n].month;
  }
  const yearEnding = (end: number): number => marginOver(months, Math.max(0, end - MONTHS_PER_YEAR), end);
  return {
    years,
    finalPopulation: last.population,
    peakPopulation: Math.max(...months.map(month => month.population)),
    monthsTo: MILESTONES.map(target => { const hit = months.find(month => month.population >= target); return hit ? hit.month : null; }),
    breakEven,
    minMoney: Math.min(...months.map(month => month.money)),
    debtMonths: months.filter(month => month.money < 0).length,
    margins: [yearEnding(third), yearEnding(2 * third), yearEnding(months.length)],
    cashMonths: last.income > 0 ? last.money / (last.income * DAYS_PER_MONTH) : 0,
    finalMoney: last.money,
    finalTax: last.tax,
  };
}

/** Plays `years` of the game on the map of `seed` with a mayor of `style`, under the balance in force. */
export function simulate(seed: number, style: MayorStyle, years: number): Run {
  const city = newCity(seed), mayor = new Mayor(city, style), months: Month[] = [];
  const days = years * MONTHS_PER_YEAR * DAYS_PER_MONTH, began = performance.now();
  for (let day = 0; day < days; day++) {
    if (day % DECISION_DAYS === 0) mayor.decide();
    if (day % DAYS_PER_MONTH === 0) mayor.review();
    // The books are brought up to date only on the days someone reads them: the next decision, or the month's end.
    const monthEnd = (day + 1) % DAYS_PER_MONTH === 0;
    tick(city, monthEnd || (day + 1) % DECISION_DAYS === 0);
    if (monthEnd) {
      const { stats } = city;
      months.push({
        month: (day + 1) / DAYS_PER_MONTH, money: city.money, population: stats.population, jobs: stats.commercialJobs + stats.industrialJobs,
        income: stats.income, expenses: stats.expenses, tax: city.tax,
      });
    }
  }
  const seconds = (performance.now() - began) / MILLISECONDS;
  return { seed, style: style.name, months, summary: measure(months, years), actions: mayor.actions, daysPerSecond: days / seconds };
}
