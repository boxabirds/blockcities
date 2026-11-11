/**
 * What everything is built from: lists of bricks. A blueprint is plain data in
 * the frame of one 4×4 stud lot whose front is its +z edge; the view turns it to
 * face the road. Bricks are in building order (bottom up), so drawing the first
 * n of them shows a building n bricks into construction.
 *
 * Horizontal units are studs; vertical units are plates (a brick is 3 plates).
 */
import { CLINIC, DIR_COUNT, FIRE, PARK, PLANT, POLICE, SCHOOL, TOWER, WIND, ZONE_C, ZONE_I, ZONE_R } from './city.ts';
import { hash3 } from './rng.ts';
import { BRICK_PLATES, TILE_STUDS } from './tuning.ts';

// --- Colours ---------------------------------------------------------------------

export const PALETTE = [
  '#f2f3f2', '#a0a5a9', '#6c6e68', '#1b2a34', '#c91a09', '#0055bf', '#f2cd37', '#237841', '#4b9f4a', '#bbe90b',
  '#e4cd9e', '#958a73', '#fe8a18', '#582a12', '#36aebf', '#6074a1', '#720e0f', '#aa7d55', '#0a3463', '#e4adc8',
  '#184632', '#9b9a5a', '#fcfcfc', '#aee9ef', '#2a6fd6', '#84b68d', '#635f52', '#73dca1', '#8fd45a', '#7ec8e3', '#ecd35f',
  '#3c4046',
] as const;
export const COLOR = {
  WHITE: 0, LIGHT_GREY: 1, DARK_GREY: 2, BLACK: 3, RED: 4, BLUE: 5, YELLOW: 6, GREEN: 7, BRIGHT_GREEN: 8, LIME: 9,
  TAN: 10, DARK_TAN: 11, ORANGE: 12, BROWN: 13, AZURE: 14, SAND_BLUE: 15, DARK_RED: 16, NOUGAT: 17, DARK_BLUE: 18, PINK: 19,
  DARK_GREEN: 20, OLIVE: 21, GLASS_CLEAR: 22, GLASS_ICE: 23, GLASS_BLUE: 24, GLASS_GREEN: 25, GLASS_SMOKE: 26, GLASS_MINT: 27,
  ZONE_R: 28, ZONE_C: 29, ZONE_I: 30, ASPHALT: 31,
} as const;

// --- Bricks ----------------------------------------------------------------------

export const BOX = 0, CYLINDER = 1, SLOPE = 2, CONE = 3;
export const SHAPE_COUNT = 4;

export type Brick = {
  readonly shape: number;
  /** Centre of the footprint, in studs from the lot's corner. */
  readonly cx: number; readonly cz: number;
  /** Bottom, in plates above the baseplate. */
  readonly y: number;
  /** Size in the brick's own frame: studs across, plates up, studs deep. */
  readonly w: number; readonly h: number; readonly d: number;
  /** Quarter turns about the vertical. A slope runs downhill toward its own +z. */
  readonly rot: number;
  readonly color: number;
  readonly glass: boolean;
};

export type Stud = {
  readonly x: number; readonly z: number;
  /** Top of the brick it sits on, in plates. */
  readonly y: number;
  readonly color: number;
  readonly glass: boolean;
  /** Shown once brick `owner` is placed and until brick `cover` is (Infinity when nothing covers it). */
  readonly owner: number;
  readonly cover: number;
};

export type Blueprint = {
  readonly bricks: readonly Brick[];
  readonly studs: readonly Stud[];
  /** Top of the tallest brick, in plates. */
  readonly height: number;
};

type Options = { glass?: boolean; studs?: boolean };
/** A brick while a blueprint is being drawn up: also its footprint in the lot's frame. */
type Draft = Brick & { x0: number; z0: number; x1: number; z1: number; studded: boolean };

const WHOLE_TOLERANCE = 1e-6;
const isWhole = (n: number) => Math.abs(n - Math.round(n)) < WHOLE_TOLERANCE;

class Builder {
  private readonly drafts: Draft[] = [];

  /** A cuboid whose corner nearest the lot's corner is at (x, z). Studded on top when it lies on the stud grid. */
  box(x: number, z: number, w: number, d: number, y: number, h: number, color: number, options: Options = {}) {
    const onGrid = isWhole(x) && isWhole(z) && isWhole(w) && isWhole(d);
    this.drafts.push({
      shape: BOX, cx: x + w / 2, cz: z + d / 2, y, w, h, d, rot: 0, color, glass: options.glass ?? false,
      x0: x, z0: z, x1: x + w, z1: z + d, studded: (options.studs ?? true) && onGrid,
    });
    return this;
  }

