import { checkEmbeddable } from '../lib/youtube.mjs';
import { allowed, params, region, send, tracedFetch } from '../lib/harness.mjs';

export default async function handler(req, res) {
  if (!allowed(req, res)) return;
  const ids = [...new Set((params(req).get('ids') ?? '').split(','))]
    .filter(id => /^[\w-]{11}$/.test(id))
    .slice(0, 20);
  if (!ids.length) return send(res, 400, { ok: false, error: 'missing_ids' });

  const referer = `https://${req.headers.host ?? 'localhost'}/`;
  const started = Date.now();
  const results = [];
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const { trace, fetchImpl } = tracedFetch();
      const embeddable = await checkEmbeddable(id, { fetchImpl, referer });
      results.push({ id, embeddable, ...trace });
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));

  send(res, 200, { ok: true, region: region(), ms: Date.now() - started, results });
}
