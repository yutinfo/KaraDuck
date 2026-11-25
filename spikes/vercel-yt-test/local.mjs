// รันชุดทดสอบเดียวกันบนเครื่องตัวเอง เพื่อเทียบกับผลบน Vercel
//   node local.mjs            เปิดหน้าเว็บที่ http://127.0.0.1:8793
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import search from './api/search.js';
import embeddable from './api/embeddable.js';

const port = Number(process.env.PORT ?? 8793);
const page = new URL('./index.html', import.meta.url);

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  if (pathname === '/api/search') return search(req, res);
  if (pathname === '/api/embeddable') return embeddable(req, res);
  if (pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await readFile(page));
  }
  res.statusCode = 404;
  res.end('not found');
}).listen(port, '127.0.0.1', () => {
  console.log(`ชุดทดสอบ YouTube: http://127.0.0.1:${port}`);
});
