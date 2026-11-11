/**
 * Where the light is at each hour, as plain numbers with no renderer in sight,
 * so it can be checked headlessly. The sun climbs and falls on an arc whose
 * noon matches the key light of the studio environment; at night a dim moon
 * takes its place on the opposite arc, and windows light up.
 */

export const HOURS_PER_DAY = 24;
export const NOON = 12;
const SUNRISE = 6;
/** The sun's height at noon and its compass bearing then (radians); the bearing swings half a turn from dawn to dusk. */
const NOON_ELEVATION = 0.84;
const NOON_AZIMUTH = -0.84;
/** The moon rides lower than the sun. */
const MOON_ELEVATION = 0.6;
/** Daylight fades in between these heights of the sun (sine of its elevation), a little below the horizon to a little above. */
const DAY_FROM = -0.08;
const DAY_FULL = 0.22;
/** Dawn and dusk colour is strongest at the horizon and gone once the sun is this high or this far under. */
const TWILIGHT_SPAN = 0.32;
/** A light never comes from lower than this (sine of elevation), or shadows would stretch across the whole map. */
const MIN_LIGHT_HEIGHT = 0.12;
/** Windows come on as daylight falls below this, and are fully on at night. */
const WINDOWS_ON_BELOW = 0.8;

export type Daylight = {
  /** Unit vector toward whichever light is up: the sun by day, the moon by night. */
  toLight: [number, number, number];
  /** 0 at night to 1 in full day. */
  day: number;
  /** 0 to 1: how much dawn or dusk colour is in the sky. */
  twilight: number;
  /** Strength of the sun and of the moon, each 0 to 1. One is always 0 when the other is not small. */
  sun: number;
  moon: number;
  /** 0 to 1: how brightly windows glow. */
  windows: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (from: number, to: number, value: number) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };

export function daylightAt(hour: number): Daylight {
  const h = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  // Angle round the day: 0 at sunrise, a quarter turn at noon.
  const turn = (h - SUNRISE) / HOURS_PER_DAY * Math.PI * 2, height = Math.sin(turn);
  const day = smoothstep(DAY_FROM, DAY_FULL, height);
  const twilight = clamp01(1 - Math.abs(height) / TWILIGHT_SPAN);
  // The sun lights the scene only while it is above the horizon, the moon only while the sun is well below it,
  // and both are at nothing when they change over, so the swap of direction is never seen.
  const sun = smoothstep(0, DAY_FULL, height), moon = smoothstep(0, DAY_FULL, -height);
  const up = height >= 0, peak = up ? NOON_ELEVATION : MOON_ELEVATION;
  const elevation = Math.asin(Math.max(MIN_LIGHT_HEIGHT, Math.abs(height) * Math.sin(peak)));
  // The moon crosses the sky twelve hours behind the sun, on the same track.
  const azimuth = NOON_AZIMUTH + ((up ? h : (h + NOON) % HOURS_PER_DAY) - NOON) / NOON * (Math.PI / 2);
  const flat = Math.cos(elevation);
  return {
    toLight: [flat * Math.sin(azimuth), Math.sin(elevation), flat * Math.cos(azimuth)],
    day, twilight, sun, moon,
    windows: 1 - smoothstep(0, WINDOWS_ON_BELOW, day),
  };
}

/** "07:30" for an hour of the day. */
export function clockLabel(hour: number) {
  const MINUTES = 60, h = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  const whole = Math.floor(h), minutes = Math.floor((h - whole) * MINUTES / 10) * 10;
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
