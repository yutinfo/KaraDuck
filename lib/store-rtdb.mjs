const failed = () => Object.assign(new Error('Firebase store failed'), { code: 'store_failed' });

export function createRtdbStore({ dbUrl, auth, fetchImpl = fetch }) {
  const base = dbUrl.replace(/\/+$/, '');
  const roomPath = roomId => `/rooms/${encodeURIComponent(roomId)}`;

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

  return {
    readQueue(roomId) {
      return request(`${roomPath(roomId)}/q.json`, { headers: { 'X-Firebase-ETag': 'true' },
        decode: async response => {
          const text = await response.json(), etag = response.headers.get('etag');
          if ((text !== null && typeof text !== 'string') || !etag) throw failed();
          return { text, etag };
        } });
    },
    async writeQueue(roomId, text, etag) {
      if (typeof text !== 'string' || typeof etag !== 'string' || !etag) throw failed();
      return request(`${roomPath(roomId)}/q.json`, { method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify(text), conflict: true });
    },
    async writePlayer(roomId, field, value) {
      if (field !== 's' && field !== 'c') throw failed();
      await request(`${roomPath(roomId)}/p/${field}.json`, { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    },
    async deleteRoom(roomId) {
      await request(`${roomPath(roomId)}.json`, { method: 'DELETE' });
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
