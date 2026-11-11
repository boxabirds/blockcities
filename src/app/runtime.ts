/**
 * Wires the simulation to the renderer and owns the frame loop:
 * input → days of simulation → traffic → bricks → draw.
 * Boot and failure handling follow Jellyland's runtime.ts.
 */
import * as THREE from 'three/webgpu';
import { TOOLS, applyTool, planTool, type Plan, type Tool } from '../game/actions.ts';
import { ROAD, tileIndex, type City, type Stats } from '../game/city.ts';
import { tileInfo, type TileInfo } from '../game/info.ts';
import { loadCity, saveCity } from '../game/save.ts';
import { newCity, tick } from '../game/sim.ts';
import { activeVehicles, createTraffic, stepTraffic } from '../game/traffic.ts';
import { AUTOSAVE_DAYS, DEFAULT_SPEED, MAP_SIZE, MAX_DAYS_PER_FRAME, MAX_TAX, MIN_TAX, SPEED_DAYS_PER_SECOND, TILE_STUDS } from '../game/tuning.ts';
import { createBrickMaterials } from '../render/brick-materials.ts';
import { createComposite } from '../render/composite.ts';
import { loadEnvironment } from '../render/environment.ts';
import { createRenderer, resizeView } from '../render/renderer.ts';
import { disposeBrickGeometries } from '../world/brick-set.ts';
import { CameraRig, type View } from '../world/camera-rig.ts';
import { CityView } from '../world/city-view.ts';
import { AMBIENT, Sky } from '../world/sky.ts';
import { Hud } from './hud.ts';
import { Input, type Tile } from './input.ts';

const SAVE_KEY = 'blockcities.city.v1';
const MILLISECONDS = 1000;
/** A frame longer than this is treated as this long, so a hitch does not fling the camera or the cars. */
const MAX_FRAME_SECONDS = 0.1;
const TRAFFIC_SEED = 1;
const SEED_RANGE = 0x7fffffff;

export type Game = { stop: () => void };

/** State exposed for automated checks; mirrors what the interface shows. */
export type DebugSnapshot = {
  day: number; money: number; tax: number; speed: number; tool: Tool; frames: number;
  stats: Stats; vehicles: number; roads: number; buildings: number;
  hover: Tile | null; inspector: TileInfo | null; advice: string; toast: string;
};
declare global {
  interface Window {
    /**
     * The automation interface. Everything the mouse and toolbar can do can be done here, through the same
     * functions: `tool` is the toolbar, `apply` is a drag with the tool given, `speed` and `tax` are their controls.
     */
    __blockcities?: {
      snapshot: () => DebugSnapshot;
      tool: (tool: Tool) => void;
      /** A drag from tile (x0, z0) to tile (x1, z1) with `tool`. Returns the plan that was (or was not) carried out. */
      apply: (tool: Tool, x0: number, z0: number, x1: number, z1: number) => Plan;
      speed: (speed: number) => void;
      tax: (percent: number) => void;
      /** Simulates `days` at once, whatever the speed setting. */
      advance: (days: number) => void;
      newCity: (seed?: number) => void;
      tile: (x: number, z: number) => TileInfo;
      /** Places the camera; any field left out keeps its value. x and z are in tiles. */
      look: (view: Partial<View>) => void;
      /** Where the middle of a tile is on screen, in client pixels: for driving the real mouse to it. */
      screenOf: (x: number, z: number) => { x: number; y: number };
      save: () => void;
    };
  }
}

function restore(): City | null {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text ? loadCity(text) : null;
  } catch { return null; }
}