  /** A wedge over the footprint, full height at one edge and running down toward facing `downhill`. */
  slope(x: number, z: number, w: number, d: number, y: number, h: number, downhill: number, color: number) {
    const turned = downhill % 2 === 1;
    this.drafts.push({
      shape: SLOPE, cx: x + w / 2, cz: z + d / 2, y, w: turned ? d : w, h, d: turned ? w : d, rot: downhill, color, glass: false,
      x0: x, z0: z, x1: x + w, z1: z + d, studded: false,
    });
    return this;
  }

  /** An upright cylinder centred on (cx, cz). Studded when it is one stud wide and sits on a stud. */
  round(cx: number, cz: number, diameter: number, y: number, h: number, color: number, options: Options = {}) {
    const half = diameter / 2;
    const onStud = diameter === 1 && isWhole(cx - half) && isWhole(cz - half);
    this.drafts.push({
      shape: CYLINDER, cx, cz, y, w: diameter, h, d: diameter, rot: 0, color, glass: options.glass ?? false,
      x0: cx - half, z0: cz - half, x1: cx + half, z1: cz + half, studded: (options.studs ?? true) && onStud,
    });
    return this;
  }

  cone(cx: number, cz: number, diameter: number, y: number, h: number, color: number) {
    const half = diameter / 2;
    this.drafts.push({
      shape: CONE, cx, cz, y, w: diameter, h, d: diameter, rot: 0, color, glass: false,
      x0: cx - half, z0: cz - half, x1: cx + half, z1: cz + half, studded: false,
    });
    return this;
  }

  finish(): Blueprint {
    // Bottom up; bricks at one height keep the order they were drawn in.
    const order = this.drafts.map((draft, index) => ({ draft, index })).sort((a, b) => a.draft.y - b.draft.y || a.index - b.index);
    const bricks = order.map(entry => entry.draft);
    const studs: Stud[] = [];
    bricks.forEach((brick, owner) => {
      if (!brick.studded) return;
      const top = brick.y + brick.h;
      for (let x = Math.round(brick.x0); x < Math.round(brick.x1); x++) {
        for (let z = Math.round(brick.z0); z < Math.round(brick.z1); z++) {
          const sx = x + 0.5, sz = z + 0.5;
          const cover = bricks.findIndex(other => Math.abs(other.y - top) < WHOLE_TOLERANCE
            && sx > other.x0 && sx < other.x1 && sz > other.z0 && sz < other.z1);
          studs.push({ x: sx, z: sz, y: top, color: brick.color, glass: brick.glass, owner, cover: cover < 0 ? Infinity : cover });
        }
      }
    });
    const height = bricks.reduce((top, brick) => Math.max(top, brick.y + brick.h), 0);
    return { bricks: bricks.map(({ shape, cx, cz, y, w, h, d, rot, color, glass }) => ({ shape, cx, cz, y, w, h, d, rot, color, glass })), studs, height };
  }
}

// --- Shared parts ----------------------------------------------------------------

const LOT = TILE_STUDS;
const BRICK = BRICK_PLATES;
const PLATE = 1;
/** Two studs: the width of the bricks walls are laid in. */
const WALL_BRICK = 2;
/** Thin details that sit on a smooth surface. */
const TILE_THIN = 0.5;

const pick = <T>(list: readonly T[], seed: number, salt: number): T => list[Math.floor(hash3(seed, salt, list.length) * list.length)];

/** The plate a building stands on. */
function lot(b: Builder, color: number) { b.box(0, 0, LOT, LOT, 0, PLATE, color); }

/** One course of solid wall over a footprint, in two-stud bricks; alternate courses are offset so the joints stagger. */
function solidCourse(b: Builder, x: number, z: number, w: number, d: number, y: number, color: number, offset: boolean) {
  let at = x;
  if (offset && w > 1) { b.box(at, z, 1, d, y, BRICK, color); at += 1; }
  while (at < x + w) {
    const piece = Math.min(WALL_BRICK, x + w - at);
    b.box(at, z, piece, d, y, BRICK, color);
    at += piece;
  }
}

/** One storey with a window in each face: solid corners, glass between them, and a solid core. */
function windowCourse(b: Builder, x: number, z: number, w: number, d: number, y: number, wall: number, glass: number, core = wall) {
  const x1 = x + w - 1, z1 = z + d - 1;
  b.box(x, z, 1, 1, y, BRICK, wall).box(x1, z, 1, 1, y, BRICK, wall).box(x, z1, 1, 1, y, BRICK, wall).box(x1, z1, 1, 1, y, BRICK, wall);
  if (w > 2) {
    b.box(x + 1, z, w - 2, 1, y, BRICK, glass, { glass: true }).box(x + 1, z1, w - 2, 1, y, BRICK, glass, { glass: true });
  }
  if (d > 2) {
    b.box(x, z + 1, 1, d - 2, y, BRICK, glass, { glass: true }).box(x1, z + 1, 1, d - 2, y, BRICK, glass, { glass: true });
  }
  if (w > 2 && d > 2) b.box(x + 1, z + 1, w - 2, d - 2, y, BRICK, core);
}

