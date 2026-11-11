/**
 * Turns the city into bricks. Four sets, each refilled only when what it shows
 * has changed:
 *   baseplate  the ground tiles, their studs and the water (changes with the map; casts no shadow)
 *   fixtures   roads, bridges and trees (changes with the map)
 *   settled    finished buildings (changes when one is finished, replaced or cleared)
 *   sites      buildings part way up (changes most days, but there are few of them)
 *   moving     cars and turbine blades (every frame)
 *   needs      the flashing marks over buildings with no power or no water (every frame)
 * plus the glass preview of what the tool in hand would do.
 */
import * as THREE from 'three/webgpu';
import type { Plan, Tool } from '../game/actions.ts';
import { toolService } from '../game/actions.ts';
import { BOX, COLOR, TURBINE_HUB_FORWARD, TURBINE_HUB_PLATES, buildingBlueprint, roadBlueprint, treeBlueprint } from '../game/blueprints.ts';
import { AVENUE, DIR_COUNT, DIR_X, DIR_Z, NO_FACING, NONE, WATER, WIND, ZONE_C, ZONE_I, ZONE_NONE, ZONE_R, hasBuilding, isRoad, type City } from '../game/city.ts';
import { isComplete } from '../game/derive.ts';
import type { Traffic } from '../game/traffic.ts';
import { MAX_VEHICLES, PLATE_HEIGHT, TILE_STUDS } from '../game/tuning.ts';
import type { BrickMaterials } from '../render/brick-materials.ts';
import { BrickSet } from './brick-set.ts';
import { NeedIcons } from './need-icons.ts';

/** The baseplate is this many plates thick; water lies this many plates below the grass under a glass sheet. */
const BASE_PLATES = 3;
const WATER_DEPTH_PLATES = 2;
const WATER_SHEET_PLATES = 1;
const ZONE_TINT: Record<number, number> = { [ZONE_NONE]: COLOR.GREEN, [ZONE_R]: COLOR.ZONE_R, [ZONE_C]: COLOR.ZONE_C, [ZONE_I]: COLOR.ZONE_I };
const QUARTER_TURN = Math.PI / 2;
const TAU = Math.PI * 2;

// The table everything stands on.
const TABLE_RADIUS = 2600;
const TABLE_SEGMENTS = 64;
const TABLE_COLOR = '#c9d6d2';
const TABLE_ROUGHNESS = 0.85;

// A car, in studs: z is forward. Each part is [x, y, z, width, height, depth] from the middle of the car at road level.
const ROAD_TOP = PLATE_HEIGHT;
const CAR_WHEELS = [[-0.6, 0, 0.85], [0.6, 0, 0.85], [-0.6, 0, -0.85], [0.6, 0, -0.85]] as const;
const WHEEL_SIZE = [0.3, 0.5, 0.6] as const;
const CAR_BODY = [0, 0.22, 0, 1.3, 0.5, 2.7] as const;
const CAR_CABIN = [0, 0.72, -0.2, 1.15, 0.45, 1.3] as const;
const CAR_ROOF = [0, 1.17, -0.2, 1.2, 0.12, 1.35] as const;
/** How quickly a car's drawn heading follows its real one (per second), so it swings through a bend. */
const TURN_RATE = 9;

// A wind turbine's rotor.
const BLADES = 3;
const BLADE_LENGTH = 4.4;
const BLADE_WIDTH = 0.42;
const BLADE_THICKNESS = 0.14;
const HUB_SIZE = 0.6;
/** Radians per second, and the phase each turbine starts at per tile index so they are not in step. */
const ROTOR_SPEED = 1.7;
const ROTOR_PHASE = 0.61;

// The preview.
const PREVIEW_PLATES = 1;
const PREVIEW_LIFT = 0.1;
/** A preview box over something built stands this many plates clear of its top. */
const PREVIEW_HEADROOM = 1;
const PREVIEW_INSET = 0.3;
const TOOL_PREVIEW: Partial<Record<Tool, number>> = {
  inspect: COLOR.GLASS_CLEAR, road: COLOR.BLACK, avenue: COLOR.BLACK, homes: COLOR.LIME, shops: COLOR.AZURE, industry: COLOR.YELLOW,
  dezone: COLOR.GLASS_CLEAR, bulldoze: COLOR.ORANGE,
};
const PREVIEW_BLOCKED = COLOR.RED;
const PREVIEW_SERVICE = COLOR.GLASS_BLUE;

/** Multipliers and field width in the checksums of which tiles are built on and what stands finished on them. */
const MARK_STEP = 0x9e3779b1;
const MARK_STEP_2 = 0x85ebca6b;
const LOOK_SHIFT = 8;

