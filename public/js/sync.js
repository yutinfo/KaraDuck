import { getRoom } from './api.js';
import {
  applyStreamEvent,
  toSnapshot,
  createControlGate,
} from './room-merge.js';

const TOKEN_META_RE = /^[A-HJ-NP-Z2-9]{16}\.([og])([1-9]\d{0,8})\.[\w-]{22}$/;

function parseTokenMeta(token) {
  if (typeof token !== 'string') return null;
  const match = TOKEN_META_RE.exec(token);
  if (!match) return null;
  return { role: match[1], epoch: Number(match[2]) };
}

function streamUrl(db, roomId) {
  const base = db.replace(/\/+$/, '');
  return `${base}/rooms/${encodeURIComponent(roomId)}.json`;
}

export function createSync({
  token = '',
  roomId = '',
  onState = () => {},
  onControl = () => {},
  onStatus = () => {},
  onRoom = () => {},
} = {}) {
  const tokenMeta = parseTokenMeta(token);
  const gate = createControlGate();
  let es = null;
  let room = null;
  let stopped = true;
  let preflightController = null;
  let retryTimer = null;
  let retryDelay = 1000;
  let roomTimer = null;
  let roomDelay = 1000;

  function closeEventSource() {
    if (es) {
      es.close();
      es = null;
    }
  }

  // The page must recover by itself from a failed start or a stream the server refused:
  // EventSource only reconnects after network drops, not after an HTTP error.
  function retryLater() {
    if (stopped || retryTimer) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, 15000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (stopped) return;
      const controller = new AbortController();
      preflightController = controller;
      runPreflight(controller);
    }, delay);
    retryTimer.unref?.();
  }

  // The stream can run without the room details (name, QR); keep asking until they arrive.
  function retryRoomInfo() {
    if (stopped || roomTimer) return;
    const delay = roomDelay;
    roomDelay = Math.min(roomDelay * 2, 15000);
    roomTimer = setTimeout(async () => {
      roomTimer = null;
      if (stopped) return;
      try {
        const info = await getRoom({ token });
        if (stopped) return;
        roomDelay = 1000;
        onRoom(info);
      } catch (err) {
        if (stopped) return;
        if (err?.status === 401) terminate('bad_key');
        else if (err?.status === 404) terminate('gone');
        else retryRoomInfo();
      }
    }, delay);
    roomTimer.unref?.();
  }

  function terminate(status) {
    stopped = true;
    closeEventSource();
    onStatus(status);
  }

  function openEventSource(db) {
    if (stopped) return;
    closeEventSource();
    room = null;

    const source = new EventSource(streamUrl(db, roomId));
    es = source;

    source.onopen = () => {
      if (stopped || es !== source) return;
      gate.opened();
      retryDelay = 1000;
      onStatus('online');
    };

    source.onerror = () => {
      if (stopped || es !== source) return;
      onStatus('offline');
      if (source.readyState === 2) {
        closeEventSource();
        retryLater();
      }
    };

    function handleUpdate(type, event) {
      if (stopped || es !== source) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!payload || typeof payload !== 'object' || typeof payload.path !== 'string') {
        return;
      }

      room = applyStreamEvent(room, type, payload);
      if (room === null) {
        terminate('gone');
        return;
      }

      const snapshot = toSnapshot(room);
      if (!snapshot) return;

      if (tokenMeta) {
        const expectedEpoch =
          tokenMeta.role === 'o' ? snapshot.ownerEpoch : snapshot.guestEpoch;
        if (expectedEpoch !== tokenMeta.epoch) {
          terminate('bad_key');
          return;
        }
      }

      onState(snapshot);
      if (stopped || es !== source) return;

      const action = gate.next(room);
      if (action) {
        onControl(action);
      }
    }

    function handleTerminated() {
      if (stopped || es !== source) return;
      terminate('gone');
    }

    source.addEventListener('put', (event) => handleUpdate('put', event));
    source.addEventListener('patch', (event) => handleUpdate('patch', event));
    source.addEventListener('keep-alive', () => {});
    source.addEventListener('cancel', handleTerminated);
    source.addEventListener('auth_revoked', handleTerminated);
  }

  async function runPreflight(controller) {
    let configRes;
    try {
      configRes = await fetch('/api/config', {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError' || stopped || preflightController !== controller) {
        return;
      }
      preflightController = null;
      onStatus('offline');
      retryLater();
      return;
    }

    if (stopped || preflightController !== controller) return;

    let config = null;
    try {
      config = await configRes.json();
    } catch {
      config = null;
    }

    if (stopped || preflightController !== controller) return;

    if (configRes.status !== 200 || typeof config?.db !== 'string' || !config.db) {
      preflightController = null;
      onStatus('offline');
      retryLater();
      return;
    }

    const db = config.db;

    let roomInfo;
    try {
      roomInfo = await getRoom({ signal: controller.signal, token });
    } catch (err) {
      if (err?.name === 'AbortError' || stopped || preflightController !== controller) {
        return;
      }
      preflightController = null;
      if (err?.status === 401) {
        terminate('bad_key');
        return;
      }
      if (err?.status === 404) {
        terminate('gone');
        return;
      }
      onStatus('offline');
      openEventSource(db);
      retryRoomInfo();
      return;
    }

    if (stopped || preflightController !== controller) return;
    preflightController = null;
    onRoom(roomInfo);
    if (stopped) return;
    openEventSource(db);
  }

  return {
    start() {
      this.stop();
      stopped = false;

      const controller = new AbortController();
      preflightController = controller;
      runPreflight(controller);
    },

    async send(cmd) {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (typeof token === 'string' && token.length > 0) {
        headers.Authorization = `Bearer ${token}`;
      }

      let response;
      try {
        response = await fetch('/api/command', {
          method: 'POST',
          headers,
          body: JSON.stringify(cmd),
        });
      } catch (cause) {
        const err = new Error('network_error', { cause });
        err.code = 'network_error';
        err.status = 0;
        throw err;
      }

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (response.status !== 200) {
        const code =
          typeof body?.error === 'string' && body.error.length > 0
            ? body.error
            : `http_${response.status}`;
        const err = new Error(code);
        err.code = code;
        err.status = response.status;
        throw err;
      }

      return body;
    },

    stop() {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      retryDelay = 1000;
      if (roomTimer) {
        clearTimeout(roomTimer);
        roomTimer = null;
      }
      roomDelay = 1000;
      if (preflightController) {
        preflightController.abort();
        preflightController = null;
      }
      closeEventSource();
      room = null;
    },
  };
}
