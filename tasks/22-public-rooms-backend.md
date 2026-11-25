# ใบงาน 22 — หลังบ้าน: สร้างห้องสาธารณะ ปิดห้อง และเพดาน
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

## เป้าหมาย
ทำหลังบ้านตาม `docs/specs/2026-11-25-public-rooms.md` ข้อ 2, 3, 4 ให้ครบทุกบรรทัด:
เส้นทาง `POST /api/rooms` ที่ใครก็สร้างห้องได้ภายในเพดาน, คำสั่ง `closeRoom`, อายุห้อง 24 ชั่วโมง, งบการค้นหาต่อห้อง, สวิตช์รับสร้างห้อง และรายการห้องของผู้ดูแลแบบใหม่

## อ่านก่อนเริ่ม
1. `docs/specs/2026-11-25-public-rooms.md` ทั้งไฟล์ (ตัวเลข รหัสข้อผิดพลาด ลำดับการตรวจ และรูปข้อมูลถือเป็นสัญญา)
2. `docs/specs/2026-11-25-online-design.md` §6–§8 และ `docs/plans/2026-11-25-online.md` หัวข้อ "ข้อกำหนดร่วม"
3. โค้ดที่ต้องต่อยอด: `lib/room-doc.mjs`, `lib/room-service.mjs`, `lib/handlers.mjs`, `lib/store-file.mjs`, `lib/store-rtdb.mjs`, `lib/vercel.mjs`, `server.mjs`, `api/*.js`, `vercel.json` และเทสต์ของไฟล์เหล่านี้

## ขอบเขต
- สร้าง: `lib/limits.mjs`, `api/rooms.js`, `test/public-rooms.test.mjs`
- แก้: `lib/room-doc.mjs`, `lib/room-service.mjs`, `lib/handlers.mjs`, `lib/store-file.mjs`, `lib/store-rtdb.mjs`, `lib/vercel.mjs` (เฉพาะถ้าต้องส่ง `CREATE_DISABLED` หรือชื่อเส้นทางใหม่), `server.mjs` (ให้เส้นทาง `/api/rooms` ใช้ได้บนเครื่อง), เทสต์เดิมของไฟล์ที่แก้ (`test/room-doc.test.mjs`, `test/room-service.test.mjs`, `test/handlers.test.mjs`, `test/store-file.test.mjs`, `test/store-rtdb.test.mjs`, `test/server.test.mjs`, `test/vercel.test.mjs`)
- **ห้ามแตะ** `public/` ทั้งโฟลเดอร์ (มีคนอื่นแก้หน้าเว็บขนานอยู่), `lib/tokens.mjs`, `lib/youtube.mjs`, `lib/qr.mjs`, `tools/`, `design/`, `database.rules.json`
- ห้ามเพิ่ม dependency · ห้ามเรียกเครือข่ายจริง · ห้ามรัน `vercel` · ห้ามใช้พอร์ต 8791

## รายละเอียดที่ต้องตรง
- `lib/limits.mjs` ส่งออก `MAX_ROOMS = 30`, `CREATES_PER_HOUR = 20`, `IDLE_MS = 24 * 60 * 60 * 1000`, `SEARCHES_PER_HOUR = 120` และ `hourOf(ms)` = `Math.floor(ms / 3_600_000)`
- `newRoomDoc(name, now = Date.now())` ใส่ `createdAt` และ `updatedAt` เท่ากับ `now` · `decodeRoomDoc` ให้ค่าที่ขาดหรือไม่ใช่จำนวนเต็มไม่ติดลบเป็น `0` · `runCommand` และ `rotateOwner` ตั้ง `updatedAt: now()` ทุกครั้งที่เขียน `q`
- ห้องหมดอายุ: `updatedAt > 0 && now - updatedAt > IDLE_MS` · **ห้องที่ `updatedAt` เป็น 0 ห้ามถูกลบโดยการเก็บกวาด**
- การเก็บกวาด (ตอน `POST /api/rooms` และตอน admin `list`): อ่านทุกห้องจาก `listRooms()` ลบห้องที่หมดอายุด้วย `deleteRoom` ข้อผิดพลาดของการลบห้องเดียวไม่ทำให้คำขอล้ม
- `createHandlers` เพิ่มตัวจัดการ `rooms` และรับตัวเลือก `createDisabled` (ค่าจาก env `CREATE_DISABLED === '1'`) · `POST /api/rooms` ทำตามลำดับตรวจในแบบข้อ 4 · นับความถี่ด้วย `/meta`: ถ้า `meta.hour !== hourOf(now())` ให้เริ่มนับใหม่ · เขียน `/meta` แบบ ETag ลองซ้ำได้ 5 รอบ เกินนั้น `503 busy` · เขียน `/meta` ก่อนสร้างห้อง
- `ownerUrl` = `${origin(request)}/#o=${ownerToken}` · `name` ที่คืนคือชื่อหลัง `cleanRoomName`
- `config`: คืน `createEnabled` = สวิตช์ใน `/meta` และไม่ใช่ `createDisabled` · แคชค่าได้ไม่เกิน 30 วินาที (ใช้ `now` ที่สอดเข้ามา) · อ่าน `/meta` ไม่ได้ → `createEnabled: false` โดยไม่ทำให้ `config` ล้ม
- `closeRoom`: ตรวจสิทธิ์ด้วย `checkAccess` ก่อน (แขก → `403 owner_only`, โทเคนเก่า → `401 stale_token`) แล้ว `deleteRoom`
- งบค้นหา: ใน `search` หลัง `checkAccess` ผ่าน อ่าน `/usage/<roomId>` ถ้า `hour` ไม่ตรงชั่วโมงปัจจุบันให้เริ่มที่ 0 · ถ้า `searches >= SEARCHES_PER_HOUR` → `429 search_budget` โดยไม่เรียก YouTube · ไม่งั้นเขียนค่าที่บวกหนึ่งแล้วค้นต่อ · อ่านหรือเขียน usage ล้มเหลว → ปล่อยให้ค้นได้ (ไม่ให้ระบบนับพังการใช้งาน) · `embeddable` ไม่นับ
- admin `list` และ `setCreate` ตามแบบข้อ 4 · `limits` = `{ maxRooms, createsPerHour, idleHours: 24, searchesPerHour }` · admin `create` ไม่ติดเพดาน แต่ใส่ `createdAt`/`updatedAt`
- ชั้นเก็บข้อมูล: เพิ่ม `readMeta`, `writeMeta`, `readUsage`, `writeUsage` ตามแบบข้อ 3 ทั้งสองตัว · RTDB ใช้ `/meta.json` (GET พร้อม `X-Firebase-ETag: true`, PUT พร้อม `if-match`) และ `/usage/<roomId>.json` · `deleteRoom` ลบ `/usage/<roomId>.json` ด้วย (ลบ usage ล้มเหลวไม่ถือว่าลบห้องล้มเหลว) · ชั้นไฟล์ต้องเก็บ meta และ usage ลงไฟล์เดียวกับห้อง และไฟล์รูปแบบเก่าที่ไม่มีสองส่วนนี้ต้องเปิดได้
- `api/rooms.js` ส่งออกเฉพาะ `POST` · จำนวนไฟล์ใน `api/` เป็น 7 (แก้เทสต์ที่นับ 6)
- ทุกเส้นทางใหม่ยังต้องตอบ `503 not_configured` เมื่อ env ไม่ครบ และตรวจขนาดเนื้อคำขอ 16 KB เหมือนเส้นทางอื่น

