// ตัวช่วยของชุดทดสอบ: บันทึกผล HTTP ของคำขอที่ยิงไป YouTube และตอบ JSON
// เขียนด้วย node:http ธรรมดา จึงรันได้ทั้งบน Vercel และบนเครื่องตัวเอง

export function tracedFetch() {
  const trace = { http: null, redirected: false, host: null, ms: null };
  const fetchImpl = async (url, init) => {
    const started = Date.now();
    try {
      const response = await fetch(url, init);
      trace.http = response.status;
      trace.redirected = response.redirected;
      try { trace.host = new URL(response.url || url).host; } catch { trace.host = null; }
      return response;
    } finally {
      trace.ms = Date.now() - started;
    }
  };
  return { trace, fetchImpl };
}

export function params(req) {
  return new URL(req.url, 'http://local').searchParams;
}

export function region() {
  return process.env.VERCEL_REGION ?? 'local';
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// ถ้าตั้ง TEST_KEY ไว้ ทุกคำขอต้องส่ง ?key= ให้ตรง (กันคนอื่นใช้เป็นตัวค้นฟรี)
export function allowed(req, res) {
  if (req.method !== 'GET') {
    send(res, 405, { ok: false, error: 'method_not_allowed' });
    return false;
  }
  const expected = process.env.TEST_KEY;
  if (expected && params(req).get('key') !== expected) {
    send(res, 403, { ok: false, error: 'forbidden' });
    return false;
  }
  return true;
}
