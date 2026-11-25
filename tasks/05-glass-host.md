# ใบงาน 05 — ปรับจอหลักเป็น Glass + Neon แนวเว็บดูหนัง
ผู้รับงาน: agy · โมเดล: gemini-4-neon-high · mode: accept-edits

## เป้าหมาย
เปลี่ยนหน้าตาจอหลัก (`/`) ให้ตรงกับภาพร่าง `public/_mockup/glass.html`: กรอบกระจกโทนมืดขอบรุ้ง แสงนีออน ฉากหลังเป็นปกเพลงปัจจุบันเบลอ
ผลค้นหาเป็นแผ่นปกแบบเว็บดูหนัง คิวเป็นรายการจัดอันดับเลขใหญ่ แถบเพลงปัจจุบันแบบหน้ารายละเอียดหนัง (ปุ่มเล่นสีขาว)
**พฤติกรรมทุกอย่างคงเดิม** — ใบนี้เปลี่ยนแค่หน้าตาและโครง DOM ของรายการ

## อ่านก่อนลงมือ (ตามลำดับ)
1. `public/_mockup/glass.html` — ภาพร่างที่หัวหน้าอนุมัติ: ดูโครง ชื่อ class ระยะ และขนาดตัวอักษร
2. `public/tokens.css` — ตัวแปรสีและ class กลาง (`.glass .iris .btn-white .btn-glass .btn-neon .btn-round .pill .eyebrow .eq .num-rank .backdrop .orbs`) **ใช้ของในไฟล์นี้ ห้ามนิยามซ้ำหรือแก้ไฟล์นี้** ถ้าภาพร่างกับ tokens.css ต่างกัน ให้ยึด tokens.css (กระจกเป็นโทนมืด)
3. `public/index.html`, `public/styles.css`, `public/js/app.js` ของปัจจุบัน

## ขอบเขต
- แก้ได้: `public/index.html`, `public/styles.css`, `public/js/app.js`
- ห้ามแตะ: `public/tokens.css`, `public/_mockup/**`, `public/remote.html`, `public/remote.css`, `public/js/remote.js` (อีกคนกำลังปรับหน้ามือถือขนานอยู่), `public/js/store.js`, `commands.js`, `sync.js`, `api.js`, `player.js`, `demo-data.js`, `server.mjs`, `lib/**`, `test/**`, `docs/**`, `tasks/**`
- ห้ามเปลี่ยน: id ทั้งหมดที่มีอยู่, คำสั่งที่ `dispatch`, การทำงานของตัวเล่น/SSE/demo, ข้อความภาษาไทยที่มีอยู่, `aria-label`, role ของแท็บ
- ข้อมูลจากภายนอกยังต้องใส่ด้วย `textContent`/`setAttribute` (URL รูปใส่ผ่าน `style.backgroundImage` ได้เฉพาะ URL ที่ประกอบเองจาก id ที่ตรง `/^[\w-]{11}$/`)

## วิธีทำงาน
แก้ไฟล์ด้วยเครื่องมือแก้ไฟล์เท่านั้น · shell ใน sandbox ไม่มีเครือข่าย/เบราว์เซอร์ · ใช้แค่ `node --check public/js/app.js`

## งาน
1. `index.html`: โหลด `/tokens.css` ก่อน `/styles.css`; ลิงก์ฟอนต์เป็น `Kanit:wght@500;600;700;800` และ `Sarabun:wght@400;500;600`
   เพิ่มเป็นลูกสองตัวแรกของ `<body>`: `<div id="backdrop" class="backdrop" aria-hidden="true"></div><div class="orbs" aria-hidden="true"></div>`; `#app` ต้อง `position:relative; z-index:1`
