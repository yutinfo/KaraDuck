import test from 'node:test';
import assert from 'node:assert/strict';
import { indexAfterDrag, createDragSort } from '../public/js/drag-sort.js';

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

function createFakeListDom(qids) {
  const listeners = new Map();
  const docListeners = new Map();
  const winListeners = new Map();
  const makeTarget = (map) => ({
    addEventListener(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      map.get(type)?.delete(fn);
    },
    dispatch(type, event) {
      for (const fn of map.get(type) || []) fn(event);
    },
  });

  const win = {
    scrollY: 0,
    innerHeight: 800,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    scrollBy: () => {},
    ...makeTarget(winListeners),
  };

  const doc = {
    defaultView: win,
    body: { style: { userSelect: '' } },
    ...makeTarget(docListeners),
  };

  const list = {
    ownerDocument: doc,
    children: [],
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
    },
    insertBefore(row, ref) {
      const from = this.children.indexOf(row);
      if (from !== -1) this.children.splice(from, 1);
      if (!ref) {
        this.children.push(row);
      } else {
        const idx = this.children.indexOf(ref);
        if (idx === -1) this.children.push(row);
        else this.children.splice(idx, 0, row);
      }
    },
    ...makeTarget(listeners),
  };

  const rows = qids.map((qid) => {
    const captured = new Set();
    const row = {
      parentElement: list,
      style: { transform: '', transition: '' },
      classList: {
        set: new Set(),
        add(c) { this.set.add(c); },
        remove(c) { this.set.delete(c); },
      },
      matches(sel) { return sel === '[data-qid]'; },
      getAttribute(name) { return name === 'data-qid' ? qid : null; },
      get nextSibling() {
        const idx = list.children.indexOf(row);
        return idx >= 0 && idx + 1 < list.children.length ? list.children[idx + 1] : null;
      },
      getBoundingClientRect() {
        const idx = list.children.indexOf(row);
        const top = 100 + idx * 110;
        return { top, bottom: top + 100, height: 100 };
      },
      closest(sel) {
        if (sel === '[data-qid]') return row;
        return null;
      },
    };
    const handle = {
      disabled: false,
      setPointerCapture(id) { captured.add(id); },
      hasPointerCapture(id) { return captured.has(id); },
      releasePointerCapture(id) { captured.delete(id); },
      closest(sel) {
        if (sel === '.drag-handle') return handle;
        if (sel === '[data-qid]') return row;
        return null;
      },
    };
    row.handle = handle;
    list.children.push(row);
    return row;
  });

  return { list, rows };
}

test('drag-sort: ลากแถวแรกไปท้ายคิว [a,b,c] ส่ง onMove("a", 2, null)', () => {
  const { list, rows } = createFakeListDom(['a', 'b', 'c']);
  const moves = [];
  const sorter = createDragSort({
    list,
    onMove: (qid, delta, beforeQid) => moves.push([qid, delta, beforeQid]),
  });

  list.dispatch('pointerdown', {
    button: 0, isPrimary: true, pointerId: 1, clientY: 150, target: rows[0].handle, preventDefault() {},
  });
  list.dispatch('pointermove', {
    pointerId: 1, clientY: 420, preventDefault() {},
  });
  list.dispatch('pointerup', {
    pointerId: 1, clientY: 420,
  });

  assert.deepEqual(moves, [['a', 2, null]]);
  sorter.destroy();
});

test('drag-sort: ลาก c ไปหน้า a ส่ง onMove("c", -2, "a")', () => {
  const { list, rows } = createFakeListDom(['a', 'b', 'c']);
  const moves = [];
  const sorter = createDragSort({
    list,
    onMove: (qid, delta, beforeQid) => moves.push([qid, delta, beforeQid]),
  });

  list.dispatch('pointerdown', {
    button: 0, isPrimary: true, pointerId: 2, clientY: 370, target: rows[2].handle, preventDefault() {},
  });
  list.dispatch('pointermove', {
    pointerId: 2, clientY: 110, preventDefault() {},
  });
  list.dispatch('pointerup', {
    pointerId: 2, clientY: 110,
  });

  assert.deepEqual(moves, [['c', -2, 'a']]);
  sorter.destroy();
});

test('drag-sort: ลาก a ไปอยู่ระหว่าง b และ c ส่ง onMove("a", 1, "c")', () => {
  const { list, rows } = createFakeListDom(['a', 'b', 'c']);
  const moves = [];
  const sorter = createDragSort({
    list,
    onMove: (qid, delta, beforeQid) => moves.push([qid, delta, beforeQid]),
  });

  list.dispatch('pointerdown', {
    button: 0, isPrimary: true, pointerId: 3, clientY: 150, target: rows[0].handle, preventDefault() {},
  });
  list.dispatch('pointermove', {
    pointerId: 3, clientY: 270, preventDefault() {},
  });
  list.dispatch('pointerup', {
    pointerId: 3, clientY: 270,
  });

  assert.deepEqual(moves, [['a', 1, 'c']]);
  sorter.destroy();
});

test('drag-sort: ปุ่มลูกศรส่ง beforeQid ที่ถูกต้องทั้งขึ้นและลง', () => {
  const { list, rows } = createFakeListDom(['a', 'b', 'c']);
  const moves = [];
  const sorter = createDragSort({
    list,
    onMove: (qid, delta, beforeQid) => moves.push([qid, delta, beforeQid]),
  });

  // a ArrowDown → before c
  list.dispatch('keydown', { key: 'ArrowDown', target: rows[0].handle, preventDefault() {} });
  // b ArrowDown → end (null)
  list.dispatch('keydown', { key: 'ArrowDown', target: rows[1].handle, preventDefault() {} });
  // b ArrowUp → before a
  list.dispatch('keydown', { key: 'ArrowUp', target: rows[1].handle, preventDefault() {} });
  // c ArrowUp → before b
  list.dispatch('keydown', { key: 'ArrowUp', target: rows[2].handle, preventDefault() {} });

  assert.deepEqual(moves, [
    ['a', 1, 'c'],
    ['b', 1, null],
    ['b', -1, 'a'],
    ['c', -1, 'b'],
  ]);
  sorter.destroy();
});
