# ใบงาน 16 — ตัวจัดการ API และเซิร์ฟเวอร์บนเครื่อง (รอบ B)
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

## เป้าหมาย
ทำ **งาน 4 และงาน 5** ใน `docs/plans/2026-11-25-online.md` ให้ครบตามที่เขียนไว้ทุกบรรทัด:
ตัวตรวจสิทธิ์กับห้อง ตัวทำคำสั่งแบบกันเขียนชน แคช YouTube ตัวจัดการ API 6 เส้นทาง และเซิร์ฟเวอร์บนเครื่องที่ใช้ตัวจัดการชุดนั้นพร้อมช่องฟังจำลอง
จบงานนี้ `lib/app.mjs` ต้องถูกลบ และไม่มีสิทธิ์ใดได้จาก IP อีก

## อ่านก่อนเริ่ม
1. `docs/plans/2026-11-25-online.md` — "ข้อกำหนดร่วม", "จุดที่ต้องจับตาตอนรีวิว" ข้อ 1–3, "โครงไฟล์" และงาน 4–5 (ลายเซ็น รหัสข้อผิดพลาด และรายการเทสต์ถือเป็นสัญญา)
2. `docs/specs/2026-11-25-online-design.md` — §6, §7, §8, §10, §11
3. ของที่รอบก่อนทำไว้และต้องใช้: `lib/tokens.mjs`, `lib/room-doc.mjs`, `lib/store-file.mjs`, `public/js/commands.js` (`applyCommand` รวม `moveTo` และ `queue_full`)
4. ของเดิมที่ต้องย้ายตรรกะมา: `lib/app.mjs` (แคชค้นหา แคชตรวจเพลง การเสิร์ฟไฟล์นิ่ง), `server.mjs`, `test/app.test.mjs`, `test/server.test.mjs`

## ขอบเขต
- สร้าง: `lib/room-service.mjs`, `lib/yt-cache.mjs`, `lib/handlers.mjs`, `lib/security-headers.mjs`, `lib/static.mjs` และเทสต์ `test/room-service.test.mjs`, `test/handlers.test.mjs`, `test/yt-cache.test.mjs`
- เขียนใหม่: `server.mjs`, `test/server.test.mjs` · ลบ: `lib/app.mjs`, `test/app.test.mjs` (ย้ายกรณีที่ยังใช้ได้ไปเทสต์ใหม่ก่อนลบ: แคชค้นหา แคชตรวจเพลง การกันออกนอกโฟลเดอร์ของไฟล์นิ่ง)
- แก้ได้ถ้าจำเป็น: `README.md` เฉพาะบรรทัดคำสั่งรัน
- **ห้ามแตะ** `public/` ทั้งโฟลเดอร์, `lib/tokens.mjs`, `lib/room-doc.mjs`, `lib/store-file.mjs`, `lib/youtube.mjs`, `lib/qr.mjs` (ถ้าพบว่าไฟล์เหล่านี้มีข้อบกพร่อง ให้รายงาน ไม่แก้) มีคนอื่นกำลังแก้ `public/js/` ขนานอยู่ ข้อผิดพลาดของเทสต์ `session`, `room-merge`, `drag-sort` ไม่ใช่ของงานนี้
- ห้ามเพิ่ม dependency ห้ามเรียกเครือข่ายจริงในเทสต์ (สอด `fetchImpl` ปลอม)
- ห้ามใช้พอร์ต 8791 ถ้าต้องรันจริงใช้ `DATA_DIR=$(mktemp -d) PORT=8792 HOST=127.0.0.1`
- เซิร์ฟเวอร์ใหม่ห้ามอ่านหรือเขียนไฟล์ชื่อ `state.json`

## วิธีทำ
ทำงาน 4 ให้จบก่อน แล้วจึงงาน 5 แต่ละงาน: เขียนเทสต์ตามรายการในแผนก่อน (ทุกกรณีที่แผนระบุต้องมีเทสต์ กรณีละหนึ่งเทสต์) รันให้ล้ม แล้วเขียนโค้ดให้ผ่าน
เขียนไฟล์ด้วยเครื่องมือแก้ไฟล์ ไม่ใช้ shell

## เกณฑ์ผ่าน
- `node --test test/tokens.test.mjs test/room-doc.test.mjs test/store-file.test.mjs test/store.test.mjs test/commands.test.mjs test/youtube.test.mjs test/qr.test.mjs test/room-service.test.mjs test/handlers.test.mjs test/yt-cache.test.mjs test/server.test.mjs` ผ่านทั้งหมด
- `grep -rn "remoteAddress\|LOCAL_ADDRESSES\|app.mjs" lib server.mjs` ไม่พบอะไร
- ตัวจัดการทุกตัวตรวจโทเคนก่อนอ่าน `body` และก่อนเรียก `store` หรือ `fetchImpl`
- รันจริงแล้ว `curl -s localhost:8792/api/config` ได้ `{"mode":"local","db":"/local-db",…}` และ `curl -s -o /dev/null -w '%{http_code}' localhost:8792/api/room` ได้ `401`

## ส่งมอบ (ตอบในข้อความสุดท้าย)
รายการไฟล์ที่สร้าง แก้ และลบ · คำสั่งที่รันพร้อมผลจริง · จุดที่ตัดสินใจเองเพราะแผนไม่ได้ระบุ · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ
**ไม่ต้อง commit**
