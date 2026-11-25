import {
  createState,
  totalDurationSec,
  formatDuration,
} from './store.js';
import { search } from './api.js';
import { createSync } from './sync.js';
import { createDragSort } from './drag-sort.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NAME_STORAGE_KEY = 'karaoke.remote.name';
const SKIP_CONFIRM_MS = 3000;
const TOAST_TTL_MS = 3500;

const params = new URLSearchParams(location.search);
const roomKey = (params.get('k') || '').trim();

// DOM references
const statusEl = document.getElementById('r-status');
const backdropEl = document.getElementById('r-backdrop');
const nowBarEl = document.getElementById('r-now');
const nowBadgeEl = document.getElementById('r-now-badge');
const nowTitleEl = document.getElementById('r-now-title');
const nowSubEl = document.getElementById('r-now-sub');
const btnRestart = document.getElementById('r-btn-restart');
const btnToggle = document.getElementById('r-btn-toggle');
const iconPlay = document.getElementById('r-icon-play');
const iconPause = document.getElementById('r-icon-pause');
const btnSkip = document.getElementById('r-btn-skip');
const iconSkip = document.getElementById('r-icon-skip');
const skipConfirmText = document.getElementById('r-skip-confirm');

const mainEl = document.getElementById('r-main');
const topEl = document.getElementById('r-top');
const nameInput = document.getElementById('r-name');
const searchForm = document.getElementById('r-search-form');
const searchInput = document.getElementById('r-search-input');
const searchNote = document.getElementById('r-search-note');

const tabOrder = ['results', 'queue'];
const tabs = {
  results: document.getElementById('r-tab-results'),
  queue: document.getElementById('r-tab-queue'),
};
const panels = {
  results: document.getElementById('r-panel-results'),
  queue: document.getElementById('r-panel-queue'),
};
const queueCountEl = document.getElementById('r-queue-count');
const toastsEl = document.getElementById('r-toasts');

// App state
let state = { ...createState(), playerState: 'idle' };
let isBadKey = false;
let activeTab = 'results';
let searchStatus = 'idle'; // 'idle' | 'loading' | 'done' | 'error'
let searchResults = [];
const embedFlags = new Map();
let lastQuery = '';
let activeSearchController = null;
let skipConfirmArmed = false;
let skipConfirmTimer = null;
let lastCurrentQid = null;
let lastBackdropUrl = '';
let queueDragSort = null;
let queueRenderPending = false;

// Icon helper (safe DOM SVG construction)
const ICON_PATHS = {
  plus: ['M12 5v14M5 12h14'],
  next: ['M4 6h10M4 12h10M4 18h6M16 14l4 3-4 3v-6z'],
  top: ['M6 6h12M12 10l-5 6h10z'],
  trash: ['M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12'],
};

function createIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  if (name === 'grip') {
    for (const cx of [9, 15]) {
      for (const cy of [6, 12, 18]) {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(cx));
        dot.setAttribute('cy', String(cy));
        dot.setAttribute('r', '1.5');
        dot.setAttribute('fill', 'currentColor');
        svg.appendChild(dot);
      }
    }
  }

  const paths = ICON_PATHS[name] || [];
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  return svg;
}

function thumbnailUrl(id) {
  return typeof id === 'string' && /^[\w-]{11}$/.test(id)
    ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    : '';
}

function loadSavedName() {
  try {
    const value = localStorage.getItem(NAME_STORAGE_KEY);
    return typeof value === 'string' ? value.slice(0, 20) : '';
  } catch {
    return '';
  }
}

function saveName(value) {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, value.slice(0, 20));
  } catch {
    // storage unavailable
  }
}

function getRequesterName() {
  return nameInput.value.trim().slice(0, 20);
}

function toCommandSong(song) {
  const payload = {
    id: song.id,
    title: song.title,
    channel: typeof song.channel === 'string' ? song.channel : '',
    duration: typeof song.duration === 'string' ? song.duration : '',
    durationSec: Number.isFinite(song.durationSec) ? song.durationSec : 0,
    thumbnail: typeof song.thumbnail === 'string' ? song.thumbnail : '',
  };
  const by = getRequesterName();
  if (by) {
    payload.by = by;
  }
  return payload;
}