const BASEPLATE_CAPACITY = 4096;
const FIXTURE_CAPACITY = 1024;
const BUILDING_CAPACITY = 4096;
const MOVING_CAPACITY = MAX_VEHICLES * 4;
const PREVIEW_CAPACITY = 256;

const UP = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(0, 0, 1);
const position = new THREE.Vector3(), scale = new THREE.Vector3(), turnY = new THREE.Quaternion(), spin = new THREE.Quaternion();
const rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();

export class CityView {
  readonly group = new THREE.Group();
  private readonly baseplate: BrickSet;
  private readonly fixtures: BrickSet;
  private readonly settled: BrickSet;
  private readonly sites: BrickSet;
  private readonly moving: BrickSet;
  private readonly preview: BrickSet;
  readonly needs: NeedIcons;
  private readonly table: THREE.Mesh;
  /** How many tiles are built on and a checksum of which, to notice a lot gaining or losing its first brick. */
  private built = -1;
  private builtMark = 0;
  private finishedMark = 0;
  private revision = -1;
  private buildRevision = -1;
  private city: City | null = null;
  private readonly headings = new Float32Array(MAX_VEHICLES);
  private readonly wasActive = new Uint8Array(MAX_VEHICLES);
  /** World x and z of the corner of tile (0, 0). */
  private origin = 0;

  constructor(materials: BrickMaterials, tiles: number) {
    this.needs = new NeedIcons(tiles);
    this.baseplate = new BrickSet(materials, { shadows: false, capacity: BASEPLATE_CAPACITY, seamless: true });
    this.fixtures = new BrickSet(materials, { shadows: true, capacity: FIXTURE_CAPACITY });
    this.settled = new BrickSet(materials, { shadows: true, capacity: BUILDING_CAPACITY, windows: true });
    this.sites = new BrickSet(materials, { shadows: true, capacity: FIXTURE_CAPACITY, windows: true });
    this.moving = new BrickSet(materials, { shadows: true, capacity: MOVING_CAPACITY });
    this.preview = new BrickSet(materials, { shadows: false, capacity: PREVIEW_CAPACITY });
    const table = new THREE.Mesh(
      new THREE.CircleGeometry(TABLE_RADIUS, TABLE_SEGMENTS).rotateX(-QUARTER_TURN),
      new THREE.MeshStandardNodeMaterial({ color: TABLE_COLOR, roughness: TABLE_ROUGHNESS, metalness: 0 }),
    );
    table.position.y = -BASE_PLATES * PLATE_HEIGHT;
    table.receiveShadow = true;
    this.table = table;
    this.group.add(table, this.baseplate.group, this.fixtures.group, this.settled.group, this.sites.group, this.moving.group, this.preview.group, this.needs.group);
  }

  /** World position of the middle of a tile, on the ground. */
  tileCentre(city: City, x: number, z: number, out: THREE.Vector3) {
    const origin = -city.size * TILE_STUDS / 2;
    return out.set(origin + (x + 0.5) * TILE_STUDS, 0, origin + (z + 0.5) * TILE_STUDS);
  }

  /** Brings the drawn city up to date with the simulated one. Cheap when nothing has changed. */
  sync(city: City) {
    this.origin = -city.size * TILE_STUDS / 2;
    if (city !== this.city) { this.city = city; this.revision = -1; this.buildRevision = -1; this.built = -1; this.wasActive.fill(0); }
    if (city.revision !== this.revision) { this.revision = city.revision; this.drawGround(city); }
    if (city.buildRevision !== this.buildRevision) { this.buildRevision = city.buildRevision; this.drawBuildings(city); }
  }

