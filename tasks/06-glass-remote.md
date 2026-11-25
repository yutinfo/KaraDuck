# ใบงาน 06 — ปรับหน้ามือถือ (`/remote`) เป็น Glass + Neon แนวเว็บดูหนัง
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

## เป้าหมาย
หน้าสั่งเพลงบนมือถือใช้ภาษาภาพเดียวกับภาพร่างจอหลัก `public/_mockup/glass.html`: กระจกโทนมืด ขอบรุ้ง นีออน ฉากหลังปกเพลงเบลอ
ผลค้นหาเป็นแผ่นปก คิวเป็นรายการจัดอันดับเลขใหญ่ ปุ่มเล่นสีขาว **พฤติกรรมทุกอย่างคงเดิม** — เปลี่ยนแค่หน้าตาและโครง DOM ของรายการ

## อ่านก่อนลงมือ
1. `public/_mockup/glass.html` — ภาษาภาพอ้างอิง (จอหลัก): ดู `.tile`, `.qrow`, `.search`, `.tabs`, `.now`
2. `public/tokens.css` — ตัวแปรและ class กลาง (`.glass .iris .btn-white .btn-glass .btn-neon .btn-round .pill .eyebrow .eq .num-rank .backdrop .orbs`) ใช้ของในไฟล์นี้ **ห้ามแก้และห้ามนิยามซ้ำ**; ถ้าต่างจากภาพร่างให้ยึด tokens.css
3. `public/remote.html`, `public/remote.css`, `public/js/remote.js` ของปัจจุบัน

## ขอบเขต
- แก้ได้: `public/remote.html`, `public/remote.css`, `public/js/remote.js`
- ห้ามแตะ: ไฟล์อื่นทั้งหมด — โดยเฉพาะ `public/styles.css`, `public/index.html`, `public/js/app.js` (อีกคนกำลังเขียนใหม่ขนานอยู่), `public/tokens.css`, `public/_mockup/**`, `server.mjs`, `lib/**`, `test/**`, `docs/**`, `tasks/**`
- ห้ามเปลี่ยน: id ที่มีอยู่ (`#r-now #r-name #r-search-form #r-search-input #r-search-note #r-tab-results #r-tab-queue #r-panel-results #r-panel-queue #r-toasts #r-status`), คำสั่งที่ส่ง, การต่อ SSE, การจัดการรหัสห้อง, ข้อความภาษาไทย, `aria-label`
- ข้อมูลจากภายนอกใส่ด้วย `textContent`/`setAttribute` เท่านั้น (URL รูปประกอบเองจาก id ที่ตรง `/^[\w-]{11}$/`)
- ไม่ติดตั้ง package · sandbox ไม่มีเครือข่าย/เบราว์เซอร์

## งาน
1. `remote.html`: **เลิกโหลด `/styles.css`** → โหลด `/tokens.css` แล้ว `/remote.css` เท่านั้น (ไฟล์ `styles.css` กำลังถูกเขียนใหม่ จะพึ่ง class จากมันไม่ได้อีก) — ดังนั้น `remote.css` ต้องมีสไตล์ครบทุกชิ้นที่หน้านี้ใช้ รวม reset พื้นฐาน (`box-sizing`, `margin:0`, ฟอนต์, `[hidden]{display:none!important}`)
   ลิงก์ฟอนต์เป็น `Kanit:wght@500;600;700;800` และ `Sarabun:wght@400;500;600`
   เพิ่มเป็นลูกสองตัวแรกของ `<body>`: `<div id="r-backdrop" class="backdrop" aria-hidden="true"></div><div class="orbs" aria-hidden="true"></div>`; เนื้อหาหลักต้อง `position:relative; z-index:1`
2. หน้า: `body{background:var(--bg); color:var(--text); font:400 16px/1.45 var(--font-body); min-height:100dvh}` เลื่อนแนวตั้งปกติทุกขนาดจอ; คอลัมน์เดียวกว้างสูงสุด 560px จัดกลาง padding ซ้ายขวา 16px, ระยะห่างระหว่างส่วน 12px
3. ฉากหลัง: เมื่อ `snapshot.current` เปลี่ยน → `#r-backdrop.style.backgroundImage = url(https://i.ytimg.com/vi/<id>/hqdefault.jpg)` + class `is-on`; ไม่มี → เอา `is-on` ออก
4. `#r-now` (sticky top:0, z-index:10, สูง 72px เท่าเดิม): พื้นกระจกมืดทึบพอให้รายการที่เลื่อนผ่านไม่กวน: `background:rgba(12,10,24,.82); backdrop-filter:blur(24px) saturate(1.4)`; เส้นล่าง 1px ไล่สี `var(--iris)` (ใช้ `::after` สูง 1px)
   ซ้าย: `.eyebrow` ("กำลังร้อง" + `.eq`; class `is-playing` ที่ `#r-now` เมื่อ playerState เป็น playing) + ชื่อเพลง (Kanit 600 16px บรรทัดเดียวตัด …) + บรรทัดรอง 13px
   ขวา: ปุ่ม 44×44px สามปุ่ม: "เริ่มใหม่" `.btn-glass.is-icon` → "เล่น–หยุด" `.btn-white.is-icon` (ไอคอนสลับตามสถานะ) → "ข้ามเพลง" `.btn-glass.is-icon` (สองจังหวะ "แน่ใจ?" เหมือนเดิม — ตอนยืนยันปุ่มขยายตามข้อความได้ แต่ทั้งแถวต้องไม่ล้นที่กว้าง 360px) — ตั้งขนาด 44px ทับค่า 48px ของ tokens.css เฉพาะใน `#r-now`
