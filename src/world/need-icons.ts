/**
 * The flashing marks over finished buildings that stand empty: a bolt for missing power, a drop for missing water.
 * Flat badges that always face the camera, drawn unlit so they read at night as well.
 */
import * as THREE from 'three/webgpu';
import { FLAG_POWER, FLAG_WATER, NONE, ZONE_NONE, type City } from '../game/city.ts';
import { buildingBlueprint } from '../game/blueprints.ts';
import { isComplete } from '../game/derive.ts';
import { PLATE_HEIGHT, TILE_STUDS } from '../game/tuning.ts';

export type Need = 'power' | 'water';
export const NEEDS: readonly Need[] = ['power', 'water'];

/** Pixels across the square each badge is painted on. */
const BADGE_PIXELS = 128;
const BADGE_RIM = 9;
const BADGE_FILL = '#ffffff';
const BADGE_EDGE = '#c91a09';
const GLYPH_OUTLINE = '#1b2a34';
const GLYPH_LINE = 5;
const GLYPH_FILL: Record<Need, string> = { power: '#f2cd37', water: '#0a8fe0' };
/** Outlines on a unit square, y down. */
const BOLT = [[0.58, 0.14], [0.3, 0.55], [0.47, 0.55], [0.4, 0.86], [0.7, 0.43], [0.52, 0.43]] as const;
const DROP_TIP = [0.5, 0.15] as const, DROP_CENTRE = [0.5, 0.6] as const, DROP_RADIUS = 0.21;

/** A badge is this many studs across close up, and never less than this share of the camera's distance. */
const BADGE_STUDS = 2.6;
const BADGE_DISTANCE_SHARE = 0.03;
/** It floats this many studs above the roof, and two badges over one building sit this far apart, in badge widths. */
const BADGE_LIFT = 1.4;
const PAIR_SPACING = 0.56;
/** Flashes per second, and how faint and small it goes at the bottom of each flash. */
const FLASH_HERTZ = 1.4;
const FLASH_LOW_OPACITY = 0.3;
const FLASH_LOW_SCALE = 0.82;
const TAU = Math.PI * 2;
const ALPHA_CUTOFF = 0.02;

function paintBadge(need: Need) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = BADGE_PIXELS;
  const pen = canvas.getContext('2d')!, size = BADGE_PIXELS, half = size / 2;
  pen.beginPath(); pen.arc(half, half, half - BADGE_RIM / 2 - 1, 0, TAU);
  pen.fillStyle = BADGE_FILL; pen.fill();
  pen.lineWidth = BADGE_RIM; pen.strokeStyle = BADGE_EDGE; pen.stroke();
  pen.beginPath();
  if (need === 'power') {
    BOLT.forEach(([x, y], n) => { if (n === 0) pen.moveTo(x * size, y * size); else pen.lineTo(x * size, y * size); });
    pen.closePath();
  } else {
    // A drop: a circle with its top drawn up to a point.
    const [cx, cy] = DROP_CENTRE, r = DROP_RADIUS, shoulder = Math.PI / 5;
    pen.moveTo(DROP_TIP[0] * size, DROP_TIP[1] * size);
    pen.lineTo((cx + r * Math.cos(-shoulder)) * size, (cy + r * Math.sin(-shoulder)) * size);
    pen.arc(cx * size, cy * size, r * size, -shoulder, Math.PI + shoulder);
    pen.closePath();
  }
  pen.fillStyle = GLYPH_FILL[need]; pen.fill();
  pen.lineJoin = 'round'; pen.lineWidth = GLYPH_LINE; pen.strokeStyle = GLYPH_OUTLINE; pen.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Which needs a tile's building is missing: none unless it is a finished home, shop or works. */
export function missingNeeds(city: City, i: number): Need[] {
  if (city.structure[i] !== NONE || city.zone[i] === ZONE_NONE || city.level[i] === 0) return [];
  const flags = city.flags[i];
  if ((flags & FLAG_POWER) && (flags & FLAG_WATER)) return [];
  if (!isComplete(city, i)) return [];
  const missing: Need[] = [];
  if (!(flags & FLAG_POWER)) missing.push('power');
  if (!(flags & FLAG_WATER)) missing.push('water');
  return missing;
}

const position = new THREE.Vector3(), right = new THREE.Vector3(), scale = new THREE.Vector3(), matrix = new THREE.Matrix4();

export class NeedIcons {
  readonly group = new THREE.Group();
  /** How many badges of each kind were drawn last frame, for the automation hook. */
  readonly shown: Record<Need, number> = { power: 0, water: 0 };
  private readonly meshes: Record<Need, THREE.InstancedMesh>;
  private readonly materials: THREE.MeshBasicNodeMaterial[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly geometry = new THREE.PlaneGeometry(1, 1);

  constructor(tiles: number) {
    const make = (need: Need) => {
      const texture = paintBadge(need);
      const material = new THREE.MeshBasicNodeMaterial({ map: texture, transparent: true, depthWrite: false, alphaTest: ALPHA_CUTOFF, fog: false });
      const mesh = new THREE.InstancedMesh(this.geometry, material, tiles);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.count = 0; mesh.visible = false;
      this.textures.push(texture); this.materials.push(material); this.group.add(mesh);
      return mesh;
    };
    this.meshes = { power: make('power'), water: make('water') };
  }

  /** Places a badge over every empty building, facing `camera`. `seconds` runs on the wall clock, so they flash while paused. */
  update(city: City, camera: THREE.Camera, cameraDistance: number, seconds: number) {
    const { size, stats } = city, counts: Record<Need, number> = { power: 0, water: 0 };
    if (stats.withoutPower + stats.withoutWater > 0) {
      const phase = (1 - Math.cos(seconds * FLASH_HERTZ * TAU)) / 2;
      const width = Math.max(BADGE_STUDS, cameraDistance * BADGE_DISTANCE_SHARE) * (FLASH_LOW_SCALE + (1 - FLASH_LOW_SCALE) * phase);
      for (const material of this.materials) material.opacity = FLASH_LOW_OPACITY + (1 - FLASH_LOW_OPACITY) * phase;
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      scale.set(width, width, width);
      const origin = -size * TILE_STUDS / 2;
      for (let i = 0; i < size * size; i++) {
        const missing = missingNeeds(city, i);
        if (missing.length === 0) continue;
        const x = i % size, z = (i - x) / size;
        const roof = buildingBlueprint(city.structure[i], city.zone[i], city.level[i], city.variant[i]).height * PLATE_HEIGHT;
        missing.forEach((need, n) => {
          // Two badges sit side by side as the camera sees them.
          const shift = (n - (missing.length - 1) / 2) * 2 * PAIR_SPACING * width;
          position.set(origin + (x + 0.5) * TILE_STUDS, roof + BADGE_LIFT + width / 2, origin + (z + 0.5) * TILE_STUDS).addScaledVector(right, shift);
          matrix.compose(position, camera.quaternion, scale).toArray(this.meshes[need].instanceMatrix.array, counts[need]++ * matrix.elements.length);
        });
      }
    }
    for (const need of NEEDS) {
      const mesh = this.meshes[need];
      mesh.count = counts[need]; mesh.visible = counts[need] > 0; mesh.instanceMatrix.needsUpdate = true;
      this.shown[need] = counts[need];
    }
  }

  dispose() {
    for (const need of NEEDS) this.meshes[need].dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometry.dispose();
  }
}
