/**
 * Draws bricks. Every brick is one instance of one of four unit shapes, scaled
 * to its size; a stud is a small cylinder. A set holds one instanced mesh per
 * shape and material, refilled from scratch whenever what it shows changes.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOX, CONE, CYLINDER, PALETTE, SHAPE_COUNT, SLOPE, type Blueprint } from '../game/blueprints.ts';
import { NO_FACING } from '../game/city.ts';
import { PLATE_HEIGHT, STUD_DIAMETER, STUD_HEIGHT, TILE_STUDS } from '../game/tuning.ts';
import type { BrickMaterials } from '../render/brick-materials.ts';

const CYLINDER_SEGMENTS = 14;
const CONE_SEGMENTS = 14;
/** Height of the upright lip at the low edge of a slope, as a share of its height. */
const SLOPE_LIP = 0.14;
/** Bricks are drawn this much short of their footprint and height (studs), so the joints between them show. */
const SEAM = 0.035;
const QUARTER_TURN = Math.PI / 2;
const HALF_LOT = TILE_STUDS / 2;
const MATRIX_SIZE = 16;
const COLOR_SIZE = 3;
const GROWTH = 2;

function boxGeometry() { return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); }

/** An upright cylinder with a top and no bottom: bricks stand on something, and studs are many. */
function cylinderGeometry() {
  const side = new THREE.CylinderGeometry(0.5, 0.5, 1, CYLINDER_SEGMENTS, 1, true).translate(0, 0.5, 0);
  const top = new THREE.CircleGeometry(0.5, CYLINDER_SEGMENTS).rotateX(-QUARTER_TURN).translate(0, 1, 0);
  const merged = mergeGeometries([side, top]);
  side.dispose(); top.dispose();
  return merged;
}

