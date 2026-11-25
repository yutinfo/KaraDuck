const TOKEN_RE = /^([A-HJ-NP-Z2-9]{16})\.([og])([1-9]\d{0,8})\.[\w-]{22}$/;
const memoryTokens = new Map();

function storageKey(role) {
  return `karaoke.token.${role}`;
}

function resolveStorage(storage) {
  if (storage !== undefined) {
    return storage;
  }
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function parseToken(raw, role) {
  if (typeof raw !== 'string') return null;
  const match = TOKEN_RE.exec(raw);
  if (!match || match[2] !== role) return null;
  return { token: raw, roomId: match[1] };
}

function urlWithoutHash(location) {
  if (location && typeof location.pathname === 'string') {
    const search = typeof location.search === 'string' ? location.search : '';
    return `${location.pathname}${search}`;
  }
  if (location && typeof location.href === 'string') {
    return location.href.split('#')[0];
  }
  return '';
}

function saveToken(key, token, storage) {
  try {
    if (!storage) throw new Error('storage_unavailable');
    storage.setItem(key, token);
    memoryTokens.delete(key);
  } catch {
    memoryTokens.set(key, token);
  }
}

function loadToken(key, storage) {
  try {
    if (!storage) throw new Error('storage_unavailable');
    return storage.getItem(key);
  } catch {
    return memoryTokens.has(key) ? memoryTokens.get(key) : null;
  }
}

export function takeToken(
  role,
  { location = globalThis.location, history = globalThis.history, storage } = {},
) {
  if (role !== 'o' && role !== 'g') return null;
  const key = storageKey(role);
  const resolvedStorage = resolveStorage(storage);

  const hash = typeof location?.hash === 'string' ? location.hash : '';
  const hashParams = hash.startsWith('#') ? new URLSearchParams(hash.slice(1)) : new URLSearchParams('');

  if (hashParams.has(role)) {
    const parsed = parseToken(hashParams.get(role), role);
    if (!parsed) return null;
    saveToken(key, parsed.token, resolvedStorage);
    try {
      history?.replaceState?.(null, '', urlWithoutHash(location));
    } catch {
      // ignore restricted history environments
    }
    return parsed;
  }

  const stored = loadToken(key, resolvedStorage);
  return parseToken(stored, role);
}

export function forgetToken(role, { storage } = {}) {
  if (role !== 'o' && role !== 'g') return;
  const key = storageKey(role);
  memoryTokens.delete(key);
  const resolvedStorage = resolveStorage(storage);
  try {
    resolvedStorage?.removeItem?.(key);
  } catch {
    // ignore storage errors
  }
}