/** One storey of curtain wall: glass all the way round a solid core. */
function glassCourse(b: Builder, x: number, z: number, w: number, d: number, y: number, glass: number, core: number) {
  b.box(x, z, w, 1, y, BRICK, glass, { glass: true }).box(x, z + d - 1, w, 1, y, BRICK, glass, { glass: true });
  b.box(x, z + 1, 1, d - 2, y, BRICK, glass, { glass: true }).box(x + w - 1, z + 1, 1, d - 2, y, BRICK, glass, { glass: true });
  b.box(x + 1, z + 1, w - 2, d - 2, y, BRICK, core);
}

/** A gable roof whose ridge runs front to back. */
function gable(b: Builder, x: number, z: number, w: number, d: number, y: number, h: number, color: number) {
  const LEFT = 3, RIGHT = 1;
  b.slope(x, z, w / 2, d, y, h, LEFT, color).slope(x + w / 2, z, w / 2, d, y, h, RIGHT, color);
}

const TRUNK_PLATES = 4;
const CANOPY_PLATES = 4;
const CANOPY_OVERLAP = 2;
const LEAVES = [COLOR.GREEN, COLOR.BRIGHT_GREEN, COLOR.DARK_GREEN] as const;

/** A tree on the stud at (x, z): a trunk and `tiers` cones. */
function tree(b: Builder, x: number, z: number, y: number, tiers: number, leaf: number) {
  const cx = x + 0.5, cz = z + 0.5, CANOPY_BASE = 2.2, CANOPY_TAPER = 0.5;
  b.round(cx, cz, 1, y, TRUNK_PLATES, COLOR.BROWN, { studs: false });
  for (let tier = 0; tier < tiers; tier++) {
    b.cone(cx, cz, CANOPY_BASE - tier * CANOPY_TAPER, y + TRUNK_PLATES + tier * (CANOPY_PLATES - CANOPY_OVERLAP), CANOPY_PLATES, leaf);
  }
}

// --- Homes -----------------------------------------------------------------------

const HOME_WALLS = [COLOR.WHITE, COLOR.TAN, COLOR.YELLOW, COLOR.SAND_BLUE, COLOR.PINK, COLOR.AZURE, COLOR.NOUGAT] as const;
const HOME_ROOFS = [COLOR.RED, COLOR.DARK_RED, COLOR.DARK_BLUE, COLOR.DARK_GREY, COLOR.BROWN] as const;
const HOME_TRIMS = [COLOR.WHITE, COLOR.DARK_GREY, COLOR.DARK_TAN, COLOR.LIGHT_GREY] as const;
/** Depth of a house on its lot; the remaining strip at the front is its garden. */
const HOUSE_DEPTH = 3;
const COTTAGE_ROOF_PLATES = 4;
const HOUSE_ROOF_PLATES = 5;
/** Storeys of the three flat-roofed kinds of home, by level. */
const HOME_STOREYS: Record<number, number> = { 3: 3, 4: 6, 5: 11 };
const PARAPET_PLATES = 1;

function garden(b: Builder, seed: number) {
  const GARDEN_Z = 3, SIDE_SALT = 3, FLOWERS = [COLOR.RED, COLOR.YELLOW, COLOR.PINK, COLOR.ORANGE] as const;
  const side = hash3(seed, SIDE_SALT, 0) < 0.5 ? 0 : LOT - 1;
  tree(b, side, GARDEN_Z, PLATE, 1, pick(LEAVES, seed, 4));
  b.round(LOT - 1 - side + 0.5, GARDEN_Z + 0.5, 1, PLATE, PLATE, pick(FLOWERS, seed, 5));
}

/** Storeys of windows with a band between them and a flat roof with a parapet and a plant room. */
function flatRoofed(b: Builder, storeys: number, wall: number, band: number, glass: number, seed: number) {
  let y = PLATE;
  for (let storey = 0; storey < storeys; storey++) {
    windowCourse(b, 0, 0, LOT, LOT, y, wall, glass); y += BRICK;
    b.box(0, 0, LOT, LOT, y, PLATE, band); y += PLATE;
  }
  // Parapet round the edge, then something on the roof.
  b.box(0, 0, LOT, 1, y, PARAPET_PLATES, wall).box(0, LOT - 1, LOT, 1, y, PARAPET_PLATES, wall);
  b.box(0, 1, 1, LOT - 2, y, PARAPET_PLATES, wall).box(LOT - 1, 1, 1, LOT - 2, y, PARAPET_PLATES, wall);
  const ROOF_SALT = 9;
  if (hash3(seed, ROOF_SALT, 0) < 0.5) b.box(1, 1, 2, 1, y, BRICK, COLOR.LIGHT_GREY);
  else b.round(2, 2, 1.4, y, BRICK, COLOR.DARK_GREY, { studs: false });
}

