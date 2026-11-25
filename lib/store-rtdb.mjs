const failed = () => Object.assign(new Error('Firebase store failed'), { code: 'store_failed' });

export function createRtdbStore({ dbUrl, auth, fetchImpl = fetch }) {
  const base = dbUrl.replace(/\/+$/, '');
  const roomPath = roomId => `/rooms/${encodeURIComponent(roomId)}`;
  const usagePath = roomId => `/usage/${encodeURIComponent(roomId)}.json`;

  async function request(path, { method = 'GET', headers = {}, body, conflict = false, decode } = {}) {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await auth.getAccessToken();
        const response = await fetchImpl(`${base}${path}`, {
          method, headers: { ...headers, Authorization: `Bearer ${token}` }, body,
          signal: AbortSignal.timeout(5000),
        });
        if (response.status === 401 && attempt === 0) {
          await response.body?.cancel();
          auth.invalidate();
          continue;
        }
        if (response.status === 412 && conflict) {
          await response.body?.cancel();
          return false;
        }
        if (response.status !== 200) throw failed();
        if (decode) return await decode(response);
        await response.body?.cancel();
        return true;
      }
      throw failed();
    } catch {
      throw failed();
    }
  }

  const readText = async response => {
    const text = await response.json();
    if (text !== null && typeof text !== 'string') throw failed();
    return text;
  };
  const readVersioned = path => request(path, { headers: { 'X-Firebase-ETag': 'true' },
    decode: async response => {
      const text = await readText(response), etag = response.headers.get('etag');
      if (!etag) throw failed();
      return { text, etag };
    } });
  const writeVersioned = async (path, text, etag) => {
    if (typeof text !== 'string' || typeof etag !== 'string' || !etag) throw failed();
    return request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'if-match': etag },
      body: JSON.stringify(text), conflict: true });
  };

  return {
    readMeta() {
      return readVersioned('/meta.json');
    },
    writeMeta(text, etag) {
      return writeVersioned('/meta.json', text, etag);
    },
    readUsage(roomId) {
      return request(usagePath(roomId), { decode: readText });
    },
    async writeUsage(roomId, text) {
      if (typeof text !== 'string') throw failed();
      await request(usagePath(roomId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(text) });
    },
    readQueue(roomId) {
      return readVersioned(`${roomPath(roomId)}/q.json`);
    },
    async writeQueue(roomId, text, etag) {
      return writeVersioned(`${roomPath(roomId)}/q.json`, text, etag);
    },
    async writePlayer(roomId, field, value) {
      if (field !== 's' && field !== 'c') throw failed();
      await request(`${roomPath(roomId)}/p/${field}.json`, { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    },
    async deleteRoom(roomId) {
      await request(`${roomPath(roomId)}.json`, { method: 'DELETE' });
      try {
        await request(usagePath(roomId), { method: 'DELETE' });
      } catch {
        // The room is already gone; failed usage cleanup must not fail deletion.
      }
    },
    listRooms() {
      return request('/rooms.json?shallow=true', { decode: async response => {
        const rooms = await response.json();
        if (rooms === null) return [];
        if (typeof rooms !== 'object' || Array.isArray(rooms)) throw failed();
        return Object.keys(rooms);
      } });
    },
  };
}
