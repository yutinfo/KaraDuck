# ใบงาน 07 — ตัวลากจัดลำดับคิว (โมดูลกลาง) + ใส่ในหน้ามือถือ
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

อ่าน `docs/DESIGN.md` หัวข้อ **"รอบ 4 — ลากจัดลำดับคิว"** ก่อน (สัญญาของ `drag-sort.js` อยู่ที่นั่น — ต้องตรงตัว เพราะอีกคนกำลังเรียกใช้จากจอหลักขนานกัน)

## เป้าหมาย
ผู้ใช้กดค้างที่จับของแถวคิวแล้วลากขึ้น–ลงเพื่อเปลี่ยนลำดับได้ บนมือถือใช้นิ้ว บนคอมใช้เมาส์ ปล่อยแล้วลำดับเปลี่ยนจริง (ส่งคำสั่ง `move` ครั้งเดียว)

## ขอบเขต
- สร้าง/แก้ได้: `public/js/drag-sort.js` (ใหม่), `test/drag-sort.test.mjs` (ใหม่), `public/js/remote.js`, `public/remote.css`
- ห้ามแตะ: `public/js/app.js`, `public/styles.css`, `public/index.html` (อีกคนกำลังแก้ขนานอยู่), `public/tokens.css`, `public/remote.html`, `server.mjs`, `lib/**`, เทสต์ไฟล์อื่น, `docs/**`, `tasks/**`
- ไม่ติดตั้ง package · ไม่มีเครือข่าย/เบราว์เซอร์ใน sandbox · ข้อมูลจากภายนอกใส่ด้วย `textContent`/`setAttribute`

## งาน A — `public/js/drag-sort.js`
ตามสัญญาใน DESIGN.md และรายละเอียดนี้:
- `pointerdown` (ปุ่มหลัก/นิ้ว) บนที่จับ → `preventDefault`, `setPointerCapture`, จำ `tops`/`heights` ของทุกแถว (จาก `getBoundingClientRect`) และตำแหน่งเลื่อนของ `scroller`
- `pointermove`: แถวที่ลาก `transform: translateY(<dy>px)` โดย dy รวมระยะที่ `scroller` เลื่อนไปตั้งแต่เริ่มลาก และจำกัดไม่ให้เลยขอบบน/ล่างของรายการ; คำนวณตำแหน่งใหม่ด้วย `indexAfterDrag`; แถวที่อยู่ระหว่างตำแหน่งเดิมกับตำแหน่งใหม่ขยับหลบ `translateY(±(ความสูงแถวที่ลาก + ช่องไฟระหว่างแถว))` พร้อม `transition: transform .15s` (ช่องไฟ = ระยะจากขอบล่างแถวแรกถึงขอบบนแถวที่สอง; มีแถวเดียว = 0)
- `indexAfterDrag({ tops, heights, from, pointerY })`: ตำแหน่งใหม่ = จำนวนแถวอื่นที่จุดกึ่งกลาง (`top + height/2`) อยู่เหนือจุดกึ่งกลางของแถวที่ลาก ณ ตำแหน่งปัจจุบัน — โดย `pointerY` คือจุดกึ่งกลางปัจจุบันของแถวที่ลาก; ผลต้องอยู่ใน 0…n−1; แถวเดียว → 0
- เลื่อนอัตโนมัติ: นิ้วอยู่ในระยะ 48px จากขอบบน/ล่างของ `scroller` (หรือของ viewport เมื่อ `scroller` เป็น null) → เลื่อน 12px ต่อเฟรมด้วย `requestAnimationFrame` จนพ้นระยะหรือสุดขอบ
- `pointerup`: ถ้าตำแหน่งเปลี่ยน → ย้าย element ใน DOM (`insertBefore`), ล้าง inline `transform`/`transition` ของทุกแถว, เอา class ออก, เรียก `onDragState(false)` แล้ว `onMove(qid, delta)`; ไม่เปลี่ยน → ล้างอย่างเดียว
- Escape ระหว่างลาก หรือ `pointercancel` → ล้างทุกอย่าง กลับลำดับเดิม ไม่เรียก `onMove`
- คีย์บอร์ดบนที่จับ: `ArrowUp` → `onMove(qid, -1)` ถ้าไม่ใช่แถวแรก; `ArrowDown` → `onMove(qid, +1)` ถ้าไม่ใช่แถวสุดท้าย; `preventDefault` ทั้งคู่
- ระหว่างลาก: `document.body.style.userSelect = 'none'` แล้วคืนค่าเดิมตอนจบ; กัน `contextmenu` บนที่จับ (กดค้างบนมือถือ)
- `destroy()` ถอด listener ทั้งหมดและยกเลิกการลากที่ค้างอยู่ · เรียก `createDragSort` กับ `list` ที่มีแถวเดียวหรือไม่มีแถว → ทำงานได้ ไม่ error
- ห้ามใช้ HTML5 drag-and-drop API (`draggable`, `dragstart`) เพราะใช้กับนิ้วไม่ได้