2. `styles.css`: ลบตัวแปรสีเดิมใน `:root` ที่ซ้ำกับ tokens.css (เหลือ `--side`) และลบพื้นหลัง radial-gradient เดิมของ body (ใช้ `.orbs` แทน); `body{background:var(--bg)}`
3. ฉากหลัง: เมื่อ `current` เปลี่ยน ให้ `#backdrop.style.backgroundImage = url(https://i.ytimg.com/vi/<id>/hqdefault.jpg)` และใส่ class `is-on`; ไม่มี current → เอา `is-on` ออก · ในโหมดเวที (fullscreen) ซ่อน `#backdrop` และ `.orbs`
4. `#topbar` (desktop เท่านั้น สูง 48px เท่าเดิม): โลโก้แบบภาพร่าง (`.logo`: Kanit 800 26px ไล่สีขาว→ชมพูอ่อน→ฟ้า + เงาเรืองชมพู) + คำโปรย + ช่องว่าง + ปุ่มชิป `#btn-open-remote` "สั่งเพลงจากมือถือ" (สูง 40px, สไตล์ `.chipbtn` ในภาพร่าง; กดแล้วเปิดแท็บ "มือถือ")
5. `#stage`: คงสูตรขนาดเดิมทุกโหมด; เพิ่ม class `iris`, เงาเรืองตาม `.stage` ในภาพร่าง, ลบเส้นขอบชมพูเดิม · `#stage` ต้องไม่มี `overflow:hidden` ที่ตัดขอบรุ้ง — ให้ลูกข้างใน (`#player-wrap`, จอว่าง) รับ `border-radius:inherit; overflow:hidden` แทน
6. `#nowbar`: class `glass`; โครงตาม `.now` ในภาพร่าง
   - ซ้าย: `.eyebrow` ("กำลังร้อง" + `.eq` 3 แท่ง; ใส่ class `is-playing` ที่ `#nowbar` เฉพาะตอน playerState เป็น playing) → ชื่อเพลง (Kanit 700; desktop 28px, compact/stacked 16px; บรรทัดเดียวตัด …) → แถวข้อมูล: `.pill.is-gold` ความยาว + ช่อง + `· ขอโดย <by>` → บรรทัด "ถัดไป: …" (รวมข้อความเตือนกด ▶ เดิม)
   - ขวา: `#btn-toggle` เป็น `.btn-white` มีไอคอน + คำว่า "เล่น"/"หยุด" (สลับตามสถานะ; `aria-label` เดิม) → `#btn-restart` เป็น `.btn-glass.is-icon` → `#btn-skip` เป็น `.btn-glass` ไอคอน + "ข้ามเพลง" → `#btn-stage-mode` เป็น `.btn-glass.is-icon`
   - ความสูงคงเดิม: desktop 132px · compact 56px · stacked 64px · ใน compact/stacked: ซ่อน eyebrow, แถวข้อมูล, บรรทัดถัดไป; ปุ่มทั้งสี่เป็นไอคอนล้วนขนาด 40×40 (ซ่อนคำ; `.btn-white` กลายเป็น 40×40 มุม 10px)
   - ที่ desktop กว้าง 1024px (คอลัมน์ซ้าย 604px) ปุ่มทั้งสี่ต้องไม่ล้นและชื่อเพลงยังเหลือกว้าง ≥ 200px: ถ้าคอลัมน์ซ้ายแคบกว่า 760px ให้ซ่อนคำว่า "ข้ามเพลง" (เหลือไอคอน) ด้วย container query บน `#nowbar`
7. `#sidebar`: class `glass iris`, padding 16px (compact 8px), ลูกเรียง gap 12px; ลบพื้น/ขอบการ์ดซ้อนชั้นเดิมของ panel
   - ฟอร์มค้นหา: เม็ดยาแบบ `.search` ในภาพร่าง (สูง 52px, พื้น `var(--well)`, โฟกัสขอบฟ้าเรือง); ปุ่มค้นหาเป็น `.btn-neon`; ป้าย "คาราโอเกะ" แบบ `.k`
   - แถบแท็บ: แบบ `.tabs/.tab` ในภาพร่าง (ราง `var(--well)`, แท็บที่เลือกพื้น `var(--glass-3)` + เส้นล่างชมพู 2px + เรือง); ตัวเลขคิวเป็นเม็ดทองตัวอักษรเข้ม; แท็บมือถือยังย่อเป็นไอคอนเมื่อ `--side` ≤ 360px
   - พื้นที่รายการ: `overflow-y:auto; scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.25) transparent`
