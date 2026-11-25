export async function search(q, { signal, key = '' } = {}) {
  const keyPart = key ? `&k=${encodeURIComponent(key)}` : '';
  const url = `/api/search?q=${encodeURIComponent(q)}${keyPart}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      throw cause;
    }
    const err = new Error('network_error', { cause });
    err.code = 'network_error';
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

  return {
    query: typeof body?.query === 'string' ? body.query : String(q),
    items: Array.isArray(body?.items) ? body.items : [],
  };
}

export async function getRemoteInfo({ signal } = {}) {
  let response;
  try {
    response = await fetch('/api/remote-info', {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      throw cause;
    }
    const err = new Error('network_error', { cause });
    err.code = 'network_error';
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

  return {
    available: Boolean(body?.available && typeof body?.url === 'string' && body.url.length > 0),
    url: typeof body?.url === 'string' ? body.url : null,
  };
}

export async function fetchEmbeddable(ids, { signal, key = '' } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return {};
  }

  const list = [];
  const seen = new Set();
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      list.push(id);
      if (list.length >= 30) break;
    }
  }
  if (list.length === 0) {
    return {};
  }

  const keyPart = key ? `&k=${encodeURIComponent(key)}` : '';
  const url = `/api/embeddable?ids=${list.map(encodeURIComponent).join(',')}${keyPart}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    return {};
  }

  if (response.status !== 200) {
    return {};
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    return {};
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const result = {};
  for (const id of list) {
    if (!Object.hasOwn(body, id)) continue;
    const value = body[id];
    if (value === true || value === false || value === null) {
      result[id] = value;
    }
  }
  return result;
}