## งาน B — หน้ามือถือ (`remote.js`, `remote.css`)
1. แถวคิว (`.qrow`) ใส่ `data-qid`; เพิ่มที่จับ `<button type="button" class="btn-round drag-handle" aria-label="ลากเพื่อจัดลำดับ หรือกดลูกศรขึ้น–ลง">` ไอคอนจุด 6 จุด (SVG) ขนาด 44×44px วางในบรรทัดที่สองของแถว คอลัมน์ที่ 1 (ใต้เลขอันดับ จัดกลางคอลัมน์ 44px); ปุ่ม "ขึ้นบนสุด" / "ลบ" อยู่ที่เดิม
2. `.drag-handle{touch-action:none; cursor:grab}` · `.qrow.is-dragging{position:relative; z-index:5; background:rgba(40,34,70,.96); border-radius:14px; box-shadow:0 0 0 1px rgba(51,225,255,.7),0 14px 40px rgba(51,225,255,.25); cursor:grabbing}` · `.is-sorting .qrow{border-bottom-color:transparent}` · คิวมีเพลงเดียว → ที่จับ `disabled`
3. หลัง render รายการคิวทุกครั้ง: `destroy()` ตัวเก่า แล้ว `createDragSort({ list, scroller: null, onMove: (qid, delta) => ส่งคำสั่ง {type:'move', qid, delta}, onDragState })`
4. ระหว่าง `isDragging()` ห้าม render แผงคิวใหม่: ถ้ามี snapshot เข้ามาให้จำว่าค้าง แล้ว render ตอน `onDragState(false)` (ส่วนอื่นของหน้า เช่น `#r-now` และตัวเลขบนแท็บ อัปเดตได้ตามปกติ)
5. หลังสั่งย้ายด้วยคีย์บอร์ดและรายการ render ใหม่ → คืนโฟกัสให้ที่จับของแถวที่มี `qid` เดิม
6. คำสั่ง `move` ล้มเหลว → toast เดิม "ส่งคำสั่งไม่สำเร็จ ลองอีกครั้ง" แล้ว render แผงคิวจาก snapshot ล่าสุด (ลำดับกลับที่เดิม)

## เกณฑ์ผ่าน
`test/drag-sort.test.mjs` (`node --test`, ทดสอบ `indexAfterDrag` ล้วน — import ต้องไม่แตะ `document`/`window` ตอนโหลดโมดูล):
แถวสูง 100 เว้น 10 จำนวน 4 แถว (`tops=[0,110,220,330]`):
- `from:0, pointerY:50` → 0 · `from:0, pointerY:170` → 1 · `from:0, pointerY:400` → 3
- `from:3, pointerY:380` → 3 · `from:3, pointerY:40` → 0 · `from:2, pointerY:165` → 2 · `from:2, pointerY:155` → 1
- `from:1, pointerY:-500` → 0 · `from:1, pointerY:9999` → 3 · แถวเดียว → 0 · ความสูงไม่เท่ากัน (`heights=[60,140,60]`, `tops=[0,70,220]`, `from:0`, `pointerY:150`) → 1
หัวหน้าจะลองลากจริงในเบราว์เซอร์: ลากแถว 1 ไปตำแหน่ง 3 → เซิร์ฟเวอร์ได้ `move` delta 2 ครั้งเดียว; Escape กลางทาง → ไม่มีคำสั่ง; ปุ่มที่มองเห็นทุกปุ่ม ≥ 44×44px; ไม่มีการเลื่อนแนวนอนที่กว้าง 360px

## การตรวจ
`node --test` (ทั้งชุดต้องผ่าน) · `node --check public/js/drag-sort.js public/js/remote.js`

## ส่งมอบ
สรุปไฟล์ที่สร้าง/แก้, คำสั่งที่รัน, ผลเทสต์จริง, สิ่งที่ยังไม่ได้ตรวจ (การลากจริงด้วยนิ้ว/เมาส์) · ไม่ต้อง commit
