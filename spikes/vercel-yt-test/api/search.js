import { searchYouTube } from '../lib/youtube.mjs';
import { allowed, params, region, send, tracedFetch } from '../lib/harness.mjs';

export default async function handler(req, res) {
  if (!allowed(req, res)) return;
  const q = (params(req).get('q') ?? '').slice(0, 80);
  if (!q.trim()) return send(res, 400, { ok: false, error: 'missing_query' });

  const { trace, fetchImpl } = tracedFetch();
  try {
    const { query, items } = await searchYouTube(q, { fetchImpl });
    send(res, 200, {
      ok: true,
      region: region(),
      query,
      count: items.length,
      ids: items.slice(0, 10).map(item => item.id),
      sample: items.slice(0, 2).map(item => item.title),
      ...trace,
    });
  } catch (error) {
    send(res, 200, {
      ok: false,
      region: region(),
      error: String(error?.cause?.message ?? error?.message ?? error),
      ...trace,
    });
  }
}
