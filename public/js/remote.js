import {
  totalDurationSec,
  formatDuration,
} from './store.js';
import { search, fetchEmbeddable, joinRoom } from './api.js';
import { createSync } from './sync.js';
import { takeToken, saveToken, forgetToken } from './session.js';
import { createDragSort } from './drag-sort.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NAME_STORAGE_KEY = 'karaoke.remote.name';
const SKIP_CONFIRM_MS = 3000;
const TOAST_TTL_MS = 3500;
const TERMINAL_MESSAGES = {
  bad_key: 'รหัสห้องเปลี่ยนแล้ว สแกน QR จากจอหลักอีกครั้ง',
  gone: 'ห้องนี้ถูกปิดแล้ว',
};
const JOIN_ERRORS = {
  no_such_pin: 'รหัสไม่ถูกต้อง ดูรหัสบนจอหลักอีกครั้ง',
  bad_pin: 'ใส่รหัสให้ครบ 6 หลัก',
  too_many_attempts: 'มีการลองรหัสผิดบ่อยเกินไป รอสักครู่แล้วลองใหม่ หรือสแกน QR แทน',
};
const JOIN_GENERIC_ERROR = 'เข้าร่วมไม่สำเร็จ ลองอีกครั้ง';
const BLOCKED_REASON_TEXT =
  'เจ้าของวิดีโอไม่อนุญาตให้เล่นนอก YouTube ลองเลือกเพลงเดียวกันจากช่องอื่น';

const statusEl = document.getElementById('r-status');
const statusBannerEl = document.getElementById('r-status-banner');
const joinCardEl = document.getElementById('r-join-card');
const joinLogoEl = document.getElementById('r-join-logo');
const joinIconEl = document.getElementById('r-join-icon');
const joinTitleEl = document.getElementById('r-join-title');
const joinDescEl = document.getElementById('r-join-desc');
const joinForm = document.getElementById('r-join-form');
const pinInput = document.getElementById('r-pin-input');
const joinErrorEl = document.getElementById('r-join-error');
const btnJoin = document.getElementById('r-btn-join');
const backdropEl = document.getElementById('r-backdrop');
const nowBarEl = document.getElementById('r-now');
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
const roomBarEl = document.getElementById('r-room-bar');
const roomNameEl = document.getElementById('r-room-name');
const topEl = document.getElementById('r-top');
const nameInput = document.getElementById('r-name');
const searchForm = document.getElementById('r-search-form');
const searchInput = document.getElementById('r-search-input');
const searchSubmitBtn = searchForm.querySelector('button[type="submit"]');
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

let state = { current: null, queue: [], playerState: 'idle' };
let terminalState = null; // null | 'no_token' | 'bad_key' | 'gone'
let joiningRoom = false;
let activeToken = '';
let sync = null;
let roomName = '';
let activeTab = 'results';
let searchStatus = 'idle'; // 'idle' | 'loading' | 'done' | 'error'
let searchResults = [];
const embedFlags = new Map();
let lastQuery = '';
let activeSearchController = null;
let activeEmbedController = null;
let skipConfirmArmed = false;
let skipConfirmTimer = null;
let lastCurrentQid = null;
let lastBackdropUrl = '';
let queueDragSort = null;
let queueRenderPending = false;
let queueDragInProgress = false;
let lastQueueMoveFromDrag = false;

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

function getByName(song) {
  return typeof song?.by === 'string' && song.by.trim() ? song.by.trim() : '';
}