function showToast(message, { warn = false } = {}) {
  if (isBadKey) return;
  const toast = document.createElement('div');
  toast.className = warn ? 'toast toast-warn' : 'toast';
  toast.textContent = message;
  toastsEl.appendChild(toast);

  while (toastsEl.children.length > 3) {
    toastsEl.removeChild(toastsEl.firstElementChild);
  }

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, TOAST_TTL_MS);
}

function resetSkipConfirm() {
  if (skipConfirmTimer !== null) {
    clearTimeout(skipConfirmTimer);
    skipConfirmTimer = null;
  }
  skipConfirmArmed = false;
}

function enterBadKey() {
  if (isBadKey) return;
  isBadKey = true;
  queueDragSort?.destroy();
  queueDragSort = null;
  resetSkipConfirm();
  sync.stop();
  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }

  nowBarEl.hidden = true;
  mainEl.hidden = true;
  toastsEl.hidden = true;
  backdropEl.classList.remove('is-on');

  statusEl.className = 'r-status r-status-bad-key';
  statusEl.replaceChildren();

  const card = document.createElement('div');
  card.className = 'r-bad-key-card glass iris';

  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('class', 'r-bad-key-icon');
  icon.setAttribute('width', '56');
  icon.setAttribute('height', '56');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const key = document.createElementNS(SVG_NS, 'path');
  key.setAttribute('d', 'M14 3a7 7 0 0 0-6.7 9L2 17.3V22h4v-3h3v-3l2-2A7 7 0 1 0 14 3zM16 7h.01');
  key.setAttribute('fill', 'none');
  key.setAttribute('stroke', 'currentColor');
  key.setAttribute('stroke-width', '2');
  key.setAttribute('stroke-linejoin', 'round');
  key.setAttribute('stroke-linecap', 'round');
  icon.appendChild(key);

  const text = document.createElement('p');
  text.className = 'r-bad-key-text';
  text.textContent = 'ลิงก์นี้ใช้ไม่ได้แล้ว สแกน QR ที่จอหลักอีกครั้ง';

  card.append(icon, text);
  statusEl.appendChild(card);
  statusEl.hidden = false;
}

function updateConnectionStatus(status) {
  if (status === 'bad_key') {
    enterBadKey();
    return;
  }
  if (isBadKey) return;

  if (status === 'offline') {
    statusEl.className = 'r-status r-status-offline';
    statusEl.textContent = 'กำลังเชื่อมต่อใหม่…';
    statusEl.hidden = false;
  } else {
    statusEl.hidden = true;
  }
}

const sync = createSync({
  key: roomKey,
  onState: (snapshot) => {
    if (isBadKey) return;
    const nextQid = snapshot?.current?.qid ?? null;
    if (nextQid !== lastCurrentQid) {
      lastCurrentQid = nextQid;
      resetSkipConfirm();
    }
    state = {
      current: snapshot?.current ?? null,
      queue: Array.isArray(snapshot?.queue) ? snapshot.queue : [],
      history: Array.isArray(snapshot?.history) ? snapshot.history : [],
      playerState: typeof snapshot?.playerState === 'string' ? snapshot.playerState : 'idle',
    };
    renderAll();
  },
  onControl: () => {
    // Remote page has no video player
  },
  onStatus: (status) => {
    updateConnectionStatus(status);
  },
});

function sendCommand(cmd) {
  if (isBadKey) return Promise.resolve(false);
  return sync.send(cmd).then(
    () => true,
    (err) => {
      if (err?.status === 401 || err?.code === 'bad_key') {
        enterBadKey();
        return false;
      }
      showToast('ส่งคำสั่งไม่สำเร็จ ลองอีกครั้ง', { warn: true });
      if (cmd.type === 'move') renderQueuePanel();
      return false;
    }
  );
}

function isInQueueOrCurrent(songId) {
  if (state.current && state.current.id === songId) return true;
  return state.queue.some((item) => item.id === songId);
}

