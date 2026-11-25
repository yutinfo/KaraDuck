import {
  createState,
  totalDurationSec,
  formatDuration,
} from './store.js';
import { applyCommand } from './commands.js';
import { search, getRoom, fetchEmbeddable } from './api.js';
import { createPlayer } from './player.js';
import { createSync } from './sync.js';
import { takeToken, forgetToken } from './session.js';
import { createDragSort } from './drag-sort.js';
import { DEMO_QUERY, DEMO_SONGS } from './demo-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const YT_ID_RE = /^[\w-]{11}$/;
const ERROR_SKIP_DELAY_MS = 2500;
const AUTOPLAY_CHECK_DELAY_MS = 4000;
const CONFIRM_RESET_MS = 3000;
const TOAST_TTL_MS = 3500;
const ADVANCE_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const REPORT_DEBOUNCE_MS = 1000;
const AUTOPLAY_HINT_TEXT =
  'กด ▶ หนึ่งครั้งเพื่อเปิดเสียง หลังจากนั้นเพลงจะเล่นต่อเองจากมือถือได้';
const GATE_MESSAGES = {
  no_token: {
    title: 'ต้องเปิดจากลิงก์ห้อง',
    desc: 'หน้านี้ต้องเปิดจากลิงก์เจ้าของห้อง กรุณาขอลิงก์ห้องจากผู้ดูแล',
  },
  bad_key: {
    title: 'ลิงก์ห้องนี้ใช้ไม่ได้แล้ว',
    desc: 'ลิงก์ห้องหมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ห้องใหม่จากผู้ดูแล',
  },
  gone: {
    title: 'ห้องนี้ถูกปิดแล้ว',
    desc: 'ผู้ดูแลได้ปิดห้องนี้แล้ว หากต้องการใช้งานต่อ กรุณาขอลิงก์ห้องใหม่จากผู้ดูแล',
  },
};

const params = new URLSearchParams(location.search);
const isDemo = params.get('demo') === '1';
const demoIdle = params.get('idle') === '1';
const rawDemoTab = params.get('tab');
const initialTab =
  rawDemoTab === 'queue' ||
  rawDemoTab === 'history' ||
  rawDemoTab === 'results' ||
  rawDemoTab === 'remote'
    ? rawDemoTab
    : 'results';

// DOM references
const backdropEl = document.getElementById('backdrop');
const appEl = document.getElementById('app');
const roomNameEl = document.getElementById('room-name');
const btnOpenRemote = document.getElementById('btn-open-remote');
const stageCol = document.getElementById('stage-col');
const playerWrap = document.getElementById('player-wrap');
const stageIdle = document.getElementById('stage-idle');
const stageIdleQr = document.getElementById('stage-idle-qr');
const stageQrFrame = document.getElementById('stage-qr-frame');
const stageQrImg = document.getElementById('stage-qr-img');
const stageQrCaption = document.getElementById('stage-qr-caption');
const stageQrUrl = document.getElementById('stage-qr-url');
const stageUnavailable = document.getElementById('stage-unavailable');
const btnRetryPlayer = document.getElementById('btn-retry-player');
const roomGateEl = document.getElementById('room-gate');
const roomGateTitleEl = document.getElementById('room-gate-title');
const roomGateDescEl = document.getElementById('room-gate-desc');

const nowbarEl = document.getElementById('nowbar');
const nowbarTitle = document.getElementById('nowbar-title');
const nowbarMeta = document.getElementById('nowbar-meta');
const nowbarDuration = document.getElementById('nowbar-duration');
const nowbarChannel = document.getElementById('nowbar-channel');
const nowbarBySep = document.getElementById('nowbar-by-sep');
const nowbarBy = document.getElementById('nowbar-by');
const nowbarNext = document.getElementById('nowbar-next');
const nowbarNextInline = document.getElementById('nowbar-next-inline');
const btnRestart = document.getElementById('btn-restart');
const btnToggle = document.getElementById('btn-toggle');
const btnToggleLabel = document.getElementById('btn-toggle-label');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnSkip = document.getElementById('btn-skip');
const btnStageMode = document.getElementById('btn-stage-mode');

const syncStatusEl = document.getElementById('sync-status');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchNote = document.getElementById('search-note');

const tabOrder = ['results', 'queue', 'history', 'remote'];
const tabs = {
  results: document.getElementById('tab-results'),
  queue: document.getElementById('tab-queue'),
  history: document.getElementById('tab-history'),
  remote: document.getElementById('tab-remote'),
};
const panels = {
  results: document.getElementById('panel-results'),
  queue: document.getElementById('panel-queue'),
  history: document.getElementById('panel-history'),
  remote: document.getElementById('panel-remote'),
};
const queueCountEl = document.getElementById('queue-count');
const toastsEl = document.getElementById('toasts');

// App runtime state
let state = createState();
let hasReceivedFirstSnapshot = false;
let lastQid = null;
let lastBackdropId = null;
let activeTab = 'results';
const embedFlags = new Map();
let searchStatus = 'idle'; // 'idle' | 'loading' | 'done' | 'error'
let searchResults = [];
let lastQuery = '';
let activeSearchController = null;
let activeEmbedController = null;
let playerState = 'idle';
let playerUnavailable = false;
let errorSkipTimer = null;
let autoplayCheckTimer = null;
let autoplayBlocked = false;

let activeToken = '';
let sync = null;
let player = null;
let blockedReason = null; // null | 'no_token' | 'bad_key' | 'gone'
let roomName = '';
let roomInfoStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'demo'
let roomInfo = null;
let rotatingGuest = false;
let activeRoomRefreshController = null;

let advanceRetryTimer = null;
let advanceRetryQid = null;
let advanceRetryGeneration = 0;

let reportTimer = null;
let lastReportedPlayerState = null;

let queueDragSort = null;
let queueRenderPending = false;
let pendingFocusHandleQid = null;
let queueDragInProgress = false;
let lastQueueMoveFromDrag = false;

const confirmTimers = {
  queue: null,
  history: null,
  rotateGuest: null,
};
const confirmArmed = {
  queue: false,
  history: false,
  rotateGuest: false,
};

// Icon helper (safe DOM SVG construction, no innerHTML)
const ICON_PATHS = {
  plus: ['M12 5v14M5 12h14'],
  next: ['M5 5l10 7-10 7zM17 5h2v14h-2z'],
  play: ['M8 5v14l11-7z'],
  top: ['M6 6h12M12 10l-5 6h10z'],
  trash: ['M6 6l12 12M18 6L6 18'],
};
const GRIP_DOTS = [
  [9, 6],
  [15, 6],
  [9, 12],
  [15, 12],
  [9, 18],
  [15, 18],
];

function createIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  if (name === 'grip') {
    for (const [cx, cy] of GRIP_DOTS) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(cy));
      dot.setAttribute('r', '1.8');
      dot.setAttribute('fill', 'currentColor');
      svg.appendChild(dot);
    }
    return svg;
  }

  const paths = ICON_PATHS[name] || [];
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (name === 'play' || name === 'next') {
      path.setAttribute('fill', 'currentColor');
    } else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', name === 'plus' ? '2.5' : '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(path);
  }
  return svg;
}

