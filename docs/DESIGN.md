# KaraDuck — สัญญาระบบปัจจุบัน

ตรวจจากโค้ด ณ 25 พ.ย. 2026 ใช้ Node.js 22 ขึ้นไป ไม่มี dependency จาก npm และไม่มีขั้น build
บน Vercel ไฟล์เว็บอยู่ใน `public/` คำขอผ่าน `api/*.js` ไป `lib/vercel.mjs` และ `lib/handlers.mjs`
ข้อมูลอยู่ใน Firebase Realtime Database ผ่าน REST บัญชีบริการ หน้าเว็บฟังฐานข้อมูลโดยตรงและเขียนผ่าน API เท่านั้น
บนเครื่อง `server.mjs` ใช้ handlers เดียวกันกับ `lib/store-file.mjs` แทน Firebase

## ข้อมูลและการเขียนชนกัน

```text
rooms/<id>/q          ข้อความ JSON ของคิวและข้อมูลห้อง
rooms/<id>/p/s        playing | paused | buffering | idle
rooms/<id>/p/c        { a: toggle | restart, t: เวลา ms }
meta                 ข้อความ JSON ของสวิตช์ ตัวนับสร้างห้อง และดัชนี PIN
usage/<id>           ข้อความ JSON ของจำนวนค้นหา
```

`q` เมื่อถอด JSON:

```text
{ rev, name, guestEpoch, ownerEpoch, createdAt, updatedAt,
  current: QueueItem|null, queue: QueueItem[], history: Song[] }
Song = { id, title, channel, duration, durationSec, thumbnail, by? }
QueueItem = Song + { qid }
```

ชื่อห้อง trim แล้ว 1–40 ตัวอักษร `rev` เป็น safe integer ไม่ติดลบ เพิ่มเมื่อเขียนคิวจริง
รอบโทเคนอยู่ในช่วง 1–999999999 เวลาเป็น ms ข้อมูลเก่าที่ไม่มีเวลาถูกอ่านเป็น 0
`q` เก็บเป็นข้อความเพื่อรักษา `null` และอาร์เรย์ว่างของคิว
อ่านพร้อม ETag แล้ว PUT ด้วย `if-match` ชนกันลองใหม่สูงสุด 5 รอบ ก่อนตอบ `503 busy`
`p` เขียนแยก ไม่เปลี่ยน ETag คิวหรือ `updatedAt` การควบคุมและรายงานสถานะจึงไม่ต่ออายุห้อง
ประวัติใหม่สุดอยู่หน้า ไม่ซ้ำตาม id สูงสุด 30 เพลง คิวรอสูงสุด 200 เพลง ไม่รวม current

`meta` ถอดได้เป็น `{ createEnabled, hour, creates, pins, join: { minute, fails } }`
เมื่อยังไม่มี ใช้ `{ createEnabled: true, hour: 0, creates: 0, pins: {}, join: { minute: 0, fails: 0 } }`
`pins` แมปข้อความ PIN 6 หลักไป id ห้อง อยู่เฉพาะข้อมูลที่ไม่เปิดอ่าน ไม่อยู่ใน `q`
`usage/<id>` ถอดได้เป็น `{ hour, searches }` เขียนทับโดยไม่ใช้ ETag จึงนับคลาดเคลื่อนได้เมื่อค้นหาพร้อมกัน
`hour = floor(ms / 3600000)` และ `minute = floor(ms / 60000)` ใช้ช่วงนาฬิกา ไม่ใช่หน้าต่างเลื่อน

`database.rules.json` ปิด `.read` และ `.write` ที่ราก เปิด `.read` เฉพาะ `rooms/$room`
ผู้รู้ id อ่านทั้งห้องได้โดยไม่ต้องมีโทเคน แต่ไล่รายชื่อห้องและอ่าน `meta`/`usage` ไม่ได้ บัญชีบริการเป็นผู้เขียน
การเปลี่ยนรอบแขกยกเลิกสิทธิ์ API แต่ไม่ทำให้ id ที่เคยรู้กลายเป็นความลับอีกครั้ง

บนเครื่องเก็บข้อมูลใน `data/rooms.json` และกุญแจใน `data/secrets.json` โดยเปลี่ยนโฟลเดอร์ผ่าน `DATA_DIR` ได้
บันทึกไฟล์ชั่วคราวสิทธิ์ `0600` แล้ว rename ก่อนเปลี่ยนหน่วยความจำ หากไฟล์ข้อมูลอ่านหรือถอดไม่ได้ย้ายเป็น `.bad-<เวลา>`
เซิร์ฟเวอร์ไม่แตะ `data/state.json` ของเวอร์ชันเดิม บัญชีบริการไม่จำเป็นสำหรับโหมดนี้