/** A wedge: full height along its -z edge, down to a short lip along +z. */
function slopeGeometry() {
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
  const E = [-0.5, 1, -0.5], F = [0.5, 1, -0.5], G = [0.5, SLOPE_LIP, 0.5], H = [-0.5, SLOPE_LIP, 0.5];
  // Each face counter-clockwise seen from outside.
  const faces = [[B, A, E, F], [D, C, G, H], [H, G, F, E], [C, B, F, G], [A, D, H, E], [A, B, C, D]];
  const positions: number[] = [];
  for (const [a, b, c, d] of faces) positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function coneGeometry() { return new THREE.ConeGeometry(0.5, 1, CONE_SEGMENTS).translate(0, 0.5, 0); }

const GEOMETRY_MAKERS: Record<number, () => THREE.BufferGeometry> = {
  [BOX]: boxGeometry, [CYLINDER]: cylinderGeometry, [SLOPE]: slopeGeometry, [CONE]: coneGeometry,
};
const geometries: THREE.BufferGeometry[] = [];
function geometryOf(shape: number) { return geometries[shape] ??= GEOMETRY_MAKERS[shape](); }

/** The brick palette in the renderer's working colour space. */
export const BRICK_COLORS: readonly THREE.Color[] = PALETTE.map(hex => new THREE.Color(hex));

/** One instanced mesh that can be refilled and grows when it runs out of room. */
class Batch {
  mesh: THREE.InstancedMesh;
  private capacity: number;
  private count = 0;
  private readonly parent: THREE.Group;
  private readonly shadows: boolean;

  constructor(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadows: boolean) {
    this.parent = parent; this.capacity = capacity; this.shadows = shadows;
    this.mesh = this.create(geometry, material, capacity);
  }

  private create(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * COLOR_SIZE), COLOR_SIZE);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Instances are everywhere on the map; a bounding sphere computed once would be wrong after the first refill.
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadows; mesh.receiveShadow = true;
    mesh.count = 0; mesh.visible = false;
    this.parent.add(mesh);
    return mesh;
  }

  begin() { this.count = 0; }

  push(matrix: THREE.Matrix4, color: THREE.Color) {
    if (this.count === this.capacity) this.grow();
    matrix.toArray(this.mesh.instanceMatrix.array, this.count * MATRIX_SIZE);
    color.toArray(this.mesh.instanceColor!.array, this.count * COLOR_SIZE);
    this.count++;
  }

  private grow() {
    const old = this.mesh, capacity = this.capacity * GROWTH;
    const mesh = this.create(old.geometry, old.material as THREE.Material, capacity);
    (mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    (mesh.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array);
    this.parent.remove(old); old.dispose();
    this.mesh = mesh; this.capacity = capacity;
  }

  end() {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose() { this.parent.remove(this.mesh); this.mesh.dispose(); }
}

export type BrickSetOptions = {
  /** Whether these bricks cast shadows. */
  shadows: boolean;
  /** Instances to make room for at first, for each shape. */
  capacity: number;
  /** Draw bricks at their full size, with no joints showing. */
  seamless?: boolean;
  /** Glass here is windows, which glow at night. */
  windows?: boolean;
};

const position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion(), matrix = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class BrickSet {
  readonly group = new THREE.Group();
  private readonly materials: BrickMaterials;
  private readonly options: BrickSetOptions;
  /** Indexed by shape, then again offset by SHAPE_COUNT for glass; made the first time each is needed. */
  private readonly batches: (Batch | undefined)[] = [];
  private readonly seam: number;

  constructor(materials: BrickMaterials, options: BrickSetOptions) {
    this.materials = materials; this.options = options; this.seam = options.seamless ? 0 : SEAM;
  }

  private batch(shape: number, glass: boolean) {
    const slot = shape + (glass ? SHAPE_COUNT : 0);
    return this.batches[slot] ??= new Batch(
      this.group, geometryOf(shape), glass ? (this.options.windows ? this.materials.windowGlass : this.materials.glass) : this.materials.plastic, this.options.capacity, this.options.shadows,
    );
  }

  begin() { for (const batch of this.batches) batch?.begin(); }
  end() { for (const batch of this.batches) batch?.end(); }

  /** A unit shape under any transform. */
  addMatrix(shape: number, glass: boolean, transform: THREE.Matrix4, color: number) {
    this.batch(shape, glass).push(transform, BRICK_COLORS[color]);
  }

  /** A brick whose base is centred on (x, y, z), `w` by `h` by `d` world units, turned `yaw` radians about the vertical. */
  add(shape: number, glass: boolean, x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, color: number) {
    position.set(x, y, z);
    scale.set(Math.max(w - this.seam, w / 2), Math.max(h - this.seam, h / 2), Math.max(d - this.seam, d / 2));
    quaternion.setFromAxisAngle(UP, yaw);
    this.addMatrix(shape, glass, matrix.compose(position, quaternion, scale), color);
  }

  /** A stud standing on a surface at height y. */
  stud(x: number, y: number, z: number, color: number, glass: boolean) {
    position.set(x, y - this.seam, z); scale.set(STUD_DIAMETER, STUD_HEIGHT, STUD_DIAMETER); quaternion.identity();
    this.addMatrix(CYLINDER, glass, matrix.compose(position, quaternion, scale), color);
  }

  /**
   * The first `limit` bricks of a blueprint on the lot whose corner is at world (lotX, lotZ), turned to `facing`.
   * With `ghost` set, every brick is drawn in that colour of glass and without studs: a preview.
   */
  blueprint(blueprint: Blueprint, lotX: number, lotZ: number, facing: number, limit = Infinity, ghost = -1) {
    const turns = facing === NO_FACING ? 0 : facing, { bricks, studs } = blueprint;
    const count = Math.min(limit, bricks.length);
    for (let n = 0; n < count; n++) {
      const brick = bricks[n];
      const [x, z] = turn(brick.cx - HALF_LOT, brick.cz - HALF_LOT, turns);
      this.add(
        brick.shape, ghost >= 0 || brick.glass, lotX + HALF_LOT + x, brick.y * PLATE_HEIGHT, lotZ + HALF_LOT + z,
        brick.w, brick.h * PLATE_HEIGHT, brick.d, (brick.rot + turns) * QUARTER_TURN, ghost >= 0 ? ghost : brick.color,
      );
    }
    if (ghost >= 0) return;
    for (const stud of studs) {
      if (stud.owner >= count || stud.cover < count) continue;
      const [x, z] = turn(stud.x - HALF_LOT, stud.z - HALF_LOT, turns);
      this.stud(lotX + HALF_LOT + x, stud.y * PLATE_HEIGHT, lotZ + HALF_LOT + z, stud.color, stud.glass);
    }
  }

  dispose() { for (const batch of this.batches) batch?.dispose(); }
}

const turned: [number, number] = [0, 0];
/** (x, z) after `turns` quarter turns about the vertical, the way a facing turns a lot: +z goes to +x. */
function turn(x: number, z: number, turns: number) {
  for (let n = 0; n < turns; n++) { const was = x; x = z; z = -was; }
  turned[0] = x; turned[1] = z;
  return turned;
}

export function disposeBrickGeometries() { for (const geometry of geometries) geometry?.dispose(); geometries.length = 0; }