8. แท็บ "ผลค้นหา" — ตารางแผ่นปก (`renderResultsPanel`):
   - หัวแถว `.rowhead`: "ผลค้นหา" (Kanit 600 17px)
   - `.grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(144px,1fr)); gap:12px; padding:6px 4px}`
   - `.tile` ตามภาพร่าง: `container-type:inline-size`, มุม 14px, พื้น `rgba(255,255,255,.05)`, ขอบ `var(--line)`; hover/focus-within → `scale(1.035)` + ขอบฟ้า + เงาเรืองฟ้า (`@media (hover:none)` ไม่ขยาย)
   - `.poster` 16:9 เป็น `<img loading="lazy">` เต็มกรอบ `object-fit:cover` + ไล่เงาล่าง; ป้ายความยาว (ทอง มุมขวาล่าง); ป้าย "ในคิวแล้ว" = `.pill.is-cyan` มุมซ้ายบน
   - ใต้ปก: ชื่อ 2 บรรทัด (Sarabun 600 14px, min-height 36px) → ช่อง · ยอดดู (13px บรรทัดเดียวตัด …) → แถวปุ่ม gap 6px: "เข้าคิว" = `.btn-neon` ยืด `flex:1; min-width:40px; padding:0` ไอคอน + (คำ "เข้าคิว" แสดงเมื่อ tile กว้าง ≥ 170px ด้วย `@container`) · "เล่นถัดไป" = `.btn-round` · "เล่นเลย" = `.btn-round`
   - padding ของส่วนใต้ปก: 8px 8px 10px — ที่ tile กว้าง 146px แถวปุ่ม (40+6+40+6+40 = 132px) ต้องไม่ล้น
   - โครงร่างกำลังโหลด = tile เปล่า 6 ใบ; สถานะ ไม่พบ/ผิดพลาด/ยังไม่ค้น คงข้อความเดิม จัดกลาง
9. แท็บ "คิว" (`renderQueuePanel`):
   - การ์ด "กำลังร้อง": ปก 96×54 + `.eyebrow` + ชื่อ + ข้อมูล บนพื้น `var(--glass-2)` มุม 14px ขอบซ้ายชมพู 3px
   - หัวแถว `.rowhead`: "คิวถัดไป" + ตัวรอง `N เพลง · รวม <เวลา>` + ปุ่ม "ล้างคิว" (`.btn-glass` สูง 40px; สองจังหวะเหมือนเดิม)
   - แถว `.qrow`: grid `44px 96px minmax(0,1fr)`, gap 10px, padding 8px, มุม 14px; `.num-rank` (ลำดับ ≥ 10 ใส่ `is-long`) · ปก 96×54 มุม 8px · ชื่อ (600 14px บรรทัดเดียวตัด …) + `ความยาว · ขอโดย <by>` (13px)
     แถวปุ่มอยู่บรรทัดที่สอง กินคอลัมน์ 2–3 ชิดขวา: `.btn-round` 5 ปุ่ม gap 4px ตามลำดับ เลื่อนขึ้น / เลื่อนลง / ขึ้นบนสุด / เล่นเลย / ลบ (รวม 216px ≤ ที่เหลือทุกโหมด)
   - hover แถว: พื้น `var(--glass-2)` ขอบ `var(--line)`
10. แท็บ "ร้องไปแล้ว": ตารางแผ่นปกแบบข้อ 8 (ปกหรี่ `filter:saturate(.7) brightness(.85)`), ใต้ปกมีปุ่มเดียว "เข้าคิว" (`.btn-neon` ยืดเต็ม); ปุ่ม "ล้างประวัติ" เป็น `.btn-glass` สูง 40px ในหัวแถว
11. แท็บ "มือถือ": หัวข้อ Kanit 600 17px; กรอบ QR ขาวคงเดิม (244×244, QR 220×220 ห้ามมี filter/มุมตัด QR); ลิงก์ในกล่อง `var(--well)` ขอบ `var(--line)`; ขั้นตอน 3 ข้อมีเลขในวงกลมกระจก 24px
12. จอว่างใน `#stage`: พื้น `radial-gradient(60% 80% at 50% 40%, rgba(139,92,246,.22), rgba(6,5,12,.9))`; ไมโครโฟน + ข้อความ + QR (เฉพาะ desktop) จัดวางตามเดิม
13. toast: พื้นกระจกมืด `rgba(12,10,24,.82)` + `backdrop-filter:blur(18px)`, ขอบ `var(--line)`, แถบซ้าย 3px ชมพู (เตือน = ทอง), มุม 12px; ตำแหน่งเดิม
14. แถบ "กำลังเชื่อมต่อเซิร์ฟเวอร์ใหม่…": คงสีทอง บนพื้น `var(--well)` มุม 10px

