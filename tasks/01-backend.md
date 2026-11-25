# ใบงาน 01 — Backend ค้นหา YouTube + เสิร์ฟหน้าเว็บ
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / medium · sandbox: workspace-write

อ่าน `docs/DESIGN.md` ก่อน (สัญญา API และกติกาเติมคำนำหน้าอยู่ที่นั่น ใบงานนี้ไม่ทวนซ้ำ)

## เป้าหมาย
`node server.mjs` เปิดเว็บที่ http://127.0.0.1:8791 เสิร์ฟไฟล์ใน `public/` และมี `GET /api/search?q=` ที่ค้น YouTube
โดยไม่ใช้ API key แล้วคืนรายการเพลงตามสัญญา

## ขอบเขต
- สร้าง/แก้ได้: `server.mjs`, `lib/**`, `test/youtube.test.mjs`, `test/app.test.mjs`
- ห้ามแตะ: `public/**`, `test/store.test.mjs` (อีกคนกำลังทำขนานอยู่ — error จากไฟล์พวกนี้ให้ข้ามและรายงาน), `docs/**`, `package.json`, `tasks/**`, `test/fixtures/**`
- ห้ามติดตั้ง package ใด ๆ ใช้เฉพาะโมดูลในตัวของ Node 22 · sandbox ไม่มีเครือข่าย ห้ามพยายามเรียก YouTube จริงหรือเปิดพอร์ต

## โครงที่ต้องได้

`lib/youtube.mjs`
- `normalizeQuery(raw)` → string ตามตารางใน DESIGN.md; ว่างหลัง trim → throw Error ที่มี `code === 'missing_query'`
- `parseDuration("4:28")` → 268 · `"1:02:03"` → 3723 · รูปแบบอื่น/ว่าง → 0
- `parseSearchResponse(json)` → `Song[]` (มี `views` ด้วย) เดินตาม
  `contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[].itemSectionRenderer.contents[].videoRenderer`
  - `title` = ต่อ `title.runs[].text` · `channel` = `ownerText.runs[0].text` ถ้าไม่มีใช้ `longBylineText.runs[0].text` ถ้าไม่มีอีก `""`
  - `duration` = `lengthText.simpleText` · `views` = `viewCountText.simpleText` หรือ `""`
  - `thumbnail` = `https://i.ytimg.com/vi/<id>/mqdefault.jpg`
  - ข้าม: รายการที่ไม่ใช่ `videoRenderer`, ไม่มี `videoId`, ไม่มี `lengthText` (ไลฟ์), `durationSec` เป็น 0, id ซ้ำ
  - ตัดที่ 30 รายการ · โครง JSON ผิดรูป/เป็น null → คืน `[]` ไม่ throw
- `searchYouTube(rawQuery, { fetchImpl = fetch })` → `{ query, items }`
  - `POST https://www.youtube.com/youtubei/v1/search?prettyPrint=false`
  - headers: `Content-Type: application/json`, `User-Agent: Mozilla/5.0`
  - body: `{"context":{"client":{"clientName":"WEB","clientVersion":"2.20241120.01.00","hl":"th","gl":"TH"}},"query":"<query หลัง normalize>"}`
  - timeout 8 วินาที (`AbortSignal.timeout(8000)`)
  - HTTP ไม่ใช่ 2xx, fetch throw, JSON อ่านไม่ได้ → throw Error ที่มี `code === 'upstream_failed'`

`lib/app.mjs`
- `createApp({ publicDir, fetchImpl, now = Date.now })` → `{ handle }`
- `handle({ method, url })` → `Promise<{ status, headers, body }>` (`body` เป็น string หรือ Buffer) — ต้องทดสอบได้โดยไม่เปิดพอร์ต
- `/api/search`: ตามสัญญา + แคชในหน่วยความจำ คีย์คือ query หลัง normalize, อายุ 10 นาที, เก็บสูงสุด 200 คีย์ (เกินแล้วทิ้งตัวเก่าสุด), ไม่แคชผลที่ผิดพลาด
- ไฟล์หน้าเว็บ: `/` → `index.html`; กัน path traversal (`/../server.mjs`, `/%2e%2e/…`, path ที่ decode ไม่ได้ → 404 ทั้งหมด); 
  content-type ของ `.html .css .js .mjs .json .svg .png .jpg .webp .ico .woff2` (ข้อความใส่ `; charset=utf-8`); `Cache-Control: no-cache`
