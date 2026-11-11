/**
 * The city planner who talks to the mayor: a step by step guide to starting a city, then suggestions as the city
 * grows, and a word at each population milestone. Pure: it reads the city and returns messages; app/ shows them.
 */
import { BALANCE } from './balance.ts';
import { CLINIC, FIRE, PARK, PLANT, POLICE, SCHOOL, STRUCTURE_COUNT, TOWER, WIND, ZONE_C, ZONE_I, ZONE_R, isRoad, type City } from './city.ts';
import { advice, MISSING_POWER, MISSING_WATER } from './info.ts';
import { SERVICES } from './services.ts';
import { DAYS_PER_MONTH, DEFAULT_TAX, LAND_GATES, MILESTONES, POPULATION_GATES } from './tuning.ts';
import { ZONE_SPECS } from './zones.ts';

export type MessageKind = 'guide' | 'tip' | 'milestone';
export type Message = {
  /** Unique within one city's conversation. */
  id: string;
  kind: MessageKind;
  title: string;
  text: string;
  /** The day it was said. */
  day: number;
  /** For a guide step: whether the mayor has done it. */
  done: boolean;
};

/** What the planner looks at, counted in one pass over the map. */
type Facts = {
  roads: number;
  /** Lots zoned for each zone, built on or not. */
  zoned: [number, number, number, number];
  /** How many of each structure are placed, finished or not. */
  placed: number[];
};

type Step = { id: string; title: string; text: () => string; done: (city: City, facts: Facts) => boolean };
type Suggestion = { id: string; title: string; text: () => string; when: (city: City, facts: Facts) => boolean };

const PERCENT = 100;
/** Days after anything is said before a suggestion may follow, so the planner does not nag, and days before the same one is said again. */
const TIP_GAP_DAYS = 12;
const TIP_REPEAT_DAYS = 6 * DAYS_PER_MONTH;
/** Messages kept; the oldest are dropped. */
const MAX_MESSAGES = 60;
/** The guide step after which suggestions start: before it, the guide itself is the advice. */
const TIPS_FROM_STEP = 4;
/** Power in use above which a power station is worth suggesting, as a share of what one makes. */
const STATION_SHARE = 0.5;
/** Cash, in multiples of the starting money, above which lower taxes are suggested. */
const FLUSH_MULTIPLE = 2;
/** The level of home each service suggestion is about. */
const TOWN_HOUSE_LEVEL = 3;
const FLATS_LEVEL = 4;

const dollars = (amount: number) => `$${Math.round(amount).toLocaleString('en-GB')}`;
const service = (kind: number) => SERVICES[kind]!;

const STEPS: readonly Step[] = [
  {
    id: 'road', title: '1. Lay a road',
    text: () => `Pick Road in the bar at the bottom and drag across the grass. It costs ${dollars(BALANCE.roadCost)} a tile. Everything in the city grows from a road.`,
    done: (_, facts) => facts.roads > 0,
  },
  {
    id: 'homes', title: '2. Zone homes',
    text: () => 'Pick Homes and drag over the grass beside your road. Zoning is free. People build on any lot within two tiles of a road, on their own.',
    done: (_, facts) => facts.zoned[ZONE_R] > 0,
  },
  {
    id: 'power', title: '3. Switch the power on',
    text: () => `Houses go up straight away, but they stand empty under a flashing "${MISSING_POWER}" mark until there is power. Pick Turbine and place one anywhere (${dollars(service(WIND).cost)}).`,
    done: (_, facts) => facts.placed[WIND] + facts.placed[PLANT] > 0,
  },
  {
    id: 'water', title: '4. Turn the water on',
    text: () => `The "${MISSING_WATER}" mark is the same story. Pick Water and place a water tower (${dollars(service(TOWER).cost)}). With both, people move in and start paying tax.`,
    done: (_, facts) => facts.placed[TOWER] > 0,
  },
  {
    id: 'jobs', title: '5. Give people work',
    text: () => 'Zone Shops and Industry by a road too. Residents need jobs or they stop coming, and every filled job pays tax. Industry smokes: keep it a few tiles away from homes.',
    done: (_, facts) => facts.zoned[ZONE_C] > 0 && facts.zoned[ZONE_I] > 0,
  },
  {
    id: 'money', title: '6. Make money',
    text: () => `Tax is your only income: each resident with power and water pays, and so does each filled job. Roads, utilities and services cost upkeep every day. The small figure under your cash is this month's profit. Get it above zero by growing: more homes, then jobs for them. Budget (top right) has the tax rate: higher earns more a head but slows growth.`,
    done: city => city.stats.population > 0 && city.stats.income > city.stats.expenses,
  },
  {
    id: 'value', title: '7. Build taller',
    text: () => `A bigger building pays more tax from the same lot, and it needs land value. Place a Park (${dollars(service(PARK).cost)}) among your homes and watch them grow at ${POPULATION_GATES[2]} residents. Then keep adding roads and zones.`,
    done: (_, facts) => facts.placed[PARK] + facts.placed[SCHOOL] + facts.placed[CLINIC] + facts.placed[POLICE] + facts.placed[FIRE] > 0,
  },
];

