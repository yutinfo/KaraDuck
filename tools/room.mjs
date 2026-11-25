import { readFile as defaultReadFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const usage = 'วิธีใช้: node tools/room.mjs <create "ชื่อ" | list | delete <roomId> | rotate-owner <roomId>> [--url <ฐาน>] [--local]';

function parse(argv) {
  const args = [];
  let url, local = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--local' && !local) local = true;
    else if (arg === '--url' && url === undefined && argv[i + 1] && !argv[i + 1].startsWith('--')) url = argv[++i];
    else if (arg.startsWith('--')) throw new Error(usage);
    else args.push(arg);
  }
  const [command, argument] = args;
  let body;
  if (command === 'create' && args.length === 2 && argument.trim() && argument.trim().length <= 40) body = { action: 'create', name: argument };
  else if (command === 'list' && args.length === 1) body = { action: 'list' };
  else if (['delete', 'rotate-owner'].includes(command) && args.length === 2 && /^[A-HJ-NP-Z2-9]{16}$/.test(argument)) {
    body = { action: command === 'delete' ? 'delete' : 'rotateOwner', roomId: argument };
  } else throw new Error(usage);
  return { url, local, body };
}

export async function run(argv, { env = process.env, fetchImpl = fetch, readFile = defaultReadFile, log = console.log } = {}) {
  const secrets = [env.KARAOKE_ADMIN_KEY, env.ADMIN_KEY].filter(Boolean);
  const print = value => {
    let text = String(value);
    for (const secret of secrets) text = text.replaceAll(secret, '[ซ่อนกุญแจ]');
    log(text);
  };
  let stage = 'arguments';
  try {
    if (argv.length === 1 && argv[0] === '--help') { print(usage); return 0; }
    const { url, local, body } = parse(argv);
    const base = url ?? (local ? `http://localhost:${env.PORT || 8791}` : env.KARAOKE_URL || env.PUBLIC_ORIGIN);
    if (!base) { print('ต้องระบุ --url <ฐาน> หรือ KARAOKE_URL / PUBLIC_ORIGIN (บนเครื่องใช้ --local)'); return 1; }
    const parsed = new URL(base);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      print('ฐาน URL ต้องเป็น http/https โดยไม่มีชื่อผู้ใช้ รหัสผ่าน query หรือ hash'); return 1;
    }
    let key = env.KARAOKE_ADMIN_KEY;
    if (local) {
      stage = 'local';
      key = JSON.parse(await readFile('data/secrets.json', 'utf8')).adminKey;
      if (typeof key === 'string' && key) secrets.push(key);
    }
    if (typeof key !== 'string' || !key.trim()) { print(local ? 'ไม่พบ adminKey ใน data/secrets.json' : 'ต้องตั้งตัวแปร KARAOKE_ADMIN_KEY ก่อน'); return 1; }
    stage = 'request';
    const response = await fetchImpl(`${parsed.href.replace(/\/+$/, '')}/api/admin`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok) { print(`จัดการห้องไม่สำเร็จ (HTTP ${response.status})`); return 1; }
    const result = await response.json();
    if (body.action === 'list') {
      if (!Array.isArray(result?.rooms)) throw new Error('invalid_response');
      if (!result.rooms.length) print('ยังไม่มีห้อง');
      for (const room of result.rooms) print(`${room.roomId} — ${room.name} · คิว ${room.queueLength} เพลง · rev ${room.rev}`);
    } else if (body.action === 'delete') {
      if (result?.ok !== true) throw new Error('invalid_response');
      print(`ลบห้อง ${body.roomId} แล้ว`);
    } else {
      if (typeof result?.roomId !== 'string' || typeof result?.ownerUrl !== 'string') throw new Error('invalid_response');
      print(`${body.action === 'create' ? 'สร้างห้อง' : 'ออกลิงก์เจ้าของใหม่'} ${result.roomId} แล้ว`);
      print(result.ownerUrl);
      print('ส่งลิงก์เจ้าของทางช่องทางส่วนตัวเท่านั้น');
    }
    return 0;
  } catch {
    print(stage === 'arguments' ? usage : stage === 'local'
      ? 'อ่าน data/secrets.json ไม่สำเร็จ ให้เริ่มเซิร์ฟเวอร์บนเครื่องก่อน'
      : 'จัดการห้องไม่สำเร็จ: ติดต่อเซิร์ฟเวอร์ไม่ได้หรือคำตอบไม่ถูกต้อง');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
