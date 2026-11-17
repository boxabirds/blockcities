/**
 * The weather designer: one fixed city under the game's own renderer, with every weather effect on a switch and
 * every number on a slider, and a running measure of what a frame costs against the 60 frames a second the game
 * has to hold. Nothing here is part of the game; what is settled here gets carried over to it by hand.
 *
 * Open /weather.html. Automation: `window.__weather` does everything the panel does.
 */
import * as THREE from 'three/webgpu';
import { applyTool } from '../game/actions.ts';
import type { City } from '../game/city.ts';
import { derive } from '../game/derive.ts';
import { newCity, tick } from '../game/sim.ts';
import { createTraffic, stepTraffic } from '../game/traffic.ts';
import { MAP_SIZE, TILE_STUDS } from '../game/tuning.ts';
import { createBrickMaterials } from '../render/brick-materials.ts';
import { createComposite } from '../render/composite.ts';
import { ALL_RAIN, RAIN_DIALS, puddleGrowth, type RainDialName, type RainFeatures } from '../render/rain.ts';
import { createRenderer, resizeView } from '../render/renderer.ts';
import { createSoftboxEnvironment } from '../render/softbox-environment.ts';
import { Input } from '../app/input.ts';
import { CameraRig, type View } from '../world/camera-rig.ts';
import { CityView } from '../world/city-view.ts';
import { HOURS_PER_DAY, NOON, clockLabel } from '../world/daylight.ts';
import { Splashes, layPuddles } from '../world/puddles.ts';
import { Rainfall } from '../world/rainfall.ts';
import { AMBIENT, Sky } from '../world/sky.ts';
import './weather.css';

/** The game has to draw a frame in this long to hold 60 frames a second. */
const BUDGET_MILLISECONDS = 1000 / 60;
/**
 * The readout looks at the frames of the last this many seconds. In an ordinary browser the screen caps the frame
 * rate, so this cannot show how much room is left, only whether the budget is being missed here and now: a rate
 * under 60, or frames that took longer than one refresh. How much room is left is `npm run weather:budget`'s job.
 */
const WINDOW_SECONDS = 2;
/** The readout starts this long after the page opens. */
const WARMUP_SECONDS = 2;
/** A rate this far under 60 is a miss, not jitter, and one this far under is close. */
const MISSED_FPS = 57;
const TIGHT_FPS = 59;
const MILLISECONDS = 1000;
const MAX_FRAME_SECONDS = 0.1;
/** At full strength the rain fills the drops in this many seconds; "Dry everything" empties them in this many. */
const FILL_SECONDS = 25;
const DRY_SECONDS = 2.5;
const DEFAULT_STRENGTH = 0.6;
/** Dawn and dusk: the day the time slider covers, and the hour it opens at. */
const DAWN = 5;
const DUSK = 19;
/** Raining cloud is never thinner than this share of the rain's strength: it cannot pour from a blue sky. */
const RAIN_CLOUD = 0.95;
/** The designer's own dials, which are not the shader's: each with its starting value and range. */
const LOCAL_DIALS = {
  hour: { value: NOON, min: DAWN, max: DUSK, step: 0.05, label: 'Time of day' },
  dayLength: { value: 60, min: 10, max: 600, step: 5, label: 'Seconds, dawn to dusk' },
  cloud: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Cloud cover' },
  shadeDarkness: { value: 0.55, min: 0, max: 0.9, step: 0.01, label: 'Cloud shadow darkness' },
  cloudSize: { value: 30, min: 8, max: 220, step: 1, label: 'Cloud size (studs)' },
  cloudSpeed: { value: 2.4, min: 0, max: 14, step: 0.1, label: 'Cloud drift (studs/s)' },
  dryTime: { value: 60, min: 3, max: 240, step: 1, label: 'Seconds to dry out' },
  cover: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Road tiles with a puddle' },
  spray: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Spray from wheels' },
} as const;
type LocalDial = keyof typeof LOCAL_DIALS;
const SEED = 7;
const TRAFFIC_SEED = 1;
/** The city is given this long, and money enough, to grow before it is shown. */
const GROWTH_DAYS = 2600;
const MONEY = 10_000_000;