function createThumb(song, variant) {
  const wrap = document.createElement('div');
  wrap.className = `thumb-wrap ${variant === 'result' ? 'thumb-result' : 'thumb-queue'}`;

  const url = thumbnailUrl(song.id);
  if (url) {
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.setAttribute('src', url);
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    wrap.appendChild(img);
  }

  if (variant === 'result' && song.duration) {
    const dur = document.createElement('span');
    dur.className = 'thumb-duration';
    dur.textContent = song.duration;
    wrap.appendChild(dur);
  }

  return wrap;
}

function revealActivePanel() {
  const panelTop = panels[activeTab].getBoundingClientRect().top;
  const stickyBottom = window.getComputedStyle(topEl).position === 'sticky'
    ? topEl.getBoundingClientRect().bottom
    : 0;
  if (panelTop < stickyBottom) {
    window.scrollTo({
      top: Math.max(0, window.scrollY + panelTop - stickyBottom - 8),
      behavior: 'auto',
    });
  }
}

function setActiveTab(tabName) {
  activeTab = tabName;
  for (const key of tabOrder) {
    const isSelected = key === tabName;
    tabs[key].setAttribute('aria-selected', String(isSelected));
    panels[key].hidden = !isSelected;
  }
  revealActivePanel();
}

function renderNowBar() {
  const current = state.current;
  const hasCurrent = Boolean(current);

  if (hasCurrent) {
    nowBadgeEl.hidden = false;
    nowTitleEl.hidden = false;
    nowTitleEl.textContent = current.title;
    const by = typeof current.by === 'string' && current.by.trim() ? current.by.trim() : '';
    nowSubEl.textContent = by ? `ขอโดย ${by}` : current.channel || '';
  } else {
    nowBadgeEl.hidden = false;
    nowTitleEl.hidden = true;
    nowTitleEl.textContent = '';
    nowSubEl.textContent = 'ยังไม่มีเพลงกำลังเล่น';
  }

  btnRestart.disabled = !hasCurrent;
  btnToggle.disabled = !hasCurrent;
  btnSkip.disabled = !hasCurrent;

  const isPlaying = hasCurrent && state.playerState === 'playing';
  nowBarEl.classList.toggle('is-playing', isPlaying);
  const backgroundUrl = thumbnailUrl(current?.id);
  if (backgroundUrl !== lastBackdropUrl) {
    lastBackdropUrl = backgroundUrl;
    backdropEl.style.backgroundImage = backgroundUrl ? `url(${backgroundUrl})` : '';
  }
  backdropEl.classList.toggle('is-on', Boolean(backgroundUrl));
  iconPlay.toggleAttribute('hidden', isPlaying);
  iconPause.toggleAttribute('hidden', !isPlaying);
  btnToggle.setAttribute('aria-label', isPlaying ? 'หยุดชั่วคราว' : 'เล่น');

  const armed = hasCurrent && skipConfirmArmed;
  btnSkip.classList.toggle('btn-danger-confirm', armed);
  iconSkip.toggleAttribute('hidden', armed);
  skipConfirmText.hidden = !armed;
  btnSkip.setAttribute('aria-label', armed ? 'ยืนยันข้ามเพลง' : 'ข้ามเพลง');
}

