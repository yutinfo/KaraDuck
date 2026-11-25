# ใบงาน 09 — หน้ามือถือ: แถบควบคุมเพลงไว้ล่างจอ + ช่องค้นหาติดบน
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

## เป้าหมาย
บนหน้า `/remote` ผู้ใช้ถือมือถือมือเดียวแล้วนิ้วโป้งกดหยุด/ข้ามเพลงได้ทันทีจากขอบล่าง และค้นเพลงถัดไปได้โดยไม่ต้องเลื่อนกลับขึ้นบน
- `#r-now` (เพลงที่กำลังเล่น + ปุ่มควบคุม) ย้ายไปติดขอบล่างของจอแบบแถบเล่นเพลงย่อ
- ฟอร์มค้นหา + แถบแท็บ ติดขอบบนของจอ (เฉพาะจอที่สูงพอ)
พฤติกรรมอื่นทั้งหมดคงเดิม (คำสั่ง, SSE, รหัสห้อง, ลากจัดลำดับ, ข้อความ, `aria-label`)

## ขอบเขต
- แก้ได้: `public/remote.html`, `public/remote.css`, `public/js/remote.js`
- ห้ามแตะ: ไฟล์อื่นทั้งหมด (`public/tokens.css`, `public/js/drag-sort.js`, `public/styles.css`, `public/index.html`, `public/js/app.js`, `server.mjs`, `lib/**`, `test/**`, `docs/**`, `tasks/**`)
- ห้ามเปลี่ยน id ที่มีอยู่ · ไม่ติดตั้ง package · sandbox ไม่มีเครือข่าย/เบราว์เซอร์

## กลไกการจัดวาง (ต้องทำตามนี้ — เลือกแบบนี้เพื่อเลี่ยงบั๊ก `position:fixed` ขอบล่างบน Safari ของ iPhone)
1. `<meta name="viewport">` เพิ่ม `viewport-fit=cover` (ค่าเดิมคงไว้)
2. `body.remote`: `display:flex; flex-direction:column; min-height:100dvh` (หน้าเลื่อนแนวตั้งตามปกติ ห้าม `overflow:hidden`, ห้าม `height:100dvh`)
3. ลำดับลูกของ `<body>` ใน DOM: ฉากหลัง (`#r-backdrop`, `.orbs`) → `#r-status` → `#r-main` (`flex:1 0 auto`) → `#r-now` → `#r-toasts`
   — ย้าย `#r-now` ลงมาอยู่หลัง `#r-main` และเปลี่ยนแท็กจาก `<header>` เป็น `<footer>` (id, class, ลูกข้างใน และ `aria-label` คงเดิม)
4. `#r-now`: **`position:sticky; bottom:0`** (ห้ามใช้ `position:fixed`), `z-index:20`, พื้น `rgba(12,10,24,.88)` + `backdrop-filter:blur(24px) saturate(1.4)`
   ความสูงส่วนเนื้อหา 72px + `padding-bottom:env(safe-area-inset-bottom, 0px)` (กล่องรวมสูง 72px เมื่อ inset เป็น 0)
   `padding-left/right: max(16px, env(safe-area-inset-left/right))` · เส้นไล่สี `var(--iris)` สูง 1px ย้ายจากขอบล่างไปอยู่ **ขอบบน** ของแถบ · เงา `0 -12px 40px rgba(0,0,0,.45)`
   เพราะเป็น sticky แถบนี้กินที่ในกระแสหน้าเอง — ไม่ต้องเพิ่ม padding ท้ายรายการ และแถวสุดท้ายของคิวต้องไม่ถูกบัง
5. ภายใน `#r-main` ห่อฟอร์มค้นหา (`#r-search-form`) กับแถบแท็บ (element `role="tablist"` เดิม) ด้วย `<div id="r-top" class="r-top">` ตามลำดับ ฟอร์ม → แท็บ
   ลำดับลูกของ `#r-main`: ช่องชื่อ (`#r-name` และ wrapper เดิม) → `#r-top` → `#r-search-note` → `#r-panel-results` → `#r-panel-queue`
   (`#r-search-note` ย้ายลงมาอยู่ใต้ `#r-top` เลื่อนไปกับหน้า)
