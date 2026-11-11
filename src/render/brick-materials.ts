/**
 * The two materials everything is made of: glossy moulded plastic, and clear
 * plastic for glass bricks. Glass is the only thing that lets light through,
 * using the same physical transmission the Jellyland jelly uses (see
 * jelly-material.ts there) but with a brick's fixed thickness and no absorption
 * or dispersion. Colour comes from each instance.
 */
import * as THREE from 'three/webgpu';
import { float, mx_cell_noise_float, positionWorld, step, uniform, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { BRICK_PLATES, PLATE_HEIGHT, TILE_STUDS } from '../game/tuning.ts';

const PLASTIC_ROUGHNESS = 0.3;
const PLASTIC_ENV_INTENSITY = 1;
const GLASS_ROUGHNESS = 0.05;
/** Polycarbonate. */
const GLASS_IOR = 1.58;
/** Share of light let through; the rest is the brick's own colour, so pale glass still reads as an object. */
const GLASS_TRANSMISSION = 0.9;
/** Optical thickness in studs: one brick. */
const GLASS_THICKNESS = 1;
const GLASS_ENV_INTENSITY = 1.15;

/** Colour and peak strength of a lit window; above 1 it blooms. */
const WINDOW_LIGHT = [1, 0.5, 0.14] as const;
const WINDOW_GLOW = 1.3;
/** Share of rooms with the light on. */
const LIT_SHARE = 0.5;
/** A storey is a brick and the plate between floors. */
const STOREY_HEIGHT = (BRICK_PLATES + 1) * PLATE_HEIGHT;

export type BrickMaterials = {
  plastic: THREE.Material;
  /** Glass that never glows: water, previews. */
  glass: THREE.Material;
  /** Glass in buildings: glows at night, one room in a few left dark. */
  windowGlass: THREE.Material;
  /** 0 by day to 1 at night. */
  windowGlow: { value: number };
  dispose: () => void;
};

export function createBrickMaterials(): BrickMaterials {
  const plastic = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff, roughness: PLASTIC_ROUGHNESS, metalness: 0, envMapIntensity: PLASTIC_ENV_INTENSITY,
  });
  const makeGlass = () => new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff, roughness: GLASS_ROUGHNESS, metalness: 0, transmission: GLASS_TRANSMISSION, ior: GLASS_IOR,
    thickness: GLASS_THICKNESS, envMapIntensity: GLASS_ENV_INTENSITY, transparent: false, side: THREE.FrontSide,
  });
  const glass = makeGlass(), windowGlass = makeGlass(), windowGlow = uniform(0);
  // Every lot is a room wide and every storey a room tall; a hash of which room this is decides whether its light is on.
  const room = positionWorld.mul(vec3(1 / TILE_STUDS, 1 / STOREY_HEIGHT, 1 / TILE_STUDS)).sub(vec3(0, PLATE_HEIGHT / STOREY_HEIGHT, 0)).floor();
  const lit = step(mx_cell_noise_float(room), float(LIT_SHARE));
  windowGlass.emissiveNode = vec3(...WINDOW_LIGHT).mul(lit).mul(windowGlow).mul(WINDOW_GLOW) as unknown as Node<'color'>;
  return { plastic, glass, windowGlass, windowGlow, dispose: () => { plastic.dispose(); glass.dispose(); windowGlass.dispose(); } };
}
