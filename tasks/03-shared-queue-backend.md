# ใบงาน 03 — คิวกลางที่เซิร์ฟเวอร์ + รหัสห้อง + QR
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

อ่าน `docs/DESIGN.md` หัวข้อ **"รอบ 2 — คิวกลาง + สั่งเพลงจากมือถือ"** ก่อน (รูปข้อมูล ตารางคำสั่ง สิทธิ์ และ API อยู่ที่นั่น ใบงานนี้ไม่ทวนซ้ำ)
โค้ดรอบ 1 ที่ต้องต่อยอด: `server.mjs`, `lib/app.mjs`, `lib/youtube.mjs`, `public/js/store.js`

## เป้าหมาย
เซิร์ฟเวอร์ถือคิวชุดเดียว ทุกจอสั่งผ่าน `POST /api/command` และรับการเปลี่ยนแปลงผ่าน SSE; มือถือใน LAN เข้าได้ด้วยรหัสห้อง; จอหลักขอ QR ของลิงก์มือถือได้

## ขอบเขต
- สร้าง/แก้ได้: `server.mjs`, `lib/**`, `public/js/store.js`, `public/js/commands.js`, `test/*.test.mjs`
- ห้ามแตะ: ไฟล์อื่นใน `public/` (อีกคนกำลังแก้ขนานอยู่ — error จากไฟล์พวกนั้นให้ข้ามและรายงาน), `docs/**`, `package.json`, `tasks/**`, `test/fixtures/**`
- ไม่ติดตั้ง package; sandbox ไม่มีเครือข่าย ห้ามเปิดพอร์ตหรือเรียก YouTube จริง
- พฤติกรรมรอบ 1 ต้องคงเดิม: `/api/search` (รวมแคช), การเสิร์ฟไฟล์, การกัน path traversal — เทสต์เดิมต้องยังผ่าน (ปรับได้เฉพาะรูปแบบการเรียก `handle` ที่มีฟิลด์เพิ่ม)

## งาน

### 1. `public/js/store.js` — เพิ่ม `by`
`toSong` เก็บ `by` ตามกติกาใน DESIGN.md (trim, 1–20 ตัวอักษร, ไม่งั้นไม่มีฟิลด์); ผลคือ current / queue / history / `deserialize` คง `by` ไว้ · API ที่ export อยู่ห้ามเปลี่ยนชื่อหรือพฤติกรรมอื่น

### 2. `public/js/commands.js` — `applyCommand(state, cmd, { makeQid } = {})`
ตามตารางคำสั่งและกติกาสร้าง `song` ใหม่ใน DESIGN.md · ต้อง import ได้ทั้งจากเบราว์เซอร์และ Node (ไม่ใช้ API เฉพาะ Node) · export `sanitizeSong(raw)` ด้วย (คืน Song หรือ throw `bad_command`)

### 3. `lib/qr.mjs` — ตัวสร้าง QR (เขียนเอง ไม่มี dependency)
- `encodeQr(text)` → `{ version, size, modules }` (`modules[y][x]` เป็น boolean, true = จุดดำ); byte mode (UTF-8), ระดับแก้ไขข้อผิดพลาด M, เลือก version เล็กสุดใน 1–6 ที่ใส่พอ, เลือก mask จากคะแนน penalty ต่ำสุดตามมาตรฐาน ISO/IEC 18004 (ใช้ตารางความจุ/บล็อก/ตำแหน่ง alignment มาตรฐาน); ยาวเกิน version 6-M → throw Error `code === 'too_long'`
- `qrSvg(text, { margin = 4 } = {})` → string SVG: `viewBox="0 0 N N"` (N = size + 2×margin), `shape-rendering="crispEdges"`, พื้น `<rect>` สี `#fff` เต็ม viewBox, จุดดำเป็น `<path fill="#000">` เดียว (ต้องดำบนขาวเสมอ ไม่มีสีอื่น)