function createPanelState(message) {
  const box = document.createElement('div');
  box.className = 'panel-state';
  const text = document.createElement('p');
  text.className = 'panel-state-text';
  text.textContent = message;
  box.appendChild(text);
  return box;
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
  if (terminalState) return;
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

function renderRoomName() {
  if (!roomBarEl || !roomNameEl) return;
  if (roomName) {
    roomNameEl.textContent = roomName;
    roomNameEl.setAttribute('title', roomName);
    roomBarEl.hidden = false;
  } else {
    roomNameEl.textContent = '';
    roomNameEl.removeAttribute('title');
    roomBarEl.hidden = true;
  }
}

function setJoinError(message) {
  if (message) {
    joinErrorEl.textContent = message;
    joinErrorEl.hidden = false;
    pinInput.setAttribute('aria-invalid', 'true');
  } else {
    joinErrorEl.textContent = '';
    joinErrorEl.hidden = true;
    pinInput.removeAttribute('aria-invalid');
  }
}

function setJoinBusy(busy) {
  joiningRoom = busy;
  pinInput.disabled = busy;
  btnJoin.disabled = busy;
  btnJoin.textContent = busy ? 'กำลังเข้าร่วม…' : 'เข้าร่วม';
}

async function submitJoin() {
  if (joiningRoom || !terminalState) return;

  const digits = pinInput.value.replace(/\D/g, '');
  if (digits.length !== 6) {
    setJoinError('ใส่รหัสให้ครบ 6 หลัก');
    pinInput.focus();
    return;
  }

  setJoinError('');
  setJoinBusy(true);

  try {
    const joined = await joinRoom(digits);
    const saved = saveToken('g', joined?.guestToken);
    if (!saved) {
      setJoinError(JOIN_GENERIC_ERROR);
      setJoinBusy(false);
      pinInput.focus();
      return;
    }
    window.location.reload();
  } catch (err) {
    const code = err?.code;
    const message = JOIN_ERRORS[code] || JOIN_GENERIC_ERROR;
    setJoinError(message);
    setJoinBusy(false);
    if (code === 'no_such_pin') {
      pinInput.value = '';
    }
    pinInput.focus();
  }
}

function createTerminalIcon(reason) {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('class', 'r-bad-key-icon');
  icon.setAttribute('width', '56');
  icon.setAttribute('height', '56');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');

  if (reason === 'gone') {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '2');
    icon.appendChild(circle);

    const mark = document.createElementNS(SVG_NS, 'path');
    mark.setAttribute('d', 'M12 7v6M12 16.5v.5');
    mark.setAttribute('fill', 'none');
    mark.setAttribute('stroke', 'currentColor');
    mark.setAttribute('stroke-width', '2.2');
    mark.setAttribute('stroke-linecap', 'round');
    icon.appendChild(mark);
    return icon;
  }

  const key = document.createElementNS(SVG_NS, 'path');
  key.setAttribute('d', 'M14 3a7 7 0 0 0-6.7 9L2 17.3V22h4v-3h3v-3l2-2A7 7 0 1 0 14 3zM16 7h.01');
  key.setAttribute('fill', 'none');
  key.setAttribute('stroke', 'currentColor');
  key.setAttribute('stroke-width', '2');
  key.setAttribute('stroke-linejoin', 'round');
  key.setAttribute('stroke-linecap', 'round');
  icon.appendChild(key);
  return icon;
}

function enterTerminalState(reason) {
  if (terminalState) return;
  terminalState = reason;
  if (reason === 'bad_key') {
    forgetToken('g');
  }
  queueDragSort?.destroy();
  queueDragSort = null;
  queueDragInProgress = false;
  lastQueueMoveFromDrag = false;
  resetSkipConfirm();
  sync?.stop();
  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }
  if (activeEmbedController) {
    activeEmbedController.abort();
    activeEmbedController = null;
  }

  searchInput.disabled = true;
  if (searchSubmitBtn) searchSubmitBtn.disabled = true;
  nameInput.disabled = true;

  nowBarEl.hidden = true;
  mainEl.hidden = true;
  toastsEl.hidden = true;
  backdropEl.classList.remove('is-on');

  const modifier = reason.replace('_', '-');
  statusEl.className = `r-status r-status-full r-status-${modifier}`;
  statusBannerEl.hidden = true;
  statusBannerEl.textContent = '';

  const isJoinFresh = reason === 'no_token';
  joinLogoEl.hidden = !isJoinFresh;
  if (isJoinFresh) {
    joinIconEl.replaceChildren();
    joinIconEl.hidden = true;
    joinTitleEl.className = 'r-join-title';
    joinTitleEl.textContent = 'เข้าร่วมห้อง';
    joinDescEl.textContent = 'ใส่รหัส 6 หลักที่แสดงบนจอหลัก หรือสแกน QR';
    joinDescEl.hidden = false;
  } else {
    joinIconEl.replaceChildren(createTerminalIcon(reason));
    joinIconEl.hidden = false;
    joinTitleEl.className = 'r-bad-key-text';
    joinTitleEl.textContent = TERMINAL_MESSAGES[reason] || TERMINAL_MESSAGES.bad_key;
    joinDescEl.textContent = '';
    joinDescEl.hidden = true;
  }

  pinInput.value = '';
  setJoinBusy(false);
  setJoinError('');

  joinCardEl.hidden = false;
  statusEl.hidden = false;
  pinInput.focus();
}

