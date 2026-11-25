# ใบงาน 15 — โมดูลหน้าเว็บที่ใช้ร่วมของระบบออนไลน์ (งาน 8)
ผู้รับงาน: agy · โมเดล: gemini-4-neon-high · mode: accept-edits

## เป้าหมาย
ทำ **งาน 8** ใน `docs/plans/2026-11-25-online.md` ให้ครบตามที่เขียนไว้ทุกบรรทัด:
ตัวอ่านและจำโทเคน, ตัวรวมเหตุการณ์ของช่องฟัง, ตัวซิงก์ใหม่, ตัวเรียก API ที่ส่งโทเคนในหัวคำขอ, และ `drag-sort` ที่ส่ง `beforeQid`

## อ่านก่อนเริ่ม
1. `docs/plans/2026-11-25-online.md` — "ข้อกำหนดร่วม", "จุดที่ต้องจับตาตอนรีวิว" ข้อ 3–5 และงาน 8 (ลายเซ็นฟังก์ชันและรายการเทสต์ถือเป็นสัญญา)
2. `docs/specs/2026-11-25-online-design.md` — §6 (รูปข้อมูลห้อง), §7 (รูปโทเคน), §8 (เส้นทาง API และรหัสข้อผิดพลาด), §9
3. โค้ดปัจจุบัน: `public/js/sync.js`, `public/js/api.js`, `public/js/drag-sort.js`, `public/js/store.js` (ใช้ `deserialize`), `test/drag-sort.test.mjs`

## ขอบเขต
- สร้าง: `public/js/session.js`, `public/js/room-merge.js`, `test/session.test.mjs`, `test/room-merge.test.mjs`
- เขียนใหม่: `public/js/sync.js` · แก้: `public/js/api.js`, `public/js/drag-sort.js`, `test/drag-sort.test.mjs`
- **ห้ามแตะไฟล์อื่น** มีคนอื่นกำลังแก้ `public/js/store.js`, `public/js/commands.js`, `lib/` และเทสต์ของไฟล์เหล่านั้นขนานอยู่ในโฟลเดอร์เดียวกัน ข้อผิดพลาดจากไฟล์นอกขอบเขตให้ข้ามและรายงาน
- `public/js/app.js` และ `public/js/remote.js` ยังเรียก `sync.js`/`api.js` แบบเก่า และจะพังชั่วคราวหลังงานนี้ **เป็นเรื่องที่ตั้งใจ** ห้ามแก้สองไฟล์นั้น (เป็นงาน 9 และ 10)
- ไฟล์ใน `public/js/` รันในเบราว์เซอร์: ห้าม import โมดูลของ Node · เทสต์รันด้วย `node --test` จึงต้องสอด `location`, `history`, `storage` ปลอมเข้าไปได้ตามลายเซ็นในแผน
- ห้ามเพิ่ม dependency ห้ามรันเซิร์ฟเวอร์ ห้ามเรียกเครือข่าย
- `room-merge.js` ต้องเป็นฟังก์ชันล้วน ไม่แตะ DOM และไม่แก้วัตถุที่รับเข้ามา

## รายละเอียดที่ต้องตรง
- โทเคนอยู่ในหัว `Authorization: Bearer <โทเคน>` เท่านั้น ห้ามใส่ใน URL
- `EventSource` ชี้ไปที่ `${db}/rooms/${roomId}.json` โดย `db` มาจาก `GET /api/config` (ค่าอาจเป็นเส้นทางสัมพัทธ์ `/local-db` หรือที่อยู่เต็ม `https://….firebasedatabase.app`)
- เหตุการณ์จากช่องฟัง: `put` และ `patch` มี `data` เป็น JSON `{ "path": "...", "data": ... }` · `keep-alive` ไม่ต้องทำอะไร · `cancel` และ `auth_revoked` → สถานะ `gone`
- ลำดับใน `start()`, กติกาของ `createControlGate`, การตรวจรอบของโทเคนเทียบกับ `guestEpoch`/`ownerEpoch` และสถานะ `gone` เป็นไปตามงาน 8 ในแผน
- `drag-sort.js`: เพิ่มอาร์กิวเมนต์ที่สามของ `onMove` ทั้งตอนวางจากการลากและตอนกดปุ่มลูกศร พฤติกรรมอื่นไม่เปลี่ยน

## วิธีทำ
เขียนเทสต์ตามรายการในงาน 8 ก่อน (ทุกกรณีที่แผนระบุต้องมีเทสต์) รันให้ล้ม แล้วเขียนโค้ดให้ผ่าน
รันเฉพาะเทสต์ของงานนี้: `node --test test/session.test.mjs test/room-merge.test.mjs test/drag-sort.test.mjs`
เขียนไฟล์ด้วยเครื่องมือแก้ไฟล์ ไม่ใช้ shell

## เกณฑ์ผ่าน
- คำสั่งเทสต์ข้างบนผ่านทั้งหมด
- ชื่อส่งออกและลายเซ็นตรงกับแผนทุกตัวอักษร: `takeToken`, `forgetToken`, `applyStreamEvent`, `toSnapshot`, `controlStamp`, `createControlGate`, `createSync`, `search`, `fetchEmbeddable`, `getRoom` · `getRemoteInfo` ถูกลบ
- `node --check` ผ่านทุกไฟล์ที่แตะ

## ส่งมอบ (ตอบในข้อความ)
รายการไฟล์ที่สร้างและแก้ · คำสั่งที่รันพร้อมผลจริง · จุดที่ตัดสินใจเองเพราะแผนไม่ได้ระบุ · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ
**ไม่ต้อง commit**