## โทเคนและบทบาท

`lib/tokens.mjs`: `<roomId>.<role><epoch>.<signature>`
id สุ่ม 16 ตัวจาก `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` บทบาท `o` เจ้าของ หรือ `g` แขก
ลายเซ็นเป็น 16 ไบต์แรกของ HMAC-SHA256 ด้วย `ROOM_SECRET` บน `<roomId>.<role><epoch>` เข้ารหัส base64url 22 ตัว
ตรวจลายเซ็นด้วย `timingSafeEqual` แล้วเทียบรอบกับ `ownerEpoch` หรือ `guestEpoch` ของห้อง ไม่มีอายุหมดตามเวลา

ลิงก์เจ้าของใช้ `/#o=<โทเคนเจ้าของ>` ลิงก์แขกใช้ `/remote#g=<โทเคนแขก>`
`session.js` เก็บที่ `localStorage` คีย์ `karaoke.token.o` หรือ `karaoke.token.g` แล้วลบ hash ด้วย `replaceState`
ถ้า storage ใช้ไม่ได้เก็บในหน่วยความจำของโมดูล คำขอ API ส่ง `Authorization: Bearer <โทเคน>` ไม่ส่งใน query

| การทำงาน | ไม่มีโทเคน | แขก | เจ้าของห้อง | ผู้ดูแล |
|---|---|---|---|---|
| config / สร้างห้องสาธารณะ / แลก PIN | ได้ | ได้ | ได้ | ได้ |
| อ่านข้อมูลห้องผ่าน API / ค้นหา / ตรวจ embed | ไม่ได้ | ได้ในห้องตน | ได้ในห้องตน | ต้องมีโทเคนห้องด้วย |
| เพิ่ม เล่น ข้าม ลบ จัดลำดับคิว และ control | ไม่ได้ | ได้ | ได้ | ต้องมีโทเคนห้องด้วย |
| ล้างคิว ล้างประวัติ report เปลี่ยนรหัสแขก ปิดห้อง | ไม่ได้ | ไม่ได้ | ได้ | ปิดผ่าน admin ได้ |
| ดู PIN ลิงก์แขก และ QR จาก API | ไม่ได้ | ไม่ได้ | ได้ | list คืน PIN ด้วย |
| admin: list/create/delete/rotateOwner/setCreate | ไม่ได้ | ไม่ได้ | ไม่ได้ด้วยโทเคนห้อง | ได้ |

ผู้ดูแลใช้ `ADMIN_KEY` หรือ Firebase ID token ของ Google ที่ผ่านการตรวจ RS256, audience, issuer, expiry, iat, auth_time และ sub
ต้องมี `email_verified: true`, provider `google.com` และบัญชีอยู่ใน `ADMIN_EMAILS` ด้วย (`lib/firebase-id-token.mjs`, `lib/handlers.mjs`)
หน้าเว็บออนไลน์ใช้ Google popup ส่วนหน้าเว็บบนเครื่องรับกุญแจและจำใน `sessionStorage` เครื่องมือ CLI ใช้กุญแจ

## API ทุกเส้นทาง

เนื้อคำตอบเป็น JSON `Content-Type: application/json; charset=utf-8` และ `Cache-Control: no-store`
ข้อผิดพลาดรูป `{ error: "<code>" }` ไม่มี stack trace
POST ต้องมี `Content-Type: application/json` (มี charset ได้) เนื้อไม่เกิน 16 KiB
ไม่ได้ตั้ง CORS ให้ API ทุกเส้นทางที่ระบุด้านล่างมีไฟล์ใน `api/` ชื่อตรงกัน