### 4. `lib/app.mjs` — คิวกลาง สิทธิ์ และ API ใหม่
`createApp({ publicDir, fetchImpl, now, dataFile, port = 8791, getLanAddress, makeKey })` → `{ handle, authorize, subscribe, snapshot }`
- `handle({ method, url, headers = {}, body = '', remoteAddress = '127.0.0.1' })` → `{ status, headers, body }` เหมือนเดิม (เส้นทางรอบ 1 ทำงานต่อได้เมื่อไม่ส่งฟิลด์ใหม่)
- `authorize({ url, remoteAddress })` → `{ ok: true, local: boolean }` หรือ `{ ok: false, status, error }` — ใช้ร่วมกันทั้งใน `handle` และใน `server.mjs` ตอนเปิด SSE
- `subscribe(listener)` → ฟังก์ชันยกเลิก; `listener({ event: 'state', data: Snapshot })` ทุกครั้งที่ Snapshot เปลี่ยน และ `listener({ event: 'control', data: { action } })` เมื่อมีคำสั่ง control (ไม่ส่งค่าเริ่มต้นเอง — `server.mjs` เรียก `snapshot()` ส่งตอนเริ่มต่อ)
- `snapshot()` → Snapshot ปัจจุบัน
- คำสั่งที่ไม่ทำให้ state เปลี่ยน (`applyCommand` คืนตัวเดิม) → ยังตอบ `200 {"ok":true,"rev":<เดิม>}` แต่ `rev` ไม่เพิ่มและไม่กระจาย event · `report` ค่าเดิมซ้ำ → เหมือนกัน
- current กลายเป็น null → `playerState` เป็น `'idle'` อัตโนมัติ
- `dataFile` (ไม่ส่ง = ไม่เก็บลงดิสก์): JSON `{ "key": "...", "state": {...} }`; อ่านตอนสร้าง (ไฟล์ไม่มี/พัง → เริ่มใหม่ ไม่ throw; state ผ่าน `deserialize`), เขียนทุกครั้งที่ state หรือ key เปลี่ยน โดยเขียนไฟล์ชั่วคราวแล้ว rename; สร้างโฟลเดอร์ให้ถ้ายังไม่มี; เขียนไม่สำเร็จ → ไม่ทำให้คำสั่งล้ม
- `makeKey` (ค่าเริ่ม: สุ่ม 6 ตัวด้วย `crypto.randomInt` จากชุดอักษรใน DESIGN.md) ใช้เมื่อไฟล์ข้อมูลยังไม่มี key
- `getLanAddress` (ค่าเริ่ม: จาก `os.networkInterfaces()` — IPv4 ที่ไม่ใช่ internal และเป็นช่วง private `10.*`, `172.16–31.*`, `192.168.*`; เลือกอินเทอร์เฟซที่ชื่อขึ้นต้นด้วย `en` หรือ `wl` หรือ `eth` ก่อน ไม่มีค่อยใช้ตัวแรกที่เหลือ; ไม่มีเลย → `null`)
- `/remote` → เสิร์ฟ `remote.html`

### 5. `server.mjs`
- ฟังที่ `process.env.HOST ?? '0.0.0.0'`; `dataFile` = `data/state.json` ข้างไฟล์; ส่ง `remoteAddress` = `request.socket.remoteAddress`, headers, และ body (อ่านเฉพาะ POST; สะสมเกิน 16 KB → ตอบ 413 แล้วเลิกอ่าน)
- `GET /api/events`: เรียก `authorize` → ไม่ผ่านตอบ JSON ตามสถานะ; ผ่าน → header `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`; ส่ง Snapshot ทันที, subscribe, `: ping` ทุก 25 วินาที, ยกเลิกทั้งคู่เมื่อ connection ปิด
- ตอนเริ่มพิมพ์ 2 บรรทัด: URL จอหลัก (`http://localhost:<port>`) และ URL มือถือ (จาก remote-info; ไม่มีให้พิมพ์ว่าไม่พบ LAN)

