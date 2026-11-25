# ใบงาน 10 — ตรวจเพลงที่เล่นแบบฝังไม่ได้ (เซิร์ฟเวอร์) + ป้ายเตือนในหน้ามือถือ
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

อ่าน `docs/DESIGN.md` หัวข้อ **"รอบ 6 — ป้ายเตือนเพลงที่เล่นแบบฝังไม่ได้"** ก่อน (วิธีตรวจ ตารางแปลผล สัญญา API และพฤติกรรมหน้าจออยู่ที่นั่น ใบงานนี้ไม่ทวนซ้ำ)

## ขอบเขต
- แก้ได้: `lib/youtube.mjs`, `lib/app.mjs`, `test/youtube.test.mjs`, `test/app.test.mjs`, `public/js/remote.js`, `public/remote.css`
- ห้ามแตะ: `public/js/app.js`, `public/styles.css`, `public/index.html`, `public/js/demo-data.js` (อีกคนกำลังแก้ขนานอยู่), `public/tokens.css`, `public/remote.html`, `server.mjs`, `public/js/drag-sort.js`, `store.js`, `commands.js`, `sync.js`, `docs/**`, `tasks/**`, `test/fixtures/**`
- ไม่ติดตั้ง package · sandbox ไม่มีเครือข่าย ห้ามเรียก YouTube จริงหรือเปิดพอร์ต · พฤติกรรมเดิมทั้งหมดต้องคงอยู่ (เทสต์เดิม 72 ข้อต้องยังผ่าน)

## งาน A — `lib/youtube.mjs`
- `parseEmbedPlayability(html)` → `true | false | null` ตามตารางใน DESIGN.md
  ต้องอ่านได้ทั้งรูปแบบที่มี backslash นำหน้าเครื่องหมายคำพูด (ของจริง) และแบบ JSON ปกติไม่มี backslash; อินพุตไม่ใช่ string → `null`; ห้าม throw
  อ่าน `status` ตัวแรกที่อยู่ใน object ของ `previewPlayabilityStatus` เท่านั้น (ไม่ใช่ `status` ที่อื่นในหน้า)
- `checkEmbeddable(id, { fetchImpl = fetch, referer })` → `Promise<true|false|null>`: GET `https://www.youtube.com/embed/<id>` ด้วย header ตาม DESIGN.md, `AbortSignal.timeout(5000)`; HTTP ไม่ใช่ 2xx / throw → `null`; อ่าน body ไม่เกิน 1 MB (เกินให้ตัดทิ้งส่วนที่เหลือแล้วแปลผลจากส่วนที่อ่านได้); id ไม่ตรง `/^[\w-]{11}$/` → `null` โดยไม่เรียก fetch

## งาน B — `lib/app.mjs`: `GET /api/embeddable`
ตามสัญญาใน DESIGN.md: ตรวจสิทธิ์ทางเดียวกับ `/api/search`, ตรวจ `ids`, จำกัดพร้อมกัน 6, แคช 6 ชั่วโมง (ใช้ `now` ที่ฉีดเข้ามา), ไม่แคช `null`, สูงสุด 2,000 id, รวมคำขอ id เดียวกันที่กำลังตรวจอยู่ · `referer` = `http://localhost:<port>/`
คำตอบ `Content-Type: application/json; charset=utf-8`