| วิธีและเส้นทาง | สิทธิ์ / คำขอ | คำตอบ 200 | ข้อผิดพลาดเฉพาะ |
|---|---|---|---|
| `GET /api/config` | สาธารณะ ไม่มี body | `{ mode, db, origin, createEnabled, firebase }` | ใช้ข้อผิดพลาดร่วม |
| `POST /api/rooms` | สาธารณะ `{ name }` | `{ roomId, name, ownerToken, ownerUrl }` | 400 `bad_name`; 403 `create_disabled`; 503 `rooms_full`; 429 `too_many_rooms`; 503 `busy` |
| `POST /api/join` | สาธารณะ `{ pin }` เป็น string ตัวเลข 6 หลัก | `{ roomId, name, guestToken }` | 400 `bad_pin`; 429 `too_many_attempts`; 404 `no_such_pin` |
| `GET /api/room` | โทเคนห้อง ไม่มี body | `{ roomId, name, role }`; เจ้าของเพิ่ม `{ pin, guestUrl, qrSvg }` | ข้อผิดพลาดสิทธิ์ห้อง |
| `GET /api/search?q=<ข้อความ>` | โทเคนห้อง ไม่มี body | `{ query, items }` | 429 `search_budget`; 503 `search_disabled`; 400 `missing_query`; 502 `upstream_failed` |
| `GET /api/embeddable?ids=<รายการ>` | โทเคนห้อง id คั่นด้วยจุลภาค | แมป id ไป `true`, `false` หรือ `null` | 503 `search_disabled`; 400 `bad_ids` |
| `POST /api/command` | โทเคนห้อง body ตามตารางคำสั่ง | `{ ok: true, rev }`; closeRoom คืน `{ ok: true, closed: true }` | 400 `bad_command`; 403 `owner_only`; 409 `queue_full`; 503 `busy`; ข้อผิดพลาดสิทธิ์ห้อง |
| `POST /api/admin` | ผู้ดูแล body ตามตาราง admin | ตาม action | 503 `admin_disabled`; 401 `bad_admin_key`; 403 `not_admin`; 400 `bad_name` หรือ `bad_command`; 404 `no_room`; 503 `busy` |

`config.mode` เป็น `local` หรือ `cloud`; `db` คือฐานช่องฟัง; `firebase` เป็น config สาธารณะ 4 ฟิลด์หรือ `null`
`createEnabled` รวมสวิตช์ฐานข้อมูลกับ `CREATE_DISABLED` แคชได้ 30 วินาทีต่อ instance
`pin` และ `qrSvg` อาจเป็น `null` เมื่อออก PIN ไม่สำเร็จหรือ URL ยาวเกินตัวสร้าง QR
PIN สุ่มด้วย `crypto.randomInt` ไม่ซ้ำดัชนีปัจจุบัน ลองสุ่มได้ 20 ครั้งต่อรอบการเขียน meta สูงสุด 5 รอบ
การนับ PIN ผิดรวมทั้งเว็บ เมื่อถึง 30 ครั้งทุก join ถูกระงับในนาทีนั้น แม้ส่ง PIN ถูก QR และลิงก์ยังใช้ได้
การบันทึกจำนวนครั้งผิดล้มเหลวยังคงตอบ `no_such_pin`

ข้อผิดพลาดร่วมและลำดับตรวจ:

- `lib/vercel.mjs` ตรวจ env บังคับก่อน ทุกเส้นทางอาจได้ `503 not_configured` จากนั้นตรวจ Content-Length เกินขนาดได้ `413 too_large` แม้ยังไม่ตรวจสิทธิ์
- โทเคนห้องหายหรือเซ็นไม่ถูก: `401 bad_token`; ห้องไม่มี: `404 no_room`; รอบไม่ตรง: `401 stale_token`
- handlers ตรวจโทเคนก่อนวิธี HTTP แล้วตรวจห้องก่อนอ่าน body ยกเว้น command ตรวจห้องใน `runCommand` หลังแปลง body แล้ว จึงตรวจลายเซ็นก่อนอ่านแต่ตรวจรอบภายหลัง
- POST ผิด Content-Type: `415 bad_content_type`; body เกิน: `413 too_large`; JSON พังหรือชนิด body ไม่ถูก: `400 bad_command`
- วิธี HTTP ที่ handler ไม่รับ: `405 method_not_allowed` พร้อม `Allow`; handlers รองรับ HEAD คู่กับ GET และตัด body แต่ไฟล์ Vercel ส่งออกเฉพาะ GET หรือ POST ตามตาราง แพลตฟอร์มเป็นผู้จัดการวิธีอื่น
- ปัญหาฐานข้อมูลหรือข้อผิดพลาดที่ handler ไม่รู้จัก: `502 store_failed`; การเขียนชนกันเกินรอบหรือเลข rev/epoch เต็ม: `503 busy`
- ตัวห่อ Vercel ที่ได้รับชื่อ handler ไม่รู้จัก: `404 not_found`; บนเครื่อง path ที่ไม่มีหรือไฟล์ไม่พบใช้รหัสนี้เช่นกัน ข้อผิดพลาด HTTP ชั้นนอกบนเครื่องใช้ `500 internal`

