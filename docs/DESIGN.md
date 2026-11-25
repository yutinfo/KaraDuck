# ร้องเลย — คาราโอเกะจาก YouTube (สัญญากลาง)

เว็บหน้าเดียว รันบนเครื่อง (`node server.mjs` → http://localhost:8791) ใช้เหมือนโปรแกรมคาราโอเกะ:
พิมพ์ชื่อเพลง → ระบบเติมคำว่า "คาราโอเกะ" นำหน้าแล้วค้น YouTube → กดเพิ่มเข้าคิว → เล่นต่อเนื่องจากคิวเอง

ไม่มี dependency จาก npm ไม่มีขั้น build ใช้ Node 22 (ES modules, `fetch` ในตัว, `node --test`)

## โครงไฟล์และเจ้าของ (รอบ 2 — สั่งเพลงจากมือถือ)

| ไฟล์ | เจ้าของ |
|---|---|
| `server.mjs`, `lib/**`, `public/js/store.js`, `public/js/commands.js`, `test/*.test.mjs` | Codex (ใบงาน 03) |
| `public/index.html`, `public/styles.css`, `public/remote.html`, `public/remote.css`, `public/js/app.js`, `public/js/remote.js`, `public/js/sync.js`, `public/js/api.js`, `public/js/player.js`, `public/js/demo-data.js` | agy (ใบงาน 04) |
| `docs/DESIGN.md`, `package.json`, `tasks/**`, `test/fixtures/**` | หัวหน้า — ห้ามแก้ |

## API

### `GET /api/search?q=<ข้อความ>`

200:
```json
{
  "query": "คาราโอเกะ ลูกอม",
  "items": [
    {
      "id": "k6ngeWkYjI8",
      "title": "[KARAOKE] ลูกอม - วัชราวลี",
      "channel": "SINGTHAI",
      "duration": "4:28",
      "durationSec": 268,
      "views": "การดู 831,115 ครั้ง",
      "thumbnail": "https://i.ytimg.com/vi/k6ngeWkYjI8/mqdefault.jpg"
    }
  ]
}
```
- `query` = ข้อความที่ส่งไปค้นจริง (หลังเติมคำนำหน้า) หน้าเว็บนำไปแสดง
- `items` สูงสุด 30 รายการ ตามลำดับที่ YouTube ให้ ไม่มี id ซ้ำ ไม่มีไลฟ์ (รายการที่ไม่มีความยาว)
- `views` เป็น `""` ได้ถ้าไม่มีข้อมูล
- ผิดพลาด: `400 {"error":"missing_query"}` (q ว่างหลัง trim) · `502 {"error":"upstream_failed"}` (YouTube ตอบไม่ได้/timeout/อ่านผลไม่ได้)
- ทุกคำตอบ API: `Content-Type: application/json; charset=utf-8`

### กติกาเติมคำนำหน้า (`normalizeQuery`)
1. trim และยุบช่องว่างซ้อนเป็นช่องเดียว ตัดให้ยาวไม่เกิน 100 ตัวอักษร
2. ถ้าข้อความไม่มี `คาราโอเกะ` และไม่มี `karaoke` (ไม่สนตัวพิมพ์) → เติม `"คาราโอเกะ "` ไว้หน้า
3. ถ้ามีอยู่แล้ว → ไม่เติมซ้ำ

| อินพุต | ผล |
|---|---|
| `ลูกอม` | `คาราโอเกะ ลูกอม` |
| `  รักแรกพบ   tattoo colour ` | `คาราโอเกะ รักแรกพบ tattoo colour` |
| `Karaoke ลูกอม` | `Karaoke ลูกอม` |
| `ลูกอม คาราโอเกะ` | `ลูกอม คาราโอเกะ` |
| `   ` | ข้อผิดพลาด missing_query |

### ไฟล์หน้าเว็บ
`GET /` → `public/index.html` · path อื่น → ไฟล์ใน `public/` · ไม่พบ → 404 · ห้ามออกนอก `public/`

## ข้อมูลฝั่งหน้าเว็บ

```
Song      = { id, title, channel, duration, durationSec, thumbnail }
QueueItem = Song + { qid }            // qid ไม่ซ้ำต่อรายการคิว (เพลงเดียวกันเข้าคิวซ้ำได้)
State     = { current: QueueItem|null, queue: QueueItem[], history: Song[] }
```
- `history` ใหม่สุดอยู่หน้า ไม่มี id ซ้ำ (เพลงเดิมย้ายขึ้นหน้า) เก็บสูงสุด 30
- (รอบ 2) State เก็บที่เซิร์ฟเวอร์เป็นคิวกลาง ไม่ใช้ `localStorage` คีย์ `karaoke.state.v1` อีกต่อไป — ดูหัวข้อ "รอบ 2" ท้ายไฟล์

## พฤติกรรมหลัก
- เพิ่มเข้าคิวตอนไม่มีเพลงเล่นอยู่ (`current` เป็น null) → เพลงนั้นเริ่มเล่นทันที
- เพลงจบ → เล่นเพลงแรกของคิวต่อเอง · คิวหมด → หน้าจอว่างพร้อมข้อความชวนเลือกเพลง
- เพลงที่เจ้าของปิดการฝัง (YouTube player error 101/150 หรือ 2/5/100) → แจ้งเตือน แล้วข้ามไปเพลงถัดไปเองใน 2.5 วินาที ไม่ลงประวัติ
- เล่นด้วย YouTube IFrame Player API เท่านั้น ห้ามวางสิ่งใดทับ iframe ของ player

---

# รอบ 2 — คิวกลาง + สั่งเพลงจากมือถือ

จอหลัก (เครื่องที่รันเซิร์ฟเวอร์ เปิด `/`) เป็นตัวเล่นวิดีโอตัวเดียว มือถือใน Wi-Fi เดียวกันสแกน QR แล้วเปิด `/remote?k=<รหัสห้อง>`
เพื่อค้นหา เพิ่มคิว ข้ามเพลง หยุด/เล่น คิวมีชุดเดียวอยู่ที่เซิร์ฟเวอร์ ทุกจอเห็นตรงกันผ่าน Server-Sent Events

## ข้อมูลเพิ่ม
```
Song      = { id, title, channel, duration, durationSec, thumbnail, by? }   // by = ชื่อคนขอเพลง (ไม่บังคับ)
Snapshot  = { rev, current, queue, history, playerState }                   // สิ่งที่เซิร์ฟเวอร์ส่งให้ทุกจอ
playerState = 'playing' | 'paused' | 'buffering' | 'idle'                   // จอหลักรายงาน; current เป็น null → 'idle'
```
- `rev` เป็นเลขจำนวนเต็ม เพิ่มทีละ 1 ทุกครั้งที่ Snapshot เปลี่ยน
- `by`: string หลัง trim ยาว 1–20 ตัวอักษร; ว่าง/ไม่ใช่ string → ไม่มีฟิลด์นี้; เก็บไว้ทั้งใน current, queue และ history

## คำสั่ง — `applyCommand(state, cmd, { makeQid }?)` ใน `public/js/commands.js`
ฟังก์ชันล้วน ใช้ร่วมกันทั้งเซิร์ฟเวอร์และโหมด `?demo=1` ของจอหลัก สร้างบนฟังก์ชันใน `store.js`
คืน state ใหม่; คำสั่งถูกรูปแต่ไม่มีผล (เช่น qid ไม่มีจริง) → คืน state เดิม (`===`); คำสั่งผิดรูป → throw Error ที่มี `code === 'bad_command'`

| `cmd.type` | ฟิลด์ | ผล |
|---|---|---|
| `enqueue` | `song` | `store.enqueue` |
| `enqueueNext` | `song` | `store.enqueueNext` |
| `playNow` | `song` | `store.playNow` |
| `playFromQueue` | `qid` | `store.playFromQueue` |
| `remove` | `qid` | `store.remove` |
| `move` | `qid`, `delta` (จำนวนเต็ม −50…50 ไม่ใช่ 0) | `store.move` |
| `moveToTop` | `qid` | `store.moveToTop` |
| `advance` | `qid?`, `skipHistory?` | ถ้าส่ง `qid` มาและไม่ตรงกับ `current.qid` → ไม่มีผล (กันรายงานเพลงจบซ้ำ); ไม่งั้น `store.advance` |
| `clearQueue` | – | `store.clearQueue` |
| `clearHistory` | – | `store.clearHistory` |

`song` ที่รับเข้ามาถูกสร้างใหม่เสมอ (ไม่เชื่อค่าจากลูกข่าย): `id` ต้องตรง `/^[\w-]{11}$/`; `title` string หลัง trim ยาว 1–300; `channel` string ตัดที่ 100 (ไม่มี → `""`);
`durationSec` จำนวนเต็ม 0–86400 (อื่น ๆ → 0); `duration` = `formatDuration(durationSec)`; `thumbnail` = `https://i.ytimg.com/vi/<id>/mqdefault.jpg` เสมอ; `by` ตามกติกาข้างบน
`qid` ต้องเป็น string ยาว 1–64

## สิทธิ์
- **เครื่องเดียวกัน** (remoteAddress เป็น `127.0.0.1`, `::1`, `::ffff:127.0.0.1`): ทำได้ทุกอย่าง ไม่ต้องมีรหัส
- **เครื่องอื่น**: ไฟล์หน้าเว็บโหลดได้ (ยกเว้น `/` และ `/index.html` → `302` ไป `/remote` พร้อม query เดิม); `/api/*` ต้องมีรหัสห้องถูกต้องใน `?k=` ไม่งั้น `401 {"error":"bad_key"}`
- รหัสห้อง: 6 ตัวจากชุด `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` สุ่มครั้งแรกแล้วเก็บในไฟล์ข้อมูล ใช้ตัวเดิมหลังรีสตาร์ต

## API เพิ่ม
| เส้นทาง | ใครเรียกได้ | ผล |
|---|---|---|
| `GET /api/state` | ทุกคนที่มีสิทธิ์ | `200` Snapshot |
| `GET /api/events` | ทุกคนที่มีสิทธิ์ | SSE: ทันทีที่ต่อส่ง `event: state` + `data: <Snapshot JSON>`; ทุกครั้งที่เปลี่ยนส่งซ้ำ; คำสั่งควบคุมส่ง `event: control` + `data: {"action":"toggle"}`; ทุก 25 วินาทีส่งบรรทัด `: ping` |
| `POST /api/command` | ทุกคนที่มีสิทธิ์ | body JSON = คำสั่ง 1 รายการ → `200 {"ok":true,"rev":<n>}` |
| `GET /api/remote-info` | เครื่องเดียวกันเท่านั้น | `200 {"available":true,"url":"http://192.168.1.23:8791/remote?k=AB12CD"}` หรือ `{"available":false,"url":null}` ถ้าไม่มี IP ในวง LAN |
| `GET /api/qr.svg` | เครื่องเดียวกันเท่านั้น | `200 image/svg+xml` QR ของ url ข้างบน; ไม่มี url → `404` |
| `GET /remote` | ทุกคน | เสิร์ฟ `public/remote.html` |

`POST /api/command` เพิ่มเติม:
- ต้องมี header `Content-Type: application/json` ไม่งั้น `415 {"error":"bad_content_type"}` (กันเว็บอื่นยิงคำสั่งข้ามโดเมน)
- body เกิน 16 KB → `413 {"error":"too_large"}`; JSON พัง/คำสั่งผิดรูป → `400 {"error":"bad_command"}`
- นอกจากคำสั่งในตารางแล้ว มีอีก 2 ชนิดที่ไม่ผ่าน `applyCommand`:
  - `{"type":"control","action":"toggle"|"restart"}` → ไม่เปลี่ยน state; กระจาย `event: control` ให้ทุกจอ (จอหลักเป็นคนทำตาม)
  - `{"type":"report","playerState":...}` → ตั้ง `playerState` (เครื่องเดียวกันเท่านั้น)
- เครื่องอื่นสั่ง `clearQueue`, `clearHistory`, `report` → `403 {"error":"local_only"}`
- เรียก API ที่จำกัดเครื่องเดียวกันจากเครื่องอื่น → `403 {"error":"local_only"}`

## พฤติกรรมจอหลัก (รอบ 2)
- Snapshot แรกหลังเปิดหน้า: ถ้ามี current → `cue` (ไม่เล่นเอง) · หลังจากนั้นเมื่อ `current.qid` เปลี่ยน → `load` (เล่นทันที) · current เป็น null → จอว่าง
- เพลงจบ → ส่ง `advance` พร้อม `qid` ของเพลงที่จบ · เล่นไม่ได้ → toast แล้วอีก 2.5 วินาทีส่ง `advance` พร้อม `qid` และ `skipHistory:true`
- สถานะตัวเล่นเปลี่ยน → ส่ง `report` · ได้ `event: control` → `toggle` / `restart` ตัวเล่น
- หน้า `/remote` ไม่มีตัวเล่นวิดีโอ ไม่ส่ง `report` ไม่ส่ง `advance` แบบเพลงจบ (ปุ่ม "ข้ามเพลง" ส่ง `advance` พร้อม `qid` ปัจจุบัน)

---

# รอบ 4 — ลากจัดลำดับคิว

ลากแถวคิวขึ้น–ลงได้ทั้งจอหลัก (เมาส์/ทัชแพด) และหน้ามือถือ (นิ้ว) ไม่มีการเปลี่ยนฝั่งเซิร์ฟเวอร์: ปล่อยแล้วส่งคำสั่งเดิม `{"type":"move","qid":…,"delta":…}` ครั้งเดียว

## `public/js/drag-sort.js` (เจ้าของ: Codex) — ใช้ร่วมทั้งสองหน้า
```
createDragSort({
  list,                         // element ที่ลูกชั้นแรกคือแถว
  rowSelector = '[data-qid]',   // แถวต้องมี data-qid
  handleSelector = '.drag-handle',
  scroller = null,              // element ที่เลื่อนได้ (null = เลื่อนทั้งหน้าต่าง) ใช้เลื่อนอัตโนมัติเมื่อลากชิดขอบ
  onMove,                       // (qid, delta) เรียกครั้งเดียวตอนปล่อย เฉพาะเมื่อ delta !== 0 (delta = ตำแหน่งใหม่ − ตำแหน่งเดิม)
  onDragState,                  // (isDragging: boolean) ไม่บังคับ
}) → { isDragging(), destroy() }

indexAfterDrag({ tops, heights, from, pointerY })   // ฟังก์ชันล้วน (export ไว้ทดสอบ) → ตำแหน่งใหม่ 0…n−1
```
- เริ่มลากจากที่จับ (`handleSelector`) เท่านั้น ด้วย Pointer Events (เมาส์ นิ้ว ปากกา ใช้โค้ดชุดเดียว) — ที่จับต้องมี CSS `touch-action:none` (เจ้าของหน้าใส่เอง)
- ระหว่างลาก: แถวที่ลากได้ class `is-dragging` และถูกเลื่อนตามนิ้วด้วย `transform`; แถวอื่นขยับหลบด้วย `transform` (โมดูลตั้ง inline style เอง); `list` ได้ class `is-sorting`
- ปล่อย: โมดูลย้าย element ของแถวไปตำแหน่งใหม่ใน DOM ทันที ล้าง transform แล้วเรียก `onMove`
- ยกเลิก (ปุ่ม Escape, `pointercancel`) → กลับที่เดิม ไม่เรียก `onMove`
- คีย์บอร์ด: โฟกัสที่จับแล้วกด ↑/↓ → `onMove(qid, −1/+1)` ทันที (ไม่ขยับ DOM เอง — หน้าจอ render ใหม่จาก state)
- ผูก event กับ `list` แบบ delegation: หน้าจอสร้าง `list` ใหม่ตอน render ได้ โดยเรียก `destroy()` ของตัวเก่าแล้ว `createDragSort` ใหม่
- หน้าจอต้อง **ไม่ render รายการคิวใหม่ระหว่าง `isDragging()`** (ถ้ามี state ใหม่เข้ามาให้จำไว้แล้ว render ตอน `onDragState(false)`)

---

# รอบ 6 — ป้ายเตือนเพลงที่เล่นแบบฝังไม่ได้

เจ้าของวิดีโอบางรายปิดการเล่นนอก YouTube (หรือจำกัดประเทศ/อายุ) เดิมจะรู้ก็ตอนถึงคิวแล้วถูกข้าม รอบนี้ให้รู้ตั้งแต่ในผลค้นหา

## วิธีตรวจ (ทดลองแล้ว 2026-11-24)
โหลดหน้า `https://www.youtube.com/embed/<id>` แล้วอ่าน `previewPlayabilityStatus.status` ที่ฝังอยู่ใน HTML — เป็นคำตัดสินเดียวกับที่ตัวเล่นแบบฝังใช้
(oEmbed ใช้ไม่ได้: พลาดวิดีโอที่จำกัดเว็บ/ประเทศ · `youtubei/v1/player` ใช้ไม่ได้: ถูกด่านกันบอตปฏิเสธ)
ใน HTML ข้อความอยู่ในสตริง JS จึงมี backslash นำหน้าเครื่องหมายคำพูด: `\"previewPlayabilityStatus\":{\"status\":\"OK\",\"playableInEmbed\":true,…`
ตัวอย่างจริง (ตัดสั้น): `test/fixtures/embed-ok.html`, `embed-unplayable.html`, `embed-owner-disabled.html`

| ผลที่อ่านได้ | ค่า |
|---|---|
| `status` เป็น `OK` | `true` (เล่นได้) |
| `status` เป็นค่าอื่น (`UNPLAYABLE`, `ERROR`, `LOGIN_REQUIRED`, …) | `false` |
| ไม่พบ `previewPlayabilityStatus`, HTTP ไม่ใช่ 2xx, timeout, fetch ล้ม | `null` (ไม่รู้ — หน้าจอไม่แสดงป้าย) |

## `GET /api/embeddable?ids=<id,id,…>`
- สิทธิ์เหมือน `/api/search` (เครื่องอื่นต้องมี `?k=`)
- `ids`: 1–30 รายการคั่นด้วยจุลภาค แต่ละตัวตรง `/^[\w-]{11}$/`; ซ้ำได้ (นับครั้งเดียว) · ผิดรูป/ไม่มี/เกิน 30 → `400 {"error":"bad_ids"}`
- `200 {"k6ngeWkYjI8":true,"8oWgHgf_c_w":false,"abcdefghijk":null}` — มีคีย์ครบทุก id ที่ขอ
- ฝั่งเซิร์ฟเวอร์: ขอพร้อมกันไม่เกิน 6 รายการ, timeout รายการละ 5 วินาที, อ่าน body ไม่เกิน 1 MB ต่อหน้า
  แคชต่อ id: `true`/`false` อายุ 6 ชั่วโมง, `null` ไม่แคช, เก็บสูงสุด 2,000 id (เกินทิ้งตัวเก่าสุด); id เดียวกันที่กำลังตรวจอยู่ใช้ผลร่วมกัน (ไม่ยิงซ้ำ)
- header ที่ส่งไป YouTube: `User-Agent` แบบเบราว์เซอร์เดสก์ท็อป, `Referer: http://localhost:<port>/`, `Accept-Language: en`

## หน้าจอ (จอหลักและมือถือ)
- หลังแสดงผลค้นหา → เรียก `/api/embeddable` ด้วย id ของผลชุดนั้น (ครั้งเดียว ไม่บล็อกการแสดงผล) เก็บผลใน `Map` ระดับโมดูล (`embedFlags`) ใช้ต่อได้ตลอดอายุหน้า; id ที่รู้ผลแล้วไม่ถามซ้ำ
- เพลงที่ได้ `false`: แผ่นปกได้ class `is-blocked` — ปกหรี่, ป้าย `.pill.is-warn` "เล่นที่นี่ไม่ได้" มุมซ้ายบน (แทนป้าย "ในคิวแล้ว"), ปุ่มเพิ่มเพลงทุกปุ่มของแผ่นนั้น `disabled`
- `true` / `null` / เรียกไม่สำเร็จ → ไม่เปลี่ยนอะไร (ใช้งานได้ตามปกติ)
