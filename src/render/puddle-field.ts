/**
 * Where the puddles are: one per map tile at most, kept as a small texture the brick shader reads (see rain.ts) and
 * as the same numbers on this side, so that what a car drives through is exactly what is drawn. Each tile holds
 * the puddle's middle within the tile (studs), its radius when full (studs; 0 for no puddle), and how stirred up it
 * is (0 still to 1 just driven through), which dies away by itself.
 */
import * as THREE from 'three/webgpu';

const CHANNELS = 4;
const MIDDLE_X = 0, MIDDLE_Z = 1, RADIUS = 2, STIRRED = 3;
/** Seconds for a stirred puddle to settle. */
const SETTLE_SECONDS = 1.6;

export class PuddleField {
  readonly texture: THREE.DataTexture;
  readonly size: number;
  private readonly data: Float32Array;
  private stirredAny = false;

  constructor(size: number) {
    this.size = size;
    this.data = new Float32Array(size * size * CHANNELS);
    this.texture = new THREE.DataTexture(this.data, size, size, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false; this.texture.needsUpdate = true;
  }

  /** Empties every tile. */
  clear() { this.data.fill(0); this.stirredAny = false; this.texture.needsUpdate = true; }

  /** Puts a puddle on a tile: its middle within the tile and its radius when full, all in studs. */
  set(tile: number, middleX: number, middleZ: number, radius: number) {
    const at = tile * CHANNELS;
    this.data[at + MIDDLE_X] = middleX; this.data[at + MIDDLE_Z] = middleZ; this.data[at + RADIUS] = radius; this.data[at + STIRRED] = 0;
    this.texture.needsUpdate = true;
  }

  /** How far the point (x, z) within a tile is from the middle of the tile's puddle, as a share of `grown` times its full radius: under 1 is in the water. Infinity where there is no puddle. */
  reach(tile: number, x: number, z: number, grown: number) {
    const at = tile * CHANNELS, radius = this.data[at + RADIUS] * grown;
    return radius > 0 ? Math.hypot(x - this.data[at + MIDDLE_X], z - this.data[at + MIDDLE_Z]) / radius : Infinity;
  }

  /** Stirs a tile's puddle up, as something driving through it does. */
  stir(tile: number, amount: number) {
    const at = tile * CHANNELS + STIRRED;
    if (amount > this.data[at]) { this.data[at] = Math.min(1, amount); this.stirredAny = true; this.texture.needsUpdate = true; }
  }

  /** Lets stirred puddles settle. */
  update(dt: number) {
    if (!this.stirredAny) return;
    let still = true;
    for (let at = STIRRED; at < this.data.length; at += CHANNELS) {
      if (this.data[at] <= 0) continue;
      this.data[at] = Math.max(0, this.data[at] - dt / SETTLE_SECONDS);
      if (this.data[at] > 0) still = false;
    }
    this.stirredAny = !still; this.texture.needsUpdate = true;
  }

  dispose() { this.texture.dispose(); }
}
