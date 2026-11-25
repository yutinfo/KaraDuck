function buildQuery(key) {
  return key ? `?k=${encodeURIComponent(key)}` : '';
}

export function createSync({
  key = '',
  onState = () => {},
  onControl = () => {},
  onStatus = () => {},
} = {}) {
  const qs = buildQuery(key);
  let es = null;
  let stopped = true;
  let preflightController = null;

  function closeEventSource() {
    if (es) {
      es.close();
      es = null;
    }
  }

  function openEventSource() {
    if (stopped) return;
    closeEventSource();

    const source = new EventSource(`/api/events${qs}`);
    es = source;

    source.onopen = () => {
      if (stopped || es !== source) return;
      onStatus('online');
    };

    source.onerror = () => {
      if (stopped || es !== source) return;
      onStatus('offline');
    };

    source.addEventListener('state', (event) => {
      if (stopped || es !== source) return;
      try {
        const snapshot = JSON.parse(event.data);
        onState(snapshot);
      } catch {
        // ignore malformed event payload
      }
    });

    source.addEventListener('control', (event) => {
      if (stopped || es !== source) return;
      try {
        const data = JSON.parse(event.data);
        if (data && typeof data.action === 'string') {
          onControl(data.action);
        }
      } catch {
        // ignore malformed event payload
      }
    });
  }

  return {
    start() {
      this.stop();
      stopped = false;

      const controller = new AbortController();
      preflightController = controller;

      fetch(`/api/state${qs}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
        .then((res) => {
          if (stopped || preflightController !== controller) return;
          preflightController = null;
          if (res.status === 401) {
            stopped = true;
            onStatus('bad_key');
            return;
          }
          openEventSource();
        })
        .catch((err) => {
          if (err?.name === 'AbortError' || stopped || preflightController !== controller) {
            return;
          }
          preflightController = null;
          onStatus('offline');
          openEventSource();
        });
    },

    async send(cmd) {
      let response;
      try {
        response = await fetch(`/api/command${qs}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
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
      if (preflightController) {
        preflightController.abort();
        preflightController = null;
      }
      closeEventSource();
    },
  };
}