  private drawGround(city: City) {
    const { size, structure, terrain, zone, tree } = city, { baseplate, fixtures } = this;
    baseplate.begin(); fixtures.begin();
    const base = BASE_PLATES * PLATE_HEIGHT, bed = WATER_DEPTH_PLATES * PLATE_HEIGHT, sheet = WATER_SHEET_PLATES * PLATE_HEIGHT;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = z * size + x, lotX = this.origin + x * TILE_STUDS, lotZ = this.origin + z * TILE_STUDS;
        const midX = lotX + TILE_STUDS / 2, midZ = lotZ + TILE_STUDS / 2;
        if (terrain[i] === WATER) {
          baseplate.add(BOX, false, midX, -base, midZ, TILE_STUDS, base - bed, TILE_STUDS, 0, COLOR.BLUE);
          baseplate.add(BOX, true, midX, -bed, midZ, TILE_STUDS, sheet, TILE_STUDS, 0, COLOR.GLASS_ICE);
        } else {
          const tint = structure[i] === NONE ? ZONE_TINT[zone[i]] : COLOR.GREEN;
          baseplate.add(BOX, false, midX, -base, midZ, TILE_STUDS, base, TILE_STUDS, 0, tint);
          // Studs show only where nothing has been pressed down on top of them.
          if (structure[i] === NONE && !hasBuilding(city, i)) {
            for (let sz = 0; sz < TILE_STUDS; sz++) for (let sx = 0; sx < TILE_STUDS; sx++) baseplate.stud(lotX + sx + 0.5, 0, lotZ + sz + 0.5, tint, false);
          }
        }
        if (isRoad(structure[i])) {
          let links = 0;
          for (let facing = 0; facing < DIR_COUNT; facing++) {
            const nx = x + DIR_X[facing], nz = z + DIR_Z[facing];
            if (nx >= 0 && nz >= 0 && nx < size && nz < size && isRoad(structure[nz * size + nx])) links |= 1 << facing;
          }
          fixtures.blueprint(roadBlueprint(links, terrain[i] === WATER, structure[i] === AVENUE), lotX, lotZ, 0);
        } else if (tree[i] && !hasBuilding(city, i)) {
          fixtures.blueprint(treeBlueprint(tree[i]), lotX, lotZ, 0);
        }
      }
    }
    baseplate.end(); fixtures.end();
  }

  private drawBuildings(city: City) {
    const { size } = city, { settled, sites } = this, tiles = size * size;
    // One pass to see what is built and what is finished, as two checksums.
    let built = 0, builtMark = 0, finishedMark = 0;
    for (let i = 0; i < tiles; i++) {
      if (!hasBuilding(city, i)) continue;
      built++; builtMark = (builtMark + i * MARK_STEP) | 0;
      if (isComplete(city, i)) {
        const look = ((city.structure[i] << LOOK_SHIFT | city.level[i]) << LOOK_SHIFT | city.variant[i]) << LOOK_SHIFT | city.facing[i];
        finishedMark = (finishedMark + Math.imul(i + 1, MARK_STEP) ^ Math.imul(look + 1, MARK_STEP_2)) | 0;
      }
    }
    const redrawSettled = finishedMark !== this.finishedMark || built !== this.built || builtMark !== this.builtMark;
    if (redrawSettled) settled.begin();
    sites.begin();
    for (let i = 0; i < tiles; i++) {
      if (!hasBuilding(city, i)) continue;
      const finished = isComplete(city, i);
      if (finished && !redrawSettled) continue;
      const x = i % size, z = (i - x) / size;
      const blueprint = buildingBlueprint(city.structure[i], city.zone[i], city.level[i], city.variant[i]);
      (finished ? settled : sites).blueprint(blueprint, this.origin + x * TILE_STUDS, this.origin + z * TILE_STUDS, city.facing[i], city.progress[i]);
    }
    if (redrawSettled) settled.end();
    sites.end();
    this.finishedMark = finishedMark;
    // A lot loses its baseplate studs the day its first brick goes down, and gets them back when it is cleared.
    if (built !== this.built || builtMark !== this.builtMark) { this.built = built; this.builtMark = builtMark; this.drawGround(city); }
  }

  /** Cars and turbine rotors, drawn afresh every frame. `seconds` is the time on the animation clock. */
  animate(city: City, traffic: Traffic, seconds: number, dt: number) {
    const { moving } = this, { size } = city;
    moving.begin();
    const ease = 1 - Math.exp(-TURN_RATE * dt);
    traffic.vehicles.forEach((vehicle, n) => {
      if (!vehicle.active) { this.wasActive[n] = 0; return; }
      const heading = Math.atan2(vehicle.dirX, vehicle.dirZ);
      if (!this.wasActive[n]) { this.headings[n] = heading; this.wasActive[n] = 1; }
      // Ease the short way round.
      let turn = heading - this.headings[n];
      turn -= Math.round(turn / TAU) * TAU;
      this.headings[n] += turn * ease;
      this.car(this.origin + vehicle.x, this.origin + vehicle.z, this.headings[n], vehicle.color);
    });
    for (let i = 0; i < size * size; i++) {
      if (city.structure[i] !== WIND || !isComplete(city, i)) continue;
      const x = i % size, z = (i - x) / size, facing = city.facing[i] === NO_FACING ? 0 : city.facing[i];
      this.rotor(
        this.origin + (x + 0.5) * TILE_STUDS + DIR_X[facing] * TURBINE_HUB_FORWARD, this.origin + (z + 0.5) * TILE_STUDS + DIR_Z[facing] * TURBINE_HUB_FORWARD,
        facing * QUARTER_TURN, seconds * ROTOR_SPEED + i * ROTOR_PHASE,
      );
    }
    moving.end();
  }

  private car(x: number, z: number, heading: number, color: number) {
    const { moving } = this, sin = Math.sin(heading), cos = Math.cos(heading);
    const part = (shape: number, glass: boolean, px: number, py: number, pz: number, w: number, h: number, d: number, tint: number) => {
      moving.add(shape, glass, x + px * cos + pz * sin, ROAD_TOP + py, z - px * sin + pz * cos, w, h, d, heading, tint);
    };
    for (const [wx, wy, wz] of CAR_WHEELS) part(BOX, false, wx, wy, wz, WHEEL_SIZE[0], WHEEL_SIZE[1], WHEEL_SIZE[2], COLOR.BLACK);
    part(BOX, false, CAR_BODY[0], CAR_BODY[1], CAR_BODY[2], CAR_BODY[3], CAR_BODY[4], CAR_BODY[5], color);
    part(BOX, true, CAR_CABIN[0], CAR_CABIN[1], CAR_CABIN[2], CAR_CABIN[3], CAR_CABIN[4], CAR_CABIN[5], COLOR.GLASS_ICE);
    part(BOX, false, CAR_ROOF[0], CAR_ROOF[1], CAR_ROOF[2], CAR_ROOF[3], CAR_ROOF[4], CAR_ROOF[5], color);
    moving.stud(x + CAR_ROOF[2] * sin, ROAD_TOP + CAR_ROOF[1] + CAR_ROOF[4], z + CAR_ROOF[2] * cos, color, false);
  }

  private rotor(x: number, z: number, yaw: number, angle: number) {
    const { moving } = this, y = TURBINE_HUB_PLATES * PLATE_HEIGHT;
    turnY.setFromAxisAngle(UP, yaw);
    moving.add(BOX, false, x, y - HUB_SIZE / 2, z, HUB_SIZE, HUB_SIZE, HUB_SIZE, yaw, COLOR.LIGHT_GREY);
    for (let blade = 0; blade < BLADES; blade++) {
      // The unit box stands on its base, so scaling it gives a blade that grows out from the hub; then spin it, then face it.
      spin.setFromAxisAngle(FORWARD, angle + blade * TAU / BLADES);
      rotation.copy(turnY).multiply(spin);
      position.set(x, y, z); scale.set(BLADE_WIDTH, BLADE_LENGTH, BLADE_THICKNESS);
      moving.addMatrix(BOX, false, matrix.compose(position, rotation, scale), COLOR.WHITE);
    }
  }

  /** Shows what the tool would do over the plan's tiles, in glass; a null plan clears it. */
  showPreview(city: City, tool: Tool, plan: Plan | null) {
    const { preview } = this, { size } = city;
    preview.begin();
    if (plan) {
      const service = toolService(tool), tint = TOOL_PREVIEW[tool] ?? PREVIEW_SERVICE;
      plan.tiles.forEach((i, n) => {
        const x = i % size, z = (i - x) / size, lotX = this.origin + x * TILE_STUDS, lotZ = this.origin + z * TILE_STUDS;
        const applies = plan.changes[n] && plan.ok;
        if (service !== undefined && applies) {
          const facing = city.frontDir[i];
          preview.blueprint(buildingBlueprint(service, ZONE_NONE, 0, 0), lotX, lotZ, facing, Infinity, tint);
          return;
        }
        // Over something built, the box stands clear of it so it can be seen from any side.
        let top = PREVIEW_PLATES;
        if (hasBuilding(city, i)) top = buildingBlueprint(city.structure[i], city.zone[i], city.level[i], city.variant[i]).height + PREVIEW_HEADROOM;
        else if (isRoad(city.structure[i])) top = PREVIEW_PLATES + PREVIEW_HEADROOM;
        const blocked = !applies && tool !== 'inspect';
        // A tile the tool would leave alone is not marked, unless the whole plan is refused.
        if (blocked && plan.ok) return;
        preview.add(
          BOX, true, lotX + TILE_STUDS / 2, PREVIEW_LIFT, lotZ + TILE_STUDS / 2, TILE_STUDS - PREVIEW_INSET, top * PLATE_HEIGHT, TILE_STUDS - PREVIEW_INSET,
          0, blocked ? PREVIEW_BLOCKED : tint,
        );
      });
    }
    preview.end();
  }

  dispose() {
    for (const set of [this.baseplate, this.fixtures, this.settled, this.sites, this.moving, this.preview]) set.dispose();
    this.needs.dispose();
    this.table.geometry.dispose(); (this.table.material as THREE.Material).dispose();
  }
}