/** Places to look from. Tiles for x and z, studs for distance, radians for the angles. */
const VIEWS: Record<string, View> = {
  Street: { x: 12.5, z: 9, distance: 30, yaw: 0.35, pitch: 0.42 },
  Walls: { x: 12, z: 20.5, distance: 20, yaw: 0, pitch: 0.22 },
  Roofs: { x: 14, z: 12, distance: 36, yaw: 0.7, pitch: 0.75 },
  City: { x: 16, z: 15, distance: 110, yaw: 2.4, pitch: 0.9 },
};
const FEATURE_LABELS: Record<keyof RainFeatures, string> = { pools: 'Pooled drops on flat tops', cling: 'Beads clinging to walls', runs: 'Drops running down walls', puddles: 'Puddles on roads' };

/** Frames a second, and the longest frame in milliseconds, over a stretch of time. */
/** How the city is lit: by the studio's lamps or by the sky; whether the hours pass by themselves; whether broken cloud casts drifting shade. */
type SkyState = { daylight: boolean; running: boolean; cloudShadows: boolean };
type Measured = { fps: number; slowest: number };
declare global {
  interface Window {
    __weather?: {
      /** Switches kinds of drop on and off: the same as the tick boxes. */
      features: (features: Partial<RainFeatures>) => RainFeatures;
      /** Turns one dial: the same as its slider. */
      set: (name: RainDialName, value: number) => void;
      settings: () => { features: RainFeatures; dials: Record<RainDialName, number>; local: Record<LocalDial, number>; raining: boolean; strength: number; sky: SkyState };
      /** Chooses the light: studio or daylight, whether the day runs by itself, and whether cloud shadows are drawn. The same as the Sky buttons. */
      sky: (change: Partial<SkyState>) => SkyState;
      /** Turns one of the designer's own dials: the same as its slider. */
      local: (name: LocalDial, value: number) => void;
      /** What the cars are doing to the puddles right now. */
      splashing: () => { wheelsInWater: number; dropsInAir: number; cars: number };
      /** Starts or stops the rain falling, at a strength from 0 to 1: the same as the Rain button and its slider. */
      rain: (on: boolean, strength?: number) => void;
      /** Dries everything up: the same as the Dry button. */
      dry: () => void;
      /** Places the camera at a named view, the same as its button, or anywhere: tile, distance in studs, yaw and pitch in radians. */
      look: (view: string | View) => void;
      /** Watches the frames of the next `seconds`. With the browser's frame cap lifted this is the true cost. */
      measure: (seconds: number) => Promise<Measured>;
    };
  }
}

/** A grown city on a grid of streets: homes, shops, industry and services, so there is one of every kind of surface. */
function growCity(): City {
  const city = newCity(SEED), west = 3, east = 30, north = 3, south = 27, block = 5;
  city.money = MONEY;
  for (let z = north; z <= south; z += block) applyTool(city, 'road', west, z, east, z);
  for (let x = west; x <= east; x += block + 4) applyTool(city, 'road', x, north, x, south);
  applyTool(city, 'homes', west, north, east, 17);
  applyTool(city, 'shops', west, 18, 20, south);
  applyTool(city, 'industry', 21, 18, east, south);
  for (let n = 0; n < 6; n++) { applyTool(city, 'plant', 0, 0, 32 + n % 3, 29 + Math.floor(n / 3)); applyTool(city, 'tower', 0, 0, 1, 8 + n * 2); applyTool(city, 'tower', 0, 0, 0, 8 + n * 2); }
  const services = ['park', 'school', 'clinic', 'police', 'fire'] as const;
  let turn = 0;
  for (let z = 4; z <= 24; z += block) for (let x = 8; x <= 26; x += 9) applyTool(city, services[turn++ % services.length], 0, 0, x, z);
  for (let day = 0; day < GROWTH_DAYS; day++) tick(city, false);
  derive(city);
  return city;
}

