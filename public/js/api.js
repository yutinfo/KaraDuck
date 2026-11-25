function authHeaders(token) {
  const headers = { Accept: 'application/json' };
  if (typeof token === 'string' && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson(url, { method, body: requestBody, signal, token } = {}) {
  const headers = authHeaders(token);
  const options = { headers, signal };
  if (method) {
    options.method = method;
  }
  if (requestBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(requestBody);
  }

  let response;
  try {
    response = await fetch(url, options);
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

  return body;
}

export async function getConfig({ signal } = {}) {
  const body = await fetchJson('/api/config', { signal });
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err = new Error('bad_response');
    err.code = 'bad_response';
    err.status = 200;
    throw err;
  }
  return body;
}

export async function createRoom(name, { signal } = {}) {
  const body = await fetchJson('/api/rooms', {
    method: 'POST',
    body: { name },
    signal,
  });
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err = new Error('bad_response');
    err.code = 'bad_response';
    err.status = 200;
    throw err;
  }
  return {
    roomId: typeof body.roomId === 'string' ? body.roomId : '',
    name: typeof body.name === 'string' ? body.name : '',
    ownerToken: typeof body.ownerToken === 'string' ? body.ownerToken : '',
    ownerUrl: typeof body.ownerUrl === 'string' ? body.ownerUrl : '',
  };
}

export async function search(q, { signal, token } = {}) {
  const url = `/api/search?q=${encodeURIComponent(q)}`;
  const body = await fetchJson(url, { signal, token });

  return {
    query: typeof body?.query === 'string' ? body.query : String(q),
    items: Array.isArray(body?.items) ? body.items : [],
  };
}

export async function getRoom({ signal, token } = {}) {
  const body = await fetchJson('/api/room', { signal, token });
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err = new Error('bad_response');
    err.code = 'bad_response';
    err.status = 200;
    throw err;
  }

  const room = {
    roomId: typeof body.roomId === 'string' ? body.roomId : '',
    name: typeof body.name === 'string' ? body.name : '',
    role: typeof body.role === 'string' ? body.role : '',
  };
  if (typeof body.guestUrl === 'string') {
    room.guestUrl = body.guestUrl;
  }
  if (typeof body.qrSvg === 'string' || body.qrSvg === null) {
    room.qrSvg = body.qrSvg;
  }
  return room;
}

export async function fetchEmbeddable(ids, { signal, token } = {}) {
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

  const url = `/api/embeddable?ids=${list.map(encodeURIComponent).join(',')}`;

  let response;
  try {
    response = await fetch(url, {
      headers: authHeaders(token),
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
