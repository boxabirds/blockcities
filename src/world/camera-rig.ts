/** The mayor's view: a camera that orbits a point on the ground, eased toward where it was last asked to be. */
import * as THREE from 'three/webgpu';

/** A long lens, so the city reads as a model on a table. */
const FIELD_OF_VIEW = 30;
const NEAR = 2;
const FAR = 4000;
const MIN_DISTANCE = 22;
const MAX_DISTANCE = 330;
const MIN_PITCH = 0.3;
const MAX_PITCH = 1.45;
/** How quickly the view catches up with its target (per second). */
const EASE_RATE = 12;
export const START_DISTANCE = 150;
export const START_YAW = 0.6;
export const START_PITCH = 0.8;

export type View = { x: number; z: number; distance: number; yaw: number; pitch: number };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, NEAR, FAR);
  /** Where the camera is looking, on the ground. */
  readonly focus = new THREE.Vector3();
  distance = START_DISTANCE;
  private yaw = START_YAW;
  private pitch = START_PITCH;
  private readonly target: View = { x: 0, z: 0, distance: START_DISTANCE, yaw: START_YAW, pitch: START_PITCH };
  /** The focus stays within this distance of the map's centre on each axis. */
  private readonly reach: number;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointer = new THREE.Vector2();

  constructor(reach: number) { this.reach = reach; this.place(); }

  /** Moves the focus by a step given in the camera's own left-right and near-far. */
  pan(right: number, forward: number) {
    const sin = Math.sin(this.target.yaw), cos = Math.cos(this.target.yaw);
    this.target.x = clamp(this.target.x + right * cos - forward * sin, -this.reach, this.reach);
    this.target.z = clamp(this.target.z - right * sin - forward * cos, -this.reach, this.reach);
  }

  /** Moves the focus so the ground follows a pointer dragged by (dx, dy) pixels in a viewport `height` pixels tall. */
  drag(dx: number, dy: number, height: number) {
    const perPixel = 2 * this.target.distance * Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW) / 2) / height;
    // Ground running away from the camera is foreshortened by the sine of the tilt.
    this.pan(-dx * perPixel, dy * perPixel / Math.sin(this.target.pitch));
  }

  orbit(yaw: number, pitch: number) {
    this.target.yaw += yaw;
    this.target.pitch = clamp(this.target.pitch + pitch, MIN_PITCH, MAX_PITCH);
  }

  zoom(factor: number) { this.target.distance = clamp(this.target.distance * factor, MIN_DISTANCE, MAX_DISTANCE); }

  /** Where the camera is heading, in world units and radians. */
  get view(): View { return { ...this.target }; }

  /** Jumps straight to a view, with no easing. Missing fields keep their current target. */
  look(view: Partial<View>) {
    Object.assign(this.target, view);
    this.target.distance = clamp(this.target.distance, MIN_DISTANCE, MAX_DISTANCE);
    this.target.pitch = clamp(this.target.pitch, MIN_PITCH, MAX_PITCH);
    this.focus.set(this.target.x, 0, this.target.z); this.distance = this.target.distance; this.yaw = this.target.yaw; this.pitch = this.target.pitch;
    this.place();
  }

  update(dt: number) {
    const ease = 1 - Math.exp(-EASE_RATE * dt), { target } = this;
    this.focus.x += (target.x - this.focus.x) * ease; this.focus.z += (target.z - this.focus.z) * ease;
    this.distance += (target.distance - this.distance) * ease;
    this.yaw += (target.yaw - this.yaw) * ease; this.pitch += (target.pitch - this.pitch) * ease;
    this.place();
  }

  private place() {
    const flat = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(this.focus.x + Math.sin(this.yaw) * flat, Math.sin(this.pitch) * this.distance, this.focus.z + Math.cos(this.yaw) * flat);
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
  }

  /** The point on the ground under a pointer position in normalised device coordinates, or null when it is above the horizon. */
  groundAt(ndcX: number, ndcY: number, out: THREE.Vector3) {
    this.raycaster.setFromCamera(this.pointer.set(ndcX, ndcY), this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, out);
  }

  /** Where a point in the world lands on screen, in normalised device coordinates. */
  project(point: THREE.Vector3) { return point.project(this.camera); }
}