function renderResultsPanel() {
  const panel = panels.results;
  panel.replaceChildren();

  if (searchStatus === 'loading') {
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (let i = 0; i < 6; i += 1) {
      const skel = document.createElement('div');
      skel.className = 'tile tile-skeleton';
      skel.setAttribute('aria-hidden', 'true');
      grid.appendChild(skel);
    }
    panel.appendChild(grid);
    return;
  }

  if (searchStatus === 'error') {
    const box = document.createElement('div');
    box.className = 'panel-state';

    const text = document.createElement('p');
    text.className = 'panel-state-text';
    text.textContent = 'ค้นหาไม่สำเร็จ';

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn-neon';
    retryBtn.setAttribute('aria-label', 'ลองค้นหาใหม่');
    retryBtn.textContent = 'ลองใหม่';
    retryBtn.addEventListener('click', () => {
      if (lastQuery) {
        void runSearch(lastQuery);
      }
    });

    box.append(text, retryBtn);
    panel.appendChild(box);
    return;
  }

  if (searchStatus === 'done' && searchResults.length === 0) {
    const box = document.createElement('div');
    box.className = 'panel-state';
    const text = document.createElement('p');
    text.className = 'panel-state-text';
    text.textContent = 'ไม่พบเพลง ลองพิมพ์ชื่อเพลงหรือชื่อศิลปินแบบอื่น';
    box.appendChild(text);
    panel.appendChild(box);
    return;
  }

  if (searchResults.length === 0) {
    const box = document.createElement('div');
    box.className = 'panel-state';
    const text = document.createElement('p');
    text.className = 'panel-state-text';
    text.textContent = 'พิมพ์ชื่อเพลงหรือศิลปิน ระบบจะเติม "คาราโอเกะ" ให้เอง';
    box.appendChild(text);
    panel.appendChild(box);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'grid';

  for (const song of searchResults) {
    const blocked = embedFlags.get(song.id) === false;
    const blockedLabel = blocked ? ' (เล่นที่นี่ไม่ได้)' : '';
    const li = document.createElement('li');
    li.className = blocked ? 'tile is-blocked' : 'tile';

    const thumb = createThumb(song, 'result');

    const info = document.createElement('div');
    info.className = 'tile-body';

    const title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = song.title;

    const meta = document.createElement('p');
    meta.className = 'card-meta';
    meta.textContent = song.views ? `${song.channel} · ${song.views}` : song.channel;

    info.append(title, meta);

    if (blocked || isInQueueOrCurrent(song.id)) {
      const badge = document.createElement('span');
      badge.className = blocked ? 'pill is-warn' : 'pill is-cyan';
      badge.textContent = blocked ? 'เล่นที่นี่ไม่ได้' : 'ในคิวแล้ว';
      thumb.appendChild(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'r-result-actions';

    const btnEnqueue = document.createElement('button');
    btnEnqueue.type = 'button';
    btnEnqueue.className = 'btn-neon btn-enqueue';
    btnEnqueue.disabled = blocked;
    btnEnqueue.setAttribute('aria-label', `เข้าคิว ${song.title}${blockedLabel}`);
    btnEnqueue.append(createIcon('plus'));
    const enqText = document.createElement('span');
    enqText.textContent = 'เข้าคิว';
    btnEnqueue.appendChild(enqText);
    btnEnqueue.addEventListener('click', () => {
      const wasIdle = !state.current;
      const nextPos = state.queue.length + 1;
      void sendCommand({ type: 'enqueue', song: toCommandSong(song) }).then((ok) => {
        if (!ok) return;
        if (wasIdle) {
          showToast(`กำลังเล่น "${song.title}"`);
        } else {
          showToast(`เพิ่ม "${song.title}" เข้าคิวลำดับที่ ${nextPos}`);
        }
      });
    });

    const btnNext = document.createElement('button');
    btnNext.type = 'button';
    btnNext.className = 'btn-round btn-next';
    btnNext.disabled = blocked;
    btnNext.setAttribute('aria-label', `เล่นถัดไป ${song.title}${blockedLabel}`);
    btnNext.append(createIcon('next'));
    btnNext.addEventListener('click', () => {
      const wasIdle = !state.current;
      void sendCommand({ type: 'enqueueNext', song: toCommandSong(song) }).then((ok) => {
        if (!ok) return;
        if (wasIdle) {
          showToast(`กำลังเล่น "${song.title}"`);
        } else {
          showToast(`เพิ่ม "${song.title}" เป็นเพลงถัดไป`);
        }
      });
    });

    actions.append(btnEnqueue, btnNext);
    info.appendChild(actions);
    li.append(thumb, info);
    list.appendChild(li);
  }

  panel.appendChild(list);
}

function renderQueuePanel() {
  if (queueDragSort?.isDragging()) {
    queueRenderPending = true;
    return;
  }
  queueRenderPending = false;
  const panel = panels.queue;
  const focusedHandle = document.activeElement?.closest('.drag-handle');
  const focusQid = panel.contains(focusedHandle)
    ? focusedHandle?.closest('[data-qid]')?.getAttribute('data-qid')
    : null;
  const previousDragSort = queueDragSort;
  queueDragSort = null;
  previousDragSort?.destroy();

  panel.replaceChildren();

  if (state.current) {
    const currentCard = document.createElement('div');
    currentCard.className = 'current-card';

    const top = document.createElement('div');
    top.className = 'card-top';
    top.appendChild(createThumb(state.current, 'queue'));

    const info = document.createElement('div');
    info.className = 'card-info';

    const liveBadge = document.createElement('span');
    liveBadge.className = 'eyebrow';
    liveBadge.textContent = 'กำลังร้อง';

    const title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = state.current.title;

    const meta = document.createElement('p');
    meta.className = 'card-meta';
    const dur = state.current.duration || formatDuration(state.current.durationSec);
    const by =
      typeof state.current.by === 'string' && state.current.by.trim()
        ? state.current.by.trim()
        : '';
    const parts = [];
    if (state.current.channel) parts.push(state.current.channel);
    if (by) parts.push(`ขอโดย ${by}`);
    if (dur) parts.push(dur);
    meta.textContent = parts.join(' · ');

    info.append(liveBadge, title, meta);
    top.appendChild(info);
    currentCard.appendChild(top);
    panel.appendChild(currentCard);
  }

  const header = document.createElement('div');
  header.className = 'panel-header';

  const heading = document.createElement('h2');
  heading.className = 'panel-heading';
  heading.textContent = 'คิวถัดไป';

  const summary = document.createElement('p');
  summary.className = 'panel-summary';
  summary.textContent = `${state.queue.length} เพลง · รวม ${formatDuration(totalDurationSec(state))}`;
  header.append(heading, summary);
  panel.appendChild(header);

  if (state.queue.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'panel-state';
    const text = document.createElement('p');
    text.className = 'panel-state-text';
    text.textContent = 'คิวว่าง ค้นหาเพลงแล้วกดเข้าคิวได้เลย';
    empty.appendChild(text);
    panel.appendChild(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'list';

  state.queue.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'qrow';
    li.setAttribute('data-qid', item.qid);

    const num = document.createElement('span');
    num.className = index >= 9 ? 'num-rank is-long' : 'num-rank';
    num.textContent = String(index + 1);

    li.append(num, createThumb(item, 'queue'));

    const info = document.createElement('div');
    info.className = 'card-info';

    const title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = item.title;

    const meta = document.createElement('p');
    meta.className = 'card-meta';
    const duration = item.duration || formatDuration(item.durationSec);

    const by = typeof item.by === 'string' && item.by.trim() ? item.by.trim() : '';
    if (by) {
      meta.textContent = `${duration} · ขอโดย ${by}`;
    } else if (item.channel) {
      meta.textContent = `${duration} · ${item.channel}`;
    } else {
      meta.textContent = duration;
    }

    info.append(title, meta);
    li.appendChild(info);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'btn-round drag-handle';
    handle.setAttribute('aria-label', 'ลากเพื่อจัดลำดับ หรือกดลูกศรขึ้น–ลง');
    handle.disabled = state.queue.length === 1;
    handle.appendChild(createIcon('grip'));
    li.appendChild(handle);

    const actions = document.createElement('div');
    actions.className = 'r-queue-actions';

    const btnTop = document.createElement('button');
    btnTop.type = 'button';
    btnTop.className = 'btn-glass';
    btnTop.disabled = index === 0;
    btnTop.setAttribute('aria-label', `ขึ้นบนสุด ${item.title}`);
    btnTop.append(createIcon('top'));
    const topLabel = document.createElement('span');
    topLabel.textContent = 'ขึ้นบนสุด';
    btnTop.appendChild(topLabel);
    btnTop.addEventListener('click', () => {
      void sendCommand({ type: 'moveToTop', qid: item.qid });
    });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-glass';
    btnRemove.setAttribute('aria-label', `ลบ ${item.title} ออกจากคิว`);
    btnRemove.append(createIcon('trash'));
    const removeLabel = document.createElement('span');
    removeLabel.textContent = 'ลบ';
    btnRemove.appendChild(removeLabel);
    btnRemove.addEventListener('click', () => {
      void sendCommand({ type: 'remove', qid: item.qid });
    });

    actions.append(btnTop, btnRemove);
    li.appendChild(actions);
    list.appendChild(li);
  });

  panel.appendChild(list);
  queueDragSort = createDragSort({
    list,
    scroller: null,
    onMove: (qid, delta) => {
      void sendCommand({ type: 'move', qid, delta });
    },
    onDragState: (isDragging) => {
      if (!isDragging && queueRenderPending && !isBadKey) renderQueuePanel();
    },
  });
  if (focusQid !== null) {
    // Compare attribute values directly so qids never become CSS selectors.
    for (const row of list.children) {
      if (row.getAttribute('data-qid') === focusQid) {
        row.querySelector('.drag-handle').focus({ preventScroll: true });
        break;
      }
    }
  }
}

function renderAll() {
  queueCountEl.textContent = String(state.queue.length);
  renderNowBar();
  renderResultsPanel();
  renderQueuePanel();
}

async function checkSearchEmbeddable(results) {
  const ids = [...new Set(results.map(song => song.id))].filter(id => !embedFlags.has(id));
  if (!ids.length) return;
  try {
    const query = new URLSearchParams({ ids: ids.join(','), k: roomKey });
    const response = await fetch(`/api/embeddable?${query}`);
    if (!response.ok) return;
    const flags = await response.json();
    for (const id of ids) {
      if (typeof flags?.[id] === 'boolean') embedFlags.set(id, flags[id]);
    }
    if (!isBadKey && searchStatus === 'done' && searchResults === results) renderResultsPanel();
  } catch { /* Playability checks are optional; leave search and room status alone. */ }
}

async function runSearch(rawQuery) {
  if (isBadKey) return;
  const query = rawQuery.trim();
  if (!query) return;

  lastQuery = query;
  if (activeSearchController) {
    activeSearchController.abort();
  }
  const controller = new AbortController();
  activeSearchController = controller;

  setActiveTab('results');
  searchStatus = 'loading';
  renderResultsPanel();

  try {
    const result = await search(query, { signal: controller.signal, key: roomKey });
    if (activeSearchController !== controller || isBadKey) return;
    activeSearchController = null;
    searchNote.textContent = `ค้นหา: ${result.query}`;
    searchResults = result.items;
    searchStatus = 'done';
    renderResultsPanel();
    if (activeTab === 'results') revealActivePanel();
    void checkSearchEmbeddable(searchResults);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (activeSearchController !== controller || isBadKey) return;
    activeSearchController = null;
    if (err?.status === 401 || err?.code === 'bad_key') {
      enterBadKey();
      return;
    }
    searchStatus = 'error';
    renderResultsPanel();
  }
}

// Event wiring
nameInput.value = loadSavedName();
nameInput.addEventListener('input', () => {
  saveName(nameInput.value);
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  void runSearch(q);
});

for (const key of tabOrder) {
  tabs[key].addEventListener('click', () => {
    setActiveTab(key);
  });
  tabs[key].addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const currentIndex = tabOrder.indexOf(key);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextKey = tabOrder[(currentIndex + delta + tabOrder.length) % tabOrder.length];
    setActiveTab(nextKey);
    tabs[nextKey].focus();
  });
}

btnRestart.addEventListener('click', () => {
  if (!state.current) return;
  void sendCommand({ type: 'control', action: 'restart' });
});

btnToggle.addEventListener('click', () => {
  if (!state.current) return;
  void sendCommand({ type: 'control', action: 'toggle' });
});

btnSkip.addEventListener('click', () => {
  if (!state.current) return;
  if (skipConfirmArmed) {
    const qid = state.current.qid;
    resetSkipConfirm();
    renderNowBar();
    void sendCommand({ type: 'advance', qid });
    return;
  }

  skipConfirmArmed = true;
  renderNowBar();
  skipConfirmTimer = setTimeout(() => {
    skipConfirmTimer = null;
    skipConfirmArmed = false;
    renderNowBar();
  }, SKIP_CONFIRM_MS);
});

// Bootstrap
function init() {
  if (!roomKey) {
    enterBadKey();
    return;
  }
  setActiveTab('results');
  renderAll();
  sync.start();
}

init();
