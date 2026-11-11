/**
 * What a press on the map starts. Kept apart from the event handling so it can be tested without a browser.
 * Trackpads and one-button mice have no middle or right button, so a held modifier stands in for each.
 */
import type { Tool } from '../game/actions.ts';

export type PointerMode = 'none' | 'tool' | 'pan' | 'orbit';
export type Modifiers = { alt: boolean; ctrl: boolean; shift: boolean; meta: boolean };

const LEFT_BUTTON = 0, MIDDLE_BUTTON = 1, RIGHT_BUTTON = 2;

/** `onMap` is whether the press landed on a tile; a tool cannot start off the map. */
export function pointerMode(button: number, modifiers: Modifiers, tool: Tool, onMap: boolean): PointerMode {
  if (button === RIGHT_BUTTON) return 'orbit';
  if (button === MIDDLE_BUTTON) return 'pan';
  if (button !== LEFT_BUTTON) return 'none';
  if (modifiers.alt || modifiers.ctrl || modifiers.meta) return 'orbit';
  if (modifiers.shift || tool === 'inspect') return 'pan';
  return onMap ? 'tool' : 'none';
}