## ขนาดจอ (ห้ามเปลี่ยนตัวเลข — หัวหน้าจะวัดซ้ำ)
| จอ | `#stage` | `#nowbar` | `--side` |
|---|---|---|---|
| 1440x900 | 960×540 ที่ x=20,y=84 | 960×132 ที่ y=640 | 420 |
| 1280x720 | 800×450 | สูง 132 | 420 |
| 1024x768 | 604×340 | สูง 132 | 360 |
| 844x390 (compact) | 488×275 ที่ x=12,y=12 | สูง 56 | 320 |
| 390x844 (stacked) | 390×219 ที่ 0,0 | สูง 64 | – |
ไม่มีการเลื่อนแนวนอนทุกขนาด รวมกว้าง 360

## กลไกการจัดวาง
เหมือนเดิมทุกอย่าง (grid 2 คอลัมน์ / sticky ในโหมด stacked / สูตรความกว้าง `#stage`) · `#backdrop` และ `.orbs` เป็น `position:fixed` อยู่หลังเนื้อหา (`z-index:0`)
ในโหมด stacked `#stage-col` ที่ sticky ต้องมีพื้นทึบ `var(--bg)` (ไม่ใช่กระจก) เพื่อไม่ให้รายการเลื่อนทะลุ
`backdrop-filter` ใช้ได้เฉพาะ: `#sidebar`, `#nowbar`, ปุ่ม `.btn-glass`, ชิปใน topbar, toast — ห้ามใส่กับ tile, แถวคิว หรือ element ที่มีจำนวนมาก
ห้ามมีสิ่งใดทับ `#player`

## เทสต์กรอบ
ไม่มีในใบนี้ — หัวหน้าวัดเองในเบราว์เซอร์

## สถานะอื่น
`prefers-reduced-motion` (tokens.css ปิด animation ให้แล้ว — อย่าเขียนทับ) · คีย์บอร์ด: โฟกัสเห็นชัดบนทุกปุ่ม, tile ที่ `focus-within` ยกขึ้นเหมือน hover · เป้ากดทุกปุ่ม ≥ 40×40px

## ภาพที่ต้องได้
- ตัวอักษรรองใช้ `var(--text-muted)` เท่านั้น; ไม่มีตัวอักษรเล็กกว่า 13px; contrast ≥ 4.5
- เลขอันดับคิวเห็นเป็นตัวโปร่งขอบทองชัดเจน 1 ตัวต่อแถว
- ขอบรุ้งเห็นรอบ `#stage` และ `#sidebar` ครบสี่ด้าน (ไม่ถูก overflow ตัด)
- ปุ่มเล่นหลักเป็นสีขาวตัวอักษรเข้ม เด่นที่สุดใน `#nowbar`

## ภาษาไทย
ห้ามตัดกลางคำ (nowrap): "สั่งเพลงจากมือถือ", "กำลังร้อง", "คิวถัดไป", "ผลค้นหา", "ร้องไปแล้ว", "เข้าคิว", "ข้ามเพลง", "ล้างคิว", "ในคิวแล้ว", "ขอโดย"

## การตรวจ
`node --check public/js/app.js` ผ่าน

## ส่งมอบ
สรุปสิ่งที่เปลี่ยนรายไฟล์, คำสั่งที่รันและผลจริง, และหัวข้อ **"สิ่งที่ยังไม่ได้ตรวจด้วยตา"** · ไม่ต้อง commit