### คำสั่ง `POST /api/command`

| type | ฟิลด์เพิ่ม | สิทธิ์ | ผล |
|---|---|---|---|
| `enqueue` | `song` | แขก/เจ้าของ | เพิ่มท้ายคิว ถ้าไม่มี current เริ่มทันที |
| `enqueueNext` | `song` | แขก/เจ้าของ | เพิ่มหัวคิว ถ้าไม่มี current เริ่มทันที |
| `playNow` | `song` | แขก/เจ้าของ | เล่นทันที current เดิมลงประวัติ |
| `playFromQueue` | `qid` | แขก/เจ้าของ | ย้ายจากคิวมาเล่น |
| `remove` | `qid` | แขก/เจ้าของ | ลบเพลงจากคิว |
| `move` | `qid`, `delta` | แขก/เจ้าของ | ย้ายสัมพัทธ์ จำนวนเต็ม −50…50 ไม่ใช่ 0 |
| `moveTo` | `qid`, `beforeQid` | แขก/เจ้าของ | วางก่อน qid เป้าหมาย; `null` คือท้ายคิว |
| `moveToTop` | `qid` | แขก/เจ้าของ | ย้ายขึ้นหัวคิว |
| `advance` | `qid?`, `skipHistory?` | แขก/เจ้าของ | เล่นเพลงถัดไป; qid ไม่ตรง current ไม่ทำอะไร; skipHistory เป็น boolean |
| `clearQueue` | ไม่มี | เจ้าของ | ล้างคิวรอ |
| `clearHistory` | ไม่มี | เจ้าของ | ล้างประวัติ |
| `control` | `action`: `toggle` หรือ `restart` | แขก/เจ้าของ | เขียน `p.c` พร้อมเวลาปัจจุบัน |
| `report` | `playerState`: `playing`, `paused`, `buffering`, `idle` | เจ้าของ | เขียน `p.s` |
| `rotateGuest` | ไม่มี | เจ้าของ | เพิ่ม guestEpoch และเปลี่ยน PIN; หน้าเจ้าของโหลด QR/ลิงก์ใหม่ |
| `closeRoom` | ไม่มี | เจ้าของ | ลบห้อง usage และพยายามลบดัชนี PIN |

`qid` เป็น string ยาว 1–64 `song.id` ตรง `^[\w-]{11}$`; title trim แล้ว 1–300 ตัว
channel ตัด 100 ตัว `durationSec` จำนวนเต็ม 0–86400 อื่น ๆ ใช้ 0 สร้าง duration และ thumbnail ใหม่ฝั่งเซิร์ฟเวอร์
`by` trim แล้วตัด 20 ตัว ว่างไม่เก็บ คำสั่งผิดรูปตอบ `bad_command`
`enqueue` และ `enqueueNext` ตรวจคิวเต็มก่อนเพิ่ม `playNow` ไม่เพิ่มความยาวคิวจึงทำได้เมื่อคิวเต็ม
คำสั่งถูกแต่ไม่มีผลคืน rev เดิม ไม่ส่งเหตุการณ์คิวใหม่
`rotateGuest` เขียน epoch ก่อนเปลี่ยน PIN หากออก PIN ไม่สำเร็จจะพยายามถอน PIN ทั้งหมด ถ้าถอนไม่ได้ตอบ `503 busy` แม้ epoch เพิ่มแล้ว

### การจัดการ `POST /api/admin`

| action | ฟิลด์เพิ่ม | คำตอบ 200 |
|---|---|---|
| `create` | `name` | `{ roomId, ownerUrl }` |
| `list` | ไม่มี | `{ createEnabled, limits, rooms }` |
| `setCreate` | `enabled` เป็น boolean | `{ createEnabled }` |
| `delete` | `roomId` รูป id ห้อง | `{ ok: true }` แม้ไม่มีห้องอยู่แล้ว |
| `rotateOwner` | `roomId` รูป id ห้อง | `{ roomId, ownerUrl }` |

`rooms` แต่ละแถวมี `{ roomId, name, rev, queueLength, current, createdAt, updatedAt, pin }`
current เป็นชื่อเพลงหรือ `null`; limits มี `{ maxRooms, createsPerHour, idleHours, searchesPerHour }`
create ของผู้ดูแลข้ามสวิตช์และเพดานสร้างสาธารณะ rotateOwner เพิ่ม ownerEpoch และ rev ทำให้ลิงก์เจ้าของเดิมใช้ไม่ได้
สวิตช์ `setCreate` ล้างแคช config เฉพาะ instance ที่รับคำขอ instance อื่นอาจจำค่าเก่าได้ถึง 30 วินาที

