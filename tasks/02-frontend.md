# ใบงาน 02 — หน้าเว็บคาราโอเกะ (ค้นหา · คิว · เล่นต่อเนื่อง)
ผู้รับงาน: agy · โมเดล: gemini-4-neon-high · mode: accept-edits

อ่าน `docs/DESIGN.md` ก่อน (สัญญา API, รูปข้อมูล Song/QueueItem/State, พฤติกรรมหลัก — ใบงานนี้ไม่ทวนซ้ำ)

## เป้าหมาย
หน้าเว็บหน้าเดียว ภาษาไทย หน้าตาแบบเลานจ์คาราโอเกะนีออน ใช้งานเหมือนโปรแกรมคาราโอเกะ:
พิมพ์ชื่อเพลง → เห็นผลค้นหา → กด "เข้าคิว" / "เล่นถัดไป" / "เล่นเลย" → วิดีโอเล่นในจอใหญ่ → จบเพลงแล้วเล่นเพลงถัดไปในคิวเอง

## ขอบเขต
- สร้าง/แก้ได้: `public/index.html`, `public/styles.css`, `public/js/*.js`, `test/store.test.mjs`
- ห้ามแตะ: `server.mjs`, `lib/**`, `test/youtube.test.mjs`, `test/app.test.mjs` (อีกคนกำลังทำขนานอยู่ — error จากไฟล์พวกนี้ให้ข้ามและรายงาน), `docs/**`, `package.json`, `tasks/**`, `test/fixtures/**`
- ไม่มี framework ไม่มี build ไม่มี npm package: HTML + CSS + ES modules ล้วน ไอคอนเขียนเป็น inline SVG (ไม่ใช้อีโมจิเป็นไอคอน ไม่ใช้ไฟล์ภาพ)

## วิธีทำงาน
เขียน/แก้ไฟล์ด้วยเครื่องมือแก้ไฟล์เท่านั้น (ไม่ใช้ shell เขียนไฟล์) · shell รันใน sandbox: ไม่มีเครือข่าย ไม่มีเบราว์เซอร์
ห้าม `npm install`, `curl`, เปิด server · คำสั่งที่ต้องใช้มีแค่ `node --test test/store.test.mjs` และ `node --check <ไฟล์ js>`

## ไฟล์และหน้าที่
- `public/js/store.js` — ตรรกะคิวล้วน ไม่แตะ DOM/localStorage (รายละเอียดข้างล่าง)
- `public/js/api.js` — `search(q)` เรียก `/api/search?q=` (encodeURIComponent) คืน `{query, items}`; HTTP ไม่ใช่ 200 → throw Error ที่มี `code` จาก body
- `public/js/player.js` — ครอบ YouTube IFrame Player API
- `public/js/demo-data.js` — เพลงตัวอย่าง 8 เพลง คัดลอก 8 รายการแรกจาก `test/fixtures/search-sample.json` แปลงเป็นรูป Song (ใช้กับ `?demo=1`)
- `public/js/app.js` — ผูกทุกอย่างกับ DOM (โหลดด้วย `<script type="module">`)

### store.js (ฟังก์ชันล้วน คืน state ใหม่ ไม่แก้ของเดิม)
```
createState()                          → { current:null, queue:[], history:[] }
enqueue(state, song, makeQid?)         → ต่อท้ายคิว; ถ้า current เป็น null → song เป็น current แทน (คิวไม่เปลี่ยน)
enqueueNext(state, song, makeQid?)     → แทรกหน้าคิว (index 0); กติกา current null เหมือนกัน
playNow(state, song, makeQid?)         → current เดิม (ถ้ามี) ลง history; song เป็น current; คิวไม่เปลี่ยน
playFromQueue(state, qid)              → รายการนั้นออกจากคิวมาเป็น current; current เดิมลง history; ไม่พบ qid → state เดิม
advance(state, { skipHistory=false })  → current ลง history (เว้นแต่ skipHistory); queue[0] เป็น current หรือ null ถ้าคิวว่าง
remove(state, qid) · move(state, qid, delta) (เกินขอบให้ชิดขอบ; ไม่พบ → state เดิม) · moveToTop(state, qid)
clearQueue(state) · clearHistory(state)
totalDurationSec(state)                → ผลรวม durationSec ของ queue (ไม่รวม current)
formatDuration(sec)                    → 268 → "4:28", 3723 → "1:02:03", 0 → "0:00"
serialize(state) → string · deserialize(str) → State
```
- `makeQid` ไม่ส่งมา → ใช้ `crypto.randomUUID()`
- history: ใหม่สุดอยู่หน้า, id ซ้ำ → ย้ายขึ้นหน้า (ไม่เพิ่มรายการ), สูงสุด 30, เก็บเป็น Song (ไม่มี qid)
- `deserialize`: JSON พัง / ไม่ใช่ object → `createState()`; ทิ้งรายการที่ id ไม่ตรง `/^[\w-]{11}$/` หรือไม่มี title; current ที่ใช้ไม่ได้ → null; history ตัดที่ 30