function updateConnectionStatus(status) {
  if (status === 'bad_key') {
    enterTerminalState('bad_key');
    return;
  }
  if (status === 'gone') {
    enterTerminalState('gone');
    return;
  }
  if (terminalState) return;

  if (status === 'offline') {
    statusEl.className = 'r-status';
    joinCardEl.hidden = true;
    statusBannerEl.textContent = 'กำลังเชื่อมต่อใหม่…';
    statusBannerEl.hidden = false;
    statusEl.hidden = false;
  } else {
    statusBannerEl.hidden = true;
    statusBannerEl.textContent = '';
    statusEl.hidden = true;
  }
}

function handleRoomInfo(info) {
  if (terminalState) return;
  if (!info || info.role !== 'g') {
    enterTerminalState('bad_key');
    return;
  }
  const nextName = typeof info.name === 'string' ? info.name.trim() : '';
  if (nextName) {
    roomName = nextName;
    renderRoomName();
  }
}

function handleTerminalError(err) {
  if (
    err?.status === 401 ||
    err?.code === 'bad_token' ||
    err?.code === 'stale_token' ||
    err?.code === 'bad_key'
  ) {
    enterTerminalState('bad_key');
    return true;
  }
  if (err?.status === 404 || err?.code === 'no_room') {
    enterTerminalState('gone');
    return true;
  }
  return false;
}

