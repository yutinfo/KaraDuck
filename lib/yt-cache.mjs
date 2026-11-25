import { normalizeQuery, searchYouTube, checkEmbeddable } from './youtube.mjs';

export function createYouTubeCache({ fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const embedCache = new Map();
  const embedInFlight = new Map();
  const embedJobs = [];
  let embedActive = 0;

  function drainEmbedJobs() {
    while (embedActive < 6 && embedJobs.length) {
      const { id, referer, resolve } = embedJobs.shift();
      embedActive++;
      void checkEmbeddable(id, { fetchImpl, referer }).then(result => {
        if (result !== null) {
          embedCache.set(id, { result, created: now() });
          if (embedCache.size > 2000) embedCache.delete(embedCache.keys().next().value);
        }
        embedInFlight.delete(id);
        embedActive--;
        resolve(result);
        drainEmbedJobs();
      });
    }
  }
  function embeddable(id, referer) {
    const cached = embedCache.get(id);
    if (cached && now() - cached.created < 6 * 60 * 60 * 1000) return Promise.resolve(cached.result);
    embedCache.delete(id);
    if (embedInFlight.has(id)) return embedInFlight.get(id);
    const pending = new Promise(resolve => embedJobs.push({ id, referer, resolve }));
    embedInFlight.set(id, pending);
    drainEmbedJobs();
    return pending;
  }
  return {
    async search(rawQuery) {
      const query = normalizeQuery(rawQuery);
      const cached = cache.get(query);
      if (cached && now() - cached.created < 600_000) return cached.result;
      cache.delete(query);
      const result = await searchYouTube(rawQuery, { fetchImpl });
      cache.set(query, { result, created: now() });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return result;
    },
    async embeddable(ids, referer) {
      return Object.fromEntries(await Promise.all([...new Set(ids)].map(async id => [id, await embeddable(id, referer)])));
    },
  };
}
