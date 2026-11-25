# ใบงาน 19 — ชั้นเก็บข้อมูล Firebase, ฟังก์ชัน Vercel และเครื่องมือผู้ดูแล (รอบ C)
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

## เป้าหมาย
ทำ **งาน 6 และงาน 7** ใน `docs/plans/2026-11-25-online.md` ให้ครบตามที่เขียนไว้ทุกบรรทัด:
ตัวขอโทเคนของบัญชีบริการ Google, ชั้นเก็บข้อมูล Firebase Realtime Database ผ่าน REST, ตัวห่อฟังก์ชันของ Vercel 6 เส้นทาง, `vercel.json`, `database.rules.json` และเครื่องมือ `tools/room.mjs`, `tools/setup.mjs`

## อ่านก่อนเริ่ม
1. `docs/plans/2026-11-25-online.md` — "ข้อกำหนดร่วม", "โครงไฟล์" (หน้าตาชั้นเก็บข้อมูล) และงาน 6–7 (ลายเซ็น ค่าคงที่ เส้นทาง REST และรายการเทสต์ถือเป็นสัญญา)
2. `docs/specs/2026-11-25-online-design.md` — §6, §8, §11, §12 (ตาราง Firebase: ETag, บัญชีบริการ), §14
3. ของที่มีแล้วและต้องใช้ตามที่เป็น: `lib/handlers.mjs` (`createHandlers`), `lib/store-file.mjs` (ดูเป็นตัวอย่างหน้าตาชั้นเก็บข้อมูลและค่า `'null_etag'`), `lib/security-headers.mjs`, `server.mjs` (ดูวิธีแปลงคำขอเป็น `request = { method, url, headers, body }` โดย `body` เป็น promise ที่อ่านเมื่อถูกขอ)

## ขอบเขต
- สร้าง: `lib/google-auth.mjs`, `lib/store-rtdb.mjs`, `lib/vercel.mjs`, `api/config.js`, `api/room.js`, `api/command.js`, `api/search.js`, `api/embeddable.js`, `api/admin.js`, `vercel.json`, `database.rules.json`, `tools/room.mjs`, `tools/setup.mjs` และเทสต์ `test/google-auth.test.mjs`, `test/store-rtdb.test.mjs`, `test/vercel.test.mjs`, `test/tools.test.mjs`
- แก้ได้: `.gitignore` (เพิ่ม `.env*` ถ้ายังไม่มี), `package.json` (เฉพาะ `scripts`; ห้ามเพิ่ม dependency)
- **ห้ามแตะ** `public/` ทั้งโฟลเดอร์, `lib/handlers.mjs`, `lib/room-service.mjs`, `lib/store-file.mjs`, `lib/tokens.mjs`, `lib/room-doc.mjs`, `lib/security-headers.mjs`, `server.mjs`, `spikes/` (ถ้าพบข้อบกพร่องในไฟล์เหล่านี้ให้รายงาน ไม่แก้)
- ห้ามเรียกเครือข่ายจริง: เทสต์ทุกตัวสอด `fetchImpl` ปลอม · ห้ามรัน `vercel` · ห้ามสร้างไฟล์ที่มีค่าความลับ
- ฟังก์ชันใน `api/` ใช้ลายเซ็นแบบ Web (`export const GET = …` / `export const POST = …` รับ `Request` คืน `Response`) ตามงาน 7
- ไฟล์ใน `api/` ต้องบางที่สุด: import `webHandler` แล้วส่งออกเมธอด ไม่มีตรรกะอื่น

## รายละเอียดที่ต้องตรง (เพิ่มจากแผน)
- `lib/vercel.mjs`: `body` ที่ส่งให้ตัวจัดการต้องเป็น promise แบบอ่านเมื่อถูกขอ (เหมือน `server.mjs`) เพื่อให้ตรวจโทเคนก่อนอ่านเนื้อคำขอ · ชื่อหัวใน `request.headers` เป็นตัวเล็กทั้งหมด · `url` คือเส้นทางพร้อม query (ไม่รวม origin)
- `FIREBASE_DB_URL` อาจมี `/` ต่อท้าย ให้ตัดออกก่อนใช้
- ที่อยู่ฐานข้อมูลจริงของโปรเจกต์นี้คือ `https://karaduck-3935d-default-rtdb.asia-southeast1.firebasedatabase.app` (ใช้เป็นค่าตัวอย่างในเทสต์ได้ ไม่ใช่ความลับ)
- `vercel.json` ต้องไม่มีค่าความลับ และต้องไม่ทำให้ไฟล์นอก `public/` ถูกเสิร์ฟ · ถ้าจำเป็นต้องระบุให้ฟังก์ชันรวมไฟล์จาก `public/js/` ให้ใช้ `functions["api/*.js"].includeFiles = "public/js/{store,commands}.js"`
- `tools/room.mjs` พิมพ์ลิงก์เจ้าของเต็ม ๆ เมื่อสร้างห้องหรือออกลิงก์ใหม่ พร้อมบรรทัดเตือนว่าให้ส่งทางช่องทางส่วนตัว · ห้ามพิมพ์ค่า `ADMIN_KEY`
- `tools/setup.mjs` พิมพ์ค่าที่สุ่มและคำสั่งที่ผู้ใช้ต้องรันเอง พร้อมรายการตัวแปรของ Firebase ที่ต้องใส่เอง (`FIREBASE_DB_URL`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) และบอกว่าค่ามาจากไฟล์กุญแจบัญชีบริการช่องไหน (`client_email`, `private_key`)

## วิธีทำ
ทำงาน 6 ให้จบก่อน แล้วจึงงาน 7 แต่ละงาน: เขียนเทสต์ตามรายการในแผนก่อน (ทุกกรณีที่แผนระบุต้องมีเทสต์) รันให้ล้ม แล้วเขียนโค้ดให้ผ่าน
เขียนไฟล์ด้วยเครื่องมือแก้ไฟล์ ไม่ใช้ shell

## เกณฑ์ผ่าน
- `node --test test/google-auth.test.mjs test/store-rtdb.test.mjs test/vercel.test.mjs test/tools.test.mjs test/handlers.test.mjs test/server.test.mjs` ผ่านทั้งหมด (มีคนอื่นแก้ `public/` ขนานอยู่ เทสต์ของ `session`, `room-merge`, `drag-sort` ไม่ใช่ของงานนี้)
- `ls api | wc -l` ได้ `6`
- `node -e "const v=JSON.parse(require('fs').readFileSync('vercel.json'));console.log(v.regions, v.cleanUrls)"` พิมพ์ `[ 'sin1' ] true`
- `node tools/setup.mjs` รันได้โดยไม่เรียกเครือข่ายและไม่เขียนไฟล์

## ส่งมอบ (ตอบในข้อความสุดท้าย)
รายการไฟล์ที่สร้างและแก้ · คำสั่งที่รันพร้อมผลจริง · จุดที่ตัดสินใจเองเพราะแผนไม่ได้ระบุ · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ (รวมสิ่งที่ต้องยืนยันบน Vercel จริง)
**ไม่ต้อง commit**