### player.js
- โหลด `https://www.youtube.com/iframe_api` ครั้งเดียวตอนต้องใช้ครั้งแรก; เกิน 10 วินาทีไม่มา → เรียก `onUnavailable`
- `new YT.Player('player', { host:'https://www.youtube.com', playerVars:{ autoplay:1, playsinline:1, rel:0, iv_load_policy:3, origin: location.origin } })`
- เมธอด: `load(id)` (loadVideoById), `cue(id)` (cueVideoById), `play()`, `pause()`, `toggle()`, `restart()` (seekTo(0)+play), `stop()`
- callback: `onEnded`, `onError(code)`, `onState('playing'|'paused'|'buffering'|'idle')`, `onUnavailable`

## พฤติกรรมหน้าเว็บ (app.js)
1. ค้นหา: ส่งฟอร์ม (Enter หรือปุ่ม "ค้นหา") → สลับไปแท็บ "ผลค้นหา" แสดงโครงร่างกำลังโหลด 6 แถว → แสดงผล
   บรรทัดใต้ช่องค้น: `ค้นหา: <query จาก response>` (ให้เห็นว่าเติม "คาราโอเกะ" แล้ว) · ในช่องค้นมีป้าย "คาราโอเกะ" ติดอยู่ด้านซ้ายของช่องพิมพ์เป็นสัญลักษณ์ว่าเติมให้เอง
   ไม่พบ → "ไม่พบเพลง ลองพิมพ์ชื่อเพลงหรือชื่อศิลปินแบบอื่น" · ผิดพลาด → "ค้นหาไม่สำเร็จ" + ปุ่ม "ลองใหม่" · ช่องว่าง → ไม่ส่ง
2. แถวผลค้นหา: ภาพปก 16:9 + ป้ายความยาวมุมขวาล่างของภาพ, ชื่อเพลง (ตัดที่ 2 บรรทัด), ช่อง · ยอดดู, ปุ่ม 3 ปุ่ม:
   "เข้าคิว" (ปุ่มหลัก) = `enqueue` · "เล่นถัดไป" = `enqueueNext` · "เล่นเลย" = `playNow`
   เพลงที่อยู่ใน current หรือ queue อยู่แล้วให้มีป้ายเล็ก "ในคิวแล้ว" (ยังกดเพิ่มซ้ำได้)
   กดแล้วมี toast เช่น `เพิ่ม "<ชื่อ>" เข้าคิวลำดับที่ 3` และไม่สลับแท็บ; ตัวเลขบนแท็บ "คิว" อัปเดตทันที
3. แท็บ "คิว": การ์ด "กำลังร้อง" (current) อยู่บนสุด; หัวรายการ `N เพลง · รวม <formatDuration>` + ปุ่ม "ล้างคิว" (กดครั้งแรกเปลี่ยนเป็น "แน่ใจ?" 3 วินาที กดอีกครั้งจึงล้าง — ไม่ใช้ `confirm()`)
   แต่ละแถว: เลขลำดับ, ภาพปก, ชื่อ, ความยาว, ปุ่ม เลื่อนขึ้น / เลื่อนลง / ขึ้นบนสุด / เล่นเลย (`playFromQueue`) / ลบ · คิวว่าง → "คิวว่าง ค้นหาเพลงแล้วกดเข้าคิวได้เลย"
4. แท็บ "ร้องไปแล้ว": รายการ history แต่ละแถวมีปุ่ม "เข้าคิว"; ปุ่ม "ล้างประวัติ" (สองจังหวะแบบเดียวกับล้างคิว)
5. เล่น: current เปลี่ยน (จากการกดของผู้ใช้) → `player.load(id)` · `onEnded` → `advance` แล้วเล่นเพลงใหม่ หรือกลับจอว่างถ้าไม่มี
   `onError` → toast "เพลงนี้เล่นในหน้านี้ไม่ได้ (เจ้าของปิดการฝัง) กำลังข้ามไปเพลงถัดไป" รอ 2.5 วินาทีแล้ว `advance(state,{skipHistory:true})`
