/**
 * Sky, sun and haze, after Jellyland's sky.ts (its "meadow" air: a mild clear
 * day): a gradient whose horizon is the fog colour, so the table the city sits
 * on dissolves into it. Unlike Jellyland the sun here casts real shadows, from
 * a shadow map that follows the camera, because a city is mostly shadow edges.
 */
import * as THREE from 'three/webgpu';
import { normalWorldGeometry, uniform } from 'three/tsl';
import { TILE_STUDS } from '../game/tuning.ts';

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

export class Sky {
  readonly sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  private readonly fog: THREE.Fog;
  private readonly toLight: THREE.Vector3;
  private span = 0;

  /** @param toLight unit vector from the scene toward the key light */
  constructor(scene: THREE.Scene, renderer: THREE.WebGPURenderer, toLight: THREE.Vector3) {
    this.toLight = toLight.clone();
    const zenith = uniform(new THREE.Color(ZENITH)), horizon = uniform(new THREE.Color(HORIZON));
    const height = normalWorldGeometry.y.max(0).pow(GRADIENT_EXPONENT);
    scene.backgroundNode = height.mix(horizon, zenith);
    this.fog = new THREE.Fog(new THREE.Color(HORIZON), FOG_START, FOG_END);
    scene.fog = this.fog;
    scene.environmentIntensity = AMBIENT;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = SHADOW_BIAS; this.sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
    this.sun.shadow.camera.near = SHADOW_NEAR; this.sun.shadow.camera.far = SHADOW_FAR;
    scene.add(this.sun, this.sun.target);
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