function createEyebrow() {
  const eyebrow = document.createElement('span');
  eyebrow.className = 'eyebrow';

  const eq = document.createElement('span');
  eq.className = 'eq';
  eq.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) {
    eq.appendChild(document.createElement('i'));
  }

  eyebrow.append(eq, document.createTextNode('กำลังร้อง'));
  return eyebrow;
}

function isSafeImageUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function formatChannelWithBy(song) {
  const channel = typeof song?.channel === 'string' ? song.channel : '';
  const by = typeof song?.by === 'string' && song.by.trim().length > 0 ? song.by.trim() : '';
  if (channel && by) {
    return `${channel} · ขอโดย ${by}`;
  }
  if (by) {
    return `ขอโดย ${by}`;
  }
  return channel;
}

function toCommandSong(song) {
  return {
    id: song.id,
    title: song.title,
    channel: typeof song.channel === 'string' ? song.channel : '',
    duration: typeof song.duration === 'string' ? song.duration : '',
    durationSec: Number.isFinite(song.durationSec) ? song.durationSec : 0,
    thumbnail: typeof song.thumbnail === 'string' ? song.thumbnail : '',
  };
}

function cancelErrorSkip() {
  if (errorSkipTimer !== null) {
    clearTimeout(errorSkipTimer);
    errorSkipTimer = null;
  }
}

function clearAutoplayBlocked() {
  if (autoplayCheckTimer !== null) {
    clearTimeout(autoplayCheckTimer);
    autoplayCheckTimer = null;
  }
  if (autoplayBlocked) {
    autoplayBlocked = false;
  }
}

function armAutoplayCheck(qid) {
  clearAutoplayBlocked();
  if (!qid) return;
  autoplayCheckTimer = setTimeout(() => {
    autoplayCheckTimer = null;
    if (!state.current || state.current.qid !== qid) return;
    if (playerState !== 'playing' && playerState !== 'buffering') {
      autoplayBlocked = true;
      renderNowbar();
    }
  }, AUTOPLAY_CHECK_DELAY_MS);
}

function showToast(message, { warn = false } = {}) {
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

function qrSvgToDataUrl(qrSvg) {
  if (typeof qrSvg !== 'string' || !qrSvg) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;
}

function displayGuestUrl(guestUrl) {
  if (typeof guestUrl !== 'string') return '';
  const hashIndex = guestUrl.indexOf('#');
  return hashIndex === -1 ? guestUrl : guestUrl.slice(0, hashIndex);
}

function renderRoomName() {
  if (!roomNameEl) return;
  if (roomName) {
    roomNameEl.textContent = roomName;
    roomNameEl.setAttribute('title', roomName);
    roomNameEl.hidden = false;
  } else {
    roomNameEl.textContent = '';
    roomNameEl.removeAttribute('title');
    roomNameEl.hidden = true;
  }
}

function cancelAdvanceRetry() {
  advanceRetryGeneration += 1;
  if (advanceRetryTimer !== null) {
    clearTimeout(advanceRetryTimer);
    advanceRetryTimer = null;
  }
  advanceRetryQid = null;
}

function isRetryableAdvanceError(err) {
  return (
    err?.code === 'network_error' ||
    (typeof err?.status === 'number' && err.status >= 500 && err.status < 600)
  );
}

function cancelPendingReport() {
  if (reportTimer !== null) {
    clearTimeout(reportTimer);
    reportTimer = null;
  }
}

function schedulePlayerReport(nextPlayerState) {
  if (isDemo || blockedReason || !sync) return;

  cancelPendingReport();

  if (nextPlayerState === lastReportedPlayerState) {
    return;
  }

  reportTimer = setTimeout(() => {
    reportTimer = null;
    if (blockedReason || !sync) return;
    if (playerState !== nextPlayerState || nextPlayerState === lastReportedPlayerState) {
      return;
    }

    const sentState = nextPlayerState;
    sync.send({ type: 'report', playerState: sentState }).then(
      () => {
        if (blockedReason) return;
        lastReportedPlayerState = sentState;
        if (playerState !== lastReportedPlayerState && reportTimer === null) {
          schedulePlayerReport(playerState);
        }
      },
      (err) => {
        if (err?.status === 401) {
          enterBlockedGate('bad_key');
        } else if (err?.status === 404) {
          enterBlockedGate('gone');
        }
      }
    );
  }, REPORT_DEBOUNCE_MS);
}

function enterBlockedGate(reason) {
  if (blockedReason === reason) return;
  blockedReason = reason;

  if (reason === 'bad_key') {
    forgetToken('o');
  }

  cancelErrorSkip();
  clearAutoplayBlocked();
  cancelAdvanceRetry();
  cancelPendingReport();
  resetConfirm('queue');
  resetConfirm('history');
  resetConfirm('rotateGuest');

  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }
  if (activeEmbedController) {
    activeEmbedController.abort();
    activeEmbedController = null;
  }
  if (activeRoomRefreshController) {
    activeRoomRefreshController.abort();
    activeRoomRefreshController = null;
  }

  if (sync) {
    sync.stop();
  }
  if (player) {
    player.stop();
  }

  syncStatusEl.hidden = true;

  const fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
  if (fsEl) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) {
      Promise.resolve(exit.call(document)).catch(() => {});
    }
  }

  const msg = GATE_MESSAGES[reason] || GATE_MESSAGES.bad_key;
  roomGateTitleEl.textContent = msg.title;
  roomGateDescEl.textContent = msg.desc;
  appEl.inert = true;
  appEl.setAttribute('aria-hidden', 'true');
  roomGateEl.hidden = false;
}

function handleRoomInfo(info) {
  if (blockedReason) return;
  if (!info || info.role !== 'o') {
    enterBlockedGate('bad_key');
    return;
  }
  roomInfo = info;
  roomInfoStatus = 'ready';
  const nextName = typeof info.name === 'string' ? info.name.trim() : '';
  if (nextName) {
    roomName = nextName;
    renderRoomName();
  }
  renderRemotePanel();
  renderStage();
}

function dispatch(cmd, { silent = false, returnError = false } = {}) {
  const finish = (ok, error = null) => (returnError ? { ok, error } : ok);

  if (isDemo) {
    if (cmd.type === 'report' || cmd.type === 'rotateGuest') {
      return Promise.resolve(finish(true));
    }
    try {
      const next = applyCommand(state, cmd);
      handleSnapshot(next);
      return Promise.resolve(finish(true));
    } catch (err) {
      if (!silent) {
        if (err?.code === 'queue_full') {
          showToast('คิวเต็มแล้ว (200 เพลง)', { warn: true });
        } else {
          showToast('ส่งคำสั่งไม่สำเร็จ ลองอีกครั้ง', { warn: true });
        }
      }
      return Promise.resolve(finish(false, err));
    }
  }

  if (blockedReason || !sync) {
    return Promise.resolve(finish(false, null));
  }

  return sync.send(cmd).then(
    () => finish(true),
    (err) => {
      if (err?.status === 401) {
        enterBlockedGate('bad_key');
        return finish(false, err);
      }
      if (err?.status === 404) {
        enterBlockedGate('gone');
        return finish(false, err);
      }
      if (!silent) {
        if (err?.status === 409 || err?.code === 'queue_full') {
          showToast('คิวเต็มแล้ว (200 เพลง)', { warn: true });
        } else {
          showToast('ส่งคำสั่งไม่สำเร็จ ลองอีกครั้ง', { warn: true });
        }
      }
      return finish(false, err);
    }
  );
}

