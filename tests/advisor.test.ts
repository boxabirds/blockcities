import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTool } from '../src/game/actions.ts';
import { Advisor, milestoneMessage } from '../src/game/advisor.ts';
import { GRASS, tileIndex, type City } from '../src/game/city.ts';
import { derive } from '../src/game/derive.ts';
import { loadCity, saveCity } from '../src/game/save.ts';
import { milestonesReached, newCity, tick } from '../src/game/sim.ts';
import { DAYS_PER_MONTH, MILESTONES } from '../src/game/tuning.ts';

const SEED = 7;

function meadow(): City {
  const city = newCity(SEED);
  city.terrain.fill(GRASS); city.tree.fill(0);
  derive(city);
  return city;
}
function run(city: City, days: number) { for (let day = 0; day < days; day++) tick(city); }
const titles = (advisor: Advisor) => advisor.messages.map(message => message.title);
const step = (advisor: Advisor, id: string) => advisor.messages.find(message => message.id === `guide-${id}`);

test('the planner opens with a welcome and the first step, and says nothing more until something changes', () => {
  const city = meadow(), advisor = new Advisor();
  const first = advisor.update(city);
  assert.deepEqual(first.map(message => message.id), ['welcome', 'guide-road']);
  assert.match(first[0].text, /Shift-drag/, 'the welcome says how to move the view');
  assert.deepEqual(advisor.update(city), []);
  run(city, DAYS_PER_MONTH);
  assert.deepEqual(advisor.update(city), [], 'no suggestions before the basics are done');
});

test('each guide step is ticked when it is done and the next one is asked, through to making money', () => {
  const city = meadow(), advisor = new Advisor();
  advisor.update(city);
  const expectNext = (id: string, doneId: string) => {
    const fresh = advisor.update(city);
    assert.deepEqual(fresh.map(message => message.id), [`guide-${id}`]);
    assert.equal(step(advisor, doneId)!.done, true);
    assert.equal(step(advisor, id)!.done, false);
  };
  applyTool(city, 'road', 10, 20, 30, 20); expectNext('homes', 'road');
  applyTool(city, 'homes', 10, 18, 30, 19); expectNext('power', 'homes');
  assert.match(step(advisor, 'power')!.text, /Missing power/);
  applyTool(city, 'wind', 0, 0, 9, 21); expectNext('water', 'power');
  applyTool(city, 'tower', 0, 0, 9, 18); expectNext('jobs', 'water');
  applyTool(city, 'shops', 10, 21, 20, 22);
  assert.deepEqual(advisor.update(city).filter(message => message.kind === 'guide'), [], 'shops alone do not finish the jobs step');
  applyTool(city, 'industry', 22, 21, 30, 22);
  const afterJobs = advisor.update(city).map(message => message.id);
  assert.ok(afterJobs.includes('guide-money'));
  assert.match(step(advisor, 'money')!.text, /Tax is your only income/);
  assert.equal(step(advisor, 'money')!.done, false, 'no income yet');

  applyTool(city, 'wind', 0, 0, 9, 19);
  let said: string[] = [];
  for (let day = 0; day < 12 * DAYS_PER_MONTH; day++) { tick(city); said = said.concat(advisor.update(city).map(message => message.id)); }
  assert.ok(city.stats.income > city.stats.expenses, 'the town pays its way');
  assert.equal(step(advisor, 'money')!.done, true);
  assert.ok(said.includes('guide-value'));
  applyTool(city, 'park', 0, 0, 15, 17);
  assert.ok(advisor.update(city).some(message => message.id === 'guide-over'));
  assert.ok(advisor.messages.filter(message => message.kind === 'guide').every(message => message.done));
});

test('suggestions arrive as the city runs, spaced out and not repeated at once', () => {
  const city = meadow(), advisor = new Advisor();
  applyTool(city, 'road', 10, 20, 30, 20);
  applyTool(city, 'homes', 10, 18, 30, 19);
  applyTool(city, 'wind', 0, 0, 9, 21);
  applyTool(city, 'tower', 0, 0, 9, 18);
  advisor.update(city);
  const days: number[] = [], texts: string[] = [];
  for (let day = 0; day < 4 * DAYS_PER_MONTH; day++) {
    tick(city);
    for (const message of advisor.update(city)) if (message.kind === 'tip') { days.push(message.day); texts.push(message.text); }
  }
  assert.ok(texts.length > 0, 'the planner said something');
  assert.ok(texts.some(text => /are wanted/.test(text)), texts.join(' | '));
  for (let n = 1; n < days.length; n++) assert.ok(days[n] - days[n - 1] >= 12, `suggestions on days ${days[n - 1]} and ${days[n]}`);
  assert.equal(new Set(texts).size, texts.length, 'nothing said twice in four months');
});

