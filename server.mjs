import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './lib/app.mjs';

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onError = error => { cleanup(); reject(error); };
    const onAborted = () => onError(new Error('Request aborted'));
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const onData = chunk => {
      size += chunk.length;
      if (size > 16 * 1024) {
        cleanup();
        request.pause();
        reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
      } else chunks.push(chunk);
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

// Stream doubles can exercise the HTTP/SSE adapter without opening a port.
export function createRequestHandler(app, { startInterval = setInterval, stopInterval = clearInterval } = {}) {
  return async (request, response) => {
    const sendJson = (status, value, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      response.end(request.method === 'HEAD' ? '' : JSON.stringify(value));
    };
    try {
      const remoteAddress = request.socket.remoteAddress;
      if (request.method === 'GET' && new URL(request.url, 'http://localhost').pathname === '/api/events') {
        const access = app.authorize({ url: request.url, remoteAddress });
        if (!access.ok) { sendJson(access.status, { error: access.error }); return; }
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const sendEvent = ({ event, data }) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        sendEvent({ event: 'state', data: app.snapshot() });
        const unsubscribe = app.subscribe(sendEvent);
        const timer = startInterval(() => response.write(': ping\n\n'), 25_000);
        const cleanup = () => {
          unsubscribe();
          stopInterval(timer);
          response.off('close', cleanup);
          response.off('error', cleanup);
        };
        response.once('close', cleanup);
        response.once('error', cleanup);
        return;
      }
      const body = request.method === 'POST' ? await readBody(request) : '';
      const result = await app.handle({ method: request.method, url: request.url,
        headers: request.headers, body, remoteAddress });
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (error.code === 'too_large') sendJson(413, { error: 'too_large' }, { Connection: 'close' });
      else sendJson(500, { error: 'internal' });
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8791);
  const app = createApp({ publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
    dataFile: fileURLToPath(new URL('./data/state.json', import.meta.url)), port });
  const server = http.createServer(createRequestHandler(app));
  server.listen(port, process.env.HOST ?? '0.0.0.0', async () => {
    console.log(`http://localhost:${server.address().port}`);
    const result = await app.handle({ method: 'GET', url: '/api/remote-info' });
    const info = JSON.parse(result.body);
    console.log(info.url ?? 'ไม่พบ LAN');
  });
}