function sendAdvanceWithRetry(cmd) {
  if (!cmd?.qid) return;
  cancelAdvanceRetry();

  if (isDemo) {
    void dispatch(cmd);
    return;
  }

  if (blockedReason || !sync) return;

  const generation = advanceRetryGeneration;
  advanceRetryQid = cmd.qid;
  let attempt = 0;

  const trySend = () => {
    if (
      blockedReason ||
      generation !== advanceRetryGeneration ||
      state.current?.qid !== cmd.qid
    ) {
      if (generation === advanceRetryGeneration) {
        cancelAdvanceRetry();
      }
      return;
    }

    const isFirstAttempt = attempt === 0;
    void dispatch(cmd, { silent: !isFirstAttempt, returnError: true }).then((result) => {
      if (
        blockedReason ||
        generation !== advanceRetryGeneration ||
        state.current?.qid !== cmd.qid
      ) {
        if (generation === advanceRetryGeneration) {
          cancelAdvanceRetry();
        }
        return;
      }
      if (result.ok) {
        cancelAdvanceRetry();
        return;
      }
      if (!isRetryableAdvanceError(result.error)) {
        cancelAdvanceRetry();
        return;
      }
      const delayIndex = Math.min(attempt, ADVANCE_RETRY_DELAYS_MS.length - 1);
      const delay = ADVANCE_RETRY_DELAYS_MS[delayIndex];
      attempt += 1;
      advanceRetryTimer = setTimeout(() => {
        advanceRetryTimer = null;
        trySend();
      }, delay);
    });
  };

  trySend();
}

function initPlayer() {
  return createPlayer({
    elementId: 'player',
    onEnded: () => {
      cancelErrorSkip();
      clearAutoplayBlocked();
      if (blockedReason || !state.current) return;
      sendAdvanceWithRetry({ type: 'advance', qid: state.current.qid });
    },
    onError: () => {
      if (blockedReason || !state.current) return;
      cancelErrorSkip();
      clearAutoplayBlocked();
      const failedQid = state.current.qid;
      showToast('เพลงนี้เล่นในหน้านี้ไม่ได้ กำลังข้ามไปเพลงถัดไป', { warn: true });
      errorSkipTimer = setTimeout(() => {
        errorSkipTimer = null;
        if (blockedReason || !state.current || state.current.qid !== failedQid) return;
        sendAdvanceWithRetry({ type: 'advance', qid: failedQid, skipHistory: true });
      }, ERROR_SKIP_DELAY_MS);
    },
    onState: (nextPlayerState) => {
      playerState = nextPlayerState;
      if (nextPlayerState === 'playing') {
        clearAutoplayBlocked();
      }
      renderNowbar();
      schedulePlayerReport(nextPlayerState);
    },
    onUnavailable: () => {
      playerUnavailable = true;
      renderStage();
    },
  });
}

function handleSnapshot(snapshot, { isFirst = false } = {}) {
  if (blockedReason) return;

  state = {
    current: snapshot?.current ?? null,
    queue: Array.isArray(snapshot?.queue) ? snapshot.queue : [],
    history: Array.isArray(snapshot?.history) ? snapshot.history : [],
  };

  const snapName = typeof snapshot?.name === 'string' ? snapshot.name.trim() : '';
  if (snapName && !roomName) {
    roomName = snapName;
    renderRoomName();
  }

  const nextQid = state.current?.qid ?? null;

  if (advanceRetryQid !== null && nextQid !== advanceRetryQid) {
    cancelAdvanceRetry();
  }

  if (!hasReceivedFirstSnapshot || isFirst) {
    hasReceivedFirstSnapshot = true;
    lastQid = nextQid;
    cancelErrorSkip();
    clearAutoplayBlocked();
    if (state.current) {
      player?.cue(state.current.id);
    } else {
      player?.stop();
    }
  } else if (nextQid !== lastQid) {
    lastQid = nextQid;
    cancelErrorSkip();
    clearAutoplayBlocked();
    playerUnavailable = false;
    if (state.current) {
      player?.load(state.current.id);
      armAutoplayCheck(nextQid);
    } else {
      player?.stop();
    }
  }

  renderAll();
}

async function rotateGuestCode() {
  if (isDemo || blockedReason || rotatingGuest) return;
  rotatingGuest = true;
  renderRemotePanel();

  try {
    const ok = await dispatch({ type: 'rotateGuest' });
    if (!ok || blockedReason) return;

    if (activeRoomRefreshController) {
      activeRoomRefreshController.abort();
    }
    const controller = new AbortController();
    activeRoomRefreshController = controller;

    const fresh = await getRoom({ signal: controller.signal, token: activeToken });
    if (activeRoomRefreshController === controller) {
      activeRoomRefreshController = null;
    }
    if (controller.signal.aborted || blockedReason) return;

    if (!fresh || fresh.role !== 'o') {
      enterBlockedGate('bad_key');
      return;
    }
    roomInfo = fresh;
    roomInfoStatus = 'ready';
    const nextName = typeof fresh.name === 'string' ? fresh.name.trim() : '';
    if (nextName) {
      roomName = nextName;
      renderRoomName();
    }
    renderStage();
    showToast('เปลี่ยนรหัสแขกแล้ว มือถือทุกเครื่องต้องสแกนใหม่');
  } catch (err) {
    if (err?.name === 'AbortError' || blockedReason) return;
    if (err?.status === 401) {
      enterBlockedGate('bad_key');
      return;
    }
    if (err?.status === 404) {
      enterBlockedGate('gone');
      return;
    }
    showToast('เปลี่ยนรหัสแล้ว แต่โหลด QR ใหม่ไม่สำเร็จ ลองรีเฟรชหน้า', { warn: true });
  } finally {
    rotatingGuest = false;
    if (!blockedReason) {
      renderRemotePanel();
    }
  }
}

function isInQueueOrCurrent(songId) {
  if (state.current && state.current.id === songId) return true;
  return state.queue.some((item) => item.id === songId);
}

