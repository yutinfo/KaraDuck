# ใบงาน 25 — หลังบ้าน: เข้าห้องด้วยรหัส PIN
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

## เป้าหมาย
ทำหลังบ้านตาม `docs/specs/2026-11-25-public-rooms.md` ข้อ 8 ให้ครบทุกบรรทัด: PIN 6 หลักต่อห้อง, `POST /api/join`, `pin` ในคำตอบของ `GET /api/room` สำหรับเจ้าของ, การออก PIN ใหม่ตอน `rotateGuest`, การคืน PIN เมื่อห้องหาย และงบการลองผิด

## อ่านก่อนเริ่ม
1. `docs/specs/2026-11-25-public-rooms.md` ทั้งไฟล์ โดยเฉพาะข้อ 3 (`/meta`), ข้อ 4 และข้อ 8 (สัญญา)
2. โค้ดที่ต้องต่อยอด: `lib/handlers.mjs` (ตัวจัดการ `rooms`, `room`, `admin`, การอ่านเขียน `/meta` และการเก็บกวาดห้องหมดอายุ), `lib/room-service.mjs` (`rotateGuest`, `closeRoom`), `lib/limits.mjs`, `lib/vercel.mjs`, `server.mjs`, `api/*.js`, `test/public-rooms.test.mjs`, `test/vercel.test.mjs`, `test/server.test.mjs`

## ขอบเขต
- สร้าง: `api/join.js`, `test/pin.test.mjs`
- แก้: `lib/limits.mjs`, `lib/handlers.mjs`, `lib/room-service.mjs`, `lib/vercel.mjs` (ถ้าต้องรู้จักเส้นทางใหม่), `server.mjs` (เส้นทาง `/api/join` บนเครื่อง), เทสต์เดิมของไฟล์ที่แก้
- **ห้ามแตะ** `public/` ทั้งโฟลเดอร์ (มีคนอื่นแก้หน้าเว็บขนานอยู่), `lib/store-file.mjs`, `lib/store-rtdb.mjs` (PIN อยู่ใน `/meta` ที่มีอยู่แล้ว ไม่ต้องเพิ่มเมธอดของชั้นเก็บข้อมูล), `lib/tokens.mjs`, `lib/firebase-id-token.mjs`, `tools/`, `docs/`, `design/`
- ห้ามเพิ่ม dependency · ห้ามเรียกเครือข่ายจริง · ห้ามรัน `vercel`

## รายละเอียดที่ต้องตรง
- `lib/limits.mjs` เพิ่ม `JOIN_FAILS_PER_MINUTE = 30` และ `minuteOf(ms)`
- รูป `/meta` ใหม่: `{ createEnabled, hour, creates, pins: { [pin]: roomId }, join: { minute, fails } }` · `/meta` เดิมที่ไม่มี `pins`/`join` ต้องอ่านได้ (ถือเป็น `{}` และ `{ minute: 0, fails: 0 }`) · การเขียน `/meta` ทุกจุดที่มีอยู่ (นับการสร้างห้อง, `setCreate`) ต้องคงคีย์อื่นไว้ครบ ไม่เขียนทับ `pins`
- ออก PIN: สุ่ม `String(randomInt(0, 1_000_000)).padStart(6, '0')` (รับ `makePin` สอดเข้ามาได้เพื่อเทสต์) ถ้าซ้ำกับคีย์ใน `meta.pins` ให้สุ่มใหม่ไม่เกิน 20 ครั้ง · เขียน `/meta` แบบ ETag ลองซ้ำได้ 5 รอบ · ห้องหนึ่งมีได้ PIN เดียว: ตอนออกใหม่ต้องลบรายการเดิมของห้องนั้นในรอบเขียนเดียวกัน
- ห้องที่สร้างใหม่ (ทั้ง `POST /api/rooms` และ admin `create`) ได้ PIN ทันที · ออก PIN ไม่สำเร็จไม่ทำให้การสร้างห้องล้ม (ห้องจะได้ PIN ตอนเจ้าของเรียก `GET /api/room`)
- `GET /api/room` ของเจ้าของ: คืน `pin` ของห้องจาก `meta.pins` ถ้ายังไม่มีให้ออกแล้วคืน · อ่านหรือเขียน `/meta` ล้มเหลว → `pin: null` โดยไม่ทำให้คำขอล้ม · แขกไม่ได้ `pin`
- `rotateGuest`: หลังเขียน `q` สำเร็จ ให้ออก PIN ใหม่แทน PIN เดิมของห้อง (ล้มเหลว → ลบ PIN เดิมให้ได้เป็นอย่างน้อย; ถ้าลบก็ไม่ได้ ให้คำสั่งตอบ `503 busy` เพื่อไม่ให้ PIN เดิมยังใช้ได้กับรอบใหม่)
- `POST /api/join` ตามลำดับในแบบข้อ 8: งบการลองผิดตรวจจาก `meta.join` (`minute !== minuteOf(now())` → เริ่มนับใหม่) · เจอ PIN แต่ห้องไม่มีแล้ว → ลบ PIN นั้นออก นับเป็นการลองผิด และตอบ `404 no_such_pin` · สำเร็จ → `guestToken` เซ็นด้วย `guestEpoch` ปัจจุบันของห้อง และไม่นับเป็นการลองผิด · การบวก `fails` ใช้ ETag ลองซ้ำได้ 3 รอบ ล้มเหลวก็ยังตอบ `404`
- `closeRoom`, admin `delete` และการเก็บกวาดห้องหมดอายุ: ลบ PIN ของห้องนั้นออกจาก `meta.pins` (ล้มเหลวไม่ทำให้การลบห้องล้ม เพราะ `join` ตรวจว่าห้องยังอยู่เสมอ)
- admin `list`: เพิ่ม `pin` ต่อห้อง (หรือ `null`)
- `api/join.js` ส่งออกเฉพาะ `POST` · จำนวนไฟล์ใน `api/` เป็น 8 (แก้เทสต์ที่นับ 7) · ตอบ `503 not_configured` เมื่อ env ไม่ครบ และตรวจขนาดเนื้อคำขอเหมือนเส้นทางอื่น

