# ใบงาน 18 — หน้ามือถือบนระบบห้อง (งาน 10)
ผู้รับงาน: agy · โมเดล: gemini-4-neon-high · mode: accept-edits

## เป้าหมาย
ทำ **งาน 10** ใน `docs/plans/2026-11-25-online.md` ให้ครบทุกช่อง: หน้าสั่งเพลงบนมือถือ (`public/remote.html` + `public/js/remote.js`) ใช้โทเคนแขก ตัวซิงก์ใหม่ และคำสั่ง `moveTo`
หน้าตาและวิธีใช้เดิมต้องเหมือนเดิมทุกอย่าง นอกจากสิ่งที่งาน 10 เพิ่ม

## อ่านก่อนเริ่ม
1. `docs/plans/2026-11-25-online.md` — "ข้อกำหนดร่วม", "จุดที่ต้องจับตาตอนรีวิว" ข้อ 2, 3 และ 5, งาน 8 (ลายเซ็นของโมดูลที่ต้องเรียก) และงาน 10
2. `docs/specs/2026-11-25-online-design.md` — §7, §8, §9
3. โมดูลที่เสร็จแล้วและต้องใช้ตามที่เป็น: `public/js/session.js`, `public/js/sync.js`, `public/js/api.js`, `public/js/drag-sort.js`
4. `public/js/remote.js` ทั้งไฟล์ก่อนแก้ โดยเฉพาะ: `roomKey` จาก `?k=` (ราวบรรทัด 16), `updateConnectionStatus` (ราวบรรทัด 226), การสร้าง `sync` (ราวบรรทัด 242), `sendCommand` และการจัดการ 401 (ราวบรรทัด 262–277, 753), `onMove` ของการลาก (ราวบรรทัด 683), การตรวจเพลงที่ฝังได้ด้วย `fetch` ตรง (ราวบรรทัด 713), การค้นหา (ราวบรรทัด 740)
5. `public/js/app.js` เพิ่งถูกแก้ในงานเดียวกันฝั่งจอหลัก ดูเป็นตัวอย่างวิธีเรียก `takeToken`, `createSync`, `onRoom` ได้ แต่ห้ามแก้

## ขอบเขต
- แก้: `public/js/remote.js`, `public/remote.html`, `public/remote.css`
- **ห้ามแตะไฟล์อื่น** รวมถึง `public/js/app.js`, `index.html`, `styles.css`, `tokens.css`, `sync.js`, `session.js`, `api.js`, `drag-sort.js`, `store.js`, `commands.js` และทุกอย่างใน `lib/`, `test/`, `server.mjs` (มีคนอื่นกำลังเขียน `lib/` และ `server.mjs` ขนานอยู่ ข้อผิดพลาดจากไฟล์เหล่านั้นให้ข้ามและรายงาน) ถ้าพบว่าโมดูลในข้อ 3 มีข้อบกพร่อง ให้รายงาน ไม่แก้
- ห้ามเพิ่ม dependency · ห้ามใช้ `innerHTML` กับข้อมูลภายนอก · ห้ามใส่สไตล์หรือสคริปต์ฝังใน HTML (หน้าเว็บจะมี Content-Security-Policy)
- โครงหน้าเดิมห้ามเปลี่ยน: `#r-top` (ช่องค้นหาและแท็บ) ติดบนเมื่อจอสูงอย่างน้อย 600px, `#r-now` เป็นแถบล่างสูง 72px บวก safe-area, toast อยู่เหนือแถบล่าง · id เดิมทั้งหมดคงไว้ (`#r-now #r-name #r-top #r-search-form #r-search-input #r-search-note #r-tab-results #r-tab-queue #r-panel-results #r-panel-queue #r-toasts #r-status`) ของใหม่ใช้ชิ้นส่วนใน `public/tokens.css`
- ช่องใส่ชื่อคนขอ (`karaoke.remote.name` ใน localStorage) ทำงานเหมือนเดิม

## รายละเอียดที่ต้องตรง
- เลิกอ่าน `?k=` ทั้งหมด · เริ่มหน้า: `takeToken('g')` คืน `null` → แสดงสถานะเต็มหน้า "สแกน QR จากจอหลักเพื่อเข้าห้อง" ไม่เรียก `createSync` และปิดการใช้ช่องค้นหา
- `createSync({ token, roomId, onState, onControl, onStatus, onRoom })` · หน้านี้ไม่ต้องทำอะไรกับ `onControl`
- สถานะ `bad_key` (จาก `onStatus` หรือจากคำสั่ง/ค้นหาที่ตอบ 401) → ข้อความเต็มหน้า "รหัสห้องเปลี่ยนแล้ว สแกน QR จากจอหลักอีกครั้ง" เรียก `forgetToken('g')` เรียก `sync.stop()` และไม่ส่งคำสั่งอีก · `gone` (หรือคำสั่งที่ตอบ 404 `no_room`) → "ห้องนี้ถูกปิดแล้ว" · `online`/`offline` ใช้ตัวแสดงสถานะเดิม
- `onRoom(info)`: ถ้า `info.role !== 'g'` ถือเป็น `bad_key` · แสดง `info.name` (ชื่อห้อง) ที่ส่วนบนของหน้าด้วย `.pill` หรือ `.eyebrow` โดยไม่ทำให้ `#r-top` สูงขึ้นเกิน 8px
- ลากคิว: `onMove(qid, delta, beforeQid)` → `{ type: 'moveTo', qid, beforeQid }` · ปุ่มลูกศรของคีย์บอร์ดยังส่ง `{ type: 'move', qid, delta }`
- ตรวจเพลงที่ฝังได้: ใช้ `fetchEmbeddable(ids, { signal, token })` จาก `api.js` แทน `fetch` ตรง (ผลลัพธ์มีรูปเดิม `{ [id]: true | false | null }`)
- `search(query, { signal, token })` ส่ง `token`
- คำสั่งที่ตอบ 409 `queue_full` → toast "คิวเต็มแล้ว (200 เพลง)" · 403 `owner_only` → toast "ทำได้เฉพาะที่จอหลัก"
- สแนปช็อตจาก `onState` มีรูป `{ rev, name, guestEpoch, ownerEpoch, current, queue, history, playerState }`

## การตรวจ
- `node --check public/js/remote.js`
- `node --test test/session.test.mjs test/room-merge.test.mjs test/drag-sort.test.mjs test/store.test.mjs test/commands.test.mjs` ยังผ่าน
- `grep -n "[?&]k=\|get('k')\|roomKey\|/api/events\|/api/state\|fetch(\`/api/embeddable" public/js/remote.js public/remote.html` ไม่พบอะไร
- `grep -n "style=\"" public/remote.html` ไม่พบอะไร
- เปิดเบราว์เซอร์ไม่ได้ในงานนี้: หัวหน้าทีมจะตรวจภาพและการทำงานจริงเอง ให้ระบุในรายงานว่าจุดไหนที่ยังไม่ได้เห็นผลจริง

## ส่งมอบ (ตอบในข้อความ)
รายการไฟล์ที่แก้พร้อมสรุปต่อไฟล์ · คำสั่งที่รันพร้อมผลจริง · จุดที่ตัดสินใจเองเพราะแผนไม่ได้ระบุ (รวมข้อความภาษาไทยที่ตั้งเอง) · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ
**ไม่ต้อง commit**
