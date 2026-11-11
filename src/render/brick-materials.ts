/**
 * The two materials everything is made of: glossy moulded plastic, and clear
 * plastic for glass bricks. Glass is the only thing that lets light through,
 * using the same physical transmission the Jellyland jelly uses (see
 * jelly-material.ts there) but with a brick's fixed thickness and no absorption
 * or dispersion. Colour comes from each instance.
 */
import * as THREE from 'three/webgpu';

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

export type BrickMaterials = { plastic: THREE.Material; glass: THREE.Material; dispose: () => void };

export function createBrickMaterials(): BrickMaterials {
  const plastic = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff, roughness: PLASTIC_ROUGHNESS, metalness: 0, envMapIntensity: PLASTIC_ENV_INTENSITY,
  });
  const glass = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff, roughness: GLASS_ROUGHNESS, metalness: 0, transmission: GLASS_TRANSMISSION, ior: GLASS_IOR,
    thickness: GLASS_THICKNESS, envMapIntensity: GLASS_ENV_INTENSITY, transparent: false, side: THREE.FrontSide,
  });
  return { plastic, glass, dispose: () => { plastic.dispose(); glass.dispose(); } };
}
