/**
 * A mayor that plays the game with no screen: it looks at the same things a
 * player can see (the readouts, the demand bars, what each lot is waiting for,
 * how busy each road is) and acts only through `planTool` and `applyTool`, the
 * same two functions the mouse goes through. So it cannot cheat, and a balance
 * that works for it is a balance a person can play.
 *
 * It builds a grid of blocks: four lots deep between streets, so every lot is
 * within reach of a road. How carefully it spends is its `style`.
 */
import { applyTool, planTool, type Tool } from '../src/game/actions.ts';
import { FLAG_ACCESS, NONE, WATER, ZONE_C, ZONE_I, ZONE_NONE, ZONE_R, isRoad, tileIndex, type City } from '../src/game/city.ts';
import { congestion, isComplete, staffing } from '../src/game/derive.ts';
import { SERVICES } from '../src/game/services.ts';
import { levelAllowed } from '../src/game/sim.ts';
import { DEFAULT_TAX, MAX_TAX } from '../src/game/tuning.ts';
import { toolService } from '../src/game/actions.ts';

export type MayorStyle = {
  readonly name: string;
  /** Money it will not spend below. */
  readonly reserve: number;
  /** It wants one park, school, clinic or station for every this many zoned lots. */
  readonly lotsPerService: number;
  /** Whether it checks that the city can pay a service's upkeep before building it. */
  readonly checksBudget: boolean;
  /** Whether it raises tax when in debt and lowers it again when flush. */
  readonly adjustsTax: boolean;
};

/** Plays sensibly: a model of a player who reads the budget. */
export const CAREFUL: MayorStyle = { name: 'careful', reserve: 1500, lotsPerService: 14, checksBudget: true, adjustsTax: true };
/** Builds services without asking whether the city can keep them, and puts tax up when the money runs out: a player who learns the hard way. */
export const GENEROUS: MayorStyle = { name: 'generous', reserve: 500, lotsPerService: 9, checksBudget: false, adjustsTax: true };
/** Builds every service it can pay for today and never touches tax: a model of a player who does not read the budget. */
export const LAVISH: MayorStyle = { name: 'lavish', reserve: 200, lotsPerService: 5, checksBudget: false, adjustsTax: false };

/** Every style, by name. */
export const STYLES: Record<string, MayorStyle> = { careful: CAREFUL, generous: GENEROUS, lavish: LAVISH };

/** Streets are this many tiles apart, starting this far in from the map's edge. */
const PITCH = 5;
const FIRST = 1;
const LOTS_ACROSS = PITCH - 1;
/** It zones another block for a zone when demand is above this and fewer than this many of its lots stand ready. */
const WANTED_DEMAND = 0.25;
const READY_LOTS = 2;
/** Spare power and water it keeps: a fixed amount plus a share of what is used. */
const UTILITY_MARGIN = 80;
const UTILITY_MARGIN_SHARE = 0.12;
/** Above this much power in use, it builds power stations instead of turbines. */
const STATION_POWER = 700;
/** The order it adds services in. */
const SERVICE_ORDER: readonly Tool[] = ['park', 'school', 'park', 'clinic', 'police', 'park', 'fire'];
/** Where in a block services go, as offsets from its corner: the middle first. */
const SERVICE_SPOTS = [[2, 2], [3, 3], [2, 3], [3, 2], [1, 1], [4, 4], [1, 4], [4, 1]] as const;
/** Tiles of road it widens each side of the busiest tile. */
const AVENUE_REACH = 3;
/** It raises tax up to this when in debt, and lowers it when it holds this many months of spending. */
const TAX_CEILING = 14;
const FLUSH_MONTHS = 3;
const DAYS_PER_MONTH = 30;

type Use = 'free' | 'homes' | 'shops' | 'industry' | 'utility';
type Block = { bx: number; bz: number; x: number; z: number; use: Use; buildable: boolean; services: number };
const ZONE_TOOL: Record<number, Use> = { [ZONE_R]: 'homes', [ZONE_C]: 'shops', [ZONE_I]: 'industry' };

export class Mayor {
  private readonly city: City;
  private readonly style: MayorStyle;
  private readonly blocks: Block[] = [];
  private readonly across: number;
  private readonly start: Block;
  private services = 0;
  /** Services built, newest last, so the newest can be given up first. */
  private readonly built: { x: number; z: number; block: Block }[] = [];
  /** Count of each kind of thing done, for the report. */
  readonly actions: Record<string, number> = {};