## เกณฑ์ผ่าน (`node --test`)
`test/store.test.mjs` (เพิ่ม): `by` ถูกเก็บผ่าน enqueue → advance → history → serialize/deserialize; `by` ที่เป็น `"  "`, ตัวเลข, ยาว 30 ตัว → ไม่มีฟิลด์ / ถูกตัดเหลือ 20
`test/commands.test.mjs`: ทุกแถวในตารางคำสั่ง; `advance` ที่ `qid` ไม่ตรง → คืน state เดิม `===`; `song` ที่ส่ง `thumbnail: "javascript:alert(1)"` → ได้ URL ytimg; id ผิดรูป, title ว่าง, type ไม่รู้จัก, `delta: 0`, `delta: "1"`, cmd เป็น null → throw `bad_command`; อินพุตถูก freeze ลึกแล้วไม่ถูกแก้
`test/qr.test.mjs`: เขียนตัวถอดรหัสย่อในเทสต์ (อ่าน format info → ตรวจ BCH และระดับ M → เอา mask ออก → อ่าน codeword ตามลำดับซิกแซก → de-interleave → ตรวจ Reed–Solomon syndrome เป็น 0 ทุกบล็อก → ถอด byte mode) แล้วยืนยันว่าได้ข้อความเดิมสำหรับ:
`"A"`, `"http://192.168.1.23:8791/remote?k=AB12CD"`, `"http://192.168.100.200:8791/remote?k=AB12CD"`, ข้อความไทย `"คาราโอเกะ"`, และข้อความยาว 100 ไบต์ · ตรวจ `size === 17 + 4*version`, finder pattern ครบ 3 มุม, timing pattern, dark module · ข้อความ 200 ไบต์ → `too_long` · `qrSvg` มี `fill="#fff"`, `fill="#000"`, viewBox ถูกขนาด
`test/app.test.mjs` (เพิ่ม; ใช้ temp dir, `makeKey: () => 'AB12CD'`, `getLanAddress: () => '192.168.1.23'`):
- เครื่องอื่น (`remoteAddress: '192.168.1.50'`): `/api/state` ไม่มี k → 401 `bad_key`; k ผิด → 401; k ถูก → 200 · `/` → 302 `Location: /remote` · `/?k=AB12CD` → 302 `Location: /remote?k=AB12CD` · `/remote` และ `/js/a.js` → 200 · `/api/remote-info`, `/api/qr.svg` → 403 `local_only`
- เครื่องเดียวกัน (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`): `/api/state` ไม่ต้องมี k → 200 · `/api/remote-info` → url ตรงตัวอย่างใน DESIGN.md · `/api/qr.svg` → 200 `image/svg+xml` · `getLanAddress: () => null` → `available:false` และ qr 404
- `POST /api/command`: enqueue จากเครื่องอื่นพร้อม k → 200, `rev` เพิ่ม 1, `snapshot().current.id` ตรง, listener ได้ `state` 1 ครั้ง · ไม่มี Content-Type json → 415 · body ไม่ใช่ JSON → 400 · body 17 KB → 413 · `clearQueue` จากเครื่องอื่น → 403 · `control toggle` → listener ได้ `control`, `rev` ไม่เปลี่ยน · `report playing` จากเครื่องเดียวกัน → `playerState` เปลี่ยน; จากเครื่องอื่น → 403 · `advance` จนคิวหมด → `playerState: 'idle'` · คำสั่งไม่มีผล → `rev` เดิม ไม่มี event
- เก็บลงดิสก์: สร้าง app, enqueue 2 เพลง → สร้าง app ใหม่จาก `dataFile` เดิม → key และ state เหมือนเดิม · `dataFile` ที่เนื้อหาเป็น `{bad` → เริ่มใหม่ได้

## การตรวจ
`node --test` (ทั้งชุด) ผ่านทั้งหมด และ `node --check server.mjs`

## ส่งมอบ
สรุปไฟล์ที่สร้าง/แก้, คำสั่งที่รัน, ผลเทสต์จริง, สิ่งที่ยังไม่ได้ตรวจ (SSE ผ่าน socket จริง, การเข้าจากมือถือจริง, QR สแกนด้วยกล้องจริง) · ไม่ต้อง commit
