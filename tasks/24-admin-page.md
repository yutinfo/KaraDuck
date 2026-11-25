# ใบงาน 24 — หน้าผู้ดูแล `/admin`
ผู้รับงาน: Codex · โมเดล: gpt-6.1-sol / high · sandbox: workspace-write

## เป้าหมาย
สร้างหน้าผู้ดูแลตาม `docs/specs/2026-11-25-public-rooms.md` ข้อ 1 และข้อ 5: ดูทุกห้อง ปิดห้อง ออกลิงก์เจ้าของใหม่ และเปิด/ปิดการรับสร้างห้อง
เปิดที่ `/admin` ได้ทั้งบน Vercel (`cleanUrls`) และเซิร์ฟเวอร์บนเครื่อง

## อ่านก่อนเริ่ม
1. `docs/specs/2026-11-25-public-rooms.md` (สัญญา `/api/admin` อยู่ข้อ 4) และ `lib/handlers.mjs` ส่วน `admin` เพื่อดูรูปคำตอบจริง
2. หน้าที่มีอยู่เป็นแนวทางภาพและโค้ด: `public/remote.html`, `public/remote.css`, `public/js/remote.js`, `public/tokens.css` (ชิ้นส่วน `.glass`, `.iris`, `.btn-neon`, `.btn-glass`, `.pill`, `.eyebrow`), โลโก้ `/logo.svg`
3. `lib/static.mjs` และ `server.mjs` (วิธีที่ `/remote` ถูกแมปไป `remote.html`)

## ขอบเขต
- สร้าง: `public/admin.html`, `public/admin.css`, `public/js/admin.js`, `public/js/admin-view.js` (ฟังก์ชันล้วนสำหรับจัดรูปข้อมูล), `test/admin-view.test.mjs`
- สร้าง: `lib/firebase-id-token.mjs`, `test/firebase-id-token.test.mjs`, `test/fixtures/idtoken-*.pem`
- แก้: `lib/static.mjs` (ให้ `/admin` เสิร์ฟ `admin.html`), `lib/handlers.mjs` (เฉพาะ `admin` และ `config`), `lib/vercel.mjs`, `lib/security-headers.mjs`, `server.mjs`, `vercel.json` และเทสต์ของไฟล์เหล่านี้
- **ห้ามแตะไฟล์อื่น** โดยเฉพาะ `public/js/app.js`, `public/index.html`, `public/styles.css`, `public/js/session.js`, `public/js/api.js` (มีคนอื่นแก้ขนานอยู่), `tokens.css`, `tools/`
- ห้ามเพิ่ม dependency · ห้ามใช้ `innerHTML` กับข้อมูลภายนอก (ชื่อห้องมาจากคนนอก ใช้ `textContent` เท่านั้น) · ห้ามใส่สไตล์หรือสคริปต์ฝังใน HTML · ทุกไฟล์โหลดจากโดเมนตัวเอง (มี Content-Security-Policy) ยกเว้นฟอนต์ Google แบบเดียวกับหน้าอื่น

## การยืนยันตัวผู้ดูแล (เปลี่ยนจากแบบเดิม: ต้องล็อกอินด้วย Google)
เจ้าของกำหนด: ส่วนผู้ดูแลต้องล็อกอิน และต้องเป็นบัญชี Google เดียวกับเจ้าของโปรเจกต์ Firebase (`karaduck-3935d`) ใช้ Firebase Authentication (ผู้ให้บริการ Google) ข้อเท็จจริงทั้งหมดในหัวข้อนี้ตรวจกับเอกสารทางการเมื่อ 25 พ.ย. 2026 แล้ว ให้ทำตามนี้ ไม่ต้องค้นใหม่

