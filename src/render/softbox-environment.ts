/**
 * The room the bricks are reflected in: a dark photographic studio with a few bright softboxes, built here rather
 * than loaded from a photograph. Glossy plastic only looks glossy when it has something with edges to reflect. An
 * evenly bright room lays a pale veil over every colour; a dark one with lamps in it leaves the colour alone and
 * puts a crisp, lamp-shaped highlight wherever a surface faces a softbox. The fill light the dark room no longer
 * gives is added separately (see sky.ts).
 */
import * as THREE from 'three/webgpu';

/** The room: a box this many units across, with walls, floor and ceiling of these greys (linear, 1 is white). */
const ROOM_SIZE = 40;
const WALL_GREY = 0.1;
/** Each softbox: where its middle is, how wide and tall it is, and how bright (1 is a white wall in full light). */
type Softbox = { at: readonly [number, number, number]; width: number; height: number; brightness: number; tint: string };
const TAU = Math.PI * 2;
/**
 * A ring of softboxes round the room, at about the height the mayor looks down from. A flat roof mirrors whatever is
 * opposite the camera at the camera's own height, so this ring is what flat roofs and roads reflect: from any side
 * a lamp-shaped patch of light lies across part of the city, with plain colour between the lamps.
 */
const RING_LAMPS = 3;
const RING_DISTANCE = 18;
const RING_ELEVATION = 0.72;
const RING_WIDTH = 6;
const RING_HEIGHT = 4.5;
const RING_BRIGHTNESS = 16;
/** The ring is turned by this much so no lamp sits square behind the opening view. */
const RING_TURN = 0.5;
const RING_TINTS = ['#ffffff', '#fff1dc', '#e8f1ff'] as const;
const ring: Softbox[] = Array.from({ length: RING_LAMPS }, (_, n) => {
  const round = RING_TURN + n / RING_LAMPS * TAU, flat = Math.cos(RING_ELEVATION) * RING_DISTANCE;
  return {
    at: [Math.sin(round) * flat, Math.sin(RING_ELEVATION) * RING_DISTANCE, Math.cos(round) * flat] as const,
    width: RING_WIDTH, height: RING_HEIGHT, brightness: RING_BRIGHTNESS, tint: RING_TINTS[n % RING_TINTS.length],
  };
});
const SOFTBOXES: readonly Softbox[] = [
  ...ring,
  // The bank overhead: the highlight on roof slopes and on the shoulders of studs.
  { at: [3, 19, -2], width: 12, height: 8, brightness: 12, tint: '#ffffff' },
  // Two tall strips low down either side, which draw the long vertical highlights on walls and cylinders.
  { at: [-19, 5, 6], width: 3, height: 9, brightness: 10, tint: '#fff4e2' },
  { at: [19, 5, -7], width: 3, height: 9, brightness: 8, tint: '#e6f0ff' },
];
const CENTRE = new THREE.Vector3(0, 2, 0);
const NEAR = 0.1;
const FAR = 100;

export function createSoftboxEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene, intensity: number) {
  const studio = new THREE.Scene(), made: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, material);
    made.push({ geometry, material }); studio.add(mesh);
    return mesh;
  };
  const wall = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  wall.color.setScalar(WALL_GREY);
  add(new THREE.BoxGeometry(ROOM_SIZE, ROOM_SIZE, ROOM_SIZE), wall).position.y = ROOM_SIZE / 2 - 1;
  for (const box of SOFTBOXES) {
    const lamp = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    // Brighter than white: this is light, and the reflection of it should stay bright on a dark brick.
    lamp.color.set(box.tint).multiplyScalar(box.brightness);
    const panel = add(new THREE.PlaneGeometry(box.width, box.height), lamp);
    panel.position.set(...box.at);
    panel.lookAt(CENTRE);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(studio, 0, NEAR, FAR);
  pmrem.dispose();
  for (const { geometry, material } of made) { geometry.dispose(); material.dispose(); }
  scene.environment = target.texture; scene.environmentIntensity = intensity;
  return { dispose: () => { target.dispose(); } };
}
