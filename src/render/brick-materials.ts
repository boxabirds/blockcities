/**
 * The two materials everything is made of: glossy moulded plastic, and clear
 * plastic for glass bricks. Glass is the only thing that lets light through,
 * using the same physical transmission the Jellyland jelly uses (see
 * jelly-material.ts there) but with a brick's fixed thickness and no absorption
 * or dispersion. Colour comes from each instance.
 */
import * as THREE from 'three/webgpu';
import { attribute, cameraViewMatrix, cross, float, mx_cell_noise_float, mx_noise_float, normalWorldGeometry, positionGeometry, positionWorld, smoothstep, step, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { BRICK_PLATES, MAP_SIZE, PLATE_HEIGHT, TILE_STUDS, WINDSCREEN_FORWARD, WIPER_LENGTH, WIPER_PIVOT_HEIGHT } from '../game/tuning.ts';
import { PuddleField } from './puddle-field.ts';
import { NO_RAIN, WORLD_FRAME, buildRain, createRainSettings, type RainFeatures, type RainFrame, type RainSettings } from './rain.ts';

/** New ABS out of the mould: a smooth body under a mirror-smooth skin, which is what gives a brick its hard white glints. */
const PLASTIC_ROUGHNESS = 0.32;
const PLASTIC_CLEARCOAT = 1;
const PLASTIC_CLEARCOAT_ROUGHNESS = 0.03;
const PLASTIC_ENV_INTENSITY = 1;
/**
 * A moulded brick's edges are rounded off over this many studs. Boxes are drawn as sharp unit cubes scaled to size,
 * so the rounding is done in the light, not the shape: near an edge the surface is lit as if it leaned over to
 * meet the next face. That lean is what draws a bright line along every edge of a new brick.
 */
const EDGE_ROUNDING = 0.09;
/** Names of the per-brick attributes the rounding reads: the brick's size in studs, and its turn as a quaternion. */
export const BRICK_SIZE_ATTRIBUTE = 'brickSize';
export const BRICK_TURN_ATTRIBUTE = 'brickTurn';
/**
 * For bricks that are part of something moving: where that thing is (x and z in the world), which way it is turned
 * (radians about the vertical), and a number of its own so that no two carry the same raindrops.
 */
export const BRICK_ANCHOR_ATTRIBUTE = 'brickAnchor';
const GLASS_ROUGHNESS = 0.05;
/** Polycarbonate. */
const GLASS_IOR = 1.58;
/** Share of light let through; the rest is the brick's own colour, so pale glass still reads as an object. */
const GLASS_TRANSMISSION = 0.9;
/** Optical thickness in studs: one brick. */
const GLASS_THICKNESS = 1;
const GLASS_ENV_INTENSITY = 1.15;
/**
 * Cloud shadows: patches of shade that drift over the city under broken cloud. The clouds themselves are a slow
 * noise over the ground; `cover` decides how much of it counts as cloud. Each patch is this soft at its edge.
 */
const CLOUD_EDGE = 0.1;
/** The noise is stretched this much along the wind, and changes shape this fast as it goes. */
/** Smooth noise seldom reaches its extremes; it is stretched by this much about its middle so that cover runs the whole way from none to all. */
const CLOUD_CONTRAST = 1.1;
const CLOUD_STRETCH = 0.6;
const CLOUD_CHURN = 0.012;
/** A surface of a moving thing counts as its front when its normal points this much forward. */
const WINDSCREEN_FRONT = 0.7;

/** Colour and peak strength of a lit window; above 1 it blooms. */
const WINDOW_LIGHT = [1, 0.5, 0.14] as const;
const WINDOW_GLOW = 1.3;
/** Share of rooms with the light on. */
const LIT_SHARE = 0.5;
/** A storey is a brick and the plate between floors. */
const STOREY_HEIGHT = (BRICK_PLATES + 1) * PLATE_HEIGHT;

export type BrickMaterials = {
  plastic: THREE.Material;
  /** Plastic for box bricks, with rounded edges. Needs the two per-brick attributes above on its geometry. */
  plasticBox: THREE.Material;
  /** The same three for bricks that are part of something moving, whose raindrops ride along with it. They need the anchor attribute. */
  moving: { plastic: THREE.Material; plasticBox: THREE.Material; glass: THREE.Material };
  /** Glass that never glows: water, previews. */
  glass: THREE.Material;
  /** Glass in buildings: glows at night, one room in a few left dark. */
  windowGlass: THREE.Material;
  /** 0 by day to 1 at night. */
  windowGlow: { value: number };
  /** The rain's dials: change a value and the drops follow at once. */
  rain: RainSettings;
  /** The drifting shade of broken cloud: how much of the sky is cloud (0 to 1), how dark its shade is (0 none to 1 black), how many studs across a cloud is, and how fast and which way they drift (studs a second along x and z). */
  clouds: { cover: { value: number }; darkness: { value: number }; size: { value: number }; drift: { value: THREE.Vector2 } };
  /** Draws cloud shadows or stops drawing them. Rebuilds the shaders. */
  setCloudShadows: (on: boolean) => void;
  /** Where the puddles are. The shader reads it; whoever lays the puddles and drives through them writes it. */
  puddles: PuddleField;
  /** 1 while cars have their wipers going, which keeps their windscreens clear of drops; else 0. */
  wipers: { value: number };
  /** Chooses which kinds of drop are drawn. Rebuilds the shaders, so it is for a switch being thrown, not for every frame. */
  setRain: (features: RainFeatures) => void;
  dispose: () => void;
};

export function createBrickMaterials(): BrickMaterials {
  const makePlastic = () => new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff, roughness: PLASTIC_ROUGHNESS, metalness: 0, envMapIntensity: PLASTIC_ENV_INTENSITY,
    clearcoat: PLASTIC_CLEARCOAT, clearcoatRoughness: PLASTIC_CLEARCOAT_ROUGHNESS,
  });
  const plastic = makePlastic(), plasticBox = makePlastic(), movingPlastic = makePlastic(), movingPlasticBox = makePlastic();
  // The unit cube runs from -0.5 to 0.5 across and 0 to 1 up; `centred` is where on it this point is.
  const centred = positionGeometry.sub(vec3(0, 0.5, 0));
  const size = attribute(BRICK_SIZE_ATTRIBUTE, 'vec3'), turn = attribute(BRICK_TURN_ATTRIBUTE, 'vec4');
  // Studs from this point to the nearest face across each axis: 0 on the face being drawn, small near its edges.
  const toFace = centred.abs().mul(-1).add(0.5).mul(size);
  const lean = float(1).sub(smoothstep(vec3(0), vec3(EDGE_ROUNDING), toFace));
  const rounded = centred.sign().mul(lean).normalize();
  // Turn it the way the brick is turned (the quaternion), then into the camera's frame, which is where normals are lit.
  const axis = turn.xyz, facing = rounded.add(cross(axis, cross(axis, rounded).add(rounded.mul(turn.w))).mul(2));
  const makeGlass = () => new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff, roughness: GLASS_ROUGHNESS, metalness: 0, transmission: GLASS_TRANSMISSION, ior: GLASS_IOR,
    thickness: GLASS_THICKNESS, envMapIntensity: GLASS_ENV_INTENSITY, transparent: false, side: THREE.FrontSide,
  });
  const glass = makeGlass(), windowGlass = makeGlass(), windowGlow = uniform(0);
  // Every lot is a room wide and every storey a room tall; a hash of which room this is decides whether its light is on.
  const room = positionWorld.mul(vec3(1 / TILE_STUDS, 1 / STOREY_HEIGHT, 1 / TILE_STUDS)).sub(vec3(0, PLATE_HEIGHT / STOREY_HEIGHT, 0)).floor();
  const lit = step(mx_cell_noise_float(room), float(LIT_SHARE));
  windowGlass.emissiveNode = vec3(...WINDOW_LIGHT).mul(lit).mul(windowGlow).mul(WINDOW_GLOW) as unknown as Node<'color'>;
  // Rain goes on top of whatever the surface is: the same drops on every material, bending the light that the glossy
  // skin reflects as well as the plastic under it. With no rain the materials are exactly what they are in the dry.
  const rain = createRainSettings();
  const movingGlass = makeGlass();
  // The frame of a moving thing: its own place and turn, undone from the world's.
  const anchor = attribute(BRICK_ANCHOR_ATTRIBUTE, 'vec4'), swing = anchor.z.cos(), sway = anchor.z.sin();
  const intoThing = (x: Node<'float'>, z: Node<'float'>) => [x.mul(swing).sub(z.mul(sway)), x.mul(sway).add(z.mul(swing))] as const;
  const [alongThing, acrossThing] = intoThing(positionWorld.x.sub(anchor.x) as unknown as Node<'float'>, positionWorld.z.sub(anchor.y) as unknown as Node<'float'>);
  const [flatX, flatZ] = intoThing(normalWorldGeometry.x as unknown as Node<'float'>, normalWorldGeometry.z as unknown as Node<'float'>);
  // A wiper keeps the fan it sweeps on the windscreen clear: the upright front of the cabin, within its reach of its pivot.
  const wipers = uniform(0), puddles = new PuddleField(MAP_SIZE);
  const fromPivot = vec3(alongThing, positionWorld.y.sub(WIPER_PIVOT_HEIGHT), acrossThing.sub(WINDSCREEN_FORWARD)).length();
  const swept = step(WINDSCREEN_FRONT, flatZ).mul(step(fromPivot, WIPER_LENGTH)).mul(wipers);
  const riding: RainFrame = {
    position: vec3(alongThing.add(anchor.w), positionWorld.y, acrossThing) as unknown as Node<'vec3'>,
    flat: vec3(flatX, normalWorldGeometry.y, flatZ) as unknown as Node<'vec3'>,
    toWorld: direction => vec3(direction.x.mul(swing).add(direction.z.mul(sway)), direction.y, direction.z.mul(swing).sub(direction.x.mul(sway))) as unknown as Node<'vec3'>,
    // The thing drives toward its own +z, so the wind pushes drops on its sides toward -z: one way along the left side, the other along the right.
    wind: flatX as unknown as Node<'float'>,
    cleared: swept as unknown as Node<'float'>,
  };
  const boxFacing = facing as unknown as Node<'vec3'>;
  const surfaces: { material: THREE.MeshPhysicalNodeMaterial; base: Node<'vec3'> | null; roughness: number; frame: RainFrame }[] = [
    { material: plasticBox, base: boxFacing, roughness: PLASTIC_ROUGHNESS, frame: WORLD_FRAME },
    { material: plastic, base: null, roughness: PLASTIC_ROUGHNESS, frame: WORLD_FRAME },
    { material: glass, base: null, roughness: GLASS_ROUGHNESS, frame: WORLD_FRAME },
    { material: windowGlass, base: null, roughness: GLASS_ROUGHNESS, frame: WORLD_FRAME },
    { material: movingPlasticBox, base: boxFacing, roughness: PLASTIC_ROUGHNESS, frame: riding },
    { material: movingPlastic, base: null, roughness: PLASTIC_ROUGHNESS, frame: riding },
    { material: movingGlass, base: null, roughness: GLASS_ROUGHNESS, frame: riding },
  ];
  const clouds = { cover: uniform(0.5), darkness: uniform(0.45), size: uniform(30), drift: uniform(new THREE.Vector2(2.2, 0.9)) };
  const overhead = positionWorld.xz.sub(clouds.drift.mul(time)).div(clouds.size).mul(vec2(CLOUD_STRETCH, 1));
  const cloudiness = mx_noise_float(vec3(overhead, time.mul(CLOUD_CHURN))).mul(CLOUD_CONTRAST).add(0.5).clamp(0, 1);
  // More cover lowers the bar a patch of noise has to clear to be cloud.
  const shaded = smoothstep(clouds.cover.oneMinus().sub(CLOUD_EDGE), clouds.cover.oneMinus().add(CLOUD_EDGE), cloudiness);
  const shade = vec3(shaded.mul(clouds.darkness).oneMinus()) as unknown as Node<'color'>;
  const setCloudShadows = (on: boolean) => {
    for (const { material } of surfaces) { material.colorNode = on ? shade : null; material.needsUpdate = true; }
  };
  const setRain = (features: RainFeatures) => {
    for (const { material, base, roughness, frame } of surfaces) {
      const drops = buildRain(rain, features, frame, frame === WORLD_FRAME ? puddles : null);
      const dry = base ? cameraViewMatrix.mul(vec4(base, 0)).xyz.normalize() as unknown as Node<'vec3'> : null;
      material.normalNode = drops ? drops.normal(base ?? normalWorldGeometry as unknown as Node<'vec3'>) : dry;
      material.clearcoatNormalNode = drops ? material.normalNode : null;
      material.roughnessNode = drops ? drops.roughness(roughness) : null;
      material.needsUpdate = true;
    }
  };
  setRain(NO_RAIN);
  const moving = { plastic: movingPlastic, plasticBox: movingPlasticBox, glass: movingGlass };
  return { plastic, plasticBox, moving, glass, windowGlass, windowGlow, rain, puddles, wipers, clouds, setCloudShadows, setRain, dispose: () => { puddles.dispose(); plastic.dispose(); plasticBox.dispose(); movingPlastic.dispose(); movingPlasticBox.dispose(); movingGlass.dispose(); glass.dispose(); windowGlass.dispose(); } };
}