## ช่องฟังและการรวมข้อมูล

ออนไลน์: `GET <db>/rooms/<roomId>.json` ไป Firebase โดยตรง ไม่ส่งโทเคนห้อง
บนเครื่อง: `GET /local-db/rooms/<roomId>.json` ไม่ต้องใช้โทเคนเช่นกัน
ไม่มี API ช่องฟังใน `api/` ตัวเซิร์ฟเวอร์บนเครื่องจำกัดพร้อมกัน 50 ช่อง เกินตอบ `503 too_many_streams`
ส่ง `put` แรกที่ path `/` แล้วส่ง `put` เมื่อ `q`, `p/s`, `p/c` เปลี่ยน
ทุก 25 วินาทีส่ง `keep-alive` ข้อมูล `null` ยังไม่จัดการ backpressure ของ `res.write`

`sync.js` ขอ config แล้วขอ room ก่อนเปิด EventSource:

- `put` มี `{ path, data }`: แทนค่าที่ path นั้น; `/` เป็น `null` คือห้องถูกลบ
- `patch` รวมคีย์ที่ path นั้น รองรับคีย์ที่มี `/` และลบคีย์เมื่อค่าเป็น `null` (`room-merge.js`) ไม่แก้วัตถุต้นทาง
- ถอด `q` แล้วใช้ `deserialize` จาก store สร้าง snapshot `{ rev, name, guestEpoch, ownerEpoch, current, queue, history, playerState }`
- `playerState` ใช้ `p.s` ที่เป็น playing/paused/buffering เมื่อมี current เท่านั้น นอกนั้นใช้ idle
- `onopen` ตั้งฐาน `p.c.t` ใหม่ ไม่ทำ control แรกย้อนหลัง ทำ action เฉพาะ t เปลี่ยนระหว่างที่ต่ออยู่
- `keep-alive` ไม่เปลี่ยน state; `cancel` และ `auth_revoked` จบด้วยสถานะ gone
- ข้อมูลห้องเป็น null → gone; epoch ต่างจากโทเคน → bad_key แล้วปิดช่องฟัง
- เริ่มต้น config ล้มเหลวหรือ EventSource ปิดถาวร ลองใหม่ที่ 1 วินาที เพิ่มเท่าตัวจน 15 วินาที; room info ล้มเหลวชั่วคราวเปิดช่องฟังต่อและลองโหลดข้อมูลห้องใหม่

สถานะที่หน้าเว็บแสดง:

| เงื่อนไข | จอหลัก `/` | มือถือ `/remote` |
|---|---|---|
| ไม่มีโทเคน | ฟอร์มสร้างห้อง; ถ้าปิดรับสร้างแสดงข้อความแทน | แบบกรอก PIN และคำแนะนำสแกน QR |
| online / offline | สถานะเชื่อมต่อ / กำลังต่อใหม่ | สถานะเชื่อมต่อ / กำลังต่อใหม่ |
| 401 หรือ epoch เปลี่ยน → bad_key | ลิงก์ใช้ไม่ได้ ลืมโทเคน หยุดตัวเล่น และมีทางสร้างห้องใหม่ | ขอ PIN หรือสแกน QR ใหม่ ลืมโทเคนและหยุดส่งคำสั่ง |
| 404 หรือห้องหาย → gone | ห้องถูกปิด หยุดตัวเล่น และมีทางสร้างห้องใหม่ | ห้องถูกปิด แสดงทางเข้าห้องใหม่ |

## ค้นหา ตัวเล่น และหน้าจอ

ค้นหา trim ยุบช่องว่าง ตัด 100 ตัวก่อนเติม “คาราโอเกะ ” หากไม่มีคำว่า “คาราโอเกะ” หรือ “karaoke” (ไม่สนตัวพิมพ์)
ผลสูงสุด 30 รายการ ไม่ซ้ำ id ตัดรายการไม่มีความยาว เช่น live มีฟิลด์ Song และ `views` ซึ่งอาจว่าง
แคชผลค้นหา 10 นาที สูงสุด 200 คำต่อ instance ยังไม่รวมคำค้นซ้ำที่กำลังรอคำตอบ
งบค้นหานับทุกคำขอที่ผ่านสิทธิ์ แม้ได้แคช q ว่าง หรือปิดค้นหาอยู่ ตัวนับล้มเหลวจะปล่อยค้นหาต่อ

