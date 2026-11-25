import { createSign } from 'node:crypto';

const tokenUrl = 'https://oauth2.googleapis.com/token';
const scope = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database';
const failed = () => Object.assign(new Error('Google authentication failed'), { code: 'store_failed' });
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export function createGoogleAuth({ clientEmail, privateKey, fetchImpl = fetch, now = Date.now }) {
  let cached, pending, generation = 0;

  async function exchange(version) {
    try {
      const started = now();
      const iat = Math.floor(started / 1000);
      const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: clientEmail, scope, aud: tokenUrl, iat, exp: iat + 3600 })}`;
      const signature = createSign('RSA-SHA256').update(payload).sign(privateKey.replaceAll('\\n', '\n'), 'base64url');
      const response = await fetchImpl(tokenUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${payload}.${signature}` }).toString(),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw failed();
      const data = await response.json();
      if (typeof data?.access_token !== 'string' || !data.access_token
        || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw failed();
      if (version === generation) cached = { token: data.access_token, expires: started + data.expires_in * 1000 };
      return data.access_token;
    } catch {
      throw failed();
    }
  }

  return {
    getAccessToken() {
      if (cached && now() < cached.expires - 300_000) return Promise.resolve(cached.token);
      if (!pending) {
        const version = generation;
        pending = exchange(version).finally(() => {
          if (version === generation) pending = undefined;
        });
      }
      return pending;
    },
    invalidate() {
      generation++;
      cached = pending = undefined;
    },
  };
}