export async function startGame(stage: (message: string) => void, fail: (reason: unknown) => void): Promise<Game> {
  stage('Starting WebGPU');
  const renderer = await createRenderer(fail);
  const canvas = renderer.domElement;
  document.querySelector('#viewport')!.append(canvas);

  stage('Loading the light');
  const scene = new THREE.Scene();
  const environment = await loadEnvironment(renderer, scene, AMBIENT);
  const sky = new Sky(scene, renderer, environment.toLight);

  stage('Tipping out the bricks');
  let city = restore() ?? newCity(Math.floor(Math.random() * SEED_RANGE));
  let traffic = createTraffic(city.size * city.size, TRAFFIC_SEED);
  const materials = createBrickMaterials();
  const view = new CityView(materials);
  scene.add(view.group);
  const rig = new CameraRig(MAP_SIZE * TILE_STUDS / 2);
  const composite = createComposite(renderer, scene, rig.camera);

  let speed: number = DEFAULT_SPEED, dayDebt = 0, frames = 0, seconds = 0, lastSaveDay = city.day, lastToast = '';
  let plan: Plan | null = null, info: TileInfo | null = null;
  const save = () => { try { localStorage.setItem(SAVE_KEY, saveCity(city)); lastSaveDay = city.day; } catch { /* storage full or unavailable: play on */ } };

  const hud = new Hud({
    tool: tool => input.select(tool),
    speed: value => setSpeed(value),
    tax: percent => setTax(percent),
    newCity: () => replaceCity(),
  });
  const toast = (message: string) => { lastToast = message; hud.toast(message); };
  const setSpeed = (value: number) => { speed = Math.max(0, Math.min(SPEED_DAYS_PER_SECOND.length - 1, Math.round(value))); hud.setSpeed(speed); };
  const setTax = (percent: number) => { city.tax = Math.max(MIN_TAX, Math.min(MAX_TAX, Math.round(percent))); };
  const replaceCity = (seed = Math.floor(Math.random() * SEED_RANGE)) => {
    city = newCity(seed); traffic = createTraffic(city.size * city.size, TRAFFIC_SEED); dayDebt = 0;
    save(); toast('A fresh baseplate.');
  };
  /** One drag with one tool: the single path for the mouse and for the automation hook. */
  const act = (tool: Tool, x0: number, z0: number, x1: number, z1: number) => {
    const result = applyTool(city, tool, x0, z0, x1, z1);
    if (!result.ok && tool !== 'inspect') toast(result.reason);
    return result;
  };
  const input = new Input(
    canvas, rig, city.size,
    (tool, from, to) => { act(tool, from.x, from.z, to.x, to.z); },
    tool => hud.setTool(tool),
    () => setSpeed(speed === 0 ? DEFAULT_SPEED : 0),
  );
  hud.setTool(input.tool); hud.setSpeed(speed);

  let resizeQueued = 0;
  const resize = () => {
    if (resizeQueued) return;
    resizeQueued = requestAnimationFrame(() => { resizeQueued = 0; resizeView(renderer, rig.camera); });
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(document.documentElement);
  resizeView(renderer, rig.camera);

  /** Brings everything drawn up to date with the simulation and the pointer. */
  const present = (dt: number) => {
    view.sync(city);
    view.animate(city, traffic, seconds, dt);
    const { hover, anchor, tool } = input;
    if (hover) {
      const from = anchor ?? hover;
      plan = planTool(city, tool, from.x, from.z, hover.x, hover.z);
      info = tileInfo(city, tileIndex(city, hover.x, hover.z));
    } else { plan = null; info = null; }
    view.showPreview(city, tool, plan);
    sky.follow(rig.focus, rig.distance);
    hud.update(city, info, plan, tool);
  };

  stage('Building the first street');
  rig.update(0);
  present(0);
  await renderer.compileAsync(scene, rig.camera);
  composite.render();
  // Compilation or submission errors must surface here, not as a black canvas later.
  await (renderer.backend as unknown as { device: GPUDevice }).device.queue.onSubmittedWorkDone();

  let last = performance.now(), stopped = false;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / MILLISECONDS));
    last = now;
    // A hidden tab neither simulates nor renders a stale frame.
    if (document.hidden) return;
    input.update(dt);
    rig.update(dt);
    dayDebt += dt * SPEED_DAYS_PER_SECOND[speed];
    for (let days = 0; dayDebt >= 1 && days < MAX_DAYS_PER_FRAME; days++) { tick(city); dayDebt--; }
    // Catch-up is capped rather than allowed to spiral after a hitch.
    if (dayDebt > 1) dayDebt = 0;
    if (city.day - lastSaveDay >= AUTOSAVE_DAYS) save();
    if (speed > 0) { stepTraffic(traffic, city, dt); seconds += dt; }
    present(dt);
    composite.render();
    frames++;
  };
  const guardedFrame = (now: number) => {
    try { frame(now); } catch (error) { stop(); fail(error); }
  };

  const saveOnHide = () => { if (document.hidden) save(); };
  document.addEventListener('visibilitychange', saveOnHide);

  const corner = new THREE.Vector3();
  window.__blockcities = {
    snapshot: () => ({
      day: city.day, money: city.money, tax: city.tax, speed, tool: input.tool, frames,
      stats: structuredClone(city.stats), vehicles: activeVehicles(traffic),
      roads: city.structure.reduce((count, structure) => count + (structure === ROAD ? 1 : 0), 0),
      buildings: city.level.reduce((count, level) => count + (level > 0 ? 1 : 0), 0),
      hover: input.hover, inspector: info, advice: document.querySelector('#advice')!.textContent ?? '', toast: lastToast,
    }),
    tool: tool => { if (!TOOLS.includes(tool)) throw new Error(`unknown tool ${tool}`); input.select(tool); },
    apply: (tool, x0, z0, x1, z1) => { if (!TOOLS.includes(tool)) throw new Error(`unknown tool ${tool}`); return act(tool, x0, z0, x1, z1); },
    speed: setSpeed,
    tax: setTax,
    advance: days => { for (let day = 0; day < days; day++) tick(city); },
    newCity: seed => replaceCity(seed),
    tile: (x, z) => tileInfo(city, tileIndex(city, x, z)),
    look: ({ x, z, ...rest }) => {
      const centre = (tile: number) => (tile + 0.5 - city.size / 2) * TILE_STUDS;
      rig.look({ ...rest, ...(x === undefined ? {} : { x: centre(x) }), ...(z === undefined ? {} : { z: centre(z) }) });
    },
    screenOf: (x, z) => {
      const rect = canvas.getBoundingClientRect(), point = rig.project(view.tileCentre(city, x, z, corner));
      return { x: rect.left + (point.x + 1) / 2 * rect.width, y: rect.top + (1 - point.y) / 2 * rect.height };
    },
    save,
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    void renderer.setAnimationLoop(null);
    save();
    input.dispose(); hud.dispose();
    resizeObserver.disconnect();
    if (resizeQueued) cancelAnimationFrame(resizeQueued);
    document.removeEventListener('visibilitychange', saveOnHide);
    delete window.__blockcities;
  }

  function dispose() {
    stop();
    composite.dispose(); view.dispose(); materials.dispose(); disposeBrickGeometries(); environment.dispose();
    canvas.remove();
    renderer.dispose();
  }
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, { once: true });
  import.meta.hot?.dispose(dispose);

  await renderer.setAnimationLoop(guardedFrame);
  return { stop };
}