  constructor(city: City, style: MayorStyle) {
    this.city = city; this.style = style;
    this.across = Math.floor((city.size - 1 - FIRST) / PITCH);
    for (let bz = 0; bz < this.across; bz++) {
      for (let bx = 0; bx < this.across; bx++) {
        const x = FIRST + bx * PITCH, z = FIRST + bz * PITCH;
        let buildable = true;
        for (let tz = z; tz <= z + PITCH; tz++) for (let tx = x; tx <= x + PITCH; tx++) if (city.terrain[tileIndex(city, tx, tz)] === WATER) buildable = false;
        this.blocks.push({ bx, bz, x, z, use: 'free', buildable, services: 0 });
      }
    }
    // Start on the buildable block nearest the middle of the map.
    const middle = (this.across - 1) / 2;
    this.start = this.blocks.filter(block => block.buildable)
      .sort((a, b) => Math.hypot(a.bx - middle, a.bz - middle) - Math.hypot(b.bx - middle, b.bz - middle))[0];
  }

  private count(what: string) { this.actions[what] = (this.actions[what] ?? 0) + 1; }
  private distance(block: Block) { return Math.hypot(block.bx - this.start.bx, block.bz - this.start.bz); }

  /** One drag with one tool, if it would do something and leaves the reserve untouched. */
  private act(tool: Tool, x0: number, z0: number, x1: number, z1: number) {
    const plan = planTool(this.city, tool, x0, z0, x1, z1);
    if (!plan.ok || this.city.money - plan.cost < this.style.reserve) return false;
    applyTool(this.city, tool, x0, z0, x1, z1);
    return true;
  }

  /** Free buildable blocks next to one already in use (or the start block, when nothing is). */
  private frontier() {
    const used = this.blocks.filter(block => block.use !== 'free');
    if (used.length === 0) return [this.start];
    return this.blocks.filter(block => block.use === 'free' && block.buildable
      && used.some(other => Math.abs(other.bx - block.bx) + Math.abs(other.bz - block.bz) === 1));
  }

  /** Lays the four streets round a block and zones the lots inside, if the money is there for all of it. */
  private claim(use: Use) {
    const frontier = this.frontier();
    if (frontier.length === 0) return false;
    // Industry goes east, away from the middle; utilities as far out as possible; the rest as near in as possible.
    const block = use === 'industry' ? frontier.sort((a, b) => b.bx - a.bx || this.distance(a) - this.distance(b))[0]
      : use === 'utility' ? frontier.sort((a, b) => this.distance(b) - this.distance(a))[0]
        : frontier.sort((a, b) => this.distance(a) - this.distance(b))[0];
    const { x, z } = block, far = PITCH;
    if (use !== 'utility') {
      const edges = [[x, z, x + far, z], [x, z + far, x + far, z + far], [x, z, x, z + far], [x + far, z, x + far, z + far]] as const;
      let cost = 0;
      for (const [x0, z0, x1, z1] of edges) { const plan = planTool(this.city, 'road', x0, z0, x1, z1); if (plan.ok) cost += plan.cost; }
      if (this.city.money - cost < this.style.reserve) return false;
      for (const [x0, z0, x1, z1] of edges) applyTool(this.city, 'road', x0, z0, x1, z1);
      applyTool(this.city, use as Tool, x + 1, z + 1, x + LOTS_ACROSS, z + LOTS_ACROSS);
    }
    block.use = use;
    this.count(`block:${use}`);
    return true;
  }