function panelMarkup() {
  const groups: (keyof RainFeatures | 'all')[] = ['all', 'pools', 'cling', 'runs', 'puddles'];
  const local = (name: LocalDial) => { const spec = LOCAL_DIALS[name]; return `<label class="dial"><span>${spec.label}</span><input type="range" data-local="${name}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}"><output data-local-out="${name}"></output></label>`; };
  const dial = ([name, spec]: [string, (typeof RAIN_DIALS)[RainDialName]]) => `<label class="dial"><span>${spec.label}</span>`
    + `<input type="range" data-dial="${name}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}"><output data-out="${name}"></output></label>`;
  const section = (group: keyof RainFeatures | 'all') => {
    const dials = Object.entries(RAIN_DIALS).filter(([, spec]) => spec.group === group).map(dial).join('');
    const heading = group === 'all' ? '<h2>All drops</h2>' : `<h2><input type="checkbox" data-feature="${group}" checked id="feature-${group}"><label for="feature-${group}">${FEATURE_LABELS[group]}</label></h2>`;
    const extra = group === 'puddles' ? local('cover') + local('spray') : '';
    return `<section class="group" data-group="${group}">${heading}${dials}${extra}</section>`;
  };
  return `
  <main id="viewport"></main>
  <aside class="designer">
    <h1>block<span>cities</span> · weather</h1>
    <p>Drag to look round: Alt-drag turns, Shift-drag moves, wheel zooms.</p>
    <div class="budget" id="budget">
      <div><b id="fps">–</b> fps · slowest frame <span id="slowest">–</span> ms</div>
      <div id="budget-note">Budget: 60 fps, ${BUDGET_MILLISECONDS.toFixed(1)} ms a frame.</div>
    </div>
    <p>Your screen caps this at its refresh rate, so it shows a miss but not how much room is left. For that, run <code>npm run weather:budget</code>.</p>
    <h2>Rainfall</h2>
    <div class="row"><button type="button" id="rain" aria-pressed="false">☔ Start rain</button><button type="button" id="dry">Dry everything</button></div>
    <label class="dial"><span>Rain strength</span><input type="range" id="strength" min="0" max="1" step="0.01" value="${DEFAULT_STRENGTH}"><output id="strength-out"></output></label>
    ${local('dryTime')}
    <p>While it rains, drops and puddles collect: "Rain collected" below fills by itself, and cars put their wipers on. When it stops, everything dries out over the time above.</p>
    <h2>Sky</h2>
    <div class="row"><button type="button" id="daylight">☀ Daylight</button><button type="button" id="run-day">▶ Run the day</button><button type="button" id="cloud-shadows">☁ Cloud shadows</button></div>
    <p id="sky-note"></p>
    ${local('hour')}${local('dayLength')}${local('cloud')}${local('shadeDarkness')}${local('cloudSize')}${local('cloudSpeed')}
    <h2>Look from</h2>
    <div class="row" id="views">${Object.keys(VIEWS).map(name => `<button type="button" data-view="${name}">${name}</button>`).join('')}</div>
    ${groups.map(section).join('')}
    <h2>Settings</h2>
    <div class="row"><button type="button" id="copy">Copy settings</button><button type="button" id="reset">Reset</button><span id="copied"></span></div>
  </aside>
  <pre id="failure"></pre>`;
}