5. `#r-name`: ช่องสูง 44px พื้น `var(--well)` ขอบ `var(--line)` มุม 12px; โฟกัสขอบฟ้าเรือง (`box-shadow:0 0 0 3px rgba(51,225,255,.18)`)
6. ฟอร์มค้นหา: เม็ดยาแบบ `.search` ในภาพร่าง (สูง 52px, พื้น `var(--well)`), ป้าย "คาราโอเกะ" แบบ `.k`, ปุ่ม "ค้นหา" = `.btn-neon`; `#r-search-note` 14px `var(--text-muted)`
7. แถบแท็บ (สูง 44px): ราง `var(--well)` ขอบ `var(--line)` มุม 14px padding 4px; แท็บที่เลือก พื้น `var(--glass-3)` + เส้นล่างชมพู 2px (`inset 0 -2px 0 var(--neon-pink)`); ตัวเลขคิวเป็นเม็ดทองตัวอักษร `#1a1200`
8. `#r-panel-results` — ตารางแผ่นปก:
   - `.grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px}` → ที่จอกว้าง 360–430px ได้ 2 คอลัมน์พอดี
   - `.tile` (`container-type:inline-size`, มุม 14px, พื้น `rgba(255,255,255,.05)`, ขอบ `var(--line)`, ไม่มี backdrop-filter): ปก `<img loading="lazy">` 16:9 `object-fit:cover` + ไล่เงาล่าง + ป้ายความยาวสีทองมุมขวาล่าง + ป้าย "ในคิวแล้ว" (`.pill.is-cyan`) มุมซ้ายบน
   - ใต้ปก (padding 8px 8px 10px): ชื่อ 2 บรรทัด (600 14px, min-height 36px) → ช่อง (13px บรรทัดเดียวตัด …) → แถวปุ่ม gap 6px: "เข้าคิว" = `.btn-neon` สูง 44px `flex:1; min-width:44px; padding:0` ไอคอน + คำ (คำแสดงเมื่อ tile กว้าง ≥ 150px — คือแสดงเสมอในตาราง 2 คอลัมน์) · "เล่นถัดไป" = `.btn-round` 44×44
   - กดค้าง/แตะ: `.tile:active{transform:scale(.98)}`; `@media (hover:hover)` → hover ขอบฟ้าเรืองแบบภาพร่าง
   - โครงร่างกำลังโหลด = tile เปล่า 6 ใบ (พื้นกระพริบจาง); ข้อความสถานะอื่นคงเดิม จัดกลางในกล่อง `var(--well)` มุม 14px
9. `#r-panel-queue`:
   - การ์ด "กำลังร้อง": ปก 96×54 + `.eyebrow` + ชื่อ + ข้อมูล บนพื้น `var(--glass-2)` มุม 14px ขอบซ้ายชมพู 3px
   - หัวแถว: "คิวถัดไป" (Kanit 600 17px) + `N เพลง · รวม <เวลา>` (13px muted)
   - แถว `.qrow`: grid `44px 96px minmax(0,1fr)`, gap 10px, padding 8px 4px; `.num-rank` (ลำดับ ≥ 10 ใส่ `is-long`) · ปก 96×54 มุม 8px · ชื่อ (600 14px, 2 บรรทัด) + `ความยาว · ขอโดย <by>` (13px)
     บรรทัดที่สอง กินคอลัมน์ 2–3 ชิดขวา: "ขึ้นบนสุด" และ "ลบ" = `.btn-glass` สูง 44px ไอคอน + คำ
   - เส้นคั่นแถว 1px `var(--line)`
10. toast (`#r-toasts`): กระจกมืด `rgba(12,10,24,.88)` + `backdrop-filter:blur(18px)`, ขอบ `var(--line)`, แถบซ้าย 3px ชมพู, มุม 12px; ตำแหน่งเดิม (fixed ล่างกลาง ห่างขอบ 16px)
11. `#r-status`: `offline` = แถบสีทองบนพื้น `var(--well)`; `bad_key` = เต็มหน้า ไอคอนกุญแจ (SVG) + ข้อความเดิม บนการ์ด `.glass.iris` กว้างสูงสุด 420px จัดกลางจอ

## เกณฑ์ผ่าน (หัวหน้าจะวัดในเบราว์เซอร์)
- 360x740, 375x812, 390x844, 844x390, 768x1024: ไม่มีการเลื่อนแนวนอน; `#r-now` สูง 72px ชิดบนตลอดการเลื่อน
- ทุกปุ่มที่มองเห็น ≥ 44×44px
- ที่กว้าง 375px ตารางผลค้นหาได้ 2 คอลัมน์ (tile ≈ 165px) และแถวปุ่มใน tile ไม่ล้น
- ไม่มีตัวอักษรเล็กกว่า 13px; ตัวอักษรรองใช้ `var(--text-muted)`; contrast ≥ 4.5
- ไม่มี request ไป `/styles.css` จากหน้านี้
- `backdrop-filter` ใช้เฉพาะ `#r-now`, toast, ปุ่ม `.btn-glass`, การ์ด bad_key — ไม่ใส่กับ tile หรือแถวคิว

## การตรวจ
`node --check public/js/remote.js` และ `node --test` (ทั้งชุดต้องยังผ่าน 59 ข้อ — ใบนี้ไม่ควรกระทบเทสต์)

## ส่งมอบ
สรุปสิ่งที่เปลี่ยนรายไฟล์, คำสั่งที่รันและผลจริง, สิ่งที่ยังไม่ได้ตรวจด้วยตา · ไม่ต้อง commit