function createPoster(song, { showInQueue = true, blocked = false } = {}) {
  const poster = document.createElement('div');
  poster.className = 'poster';

  if (isSafeImageUrl(song.thumbnail)) {
    const img = document.createElement('img');
    img.className = 'poster-img';
    img.setAttribute('src', song.thumbnail);
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    poster.appendChild(img);
  }

  if (blocked) {
    const badge = document.createElement('span');
    badge.className = 'pill is-warn poster-inq';
    badge.textContent = 'เล่นที่นี่ไม่ได้';
    poster.appendChild(badge);
  } else if (showInQueue && isInQueueOrCurrent(song.id)) {
    const badge = document.createElement('span');
    badge.className = 'pill is-cyan poster-inq';
    badge.textContent = 'ในคิวแล้ว';
    poster.appendChild(badge);
  }

  const durText = song.duration || (song.durationSec ? formatDuration(song.durationSec) : '');
  if (durText) {
    const dur = document.createElement('span');
    dur.className = 'poster-dur';
    dur.textContent = durText;
    poster.appendChild(dur);
  }

  return poster;
}

function createQueueThumb(song) {
  const wrap = document.createElement('div');
  wrap.className = 'qth';

  if (isSafeImageUrl(song.thumbnail)) {
    const img = document.createElement('img');
    img.setAttribute('src', song.thumbnail);
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    wrap.appendChild(img);
  }

  return wrap;
}

function setActiveTab(tabName) {
  activeTab = tabName;
  for (const key of tabOrder) {
    const isSelected = key === tabName;
    tabs[key].setAttribute('aria-selected', String(isSelected));
    panels[key].hidden = !isSelected;
  }
}

function renderBackdrop() {
  const currentId = typeof state.current?.id === 'string' ? state.current.id : '';
  if (YT_ID_RE.test(currentId)) {
    if (lastBackdropId !== currentId) {
      lastBackdropId = currentId;
      backdropEl.style.backgroundImage = `url("https://i.ytimg.com/vi/${currentId}/hqdefault.jpg")`;
    }
    backdropEl.classList.add('is-on');
  } else {
    lastBackdropId = null;
    backdropEl.classList.remove('is-on');
  }
}

function renderStage() {
  renderBackdrop();

  const hasCurrent = Boolean(state.current);
  if (!hasCurrent) {
    playerWrap.hidden = true;
    stageUnavailable.hidden = true;
    stageIdle.hidden = false;
    const guestUrl = typeof roomInfo?.guestUrl === 'string' ? roomInfo.guestUrl : '';
    const qrDataUrl = qrSvgToDataUrl(roomInfo?.qrSvg);
    if (guestUrl) {
      if (qrDataUrl) {
        if (stageQrImg.getAttribute('src') !== qrDataUrl) {
          stageQrImg.setAttribute('src', qrDataUrl);
        }
        stageQrFrame.hidden = false;
        stageQrCaption.textContent = 'สแกนเพื่อสั่งเพลงจากมือถือ';
        stageQrUrl.textContent = '';
        stageQrUrl.hidden = true;
      } else {
        stageQrImg.removeAttribute('src');
        stageQrFrame.hidden = true;
        stageQrCaption.textContent = 'เปิดลิงก์นี้บนมือถือ';
        stageQrUrl.textContent = displayGuestUrl(guestUrl);
        stageQrUrl.hidden = false;
      }
      stageIdleQr.hidden = false;
    } else {
      stageQrImg.removeAttribute('src');
      stageQrUrl.textContent = '';
      stageQrUrl.hidden = true;
      stageIdleQr.hidden = true;
    }
    return;
  }

  if (playerUnavailable) {
    playerWrap.hidden = true;
    stageIdle.hidden = true;
    stageUnavailable.hidden = false;
    return;
  }

  stageIdle.hidden = true;
  stageUnavailable.hidden = true;
  playerWrap.hidden = false;
}

function setNextLine(el, { showHint }) {
  el.classList.toggle('nowbar-hint', showHint);
  if (showHint) {
    el.textContent = AUTOPLAY_HINT_TEXT;
    return;
  }
  if (state.queue.length > 0) {
    el.replaceChildren(document.createTextNode('ถัดไป: '));
    const strong = document.createElement('strong');
    strong.textContent = state.queue[0].title;
    el.appendChild(strong);
    return;
  }
  el.textContent = 'คิวว่าง — เพิ่มเพลงต่อได้เลย';
}

function renderNowbar() {
  const current = state.current;
  const hasCurrent = Boolean(current);
  const isPlaying = hasCurrent && playerState === 'playing';

  nowbarEl.classList.toggle('is-playing', isPlaying);
  const queueCurrentCard = panels.queue.querySelector('.current-card');
  if (queueCurrentCard) {
    queueCurrentCard.classList.toggle('is-playing', isPlaying);
  }

  nowbarTitle.textContent = hasCurrent ? current.title : 'ยังไม่มีเพลงกำลังเล่น';

  if (hasCurrent) {
    const durText = current.duration || (current.durationSec ? formatDuration(current.durationSec) : '');
    const channelText = typeof current.channel === 'string' ? current.channel : '';
    const byText = typeof current.by === 'string' && current.by.trim().length > 0 ? current.by.trim() : '';

    nowbarDuration.textContent = durText;
    nowbarDuration.hidden = !durText;

    nowbarChannel.textContent = channelText;
    nowbarChannel.hidden = !channelText;

    nowbarBySep.hidden = !(channelText && byText);
    nowbarBy.textContent = byText ? `ขอโดย ${byText}` : '';
    nowbarBy.hidden = !byText;

    nowbarMeta.hidden = !durText && !channelText && !byText;
  } else {
    nowbarDuration.textContent = '';
    nowbarDuration.hidden = true;
    nowbarChannel.textContent = '';
    nowbarChannel.hidden = true;
    nowbarBySep.hidden = true;
    nowbarBy.textContent = '';
    nowbarBy.hidden = true;
    nowbarMeta.hidden = true;
  }

  const showHint = hasCurrent && autoplayBlocked;
  setNextLine(nowbarNext, { showHint });
  setNextLine(nowbarNextInline, { showHint });

  btnRestart.disabled = !hasCurrent;
  btnToggle.disabled = !hasCurrent;
  btnSkip.disabled = !hasCurrent;

  iconPlay.toggleAttribute('hidden', isPlaying); // SVG has no .hidden property
  iconPause.toggleAttribute('hidden', !isPlaying);
  btnToggle.setAttribute('aria-label', isPlaying ? 'หยุดชั่วคราว' : 'เล่น');
  if (btnToggleLabel) {
    btnToggleLabel.textContent = isPlaying ? 'หยุด' : 'เล่น';
  }
}