const SUGGESTIONS: readonly Suggestion[] = [
  {
    id: 'school', title: 'Time for a school',
    text: () => `${ZONE_SPECS[ZONE_R].buildings[TOWN_HOUSE_LEVEL]}s can now be built, where land value reaches ${Math.round(LAND_GATES[TOWN_HOUSE_LEVEL] * PERCENT)}. A School (${dollars(service(SCHOOL).cost)}) lifts a wide area, and it must be on a road. Its upkeep is real money: check your monthly profit first.`,
    when: (city, facts) => city.stats.population >= POPULATION_GATES[TOWN_HOUSE_LEVEL] && facts.placed[SCHOOL] === 0,
  },
  {
    id: 'station', title: 'A power station',
    text: () => `You are using a lot of power. One Power station (${dollars(service(PLANT).cost)}) makes as much as ${Math.floor(service(PLANT).power / service(WIND).power)} turbines. It smokes, so put it well away from homes.`,
    when: (city, facts) => city.stats.powerUse > service(PLANT).power * STATION_SHARE && facts.placed[PLANT] === 0,
  },
  {
    id: 'services', title: 'One of each',
    text: () => `Two schools side by side count once. A Clinic, a Police station and a Fire station each add land value of their own, so one of each does more than three of the same. ${ZONE_SPECS[ZONE_R].buildings[FLATS_LEVEL]} need land value ${Math.round(LAND_GATES[FLATS_LEVEL] * PERCENT)}.`,
    when: (city, facts) => city.stats.population >= POPULATION_GATES[FLATS_LEVEL] && (facts.placed[CLINIC] === 0 || facts.placed[POLICE] === 0 || facts.placed[FIRE] === 0),
  },
  {
    id: 'tax', title: 'Cash to spare',
    text: () => 'You have plenty in the bank. Lowering tax in Budget raises demand for every zone, so the city grows faster. Or spend it on services where land value is low.',
    when: city => city.money > BALANCE.startMoney * FLUSH_MULTIPLE && city.tax >= DEFAULT_TAX && city.stats.income > city.stats.expenses,
  },
];

const WELCOME = 'I am your city planner. Follow the steps below and you will have a town that pays its way. To look around: Shift-drag or W A S D to move, Alt-drag or right-drag to turn and tilt (Q E R F on the keyboard), wheel to zoom. Number keys pick tools, Esc puts the tool down, Space pauses.';
const WELCOME_BACK = 'Welcome back. I will carry on from where the city is now.';
const GUIDE_OVER = 'That is the whole guide. From here I will speak up when something needs you, and when the city reaches a new size.';

function survey(city: City): Facts {
  const facts: Facts = { roads: 0, zoned: [0, 0, 0, 0], placed: new Array<number>(STRUCTURE_COUNT).fill(0) };
  for (let i = 0; i < city.size * city.size; i++) {
    const structure = city.structure[i];
    facts.placed[structure]++;
    if (isRoad(structure)) facts.roads++;
    facts.zoned[city.zone[i]]++;
  }
  return facts;
}

