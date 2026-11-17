/**
 * Sky, sun and haze, after Jellyland's sky.ts (its "meadow" air: a mild clear
 * day): a gradient whose horizon is the fog colour, so the table the city sits
 * on dissolves into it. Unlike Jellyland the sun here casts real shadows, from
 * a shadow map that follows the camera, because a city is mostly shadow edges,
 * and the hour can change: see daylight.ts for where the light is when.
 */
import * as THREE from 'three/webgpu';
import { normalWorldGeometry, smoothstep, uniform } from 'three/tsl';
import { TILE_STUDS } from '../game/tuning.ts';
import { NOON, daylightAt } from './daylight.ts';

/** Exponent below 1 keeps the pale band wide near the horizon. */
const GRADIENT_EXPONENT = 0.55;
const ZENITH = '#4d9bd6';
const HORIZON = '#d3ecf3';
const SUN_COLOR = '#fff3df';
const SUN_INTENSITY = 3.2;
/** Strength of the studio room's reflections on the bricks. */
export const AMBIENT = 1;
/** The soft light from all round that fills the shadows, now the room itself is dark: from above, and bounced from below. */
const FILL_SKY = '#ffffff';
const FILL_GROUND = '#6f7f86';
const FILL_INTENSITY = 0.45;
const NIGHT_FILL_INTENSITY = 0.12;
const EXPOSURE = 0.95;
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

/**
 * A studio lamp that follows the camera. The sun lights the city; this is what makes the plastic shine. It sits where
 * a lamp would have to be to bounce off the tops of the bricks into the lens, a little to one side and a little
 * higher, so there is always a bright reflection sliding over the roofs and a glint on every stud and edge that
 * faces it, whichever way the mayor turns. It casts no shadow.
 */
/**
 * Studio lighting, used when the day and night cycle is off: the key light is fixed to the camera instead of the sky,
 * over the mayor's shoulder, this far round from the camera (radians) and this high. A real sun is wherever it is,
 * and from some angles it mirrors off every flat roof straight into the lens and whites the city out; a key that
 * turns with the camera never can. The city is lit like a model on a turntable.
 */
const STUDIO_KEY_SWING = -1.9;
const STUDIO_KEY_ELEVATION = 0.8;
const LAMP_COLOR = '#ffffff';
const LAMP_INTENSITY = 1.1;
const NIGHT_LAMP_INTENSITY = 0.1;
/** Radians the lamp is swung round from the exact mirror of the camera, and how much higher it sits. */
const LAMP_SWING = -0.95;
const LAMP_LIFT = 0.3;

/**
 * Cloud. A layer between the sun and the city that scatters its light: the more of it, the less comes straight
 * down and the more comes from everywhere, so shadows go soft and faint, colours go flat, and the sky turns from
 * blue to grey. Cloud that is raining is thick, and takes light away altogether: the day goes dim, the haze closes
 * in, and windows are lit at noon.
 */
/** Share of the sun's direct light a full cover scatters, and of the depth of its shadows; how far they blur. */
const CLOUD_SUN_LOSS = 0.9;
const CLOUD_SHADOW_LOSS = 0.8;
const CLOUD_SHADOW_BLUR = 5;
/** The scattered light comes back as fill from all round: this much more of it under a full cover. */
const CLOUD_FILL_GAIN = 2.4;
/** A full cover dulls the bright lamps the bricks reflect by this share, and puts out the lamp that follows the camera. */
const CLOUD_ROOM_LOSS = 0.3;
const OVERCAST_ZENITH = '#7c8791';
const OVERCAST_HORIZON = '#c1c8cc';
const OVERCAST_SUN = '#e6eaee';
/** Share of all light lost under full cloud in full rain, and how much nearer the haze comes. */
const STORM_DARKENING = 0.28;
const RAIN_HAZE = 0.72;
/** Windows come on as a storm darkens the day, between these strengths of storm (cloud times rain). */
const WINDOWS_STORM = [0.35, 0.8] as const;

/** The weather the light passes through: how much of the sky is cloud, and how hard it is raining, each 0 to 1. */
export type Weather = { cloud: number; rain: number };
export const CLEAR_SKY: Weather = { cloud: 0, rain: 0 };

/**
 * Under a real sun the studio steps back, or its lamps fill every shadow the sun casts and the hour cannot be read:
 * the share kept of the lamp that follows the camera, and of the room's reflections.
 */
