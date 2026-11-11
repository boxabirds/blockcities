/**
 * Sky, sun and haze, after Jellyland's sky.ts (its "meadow" air: a mild clear
 * day): a gradient whose horizon is the fog colour, so the table the city sits
 * on dissolves into it. Unlike Jellyland the sun here casts real shadows, from
 * a shadow map that follows the camera, because a city is mostly shadow edges,
 * and the hour can change: see daylight.ts for where the light is when.
 */
import * as THREE from 'three/webgpu';
import { normalWorldGeometry, uniform } from 'three/tsl';
import { TILE_STUDS } from '../game/tuning.ts';
import { NOON, daylightAt } from './daylight.ts';

/** Exponent below 1 keeps the pale band wide near the horizon. */
const GRADIENT_EXPONENT = 0.55;
const ZENITH = '#4d9bd6';
const HORIZON = '#d3ecf3';
const SUN_COLOR = '#fff3df';
const SUN_INTENSITY = 2;
/** Strength of the studio environment that fills the shadows. */
export const AMBIENT = 0.95;
const EXPOSURE = 1.05;
/** Fog starts and is complete this far beyond the camera's distance from what it looks at. */
const FOG_START = 160;
const FOG_END = 1100;

const SHADOW_MAP_SIZE = 4096;
/** The shadow map covers this many times the camera's distance around its focus, within the two limits (studs). */
const SHADOW_SPAN_PER_DISTANCE = 0.75;
const MIN_SHADOW_SPAN = 30;
const MAX_SHADOW_SPAN = 150;
/** The light sits this far back along its direction; everything that can shadow the view is nearer than that. */
const SUN_DISTANCE = 400;
const SHADOW_NEAR = 1;
const SHADOW_FAR = 800;
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.04;
/** The shadow map moves in whole steps of this many studs, so shadow edges do not crawl while the camera glides. */
const SHADOW_SNAP = TILE_STUDS;
/** The span is rounded up to a multiple of this, so zooming re-fits the map only now and then. */
const SPAN_STEP = 15;

const NIGHT_ZENITH = '#050916';
const NIGHT_HORIZON = '#141f38';
const TWILIGHT_HORIZON = '#f2a26b';
const TWILIGHT_SUN = '#ff9a55';
const MOON_COLOR = '#9db4ff';
const MOON_INTENSITY = 0.45;
/** Strength of the environment light at night, and how far dawn and dusk colour takes over the horizon. */
const NIGHT_AMBIENT = 0.1;
const TWILIGHT_STRENGTH = 0.75;

export class Sky {
  readonly sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  private readonly fog: THREE.Fog;
  private readonly scene: THREE.Scene;
  private readonly toLight = new THREE.Vector3(0, 1, 0);
  private readonly zenith = uniform(new THREE.Color(ZENITH));
  private readonly horizon = uniform(new THREE.Color(HORIZON));
  private readonly colors = {
    zenith: new THREE.Color(ZENITH), horizon: new THREE.Color(HORIZON), sun: new THREE.Color(SUN_COLOR),
    nightZenith: new THREE.Color(NIGHT_ZENITH), nightHorizon: new THREE.Color(NIGHT_HORIZON),
    twilightHorizon: new THREE.Color(TWILIGHT_HORIZON), twilightSun: new THREE.Color(TWILIGHT_SUN), moon: new THREE.Color(MOON_COLOR),
  };
  private span = 0;

  constructor(scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
    this.scene = scene;
    const height = normalWorldGeometry.y.max(0).pow(GRADIENT_EXPONENT);
    scene.backgroundNode = height.mix(this.horizon, this.zenith);
    this.fog = new THREE.Fog(new THREE.Color(HORIZON), FOG_START, FOG_END);
    scene.fog = this.fog;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = SHADOW_BIAS; this.sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
    this.sun.shadow.camera.near = SHADOW_NEAR; this.sun.shadow.camera.far = SHADOW_FAR;
    scene.add(this.sun, this.sun.target);
    this.setTime(NOON);
  }

  /** Sets sky, sun or moon, and fill light for an hour of the day. Returns how brightly windows should glow (0 to 1). */
  setTime(hour: number) {
    const light = daylightAt(hour), { colors } = this;
    this.toLight.set(...light.toLight);
    this.zenith.value.copy(colors.nightZenith).lerp(colors.zenith, light.day);
    this.horizon.value.copy(colors.nightHorizon).lerp(colors.horizon, light.day).lerp(colors.twilightHorizon, light.twilight * TWILIGHT_STRENGTH);
    this.fog.color.copy(this.horizon.value);
    // One directional light plays both parts: the two strengths are never both large.
    if (light.sun >= light.moon) {
      this.sun.color.copy(colors.sun).lerp(colors.twilightSun, light.twilight); this.sun.intensity = SUN_INTENSITY * light.sun;
    } else {
      this.sun.color.copy(colors.moon); this.sun.intensity = MOON_INTENSITY * light.moon;
    }
    this.scene.environmentIntensity = NIGHT_AMBIENT + (AMBIENT - NIGHT_AMBIENT) * light.day;
    return light.windows;
  }

  /** Keeps the shadow map and the haze fitted to what the camera is looking at. */
  follow(focus: THREE.Vector3, distance: number) {
    const x = Math.round(focus.x / SHADOW_SNAP) * SHADOW_SNAP, z = Math.round(focus.z / SHADOW_SNAP) * SHADOW_SNAP;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x, 0, z).addScaledVector(this.toLight, SUN_DISTANCE);
    const wanted = Math.min(MAX_SHADOW_SPAN, Math.max(MIN_SHADOW_SPAN, distance * SHADOW_SPAN_PER_DISTANCE));
    const span = Math.ceil(wanted / SPAN_STEP) * SPAN_STEP;
    if (span !== this.span) {
      this.span = span;
      const camera = this.sun.shadow.camera;
      camera.left = -span; camera.right = span; camera.top = span; camera.bottom = -span;
      camera.updateProjectionMatrix();
    }
    this.fog.near = distance + FOG_START; this.fog.far = distance + FOG_END;
  }
}
