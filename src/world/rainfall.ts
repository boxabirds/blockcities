/**
 * Rain falling: thin streaks in a box of air that follows the camera. Every streak is four corners of one mesh, and
 * where each is at any moment is worked out by the graphics card from a random number of its own and the clock, so
 * a downpour costs the same to keep moving as a drizzle and nothing is updated streak by streak.
 */
import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, step, time, uniform, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

/** The most streaks ever drawn; `intensity` shows a share of them. */
const STREAKS = 9000;
/** The box of air, in studs across and high, when the camera is `REFERENCE_DISTANCE` from what it looks at. It grows with the distance. */
const BOX_ACROSS = 90;
const BOX_HEIGHT = 70;
const REFERENCE_DISTANCE = 40;
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
/** A streak's length and width in studs at the reference distance, and how fast it falls, slowest and fastest (studs a second). */
const STREAK_LENGTH = 1.5;
const STREAK_WIDTH = 0.035;
const FALL_SPEED = [38, 56] as const;
/** The wind leans the rain this far sideways for each stud it falls. */
const SLANT = [0.12, 0, 0.05] as const;
/** Streaks nearer the lens than this share of the camera's distance from what it looks at are not drawn: right in front of the lens one streak would be a bar across the whole view. */
const CLEAR_SHARE = 0.5;
const COLOR = '#dfeeff';
const OPACITY = 0.42;
const CORNERS = [[-1, 0], [1, 0], [1, 1], [-1, 1]] as const;
const TRIANGLES = [0, 1, 2, 0, 2, 3] as const;
const SEED_SIZE = 4;
const CORNER_SIZE = 2;
/** A seeded generator, so the rain is the same every time: screenshots can be compared. */
const SEED = 20261112;
const MODULUS = 2 ** 32;

type Vec3 = Node<'vec3'>;

export class Rainfall {
  readonly mesh: THREE.Mesh;
  /** 0 for none to 1 for every streak. */
  readonly intensity = uniform(0);
  private readonly centre = uniform(new THREE.Vector3());
  private readonly scale = uniform(1);
  private readonly clear = uniform(0);
  private readonly material: THREE.MeshBasicNodeMaterial;

  constructor() {
    const seeds = new Float32Array(STREAKS * CORNERS.length * SEED_SIZE), corners = new Float32Array(STREAKS * CORNERS.length * CORNER_SIZE);
    const indices = new Uint32Array(STREAKS * TRIANGLES.length), positions = new Float32Array(STREAKS * CORNERS.length * 3);
    let state = SEED;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / MODULUS; };
    for (let streak = 0; streak < STREAKS; streak++) {
      const seed = [random(), random(), random(), random()];
      CORNERS.forEach(([side, end], corner) => {
        const vertex = streak * CORNERS.length + corner;
        seeds.set(seed, vertex * SEED_SIZE);
        corners[vertex * CORNER_SIZE] = side; corners[vertex * CORNER_SIZE + 1] = end;
      });
      TRIANGLES.forEach((corner, n) => { indices[streak * TRIANGLES.length + n] = streak * CORNERS.length + corner; });
    }
    const geometry = new THREE.BufferGeometry();
    // Positions are worked out in the shader; the attribute only has to exist.
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('streakSeed', new THREE.BufferAttribute(seeds, SEED_SIZE));
    geometry.setAttribute('streakCorner', new THREE.BufferAttribute(corners, CORNER_SIZE));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const seed = attribute('streakSeed', 'vec4'), corner = attribute('streakCorner', 'vec2');
    const across = this.scale.mul(BOX_ACROSS), high = this.scale.mul(BOX_HEIGHT);
    const fall = vec3(SLANT[0], -1, SLANT[2]).normalize();
    const speed = seed.w.mul(FALL_SPEED[1] - FALL_SPEED[0]).add(FALL_SPEED[0]).mul(this.scale);
    // Each streak keeps its own place in a box that repeats forever; the camera's box is the copy round `centre`.
    const fallen = seed.y.mul(high).add(time.mul(speed)).mod(high);
    const home = vec3(seed.x.mul(across), 0, seed.z.mul(across)).add(vec3(SLANT[0], 0, SLANT[2]).mul(fallen));
    const offset = home.sub(this.centre).add(across.mul(0.5)).mod(across).sub(across.mul(0.5));
    const head = vec3(this.centre.x.add(offset.x), high.sub(fallen), this.centre.z.add(offset.z));
    // The streak lies along the fall and is turned edge-on to the camera.
    const sideways = fall.cross(cameraPosition.sub(head)).normalize();
    const shown = step(seed.w.mul(0.999).add(seed.x.mul(0.001)), this.intensity).mul(step(this.clear, cameraPosition.sub(head).length()));
    const length = this.scale.mul(STREAK_LENGTH), width = this.scale.mul(STREAK_WIDTH);
    const place = head.sub(fall.mul(corner.y).mul(length)).add(sideways.mul(corner.x).mul(width)).mul(shown);

    const material = new THREE.MeshBasicNodeMaterial({ color: COLOR, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    material.positionNode = place as unknown as Vec3;
    material.opacityNode = float(OPACITY);
    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.visible = false;
  }

  /** Keeps the rain round what the camera is looking at, and as heavy as asked (0 to 1). */
  update(focus: THREE.Vector3, distance: number, intensity: number) {
    this.centre.value.copy(focus);
    this.scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, distance / REFERENCE_DISTANCE));
    this.intensity.value = intensity; this.clear.value = distance * CLEAR_SHARE;
    this.mesh.visible = intensity > 0;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