## เทสต์ที่ต้องมี (กรณีละหนึ่งเทสต์)
สร้างห้องแล้ว `GET /api/room` ของเจ้าของได้ `pin` 6 หลัก และแขกไม่ได้ · ใส่ PIN ถูกได้ `guestToken` ที่ใช้เรียก `/api/room` ได้บทบาท `g` ของห้องนั้น · PIN รูปผิด (`12345`, `abcdef`, ตัวเลขไทย, ไม่ใช่ข้อความ) → `400 bad_pin` โดยไม่แตะ `/meta` · PIN ที่ไม่มี → `404 no_such_pin` และ `fails` เพิ่ม · ผิดครบ 30 ครั้งในนาทีเดียว ครั้งที่ 31 → `429` แม้ PIN ถูก และนาทีถัดไปใช้ได้ · สองห้องได้ PIN ไม่ซ้ำ แม้ `makePin` คืนค่าซ้ำครั้งแรก · `rotateGuest` แล้ว PIN เดิม → `404` PIN ใหม่ใช้ได้ และโทเคนที่ได้ใช้ `guestEpoch` ใหม่ · `closeRoom` / admin `delete` / หมดอายุ แล้ว PIN ของห้องนั้น → `404` และไม่ค้างใน `meta.pins` · ห้องเก่าที่ไม่มี PIN ได้ PIN ตอนเจ้าของเรียก `GET /api/room` และค่าเดิมคงที่เมื่อเรียกซ้ำ · `setCreate` และการสร้างห้องไม่ทำให้ `meta.pins` หาย · `/meta` อ่านไม่ได้ → `GET /api/room` ยังตอบ 200 พร้อม `pin: null` · admin `list` มี `pin`

## เกณฑ์ผ่าน
- `node --test test/pin.test.mjs test/public-rooms.test.mjs test/handlers.test.mjs test/room-service.test.mjs test/server.test.mjs test/vercel.test.mjs` ผ่านทั้งหมด
- `ls api | wc -l` ได้ `8`
- พฤติกรรมเดิมไม่เปลี่ยน: โทเคนเดิมยังใช้ได้ การสร้างห้องและเพดานเดิมทำงานเหมือนเดิม

## ส่งมอบ (ตอบในข้อความสุดท้าย)
รายการไฟล์ที่สร้างและแก้ · คำสั่งที่รันพร้อมผลจริง · จุดที่ตัดสินใจเอง · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ · **ไม่ต้อง commit**