6. แถบเพลงปัจจุบัน (`#nowbar`): ป้าย "กำลังร้อง", ชื่อเพลง (บรรทัดเดียว ตัดด้วย …), ช่อง, ปุ่ม "เริ่มใหม่" / "เล่น–หยุด" (ไอคอนสลับตาม onState) / "ข้ามเพลง" (`advance`) / "โหมดเวที"
   และข้อความ `ถัดไป: <ชื่อเพลงแรกในคิว>` หรือ `คิวว่าง — เพิ่มเพลงต่อได้เลย` · ไม่มี current → ปุ่มควบคุม disabled
7. จอว่าง (current เป็น null): ซ่อน iframe แสดงภาพไมโครโฟน (SVG) กับข้อความ "พิมพ์ชื่อเพลง แล้วกด เข้าคิว" ในกรอบ `#stage`
8. เปิดหน้าใหม่แล้วมี state เดิมใน localStorage: แสดงคิว/ประวัติเดิม; current เดิมให้ `cue` ไว้ (ไม่เล่นเอง เพราะเบราว์เซอร์บล็อก autoplay) รอผู้ใช้กดเล่น
9. โหมดเวที: `requestFullscreen()` กับ `#stage-col`; ในโหมดนี้ซ่อน topbar, `#stage` กว้าง `min(100vw, calc((100vh - 72px) * 16 / 9))`, `#nowbar` สูง 72px แถวเดียว (ชื่อเพลง + ถัดไป + ปุ่ม), พื้นดำ; ถ้า `document.fullscreenEnabled` เป็น false ให้ซ่อนปุ่ม
10. บันทึก state ลง localStorage ทุกครั้งที่เปลี่ยน (ครอบ try/catch); ปุ่มลัด `/` = โฟกัสช่องค้น (เมื่อไม่ได้พิมพ์อยู่ในช่องใด)
11. `?demo=1`: ไม่อ่าน/ไม่เขียน localStorage; ใส่ผลค้นหา 8 เพลงจาก demo-data, current = เพลงที่ 1, queue = เพลงที่ 2–5, history = เพลงที่ 6–8, บรรทัดค้นหา = `ค้นหา: คาราโอเกะ ลูกอม`
    `&tab=results|queue|history` เลือกแท็บที่เปิด (ค่าเริ่ม results) · `&idle=1` → current เป็น null และคิวว่าง (ไว้ดูจอว่าง)
12. ข้อมูลจาก API ทุกตัวใส่ด้วย `textContent` / `setAttribute` เท่านั้น ห้าม `innerHTML` กับข้อมูลจากภายนอก

## id ที่ต้องมีใน DOM (หัวหน้าใช้วัดตำแหน่ง)
`#app`, `#stage-col`, `#topbar`, `#stage`, `#player`, `#nowbar`, `#sidebar`, `#search-form`, `#search-input`, `#search-note`,
`#tab-results`, `#tab-queue`, `#tab-history`, `#panel-results`, `#panel-queue`, `#panel-history`, `#toasts`

## ขนาดจอ
1440x900, 1280x720, 1024x768, 844x390 (มือถือแนวนอน), 390x844 และกว้าง 360 — ไม่มีการเลื่อนแนวนอนทุกขนาด
มี 3 โหมด เลือกจากทั้งความกว้างและความสูง:

| โหมด | เงื่อนไข media query |
|---|---|
| desktop | `(min-width: 900px) and (min-height: 600px)` |
| compact | `(min-width: 700px) and (max-height: 599px)` |
| stacked | ที่เหลือทั้งหมด (ค่าเริ่มต้นของ CSS) |

## กลไกการจัดวาง (ทำตามตัวเลขนี้ หัวหน้าคำนวณไว้แล้ว)
**desktop** — หน้าไม่เลื่อน: `body{height:100dvh; overflow:hidden}`
- `#app`: grid 2 คอลัมน์ `minmax(0,1fr) var(--side)`; padding 20px; gap 20px; สูง 100dvh · `--side` = 420px เมื่อกว้าง ≥ 1280px ไม่งั้น 360px
- `#stage-col` (ซ้าย): flex แนวตั้ง gap 16px = `#topbar` สูง 48px (โลโก้ "ร้องเลย" + คำโปรยสั้น) → `#stage` → `#nowbar` สูง 132px
- `#stage`: `aspect-ratio:16/9; width:min(100%, calc((100dvh - 268px) * 16 / 9)); margin-inline:auto`
- `#sidebar` (ขวา): flex แนวตั้ง สูงเต็ม grid; ลำดับ = ฟอร์มค้นหา (ช่องสูง 52px) → `#search-note` → แถบแท็บ (สูง 44px) → พื้นที่รายการ `flex:1; min-height:0; overflow-y:auto`
- ค่าที่ต้องวัดได้: 1440x900 → stage 960×540 · 1280x720 → 800×450 · 1024x768 → 604×340 (±1px) และขอบล่างของ `#nowbar` ≤ ความสูงจอ − 20