const DAYLIGHT_LAMP = 0.12;
const DAYLIGHT_ROOM = 0.42;
/** By day the fill is skylight, so shadows are tinted by the sky: this far from white toward the colour overhead. */
const FILL_SKY_TINT = 0.55;
const DAYLIGHT_FILL = 0.6;
const DAYLIGHT_SUN = 1.25;
/** The sun on the horizon, after the most air. */
const LOW_SUN = '#ff6a1f';
/** The sun in the sky: the cosine of its half-width, how soft its edge is, and how bright it is drawn. */
const DISC_COS = 0.9997;
const DISC_EDGE = 0.0001;
const DISC_BRIGHTNESS = 1.4;
/** The glare round it: a tight one and a wide one, as exponents of the cosine of the angle from the sun, and their strengths. The wide one grows as the sun sinks into thicker air. */
const GLARE_TIGHT = 700;
const GLARE_WIDE = 10;
const GLARE_TIGHT_STRENGTH = 0.5;
const GLARE_WIDE_STRENGTH = 0.12;
const GLARE_WIDE_LOW = 0.55;
/** Share of the dawn colour the fill light takes. */
const TWILIGHT_FILL = 0.4;

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
    overcastZenith: new THREE.Color(OVERCAST_ZENITH), overcastHorizon: new THREE.Color(OVERCAST_HORIZON), overcastSun: new THREE.Color(OVERCAST_SUN),
    lowSun: new THREE.Color(LOW_SUN), dawn: new THREE.Color(), fillSky: new THREE.Color(FILL_SKY), scratch: new THREE.Color(),
  };
  /** What the sky shader draws of the sun: where it is, its colour, how bright (nothing in the studio or behind cloud), and the dawn colour on its side. */
  private readonly discToward = uniform(new THREE.Vector3(0, 1, 0));
  private readonly discColor = uniform(new THREE.Color(SUN_COLOR));
  private readonly discStrength = uniform(0);
  private readonly glare = uniform(0);
  private span = 0;
  private readonly fill = new THREE.HemisphereLight(FILL_SKY, FILL_GROUND, FILL_INTENSITY);
  private studio = false;
  /** How far the haze stands off, as a share of clear air. */
  private haze = 1;
  /** How strongly drifting cloud can shade the ground just now, 0 to 1: nothing with the sun down, and nothing under full cover, where it is all shade already. */
  direct = 1;
  private readonly lamp = new THREE.DirectionalLight(LAMP_COLOR, LAMP_INTENSITY);
  private readonly toLamp = new THREE.Vector3();

  constructor(scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
    this.scene = scene;
    const toward = normalWorldGeometry.normalize(), height = toward.y.max(0).pow(GRADIENT_EXPONENT);
    // The horizon is the haze's colour all the way round, so the table still dissolves into it at dawn and dusk; the
    // side the sun is on is brighter only by the sun's own glare.
    const air = height.mix(this.horizon, this.zenith);
    const facing = toward.dot(this.discToward).max(0);
    const disc = smoothstep(DISC_COS - DISC_EDGE, DISC_COS + DISC_EDGE, facing).mul(DISC_BRIGHTNESS);
    const glare = facing.pow(GLARE_TIGHT).mul(GLARE_TIGHT_STRENGTH).add(facing.pow(GLARE_WIDE).mul(this.glare));
    scene.backgroundNode = air.add(this.discColor.mul(disc.add(glare)).mul(this.discStrength));
    this.fog = new THREE.Fog(new THREE.Color(HORIZON), FOG_START, FOG_END);
    scene.fog = this.fog;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = SHADOW_BIAS; this.sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
    this.sun.shadow.camera.near = SHADOW_NEAR; this.sun.shadow.camera.far = SHADOW_FAR;
    scene.add(this.sun, this.sun.target, this.lamp, this.lamp.target, this.fill);
    this.setTime(NOON);
  }

  /**
   * Sets sky, sun or moon, and fill light for an hour of the day. Returns how brightly windows should glow (0 to 1).
   * With `studio` the light keeps the hour's colour and strength but is placed by `follow`, relative to the camera.
   * `weather` is the cloud and rain the light has to come through.
   */
  setTime(hour: number, studio = false, weather: Weather = CLEAR_SKY) {
    this.studio = studio;
    const light = daylightAt(hour), { colors } = this;
    const cloud = Math.max(0, Math.min(1, weather.cloud)), rain = Math.max(0, Math.min(1, weather.rain));
    const storm = cloud * rain, level = 1 - STORM_DARKENING * storm, through = 1 - CLOUD_SUN_LOSS * cloud;
    this.toLight.set(...light.toLight);
    // The sky: its clear colours for the hour, greyed by cloud (which is itself only as bright as the day), dimmed by storm.
    this.zenith.value.copy(colors.nightZenith).lerp(colors.zenith, light.day);
    this.horizon.value.copy(colors.nightHorizon).lerp(colors.horizon, light.day);
    this.zenith.value.lerp(colors.scratch.copy(colors.nightZenith).lerp(colors.overcastZenith, light.day), cloud).multiplyScalar(level);
    this.horizon.value.lerp(colors.scratch.copy(colors.nightHorizon).lerp(colors.overcastHorizon, light.day), cloud).multiplyScalar(level);
    const twilight = light.twilight * TWILIGHT_STRENGTH * (1 - cloud);
    const dawn = colors.dawn.copy(colors.twilightHorizon).multiplyScalar(level);
    this.horizon.value.lerp(dawn, twilight);
    this.fog.color.copy(this.horizon.value);
    this.haze = 1 - RAIN_HAZE * rain;
    // One directional light plays both parts: the two strengths are never both large. The air reddens the sun as it
    // sinks; cloud takes its direct light and its colour, and softens and lifts the shadows it casts.
    const sunUp = light.sun >= light.moon, real = studio ? 1 : DAYLIGHT_SUN;
    if (sunUp) {
      this.sun.color.copy(colors.sun).lerp(colors.lowSun, studio ? 0 : light.warmth).lerp(colors.overcastSun, cloud);
      this.sun.intensity = SUN_INTENSITY * real * light.sun * through * level;
    } else {
      this.sun.color.copy(colors.moon); this.sun.intensity = MOON_INTENSITY * light.moon * through * level;
    }
    this.glare.value = GLARE_WIDE_STRENGTH + (GLARE_WIDE_LOW - GLARE_WIDE_STRENGTH) * light.warmth;
    this.discToward.value.copy(this.toLight); this.discColor.value.copy(this.sun.color);
    this.discStrength.value = studio ? 0 : (sunUp ? light.sun : light.moon * MOON_INTENSITY) * (1 - cloud) ** 2 * level;
    this.direct = light.sun * (1 - cloud * cloud);
    this.sun.shadow.intensity = 1 - CLOUD_SHADOW_LOSS * cloud;
    this.sun.shadow.radius = 1 + CLOUD_SHADOW_BLUR * cloud;
    // In daylight the studio steps back as far as the sun is out: under cloud its even light is what an overcast sky gives.
    const out = studio ? 0 : light.day * (1 - cloud), lamp = 1 - (1 - DAYLIGHT_LAMP) * out, room = 1 - (1 - DAYLIGHT_ROOM) * out;
    this.scene.environmentIntensity = (NIGHT_AMBIENT + (AMBIENT - NIGHT_AMBIENT) * light.day) * (1 - CLOUD_ROOM_LOSS * cloud) * level * room;
    this.fill.color.copy(colors.fillSky).lerp(this.zenith.value, studio ? 0 : FILL_SKY_TINT * light.day).lerp(dawn, studio ? 0 : twilight * TWILIGHT_FILL);
    this.fill.intensity = (NIGHT_FILL_INTENSITY + (FILL_INTENSITY - NIGHT_FILL_INTENSITY) * light.day) * (1 + CLOUD_FILL_GAIN * cloud) * level * (1 - (1 - DAYLIGHT_FILL) * out);
    this.lamp.intensity = (NIGHT_LAMP_INTENSITY + (LAMP_INTENSITY - NIGHT_LAMP_INTENSITY) * light.day) * (1 - cloud) * level * lamp;
    const dark = Math.max(0, Math.min(1, (storm - WINDOWS_STORM[0]) / (WINDOWS_STORM[1] - WINDOWS_STORM[0])));
    return Math.max(light.windows, dark * dark * (3 - 2 * dark));
  }

  /** Keeps the shadow map, the haze and the studio lamp fitted to what the camera is looking at, and from where. */
  follow(focus: THREE.Vector3, distance: number, camera: THREE.Vector3) {
    // The mirror of the camera about the vertical through the focus, swung round and lifted.
    const { toLamp } = this;
    toLamp.subVectors(camera, focus).normalize();
    const sin = Math.sin(LAMP_SWING), cos = Math.cos(LAMP_SWING), awayX = -toLamp.x, awayZ = -toLamp.z;
    toLamp.set(awayX * cos - awayZ * sin, toLamp.y + LAMP_LIFT, awayX * sin + awayZ * cos).normalize();
    if (this.studio) {
      const round = Math.atan2(camera.x - focus.x, camera.z - focus.z) + STUDIO_KEY_SWING, flat = Math.cos(STUDIO_KEY_ELEVATION);
      this.toLight.set(flat * Math.sin(round), Math.sin(STUDIO_KEY_ELEVATION), flat * Math.cos(round));
    }
    this.lamp.target.position.copy(focus);
    this.lamp.position.copy(focus).addScaledVector(toLamp, SUN_DISTANCE);
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
    this.fog.near = distance + FOG_START * this.haze; this.fog.far = distance + FOG_END * this.haze;
  }
}