function sendCommand(cmd) {
  if (terminalState || !sync) return Promise.resolve(false);
  return sync.send(cmd).then(
    () => true,
    (err) => {
      if (handleTerminalError(err)) {
        return false;
      }
      if (err?.status === 409 || err?.code === 'queue_full') {
        showToast('คิวเต็มแล้ว (200 เพลง)', { warn: true });
      } else if (err?.status === 403 || err?.code === 'owner_only') {
        showToast('ทำได้เฉพาะที่จอหลัก', { warn: true });
      } else {
        showToast('ส่งคำสั่งไม่สำเร็จ ลองอีกครั้ง', { warn: true });
      }
      if (cmd.type === 'move' || cmd.type === 'moveTo') renderQueuePanel();
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
    nowTitleEl.hidden = false;
    nowTitleEl.textContent = current.title;
    const by = getByName(current);
    nowSubEl.textContent = by ? `ขอโดย ${by}` : current.channel || '';
  } else {
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
    const box = createPanelState('ค้นหาไม่สำเร็จ');

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

    box.appendChild(retryBtn);
    panel.appendChild(box);
    return;
  }

  if (searchStatus === 'done' && searchResults.length === 0) {
    panel.appendChild(createPanelState('ไม่พบเพลง ลองพิมพ์ชื่อเพลงหรือชื่อศิลปินแบบอื่น'));
    return;
  }

  if (searchResults.length === 0) {
    panel.appendChild(createPanelState('พิมพ์ชื่อเพลงหรือศิลปิน ระบบจะเติม "คาราโอเกะ" ให้เอง'));
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

    if (blocked) {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'pill is-warn badge-blocked';
      badge.textContent = 'เล่นที่นี่ไม่ได้';
      badge.setAttribute('aria-label', 'เล่นที่นี่ไม่ได้ ดูเหตุผล');
      badge.addEventListener('click', () => {
        showToast(BLOCKED_REASON_TEXT, { warn: true });
      });
      thumb.appendChild(badge);
    } else if (isInQueueOrCurrent(song.id)) {
      const badge = document.createElement('span');
      badge.className = 'pill is-cyan';
      badge.textContent = 'ในคิวแล้ว';
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

  const hasBlocked = searchResults.some((song) => embedFlags.get(song.id) === false);
  if (hasBlocked) {
    const note = document.createElement('p');
    note.className = 'blocked-note';
    const link = document.createElement('a');
    link.className = 'blocked-note-link';
    link.href = '/help#blocked';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'ทำไม?';
    note.append(
      document.createTextNode('บางเพลงเล่นที่นี่ไม่ได้เพราะเจ้าของวิดีโอไม่อนุญาต '),
      link
    );
    panel.appendChild(note);
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
    const by = getByName(state.current);
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
    panel.appendChild(createPanelState('คิวว่าง ค้นหาเพลงแล้วกดเข้าคิวได้เลย'));
    return;
  }

  const list = document.createElement('ol');

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

    const by = getByName(item);
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
    onMove: (qid, delta, beforeQid) => {
      const fromDrag = lastQueueMoveFromDrag;
      lastQueueMoveFromDrag = false;
      const cmd = fromDrag
        ? { type: 'moveTo', qid, beforeQid: beforeQid ?? null }
        : { type: 'move', qid, delta };
      void sendCommand(cmd);
    },
    onDragState: (isDragging) => {
      if (isDragging) {
        queueDragInProgress = true;
        lastQueueMoveFromDrag = false;
        return;
      }
      if (queueDragInProgress) {
        queueDragInProgress = false;
        lastQueueMoveFromDrag = true;
        queueMicrotask(() => {
          lastQueueMoveFromDrag = false;
        });
      }
      if (queueRenderPending && !terminalState) renderQueuePanel();
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
  if (terminalState || !activeToken || !Array.isArray(results) || results.length === 0) return;
  const ids = [...new Set(results.map((song) => song.id))].filter(
    (id) => typeof id === 'string' && id.length > 0 && !embedFlags.has(id)
  );
  if (!ids.length) return;

  if (activeEmbedController) {
    activeEmbedController.abort();
  }
  const controller = new AbortController();
  activeEmbedController = controller;

  try {
    const flags = await fetchEmbeddable(ids, {
      signal: controller.signal,
      token: activeToken,
    });
    if (activeEmbedController === controller) {
      activeEmbedController = null;
    }
    if (controller.signal.aborted || terminalState) return;
    let changed = false;
    for (const id of ids) {
      if (typeof flags?.[id] === 'boolean' && embedFlags.get(id) !== flags[id]) {
        embedFlags.set(id, flags[id]);
        changed = true;
      }
    }
    if (changed && searchStatus === 'done' && searchResults === results) renderResultsPanel();
  } catch {
    if (activeEmbedController === controller) {
      activeEmbedController = null;
    }
    /* Playability checks are optional; leave search and room status alone. */
  }
}

async function runSearch(rawQuery) {
  if (terminalState || !activeToken) return;
  const query = rawQuery.trim();
  if (!query) return;

  lastQuery = query;
  if (activeSearchController) {
    activeSearchController.abort();
  }
  if (activeEmbedController) {
    activeEmbedController.abort();
    activeEmbedController = null;
  }
  const controller = new AbortController();
  activeSearchController = controller;

  setActiveTab('results');
  searchStatus = 'loading';
  renderResultsPanel();

  try {
    const result = await search(query, { signal: controller.signal, token: activeToken });
    if (activeSearchController !== controller || terminalState) return;
    activeSearchController = null;
    searchNote.textContent = `ค้นหา: ${result.query}`;
    searchResults = result.items;
    searchStatus = 'done';
    renderResultsPanel();
    if (activeTab === 'results') revealActivePanel();
    void checkSearchEmbeddable(searchResults);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (activeSearchController !== controller || terminalState) return;
    activeSearchController = null;
    if (handleTerminalError(err)) return;
    searchStatus = 'error';
    renderResultsPanel();
  }
}

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitJoin();
});

pinInput.addEventListener('input', () => {
  if (joiningRoom) return;
  if (!joinErrorEl.hidden) {
    setJoinError('');
  }
  const digits = pinInput.value.replace(/\D/g, '');
  if (digits.length === 6) {
    void submitJoin();
  }
});

nameInput.value = loadSavedName();
nameInput.addEventListener('input', () => {
  saveName(nameInput.value);
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (terminalState) return;
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
  if (terminalState || !state.current) return;
  void sendCommand({ type: 'control', action: 'restart' });
});

btnToggle.addEventListener('click', () => {
  if (terminalState || !state.current) return;
  void sendCommand({ type: 'control', action: 'toggle' });
});

btnSkip.addEventListener('click', () => {
  if (terminalState || !state.current) return;
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

function init() {
  // A freshly scanned link opened in this same tab only changes the hash; reload to pick it up.
  window.addEventListener('hashchange', () => {
    if (window.location.hash.startsWith('#g=')) window.location.reload();
  });

  const session = takeToken('g');
  if (!session) {
    enterTerminalState('no_token');
    return;
  }

  activeToken = session.token;
  sync = createSync({
    token: session.token,
    roomId: session.roomId,
    onState: (snapshot) => {
      if (terminalState) return;
      const snapName = typeof snapshot?.name === 'string' ? snapshot.name.trim() : '';
      if (snapName && !roomName) {
        roomName = snapName;
        renderRoomName();
      }
      const nextQid = snapshot?.current?.qid ?? null;
      if (nextQid !== lastCurrentQid) {
        lastCurrentQid = nextQid;
        resetSkipConfirm();
      }
      state = {
        current: snapshot?.current ?? null,
        queue: Array.isArray(snapshot?.queue) ? snapshot.queue : [],
        playerState: typeof snapshot?.playerState === 'string' ? snapshot.playerState : 'idle',
      };
      renderAll();
    },
    onStatus: (status) => {
      updateConnectionStatus(status);
    },
    onRoom: (info) => {
      handleRoomInfo(info);
    },
  });

  setActiveTab('results');
  renderAll();
  sync.start();
}

init();