function home(level: number, seed: number): Blueprint {
  const b = new Builder();
  const wall = pick(HOME_WALLS, seed, 1), roof = pick(HOME_ROOFS, seed, 2), trim = pick(HOME_TRIMS, seed, 6);
  if (level <= 2) {
    lot(b, COLOR.BRIGHT_GREEN);
    let y = PLATE;
    windowCourse(b, 0, 0, LOT, HOUSE_DEPTH, y, wall, COLOR.GLASS_ICE); y += BRICK;
    if (level === 2) {
      b.box(0, 0, LOT, HOUSE_DEPTH, y, PLATE, trim); y += PLATE;
      windowCourse(b, 0, 0, LOT, HOUSE_DEPTH, y, wall, COLOR.GLASS_ICE); y += BRICK;
    } else {
      solidCourse(b, 0, 0, LOT, HOUSE_DEPTH, y, wall, true); y += BRICK;
    }
    gable(b, 0, 0, LOT, HOUSE_DEPTH, y, level === 2 ? HOUSE_ROOF_PLATES : COTTAGE_ROOF_PLATES, roof);
    garden(b, seed);
    return b.finish();
  }
  lot(b, COLOR.LIGHT_GREY);
  flatRoofed(b, HOME_STOREYS[level], wall, trim, COLOR.GLASS_ICE, seed);
  return b.finish();
}

// --- Shops and offices -------------------------------------------------------------

const SHOP_WALLS = [COLOR.WHITE, COLOR.TAN, COLOR.LIGHT_GREY, COLOR.NOUGAT, COLOR.SAND_BLUE] as const;
const SHOP_AWNINGS = [COLOR.RED, COLOR.BLUE, COLOR.GREEN, COLOR.ORANGE, COLOR.YELLOW, COLOR.AZURE] as const;
const OFFICE_WALLS = [COLOR.WHITE, COLOR.LIGHT_GREY, COLOR.TAN, COLOR.DARK_GREY] as const;
const OFFICE_GLASS = [COLOR.GLASS_ICE, COLOR.GLASS_BLUE, COLOR.GLASS_MINT, COLOR.GLASS_SMOKE] as const;
const TOWER_BANDS = [COLOR.WHITE, COLOR.LIGHT_GREY, COLOR.DARK_GREY, COLOR.BLACK] as const;
const OFFICE_STOREYS = 4;
/** Storeys of the two glass towers, by level, and of the narrower crown on top. */
const GLASS_STOREYS: Record<number, number> = { 4: 8, 5: 14 };
const CROWN_STOREYS = 2;
const SPIRE_PLATES = 8;

/** A shop floor: solid back and sides, a glass front between two pillars, under an awning. */
function shopFloor(b: Builder, y: number, wall: number, awning: number) {
  const BACK = 1, FRONT = LOT - 1;
  solidCourse(b, 0, BACK, LOT, FRONT - BACK, y, wall, false);
  b.box(0, FRONT, 1, 1, y, BRICK, wall).box(LOT - 1, FRONT, 1, 1, y, BRICK, wall);
  b.box(1, FRONT, LOT - 2, 1, y, BRICK, COLOR.GLASS_CLEAR, { glass: true });
  b.box(0, BACK, LOT, LOT - BACK, y + BRICK, PLATE, awning);
  return y + BRICK + PLATE;
}

function shop(level: number, seed: number): Blueprint {
  const b = new Builder();
  lot(b, COLOR.LIGHT_GREY);
  if (level <= 2) {
    const wall = pick(SHOP_WALLS, seed, 1), awning = pick(SHOP_AWNINGS, seed, 2), BACK = 1;
    let y = shopFloor(b, PLATE, wall, awning);
    if (level === 2) {
      windowCourse(b, 0, BACK, LOT, LOT - BACK, y, wall, COLOR.GLASS_ICE); y += BRICK;
      b.box(0, BACK, LOT, LOT - BACK, y, PLATE, wall); y += PLATE;
    }
    // The sign over the door.
    b.box(1, LOT - 1, 2, 1, y, BRICK - PLATE, pick(SHOP_AWNINGS, seed, 3));
    return b.finish();
  }
  if (level === 3) {
    flatRoofed(b, OFFICE_STOREYS, pick(OFFICE_WALLS, seed, 1), pick(TOWER_BANDS, seed, 2), pick(OFFICE_GLASS, seed, 3), seed);
    return b.finish();
  }
  const glass = pick(OFFICE_GLASS, seed, 3), band = pick(TOWER_BANDS, seed, 2), core = COLOR.DARK_GREY;
  let y = PLATE;
  for (let storey = 0; storey < GLASS_STOREYS[level]; storey++) {
    glassCourse(b, 0, 0, LOT, LOT, y, glass, core); y += BRICK;
    b.box(0, 0, LOT, LOT, y, PLATE, band); y += PLATE;
  }
  if (level === 5) {
    for (let storey = 0; storey < CROWN_STOREYS; storey++) {
      b.box(1, 1, 2, 2, y, BRICK, glass, { glass: true }); y += BRICK;
      b.box(1, 1, 2, 2, y, PLATE, band); y += PLATE;
    }
    b.round(2, 2, 0.4, y, SPIRE_PLATES, COLOR.LIGHT_GREY, { studs: false });
  } else {
    b.box(1, 1, 2, 2, y, BRICK, core);
  }
  return b.finish();
}

