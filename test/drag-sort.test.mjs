import test from 'node:test';
import assert from 'node:assert/strict';
import { indexAfterDrag } from '../public/js/drag-sort.js';

const tops = Object.freeze([0, 110, 220, 330]);
const heights = Object.freeze([100, 100, 100, 100]);

for (const [from, pointerY, expected] of [
  [0, 50, 0], [0, 170, 1], [0, 400, 3],
  [3, 380, 3], [3, 40, 0], [2, 165, 2], [2, 155, 1],
  [1, -500, 0], [1, 9999, 3],
]) {
  test(`indexAfterDrag: row ${from}, center ${pointerY} → ${expected}`, () => {
    assert.equal(indexAfterDrag({ tops, heights, from, pointerY }), expected);
  });
}

test('a single row always stays at index zero', () => {
  for (const pointerY of [-500, 50, 9999]) {
    assert.equal(indexAfterDrag({ tops: [0], heights: [100], from: 0, pointerY }), 0);
  }
});

test('unequal row heights use each row’s own midpoint', () => {
  assert.equal(indexAfterDrag({
    tops: [0, 70, 220], heights: [60, 140, 60], from: 0, pointerY: 150,
  }), 1);
});

test('only midpoints strictly above the dragged center count', () => {
  assert.equal(indexAfterDrag({ tops, heights, from: 2, pointerY: 160 }), 1);
});

test('empty lists return zero and importing needs no document or window', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(indexAfterDrag({ tops: [], heights: [], from: 0, pointerY: 0 }), 0);
});