async function start(fail: (reason: unknown) => void) {
  const renderer = await createRenderer(fail), canvas = renderer.domElement;
  document.querySelector('#viewport')!.append(canvas);
  const scene = new THREE.Scene();
  createSoftboxEnvironment(renderer, scene, AMBIENT);
  const sky = new Sky(scene, renderer);
  const city = growCity(), traffic = createTraffic(city.size * city.size, TRAFFIC_SEED);
  const materials = createBrickMaterials();
  const view = new CityView(materials, city.size * city.size);
  scene.add(view.group);
  const rig = new CameraRig(MAP_SIZE * TILE_STUDS / 2);
  const composite = createComposite(renderer, scene, rig.camera);
  const rainfall = new Rainfall(), splashes = new Splashes();
  scene.add(rainfall.mesh, splashes.mesh);
  const localDials = Object.fromEntries((Object.keys(LOCAL_DIALS) as LocalDial[]).map(name => [name, LOCAL_DIALS[name].value])) as Record<LocalDial, number>;
  const lighting: SkyState = { daylight: false, running: false, cloudShadows: false };
  layPuddles(city, materials.puddles, localDials.cover);
  const input = new Input(canvas, rig, city.size, () => {}, () => {}, () => {});

  const features: RainFeatures = { ...ALL_RAIN };
  const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const showDial = (name: RainDialName) => {
    const value = materials.rain[name].value, spec = RAIN_DIALS[name];
    element<HTMLInputElement>(`[data-dial="${name}"]`).value = String(value);
    element(`[data-out="${name}"]`).textContent = value.toFixed(spec.step < 0.01 ? 3 : spec.step < 0.1 ? 2 : 1);
  };
  const setDial = (name: RainDialName, value: number) => {
    const spec = RAIN_DIALS[name];
    materials.rain[name].value = Math.max(spec.min, Math.min(spec.max, value));
    showDial(name);
  };
  const setFeatures = (change: Partial<RainFeatures>) => {
    Object.assign(features, change);
    materials.setRain(features);
    for (const name of Object.keys(features) as (keyof RainFeatures)[]) {
      element<HTMLInputElement>(`[data-feature="${name}"]`).checked = features[name];
      element(`[data-group="${name}"]`).classList.toggle('off', !features[name]);
    }
    return { ...features };
  };
  const look = (view: string | View) => {
    const name = typeof view === 'string' ? view : '', place = typeof view === 'string' ? VIEWS[view] : view;
    if (!place) throw new Error(`no view called ${name}`);
    const centre = (tile: number) => (tile + 0.5 - city.size / 2) * TILE_STUDS;
    rig.look({ ...place, x: centre(place.x), z: centre(place.z) });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.classList.toggle('active', button.dataset.view === name);
  };
  let raining = false, strength = DEFAULT_STRENGTH, drying = false;
  const setRaining = (on: boolean, heavy = strength) => {
    raining = on; strength = Math.max(0, Math.min(1, heavy)); if (on) drying = false;
    const button = element('#rain');
    button.textContent = on ? '☔ Stop rain' : '☔ Start rain'; button.setAttribute('aria-pressed', String(on)); button.classList.toggle('active', on);
    element<HTMLInputElement>('#strength').value = String(strength); element('#strength-out').textContent = strength.toFixed(2);
  };
  const dry = () => { setRaining(false); drying = true; };
  const setLocal = (name: LocalDial, value: number) => {
    const spec = LOCAL_DIALS[name];
    localDials[name] = Math.max(spec.min, Math.min(spec.max, value));
    element<HTMLInputElement>(`[data-local="${name}"]`).value = String(localDials[name]);
    element(`[data-local-out="${name}"]`).textContent = name === 'hour' ? clockLabel(localDials.hour) : localDials[name].toFixed(spec.step < 0.1 ? 2 : spec.step < 1 ? 1 : 0);
    if (name === 'cover') layPuddles(city, materials.puddles, localDials.cover);
  };
  const setSky = (change: Partial<SkyState>) => {
    const shadows = lighting.cloudShadows;
    Object.assign(lighting, change);
    if (lighting.cloudShadows !== shadows) materials.setCloudShadows(lighting.cloudShadows);
    element('#daylight').classList.toggle('active', lighting.daylight);
    element('#daylight').textContent = lighting.daylight ? '☀ Daylight' : '💡 Studio light';
    element('#run-day').classList.toggle('active', lighting.running);
    element('#run-day').textContent = lighting.running ? '❙❙ Stop the day' : '▶ Run the day';
    element('#cloud-shadows').classList.toggle('active', lighting.cloudShadows);
    element('#sky-note').textContent = lighting.daylight ? 'Lit by the sun through the cloud. Rain brings its own cloud, dims the day and closes the haze in.'
      : 'Lit by the studio lamps: time and cloud do nothing until you switch to daylight.';
    return { ...lighting };
  };
  const settings = () => ({
    raining, strength, local: { ...localDials }, sky: { ...lighting },
    features: { ...features },
    dials: Object.fromEntries((Object.keys(RAIN_DIALS) as RainDialName[]).map(name => [name, materials.rain[name].value])) as Record<RainDialName, number>,
  });

  for (const slider of document.querySelectorAll<HTMLInputElement>('[data-dial]')) {
    slider.addEventListener('input', () => { if (slider.dataset.dial === 'amount') drying = false; setDial(slider.dataset.dial as RainDialName, Number(slider.value)); });
  }
  for (const box of document.querySelectorAll<HTMLInputElement>('[data-feature]')) {
    box.addEventListener('change', () => setFeatures({ [box.dataset.feature as keyof RainFeatures]: box.checked }));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.addEventListener('click', () => look(button.dataset.view!));
  for (const slider of document.querySelectorAll<HTMLInputElement>('[data-local]')) slider.addEventListener('input', () => setLocal(slider.dataset.local as LocalDial, Number(slider.value)));
  element('#daylight').addEventListener('click', () => setSky({ daylight: !lighting.daylight }));
  element('#run-day').addEventListener('click', () => setSky({ running: !lighting.running, daylight: true }));
  element('#cloud-shadows').addEventListener('click', () => setSky({ cloudShadows: !lighting.cloudShadows, daylight: true }));
  element('#rain').addEventListener('click', () => setRaining(!raining));
  element('#dry').addEventListener('click', dry);
  element<HTMLInputElement>('#strength').addEventListener('input', event => setRaining(raining, Number((event.target as HTMLInputElement).value)));
  element('#reset').addEventListener('click', () => {
    // Everything back to how it ships, except how wet the city is, which is the rain's doing.
    const collected = materials.rain.amount.value;
    for (const name of Object.keys(RAIN_DIALS) as RainDialName[]) setDial(name, name === 'amount' ? collected : RAIN_DIALS[name].value);
    for (const name of Object.keys(LOCAL_DIALS) as LocalDial[]) setLocal(name, LOCAL_DIALS[name].value);
    setFeatures(ALL_RAIN); setRaining(raining, DEFAULT_STRENGTH); setSky({ running: false });
  });
  element('#copy').addEventListener('click', () => {
    void navigator.clipboard.writeText(JSON.stringify(settings(), null, 2)).then(() => { element('#copied').textContent = 'Copied'; window.setTimeout(() => { element('#copied').textContent = ''; }, 1500); });
  });

  const resize = () => resizeView(renderer, rig.camera);
  new ResizeObserver(resize).observe(document.documentElement);
  resize();
  view.sync(city);

  let last = performance.now(), seconds = 0;
  /** Frames since the readout was last written, their longest, and the same since `measure` was last called. */
  let shown = 0, shownSlowest = 0, shownSince = last, counted = 0, countedSlowest = 0;
  const steadyFrom = last + WARMUP_SECONDS * MILLISECONDS;
  const showBudget = (fps: number, slowest: number) => {
    const budget = element('#budget');
    element('#fps').textContent = fps.toFixed(0);
    element('#slowest').textContent = slowest.toFixed(1);
    budget.classList.toggle('tight', fps < TIGHT_FPS && fps >= MISSED_FPS);
    budget.classList.toggle('over', fps < MISSED_FPS);
    element('#budget-note').textContent = fps < MISSED_FPS ? 'Missing the 60 fps budget on this machine.' : 'Holding 60 fps on this machine.';
  };
  const frame = (now: number) => {
    const elapsed = Math.max(0, (now - last) / MILLISECONDS), dt = Math.min(MAX_FRAME_SECONDS, elapsed);
    last = now;
    if (document.hidden) return;
    const took = elapsed * MILLISECONDS;
    // The first moments are the shaders being built, not the weather.
    if (now < steadyFrom) { shown = 0; shownSlowest = 0; shownSince = now; return void composite.render(); }
    shown++; counted++; shownSlowest = Math.max(shownSlowest, took); countedSlowest = Math.max(countedSlowest, took);
    if (now - shownSince >= WINDOW_SECONDS * MILLISECONDS) { showBudget(shown / ((now - shownSince) / MILLISECONDS), shownSlowest); shown = 0; shownSlowest = 0; shownSince = now; }
    input.update(dt); rig.update(dt);
    stepTraffic(traffic, city, dt); seconds += dt;
    // Rain fills the drops; drying empties them; otherwise they stay as they are.
    const collected = materials.rain.amount.value;
    if (raining) { if (collected < 1) setDial('amount', collected + dt * strength / FILL_SECONDS); }
    else if (drying) { setDial('amount', collected - dt / DRY_SECONDS); if (materials.rain.amount.value <= 0) drying = false; }
    else if (collected > 0) setDial('amount', collected - dt / localDials.dryTime);
    const falling = raining ? strength : 0;
    if (materials.rain.falling.value !== falling) setDial('falling', falling);
    rainfall.update(rig.focus, rig.distance, falling);
    // Wipers go while it rains; puddles are there to be driven through for as long as they last.
    view.wipers = raining; materials.wipers.value = raining ? 1 : 0;
    const spread = features.puddles ? puddleGrowth(materials.rain.amount.value) * materials.rain.puddleSize.value : 0;
    splashes.update(dt, city, traffic, materials.puddles, spread, localDials.spray);
    view.animate(city, traffic, seconds, dt);
    // The day runs from dawn to dusk and starts again.
    if (lighting.daylight && lighting.running) setLocal('hour', DAWN + (localDials.hour - DAWN + dt * (DUSK - DAWN) / localDials.dayLength) % (DUSK - DAWN));
    const cloud = Math.max(localDials.cloud, falling * RAIN_CLOUD);
    materials.windowGlow.value = lighting.daylight ? sky.setTime(localDials.hour % HOURS_PER_DAY, false, { cloud, rain: falling }) : sky.setTime(NOON, true);
    // Shade needs direct sun to be missing from: under full cloud, or with the sun down, there is none to take away.
    materials.clouds.cover.value = cloud; materials.clouds.size.value = localDials.cloudSize;
    materials.clouds.darkness.value = lighting.daylight ? localDials.shadeDarkness * sky.direct : 0;
    materials.clouds.drift.value.set(localDials.cloudSpeed, localDials.cloudSpeed * 0.4);
    sky.follow(rig.focus, rig.distance, rig.camera.position);
    composite.render();
  };
  // The city opens dry: press Start rain, or drag "Rain collected".
  materials.rain.amount.value = 0;
  for (const name of Object.keys(RAIN_DIALS) as RainDialName[]) showDial(name);
  for (const name of Object.keys(LOCAL_DIALS) as LocalDial[]) setLocal(name, localDials[name]);
  setFeatures({}); setRaining(false); setSky({});
  look('Roofs');

  window.__weather = {
    features: setFeatures,
    set: (name, value) => { if (name === 'amount') drying = false; setDial(name, value); },
    rain: setRaining,
    dry,
    local: setLocal,
    sky: setSky,
    splashing: () => ({ wheelsInWater: splashes.wheelsInWater, dropsInAir: splashes.airborne, cars: traffic.vehicles.filter(vehicle => vehicle.active).length }),
    settings,
    look,
    measure: async wait => {
      counted = 0; countedSlowest = 0;
      const began = performance.now();
      await new Promise(resolve => window.setTimeout(resolve, wait * MILLISECONDS));
      return { fps: counted / ((performance.now() - began) / MILLISECONDS), slowest: countedSlowest };
    },
  };
  await renderer.setAnimationLoop(now => { try { frame(now); } catch (error) { void renderer.setAnimationLoop(null); fail(error); } });
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = panelMarkup();
let failed = false;
function fail(reason: unknown) {
  if (failed) return; failed = true;
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const failure = document.querySelector<HTMLPreElement>('#failure')!;
  failure.textContent = `The weather designer could not start.\n\n${error.message}`; failure.classList.add('shown');
  console.error('[Weather designer]', error);
}
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
void start(fail).catch(fail);