// --- Industry --------------------------------------------------------------------

const WORKS_WALLS = [COLOR.DARK_TAN, COLOR.LIGHT_GREY, COLOR.SAND_BLUE, COLOR.OLIVE, COLOR.NOUGAT] as const;
const WORKS_ROOFS = [COLOR.DARK_GREY, COLOR.DARK_RED, COLOR.DARK_BLUE] as const;
const SAWTOOTH_PLATES = 2;
const STACK_SECTION_PLATES = 3;
/** Sections in the chimney of industry of each level. */
const STACK_SECTIONS = [0, 3, 5, 7] as const;
const TANK_PLATES = 5;

/** A striped chimney on the stud at (x, z). */
function stack(b: Builder, x: number, z: number, y: number, sections: number) {
  for (let section = 0; section < sections; section++) {
    b.round(x + 0.5, z + 0.5, 1, y + section * STACK_SECTION_PLATES, STACK_SECTION_PLATES, section % 2 ? COLOR.WHITE : COLOR.RED, { studs: section === sections - 1 });
  }
}

/** Roof lights: a row of slopes all falling the same way. */
function sawtooth(b: Builder, x: number, z: number, w: number, d: number, y: number, color: number) {
  const DOWNHILL = 1;
  for (let at = x; at < x + w; at += WALL_BRICK) b.slope(at, z, WALL_BRICK, d, y, SAWTOOTH_PLATES, DOWNHILL, color);
}

function works(level: number, seed: number): Blueprint {
  const b = new Builder();
  const wall = pick(WORKS_WALLS, seed, 1), roof = pick(WORKS_ROOFS, seed, 2);
  lot(b, COLOR.DARK_TAN);
  const YARD_Z = 3, HALL_DEPTH = 3;
  let y = PLATE;
  solidCourse(b, 0, 0, LOT, HALL_DEPTH, y, wall, false); y += BRICK;
  if (level >= 2) { windowCourse(b, 0, 0, LOT, HALL_DEPTH, y, wall, COLOR.GLASS_SMOKE, COLOR.DARK_GREY); y += BRICK; }
  if (level >= 3) { solidCourse(b, 0, 0, LOT, HALL_DEPTH, y, wall, true); y += BRICK; }
  b.box(0, 0, LOT, HALL_DEPTH, y, PLATE, COLOR.DARK_GREY); y += PLATE;
  sawtooth(b, 0, 0, LOT, HALL_DEPTH, y, roof);
  stack(b, 0, YARD_Z, PLATE, STACK_SECTIONS[level]);
  if (level >= 2) b.round(2.5, YARD_Z + 0.5, 1, PLATE, TANK_PLATES, COLOR.LIGHT_GREY);
  if (level >= 3) stack(b, 3, YARD_Z, PLATE, STACK_SECTIONS[level] - 2);
  else b.box(3, YARD_Z, 1, 1, PLATE, BRICK, pick(SHOP_AWNINGS, seed, 3));
  return b.finish();
}

// --- Services --------------------------------------------------------------------

const MAST_SECTIONS = 5;
const MAST_SECTION_PLATES = 5;
const MAST_DIAMETER = 0.7;
const NACELLE_PLATES = 2;
/** Height of a wind turbine's hub above the baseplate, in plates, and how far forward of the lot's centre it sits (studs). */
export const TURBINE_HUB_PLATES = PLATE + PLATE + MAST_SECTIONS * MAST_SECTION_PLATES + NACELLE_PLATES / 2;
export const TURBINE_HUB_FORWARD = 0.9;