### ฝั่งเซิร์ฟเวอร์ (งานนี้แก้ `lib/handlers.mjs` ส่วน `admin` และ `config` ได้, `lib/vercel.mjs`, `lib/security-headers.mjs`, `server.mjs`, `vercel.json` และเทสต์ของไฟล์เหล่านี้)
- สร้าง `lib/firebase-id-token.mjs` + `test/firebase-id-token.test.mjs`:
  `createIdTokenVerifier({ projectId, fetchImpl = fetch, now = Date.now })` → `{ verify(token) → Promise<claims | null> }`
  - JWT สามส่วน หัว `alg` ต้องเป็น `RS256` และมี `kid`
  - กุญแจสาธารณะ: `GET https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com` (JSON แมป `kid` → ใบรับรอง PEM) ใช้ `new crypto.X509Certificate(pem).publicKey` · แคชตาม `max-age` ในหัว `Cache-Control` (ไม่มี → 1 ชั่วโมง) · `kid` ไม่อยู่ในแคช → ดึงใหม่ได้หนึ่งครั้ง (ไม่เกิน 1 ครั้งต่อ 60 วินาที) · หมดเวลา 5 วินาที
  - ตรวจลายเซ็นด้วย `crypto.createVerify('RSA-SHA256')` แล้วตรวจ: `aud === projectId` · `iss === 'https://securetoken.google.com/' + projectId` · `exp > now` · `iat <= now + 60` · `auth_time <= now + 60` · `sub` เป็นข้อความไม่ว่าง (หน่วยวินาที ยอมคลาดได้ 60 วินาทีเฉพาะสองข้อที่ระบุ)
  - ผิดข้อใดข้อหนึ่ง หรือดึงกุญแจไม่ได้ → คืน `null` (ไม่โยนข้อผิดพลาด)
- `createHandlers` รับเพิ่ม `adminEmails` (อาร์เรย์อีเมลตัวเล็ก) และ `verifyIdToken` (ฟังก์ชัน `token → claims|null`, ไม่ส่ง = ปิดทางนี้) · `admin` อนุญาตเมื่อ **อย่างใดอย่างหนึ่ง**:
  1. หัว `Authorization: Bearer` ตรงกับ `adminKey` (ทางเดิม สำหรับ `tools/room.mjs`) หรือ
  2. โทเคนผ่าน `verifyIdToken` และ `claims.email_verified === true` และ `claims.firebase?.sign_in_provider === 'google.com'` และ `claims.email` (แปลงเป็นตัวเล็ก) อยู่ใน `adminEmails`
  - ผ่านการตรวจโทเคนแต่อีเมลไม่อยู่ในรายชื่อ → `403 not_admin` · ไม่ผ่านทั้งสองทาง → `401 bad_admin_key` (คงรหัสเดิม) · ไม่มีทั้ง `adminKey` และ (`adminEmails` + `verifyIdToken`) → `503 admin_disabled`
  - ลำดับ: ตรวจสิทธิ์ก่อนอ่านเนื้อคำขอเหมือนเดิม
- `config` คืนเพิ่ม `firebase`: วัตถุ `{ apiKey, authDomain, projectId, appId }` หรือ `null` (ค่าเหล่านี้เป็นค่าสาธารณะตามเอกสาร Firebase)
- `lib/vercel.mjs` อ่าน env เพิ่ม (ไม่บังคับทั้งหมด ขาดแล้วทางล็อกอินปิดเฉย ๆ): `ADMIN_EMAILS` (คั่นด้วยจุลภาค ตัดช่องว่าง แปลงตัวเล็ก), `FIREBASE_WEB_CONFIG` (ข้อความ JSON ที่มีสี่คีย์ข้างบน; แปลงไม่ได้ → `null`), `FIREBASE_PROJECT_ID` (ไม่ตั้ง → ใช้ `projectId` จาก `FIREBASE_WEB_CONFIG`, ไม่มีอีก → ส่วนก่อน `.iam.gserviceaccount.com` หลัง `@` ของ `FIREBASE_CLIENT_EMAIL`)
- เซิร์ฟเวอร์บนเครื่อง (`server.mjs`): ไม่มี Firebase → `firebase: null`, ไม่มี `verifyIdToken`; ทางกุญแจยังใช้ได้
- **CSP แยกเฉพาะหน้าผู้ดูแล** (เอกสาร `/admin` และ `/admin.html` เท่านั้น หน้าอื่นใช้ค่าเดิมทุกตัวอักษร): จากค่าเดิม เปลี่ยนสามส่วน
  - `script-src 'self' https://www.gstatic.com https://apis.google.com`
  - `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com`
  - `frame-src https://*.firebaseapp.com`
  ส่งออกจาก `lib/security-headers.mjs` เป็น `ADMIN_SECURITY_HEADERS` และ `securityHeadersFor(pathname)` · `vercel.json`: กฎเดิมต้องไม่ครอบ `/admin` และ `/admin.html` (ใช้ `"/((?!admin$|admin\\.html$).*)"`) และเพิ่มกฎ `"/admin(\\.html)?"` ด้วยค่าของ `ADMIN_SECURITY_HEADERS` · ห้ามส่งหัว `Cross-Origin-Opener-Policy: same-origin` หรือ `Cross-Origin-Embedder-Policy` (ทำให้หน้าต่างล็อกอินพัง) · เทสต์: `vercel.json` ตรงกับค่าคงที่ทั้งสองชุด และรูปแบบ source จับเส้นทางถูก (`/`, `/remote`, `/js/admin.js` ได้ชุดปกติ; `/admin`, `/admin.html` ได้ชุดผู้ดูแล)