**compact** (เช่น 844x390) — หน้าไม่เลื่อนเหมือน desktop แต่: padding 12px, gap 12px, `--side` 320px, ซ่อน `#topbar`, `#nowbar` สูง 56px แถวเดียว (ชื่อเพลง + ปุ่มไอคอน 40px; ซ่อนข้อความ "ถัดไป" และชื่อช่อง)
- `#stage`: `width:min(100%, calc((100dvh - 92px) * 16 / 9))` → ที่ 844x390 ได้ 488×274.5

**stacked** (เช่น 390x844) — หน้าเลื่อนแนวตั้งตามปกติ
- `#stage-col`: `position:sticky; top:0; z-index:10` พื้นทึบ (ไม่โปร่ง) ซ่อน `#topbar`; `#stage` กว้าง `min(100%, calc(45dvh * 16 / 9))` ชิดขอบจอ ไม่มีมุมโค้ง; `#nowbar` สูง 64px แถวเดียวแบบ compact
- `#sidebar`: ไหลตามหน้า padding 16px; พื้นที่รายการไม่ต้องมี scroll ของตัวเอง
- ที่ 390x844: stage 390×219, ขอบล่าง nowbar ที่ y≈283

**toast** (`#toasts`): `position:fixed` — desktop/compact: มุมขวาล่าง ห่างขอบ 20px กว้างไม่เกิน `calc(var(--side) - 40px)` (อยู่ในแนวคอลัมน์ขวาเสมอ) · stacked: ล่างกลาง ห่างขอบ 16px
ห้ามมี element ใดทับ `#player` ในทุกโหมด (toast, ป้าย, เมนู)

## เทสต์กรอบ
ไม่มีในใบนี้ — sandbox ไม่มีเบราว์เซอร์ หัวหน้าจะวัด `getBoundingClientRect` กับภาพหน้าจอเองทุกขนาด ให้ทำตามสูตร CSS ข้างบนตรงตัว

## สถานะอื่น
- `prefers-reduced-motion: reduce` → ปิด animation/transition ทั้งหมด (เหลือแค่เปลี่ยนสี)
- ไม่มี JS → `<noscript>` ข้อความ "ต้องเปิด JavaScript เพื่อใช้งาน"
- โหลดตัวเล่น YouTube ไม่ได้ (`onUnavailable`) → ข้อความใน `#stage`: "โหลดตัวเล่น YouTube ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่" + ปุ่ม "ลองใหม่"
- คีย์บอร์ด: ทุกปุ่มเป็น `<button>` จริง มี `aria-label` ภาษาไทย; `:focus-visible` เส้นขอบ 2px `#33e1ff` offset 2px; แท็บใช้ `role="tablist"/"tab"/"tabpanel"` + `aria-selected`
- แตะ: เป้ากดทุกปุ่ม ≥ 40×40px

## ภาพที่ต้องได้
- สี: พื้นหลัง `#0b0714` · พื้นการ์ด `#151024` · พื้นการ์ดชั้นสอง `#1e1733` · เส้นขอบ `rgba(255,255,255,.08)` · ตัวอักษร `#f4f0ff` · ตัวอักษรรอง `#a59cc4`
  นีออนชมพู `#ff3d9a` · นีออนฟ้า `#33e1ff` · เลขลำดับคิว/ป้ายความยาวสีทอง `#ffd166`