function windTurbine(): Blueprint {
  const b = new Builder();
  lot(b, COLOR.BRIGHT_GREEN);
  b.box(1, 1, 2, 2, PLATE, PLATE, COLOR.LIGHT_GREY);
  let y = PLATE + PLATE;
  for (let section = 0; section < MAST_SECTIONS; section++) { b.round(2, 2, MAST_DIAMETER, y, MAST_SECTION_PLATES, COLOR.WHITE, { studs: false }); y += MAST_SECTION_PLATES; }
  b.box(1.5, 1.4, 1, 1.4, y, NACELLE_PLATES, COLOR.WHITE, { studs: false });
  return b.finish();
}

function powerStation(): Blueprint {
  const b = new Builder();
  lot(b, COLOR.DARK_GREY);
  const HALL_DEPTH = 2, COOLER_PLATES = 9, COOLER_DIAMETER = 1.9, STACK_HEIGHT = 8;
  let y = PLATE;
  solidCourse(b, 0, 0, LOT, HALL_DEPTH, y, COLOR.DARK_TAN, false); y += BRICK;
  windowCourse(b, 0, 0, LOT, HALL_DEPTH, y, COLOR.DARK_TAN, COLOR.GLASS_SMOKE); y += BRICK;
  b.box(0, 0, LOT, HALL_DEPTH, y, PLATE, COLOR.DARK_GREY); y += PLATE;
  stack(b, 0, 0, y, STACK_HEIGHT);
  stack(b, 3, 0, y, STACK_HEIGHT - 2);
  b.round(1, 3, COOLER_DIAMETER, PLATE, COOLER_PLATES, COLOR.LIGHT_GREY, { studs: false });
  b.round(3, 3, COOLER_DIAMETER, PLATE, COOLER_PLATES, COLOR.LIGHT_GREY, { studs: false });
  b.round(1, 3, COOLER_DIAMETER - 0.4, PLATE + COOLER_PLATES, PLATE, COLOR.WHITE, { studs: false });
  b.round(3, 3, COOLER_DIAMETER - 0.4, PLATE + COOLER_PLATES, PLATE, COLOR.WHITE, { studs: false });
  return b.finish();
}

function waterTower(): Blueprint {
  const b = new Builder();
  lot(b, COLOR.BRIGHT_GREEN);
  const LEG_PLATES = 12, TANK_HEIGHT = 6, TANK_DIAMETER = 3.6, ROOF_PLATES = 3, LEG_STEP = 3;
  for (const [x, z] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) {
    for (let y = PLATE; y < PLATE + LEG_PLATES; y += LEG_STEP) b.round(x + 0.5, z + 0.5, 1, y, LEG_STEP, COLOR.DARK_GREY, { studs: false });
  }
  const top = PLATE + LEG_PLATES;
  b.box(0, 0, LOT, LOT, top, PLATE, COLOR.LIGHT_GREY, { studs: false });
  b.round(2, 2, TANK_DIAMETER, top + PLATE, TANK_HEIGHT / 2, COLOR.AZURE, { studs: false });
  b.round(2, 2, TANK_DIAMETER, top + PLATE + TANK_HEIGHT / 2, TANK_HEIGHT / 2, COLOR.WHITE, { studs: false });
  b.cone(2, 2, TANK_DIAMETER, top + PLATE + TANK_HEIGHT, ROOF_PLATES, COLOR.RED);
  return b.finish();
}

function park(seed: number): Blueprint {
  const b = new Builder();
  lot(b, COLOR.BRIGHT_GREEN);
  const POOL_DIAMETER = 2, WATER_DIAMETER = 1.5;
  // A round pond with a jet in the middle, a path to it, two trees and some flowers.
  b.round(2, 2, POOL_DIAMETER, PLATE, PLATE, COLOR.LIGHT_GREY, { studs: false });
  b.round(2, 2, WATER_DIAMETER, PLATE + PLATE, TILE_THIN, COLOR.GLASS_BLUE, { glass: true, studs: false });
  b.round(2, 2, 0.3, PLATE + PLATE, BRICK, COLOR.GLASS_ICE, { glass: true, studs: false });
  b.box(1.5, 3, 1, 1, PLATE, TILE_THIN, COLOR.TAN, { studs: false });
  tree(b, 0, 0, PLATE, 2, pick(LEAVES, seed, 1));
  tree(b, 3, 0, PLATE, 2, pick(LEAVES, seed, 2));
  b.round(0.5, 3.5, 1, PLATE, PLATE, COLOR.RED).round(3.5, 3.5, 1, PLATE, PLATE, COLOR.YELLOW);
  b.box(0, 2, 1, 1, PLATE, PLATE, COLOR.BROWN, { studs: false });
  return b.finish();
}