- method อื่นนอกจาก GET/HEAD → `405`

`server.mjs`
- `http.createServer` ครอบ `handle` · ฟังที่ `127.0.0.1` พอร์ตจาก `process.env.PORT` หรือ `8791` · `publicDir` = โฟลเดอร์ `public` ข้างไฟล์
- พิมพ์ URL หนึ่งบรรทัดตอนเริ่ม · error ที่ไม่คาดคิดใน handle → 500 `{"error":"internal"}` ไม่ทำให้โปรเซสล้ม

## เกณฑ์ผ่าน (เขียนเป็นเทสต์ `node --test`)
`test/youtube.test.mjs`
- `normalizeQuery` ครบทั้ง 5 แถวในตาราง DESIGN.md + ข้อความยาว 150 ตัวอักษรถูกตัดเหลือ 100 ก่อนเติมคำนำหน้า
- `parseDuration` 3 กรณีข้างบน + `""`, `undefined`, `"abc"` → 0
- `parseSearchResponse` กับ `test/fixtures/search-sample.json` (ข้อมูลจริง 19 วิดีโอ + ไลฟ์ 1 รายการ id `LIVE0000001` + รายการซ้ำของตัวแรก 1 รายการ + รายการชนิดอื่น):
  ได้ 19 รายการพอดี, ไม่มี `LIVE0000001`, id ไม่ซ้ำ, ตัวแรกตรงกับตัวอย่างใน DESIGN.md ทุกฟิลด์
- `parseSearchResponse(null)`, `({})`, `({contents:{}})` → `[]`
- `searchYouTube` กับ fetch ปลอม: ตรวจว่า body ที่ส่งมี `query` = `คาราโอเกะ ลูกอม` และ `hl` = `th`; fetch ปลอมตอบ 500 → `upstream_failed`; fetch ปลอม throw → `upstream_failed`

`test/app.test.mjs` (ใช้โฟลเดอร์ชั่วคราวจาก `fs.mkdtemp` เป็น `publicDir` พร้อม `index.html` กับ `js/a.js` ที่เทสต์สร้างเอง)
- `/api/search?q=%E0%B8%A5%E0%B8%B9%E0%B8%81%E0%B8%AD%E0%B8%A1` → 200, `query` = `คาราโอเกะ ลูกอม`, 19 items, content-type json
- เรียกซ้ำ query เดิม → fetch ปลอมถูกเรียกรวม 1 ครั้ง · เลื่อน `now` ไป 10 นาที 1 วินาที → ถูกเรียกครั้งที่ 2
- `/api/search` ไม่มี q และ `q=%20%20` → 400 `missing_query` · upstream ล้ม → 502 `upstream_failed` และครั้งถัดไปเรียก fetch ใหม่ (ไม่แคชผลผิด)
- `/` → 200 text/html · `/js/a.js` → 200 javascript · `/nope.css` → 404 · `/../server.mjs` และ `/%2e%2e/%2e%2e/etc/passwd` → 404 · `POST /api/search` → 405

## การตรวจ
`node --test test/youtube.test.mjs test/app.test.mjs` ต้องผ่านทั้งหมด (ไม่ต้องรันไฟล์เทสต์อื่น)

## ส่งมอบ
สรุปไฟล์ที่สร้าง, คำสั่งที่รัน, ผลเทสต์จริง (จำนวนผ่าน/ล้ม), สิ่งที่ยังไม่ได้ตรวจ (เช่น การเรียก YouTube จริง การเปิดพอร์ต) · ไม่ต้อง commit