  /** Puts a utility on the next empty lot of a utility block, claiming a new block when they are all full. */
  private placeUtility(tool: Tool) {
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const block of this.blocks) {
        if (block.use !== 'utility') continue;
        for (let dz = 1; dz <= LOTS_ACROSS; dz++) {
          for (let dx = 1; dx <= LOTS_ACROSS; dx++) {
            if (this.city.structure[tileIndex(this.city, block.x + dx, block.z + dz)] !== NONE) continue;
            if (!this.act(tool, block.x + dx, block.z + dz, block.x + dx, block.z + dz)) return false;
            this.count(tool);
            return true;
          }
        }
      }
      if (!this.claim('utility')) return false;
    }
    return false;
  }

  private utilities() {
    const { city } = this, { stats } = city;
    // What is being built counts as already there, or it would order another every day until the first is finished.
    let power = stats.powerSupply, water = stats.waterSupply;
    for (let i = 0; i < city.size * city.size; i++) {
      const service = SERVICES[city.structure[i]];
      if (service && !isComplete(city, i)) { power += service.power; water += service.water; }
    }
    if (power - stats.powerUse < UTILITY_MARGIN + stats.powerUse * UTILITY_MARGIN_SHARE) {
      if (stats.powerUse > STATION_POWER && this.placeUtility('plant')) return true;
      // A turbine keeps things going while the money for a station comes in.
      if (power - stats.powerUse < UTILITY_MARGIN && this.placeUtility('wind')) return true;
    }
    if (water - stats.waterUse < UTILITY_MARGIN + stats.waterUse * UTILITY_MARGIN_SHARE) return this.placeUtility('tower');
    return false;
  }

  private zones() {
    const { city } = this, ready = [0, 0, 0, 0];
    for (let i = 0; i < city.size * city.size; i++) {
      const zone = city.zone[i];
      if (zone !== ZONE_NONE && city.structure[i] === NONE && city.level[i] === 0 && city.flags[i] & FLAG_ACCESS && levelAllowed(city, i, 1)) ready[zone]++;
    }
    // The first block is always homes: nobody opens a shop in an empty field.
    if (this.blocks.every(block => block.use === 'free')) return this.claim('homes');
    for (const zone of [ZONE_R, ZONE_C, ZONE_I]) {
      if (city.stats.demand[zone] > WANTED_DEMAND && ready[zone] < READY_LOTS && this.claim(ZONE_TOOL[zone])) return true;
    }
    return false;
  }

  private widen() {
    const { city } = this;
    if (city.stats.congested === 0) return false;
    let worst = -1, load = 1;
    for (let i = 0; i < city.size * city.size; i++) { const here = congestion(city, i); if (here > load) { load = here; worst = i; } }
    if (worst < 0) return false;
    const x = worst % city.size, z = Math.floor(worst / city.size);
    const alongX = x > 0 && isRoad(city.structure[worst - 1]) || x < city.size - 1 && isRoad(city.structure[worst + 1]);
    const done = alongX ? this.act('avenue', Math.max(0, x - AVENUE_REACH), z, Math.min(city.size - 1, x + AVENUE_REACH), z)
      : this.act('avenue', x, Math.max(0, z - AVENUE_REACH), x, Math.min(city.size - 1, z + AVENUE_REACH));
    if (done) this.count('avenue');
    return done;
  }

  private amenities() {
    const { city, style } = this;
    const served = this.blocks.filter(block => block.use === 'homes' || block.use === 'shops');
    if (this.services >= Math.floor(served.length * LOTS_ACROSS * LOTS_ACROSS / style.lotsPerService)) return false;
    const tool = SERVICE_ORDER[this.services % SERVICE_ORDER.length], spec = SERVICES[toolService(tool)!]!;
    if (style.checksBudget && city.stats.income - city.stats.expenses < spec.upkeep * staffing(city)) return false;
    const block = served.filter(candidate => candidate.services < SERVICE_SPOTS.length).sort((a, b) => a.services - b.services || this.distance(a) - this.distance(b))[0];
    if (!block) return false;
    const [dx, dz] = SERVICE_SPOTS[block.services];
    if (!this.act(tool, block.x + dx, block.z + dz, block.x + dx, block.z + dz)) return false;
    this.built.push({ x: block.x + dx, z: block.z + dz, block });
    block.services++; this.services++;
    this.count(tool);
    return true;
  }

  private tax() {
    const { city } = this, monthly = city.stats.expenses * DAYS_PER_MONTH;
    if (city.money < 0 && city.tax < TAX_CEILING) { city.tax++; this.count('tax up'); }
    else if (city.tax > DEFAULT_TAX && city.stats.income > city.stats.expenses && city.money >= 0) {
      // It brings tax back down when it has money put by, or when the planner says high tax has stopped the city growing.
      const stalled = city.stats.demand[ZONE_R] <= 0;
      if (stalled || city.money > monthly * FLUSH_MONTHS) { city.tax--; this.count('tax down'); }
    }
    city.tax = Math.min(MAX_TAX, city.tax);
  }

  /** One decision: the most pressing thing it can afford. Call every few days. */
  decide() {
    if (this.utilities()) return;
    if (this.zones()) return;
    if (this.widen()) return;
    this.amenities();
  }

  /** In debt and still losing money with tax as high as it will go: give up the newest service. */
  private retrench() {
    const { city } = this, last = this.built[this.built.length - 1];
    if (!last || city.money >= 0 || city.stats.income >= city.stats.expenses || city.tax < TAX_CEILING) return;
    if (!applyTool(city, 'bulldoze', last.x, last.z, last.x, last.z).ok) return;
    this.built.pop(); last.block.services--; this.services--;
    this.count('retrench');
  }

  /** The monthly look at the books. */
  review() { if (this.style.adjustsTax) { this.tax(); this.retrench(); } }
}
