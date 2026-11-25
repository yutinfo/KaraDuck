// Importing this module is safe outside a browser; DOM access starts at creation.
export function indexAfterDrag({ tops, heights, from, pointerY }) {
  if (tops.length <= 1) return 0;
  let index = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (i !== from && tops[i] + heights[i] / 2 < pointerY) index += 1;
  }
  return Math.min(tops.length - 1, Math.max(0, index));
}

export function createDragSort({
  list,
  rowSelector = '[data-qid]',
  handleSelector = '.drag-handle',
  scroller = null,
  onMove,
  onDragState = () => {},
}) {
  const doc = list.ownerDocument;
  const win = doc.defaultView;
  const scrollTarget = scroller || win;
  let drag = null;
  let frame = null;
  let destroyed = false;

  const rows = () => Array.from(list.children).filter((row) => row.matches(rowSelector));
  const scrollTop = () => scroller ? scroller.scrollTop : win.scrollY;

  function targetHandle(event) {
    const handle = event.target.closest?.(handleSelector);
    if (!handle || handle.disabled) return null;
    const row = handle.closest(rowSelector);
    return row?.parentElement === list ? { handle, row } : null;
  }

  function stopFrame() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
  }

  function scrollDirection() {
    const { top, bottom } = scroller
      ? scroller.getBoundingClientRect()
      : { top: 0, bottom: win.innerHeight };
    if (drag.pointerY < top + 48) return -1;
    if (drag.pointerY > bottom - 48) return 1;
    return 0;
  }

  function paint() {
    const { elements, tops, heights, from, gap } = drag;
    const minDy = tops[0] - tops[from];
    const maxDy = tops.at(-1) + heights.at(-1) - tops[from] - heights[from];
    const dy = Math.max(
      minDy,
      Math.min(
        maxDy,
        drag.pointerY - drag.startY + scrollTop() - drag.startScroll
      )
    );
    drag.to = indexAfterDrag({
      tops, heights, from, pointerY: tops[from] + heights[from] / 2 + dy,
    });
    // Clamping can prevent the center from passing the end row's midpoint
    // (also with unequal heights). Touching either list edge must still allow
    // dropping into the first/last slot without moving outside the list.
    if (dy < 0 && dy === minDy) drag.to = 0;
    if (dy > 0 && dy === maxDy) drag.to = elements.length - 1;
    elements.forEach((row, index) => {
      let shift = 0;
      if (index === from) {
        shift = dy;
      } else if (index > from && index <= drag.to) {
        shift = -(heights[from] + gap);
      } else if (index < from && index >= drag.to) {
        shift = heights[from] + gap;
      }
      row.style.transform = `translateY(${shift}px)`;
    });
  }

  function scheduleScroll() {
    if (!drag || !scrollDirection()) {
      stopFrame();
      return;
    }
    if (frame !== null) return;
    frame = win.requestAnimationFrame(() => {
      frame = null;
      if (!drag) return;
      const direction = scrollDirection();
      if (!direction) return;
      const before = scrollTop();
      if (scroller) {
        scroller.scrollTop += direction * 12;
      } else {
        win.scrollBy({ top: direction * 12, behavior: 'instant' });
      }
      paint();
      // Stop requesting frames at a scroll boundary; a new pointer/scroll event
      // can start the loop again when the user moves away from it.
      if (scrollTop() !== before) scheduleScroll();
    });
  }

  function beforeQidForMove(elements, from, to) {
    const nextRow = to > from ? elements[to + 1] : elements[to];
    return nextRow ? nextRow.getAttribute('data-qid') : null;
  }

  function finish(commit) {
    if (!drag) return;
    const completed = drag;
    drag = null;
    stopFrame();
    const { elements, from, to, handle, pointerId, userSelect } = completed;
    const row = elements[from];
    const delta = to - from;
    if (commit && delta !== 0) {
      list.insertBefore(row, to > from ? elements[to].nextSibling : elements[to]);
    }
    for (const element of elements) {
      element.style.transform = '';
      element.style.transition = '';
    }
    row.classList.remove('is-dragging');
    list.classList.remove('is-sorting');
    doc.body.style.userSelect = userSelect;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    onDragState(false);
    if (commit && delta !== 0) {
      onMove(row.getAttribute('data-qid'), delta, beforeQidForMove(elements, from, to));
    }
  }

  function onPointerDown(event) {
    if (destroyed || drag || event.button !== 0 || event.isPrimary === false) return;
    const target = targetHandle(event);
    if (!target) return;
    const elements = rows();
    if (elements.length < 2) return;
    event.preventDefault();
    target.handle.setPointerCapture(event.pointerId);
    const rects = elements.map((row) => row.getBoundingClientRect());
    const from = elements.indexOf(target.row);
    drag = {
      elements,
      tops: rects.map((rect) => rect.top),
      heights: rects.map((rect) => rect.height),
      gap: rects[1].top - rects[0].bottom,
      from,
      to: from,
      handle: target.handle,
      pointerId: event.pointerId,
      startY: event.clientY,
      pointerY: event.clientY,
      startScroll: scrollTop(),
      userSelect: doc.body.style.userSelect,
    };
    doc.body.style.userSelect = 'none';
    list.classList.add('is-sorting');
    elements.forEach((row, index) => {
      row.style.transition = index === from ? 'none' : 'transform .15s';
    });
    target.row.classList.add('is-dragging');
    onDragState(true);
    scheduleScroll();
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    drag.pointerY = event.clientY;
    paint();
    scheduleScroll();
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.pointerY = event.clientY;
    paint();
    finish(true);
  }

  function onPointerCancel(event) {
    if (drag && event.pointerId === drag.pointerId) finish(false);
  }

  function onEscape(event) {
    if (drag && event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const target = targetHandle(event);
    if (!target) return;
    event.preventDefault();
    if (drag) return;
    const elements = rows();
    const from = elements.indexOf(target.row);
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    const to = from + delta;
    if (to >= 0 && to < elements.length) {
      onMove(target.row.getAttribute('data-qid'), delta, beforeQidForMove(elements, from, to));
    }
  }

  function onContextMenu(event) {
    if (event.target.closest?.(handleSelector)?.closest(rowSelector)?.parentElement === list) {
      event.preventDefault();
    }
  }

  function onScroll() {
    if (!drag) return;
    paint();
    scheduleScroll();
  }

  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerCancel],
    ['lostpointercapture', onPointerCancel],
    ['keydown', onKeyDown],
    ['contextmenu', onContextMenu],
  ];
  for (const [type, listener] of listeners) list.addEventListener(type, listener);
  doc.addEventListener('keydown', onEscape);
  scrollTarget.addEventListener('scroll', onScroll, { passive: true });

  return {
    isDragging: () => drag !== null,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [type, listener] of listeners) list.removeEventListener(type, listener);
      doc.removeEventListener('keydown', onEscape);
      scrollTarget.removeEventListener('scroll', onScroll);
      finish(false);
    },
  };
}
