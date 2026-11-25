# ใบงาน 14 — แกนหลังบ้านของระบบออนไลน์ (รอบ A)
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

## เป้าหมาย
ทำ **งาน 1, งาน 2 และงาน 3** ใน `docs/plans/2026-11-25-online.md` ให้ครบตามที่เขียนไว้ทุกบรรทัด:
โทเคนแบบเซ็นชื่อ, คำสั่ง `moveTo` กับเพดานคิว, รูปข้อมูลห้องกับชั้นเก็บข้อมูลแบบไฟล์

## อ่านก่อนเริ่ม
1. `docs/plans/2026-11-25-online.md` — หัวข้อ "ข้อกำหนดร่วม", "โครงไฟล์" และงาน 1–3 (ลายเซ็นฟังก์ชัน ค่าคงที่ และรายการเทสต์อยู่ที่นั่น ถือเป็นสัญญา)
2. `docs/specs/2026-11-25-online-design.md` — §6 และ §7
3. โค้ดที่ต้องต่อยอด: `public/js/store.js`, `public/js/commands.js`, `test/store.test.mjs`, `test/commands.test.mjs`

## ขอบเขต
- สร้าง: `lib/tokens.mjs`, `lib/room-doc.mjs`, `lib/store-file.mjs`, `test/tokens.test.mjs`, `test/room-doc.test.mjs`, `test/store-file.test.mjs`
- แก้: `public/js/store.js`, `public/js/commands.js`, `test/store.test.mjs`, `test/commands.test.mjs`
- **ห้ามแตะไฟล์อื่น** โดยเฉพาะ `lib/app.mjs`, `server.mjs`, `public/js/app.js`, `public/js/remote.js`, `public/js/drag-sort.js` (เป็นงานของรอบถัดไป)
- ห้ามเพิ่ม dependency ห้ามรันเซิร์ฟเวอร์ ห้ามเรียกเครือข่าย
- `public/js/store.js` และ `commands.js` ถูกโหลดในเบราว์เซอร์ด้วย: ห้าม import โมดูลของ Node ในสองไฟล์นี้
- พฤติกรรมเดิมของ `store.js` และ `commands.js` ต้องไม่เปลี่ยน นอกจากที่งาน 2 ระบุ

## วิธีทำ
ทำทีละงานตามลำดับ 1 → 2 → 3 แต่ละงาน: เขียนเทสต์ตามรายการในแผนก่อน (ทุกกรณีที่แผนระบุต้องมีเทสต์) รันให้ล้ม แล้วจึงเขียนโค้ดให้ผ่าน
เขียนไฟล์ด้วยเครื่องมือแก้ไฟล์ ไม่ใช้ shell

## เกณฑ์ผ่าน
- `npm test` ผ่านทั้งหมด: เทสต์เดิม 83 ข้อยังผ่าน และมีเทสต์ใหม่ของงาน 1–3 ครบ
- ลายเซ็นและชื่อส่งออกตรงกับแผนทุกตัวอักษร (รอบถัดไปจะ import ตามนั้น)
- `node -e "import('./lib/tokens.mjs').then(m=>console.log(m.signToken('s',{roomId:'ABCDEFGHJKLMNPQR',role:'g',epoch:3}).length))"` พิมพ์ `42`

## ส่งมอบ (ตอบในข้อความสุดท้าย)
รายการไฟล์ที่สร้างและแก้ · คำสั่งที่รันพร้อมผลจริง (จำนวนเทสต์ผ่าน/ล้ม) · จุดที่ตัดสินใจเองเพราะแผนไม่ได้ระบุ · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ
**ไม่ต้อง commit** (หัวหน้าทีม commit เองหลังตรวจ)
