import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export async function serveStatic(publicDir, pathname) {
  try {
    pathname = decodeURIComponent(pathname);
  } catch { return null; }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')
    || pathname.split('/').some(part => part === '..' || part === '.')) return null;
  const root = path.resolve(publicDir);
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : ['/remote', '/admin', '/help'].includes(pathname) ? `${pathname}.html` : pathname}`);
  if (!inside(root, file)) return null;
  try {
    const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(file)]);
    if (!inside(actualRoot, actualFile)) return null;
    return {
      status: 200,
      headers: { 'Content-Type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' },
      body: await readFile(actualFile),
    };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'ELOOP'].includes(error.code)) return null;
    throw error;
  }
}
