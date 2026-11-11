import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE, DEFAULT_BALANCE, setBalance } from '../src/game/balance.ts';
import { isRoad } from '../src/game/city.ts';
import { newCity, tick } from '../src/game/sim.ts';
import { saveCity } from '../src/game/save.ts';
import { evaluate } from '../sim/evaluate.ts';
import { KNOBS, NEUTRAL, applySettings, tidy } from '../sim/knobs.ts';
import { CAREFUL, GENEROUS, Mayor } from '../sim/mayor.ts';
import { measure, simulate, type Month } from '../sim/run.ts';
import { TARGETS, score, type Result } from '../sim/targets.ts';

const SEED = 7;
const SHORT_YEARS = 3;

test('the headless mayor builds a working town by the rules, and the same way every time', () => {
  const run = simulate(SEED, CAREFUL, SHORT_YEARS), again = simulate(SEED, CAREFUL, SHORT_YEARS);
  assert.deepEqual(again.summary, run.summary);
  assert.equal(run.months.length, SHORT_YEARS * 12);
  assert.ok(run.summary.finalPopulation > 500, `population ${run.summary.finalPopulation}`);
  assert.equal(run.summary.debtMonths, 0, 'a careful mayor does not go into debt');
  assert.ok(run.actions['block:homes'] > 0 && run.actions['block:shops'] > 0 && run.actions['block:industry'] > 0);
  assert.ok(run.daysPerSecond > 200, `only ${Math.round(run.daysPerSecond)} days a second`);
});

test('the mayor never spends below its reserve and only acts through the tools', () => {
  const city = newCity(SEED), mayor = new Mayor(city, CAREFUL), DAYS = 400, DECISION_DAYS = 5;
  for (let day = 0; day < DAYS; day++) {
    const before = city.money;
    if (day % DECISION_DAYS === 0) mayor.decide();
    // A decision either leaves the money alone or leaves the reserve standing.
    assert.ok(city.money === before || city.money >= CAREFUL.reserve, `money ${city.money} on day ${day}`);
    tick(city);
  }
  assert.ok(city.structure.some(isRoad));
  // What it built is an ordinary city: it saves and plays on like any other.
  assert.ok(saveCity(city).length > 0);
});

test('a skipped settle changes nothing about how a city plays out', () => {
  const a = newCity(SEED), b = newCity(SEED), mayorA = new Mayor(a, CAREFUL), mayorB = new Mayor(b, CAREFUL), DAYS = 300, DECISION_DAYS = 5;
  for (let day = 0; day < DAYS; day++) {
    if (day % DECISION_DAYS === 0) { mayorA.decide(); mayorB.decide(); }
    tick(a, true); tick(b, (day + 1) % DECISION_DAYS === 0);
  }
  assert.equal(saveCity(a), saveCity(b));
});

test('the balance in force is what the game charges and pays, and can be put back', () => {
  try {
    const cheap = simulate(SEED, CAREFUL, 2).summary.finalMoney;
    setBalance(applySettings(DEFAULT_BALANCE, { ...NEUTRAL, tax: 2 }));
    assert.equal(BALANCE.taxPerUnit.homes, DEFAULT_BALANCE.taxPerUnit.homes * 2);
    const rich = simulate(SEED, CAREFUL, 2).summary.finalMoney;
    assert.ok(rich > cheap, `doubling tax yield: ${rich} against ${cheap}`);
    setBalance(applySettings(DEFAULT_BALANCE, { ...NEUTRAL, startMoney: 0.5 }));
    assert.equal(newCity(SEED).money, DEFAULT_BALANCE.startMoney / 2);
  } finally { setBalance(DEFAULT_BALANCE); }
  assert.deepEqual(BALANCE, DEFAULT_BALANCE);
  assert.equal(newCity(SEED).money, DEFAULT_BALANCE.startMoney);
});