## เทสต์ที่ต้องมี (กรณีละหนึ่งเทสต์ ใช้ชั้นเก็บแบบหน่วยความจำและ `now` ปลอม)
สร้างห้องโดยไม่มีโทเคนได้ และ `ownerToken` ใช้เรียก `/api/room` ได้บทบาท `o` · ชื่อว่างหรือยาวเกิน 40 → `400 bad_name` · มี 30 ห้องแล้ว → `503 rooms_full` · สร้าง 20 ห้องในชั่วโมงเดียวแล้วห้องที่ 21 → `429 too_many_rooms` และชั่วโมงถัดไปสร้างได้อีก · ห้องที่ไม่มีคำสั่งเกิน 24 ชั่วโมงถูกลบตอนมีคนสร้างห้องใหม่ และไม่นับเป็นห้องที่เปิดอยู่ · ห้องที่ `updatedAt` เป็น 0 ไม่ถูกลบแม้เวลาผ่านไป 30 วัน · คำสั่งใดก็ตามที่เขียน `q` ทำให้ `updatedAt` ขยับ · `setCreate false` แล้ว `POST /api/rooms` → `403 create_disabled` และ `config.createEnabled` เป็น `false` (หลังแคชหมดอายุ) · `createDisabled: true` → `403` แม้สวิตช์ในฐานข้อมูลเปิด · `closeRoom` โดยเจ้าของลบห้องและ usage · `closeRoom` โดยแขก → `403` · ค้นครั้งที่ 121 ในชั่วโมงเดียว → `429 search_budget` และ `fetchImpl` ไม่ถูกเรียก ชั่วโมงถัดไปค้นได้ · usage อ่านไม่ได้ (ชั้นเก็บโยนข้อผิดพลาด) → ยังค้นได้ · admin `list` คืน `createEnabled`, `limits` และห้องพร้อม `createdAt`, `updatedAt`, `current` · admin `create` ทำได้แม้มี 30 ห้อง · RTDB: `readMeta`/`writeMeta` ส่งหัว ETag ถูกต้อง และ `deleteRoom` ยิง DELETE ทั้งห้องและ usage · ชั้นไฟล์: เปิดไฟล์รูปแบบเก่าได้ และ meta/usage อยู่รอดหลังเปิดใหม่

## เกณฑ์ผ่าน
- `node --test test/room-doc.test.mjs test/room-service.test.mjs test/handlers.test.mjs test/store-file.test.mjs test/store-rtdb.test.mjs test/server.test.mjs test/vercel.test.mjs test/public-rooms.test.mjs test/tools.test.mjs test/yt-cache.test.mjs` ผ่านทั้งหมด (เทสต์ของ `session`, `room-merge`, `drag-sort` เป็นของคนอื่น)
- `ls api | wc -l` ได้ `7`
- พฤติกรรมเดิมของห้องที่มีอยู่ไม่เปลี่ยน: โทเคนเดิมยังใช้ได้ ข้อมูลห้องเดิมยังถอดได้

## ส่งมอบ (ตอบในข้อความสุดท้าย)
รายการไฟล์ที่สร้างและแก้ · คำสั่งที่รันพร้อมผลจริง · จุดที่ตัดสินใจเองเพราะแบบไม่ได้ระบุ · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ · **ไม่ต้อง commit**
