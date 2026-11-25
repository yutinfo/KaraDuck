export const json = (status, body, headers = {}) => ({ status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  body: JSON.stringify(body) });
export const error = (status, code) => json(status, { error: code });
export const methodError = allowed => json(405, { error: 'method_not_allowed' }, { Allow: allowed.join(', ') });