## งาน C — หน้ามือถือ (`remote.js`, `remote.css`)
ตามหัวข้อ "หน้าจอ" ใน DESIGN.md:
- เรียก `/api/embeddable?ids=…&k=<รหัส>` หลังผลค้นหาแสดง (เฉพาะ id ที่ยังไม่รู้ผล; ไม่มี id ใหม่ → ไม่เรียก); ล้มเหลว/401 → เงียบ (ไม่ toast, ไม่เปลี่ยนสถานะรหัสห้อง)
- `embedFlags` (`Map` id → boolean) ระดับโมดูล; ตอน render แผ่นปกทุกครั้งให้ดูจาก map นี้ (ผลค้นหาถูก render ซ้ำเมื่อคิวเปลี่ยน ป้ายต้องไม่หาย); เมื่อผลตรวจมาถึงให้ render ผลค้นหาใหม่ถ้าชุดผลยังเป็นชุดเดิม
- แผ่นปกที่ `false`: class `is-blocked`; ป้าย `<span class="pill is-warn">เล่นที่นี่ไม่ได้</span>` ที่ตำแหน่งป้าย "ในคิวแล้ว" (ไม่แสดง "ในคิวแล้ว" พร้อมกัน); ปุ่ม "เข้าคิว" และ "เล่นถัดไป" `disabled` และ `aria-label` ต่อท้ายด้วย " (เล่นที่นี่ไม่ได้)"
- `remote.css`: `.tile.is-blocked .poster img{filter:grayscale(.85) brightness(.5)}` · `.tile.is-blocked .ttl,.tile.is-blocked .ch{color:var(--text-muted)}` · `.tile.is-blocked:active{transform:none}` (ชื่อ class ของปก/ชื่อเพลงให้ใช้ตามที่มีอยู่จริงในไฟล์)

## เกณฑ์ผ่าน (`node --test`)
`test/youtube.test.mjs` (เพิ่ม):
- `parseEmbedPlayability` กับ fixture 3 ไฟล์: `embed-ok.html` → `true`; `embed-unplayable.html` → `false`; `embed-owner-disabled.html` → `false`
- สตริงไม่มี backslash `{"previewPlayabilityStatus":{"status":"OK","playableInEmbed":true}}` → `true`; `…"status":"LOGIN_REQUIRED"…` → `false`
- หน้าไม่มี `previewPlayabilityStatus` แต่มี `"status":"OK"` ที่อื่น → `null`; `""`, `null`, `undefined`, `123` → `null`
- `checkEmbeddable` กับ fetch ปลอม: ตรวจ URL, header `Referer` และ `User-Agent` ที่ส่ง; ตอบ 404 → `null`; throw → `null`; id `"bad"` → `null` และ fetch ไม่ถูกเรียก; body 2 MB ที่มี `previewPlayabilityStatus` อยู่ใน 1 MB แรก → อ่านผลได้
`test/app.test.mjs` (เพิ่ม; fetch ปลอมแยกตาม URL — `/embed/` ตอบ fixture):
- `/api/embeddable?ids=k6ngeWkYjI8,8oWgHgf_c_w` → 200 `{k6ngeWkYjI8:true, 8oWgHgf_c_w:false}`; ขอซ้ำ → fetch ไม่เพิ่ม; เลื่อน `now` ไป 6 ชั่วโมง 1 วินาที → ตรวจใหม่
- fetch ของ id หนึ่งล้ม → ได้ `null` และครั้งถัดไปยิงใหม่ (ไม่แคช)
- `ids` ซ้ำกันในคำขอเดียว → fetch 1 ครั้งต่อ id · ขอ id เดียวกัน 2 คำขอพร้อมกัน → fetch 1 ครั้ง
- ไม่มี `ids`, `ids=`, `ids=bad`, 31 id → 400 `bad_ids`
- เครื่องอื่นไม่มี `k` → 401 `bad_key`; มี `k` ถูก → 200
- ขอ 30 id ที่ fetch ปลอมหน่วง → จำนวนที่ค้างพร้อมกันสูงสุดไม่เกิน 6

## การตรวจ
`node --test` (ทั้งชุด) · `node --check public/js/remote.js`

## ส่งมอบ
สรุปไฟล์ที่แก้, คำสั่งที่รัน, ผลเทสต์จริง, สิ่งที่ยังไม่ได้ตรวจ (การเรียก YouTube จริง, หน้าตาป้ายบนมือถือ) · ไม่ต้อง commit