- ปุ่มหลัก: ไล่สี `linear-gradient(135deg, #e11d74, #7c3aed)` ตัวอักษรขาว หนา 600 สูง 40px มุม 12px · ปุ่มรอง: พื้น `#1e1733` ขอบ `rgba(255,255,255,.12)` ตัวอักษร `#f4f0ff`
- พื้นหลังหน้า: แสงเรืองสองจุดแบบ `radial-gradient` — ชมพู `rgba(255,61,154,.18)` มุมซ้ายบน, ฟ้า `rgba(51,225,255,.12)` มุมขวาล่าง, `background-attachment: fixed`
- `#stage`: พื้นดำ `#000`, มุม 20px (desktop) / 14px (compact) / 0 (stacked), ขอบ 1px `rgba(255,61,154,.35)`, เงาเรือง `0 0 60px rgba(255,61,154,.18)`
- การ์ด/แผง: มุม 16px; แถวรายการมุม 12px; แถวที่ hover พื้น `#1e1733`
- ฟอนต์: หัวข้อ/ชื่อเพลงใหญ่ `Kanit` 600; เนื้อหา `Sarabun` 400/600 — โหลดจาก Google Fonts ด้วย `<link>` พร้อม fallback `system-ui, "Thonburi", "Leelawadee UI", sans-serif`
  ขนาด: เนื้อหา 16px, ตัวรอง 14px (ไม่มีตัวอักษรเล็กกว่า 13px), ชื่อเพลงใน nowbar 22px (desktop) / 16px (compact, stacked)
- ภาพปกผลค้นหา 112×63px มุม 10px; ภาพปกในคิว 80×45px มุม 8px
- ข้อความทุกจุด contrast ≥ 4.5 กับพื้นของมัน
- โลโก้: ไมโครโฟน SVG สีไล่ชมพู–ม่วง + คำว่า "ร้องเลย" (Kanit 700, 24px) + คำโปรย "คาราโอเกะจาก YouTube" สี `#a59cc4`; favicon เป็น SVG data URI

## ภาษาไทย
ห้ามตัดกลางคำ (ใช้ `white-space:nowrap` บนปุ่ม/ป้าย): "คาราโอเกะ", "เข้าคิว", "เล่นถัดไป", "เล่นเลย", "กำลังร้อง", "ร้องไปแล้ว", "ผลค้นหา", "โหมดเวที", "ในคิวแล้ว"
ที่กว้าง 360px แถวผลค้นหาต้องไม่ล้น: ปุ่ม 3 ปุ่มอยู่บรรทัดใต้ชื่อเพลง ถ้าไม่พอให้ "เล่นถัดไป"/"เล่นเลย" เหลือแค่ไอคอน (ยังมี aria-label)

## เกณฑ์ผ่าน — `test/store.test.mjs` (`node --test`)
import จาก `../public/js/store.js` ครอบคลุมอย่างน้อย:
- `enqueue` ตอน current null → เป็น current, คิวยาว 0 · ตอนมี current → ต่อท้าย, qid ไม่ซ้ำกันแม้เพลงเดียวกัน
- `enqueueNext` แทรก index 0 · `playNow` ย้าย current เดิมลง history[0]
- `playFromQueue` ดึงกลางคิวมาเล่น ลำดับที่เหลือคงเดิม; qid ไม่มีจริง → คืน state เดิม (`===`)
- `advance` คิว 2 เพลง → เลื่อนถูก; คิวว่าง → current null; `skipHistory:true` → history ไม่เพิ่ม
- history: id ซ้ำย้ายขึ้นหน้าไม่เพิ่มจำนวน; เกิน 30 ตัดเหลือ 30
- `move` +1/−1/เกินขอบ/ไม่พบ; `moveToTop`; `remove`; `clearQueue` ไม่แตะ current
- `totalDurationSec`; `formatDuration` (268, 3723, 0, 59)
- `serialize`→`deserialize` ได้ค่าเท่าเดิม; `deserialize("{bad")`, `("null")`, `("[]")` → state ว่าง; รายการ id ผิดรูปถูกทิ้ง
- ฟังก์ชันไม่แก้ state ที่รับเข้ามา (ตรวจด้วย `Object.freeze` แบบลึกกับอินพุต)

## การตรวจ
`node --test test/store.test.mjs` ผ่านทั้งหมด และ `node --check` ผ่านกับทุกไฟล์ใน `public/js/`

## ส่งมอบ
สรุปไฟล์ที่สร้าง, คำสั่งที่รันและผลจริง, และหัวข้อ **"สิ่งที่ยังไม่ได้ตรวจด้วยตา"** แยกต่างหาก (ทุกอย่างที่เกี่ยวกับหน้าตาและการเล่นจริงอยู่ในหัวข้อนี้ — ห้ามเขียนว่าภาพถูกต้องจากเทสต์อย่างเดียว) · ไม่ต้อง commit