test('a city already under way is not walked through steps it has done', () => {
  const city = meadow();
  applyTool(city, 'road', 10, 20, 30, 20);
  applyTool(city, 'homes', 10, 18, 30, 19);
  const advisor = new Advisor();
  assert.deepEqual(advisor.update(city).map(message => message.id), ['welcome', 'guide-power']);
  assert.equal(titles(advisor)[0], 'Hello again, mayor');
  // A different city starts the conversation again.
  assert.deepEqual(advisor.update(meadow()).map(message => message.id), ['welcome', 'guide-road']);
});

test('milestones are counted from population, reached once, announced once, and kept in a save', () => {
  assert.equal(milestonesReached(0), 0);
  assert.equal(milestonesReached(MILESTONES[0].population - 1), 0);
  assert.equal(milestonesReached(MILESTONES[0].population), 1);
  assert.equal(milestonesReached(MILESTONES[2].population), 3);
  assert.equal(milestonesReached(Number.MAX_SAFE_INTEGER), MILESTONES.length);
  for (let n = 1; n < MILESTONES.length; n++) assert.ok(MILESTONES[n].population > MILESTONES[n - 1].population);

  const city = meadow(), advisor = new Advisor();
  applyTool(city, 'road', 10, 20, 30, 20);
  applyTool(city, 'homes', 10, 18, 30, 19);
  applyTool(city, 'shops', 10, 21, 20, 22);
  applyTool(city, 'industry', 22, 21, 30, 22);
  applyTool(city, 'wind', 0, 0, 9, 21); applyTool(city, 'wind', 0, 0, 9, 19); applyTool(city, 'tower', 0, 0, 9, 18);
  advisor.update(city);
  const announced: string[] = [];
  for (let day = 0; day < 12 * DAYS_PER_MONTH; day++) {
    tick(city);
    for (const message of advisor.update(city)) if (message.kind === 'milestone') announced.push(message.title);
  }
  assert.ok(city.stats.population >= MILESTONES[0].population, `${city.stats.population} residents`);
  assert.ok(city.milestone >= 1);
  assert.deepEqual(announced, MILESTONES.slice(0, city.milestone).map(milestone => `${milestone.name}!`));
  assert.match(milestoneMessage(0, 0).text, new RegExp(`Next: ${MILESTONES[1].name}`));

  // Losing the residents does not take the milestone back, so it is not celebrated twice.
  const reached = city.milestone;
  applyTool(city, 'bulldoze', 9, 18, 9, 21);
  run(city, DAYS_PER_MONTH);
  assert.equal(city.stats.population, 0);
  assert.equal(city.milestone, reached);

  const loaded = loadCity(saveCity(city))!;
  assert.equal(loaded.milestone, reached);
  // A save from before milestones were kept takes its count from its population, with nothing to announce.
  const old = JSON.parse(saveCity(town12())) as Record<string, unknown>;
  delete old.milestone;
  const fromOld = loadCity(JSON.stringify(old))!;
  assert.equal(fromOld.milestone, milestonesReached(fromOld.stats.population));
  assert.ok(fromOld.milestone >= 1);
  assert.deepEqual(new Advisor().update(fromOld).filter(message => message.kind === 'milestone'), []);
});

function town12(): City {
  const city = meadow();
  applyTool(city, 'road', 10, 20, 30, 20);
  applyTool(city, 'homes', 10, 18, 30, 19);
  applyTool(city, 'shops', 10, 21, 20, 22);
  applyTool(city, 'industry', 22, 21, 30, 22);
  applyTool(city, 'wind', 0, 0, 9, 21); applyTool(city, 'wind', 0, 0, 9, 19); applyTool(city, 'tower', 0, 0, 9, 18);
  run(city, 12 * DAYS_PER_MONTH);
  void tileIndex;
  return city;
}