function renderResultsPanel() {
  const panel = panels.results;
  panel.replaceChildren();

  if (searchStatus === 'loading') {
    const rowhead = document.createElement('div');
    rowhead.className = 'rowhead';
    const heading = document.createElement('h2');
    heading.className = 'rowhead-title';
    heading.textContent = 'ผลค้นหา';
    rowhead.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.setAttribute('aria-hidden', 'true');

    for (let i = 0; i < 6; i += 1) {
      const skel = document.createElement('div');
      skel.className = 'tile tile-skeleton';

      const poster = document.createElement('div');
      poster.className = 'poster skeleton-box';

      const body = document.createElement('div');
      body.className = 'tbody';

      const l1 = document.createElement('div');
      l1.className = 'skeleton-box skeleton-line';
      const l2 = document.createElement('div');
      l2.className = 'skeleton-box skeleton-line-short';
      const btn = document.createElement('div');
      btn.className = 'skeleton-box skeleton-btn';

      body.append(l1, l2, btn);
      skel.append(poster, body);
      grid.appendChild(skel);
    }

    panel.append(rowhead, grid);
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
    text.textContent = 'พิมพ์ชื่อเพลงหรือศิลปินด้านบน ระบบจะเติม "คาราโอเกะ" ให้โดยอัตโนมัติ';
    box.appendChild(text);
    panel.appendChild(box);
    return;
  }

  const rowhead = document.createElement('div');
  rowhead.className = 'rowhead';
  const rowheadMain = document.createElement('div');
  rowheadMain.className = 'rowhead-main';
  const heading = document.createElement('h2');
  heading.className = 'rowhead-title';
  heading.textContent = 'ผลค้นหา';
  const count = document.createElement('small');
  count.textContent = `${searchResults.length} เพลง`;
  rowheadMain.append(heading, count);
  rowhead.appendChild(rowheadMain);

  const grid = document.createElement('ul');
  grid.className = 'grid';

  for (const song of searchResults) {
    const blocked = embedFlags.get(song.id) === false;
    const blockedSuffix = blocked ? ' (เล่นที่นี่ไม่ได้)' : '';

    const li = document.createElement('li');
    li.className = blocked ? 'tile is-blocked' : 'tile';

    const poster = createPoster(song, { showInQueue: true, blocked });

    const body = document.createElement('div');
    body.className = 'tbody';

    const title = document.createElement('p');
    title.className = 'ttl';
    title.textContent = song.title;

    const meta = document.createElement('p');
    meta.className = 'ch';
    meta.textContent = song.views ? `${song.channel} · ${song.views}` : song.channel;

    const actions = document.createElement('div');
    actions.className = 'acts';

    const btnEnqueue = document.createElement('button');
    btnEnqueue.type = 'button';
    btnEnqueue.className = 'btn-neon tile-add';
    btnEnqueue.disabled = blocked;
    btnEnqueue.setAttribute('aria-label', `เข้าคิว ${song.title}${blockedSuffix}`);
    btnEnqueue.append(createIcon('plus'));
    const enqText = document.createElement('span');
    enqText.className = 'tile-add-label';
    enqText.textContent = 'เข้าคิว';
    btnEnqueue.appendChild(enqText);
    btnEnqueue.addEventListener('click', () => {
      if (blocked) return;
      const wasIdle = !state.current;
      const nextPos = state.queue.length + 1;
      void dispatch({ type: 'enqueue', song: toCommandSong(song) }).then((ok) => {
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
    btnNext.className = 'btn-round';
    btnNext.disabled = blocked;
    btnNext.setAttribute('aria-label', `เล่นถัดไป ${song.title}${blockedSuffix}`);
    btnNext.setAttribute('title', 'เล่นถัดไป');
    btnNext.append(createIcon('next'));
    btnNext.addEventListener('click', () => {
      if (blocked) return;
      const wasIdle = !state.current;
      void dispatch({ type: 'enqueueNext', song: toCommandSong(song) }).then((ok) => {
        if (!ok) return;
        if (wasIdle) {
          showToast(`กำลังเล่น "${song.title}"`);
        } else {
          showToast(`เพิ่ม "${song.title}" เป็นเพลงถัดไป`);
        }
      });
    });

    const btnPlay = document.createElement('button');
    btnPlay.type = 'button';
    btnPlay.className = 'btn-round';
    btnPlay.disabled = blocked;
    btnPlay.setAttribute('aria-label', `เล่นเลย ${song.title}${blockedSuffix}`);
    btnPlay.setAttribute('title', 'เล่นเลย');
    btnPlay.append(createIcon('play'));
    btnPlay.addEventListener('click', () => {
      if (blocked) return;
      void dispatch({ type: 'playNow', song: toCommandSong(song) }).then((ok) => {
        if (!ok) return;
        showToast(`กำลังเล่น "${song.title}"`);
      });
    });

    actions.append(btnEnqueue, btnNext, btnPlay);
    body.append(title, meta, actions);
    li.append(poster, body);
    grid.appendChild(li);
  }

  panel.append(rowhead, grid);
}

function resetConfirm(key) {
  if (confirmTimers[key] !== null) {
    clearTimeout(confirmTimers[key]);
    confirmTimers[key] = null;
  }
  confirmArmed[key] = false;
}

function renderConfirmTarget(key) {
  if (key === 'queue') {
    renderQueuePanel();
  } else if (key === 'history') {
    renderHistoryPanel();
  } else if (key === 'rotateGuest') {
    renderRemotePanel();
  }
}

function handleTwoStepClear(key, onConfirmed) {
  if (confirmArmed[key]) {
    resetConfirm(key);
    onConfirmed();
    return;
  }
  confirmArmed[key] = true;
  renderConfirmTarget(key);
  confirmTimers[key] = setTimeout(() => {
    confirmTimers[key] = null;
    confirmArmed[key] = false;
    renderConfirmTarget(key);
  }, CONFIRM_RESET_MS);
}

function getQueueScroller() {
  const overflowY = getComputedStyle(panels.queue).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll' ? panels.queue : null;
}

function destroyQueueDragSort() {
  if (queueDragSort) {
    queueDragSort.destroy();
    queueDragSort = null;
  }
}

function renderQueuePanel() {
  queueCountEl.textContent = String(state.queue.length);

  if (queueDragSort && queueDragSort.isDragging()) {
    queueRenderPending = true;
    return;
  }

  queueRenderPending = false;

  const panel = panels.queue;
  const activeEl = document.activeElement;
  const activeHandle =
    activeEl && panel.contains(activeEl) ? activeEl.closest?.('.drag-handle') ?? null : null;
  const activeHandleQid = activeHandle ? activeHandle.closest('[data-qid]')?.dataset.qid ?? null : null;
  const restoreFocusQid =
    pendingFocusHandleQid &&
    (!activeEl || activeEl === document.body || activeHandleQid === pendingFocusHandleQid)
      ? pendingFocusHandleQid
      : activeHandleQid;
  pendingFocusHandleQid = null;

  destroyQueueDragSort();
  panel.replaceChildren();

  if (state.current) {
    const currentCard = document.createElement('div');
    currentCard.className =
      playerState === 'playing' ? 'current-card is-playing' : 'current-card';

    currentCard.appendChild(createQueueThumb(state.current));

    const info = document.createElement('div');
    info.className = 'current-info';

    const title = document.createElement('p');
    title.className = 'qt';
    title.textContent = state.current.title;

    const meta = document.createElement('p');
    meta.className = 'qm';
    const dur = state.current.duration || formatDuration(state.current.durationSec);
    const channelPart = formatChannelWithBy(state.current);
    meta.textContent = dur && channelPart ? `${dur} · ${channelPart}` : dur || channelPart;

    info.append(createEyebrow(), title, meta);
    currentCard.appendChild(info);
    panel.appendChild(currentCard);
  }

  const header = document.createElement('div');
  header.className = 'rowhead';

  const headerMain = document.createElement('div');
  headerMain.className = 'rowhead-main';

  const heading = document.createElement('h2');
  heading.className = 'rowhead-title';
  heading.textContent = 'คิวถัดไป';

  const summary = document.createElement('small');
  summary.textContent = `${state.queue.length} เพลง · รวม ${formatDuration(totalDurationSec(state))}`;

  headerMain.append(heading, summary);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = confirmArmed.queue
    ? 'btn-glass btn-clear btn-danger-confirm'
    : 'btn-glass btn-clear';
  clearBtn.disabled = state.queue.length === 0;
  clearBtn.textContent = confirmArmed.queue ? 'แน่ใจ?' : 'ล้างคิว';
  clearBtn.setAttribute('aria-label', confirmArmed.queue ? 'ยืนยันล้างคิวทั้งหมด' : 'ล้างคิว');
  clearBtn.addEventListener('click', () => {
    handleTwoStepClear('queue', () => {
      void dispatch({ type: 'clearQueue' }).then((ok) => {
        if (ok) {
          showToast('ล้างคิวแล้ว');
        }
      });
    });
  });

  header.append(headerMain, clearBtn);
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
  list.className = 'qlist';

  let focusHandle = null;

  state.queue.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'qrow';
    li.dataset.qid = item.qid;

    const rank = index + 1;
    const num = document.createElement('span');
    num.className = rank >= 10 ? 'num-rank is-long' : 'num-rank';
    num.textContent = String(rank);

    const thumb = createQueueThumb(item);

    const info = document.createElement('div');
    info.className = 'qinfo';

    const title = document.createElement('p');
    title.className = 'qt';
    title.textContent = item.title;

    const meta = document.createElement('p');
    meta.className = 'qm';
    const dur = item.duration || formatDuration(item.durationSec);
    const by = typeof item.by === 'string' && item.by.trim().length > 0 ? item.by.trim() : '';
    const extra = by ? `ขอโดย ${by}` : typeof item.channel === 'string' ? item.channel : '';
    meta.textContent = dur && extra ? `${dur} · ${extra}` : dur || extra;

    info.append(title, meta);

    const btnHandle = document.createElement('button');
    btnHandle.type = 'button';
    btnHandle.className = 'btn-round drag-handle';
    btnHandle.disabled = state.queue.length <= 1;
    btnHandle.setAttribute('aria-label', 'ลากเพื่อจัดลำดับ หรือกดลูกศรขึ้น–ลง');
    btnHandle.appendChild(createIcon('grip'));

    if (restoreFocusQid && item.qid === restoreFocusQid) {
      focusHandle = btnHandle;
    }

    const actions = document.createElement('div');
    actions.className = 'qa';

    const btnTop = document.createElement('button');
    btnTop.type = 'button';
    btnTop.className = 'btn-round';
    btnTop.disabled = index === 0;
    btnTop.setAttribute('aria-label', `ขึ้นบนสุด ${item.title}`);
    btnTop.setAttribute('title', 'ขึ้นบนสุด');
    btnTop.appendChild(createIcon('top'));
    btnTop.addEventListener('click', () => {
      void dispatch({ type: 'moveToTop', qid: item.qid });
    });

    const btnPlayNow = document.createElement('button');
    btnPlayNow.type = 'button';
    btnPlayNow.className = 'btn-round';
    btnPlayNow.setAttribute('aria-label', `เล่นเลย ${item.title}`);
    btnPlayNow.setAttribute('title', 'เล่นเลย');
    btnPlayNow.appendChild(createIcon('play'));
    btnPlayNow.addEventListener('click', () => {
      void dispatch({ type: 'playFromQueue', qid: item.qid }).then((ok) => {
        if (ok) {
          showToast(`กำลังเล่น "${item.title}"`);
        }
      });
    });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-round';
    btnRemove.setAttribute('aria-label', `ลบ ${item.title} ออกจากคิว`);
    btnRemove.setAttribute('title', 'ลบ');
    btnRemove.appendChild(createIcon('trash'));
    btnRemove.addEventListener('click', () => {
      void dispatch({ type: 'remove', qid: item.qid });
    });

    actions.append(btnTop, btnPlayNow, btnRemove);
    li.append(num, thumb, info, btnHandle, actions);
    list.appendChild(li);
  });

  panel.appendChild(list);

  queueDragSort = createDragSort({
    list,
    scroller: getQueueScroller(),
    onMove: (qid, delta, beforeQid) => {
      const fromDrag = lastQueueMoveFromDrag;
      lastQueueMoveFromDrag = false;
      const currentActive = document.activeElement;
      if (currentActive && panel.contains(currentActive) && currentActive.closest?.('.drag-handle')) {
        pendingFocusHandleQid = qid;
      }
      const cmd = fromDrag
        ? { type: 'moveTo', qid, beforeQid: beforeQid ?? null }
        : { type: 'move', qid, delta };
      void dispatch(cmd).then((ok) => {
        if (!ok) {
          renderQueuePanel();
        }
      });
    },
    onDragState: (dragging) => {
      if (dragging) {
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
      if (queueRenderPending) {
        queueRenderPending = false;
        if (queueDragSort && queueDragSort.isDragging()) {
          queueMicrotask(() => {
            if (!queueDragSort || !queueDragSort.isDragging()) {
              renderQueuePanel();
            }
          });
        } else {
          renderQueuePanel();
        }
      }
    },
  });

  if (focusHandle && !focusHandle.disabled && !panel.hidden) {
    focusHandle.focus();
  }
}

function renderHistoryPanel() {
  const panel = panels.history;
  panel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'rowhead';

  const headerMain = document.createElement('div');
  headerMain.className = 'rowhead-main';

  const heading = document.createElement('h2');
  heading.className = 'rowhead-title';
  heading.textContent = 'ร้องไปแล้ว';

  const summary = document.createElement('small');
  summary.textContent = `${state.history.length} เพลง`;

  headerMain.append(heading, summary);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = confirmArmed.history
    ? 'btn-glass btn-clear btn-danger-confirm'
    : 'btn-glass btn-clear';
  clearBtn.disabled = state.history.length === 0;
  clearBtn.textContent = confirmArmed.history ? 'แน่ใจ?' : 'ล้างประวัติ';
  clearBtn.setAttribute('aria-label', confirmArmed.history ? 'ยืนยันล้างประวัติทั้งหมด' : 'ล้างประวัติ');
  clearBtn.addEventListener('click', () => {
    handleTwoStepClear('history', () => {
      void dispatch({ type: 'clearHistory' }).then((ok) => {
        if (ok) {
          showToast('ล้างประวัติแล้ว');
        }
      });
    });
  });

  header.append(headerMain, clearBtn);
  panel.appendChild(header);

  if (state.history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'panel-state';
    const text = document.createElement('p');
    text.className = 'panel-state-text';
    text.textContent = 'ยังไม่มีเพลงที่ร้องไปแล้ว';
    empty.appendChild(text);
    panel.appendChild(empty);
    return;
  }

  const grid = document.createElement('ul');
  grid.className = 'grid';

  for (const song of state.history) {
    const li = document.createElement('li');
    li.className = 'tile tile-history';

    const poster = createPoster(song, { showInQueue: true });

    const body = document.createElement('div');
    body.className = 'tbody';

    const title = document.createElement('p');
    title.className = 'ttl';
    title.textContent = song.title;

    const meta = document.createElement('p');
    meta.className = 'ch';
    meta.textContent = formatChannelWithBy(song);

    const actions = document.createElement('div');
    actions.className = 'acts';

    const btnRequeue = document.createElement('button');
    btnRequeue.type = 'button';
    btnRequeue.className = 'btn-neon tile-add-full';
    btnRequeue.setAttribute('aria-label', `เข้าคิว ${song.title}`);
    btnRequeue.append(createIcon('plus'));
    const label = document.createElement('span');
    label.textContent = 'เข้าคิว';
    btnRequeue.appendChild(label);
    btnRequeue.addEventListener('click', () => {
      const wasIdle = !state.current;
      const nextPos = state.queue.length + 1;
      void dispatch({ type: 'enqueue', song: toCommandSong(song) }).then((ok) => {
        if (!ok) return;
        if (wasIdle) {
          showToast(`กำลังเล่น "${song.title}"`);
        } else {
          showToast(`เพิ่ม "${song.title}" เข้าคิวลำดับที่ ${nextPos}`);
        }
      });
    });

    actions.appendChild(btnRequeue);
    body.append(title, meta, actions);
    li.append(poster, body);
    grid.appendChild(li);
  }

  panel.appendChild(grid);
}

function renderRemotePanel() {
  const panel = panels.remote;
  panel.replaceChildren();

  if (isDemo) {
    const box = document.createElement('div');
    box.className = 'panel-state';
    const text = document.createElement('p');
    text.className = 'panel-state-text';
    text.textContent = 'โหมดตัวอย่าง — เปิดจากลิงก์ห้องเพื่อดู QR และลิงก์แขก';
    box.appendChild(text);
    panel.appendChild(box);
    return;
  }

  const guestUrl = typeof roomInfo?.guestUrl === 'string' ? roomInfo.guestUrl : '';
  if (roomInfoStatus !== 'ready' || !guestUrl) {
    const box = document.createElement('div');
    box.className = 'panel-state';
    const text = document.createElement('p');
    text.className = 'panel-state-text';
    text.textContent = 'กำลังโหลดข้อมูลห้อง…';
    box.appendChild(text);
    panel.appendChild(box);
    return;
  }

  const card = document.createElement('div');
  card.className = 'remote-card';

  const heading = document.createElement('h2');
  heading.className = 'remote-card-title';
  heading.textContent = 'สั่งเพลงจากมือถือ';
  card.appendChild(heading);

  const qrDataUrl = qrSvgToDataUrl(roomInfo.qrSvg);
  if (qrDataUrl) {
    const qrFrame = document.createElement('div');
    qrFrame.className = 'qr-frame qr-frame-panel';

    const qrImg = document.createElement('img');
    qrImg.id = 'remote-qr';
    qrImg.setAttribute('src', qrDataUrl);
    qrImg.setAttribute('alt', 'QR สำหรับเปิดหน้าสั่งเพลง');
    qrImg.setAttribute('width', '220');
    qrImg.setAttribute('height', '220');
    qrFrame.appendChild(qrImg);
    card.appendChild(qrFrame);
  }

  const urlEl = document.createElement('p');
  urlEl.id = 'remote-url';
  urlEl.textContent = displayGuestUrl(guestUrl);
  card.appendChild(urlEl);

  const actions = document.createElement('div');
  actions.className = 'remote-actions';

  const copyBtn = document.createElement('button');
  copyBtn.id = 'btn-copy-guest';
  copyBtn.type = 'button';
  copyBtn.className = 'btn-neon remote-action-btn';
  copyBtn.textContent = 'คัดลอกลิงก์แขก';
  copyBtn.addEventListener('click', () => {
    const urlToCopy = typeof roomInfo?.guestUrl === 'string' ? roomInfo.guestUrl : '';
    if (!urlToCopy || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      showToast('คัดลอกลิงก์ไม่ได้', { warn: true });
      return;
    }
    navigator.clipboard.writeText(urlToCopy).then(
      () => {
        showToast('คัดลอกลิงก์แขกแล้ว');
      },
      () => {
        showToast('คัดลอกลิงก์ไม่ได้', { warn: true });
      }
    );
  });

  const rotateBtn = document.createElement('button');
  rotateBtn.id = 'btn-rotate-guest';
  rotateBtn.type = 'button';
  rotateBtn.className = confirmArmed.rotateGuest
    ? 'btn-glass remote-action-btn btn-danger-confirm'
    : 'btn-glass remote-action-btn';
  rotateBtn.disabled = rotatingGuest;
  rotateBtn.textContent = rotatingGuest
    ? 'กำลังเปลี่ยนรหัส…'
    : confirmArmed.rotateGuest
      ? 'แน่ใจ?'
      : 'เปลี่ยนรหัสแขก';
  rotateBtn.setAttribute(
    'aria-label',
    confirmArmed.rotateGuest ? 'ยืนยันเปลี่ยนรหัสแขก' : 'เปลี่ยนรหัสแขก'
  );
  rotateBtn.addEventListener('click', () => {
    if (rotatingGuest) return;
    handleTwoStepClear('rotateGuest', () => {
      void rotateGuestCode();
    });
  });

  const rotateNote = document.createElement('p');
  rotateNote.className = 'remote-rotate-note';
  rotateNote.textContent = 'เมื่อเปลี่ยนรหัส มือถือทุกเครื่องจะต้องสแกน QR ใหม่';

  actions.append(copyBtn, rotateBtn, rotateNote);
  card.appendChild(actions);

  const steps = document.createElement('ol');
  steps.className = 'remote-steps';
  const stepTexts = qrDataUrl
    ? [
        'สแกน QR ด้วยกล้องมือถือ หรือส่งลิงก์แขกให้เพื่อน',
        'เปิดหน้าสั่งเพลงบนมือถือ',
        'ค้นหาเพลงแล้วกด เข้าคิว',
      ]
    : [
        'กดคัดลอกลิงก์แขกแล้วส่งให้เพื่อน',
        'เปิดลิงก์ในเบราว์เซอร์บนมือถือ',
        'ค้นหาเพลงแล้วกด เข้าคิว',
      ];
  stepTexts.forEach((stepText, idx) => {
    const li = document.createElement('li');
    li.className = 'remote-step';
    const num = document.createElement('span');
    num.className = 'remote-step-num';
    num.textContent = String(idx + 1);
    const label = document.createElement('span');
    label.textContent = stepText;
    li.append(num, label);
    steps.appendChild(li);
  });

  card.appendChild(steps);
  panel.appendChild(card);
}

function renderAll() {
  renderStage();
  renderNowbar();
  renderResultsPanel();
  renderQueuePanel();
  renderHistoryPanel();
}

async function checkSearchEmbeddable(items) {
  if (isDemo || blockedReason || !Array.isArray(items) || items.length === 0) return;

  const unknownIds = [];
  const seen = new Set();
  for (const song of items) {
    const id = typeof song?.id === 'string' ? song.id : '';
    if (!YT_ID_RE.test(id) || seen.has(id) || embedFlags.has(id)) continue;
    seen.add(id);
    unknownIds.push(id);
    if (unknownIds.length >= 30) break;
  }

  if (unknownIds.length === 0) return;

  if (activeEmbedController) {
    activeEmbedController.abort();
  }
  const controller = new AbortController();
  activeEmbedController = controller;

  const flags = await fetchEmbeddable(unknownIds, {
    signal: controller.signal,
    token: activeToken,
  });
  if (activeEmbedController === controller) {
    activeEmbedController = null;
  }
  if (controller.signal.aborted || blockedReason) return;

  let changed = false;
  for (const id of unknownIds) {
    const value = flags[id];
    if (value === true || value === false) {
      if (embedFlags.get(id) !== value) {
        embedFlags.set(id, value);
        changed = true;
      }
    }
  }

  if (changed && searchStatus === 'done' && searchResults === items) {
    renderResultsPanel();
  }
}

async function runSearch(rawQuery) {
  if (isDemo || blockedReason) return;
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
    const result = await search(query, {
      signal: controller.signal,
      token: activeToken,
    });
    if (activeSearchController !== controller || blockedReason) return;
    activeSearchController = null;
    searchNote.textContent = `ค้นหา: ${result.query}`;
    searchResults = result.items;
    searchStatus = 'done';
    renderResultsPanel();
    void checkSearchEmbeddable(searchResults);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (activeSearchController !== controller || blockedReason) return;
    activeSearchController = null;
    if (err?.status === 401) {
      enterBlockedGate('bad_key');
      return;
    }
    if (err?.status === 404) {
      enterBlockedGate('gone');
      return;
    }
    searchStatus = 'error';
    renderResultsPanel();
  }
}

// Event wiring
if (btnOpenRemote) {
  btnOpenRemote.addEventListener('click', () => {
    setActiveTab('remote');
  });
}

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
  if (blockedReason || !state.current || !player) return;
  player.restart();
});