test('neutral settings change nothing, each knob moves its own group, and tidying rounds to readable prices', () => {
  assert.deepEqual(applySettings(DEFAULT_BALANCE, NEUTRAL), DEFAULT_BALANCE);
  assert.deepEqual(tidy(DEFAULT_BALANCE), DEFAULT_BALANCE, 'the shipped balance is already tidy');
  for (const knob of KNOBS) assert.notDeepEqual(applySettings(DEFAULT_BALANCE, { ...NEUTRAL, [knob]: 1.5 }), DEFAULT_BALANCE, knob);
  const dearer = applySettings(DEFAULT_BALANCE, { ...NEUTRAL, serviceCost: 1.37, staffing: 2 });
  assert.equal(dearer.serviceUpkeep.school, DEFAULT_BALANCE.serviceUpkeep.school);
  assert.equal(dearer.staffingPopulation, DEFAULT_BALANCE.staffingPopulation / 2, 'more staffing means upkeep climbs sooner');
  const tidied = tidy(dearer);
  for (const cost of Object.values(tidied.serviceCost)) assert.equal(cost % 50, 0);
  assert.ok(Math.abs(tidied.serviceCost.school / dearer.serviceCost.school - 1) < 0.02);
});

test('measuring a run: milestones, debt, margins and break-even', () => {
  const month = (n: number, money: number, population: number, income: number, expenses: number): Month => ({ month: n, money, population, jobs: 0, income, expenses, tax: 9 });
  const months = [
    month(1, 900, 0, 0, 10), month(2, 600, 100, 5, 10), month(3, -50, 300, 12, 10), month(4, 10, 600, 20, 10),
    month(5, 300, 900, 30, 15), month(6, 800, 2100, 60, 30),
  ];
  const summary = measure(months, 1);
  assert.deepEqual(summary.monthsTo, [4, 6, null]);
  assert.equal(summary.debtMonths, 1);
  assert.equal(summary.minMoney, -50);
  assert.equal(summary.breakEven, 3);
  assert.equal(summary.finalPopulation, 2100);
  assert.equal(summary.margins[2], (127 - 85) / 127);
  assert.equal(summary.cashMonths, 800 / (60 * 30));
});

test('the loss is zero inside every band and grows with the distance outside', () => {
  const run = (style: string): Result => ({ seed: SEED, style, years: 15, summary: {
    years: 15, finalPopulation: 9000, peakPopulation: 9000, monthsTo: [20, 50, 100], breakEven: 6, minMoney: 100,
    debtMonths: style === 'generous' ? 10 : 0, margins: [0.2, 0.15, 0.1], cashMonths: 8, finalMoney: 1, finalTax: 9,
  } });
  const good = [run('careful'), run('generous')];
  assert.equal(score(good).loss, 0);
  assert.equal(score(good).lines.length, TARGETS.length);
  const hoard = structuredClone(good); hoard[0].summary.cashMonths = 26;
  const worse = structuredClone(good); worse[0].summary.cashMonths = 38;
  assert.ok(score(hoard).loss > 0 && score(worse).loss > score(hoard).loss);
  // A watched-only target is reported but does not count.
  const slow = structuredClone(good); slow[0].summary.monthsTo = [200, 200, 200];
  assert.equal(score(slow).loss, 0);
  // One map going very well must not hide another where the city is stuck: the average passes, the worst map does not.
  const stuck = run('generous'), boom = run('generous');
  stuck.summary.finalPopulation = 490; boom.summary.finalPopulation = 13000; boom.seed = SEED + 1;
  const uneven = score([run('careful'), stuck, boom]);
  const line = (name: string) => uneven.lines.find(each => each.name === name)!;
  assert.equal(line('generous: residents at the end').miss, 0);
  assert.equal(line('generous: residents at the end, worst map').value, 490);
  assert.ok(line('generous: residents at the end, worst map').miss > 0 && uneven.loss > 0);
  assert.ok(score(slow).lines.some(line => line.watchedOnly && line.miss > 0));
});

test('overspending is punished: the generous mayor ends poorer than the careful one', () => {
  const YEARS = 6;
  try {
    const [careful, generous] = evaluate(DEFAULT_BALANCE, [{ seed: SEED, style: 'careful', years: YEARS }, { seed: SEED, style: 'generous', years: YEARS }]);
    assert.ok(generous.summary.minMoney < careful.summary.minMoney);
    assert.equal(careful.summary.debtMonths, 0);
  } finally { setBalance(DEFAULT_BALANCE); }
  assert.equal(GENEROUS.checksBudget, false);
});