/** A two-storey public building at the back of its lot with a forecourt, which the caller then dresses. */
function hall(b: Builder, wall: number, band: number, roof: number, ground: number) {
  const DEPTH = 3;
  lot(b, ground);
  let y = PLATE;
  windowCourse(b, 0, 0, LOT, DEPTH, y, wall, COLOR.GLASS_ICE); y += BRICK;
  b.box(0, 0, LOT, DEPTH, y, PLATE, band); y += PLATE;
  windowCourse(b, 0, 0, LOT, DEPTH, y, wall, COLOR.GLASS_ICE); y += BRICK;
  b.box(0, 0, LOT, DEPTH, y, PLATE, roof, { studs: false }); y += PLATE;
  return y;
}

function school(): Blueprint {
  const b = new Builder(), FLAGPOLE_PLATES = 9;
  const y = hall(b, COLOR.DARK_RED, COLOR.YELLOW, COLOR.DARK_GREY, COLOR.TAN);
  // A bell on the roof and a flag in the yard.
  b.box(1, 1, 2, 1, y, BRICK, COLOR.YELLOW);
  b.round(0.5, 3.5, 0.3, PLATE, FLAGPOLE_PLATES, COLOR.LIGHT_GREY, { studs: false });
  b.box(0.6, 3.4, 1, 0.2, PLATE + FLAGPOLE_PLATES - 2, 2, COLOR.BLUE, { studs: false });
  return b.finish();
}

function clinic(): Blueprint {
  const b = new Builder();
  const y = hall(b, COLOR.WHITE, COLOR.AZURE, COLOR.WHITE, COLOR.LIGHT_GREY);
  // A red cross on the roof.
  b.box(0.5, 1, 3, 1, y, TILE_THIN, COLOR.RED, { studs: false });
  b.box(1.5, 0, 1, 1, y, TILE_THIN, COLOR.RED, { studs: false }).box(1.5, 2, 1, 1, y, TILE_THIN, COLOR.RED, { studs: false });
  return b.finish();
}

function policeStation(): Blueprint {
  const b = new Builder(), MAST_PLATES = 7;
  const y = hall(b, COLOR.WHITE, COLOR.BLUE, COLOR.DARK_BLUE, COLOR.LIGHT_GREY);
  // A blue lamp and a radio mast.
  b.round(1.5, 1.5, 1, y, PLATE, COLOR.DARK_GREY, { studs: false });
  b.round(1.5, 1.5, 0.8, y + PLATE, PLATE + PLATE, COLOR.GLASS_BLUE, { glass: true, studs: false });
  b.round(3.5, 0.5, 0.25, y, MAST_PLATES, COLOR.LIGHT_GREY, { studs: false });
  return b.finish();
}

function fireStation(): Blueprint {
  const b = new Builder(), DEPTH = 3, TOWER_STOREYS = 2;
  lot(b, COLOR.LIGHT_GREY);
  let y = PLATE;
  // Two engine bays on the ground floor.
  b.box(0, 0, LOT, DEPTH - 1, y, BRICK, COLOR.RED);
  b.box(0, DEPTH - 1, 1, 1, y, BRICK, COLOR.RED).box(LOT - 1, DEPTH - 1, 1, 1, y, BRICK, COLOR.RED);
  b.box(1, DEPTH - 1, 2, 1, y, BRICK, COLOR.WHITE); y += BRICK;
  b.box(0, 0, LOT, DEPTH, y, PLATE, COLOR.YELLOW); y += PLATE;
  windowCourse(b, 0, 0, LOT, DEPTH, y, COLOR.RED, COLOR.GLASS_ICE); y += BRICK;
  b.box(0, 0, LOT, DEPTH, y, PLATE, COLOR.DARK_GREY, { studs: false }); y += PLATE;
  // The hose tower.
  for (let storey = 0; storey < TOWER_STOREYS; storey++) { b.box(0, 0, 1, 1, y, BRICK, COLOR.RED); y += BRICK; }
  b.box(0, 0, 1, 1, y, PLATE, COLOR.YELLOW);
  return b.finish();
}

// --- Roads and trees --------------------------------------------------------------

const KERB_WIDTH = 0.5;
const KERB_PLATES = 0.5;
const DASH_WIDTH = 0.16;
const DASH_LENGTH = 1.2;
const DASH_PLATES = 0.06;
const DASH_STARTS = [0.4, 2.4] as const;
/** A bridge's piers reach this many plates below the baseplate, and its railings stand this tall. */
const PIER_PLATES = 3;
const PIER_DIAMETER = 1;
const RAILING_PLATES = 2;

const roads = new Map<number, Blueprint>();

/**
 * A road tile. `links` has bit f set where the neighbour in facing f is also
 * road: sides without a neighbour get a kerb, and a straight run gets a centre line.
 */
