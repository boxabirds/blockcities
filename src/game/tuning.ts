/**
 * Every gameplay number. The simulation is in days; the frame loop turns
 * seconds into days at the chosen speed.
 */

// --- Map and brick dimensions --------------------------------------------------

/** Tiles along each side of the square map. */
export const MAP_SIZE = 48;
/** One tile is a 4×4 stud lot. One world unit is one stud pitch. */
export const TILE_STUDS = 4;
/** A plate is 0.4 stud pitches tall, and a brick is three plates (3.2 mm and 9.6 mm on an 8 mm pitch). */
export const PLATE_HEIGHT = 0.4;
export const BRICK_PLATES = 3;
/** Stud diameter and height in stud pitches (4.8 mm and 1.7 mm on an 8 mm pitch). */
export const STUD_DIAMETER = 0.6;
export const STUD_HEIGHT = 0.2125;

// --- Time ----------------------------------------------------------------------

/** Days simulated per second at each speed setting; index 0 is paused. */
export const SPEED_DAYS_PER_SECOND = [0, 2, 5, 12] as const;
export const DEFAULT_SPEED = 1;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
/** A frame never simulates more than this many days, so a hitch cannot stall the page. */
export const MAX_DAYS_PER_FRAME = 4;
export const AUTOSAVE_DAYS = 15;

// --- Money ---------------------------------------------------------------------

export const START_MONEY = 20_000;
export const ROAD_COST = 10;
export const BRIDGE_COST = 60;
export const BULLDOZE_COST = 3;
/** Daily upkeep of one road tile and one bridge tile. */
export const ROAD_UPKEEP = 0.04;
export const BRIDGE_UPKEEP = 0.2;
/** Tax rate in percent: the starting rate and the range the slider allows. */
export const DEFAULT_TAX = 9;
export const MIN_TAX = 0;
export const MAX_TAX = 20;
/** Demand lost (in demand units, where 1 is full) for each point of tax above the default. */
export const TAX_DEMAND_PER_POINT = 0.08;

// --- Growth --------------------------------------------------------------------

/** A lot develops when a road is within this many tiles (Manhattan). */
export const ROAD_REACH = 2;
/** Bricks added to every building under construction each day. */
export const BRICKS_PER_DAY = 5;
/** Share of zoned lots looked at each day for growth or decline, and the fewest looked at. */
export const GROWTH_SAMPLE_FRACTION = 0.07;
export const MIN_GROWTH_SAMPLES = 3;
/** Chance an empty lot is built on when looked at, per unit of demand. */
export const SPAWN_RATE = 0.9;
/** Chance a finished building is replaced by the next level, per unit of demand. */
export const UPGRADE_RATE = 0.22;
/** Below this demand buildings start to shrink, each with this chance when looked at. */
export const DECLINE_DEMAND = -0.3;
export const DECLINE_RATE = 0.12;
/** Days without road, power or water after which a building is abandoned and cleared. */
export const ABANDON_DAYS = 20;

/** Share of residents who work, split between shops and industry. */
export const COMMERCIAL_JOBS_PER_RESIDENT = 0.3;
export const INDUSTRIAL_JOBS_PER_RESIDENT = 0.2;
export const WORKFORCE_SHARE = COMMERCIAL_JOBS_PER_RESIDENT + INDUSTRIAL_JOBS_PER_RESIDENT;
/** Homes always wanted beyond the jobs on offer: a fixed number plus a share of the population. */
export const STARTER_HOMES = 30;
export const NEWCOMER_SHARE = 0.05;
/** Need is divided by this to give demand: a floor, and a share of the population above it. */
export const MIN_DEMAND_SCALE = 40;
export const DEMAND_SCALE_SHARE = 0.1;

/** Land value a lot needs for each level (index is the level). */
export const LAND_GATES = [0, -0.3, 0.15, 0.4, 0.6, 0.85] as const;
/** City population needed before homes and shops of each level appear. */
export const POPULATION_GATES = [0, 0, 120, 600, 2500, 8000] as const;
/** City population needed before industry of each level appears. */
export const INDUSTRY_GATES = [0, 0, 400, 2500] as const;

// --- Pollution -----------------------------------------------------------------

/** Pollution at the source for industry of each level, and how far it spreads in tiles. */
export const INDUSTRY_POLLUTION = [0, 0.5, 0.8, 1.1] as const;
export const INDUSTRY_POLLUTION_RADIUS = 5;
/** How much of the pollution on a lot counts against its land value, by zone (none, R, C, I). */
export const POLLUTION_WEIGHT = [0, 1, 0.5, 0] as const;

// --- Traffic (drawn only; it does not feed back into the simulation) ------------

export const MAX_VEHICLES = 160;
/** One vehicle is on the road for this many residents. */
export const RESIDENTS_PER_VEHICLE = 12;
/** Vehicle speed in tiles per second, and the fewest vehicles started per second. */
export const VEHICLE_SPEED = 1.6;
export const VEHICLE_SPAWNS_PER_SECOND = 6;
/** Distance of a lane's centre line from the middle of the road, in studs. */
export const LANE_OFFSET = 0.9;
