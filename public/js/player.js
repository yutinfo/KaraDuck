const YT_API_SRC = 'https://www.youtube.com/iframe_api';
const API_TIMEOUT_MS = 10_000;

let apiPromise = null;

function loadYouTubeApi() {
  if (globalThis.YT && typeof globalThis.YT.Player === 'function') {
    return Promise.resolve(globalThis.YT);
  }
  if (apiPromise) {
    return apiPromise;
  }

  apiPromise = new Promise((resolve, reject) => {
    let settled = false;
    let scriptEl = null;

    const cleanupFailure = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (scriptEl && scriptEl.parentNode) {
        scriptEl.parentNode.removeChild(scriptEl);
      }
      apiPromise = null;
      reject(err);
    };

    const timer = setTimeout(() => {
      cleanupFailure(new Error('youtube_api_timeout'));
    }, API_TIMEOUT_MS);

    const prevReady = globalThis.onYouTubeIframeAPIReady;
    globalThis.onYouTubeIframeAPIReady = () => {
      if (typeof prevReady === 'function') {
        try {
          prevReady();
        } catch {
          // ignore third-party callback errors
        }
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(globalThis.YT);
    };

    scriptEl = document.createElement('script');
    scriptEl.src = YT_API_SRC;
    scriptEl.async = true;
    scriptEl.addEventListener('error', () => {
      cleanupFailure(new Error('youtube_api_load_failed'));
    });
    document.head.appendChild(scriptEl);
  });

  return apiPromise;
}

export function createPlayer({
  elementId = 'player',
  onEnded = () => {},
  onError = () => {},
  onState = () => {},
  onUnavailable = () => {},
} = {}) {
  let ytPlayer = null;
  let ready = false;
  let initializing = false;
  let currentState = 'idle';
  let pendingAction = null;

  function emitState(next) {
    if (currentState !== next) {
      currentState = next;
      onState(next);
    }
  }

  function applyPending() {
    if (!ready || !ytPlayer || !pendingAction) return;
    const action = pendingAction;
    pendingAction = null;
    if (action.type === 'load') {
      ytPlayer.loadVideoById(action.id);
    } else if (action.type === 'cue') {
      ytPlayer.cueVideoById(action.id);
    }
  }

  async function ensurePlayer() {
    if (ready && ytPlayer) return true;
    if (initializing) return false;
    initializing = true;

    try {
      const YT = await loadYouTubeApi();
      ytPlayer = new YT.Player(elementId, {
        host: 'https://www.youtube.com',
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          iv_load_policy: 3,
          origin: location.origin,
        },
        events: {
          onReady: () => {
            ready = true;
            initializing = false;
            applyPending();
          },
          onStateChange: (event) => {
            const PS = YT.PlayerState;
            switch (event.data) {
              case PS.PLAYING:
                emitState('playing');
                break;
              case PS.PAUSED:
                emitState('paused');
                break;
              case PS.BUFFERING:
                emitState('buffering');
                break;
              case PS.ENDED:
                emitState('idle');
                onEnded();
                break;
              default:
                emitState('idle');
                break;
            }
          },
          onError: (event) => {
            emitState('idle');
            onError(event.data);
          },
        },
      });
      return true;
    } catch {
      initializing = false;
      emitState('idle');
      onUnavailable();
      return false;
    }
  }

  return {
    load(id) {
      if (!id) return;
      pendingAction = { type: 'load', id };
      if (ready && ytPlayer) {
        applyPending();
      } else {
        void ensurePlayer();
      }
    },

    cue(id) {
      if (!id) return;
      pendingAction = { type: 'cue', id };
      if (ready && ytPlayer) {
        applyPending();
      } else {
        void ensurePlayer();
      }
    },

    play() {
      if (ready && ytPlayer) {
        ytPlayer.playVideo();
      } else if (pendingAction && pendingAction.type === 'cue') {
        pendingAction = { type: 'load', id: pendingAction.id };
      }
    },

    pause() {
      if (ready && ytPlayer) {
        ytPlayer.pauseVideo();
      }
    },

    toggle() {
      if (!ready || !ytPlayer) {
        if (pendingAction && pendingAction.type === 'cue') {
          pendingAction = { type: 'load', id: pendingAction.id };
        }
        return;
      }
      const PS = globalThis.YT?.PlayerState;
      const ytState = typeof ytPlayer.getPlayerState === 'function'
        ? ytPlayer.getPlayerState()
        : null;
      if (ytState === PS?.PLAYING || currentState === 'playing') {
        ytPlayer.pauseVideo();
      } else {
        ytPlayer.playVideo();
      }
    },

    restart() {
      if (!ready || !ytPlayer) {
        if (pendingAction && pendingAction.type === 'cue') {
          pendingAction = { type: 'load', id: pendingAction.id };
        }
        return;
      }
      ytPlayer.seekTo(0, true);
      ytPlayer.playVideo();
    },

    stop() {
      pendingAction = null;
      if (ready && ytPlayer && typeof ytPlayer.stopVideo === 'function') {
        ytPlayer.stopVideo();
      }
      emitState('idle');
    },
  };
}
