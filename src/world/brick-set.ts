/**
 * Draws bricks. Every brick is one instance of one of four unit shapes, scaled
 * to its size; a stud is a small cylinder. A set holds one instanced mesh per
 * shape and material, refilled from scratch whenever what it shows changes.
 */
import * as THREE from 'three/webgpu';
import { BOX, CONE, CYLINDER, PALETTE, SHAPE_COUNT, SLOPE, type Blueprint } from '../game/blueprints.ts';
import { NO_FACING } from '../game/city.ts';
import { PLATE_HEIGHT, STUD_DIAMETER, STUD_HEIGHT, TILE_STUDS } from '../game/tuning.ts';
import { BRICK_ANCHOR_ATTRIBUTE, BRICK_SIZE_ATTRIBUTE, BRICK_TURN_ATTRIBUTE, type BrickMaterials } from '../render/brick-materials.ts';

const CYLINDER_SEGMENTS = 16;
/** The top edge of a cylinder is rounded over this share of its radius and of its height, in this many steps: the rim is what catches the light on a stud. */
const RIM_RADIUS = 0.14;
const RIM_HEIGHT = 0.22;
const RIM_STEPS = 2;
const CONE_SEGMENTS = 14;
/** Height of the upright lip at the low edge of a slope, as a share of its height. */
const SLOPE_LIP = 0.14;
/** Bricks are drawn this much short of their footprint and height (studs), so the joints between them show. */
const SEAM = 0.035;
const QUARTER_TURN = Math.PI / 2;
const HALF_LOT = TILE_STUDS / 2;
const MATRIX_SIZE = 16;
const COLOR_SIZE = 3;
const SIZE_SIZE = 3;
const TURN_SIZE = 4;
const ANCHOR_SIZE = 4;
const GROWTH = 2;

function boxGeometry() { return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); }

/** An upright cylinder with a rounded top edge and no bottom: bricks stand on something, and studs are many. */
function cylinderGeometry() {
  // The outline from the foot, up the side, round the rim and in to the middle of the top, turned about the vertical.
  const outline = [new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 1 - RIM_HEIGHT)];
  for (let step = 1; step <= RIM_STEPS; step++) {
    const angle = step / RIM_STEPS * QUARTER_TURN;
    outline.push(new THREE.Vector2(0.5 - RIM_RADIUS * (1 - Math.cos(angle)) * 0.5, 1 - RIM_HEIGHT * (1 - Math.sin(angle))));
  }
  outline.push(new THREE.Vector2(0, 1));
  return new THREE.LatheGeometry(outline, CYLINDER_SEGMENTS);
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
  /** Whether each brick also records its size and turn, for the material that rounds box edges. */
  private readonly sized: boolean;
  private readonly shape: THREE.BufferGeometry;
  private size: THREE.InstancedBufferAttribute | null = null;
  private turn: THREE.InstancedBufferAttribute | null = null;
  /** For a set of moving things: the anchor each brick is written with, shared with the set, which keeps it current. */
  private readonly anchorNow: Float32Array | null;
  private anchor: THREE.InstancedBufferAttribute | null = null;

  constructor(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadows: boolean, sized: boolean, anchorNow: Float32Array | null) {
    this.parent = parent; this.capacity = capacity; this.shadows = shadows; this.sized = sized; this.shape = geometry; this.anchorNow = anchorNow;
    this.mesh = this.create(material, capacity);
  }

  private create(material: THREE.Material, capacity: number) {
    // Per-brick attributes live on the geometry, so a batch that has them needs a geometry of its own.
    let geometry = this.shape;
    if (this.sized || this.anchorNow) geometry = this.shape.clone();
    if (this.anchorNow) {
      this.anchor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * ANCHOR_SIZE), ANCHOR_SIZE);
      this.anchor.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(BRICK_ANCHOR_ATTRIBUTE, this.anchor);
    }
    if (this.sized) {
      this.size = new THREE.InstancedBufferAttribute(new Float32Array(capacity * SIZE_SIZE), SIZE_SIZE);
      this.turn = new THREE.InstancedBufferAttribute(new Float32Array(capacity * TURN_SIZE), TURN_SIZE);
      this.size.setUsage(THREE.DynamicDrawUsage); this.turn.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(BRICK_SIZE_ATTRIBUTE, this.size); geometry.setAttribute(BRICK_TURN_ATTRIBUTE, this.turn);
    }
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
    if (this.size && this.turn) {
      matrix.decompose(partPosition, partTurn, partSize);
      partSize.toArray(this.size.array, this.count * SIZE_SIZE); partTurn.toArray(this.turn.array, this.count * TURN_SIZE);
    }
    if (this.anchor && this.anchorNow) (this.anchor.array as Float32Array).set(this.anchorNow, this.count * ANCHOR_SIZE);
    this.count++;
  }

  private grow() {
    const old = this.mesh, capacity = this.capacity * GROWTH, oldSize = this.size, oldTurn = this.turn, oldAnchor = this.anchor;
    const mesh = this.create(old.material as THREE.Material, capacity);
    (mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    (mesh.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array);
    if (oldSize && oldTurn) { (this.size!.array as Float32Array).set(oldSize.array as Float32Array); (this.turn!.array as Float32Array).set(oldTurn.array as Float32Array); }
    if (oldAnchor) (this.anchor!.array as Float32Array).set(oldAnchor.array as Float32Array);
    this.parent.remove(old); old.dispose();
    if (this.owned) old.geometry.dispose();
    this.mesh = mesh; this.capacity = capacity;
  }

  end() {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true;
    if (this.size && this.turn) { this.size.needsUpdate = true; this.turn.needsUpdate = true; }
    if (this.anchor) this.anchor.needsUpdate = true;
  }

  /** Whether this batch's geometry is a copy of its own, to be disposed of with it. */
  private get owned() { return this.sized || this.anchorNow !== null; }

  dispose() { this.parent.remove(this.mesh); this.mesh.dispose(); if (this.owned) this.mesh.geometry.dispose(); }
}

