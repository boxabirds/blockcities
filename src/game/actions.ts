/**
 * Everything the mayor can do. The interface and the automation hook both go
 * through `planTool` (what would happen) and `applyTool` (do it), so the two
 * cannot drift apart.
 */
import {
  CLINIC, FIRE, NO_FACING, NONE, PARK, PLANT, POLICE, ROAD, SCHOOL, TOWER, WATER, WIND, ZONE_C, ZONE_I, ZONE_NONE, ZONE_R,
  clearBuilding, hasBuilding, inMap, tileIndex, type City,
} from './city.ts';
import { derive } from './derive.ts';
import { SERVICES } from './services.ts';
import { BRIDGE_COST, BULLDOZE_COST, ROAD_COST } from './tuning.ts';

/** Looks a service can take (only the park's trees differ), chosen by where it stands. */
const SERVICE_LOOKS = 8;

export const TOOLS = [
  'inspect', 'road', 'homes', 'shops', 'industry', 'dezone', 'bulldoze', 'wind', 'plant', 'tower', 'park', 'school', 'clinic', 'police', 'fire',
] as const;
export type Tool = (typeof TOOLS)[number];

const TOOL_ZONE: Partial<Record<Tool, number>> = { homes: ZONE_R, shops: ZONE_C, industry: ZONE_I };
const TOOL_SERVICE: Partial<Record<Tool, number>> = {
  wind: WIND, plant: PLANT, tower: TOWER, park: PARK, school: SCHOOL, clinic: CLINIC, police: POLICE, fire: FIRE,
};

export function toolService(tool: Tool) { return TOOL_SERVICE[tool]; }
/** Dragging this tool draws a line (road), fills a rectangle, or does nothing (it acts on one tile). */
export function toolDrag(tool: Tool): 'line' | 'area' | 'single' {
  if (tool === 'road') return 'line';
  return tool in TOOL_ZONE || tool === 'dezone' || tool === 'bulldoze' ? 'area' : 'single';
}

export type Plan = {
  /** Tiles under the drag, and whether each would change. */
  readonly tiles: number[];
  readonly changes: boolean[];
  readonly cost: number;
  readonly ok: boolean;
  /** Why not, when `ok` is false. */
  readonly reason: string;
};

/** Tiles from (x0, z0) to (x1, z1): an L along the longer axis first, or the whole rectangle, or just the end tile. */
function tilesUnder(city: City, tool: Tool, x0: number, z0: number, x1: number, z1: number) {
  const tiles: number[] = [], drag = toolDrag(tool);
  const push = (x: number, z: number) => { if (inMap(city, x, z)) tiles.push(tileIndex(city, x, z)); };
  if (drag === 'single') push(x1, z1);
  else if (drag === 'area') {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) push(x, z);
  } else {
    const stepX = Math.sign(x1 - x0), stepZ = Math.sign(z1 - z0);
    if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) {
      for (let x = x0; x !== x1; x += stepX) push(x, z0);
      for (let z = z0; z !== z1; z += stepZ) push(x1, z);
    } else {
      for (let z = z0; z !== z1; z += stepZ) push(x0, z);
      for (let x = x0; x !== x1; x += stepX) push(x, z1);
    }
    push(x1, z1);
  }
  return tiles;
}

/** Cost of applying the tool to one tile, or a reason (a string) it would do nothing there. */
function costAt(city: City, tool: Tool, i: number): number | string {
  const structure = city.structure[i], water = city.terrain[i] === WATER;
  if (tool === 'road') {
    if (structure === ROAD) return 'Already a road';
    if (structure !== NONE) return 'Something is built here';
    return water ? BRIDGE_COST : ROAD_COST;
  }
  if (tool === 'bulldoze') return structure !== NONE || hasBuilding(city, i) || city.tree[i] ? BULLDOZE_COST : 'Nothing to clear';
  if (tool === 'dezone') return city.zone[i] !== ZONE_NONE ? 0 : 'Not zoned';
  const zone = TOOL_ZONE[tool];
  if (zone !== undefined) {
    if (water) return 'Cannot zone water';
    if (structure !== NONE) return 'Something is built here';
    return city.zone[i] === zone ? 'Already zoned' : 0;
  }
  const service = TOOL_SERVICE[tool];
  if (service !== undefined) {
    if (water) return 'Cannot build on water';
    if (structure !== NONE) return 'Something is built here';
    return SERVICES[service]!.cost;
  }
  return 'Nothing to do';
}

export function planTool(city: City, tool: Tool, x0: number, z0: number, x1: number, z1: number): Plan {
  const tiles = tilesUnder(city, tool, x0, z0, x1, z1), changes: boolean[] = [];
  let cost = 0, reason = '', changed = 0;
  for (const i of tiles) {
    const result = costAt(city, tool, i);
    if (typeof result === 'string') { changes.push(false); reason ||= result; } else { changes.push(true); cost += result; changed++; }
  }
  if (tiles.length === 0) return { tiles, changes, cost: 0, ok: false, reason: 'Off the map' };
  if (changed === 0) return { tiles, changes, cost: 0, ok: false, reason };
  if (cost > city.money) return { tiles, changes, cost, ok: false, reason: 'Not enough money' };
  return { tiles, changes, cost, ok: true, reason: '' };
}

function applyAt(city: City, tool: Tool, i: number) {
  if (tool === 'road') {
    city.structure[i] = ROAD; city.zone[i] = ZONE_NONE; city.tree[i] = 0; clearBuilding(city, i);
  } else if (tool === 'bulldoze') {
    city.structure[i] = NONE; city.tree[i] = 0; clearBuilding(city, i);
  } else if (tool === 'dezone') {
    city.zone[i] = ZONE_NONE; clearBuilding(city, i);
  } else if (TOOL_ZONE[tool] !== undefined) {
    city.zone[i] = TOOL_ZONE[tool]; clearBuilding(city, i);
  } else if (TOOL_SERVICE[tool] !== undefined) {
    city.structure[i] = TOOL_SERVICE[tool]; city.zone[i] = ZONE_NONE; city.tree[i] = 0; clearBuilding(city, i);
    city.variant[i] = i % SERVICE_LOOKS;
    city.facing[i] = NO_FACING;
  }
}

/** Carries out the plan for a drag from (x0, z0) to (x1, z1) and returns it; nothing changes unless `plan.ok`. */
export function applyTool(city: City, tool: Tool, x0: number, z0: number, x1: number, z1: number): Plan {
  const plan = planTool(city, tool, x0, z0, x1, z1);
  if (!plan.ok) return plan;
  plan.tiles.forEach((i, n) => { if (plan.changes[n]) applyAt(city, tool, i); });
  city.money -= plan.cost;
  city.revision++; city.buildRevision++;
  derive(city);
  return plan;
}