6. `#r-top`: `display:flex; flex-direction:column; gap:8px; padding:8px 0`
   - `@media (min-height: 600px)`: `position:sticky; top:0; z-index:15`, พื้น `rgba(12,10,24,.88)` + `backdrop-filter:blur(24px) saturate(1.4)`, ขยายพื้นให้เต็มความกว้างจอ (ชดเชย padding ซ้ายขวา 16px ของคอลัมน์ด้วย margin ติดลบ + padding เท่าเดิม), `padding-top:max(8px, env(safe-area-inset-top))`, เส้นล่าง 1px `var(--line)`
     ความสูงรวมที่คาด: 8 + 52 + 8 + 44 + 8 = 120px (±2)
   - จอเตี้ยกว่า 600px (มือถือแนวนอน): `position:static` พื้นโปร่ง ไม่มีเส้น — ติดจอแค่ `#r-now` อย่างเดียว
7. `#r-toasts`: ยัง `position:fixed` กลางจอแนวนอน แต่ `bottom: calc(72px + env(safe-area-inset-bottom, 0px) + 12px)` — toast ต้องอยู่เหนือ `#r-now` เสมอ ไม่ทับปุ่มควบคุม
8. `#r-status` แบบ `offline` (แถบแจ้งกำลังเชื่อมต่อใหม่): อยู่บนสุดของหน้า เลื่อนไปกับหน้า (ไม่ sticky) · แบบ `bad_key`: ซ่อน `#r-main`, `#r-now`, `#r-toasts` เหมือนเดิม

## งานฝั่ง JS (`remote.js`)
1. เมื่อกดเปลี่ยนแท็บ หรือเมื่อผลค้นหาชุดใหม่แสดง: ถ้าขอบบนของ panel ที่เปิดอยู่เลื่อนพ้นใต้ `#r-top` ไปแล้ว (`panel.getBoundingClientRect().top < stickyBottom` โดย `stickyBottom` = ขอบล่างของ `#r-top` เมื่อมัน sticky, ไม่งั้น 0) → เลื่อนหน้าให้ขอบบนของ panel อยู่ใต้ `#r-top` พอดี (เว้น 8px) ด้วย `window.scrollTo({ top, behavior: 'auto' })` · ถ้ายังไม่พ้น ไม่ต้องเลื่อน
2. ตัวลากจัดลำดับ: คง `scroller: null` (ใช้ viewport) — ไม่ต้องแก้ `drag-sort.js`
3. ส่วนอื่นไม่เปลี่ยน

## เกณฑ์ผ่าน (หัวหน้าวัดในเบราว์เซอร์ บนเซิร์ฟเวอร์ทดสอบ)
| จอ | ต้องได้ |
|---|---|
| 375x812, 390x844, 360x740 | `#r-now` ชิดขอบล่าง: `rect.bottom === innerHeight` (±1) สูง 72 ทั้งตอนอยู่บนสุดของหน้าและหลังเลื่อนลง 600px; `#r-top` ชิดบน (`rect.top === 0`) หลังเลื่อน สูง 120 (±2) |
| 844x390 | `#r-now` ชิดล่างสูง 72; `#r-top` ไม่ sticky (เลื่อนหายไปกับหน้า) |
| 768x1024 | เหมือนจอแนวตั้ง; คอลัมน์เนื้อหายังกว้างไม่เกิน 560px จัดกลาง; พื้นของ `#r-top` และ `#r-now` เต็มความกว้างจอ |
- หน้าที่เนื้อหาสั้นกว่าจอ (ยังไม่ค้น คิวว่าง): `#r-now` ยังอยู่ชิดขอบล่างของจอ ไม่ลอยขึ้นมากลางหน้า
- เลื่อนลงสุดในแท็บคิว: ขอบล่างของแถวสุดท้าย ≤ ขอบบนของ `#r-now`
- ไม่มีการเลื่อนแนวนอน · ปุ่มที่มองเห็นทุกปุ่ม ≥ 44×44px · ปุ่ม "แน่ใจ?" ตอนยืนยันข้ามเพลงไม่ทำให้แถบล้นที่กว้าง 360px
- toast ที่แสดงอยู่: `rect.bottom ≤ #r-now.rect.top − 8`
- ไม่มี CSS `position:fixed` กับ `#r-now` หรือ `#r-top`

## การตรวจ
`node --check public/js/remote.js` และ `node --test` (ทั้งชุดต้องยังผ่าน 72 ข้อ)

## ส่งมอบ
สรุปสิ่งที่เปลี่ยนรายไฟล์, คำสั่งที่รันและผลจริง, สิ่งที่ยังไม่ได้ตรวจด้วยตา · ไม่ต้อง commit