btnToggle.addEventListener('click', () => {
  if (blockedReason || !state.current || !player) return;
  player.toggle();
});

btnSkip.addEventListener('click', () => {
  if (blockedReason || !state.current) return;
  cancelErrorSkip();
  clearAutoplayBlocked();
  void dispatch({ type: 'advance', qid: state.current.qid });
});

btnRetryPlayer.addEventListener('click', () => {
  if (blockedReason || !state.current || !player) return;
  playerUnavailable = false;
  renderStage();
  player.load(state.current.id);
  armAutoplayCheck(state.current.qid);
});

// Fullscreen stage mode
const fullscreenSupported = Boolean(
  document.fullscreenEnabled || document.webkitFullscreenEnabled
);

if (!fullscreenSupported) {
  btnStageMode.hidden = true;
} else {
  const getFullscreenEl = () =>
    document.fullscreenElement || document.webkitFullscreenElement || null;

  const updateFullscreenUi = () => {
    const active = getFullscreenEl() === stageCol;
    document.body.classList.toggle('is-stage-fullscreen', active);
    btnStageMode.setAttribute('aria-pressed', String(active));
    btnStageMode.setAttribute('aria-label', active ? 'ออกจากโหมดเวที' : 'โหมดเวที');
    btnStageMode.setAttribute('title', active ? 'ออกจากโหมดเวที' : 'โหมดเวที');
  };

  btnStageMode.addEventListener('click', () => {
    if (getFullscreenEl()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        Promise.resolve(exit.call(document)).catch(() => {});
      }
    } else {
      const enter = stageCol.requestFullscreen || stageCol.webkitRequestFullscreen;
      if (enter) {
        Promise.resolve(enter.call(stageCol)).catch(() => {});
      }
    }
  });

  document.addEventListener('fullscreenchange', updateFullscreenUi);
  document.addEventListener('webkitfullscreenchange', updateFullscreenUi);
}