const partPosition = new THREE.Vector3(), partSize = new THREE.Vector3(), partTurn = new THREE.Quaternion();

export type BrickSetOptions = {
  /** Whether these bricks cast shadows. */
  shadows: boolean;
  /** Instances to make room for at first, for each shape. */
  capacity: number;
  /** Draw bricks at their full size, with no joints showing. */
  seamless?: boolean;
  /** Glass here is windows, which glow at night. */
  windows?: boolean;
  /** These bricks are parts of things that move: each is drawn with the anchor last given to `anchor`, so its raindrops ride with it. */
  anchored?: boolean;
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
  private readonly anchorNow: Float32Array | null;

  constructor(materials: BrickMaterials, options: BrickSetOptions) {
    this.materials = materials; this.options = options; this.seam = options.seamless ? 0 : SEAM;
    this.anchorNow = options.anchored ? new Float32Array(ANCHOR_SIZE) : null;
  }

  /** Says what the bricks added from now on are part of: a thing at world (x, z), turned `heading` radians, with a number of its own. */
  anchor(x: number, z: number, heading: number, own: number) {
    if (this.anchorNow) { this.anchorNow[0] = x; this.anchorNow[1] = z; this.anchorNow[2] = heading; this.anchorNow[3] = own; }
  }

  private batch(shape: number, glass: boolean) {
    const slot = shape + (glass ? SHAPE_COUNT : 0);
    // Plastic boxes get rounded edges, except in a seamless set, where rounding would score a line between tiles that are meant to read as one sheet.
    const rounded = shape === BOX && !glass && !this.options.seamless;
    const { materials } = this, moving = this.anchorNow ? materials.moving : null;
    const material = glass ? (moving ? moving.glass : this.options.windows ? materials.windowGlass : materials.glass)
      : rounded ? (moving ?? materials).plasticBox : (moving ?? materials).plastic;
    return this.batches[slot] ??= new Batch(this.group, geometryOf(shape), material, this.options.capacity, this.options.shadows, rounded, this.anchorNow);
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