- เทสต์ของตัวตรวจโทเคน (สร้างคู่กุญแจและใบรับรองในเทสต์เองไม่ได้ง่าย ให้สอด `keyLoader` ภายในหรือทำ `fetchImpl` ปลอมที่คืน PEM ของใบรับรองที่สร้างด้วย `openssl` ไว้ล่วงหน้าเป็นไฟล์ `test/fixtures/idtoken-cert.pem` + `idtoken-key.pem` ซึ่งเป็นกุญแจทดสอบเท่านั้น): โทเคนถูกต้องผ่าน · ลายเซ็นผิด · `aud` ผิด · `iss` ผิด · หมดอายุ · `alg` เป็น `none` หรือ `HS256` · `kid` ไม่รู้จัก · `sub` ว่าง · ดึงกุญแจล้มเหลว → ทุกกรณีได้ `null` · แคชกุญแจตาม `max-age`
- เทสต์ของ `admin`: อีเมลในรายชื่อผ่าน · อีเมลนอกรายชื่อ → 403 `not_admin` · `email_verified` เป็น `false` → 403 · ผู้ให้บริการไม่ใช่ `google.com` → 403 · โทเคนมั่ว → 401 · ทางกุญแจเดิมยังผ่าน

### ฝั่งหน้าเว็บ
- `admin.js` เรียก `GET /api/config` ก่อน:
  - มี `firebase` → โหลด SDK แบบ ES module ด้วย `import()` จาก `https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js` และ `.../13.4.0/firebase-auth.js` แล้วใช้ `initializeApp(config.firebase)`, `getAuth`, `GoogleAuthProvider`, `signInWithPopup`, `onAuthStateChanged`, `getIdToken`, `signOut` · ปุ่ม "เข้าสู่ระบบด้วย Google" ต้องเรียก `signInWithPopup` ภายในตัวจัดการคลิกโดยตรง · ก่อนทุกคำขอเรียก `await getIdToken(user)` (ห้ามเก็บโทเคนเอง SDK ต่ออายุให้) แล้วส่ง `Authorization: Bearer <โทเคน>`
  - ล็อกอินแล้วแต่ `list` ตอบ `403 not_admin` → แสดง "บัญชี <อีเมล> ไม่มีสิทธิ์ผู้ดูแล" พร้อมปุ่ม "เปลี่ยนบัญชี" (`signOut`) · 401 → `signOut` แล้วกลับหน้าล็อกอิน
  - ข้อผิดพลาดของ `signInWithPopup`: `auth/popup-blocked` → "เบราว์เซอร์บล็อกหน้าต่างล็อกอิน อนุญาตป๊อปอัปแล้วลองใหม่" · `auth/popup-closed-by-user` หรือ `auth/cancelled-popup-request` → ไม่แจ้งอะไร · `auth/unauthorized-domain` → "โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase" · อื่น ๆ → "เข้าสู่ระบบไม่สำเร็จ"
  - โหลด SDK ไม่ได้ → "โหลดระบบล็อกอินไม่ได้ ลองรีเฟรช"
  - `firebase` เป็น `null` และ `mode === 'local'` → ใช้ช่องกุญแจแบบรหัสผ่าน (สำหรับพัฒนาบนเครื่อง): เก็บใน `sessionStorage` คีย์ `karaoke.admin` ส่งเป็น `Authorization: Bearer`
  - `firebase` เป็น `null` และ `mode === 'cloud'` → "ยังไม่ได้ตั้งค่าการล็อกอินของผู้ดูแล" ไม่มีช่องกุญแจ
- แถบบนแสดงอีเมลที่ล็อกอิน (`textContent`) และปุ่ม "ออกจากระบบ"

