/** `npm run sim`: plays the target games under the balance in balance.json and prints how they went. */
import { DEFAULT_BALANCE } from '../src/game/balance.ts';
import { STYLES } from './mayor.ts';
import { simulate } from './run.ts';
import { JOBS, score, type Result, type Score } from './targets.ts';

const REAL_DAYS_PER_SECOND = 2;

export function printScore(result: Score) {
  for (const line of result.lines) {
    const band = `${line.low} to ${line.high === Infinity ? 'any' : line.high}`;
    const value = Math.abs(line.value) < 10 ? line.value.toFixed(2) : Math.round(line.value).toString();
    console.log(`  ${line.miss === 0 ? 'ok  ' : line.watchedOnly ? 'off ' : 'MISS'}  ${line.name.padEnd(52)} ${value.padStart(8)}   (want ${band})`);
  }
  console.log(`  loss ${result.loss.toFixed(3)}  (0 means every tuned target is met; "off" lines are watched, not tuned)`);
}

if (import.meta.main) {
  const results: Result[] = [];
  let speed = 0;
  for (const job of JOBS) {
    const run = simulate(job.seed, STYLES[job.style], job.years), s = run.summary;
    results.push({ ...job, summary: s });
    speed += run.daysPerSecond / JOBS.length;
    console.log(`${job.style.padEnd(9)} map ${String(job.seed).padEnd(3)} ${job.years} years: ${Math.round(s.finalPopulation)} residents, $${Math.round(s.finalMoney).toLocaleString('en-GB')}, `
      + `tax ${s.finalTax}%, ${s.debtMonths} months in debt, margins ${s.margins.map(m => `${Math.round(m * 100)}%`).join(' / ')}`);
    console.log(`          ${Object.entries(run.actions).map(([what, count]) => `${what} ${count}`).join(', ')}`);
  }
  console.log(`\nAgainst the targets (sim/targets.ts), balance.json as shipped (start $${DEFAULT_BALANCE.startMoney}):`);
  printScore(score(results));
  console.log(`\n${Math.round(speed)} game days a second: ${Math.round(speed / REAL_DAYS_PER_SECOND)} times the game at normal speed.`);
}
