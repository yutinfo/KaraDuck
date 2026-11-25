# ใบงาน 17 — จอหลักบนระบบห้อง (งาน 9)
ผู้รับงาน: agy · โมเดล: gemini-4-neon-high · mode: accept-edits

## เป้าหมาย
ทำ **งาน 9** ใน `docs/plans/2026-11-25-online.md` ให้ครบทุกช่อง: จอหลัก (`public/index.html` + `public/js/app.js`) ใช้โทเคนเจ้าของห้อง ตัวซิงก์ใหม่ และ QR จาก `GET /api/room`
หน้าตาและวิธีใช้เดิมต้องเหมือนเดิมทุกอย่าง นอกจากสิ่งที่งาน 9 เพิ่ม

## อ่านก่อนเริ่ม
1. `docs/plans/2026-11-25-online.md` — "ข้อกำหนดร่วม", "จุดที่ต้องจับตาตอนรีวิว" ข้อ 2 และ 4, งาน 8 (ลายเซ็นของโมดูลที่ต้องเรียก) และงาน 9
2. `docs/specs/2026-11-25-online-design.md` — §7, §8, §9
3. โมดูลที่เสร็จแล้วและต้องใช้ตามที่เป็น: `public/js/session.js`, `public/js/sync.js`, `public/js/api.js`, `public/js/room-merge.js`, `public/js/drag-sort.js`
4. `public/js/app.js` ทั้งไฟล์ก่อนแก้ โดยเฉพาะ: การสร้าง `sync` (ราวบรรทัด 259), `dispatch`, `handleSnapshot`, การรายงานสถานะตัวเล่น (ราวบรรทัด 322–328), การส่ง `advance` (ราวบรรทัด 307, 318, 1339), `getRemoteInfo` และ `/api/qr.svg` (ราวบรรทัด 378, 483, 1177), `onMove` ของการลาก (ราวบรรทัด 1003), การค้นหาและตรวจเพลง (ราวบรรทัด 1239, 1281), ปุ่มกดยืนยันสองจังหวะของการล้างคิว

## ขอบเขต
- แก้: `public/js/app.js`, `public/index.html`, `public/styles.css`
- **ห้ามแตะไฟล์อื่น** รวมถึง `public/js/sync.js`, `session.js`, `api.js`, `room-merge.js`, `drag-sort.js`, `store.js`, `commands.js`, `tokens.css`, `remote.*` และทุกอย่างใน `lib/`, `test/`, `server.mjs` (มีคนอื่นกำลังเขียน `lib/` และ `server.mjs` ขนานอยู่ ข้อผิดพลาดจากไฟล์เหล่านั้นให้ข้ามและรายงาน) ถ้าพบว่าโมดูลในข้อ 3 มีข้อบกพร่อง ให้รายงาน ไม่แก้
- ห้ามเพิ่ม dependency · ห้ามใช้ `innerHTML` กับข้อมูลภายนอก · ห้ามใส่สไตล์หรือสคริปต์ฝังใน HTML (หน้าเว็บจะมี Content-Security-Policy: `style-src 'self' https://fonts.googleapis.com`, `img-src 'self' data: https://i.ytimg.com`) การตั้งค่าสไตล์ผ่าน `element.style.x = …` ใน JS ยังทำได้
- กรอบขนาดจอเดิมห้ามเปลี่ยน: `#stage`, `#nowbar`, ความกว้างแผงข้าง และกริดในทุกช่วงจอ (ตัวเลขใน `tasks/02-frontend.md` และ `tasks/05-glass-host.md`) ของใหม่ใช้ชิ้นส่วนใน `public/tokens.css` ที่มีอยู่ (`.glass`, `.btn-glass`, `.btn-neon`, `.pill`, `.eyebrow`)
- โหมด `?demo=1` (รวม `&tab=` และ `&idle=1`) ต้องทำงานเหมือนเดิมโดยไม่มีโทเคนและไม่เรียก API