ตรวจ embed รับ 1–30 id ไม่ซ้ำ รูป 11 ตัว อ่าน `previewPlayabilityStatus.status` จากหน้า YouTube embed
OK → true; สถานะอื่น → false; ไม่พบหรือดึงไม่ได้ → null
ดึงพร้อมกัน 6 หน้า timeout 5 วินาทีต่อหน้า อ่านไม่เกิน 1 MiB แคช true/false 6 ชั่วโมง สูงสุด 2000 id ต่อ instance
id เดียวกันที่กำลังตรวจใช้ promise ร่วมกัน แต่คิวงานรอตรวจยังไม่มีเพดาน ไม่มีงบตรวจ embed ต่อห้อง
หน้าเว็บตรวจหลังแสดงผล ไม่บล็อกผลค้นหา false แสดง “เล่นที่นี่ไม่ได้” และปิดปุ่มเพิ่ม; null ไม่แสดงป้าย

ใช้ YouTube IFrame Player API ไม่วางสิ่งใดทับ iframe Snapshot แรกใช้ cue เมื่อ current เปลี่ยนจึง load เพื่อเล่น
เพลงจบส่ง advance พร้อม qid เพลงที่ player แจ้ง error 2/5/100/101/150 ข้ามใน 2.5 วินาทีโดยไม่ลงประวัติ
ถ้าส่ง advance ล้มเหลวแบบเครือข่ายหรือชั่วคราว ลองใหม่ที่ 1, 2, 4, 8 วินาที แล้วทุก 8 วินาทีจนสำเร็จหรือเปลี่ยนเพลง/สิทธิ์
report รอค่าคงที่ 1 วินาทีและต่างจากที่ส่งล่าสุด มี timeout โหลดสคริปต์ YouTube 10 วินาที แต่ยังไม่มี timeout รอ player onReady

ลากคิวใช้ `drag-sort.js` ร่วมกัน เริ่มจากที่จับผ่าน Pointer Events ยกเลิกด้วย Escape/pointercancel
ปล่อยส่ง moveTo พร้อม qid ของแถวถัดไป หรือ null สำหรับท้าย ปุ่มคีย์บอร์ดขึ้นลงส่ง move แบบ delta
พักวาดคิวระหว่างลากแล้ววาดจาก state ล่าสุดหลังวาง หากคำสั่งล้มเหลววาดคืนจาก state
คำสั่งสำเร็จแต่ไม่มีผลไม่สร้าง stream event จึงยังเสี่ยง DOM ที่ขยับไว้ไม่ตรง state จนมีข้อมูลใหม่

CSS จอหลักใช้ฐานมือถือ ขยายเป็นสองส่วนเมื่อกว้างตั้งแต่ 900 และสูงตั้งแต่ 600 px
มีกรอบเตี้ยกว้างตั้งแต่ 700 และสูงไม่เกิน 599 px และ container queries ปรับเนื้อหา
กรอบสำหรับตรวจหน้าจอควรครอบคลุมมือถือ 390×844, แท็บเล็ต 768×1024, จอหลัก 1280×720 และจอเตี้ย 844×390
ตัวเลขกรอบตรวจเป็นแนวทาง QA ไม่ใช่ข้ออ้างว่าทดสอบเบราว์เซอร์แล้ว

## Security headers และ CSP สองชุด

`lib/security-headers.mjs` กับ `vercel.json` กำหนดชุดทั่วไปและชุด `/admin`, `/admin.html`
ทั้งสองชุดมี `X-Content-Type-Options: nosniff` และ `Referrer-Policy: strict-origin-when-cross-origin`

CSP ทั่วไป:

```text
default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com; img-src 'self' data: https://i.ytimg.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://*.firebasedatabase.app; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

CSP ผู้ดูแล:

```text
default-src 'self'; script-src 'self' https://www.gstatic.com https://apis.google.com; frame-src https://*.firebaseapp.com; img-src 'self' data: https://i.ytimg.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

ไฟล์เว็บรับ GET/HEAD `/` เป็น index, `/remote` และ `/admin` เป็น HTML ที่ตรงชื่อ บนเครื่องตรวจทั้ง path และ realpath ให้อยู่ใน public
รายละเอียดติดตั้ง env เพดาน และเครื่องมืออยู่ใน [README](../README.md) ความเสี่ยงคงเหลืออยู่ใน [REVIEW](REVIEW.md)
