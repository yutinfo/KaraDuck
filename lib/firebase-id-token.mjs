import { X509Certificate, createVerify } from 'node:crypto';

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export function createIdTokenVerifier({ projectId, fetchImpl = fetch, now = Date.now }) {
  let keys = new Map(), expiresAt = 0, lastMissAt = -Infinity, pending;

  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const result = await Promise.race([
          (async () => {
            const response = await fetchImpl(CERT_URL, { signal: controller.signal });
            if (!response.ok) throw new Error('Certificate request failed');
            const certificates = await response.json();
            const next = new Map();
            for (const [kid, pem] of Object.entries(certificates)) next.set(kid, new X509Certificate(pem).publicKey);
            if (!next.size) throw new Error('No certificates');
            const maxAge = response.headers.get('cache-control')?.match(/(?:^|[,\s])max-age\s*=\s*"?(\d+)"?/i);
            return { next, ttl: maxAge ? Number(maxAge[1]) * 1000 : 3_600_000 };
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('Certificate timeout')); }, 5000);
          }),
        ]);
        keys = result.next;
        expiresAt = now() + result.ttl;
      } finally { clearTimeout(timer); }
    })();
    try { await pending; } finally { pending = undefined; }
  }

  return {
    async verify(token) {
      try {
        if (typeof projectId !== 'string' || !projectId || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;
        const fetched = now() >= expiresAt;
        if (fetched) await refresh();
        if (!keys.has(header.kid)) {
          // A freshly fetched set needs no second request for the same miss.
          // Otherwise allow one early refresh for key rotation per minute.
          if (fetched) lastMissAt = now();
          else if (now() - lastMissAt >= 60_000) { lastMissAt = now(); await refresh(); }
        }
        const key = keys.get(header.kid);
        if (!key) return null;
        const verifier = createVerify('RSA-SHA256');
        verifier.update(`${parts[0]}.${parts[1]}`);
        verifier.end();
        if (!verifier.verify(key, Buffer.from(parts[2], 'base64url'))) return null;
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const at = now() / 1000;
        if (claims?.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`
          || !Number.isFinite(claims.exp) || claims.exp <= at
          || !Number.isFinite(claims.iat) || claims.iat > at + 60
          || !Number.isFinite(claims.auth_time) || claims.auth_time > at + 60
          || typeof claims.sub !== 'string' || !claims.sub.trim()) return null;
        return claims;
      } catch { return null; }
    },
  };
}