## พฤติกรรมของหน้าหลังเข้าได้
- เข้าได้เมื่อ `list` ตอบ 200 · 503 `admin_disabled`/`not_configured` → "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าผู้ดูแล"
- **หน้าหลัก:**
  - แถบบน: โลโก้ + "ผู้ดูแล", ป้ายจำนวนห้อง `N / <limits.maxRooms>`, ปุ่ม "รีเฟรช", อีเมลที่ล็อกอิน, ปุ่ม "ออกจากระบบ"
  - สวิตช์ "เปิดรับการสร้างห้อง" (`role="switch"`, `aria-checked`) → `setCreate` · ระหว่างรอปิดการกด · ล้มเหลวคืนค่าเดิมพร้อม toast
  - ฟอร์ม "สร้างห้อง (ไม่ติดเพดาน)": ช่องชื่อ `maxlength="40"` + ปุ่ม → `create` → แสดงลิงก์เจ้าของของห้องใหม่ในกล่องพร้อมปุ่ม "คัดลอก" และคำเตือน "ส่งลิงก์นี้ทางช่องทางส่วนตัวเท่านั้น"
  - รายการห้อง เรียงจาก `updatedAt` ล่าสุดก่อน (ห้องที่เป็น 0 อยู่ท้าย): ชื่อห้อง, `roomId` ตัวเล็กสีจาง, "คิว N เพลง", เพลงที่กำลังเล่น (ถ้ามี), "สร้างเมื่อ …" และ "ใช้ล่าสุด …" แบบเวลาสัมพัทธ์ (ค่า 0 → "ไม่ทราบ"), ป้าย `.pill.is-warn` "ใกล้หมดอายุ" เมื่อเหลืออายุน้อยกว่า 2 ชั่วโมงจาก `limits.idleHours`
  - ปุ่มต่อห้อง: "ออกลิงก์เจ้าของใหม่" (กดยืนยันสองจังหวะ; สำเร็จแล้วแสดงลิงก์ใหม่พร้อมปุ่มคัดลอก และข้อความว่าลิงก์เดิมใช้ไม่ได้แล้ว) และ "ปิดห้อง" (กดยืนยันสองจังหวะ; จังหวะสองค้าง 4 วินาทีแล้วคืนสภาพ) → `delete` แล้วโหลดรายการใหม่
  - ไม่มีห้อง → "ยังไม่มีห้อง"
  - โหลดรายการใหม่อัตโนมัติทุก 15 วินาทีเมื่อแท็บมองเห็น (`document.visibilityState`) หยุดเมื่อซ่อน
  - ข้อผิดพลาดเครือข่ายตอนโหลดรายการ → แถบแจ้ง "โหลดรายการไม่ได้ จะลองใหม่" โดยไม่ล้างรายการเดิม
- `admin-view.js` ส่งออก `sortRooms(rooms)`, `relativeTime(ms, now)` (คืน "ไม่ทราบ", "เมื่อครู่", "N นาทีที่แล้ว", "N ชั่วโมงที่แล้ว", "N วันที่แล้ว") และ `expiresSoon(room, limits, now)` พร้อมเทสต์ครอบทุกช่วง
- ใช้ได้ทั้งจอมือถือ (390×844) และจอใหญ่ (1280×800): คอลัมน์เดียว กว้างสุด 880px ไม่มีแถบเลื่อนแนวนอน ปุ่มสูงอย่างน้อย 44px
- ใช้คีย์บอร์ดได้ครบ และข้อความแจ้งผลใช้ `role="status"` หรือ `role="alert"`

## การตรวจ
- `node --check public/js/admin.js public/js/admin-view.js` (ทีละไฟล์) · `node --test test/admin-view.test.mjs test/server.test.mjs` ผ่าน
- `grep -n "innerHTML\|style=\"" public/admin.html public/js/admin.js` ไม่พบอะไร
- `node --test test/firebase-id-token.test.mjs test/handlers.test.mjs test/vercel.test.mjs test/public-rooms.test.mjs` ผ่าน
- sandbox เปิดพอร์ตไม่ได้: หัวหน้าทีมจะตรวจในเบราว์เซอร์เอง ระบุในรายงานว่าจุดไหนยังไม่ได้เห็นผลจริง

## ส่งมอบ (ตอบในข้อความสุดท้าย)
รายการไฟล์ที่สร้างและแก้ · คำสั่งที่รันพร้อมผลจริง · จุดที่ตัดสินใจเอง · สิ่งที่ยังไม่ได้ทำหรือไม่แน่ใจ · **ไม่ต้อง commit**
