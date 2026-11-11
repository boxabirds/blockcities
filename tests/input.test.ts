import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointerMode } from '../src/app/pointer-mode.ts';

const LEFT = 0, MIDDLE = 1, RIGHT = 2;
const none = { alt: false, ctrl: false, shift: false, meta: false };

test('a plain left drag uses the tool in hand, or moves the view with Look', () => {
  assert.equal(pointerMode(LEFT, none, 'road', true), 'tool');
  assert.equal(pointerMode(LEFT, none, 'road', false), 'none');
  assert.equal(pointerMode(LEFT, none, 'inspect', true), 'pan');
});

test('middle and right buttons move and turn the view whatever the tool', () => {
  assert.equal(pointerMode(MIDDLE, none, 'road', true), 'pan');
  assert.equal(pointerMode(RIGHT, none, 'road', true), 'orbit');
});

test('a held modifier turns or moves the view with the left button, for trackpads and one-button mice', () => {
  assert.equal(pointerMode(LEFT, { ...none, alt: true }, 'road', true), 'orbit');
  assert.equal(pointerMode(LEFT, { ...none, ctrl: true }, 'road', true), 'orbit');
  assert.equal(pointerMode(LEFT, { ...none, meta: true }, 'inspect', true), 'orbit');
  assert.equal(pointerMode(LEFT, { ...none, shift: true }, 'road', true), 'pan');
  // Turning wins when both are held, so no combination falls through to building.
  assert.equal(pointerMode(LEFT, { ...none, alt: true, shift: true }, 'homes', true), 'orbit');
});
