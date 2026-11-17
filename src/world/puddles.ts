/**
 * Puddles on the roads and what cars do to them. Where the puddles lie is decided here from the city's roads and
 * written into the PuddleField the shader draws from; a car whose wheels are in one stirs it up and throws spray.
 *
 * The spray follows Jellyland's water spray (src/water/spray.ts there): a fixed pool of clear drops, bright at the
 * rim, each drawn as a streak along its path, falling under gravity. Only the drops are taken; a puddle is too
 * shallow for the crown and jet a pond throws up.
 */
import * as THREE from 'three/webgpu';
import { clamp, float, normalView, positionViewDirection, pow } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { WATER, isRoad, type City } from '../game/city.ts';
import type { Traffic } from '../game/traffic.ts';
import { PLATE_HEIGHT, TILE_STUDS, VEHICLE_SPEED } from '../game/tuning.ts';
import type { PuddleField } from '../render/puddle-field.ts';

/** A puddle's middle is kept this far inside its tile, and its full radius is between these (studs). */
const MIDDLE_MARGIN = 1.3;
const RADIUS = [0.9, 1.75] as const;
/** Multipliers of the hash that decides, tile by tile, whether there is a puddle and what it is like. */
const HASH_A = 0x9e3779b1, HASH_B = 0x85ebca6b, HASH_C = 0xc2b2ae35;
const HASH_RANGE = 2 ** 32;

const MAX_DROPS = 500;
/** Studs a second squared: bricks are small, so things fall fast for their size. */
const GRAVITY = 34;
/** A car's wheels are this far out from its middle and this far ahead of and behind it (studs). */
const WHEEL_OUT = 0.6;
const WHEEL_ALONG = 0.85;
/** Drops thrown per second by each wheel in the water at full spray, and how they leave: outward, upward and back (studs a second), each with this much scatter. */
const DROPS_PER_WHEEL = 34;
const THROW_OUT = 3.4;
const THROW_UP = 4.2;
const THROW_BACK = 1.6;
const SCATTER = 0.55;
const DROP_RADIUS = [0.028, 0.06] as const;
/** A drop is stretched along its path by this much for each stud a second. */
const STRETCH = 0.035;
const DROP_COLOR = '#e8f4ff';
const DROP_OPACITY = 0.75;
const ROAD_TOP = PLATE_HEIGHT;
const UP = new THREE.Vector3(0, 1, 0);

function hash(tile: number, salt: number) {
  let h = Math.imul(tile + 1, HASH_A) ^ Math.imul(salt + 1, HASH_B);
  h = Math.imul(h ^ (h >>> 15), HASH_C);
  return ((h ^ (h >>> 13)) >>> 0) / HASH_RANGE;
}

/** Lays a puddle on a share (`cover`, 0 to 1) of the city's road tiles. Which tiles, and what each is like, never changes for a given tile. */
export function layPuddles(city: City, field: PuddleField, cover: number) {
  field.clear();
  for (let tile = 0; tile < city.size * city.size; tile++) {
    if (!isRoad(city.structure[tile]) || city.terrain[tile] === WATER || hash(tile, 0) >= cover) continue;
    const span = TILE_STUDS - 2 * MIDDLE_MARGIN;
    field.set(tile, MIDDLE_MARGIN + hash(tile, 1) * span, MIDDLE_MARGIN + hash(tile, 2) * span, RADIUS[0] + hash(tile, 3) * (RADIUS[1] - RADIUS[0]));
  }
}

type Drop = { alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; radius: number };