/** What is said when a milestone is reached: the size, and what to aim for next. */
export function milestoneMessage(index: number, day: number): Message {
  const { name, population } = MILESTONES[index], next = MILESTONES[index + 1];
  const reached = `${population.toLocaleString('en-GB')} residents.`;
  const ahead = next ? ` Next: ${next.name} at ${next.population.toLocaleString('en-GB')}.` : ' There is no bigger name than that.';
  return { id: `milestone-${index}`, kind: 'milestone', title: `${name}!`, text: reached + ahead, day, done: false };
}

/** A suggestion's wording with its figures taken out, so "3 buildings" and "5 buildings" are the same suggestion. */
const tipKey = (text: string) => text.replace(/\d+/g, '#');

export class Advisor {
  /** The conversation so far, oldest first. */
  readonly messages: Message[] = [];
  private city: City | null = null;
  /** Index of the guide step being waited on; past the end once the guide is over. */
  private step = 0;
  private milestone = 0;
  /** The day anything was last said. */
  private lastTipDay = 0;
  private readonly said = new Map<string, number>();

  private say(kind: MessageKind, id: string, title: string, text: string, day: number, done = false) {
    const message: Message = { id, kind, title, text, day, done };
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    // Whatever was just said gets time to be read and acted on before a suggestion follows it.
    this.lastTipDay = day;
    return message;
  }

  private begin(city: City, facts: Facts, fresh: Message[]) {
    this.city = city; this.messages.length = 0; this.said.clear();
    this.milestone = city.milestone; this.step = 0;
    // A city that is already under way is not walked through steps it has done.
    while (this.step < STEPS.length && STEPS[this.step].done(city, facts)) this.step++;
    fresh.push(this.say('tip', 'welcome', this.step === 0 ? 'Hello, mayor' : 'Hello again, mayor', this.step === 0 ? WELCOME : WELCOME_BACK, city.day));
    this.ask(city, fresh);
  }

  /** Puts the step now being waited on into the conversation, or closes the guide. */
  private ask(city: City, fresh: Message[]) {
    const step = STEPS[this.step];
    if (step) fresh.push(this.say('guide', `guide-${step.id}`, step.title, step.text(), city.day));
    else fresh.push(this.say('tip', 'guide-over', 'You have the basics', GUIDE_OVER, city.day));
  }

  /** Looks at the city and returns whatever is newly said, oldest first. Call after the city changes. */
  update(city: City): Message[] {
    const fresh: Message[] = [], facts = survey(city);
    if (city !== this.city) { this.begin(city, facts, fresh); return fresh; }

    while (this.step < STEPS.length && STEPS[this.step].done(city, facts)) {
      const asked = this.messages.find(message => message.id === `guide-${STEPS[this.step].id}`);
      if (asked) asked.done = true;
      this.step++;
      this.ask(city, fresh);
    }
    for (; this.milestone < city.milestone; this.milestone++) {
      const message = milestoneMessage(this.milestone, city.day);
      fresh.push(this.say(message.kind, message.id, message.title, message.text, message.day));
    }
    if (this.step >= TIPS_FROM_STEP && city.day - this.lastTipDay >= TIP_GAP_DAYS) {
      const tip = this.nextTip(city, facts);
      if (tip) fresh.push(tip);
    }
    return fresh;
  }

  private nextTip(city: City, facts: Facts): Message | null {
    const urgent = advice(city);
    if (urgent) {
      const key = tipKey(urgent), last = this.said.get(key);
      if (last === undefined || city.day - last >= TIP_REPEAT_DAYS) {
        this.said.set(key, city.day);
        return this.say('tip', `tip-${city.day}`, 'A suggestion', urgent, city.day);
      }
      return null;
    }
    // With nothing pressing, the next idea the city is ready for; each is offered once.
    for (const suggestion of SUGGESTIONS) {
      if (this.said.has(suggestion.id) || !suggestion.when(city, facts)) continue;
      this.said.set(suggestion.id, city.day);
      return this.say('tip', `idea-${suggestion.id}`, suggestion.title, suggestion.text(), city.day);
    }
    return null;
  }
}