export function roadBlueprint(links: number, bridge: boolean): Blueprint {
  const key = links | (bridge ? 1 << DIR_COUNT : 0);
  let blueprint = roads.get(key);
  if (blueprint) return blueprint;
  const b = new Builder(), far = LOT - KERB_WIDTH;
  const linked = (facing: number) => (links & (1 << facing)) !== 0;
  if (bridge) {
    b.round(1, 2, PIER_DIAMETER, -PIER_PLATES, PIER_PLATES, COLOR.LIGHT_GREY, { studs: false });
    b.round(3, 2, PIER_DIAMETER, -PIER_PLATES, PIER_PLATES, COLOR.LIGHT_GREY, { studs: false });
  }
  b.box(0, 0, LOT, LOT, 0, PLATE, COLOR.ASPHALT, { studs: false });
  const kerb = bridge ? COLOR.WHITE : COLOR.LIGHT_GREY, height = bridge ? RAILING_PLATES : KERB_PLATES;
  if (!linked(0)) b.box(0, far, LOT, KERB_WIDTH, PLATE, height, kerb);
  if (!linked(2)) b.box(0, 0, LOT, KERB_WIDTH, PLATE, height, kerb);
  // Side kerbs stop short of the end kerbs so the two never overlap.
  const z0 = linked(2) ? 0 : KERB_WIDTH, z1 = linked(0) ? LOT : far;
  if (!linked(1)) b.box(far, z0, KERB_WIDTH, z1 - z0, PLATE, height, kerb);
  if (!linked(3)) b.box(0, z0, KERB_WIDTH, z1 - z0, PLATE, height, kerb);
  // Where two linked sides meet, the pavement turns the corner.
  for (let facing = 0; facing < DIR_COUNT; facing++) {
    const next = (facing + 1) % DIR_COUNT;
    if (!linked(facing) || !linked(next)) continue;
    const zSide = facing === 0 || next === 0 ? far : 0, xSide = facing === 1 || next === 1 ? far : 0;
    b.box(xSide, zSide, KERB_WIDTH, KERB_WIDTH, PLATE, height, kerb);
  }
  const alongZ = linked(0) && linked(2) && !linked(1) && !linked(3), alongX = linked(1) && linked(3) && !linked(0) && !linked(2);
  const middle = (LOT - DASH_WIDTH) / 2;
  for (const start of DASH_STARTS) {
    if (alongZ) b.box(middle, start, DASH_WIDTH, DASH_LENGTH, PLATE, DASH_PLATES, COLOR.WHITE);
    if (alongX) b.box(start, middle, DASH_LENGTH, DASH_WIDTH, PLATE, DASH_PLATES, COLOR.WHITE);
  }
  blueprint = b.finish();
  roads.set(key, blueprint);
  return blueprint;
}

const TREE_SPOTS = [[0, 1], [2, 0], [3, 2], [1, 3]] as const;
const woods = new Map<number, Blueprint>();

/** The clump of trees on an undeveloped tile; `look` is 1 or more. */
export function treeBlueprint(look: number): Blueprint {
  let blueprint = woods.get(look);
  if (blueprint) return blueprint;
  const b = new Builder(), count = 1 + (look % 3);
  for (let n = 0; n < count; n++) {
    const [x, z] = TREE_SPOTS[(look + n) % TREE_SPOTS.length];
    tree(b, x, z, 0, 1 + ((look + n) % 2), LEAVES[(look + n) % LEAVES.length]);
  }
  blueprint = b.finish();
  woods.set(look, blueprint);
  return blueprint;
}

// --- Lookup ----------------------------------------------------------------------

const SERVICE_BLUEPRINTS: Record<number, (seed: number) => Blueprint> = {
  [WIND]: windTurbine, [PLANT]: powerStation, [TOWER]: waterTower, [PARK]: park,
  [SCHOOL]: school, [CLINIC]: clinic, [POLICE]: policeStation, [FIRE]: fireStation,
};
const ZONE_BLUEPRINTS: Record<number, (level: number, seed: number) => Blueprint> = { [ZONE_R]: home, [ZONE_C]: shop, [ZONE_I]: works };

const VARIANT_BITS = 8, LEVEL_BITS = 4;
const buildings = new Map<number, Blueprint>();

/** The blueprint of a service (`structure`), or of the zoned building of `zone` and `level` when `structure` is 0. */
export function buildingBlueprint(structure: number, zone: number, level: number, variant: number): Blueprint {
  const key = (((structure << LEVEL_BITS | zone) << LEVEL_BITS | level) << VARIANT_BITS) | variant;
  let blueprint = buildings.get(key);
  if (blueprint) return blueprint;
  blueprint = structure ? SERVICE_BLUEPRINTS[structure](variant) : ZONE_BLUEPRINTS[zone](level, variant);
  buildings.set(key, blueprint);
  return blueprint;
}
