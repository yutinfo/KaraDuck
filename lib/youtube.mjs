function codedError(code, cause) {
  return Object.assign(new Error(code, { cause }), { code });
}

export function normalizeQuery(raw) {
  const query = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!query) throw codedError('missing_query');
  return /คาราโอเกะ|karaoke/i.test(query) ? query : `คาราโอเกะ ${query}`;
}

export function parseDuration(value) {
  if (typeof value !== 'string' || !/^\d+:\d{2}(?::\d{2})?$/.test(value)) return 0;
  const parts = value.split(':').map(Number);
  if (parts.slice(1).some(part => part > 59)) return 0;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isSafeInteger(seconds) ? seconds : 0;
}

export function parseSearchResponse(json) {
  const sections = json?.contents?.twoColumnSearchResultsRenderer?.primaryContents
    ?.sectionListRenderer?.contents;
  if (!Array.isArray(sections)) return [];
  const items = [];
  const seen = new Set();
  for (const section of sections) {
    const entries = section?.itemSectionRenderer?.contents;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const video = entry?.videoRenderer;
      const id = video?.videoId;
      const duration = video?.lengthText?.simpleText;
      const durationSec = parseDuration(duration);
      if (typeof id !== 'string' || !id || !durationSec || seen.has(id)) continue;
      const runs = video.title?.runs;
      items.push({
        id,
        title: Array.isArray(runs) ? runs.map(run => typeof run?.text === 'string' ? run.text : '').join('') : '',
        channel: video.ownerText?.runs?.[0]?.text ?? video.longBylineText?.runs?.[0]?.text ?? '',
        duration,
        durationSec,
        views: video.viewCountText?.simpleText ?? '',
        thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      });
      seen.add(id);
      if (items.length === 30) return items;
    }
  }
  return items;
}

export async function searchYouTube(rawQuery, { fetchImpl = fetch } = {}) {
  const query = normalizeQuery(rawQuery);
  try {
    const response = await fetchImpl('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20241120.01.00', hl: 'th', gl: 'TH' } },
        query,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);
    return { query, items: parseSearchResponse(await response.json()) };
  } catch (cause) {
    throw codedError('upstream_failed', cause);
  }
}

export function parseEmbedPlayability(html) {
  if (typeof html !== 'string') return null;
  const preview = /(\\?)"previewPlayabilityStatus\1"\s*:\s*\{/.exec(html);
  if (!preview) return null;
  let content = html.slice(preview.index + preview[0].length);
  // The embed page stores JSON inside a JS string; remove that string's escaping.
  if (preview[1]) content = content.replace(/\\(["\\])/g, '$1');
  const tokens = content.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g);
  let depth = 1;
  let previous = '{';
  for (const [token] of tokens) {
    if (token === '{' || token === '[') depth++;
    else if (token === '}' || token === ']') {
      if (--depth === 0) return null;
    } else if (depth === 1 && token === '"status"' && (previous === '{' || previous === ',')) {
      if (tokens.next().value?.[0] !== ':') return null;
      const value = tokens.next().value?.[0];
      try {
        const status = JSON.parse(value);
        return typeof status === 'string' ? status === 'OK' : null;
      } catch { return null; }
    }
    previous = token;
  }
  return null;
}

const EMBED_BODY_LIMIT = 1024 * 1024;

async function readEmbedBody(response) {
  if (!response.body?.getReader) {
    // Support text-only fetch adapters; native fetch uses the bounded stream below.
    return Buffer.from(await response.text()).subarray(0, EMBED_BODY_LIMIT).toString('utf8');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let done = false;
  try {
    while (length < EMBED_BODY_LIMIT) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        break;
      }
      const part = chunk.value.subarray(0, EMBED_BODY_LIMIT - length);
      chunks.push(part);
      length += part.byteLength;
    }
    return Buffer.concat(chunks, length).toString('utf8');
  } finally {
    if (!done) {
      try { await reader.cancel(); } catch { /* Keep the bounded prefix if cancellation fails. */ }
    }
    reader.releaseLock();
  }
}

export async function checkEmbeddable(id, { fetchImpl = fetch, referer } = {}) {
  if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) return null;
  try {
    const response = await fetchImpl(`https://www.youtube.com/embed/${id}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Referer: referer,
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return parseEmbedPlayability(await readEmbedBody(response));
  } catch { return null; }
}
