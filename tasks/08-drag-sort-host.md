# ใบงาน 08 — ลากจัดลำดับคิวบนจอหลัก
ผู้รับงาน: agy · โมเดล: gemini-4-neon-high · mode: accept-edits

อ่าน `docs/DESIGN.md` หัวข้อ **"รอบ 4 — ลากจัดลำดับคิว"** ก่อน — สัญญาของ `public/js/drag-sort.js` อยู่ที่นั่น
ไฟล์ `drag-sort.js` อีกคนกำลังเขียนขนานอยู่ (ตอนนี้อาจยังไม่มี) ให้ import ตามสัญญาได้เลย: `import { createDragSort } from './drag-sort.js';` — **ห้ามสร้างหรือแก้ไฟล์นั้น**

## เป้าหมาย
ในแท็บ "คิว" ของจอหลัก ผู้ใช้จับที่จับของแถวแล้วลากขึ้น–ลงเพื่อเปลี่ยนลำดับได้ ปล่อยแล้วส่งคำสั่ง `move` ครั้งเดียว

## ขอบเขต
- แก้ได้: `public/js/app.js`, `public/styles.css`
- ห้ามแตะ: ไฟล์อื่นทั้งหมด (โดยเฉพาะ `public/js/drag-sort.js`, `public/js/remote.js`, `public/remote.css`, `public/tokens.css`, `public/index.html`)
- ห้ามเปลี่ยน: ขนาด/ตำแหน่งของ `#stage`, `#nowbar`, `#sidebar` ทุกโหมด; id ที่มีอยู่; พฤติกรรมอื่นของหน้า

## วิธีทำงาน
แก้ไฟล์ด้วยเครื่องมือแก้ไฟล์เท่านั้น · sandbox ไม่มีเครือข่าย/เบราว์เซอร์ · ใช้แค่ `node --check public/js/app.js`

## งาน (ทั้งหมดอยู่ใน `renderQueuePanel` และส่วนที่เรียกมัน)
1. แถวคิว `li.qrow`: ใส่ `data-qid` = qid ของรายการ
2. เพิ่มที่จับเป็นปุ่มแรกของแถว: `<button type="button" class="btn-round drag-handle" aria-label="ลากเพื่อจัดลำดับ หรือกดลูกศรขึ้น–ลง">` ไอคอนจุด 6 จุด (SVG 2 คอลัมน์ × 3 แถว) ขนาด 40×40px — วางในบรรทัดที่สองของแถว คอลัมน์ที่ 1 (ใต้เลขอันดับ จัดกลางในคอลัมน์ 44px) · คิวมีเพลงเดียว → `disabled`
3. **เอาปุ่ม "เลื่อนขึ้น" และ "เลื่อนลง" ออก** (ที่จับทำแทนแล้ว รวมถึงคีย์บอร์ด ↑/↓) — เหลือปุ่มชิดขวา 3 ปุ่ม: ขึ้นบนสุด / เล่นเลย / ลบ
4. หลังสร้าง `ul.qlist` ทุกครั้ง: เรียก `destroy()` ของตัวลากตัวเก่า (ถ้ามี) แล้ว
   `createDragSort({ list: ul.qlist, scroller: <element พื้นที่รายการที่ overflow-y:auto ในโหมด desktop/compact; โหมด stacked ส่ง null>, onMove: (qid, delta) => dispatch({ type: 'move', qid, delta }), onDragState })`
   ตัดสินโหมดด้วย `getComputedStyle(scrollArea).overflowY` (`auto`/`scroll` → ส่ง element, ไม่งั้น `null`)
5. ระหว่าง `dragSort.isDragging()` **ห้าม render แผงคิวใหม่**: ถ้ามี state ใหม่เข้ามา (SSE หรือ demo) ให้ตั้งธง `queueRenderPending = true` แล้ว render แผงคิวตอน `onDragState(false)` — ส่วนอื่น (nowbar, ตัวเลขแท็บ, ตัวเล่น) อัปเดตตามปกติ
6. หลังย้ายด้วยคีย์บอร์ดและแผงคิว render ใหม่ → คืนโฟกัสให้ที่จับของแถวที่ `data-qid` เดิม (จำ qid ล่าสุดที่ `onMove` ถูกเรียกขณะ `document.activeElement` เป็นที่จับ)
7. `dispatch` ของ `move` ล้มเหลว (โหมดปกติ) → toast เดิม แล้ว render แผงคิวจาก state ล่าสุด
8. โหมด `?demo=1`: ใช้ทางเดียวกัน (`dispatch` → `applyCommand` ในเครื่อง)

## สไตล์ (`styles.css`)
```
.drag-handle { touch-action: none; cursor: grab; }
.drag-handle:active { cursor: grabbing; }
.qrow.is-dragging { position: relative; z-index: 5; background: rgba(40, 34, 70, 0.96); border-color: rgba(51, 225, 255, 0.7);
  box-shadow: 0 0 0 1px rgba(51, 225, 255, 0.6), 0 14px 40px rgba(51, 225, 255, 0.25); cursor: grabbing; }
.qlist.is-sorting .qrow:hover { background: transparent; border-color: transparent; }   /* ไม่ให้ hover กระพริบตอนลากผ่าน */
.qlist.is-sorting .qrow.is-dragging:hover { background: rgba(40, 34, 70, 0.96); border-color: rgba(51, 225, 255, 0.7); }
```
ที่จับอยู่ grid-column 1 ของบรรทัดที่สอง (`justify-self:center`); กลุ่มปุ่มเดิม (`.qa`) ยังกินคอลัมน์ 2–3 ชิดขวา · ห้ามใส่ `overflow:hidden` ให้ `.qlist` หรือ `.qrow` (เงาของแถวที่ลากต้องไม่ถูกตัด — ยกเว้นขอบของพื้นที่เลื่อน)

## ขนาดจอ
1440x900, 1024x768, 844x390, 390x844, กว้าง 360 — แถวคิวไม่ล้น, ไม่มีการเลื่อนแนวนอน, ปุ่มทุกปุ่ม ≥ 40×40px

## กลไกการจัดวาง
ไม่เปลี่ยน: รายการคิวอยู่ในพื้นที่เลื่อนของ `#sidebar` (desktop/compact) หรือไหลตามหน้า (stacked) · แถวที่ลากขยับด้วย `transform` ที่โมดูลตั้งให้ ห้ามเขียน CSS `transform`/`transition` ทับบน `.qrow`

## เทสต์กรอบ
ไม่มีในใบนี้ — หัวหน้าจะลองลากจริงในเบราว์เซอร์

## สถานะอื่น
คีย์บอร์ด: Tab ไปที่จับได้, ↑/↓ ย้ายทีละขั้น, โฟกัสตามแถวไป · `prefers-reduced-motion`: tokens.css จัดการแล้ว

## ภาพที่ต้องได้
ที่จับเห็นเป็นปุ่มกลมกระจกมีจุด 6 จุดใต้เลขอันดับทุกแถว; แถวที่กำลังลากมีขอบฟ้าเรืองและพื้นทึบกว่าแถวอื่น

## ภาษาไทย
ไม่มีข้อความใหม่บนจอ (มีแค่ `aria-label`)

## การตรวจ
`node --check public/js/app.js` ผ่าน

## ส่งมอบ
สรุปสิ่งที่เปลี่ยน, คำสั่งที่รันและผลจริง, หัวข้อ **"สิ่งที่ยังไม่ได้ตรวจด้วยตา"** · ไม่ต้อง commit
