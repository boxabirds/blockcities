/**
 * Pointer and keyboard. Owns which tool is in hand and the drag in progress;
 * the runtime asks for those each frame and is told when a drag is let go.
 */
import * as THREE from 'three/webgpu';
import { TOOLS, toolDrag, type Tool } from '../game/actions.ts';
import { TILE_STUDS } from '../game/tuning.ts';
import type { CameraRig } from '../world/camera-rig.ts';

/** Keyboard panning covers this share of the camera's distance per second. */
const PAN_RATE = 0.9;
/** Radians per second for Q and E, and for the tilt keys. */
const ORBIT_RATE = 1.6;
const TILT_RATE = 0.9;
/** Radians per pixel when dragging with the right button. */
const ORBIT_PER_PIXEL = 0.006;
/** Zoom factor per wheel pixel is the exponential of this; pinches report small deltas, so they count for more. */
const ZOOM_PER_PIXEL = 0.0016;
const PINCH_GAIN = 6;
const KEY_ZOOM_RATE = 1.4;
const LEFT_BUTTON = 0, MIDDLE_BUTTON = 1, RIGHT_BUTTON = 2;
/** Number keys pick the first tools after "inspect", in toolbar order. */
const DIGIT_TOOLS: readonly Tool[] = TOOLS.slice(1, 10);

export type Tile = { x: number; z: number };
type Mode = 'none' | 'tool' | 'pan' | 'orbit';

export class Input {
  tool: Tool = 'inspect';
  /** Tile under the pointer, or null when it is off the map or over the interface. */
  hover: Tile | null = null;
  /** Tile where the tool drag in progress began, or null. */
  anchor: Tile | null = null;
  private mode: Mode = 'none';
  private lastX = 0;
  private lastY = 0;
  private readonly held = new Set<string>();
  private readonly ground = new THREE.Vector3();
  private readonly canvas: HTMLCanvasElement;
  private readonly rig: CameraRig;
  private readonly mapSize: number;
  private readonly onApply: (tool: Tool, from: Tile, to: Tile) => void;
  private readonly onTool: (tool: Tool) => void;
  private readonly onPause: () => void;
  private readonly abort = new AbortController();

  constructor(
    canvas: HTMLCanvasElement, rig: CameraRig, mapSize: number,
    onApply: (tool: Tool, from: Tile, to: Tile) => void, onTool: (tool: Tool) => void, onPause: () => void,
  ) {
    this.canvas = canvas; this.rig = rig; this.mapSize = mapSize; this.onApply = onApply; this.onTool = onTool; this.onPause = onPause;
    const options = { signal: this.abort.signal };
    canvas.addEventListener('pointerdown', this.down, options);
    canvas.addEventListener('pointermove', this.move, options);
    canvas.addEventListener('pointerup', this.up, options);
    canvas.addEventListener('pointercancel', this.cancel, options);
    canvas.addEventListener('pointerleave', () => { if (this.mode === 'none') this.hover = null; }, options);
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    canvas.addEventListener('wheel', this.wheel, { signal: this.abort.signal, passive: false });
    window.addEventListener('keydown', this.keyDown, options);
    window.addEventListener('keyup', event => this.held.delete(event.code), options);
    window.addEventListener('blur', () => this.held.clear(), options);
  }

  select(tool: Tool) {
    this.tool = tool; this.anchor = null;
    if (this.mode === 'tool') this.mode = 'none';
    this.onTool(tool);
  }

  /** The tile under a pointer position in client pixels, or null. */
  tileAt(clientX: number, clientY: number): Tile | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = (clientX - rect.left) / rect.width * 2 - 1, ndcY = 1 - (clientY - rect.top) / rect.height * 2;
    if (!this.rig.groundAt(ndcX, ndcY, this.ground)) return null;
    const half = this.mapSize * TILE_STUDS / 2;
    const x = Math.floor((this.ground.x + half) / TILE_STUDS), z = Math.floor((this.ground.z + half) / TILE_STUDS);
    return x >= 0 && z >= 0 && x < this.mapSize && z < this.mapSize ? { x, z } : null;
  }

  private readonly down = (event: PointerEvent) => {
    this.canvas.focus();
    this.canvas.setPointerCapture(event.pointerId);
    this.lastX = event.clientX; this.lastY = event.clientY;
    this.hover = this.tileAt(event.clientX, event.clientY);
    if (event.button === RIGHT_BUTTON) this.mode = 'orbit';
    else if (event.button === MIDDLE_BUTTON || (event.button === LEFT_BUTTON && this.tool === 'inspect')) this.mode = 'pan';
    else if (event.button === LEFT_BUTTON && this.hover) { this.mode = 'tool'; this.anchor = this.hover; }
  };

  private readonly move = (event: PointerEvent) => {
    const dx = event.clientX - this.lastX, dy = event.clientY - this.lastY;
    this.lastX = event.clientX; this.lastY = event.clientY;
    if (this.mode === 'pan') this.rig.drag(dx, dy, this.canvas.clientHeight);
    else if (this.mode === 'orbit') this.rig.orbit(-dx * ORBIT_PER_PIXEL, dy * ORBIT_PER_PIXEL);
    // While the view is being moved the tile under the pointer is not the point; keep the last one.
    if (this.mode === 'none' || this.mode === 'tool') this.hover = this.tileAt(event.clientX, event.clientY) ?? (this.mode === 'tool' ? this.hover : null);
  };

  private readonly up = (event: PointerEvent) => {
    if (this.mode === 'tool' && this.anchor && this.hover) {
      // A tool that acts on one tile acts where the pointer is let go.
      const from = toolDrag(this.tool) === 'single' ? this.hover : this.anchor;
      this.onApply(this.tool, from, this.hover);
    }
    this.mode = 'none'; this.anchor = null;
    this.hover = this.tileAt(event.clientX, event.clientY);
  };

  private readonly cancel = () => { this.mode = 'none'; this.anchor = null; };

  private readonly wheel = (event: WheelEvent) => {
    event.preventDefault();
    this.rig.zoom(Math.exp(event.deltaY * ZOOM_PER_PIXEL * (event.ctrlKey ? PINCH_GAIN : 1)));
  };

  private readonly keyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    this.held.add(event.code);
    if (event.repeat) return;
    if (event.code === 'Escape') {
      // Escape first abandons a drag, then puts the tool down.
      if (this.mode === 'tool') { this.mode = 'none'; this.anchor = null; } else this.select('inspect');
    } else if (event.code === 'Space') { event.preventDefault(); this.onPause(); }
    else if (event.code.startsWith('Digit')) {
      const tool = DIGIT_TOOLS[Number(event.code.slice('Digit'.length)) - 1];
      if (tool) this.select(tool);
    }
  };

  /** Applies the keys being held. Call once a frame. */
  update(dt: number) {
    const key = (...codes: string[]) => codes.some(code => this.held.has(code)) ? 1 : 0;
    const right = key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft'), forward = key('KeyW', 'ArrowUp') - key('KeyS', 'ArrowDown');
    if (right || forward) { const step = this.rig.distance * PAN_RATE * dt; this.rig.pan(right * step, forward * step); }
    const yaw = key('KeyE') - key('KeyQ'), tilt = key('KeyR') - key('KeyF');
    if (yaw || tilt) this.rig.orbit(yaw * ORBIT_RATE * dt, tilt * TILT_RATE * dt);
    const zoom = key('Minus', 'KeyX') - key('Equal', 'KeyZ');
    if (zoom) this.rig.zoom(Math.exp(zoom * KEY_ZOOM_RATE * dt));
  }

  dispose() { this.abort.abort(); }
}