// Keyboard shortcut: "/" focuses search input when not typing
document.addEventListener('keydown', (event) => {
  if (blockedReason || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.tagName === 'SELECT' ||
      active.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  searchInput.focus();
  searchInput.select();
});

// Initial bootstrap
function init() {
  if (isDemo) {
    player = initPlayer();
    roomInfoStatus = 'demo';
    const demoBlockedSong = DEMO_SONGS[DEMO_SONGS.length - 1];
    if (demoBlockedSong?.id) {
      embedFlags.set(demoBlockedSong.id, false);
    }
    searchResults = DEMO_SONGS;
    searchStatus = 'done';
    searchNote.textContent = `ค้นหา: ${DEMO_QUERY}`;
    setActiveTab(initialTab);
    renderRemotePanel();

    if (demoIdle) {
      handleSnapshot(createState(), { isFirst: true });
    } else {
      const toDemoSong = ({ id, title, channel, duration, durationSec, thumbnail, by }) => {
        const song = { id, title, channel, duration, durationSec, thumbnail };
        if (by) song.by = by;
        return song;
      };
      handleSnapshot(
        {
          current: { ...toDemoSong(DEMO_SONGS[0]), qid: 'demo-1' },
          queue: DEMO_SONGS.slice(1, 5).map((song, idx) => ({
            ...toDemoSong(song),
            qid: `demo-${idx + 2}`,
          })),
          history: DEMO_SONGS.slice(5, 8).map(toDemoSong),
        },
        { isFirst: true }
      );
    }
    return;
  }

  // A room link pasted into this same tab only changes the hash; reload so it is picked up.
  window.addEventListener('hashchange', () => {
    if (window.location.hash.startsWith('#o=')) window.location.reload();
  });

  const session = takeToken('o');
  if (!session) {
    enterBlockedGate('no_token');
    return;
  }

  activeToken = session.token;
  roomInfoStatus = 'loading';
  player = initPlayer();
  sync = createSync({
    token: session.token,
    roomId: session.roomId,
    onState: (snapshot) => {
      handleSnapshot(snapshot);
    },
    onControl: (action) => {
      if (blockedReason || !state.current || !player) return;
      if (action === 'toggle') {
        player.toggle();
      } else if (action === 'restart') {
        player.restart();
      }
    },
    onStatus: (status) => {
      if (status === 'bad_key') {
        enterBlockedGate('bad_key');
        return;
      }
      if (status === 'gone') {
        enterBlockedGate('gone');
        return;
      }
      if (blockedReason) return;
      syncStatusEl.hidden = status !== 'offline';
    },
    onRoom: (info) => {
      handleRoomInfo(info);
    },
  });

  setActiveTab('results');
  renderAll();
  renderRemotePanel();
  sync.start();
}

init();