## รายละเอียดที่ต้องตรง
- `takeToken('o')` คืน `null` → จอเต็ม (ทับทั้งหน้า) หัวข้อ "ต้องเปิดจากลิงก์ห้อง" พร้อมคำอธิบายสั้นว่าให้ขอลิงก์จากผู้ดูแล ไม่โหลดตัวเล่น YouTube และไม่เรียก `createSync`
- สถานะจาก `onStatus`: `bad_key` → จอเต็ม "ลิงก์ห้องนี้ใช้ไม่ได้แล้ว" เรียก `forgetToken('o')` หยุดตัวเล่น · `gone` → จอเต็ม "ห้องนี้ถูกปิดแล้ว" หยุดตัวเล่น · `online`/`offline` ใช้ตัวแสดงสถานะที่มีอยู่
- `onRoom(info)`: ถ้า `info.role !== 'o'` ให้ถือเป็น `bad_key` · แสดง `info.name` ในส่วนหัว (ข้างโลโก้ ด้วย `.pill`) · `info.qrSvg` → ตั้ง `src` ของรูป QR ทั้งสองจุดเป็น `'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(info.qrSvg)` · `qrSvg` เป็น `null` → ซ่อนรูป แสดงเฉพาะลิงก์ · ข้อความลิงก์ที่แสดงใต้ QR ใช้ `info.guestUrl` โดยตัดส่วนหลัง `#` ออก (โทเคนไม่ต้องโชว์บนจอ)
- แท็บ "มือถือ": ปุ่ม "คัดลอกลิงก์แขก" (`navigator.clipboard.writeText(info.guestUrl)` แล้วขึ้น toast; คัดลอกไม่ได้ → toast บอกว่าคัดลอกไม่ได้) และปุ่ม "เปลี่ยนรหัสแขก" แบบกดยืนยันสองจังหวะเหมือนปุ่มล้างคิว → `dispatch({ type: 'rotateGuest' })` สำเร็จแล้วเรียก `getRoom({ token })` และอัปเดต QR กับลิงก์ · ใต้ปุ่มมีคำอธิบายสั้นว่ามือถือทุกเครื่องต้องสแกนใหม่
- ลากคิว: `onMove(qid, delta, beforeQid)` → `dispatch({ type: 'moveTo', qid, beforeQid })` · ปุ่มลูกศรของคีย์บอร์ดยังส่ง `{ type: 'move', qid, delta }`
- `advance`: ทุกจุดที่ส่งเมื่อเพลงจบหรือเล่นไม่ได้ ถ้า `dispatch` ล้มเหลวเพราะเครือข่าย (ข้อผิดพลาด `code: 'network_error'` หรือ `status` 5xx) ให้ส่งคำสั่งเดิม (มี `qid` เดิม และ `skipHistory` เดิม) ซ้ำหลัง 1, 2, 4, 8 วินาที แล้วทุก 8 วินาที · ยกเลิกทันทีเมื่อ `state.current?.qid` ไม่ใช่ `qid` นั้นแล้ว · มีตัวจับเวลาส่งซ้ำได้ครั้งละหนึ่งตัว
- `report`: ส่งเมื่อสถานะตัวเล่นค่าเดิมค้างครบ 1 วินาทีและต่างจากค่าที่ส่งสำเร็จล่าสุด (ตัวจับเวลาเดียว เริ่มนับใหม่เมื่อค่าเปลี่ยน)
- `search(query, { signal, token })` และ `fetchEmbeddable(ids, { signal, token })` ส่ง `token` ทุกครั้ง
- คำสั่งที่ตอบ `queue_full` (409) → toast "คิวเต็มแล้ว (200 เพลง)" · คำสั่งที่ตอบ 401 → ถือเป็น `bad_key`
- สแนปช็อตจาก `onState` มีรูป `{ rev, name, guestEpoch, ownerEpoch, current, queue, history, playerState }` (เพิ่ม `name` และรอบจากเดิม)

## การตรวจ
- `node --check public/js/app.js`
- `node --test test/session.test.mjs test/room-merge.test.mjs test/drag-sort.test.mjs test/store.test.mjs test/commands.test.mjs` ยังผ่าน
- `grep -n "getRemoteInfo\|/api/qr.svg\|/api/events\|/api/state\|remote-info\|[?&]k=" public/js/app.js public/index.html` ไม่พบอะไร
- `grep -n "style=\"" public/index.html` ไม่พบอะไร
- เปิดเบราว์เซอร์ไม่ได้ในงานนี้: หัวหน้าทีมจะตรวจภาพและการทำงานจริงเอง ให้ระบุในรายงานว่าจุดไหนที่ยังไม่ได้เห็นผลจริง

## ส่งมอบ (ตอบในข้อความ)
รายการไฟล์ที่แก้พร้อมสรุปต่อไฟล์ · คำสั่งที่รันพร้อมผลจริง · จุดที่ตัดสินใจเองเพราะแผนไม่ได้ระบุ (รวมข้อความภาษาไทยที่ตั้งเอง) · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ
**ไม่ต้อง commit**