export class Splashes {
  readonly mesh: THREE.InstancedMesh;
  /** Drops in the air after the last update, and wheels found in water during it: for the automation hook and tests. */
  airborne = 0;
  wheelsInWater = 0;
  private readonly drops: Drop[] = Array.from({ length: MAX_DROPS }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0 }));
  private next = 0;
  private owed = 0;
  private state = 20261112;
  private readonly material: THREE.MeshStandardNodeMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();

  constructor() {
    const material = new THREE.MeshStandardNodeMaterial({ color: DROP_COLOR, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false });
    // Clear in the middle, bright at the rim, as a drop of water is.
    const rim = float(1).sub(normalView.dot(positionViewDirection).abs());
    material.emissiveNode = pow(rim, 2.2).mul(0.9) as unknown as Node<'color'>;
    material.opacityNode = clamp(float(DROP_OPACITY).mul(float(0.4).add(pow(rim, 1.4).mul(1.3))), 0, 1);
    this.material = material;
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), material, MAX_DROPS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.count = 0; this.mesh.visible = false;
  }

  private random() { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state / HASH_RANGE; }

  private throwDrop(x: number, z: number, outX: number, outZ: number, backX: number, backZ: number) {
    const drop = this.drops[this.next];
    this.next = (this.next + 1) % MAX_DROPS;
    const scatter = () => 1 + (this.random() * 2 - 1) * SCATTER;
    const out = THROW_OUT * scatter(), back = THROW_BACK * scatter();
    drop.alive = true; drop.x = x; drop.y = ROAD_TOP; drop.z = z;
    drop.vx = outX * out + backX * back; drop.vz = outZ * out + backZ * back; drop.vy = THROW_UP * scatter();
    drop.radius = DROP_RADIUS[0] + this.random() * (DROP_RADIUS[1] - DROP_RADIUS[0]);
  }

  /**
   * Moves the spray on by `dt`, and lets every car with a wheel in a puddle stir it and throw more. `grown` is how far
   * the puddles have spread (0 to 1 and beyond, as the shader has it), `spray` how much is thrown (0 none to 1).
   */
  update(dt: number, city: City, traffic: Traffic, field: PuddleField, grown: number, spray: number) {
    const origin = -city.size * TILE_STUDS / 2;
    let wheels = 0;
    if (grown > 0) {
      this.owed += dt * DROPS_PER_WHEEL * spray;
      const each = Math.floor(this.owed);
      this.owed -= each;
      for (const vehicle of traffic.vehicles) {
        if (!vehicle.active) continue;
        // A car's right is its heading turned a quarter turn: for heading (dx, dz), (dz, -dx).
        const rightX = vehicle.dirZ, rightZ = -vehicle.dirX;
        for (const along of [WHEEL_ALONG, -WHEEL_ALONG]) {
          for (const side of [1, -1]) {
            const x = vehicle.x + vehicle.dirX * along + rightX * side * WHEEL_OUT, z = vehicle.z + vehicle.dirZ * along + rightZ * side * WHEEL_OUT;
            const tileX = Math.floor(x / TILE_STUDS), tileZ = Math.floor(z / TILE_STUDS);
            if (tileX < 0 || tileZ < 0 || tileX >= city.size || tileZ >= city.size) continue;
            const tile = tileZ * city.size + tileX;
            if (field.reach(tile, x - tileX * TILE_STUDS, z - tileZ * TILE_STUDS, grown) >= 1) continue;
            wheels++;
            field.stir(tile, 1);
            for (let n = 0; n < each; n++) this.throwDrop(origin + x, origin + z, rightX * side, rightZ * side, -vehicle.dirX, -vehicle.dirZ);
          }
        }
      }
    }
    this.wheelsInWater = wheels;
    field.update(dt);

    let live = 0;
    const { matrix, position, direction, turn, scale } = this;
    for (const drop of this.drops) {
      if (!drop.alive) continue;
      drop.vy -= GRAVITY * dt;
      drop.x += drop.vx * dt; drop.y += drop.vy * dt; drop.z += drop.vz * dt;
      if (drop.y < ROAD_TOP) { drop.alive = false; continue; }
      const speed = Math.hypot(drop.vx, drop.vy, drop.vz);
      direction.set(drop.vx, drop.vy, drop.vz).divideScalar(speed || 1);
      turn.setFromUnitVectors(UP, direction);
      // A streak along its path: longer the faster it goes.
      scale.set(drop.radius, drop.radius + STRETCH * speed, drop.radius);
      matrix.compose(position.set(drop.x, drop.y, drop.z), turn, scale).toArray(this.mesh.instanceMatrix.array, live++ * matrix.elements.length);
    }
    this.mesh.count = live; this.mesh.visible = live > 0;
    if (live > 0) this.mesh.instanceMatrix.needsUpdate = true;
    this.airborne = live;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/** How far a car travels in a second, in studs: for callers that want to scale spray by speed. */
export const CAR_STUDS_PER_SECOND = VEHICLE_SPEED * TILE_STUDS;
