# ติดตั้ง KaraDuck บน Vercel และ Firebase ของคุณเอง

KaraDuck ไม่มีเว็บกลางให้ใช้ คู่มือนี้ใช้บัญชีและทรัพยากรของคุณทั้งหมด
`https://<เว็บของคุณ>` หมายถึงที่อยู่ที่คุณได้หลังนำขึ้น Vercel เช่น `https://your-app.vercel.app`
ค่าที่มีคำว่า `your-project-id`, `YOUR_...` และอีเมลตัวอย่างด้านล่างต้องแทนด้วยค่าของคุณ
คำสั่งในคู่มือนี้ให้รันจากโฟลเดอร์โปรเจกต์ ยกเว้นที่ระบุเป็นอย่างอื่น

## 1. เตรียมบัญชีและเครื่องมือ

- บัญชี Google สำหรับ Firebase และบัญชี Vercel
- Vercel แผนฟรีใช้ได้สำหรับการใช้ส่วนตัวที่ไม่ใช่เชิงพาณิชย์ ตรวจเงื่อนไขและโควตาในบัญชีก่อนใช้จริง
- Node.js 22 ขึ้นไป (มี npm มาด้วย) และ Git ตรวจด้วย `node --version`, `npm --version`, `git --version`
- ติดตั้ง Vercel CLI และเข้าสู่ระบบตามคำแนะนำที่ปรากฏ:

```bash
npm i -g vercel
vercel login
```

## 2. ดึงโค้ดและทดสอบ

บน GitHub กด Fork เพื่อเก็บสำเนาไว้ในบัญชีของคุณ แล้วกด Code → HTTPS → คัดลอก URL
หรือคัดลอก URL ของต้นฉบับเพื่อ clone โดยตรง จากนั้นแทน URL ตัวอย่างในคำสั่งนี้:

```bash
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
npm test
```

โปรเจกต์ไม่มี dependency ให้ติดตั้งและไม่มีขั้น build ไม่ต้องรัน `npm install`
ผลทดสอบต้องไม่มีรายการ fail ก่อนทำต่อ

## 3. ลองบนเครื่องก่อน โดยไม่ต้องมี Firebase

```bash
node server.mjs
```

เปิดลิงก์เจ้าของที่โปรแกรมพิมพ์ออกมาในเทอร์มินัล ลิงก์นี้ให้สิทธิ์ควบคุมห้อง เก็บเป็นส่วนตัว
ครั้งแรกสร้างห้อง “บ้าน” และบันทึกข้อมูลใน `data/rooms.json` กับกุญแจใน `data/secrets.json`
รีสตาร์ตแล้วใช้ข้อมูลเดิม หยุดด้วย Ctrl+C
หน้าเว็บอยู่ที่ `http://localhost:8791` ส่วนมือถือของแขกต้องเชื่อมต่อถึงเครื่องนี้ได้ จึงใช้ที่อยู่เครือข่ายของเครื่องแทน localhost

ถ้าต้องการดูหน้าตาโดยไม่ใช้ห้องจริง เปิด `http://localhost:8791/?demo=1`
เลือกแท็บด้วย `&tab=results`, `&tab=queue`, `&tab=history`, `&tab=remote` และเพิ่ม `&idle=1` เพื่อดูจอว่าง
โหมดนี้ใช้สาธิตหน้าตา ไม่ใช่ห้องให้แขกเข้าร่วม

หากพอร์ตถูกใช้ หรืออยากแยกข้อมูลทดลอง:

```bash
PORT=8792 HOST=127.0.0.1 DATA_DIR=./data-dev node server.mjs
```

ตัวอย่างนี้รับการเชื่อมต่อจากเครื่องเดียว เปิด `http://localhost:8792` และเก็บข้อมูลใน `data-dev`

## 4. สร้าง Firebase

1. เข้า Firebase Console ด้วยบัญชี Google เลือก Add project ตั้งชื่อโปรเจกต์ แล้วสร้างจนเสร็จ จด Project ID จาก Project settings → General (ตัวอย่าง `your-project-id`)
2. ไป Build → Realtime Database → Create database เลือกที่ตั้งใกล้ผู้ใช้ เช่น สิงคโปร์ (`asia-southeast1`) **ที่ตั้งฐานข้อมูลเลือกแล้วเปลี่ยนไม่ได้** เลือกเริ่มแบบ locked mode แล้วสร้าง
3. คัดลอก URL ที่แสดงบนหน้าฐานข้อมูล เช่น `https://your-project-id-default-rtdb.asia-southeast1.firebasedatabase.app` อย่าเดาจากชื่อโปรเจกต์ เพราะ URL อาจต่างกันตามที่ตั้ง
4. เปิดแท็บ Rules แทนเนื้อหาด้วยกฎจาก [database.rules.json](../database.rules.json) แล้วกด Publish:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "rooms": {
      "$room": {
        ".read": true
      }
    }
  }
}
```

กฎนี้ปิดการอ่านและเขียนสาธารณะที่ราก แต่เปิดให้อ่านห้องรายตัวเมื่อรู้รหัสห้อง การเขียนผ่านบัญชีบริการฝั่งเซิร์ฟเวอร์เท่านั้น รายชื่อห้อง `/meta` และ `/usage` ไม่เปิดอ่านสาธารณะ
ผู้รู้รหัสห้องยังอ่านข้อมูลเพลงและชื่อคนขอได้ จึงไม่ควรใส่ข้อมูลส่วนตัว

5. ไป Build → Authentication → Get started → Sign-in method → Google เปิด Enable เลือกอีเมลติดต่อ แล้ว Save
6. ที่ Authentication → Settings → Authorized domains เพิ่มโดเมนเว็บของคุณโดยไม่ใส่ `https://` หรือเส้นทาง เช่น `your-app.vercel.app` หากยังไม่มีโดเมน ให้กลับมาทำหลังขั้น 5 และก่อนทดสอบล็อกอิน เพิ่ม `localhost` ด้วยถ้าจะพัฒนาการล็อกอินบนเครื่อง โดเมน preview หรือโดเมนใหม่ต้องเพิ่มแยก
7. ไป Project settings → General → Your apps → ไอคอนเว็บ `</>` ตั้งชื่อแล้ว Register app ไม่ต้องเปิด Firebase Hosting คัดลอก 4 ค่าจาก `firebaseConfig`: `apiKey`, `authDomain`, `projectId`, `appId` ไม่ต้องติดตั้ง SDK เพิ่มในโปรเจกต์
8. ไป Project settings → Service accounts → Firebase Admin SDK → Generate new private key → Generate key เก็บไฟล์ JSON ไว้นอกโฟลเดอร์ repo เช่นในโฟลเดอร์ส่วนตัว ใช้บัญชีบริการที่มีสิทธิ์อ่านเขียน Realtime Database ของโปรเจกต์นี้

**ไฟล์กุญแจเป็นความลับ ห้าม commit ห้ามส่งให้ผู้อื่น และควรลบไฟล์จากเครื่องหลังตั้งค่าเสร็จ** หากรั่วให้เพิกถอนกุญแจในบัญชีบริการแล้วสร้างใหม่ ส่วน web config เป็นข้อมูลสำหรับหน้าเว็บ ไม่ใช่กุญแจบัญชีบริการ

## 5. ผูก Vercel และตั้งตัวแปรแวดล้อม

รันในโฟลเดอร์ repo:

```bash
vercel link
```

เลือกบัญชีหรือทีมของคุณ เลือกสร้างโปรเจกต์ใหม่และตั้งชื่อที่ว่าง หรือเลือกโปรเจกต์ของคุณที่มีอยู่แล้ว
อีกทางหนึ่งใช้ `vercel project add YOUR_PROJECT_NAME` แล้ว `vercel link` เลือกโปรเจกต์นั้น
ไฟล์ตั้งค่า [vercel.json](../vercel.json) กำหนด `public` เป็นเว็บ ไม่มี build และใช้ฟังก์ชันที่สิงคโปร์ (`sin1`) จำกัดเวลา 15 วินาที ไม่ต้องใช้ Firebase Hosting

ตัวแปรทั้งหมดที่ [lib/vercel.mjs](../lib/vercel.mjs) อ่านมีดังนี้ ตั้งใน Environment: **Production**:

| ชื่อ | บังคับหรือไม่ | ความหมาย | ได้ค่าจากไหน |
|---|---|---|---|
| `FIREBASE_DB_URL` | บังคับ | URL Realtime Database | ขั้น 4 หน้าฐานข้อมูล |
| `FIREBASE_CLIENT_EMAIL` | บังคับ | บัญชีบริการ เช่น `firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com` | `client_email` ในไฟล์กุญแจ |
| `FIREBASE_PRIVATE_KEY` | บังคับ | กุญแจส่วนตัว รองรับขึ้นบรรทัดใหม่และ `\n` | `private_key` ในไฟล์กุญแจ |
| `ROOM_SECRET` | บังคับ | ความลับเซ็นสิทธิ์เจ้าของและแขก ใช้ค่าเดิมในการ deploy ครั้งต่อไป | สุ่มตามคำสั่งด้านล่าง |
| `ADMIN_KEY` | ไม่บังคับถ้าใช้ Google อย่างเดียว | กุญแจผู้ดูแลสำหรับ `tools/room.mjs` | สุ่มเอง หากต้องการใช้ CLI |
| `PUBLIC_ORIGIN` | ไม่บังคับ แต่ควรตั้ง | ฐาน URL สร้างลิงก์ ถ้าเว้นใช้ HTTPS กับ Host ของคำขอ | โดเมน Production ของคุณ เช่น `https://your-app.vercel.app` |
| `FIREBASE_WEB_CONFIG` | จำเป็นสำหรับ Google login บนเว็บ | JSON บรรทัดเดียว มี 4 ค่า | web app ในขั้น 4 |
| `ADMIN_EMAILS` | จำเป็นสำหรับผู้ดูแลผ่าน Google | อีเมล Google ที่อนุญาต คั่นด้วยจุลภาค เช่น `you@example.com,other@example.com` ตัดช่องว่างและเทียบตัวพิมพ์เล็ก | บัญชีผู้ดูแลที่คุณเลือก |
| `FIREBASE_PROJECT_ID` | ไม่บังคับถ้าอนุมานได้ | โปรเจกต์สำหรับตรวจ ID token ใช้ค่านี้ก่อน จากนั้น `projectId` ใน web config แล้วจึงอนุมานจากบัญชีบริการ | Project settings → General |
| `SEARCH_DISABLED` | ไม่บังคับ | ค่า `1` ปิดค้นหาและตรวจเพลงฉุกเฉิน | ผู้ติดตั้งเลือก ปกติไม่ต้องตั้ง |
| `CREATE_DISABLED` | ไม่บังคับ | ค่า `1` บังคับปิดสร้างห้องสาธารณะ แม้ผู้ดูแลเปิดสวิตช์ | ผู้ติดตั้งเลือก ปกติไม่ต้องตั้ง |

ตัวอย่างต่อไปนี้ส่งค่าผ่าน pipe โดยไม่พิมพ์ค่าความลับบนจอ อย่าเปิด shell tracing (`set -x`)
แทน `/ABSOLUTE/PATH/service-account.json` ด้วยพาธเต็มของไฟล์ที่ดาวน์โหลด (คงเครื่องหมายคำพูดไว้หากมีช่องว่าง):

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | vercel env add ROOM_SECRET production
node -e "process.stdout.write(require(process.argv[1]).client_email)" "/ABSOLUTE/PATH/service-account.json" | vercel env add FIREBASE_CLIENT_EMAIL production
node -e "process.stdout.write(JSON.stringify(require(process.argv[1]).private_key).slice(1,-1))" "/ABSOLUTE/PATH/service-account.json" | vercel env add FIREBASE_PRIVATE_KEY production
```

คำสั่งกุญแจส่วนตัวแปลงการขึ้นบรรทัดใหม่เป็น `\n` จึงส่งเป็นบรรทัดเดียว โค้ดรองรับรูปแบบนี้
สำหรับ URL และอีเมล ใช้คำสั่งนี้แล้ววางค่าที่พรอมต์ทีละตัว:

```bash
vercel env add FIREBASE_DB_URL production
vercel env add PUBLIC_ORIGIN production
vercel env add ADMIN_EMAILS production
vercel env add FIREBASE_WEB_CONFIG production
```

เมื่อถาม `FIREBASE_WEB_CONFIG` ให้วาง JSON บรรทัดเดียวแทนค่าตัวอย่างทั้งสี่จากขั้น 4:

```json
{"apiKey":"YOUR_WEB_API_KEY","authDomain":"your-project-id.firebaseapp.com","projectId":"your-project-id","appId":"YOUR_WEB_APP_ID"}
```

อย่าวางตัวแปร JavaScript `const firebaseConfig =` หรือค่าอื่นจากไฟล์กุญแจลงไป
`FIREBASE_PROJECT_ID` ปกติเว้นได้ถ้า web config ถูกต้อง ถ้าต้องระบุให้ใช้ `vercel env add FIREBASE_PROJECT_ID production`
ตัวแปรสวิตช์ก็เพิ่มด้วย `vercel env add SEARCH_DISABLED production` หรือ `vercel env add CREATE_DISABLED production` แล้วกรอก `1` เมื่อต้องการปิด
หากเปลี่ยนค่าที่มีอยู่ ใช้หน้า Vercel → โปรเจกต์ของคุณ → Settings → Environment Variables → แก้ค่าใน Production แล้ว deploy ใหม่

หากต้องใช้เครื่องมือจัดการห้องในเทอร์มินัล ให้สุ่ม `ADMIN_KEY` เพิ่ม:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | vercel env add ADMIN_KEY production
```

หากต้องใช้ค่ากุญแจที่สุ่มผ่าน pipe ข้างบน ให้ดูค่าจาก Vercel → Settings → Environment Variables → `ADMIN_KEY` และเก็บในที่เก็บความลับส่วนตัว อย่าใส่ในไฟล์ที่ commit
ตั้งค่าใน zsh โดยพิมพ์คำสั่งต่อไปนี้ แล้ววางกุญแจเมื่อถาม (ซ่อนการพิมพ์ และไม่บันทึกตัวกุญแจลงประวัติคำสั่ง):

```bash
read -rs "KARAOKE_ADMIN_KEY?ADMIN_KEY: "
export KARAOKE_ADMIN_KEY
```

จากนั้นเรียกเครื่องมือ:

```bash
node tools/room.mjs list --url https://your-app.vercel.app
node tools/room.mjs create "ห้องทดสอบ" --url https://your-app.vercel.app
node tools/room.mjs rotate-owner '<roomId>' --url https://your-app.vercel.app
node tools/room.mjs delete '<roomId>' --url https://your-app.vercel.app
```

แทน `<roomId>` ด้วยรหัสจาก list; delete ลบห้องและกู้คืนไม่ได้ ผลสร้างห้องและออกลิงก์ใหม่มีลิงก์เจ้าของ เก็บเป็นส่วนตัว
CLI ใช้ `KARAOKE_ADMIN_KEY` ไม่ได้ใช้ Google login ของเบราว์เซอร์ ไม่ระบุ `--url` ใช้ `KARAOKE_URL` หรือ `PUBLIC_ORIGIN` ได้
บนเครื่องใช้ `node tools/room.mjs list --local` ซึ่งอ่านกุญแจจาก `data/secrets.json` เสมอ ไม่อ่าน `DATA_DIR`
ถ้าใช้โฟลเดอร์อื่น ให้ตั้ง `KARAOKE_ADMIN_KEY` แล้วระบุ `--url` เอง

`node tools/setup.mjs` เป็นทางเลือกสำหรับพิมพ์กุญแจสุ่มและคำแนะนำตัวแปรครบทั้ง 11 ตัว สคริปต์ไม่บันทึกไฟล์หรือเรียกเครือข่าย แต่ผลลัพธ์มีความลับ อย่าเผยแพร่หรือแนบในรายงาน

## 6. นำขึ้นและตรวจการติดตั้ง

```bash
vercel deploy --prod
```

จดโดเมน Production ที่ Vercel แสดง ตั้ง `PUBLIC_ORIGIN` ให้ตรง และเพิ่มโดเมนใน Firebase Authorized domains ตามขั้น 4
**หลังเพิ่มหรือแก้ตัวแปรแวดล้อมทุกครั้งต้อง deploy ใหม่** ด้วยคำสั่งเดิม รวมถึงเมื่อเพิ่งรู้โดเมนแล้วตั้ง `PUBLIC_ORIGIN`

เปิด `https://<เว็บของคุณ>/api/config` ต้องเห็น `"mode":"cloud"` และ `"createEnabled":true` ใน JSON
ถ้าเห็น `503` พร้อม `not_configured` แปลว่าตัวแปรบังคับอย่างน้อยหนึ่งตัวยังว่างหรือขาด ตรวจทั้งสี่ตัวในตาราง

การเห็น `mode: cloud` อย่างเดียว **ยังไม่ยืนยันว่าฐานข้อมูลใช้ได้**: ถ้าอ่านข้อมูลควบคุมไม่ได้ โค้ดยังตอบสำเร็จแต่ให้ `createEnabled: false`
ค่านี้ยังเกิดได้เมื่อปิดสวิตช์รับห้องหรือกำหนด `CREATE_DISABLED=1` จึงต้องตรวจการสร้างห้องจริงในขั้นถัดไป

## 7. ใช้งานครั้งแรก

1. เปิด `https://<เว็บของคุณ>` ใส่ชื่อห้องแล้วกด `สร้างห้อง` เครื่องนี้จะเป็นจอหลัก
2. เปิดแท็บ `มือถือ` ทดสอบ QR หรือลิงก์แขกจากมือถือ และลองเข้า `https://<เว็บของคุณ>/remote` ด้วยรหัส 6 หลัก ค้นหาและเพิ่มเพลง แล้วกดเล่นครั้งแรกบนจอหลักถ้าจำเป็น
3. เปิด `https://<เว็บของคุณ>/admin` ล็อกอิน Google ด้วยอีเมลที่อยู่ใน `ADMIN_EMAILS` ต้องเห็นห้องที่สร้างไว้ ลองเปิด/ปิดรับสร้างห้องแล้วเปิดกลับ ตรวจว่าห้องเดิมยังใช้งานได้
4. อ่าน [คู่มือการใช้งาน](MANUAL.md) สำหรับจัดคิว เปลี่ยนรหัสแขก ปิดห้อง และออกลิงก์เจ้าของใหม่ และตรวจรายการใน [REVIEW](REVIEW.md) ก่อนเปิดให้ผู้อื่นใช้

## 8. ป้องกันการใช้เกิน

เพดานต่อไปนี้อยู่ใน [lib/limits.mjs](../lib/limits.mjs) แก้ค่าในไฟล์นี้แล้ว deploy ใหม่ได้:

| ค่าคงที่ | ค่าเริ่มต้น | ผลเมื่อถึงเพดาน |
|---|---|---|
| `MAX_ROOMS` | 30 ห้องพร้อมกัน | สร้างสาธารณะได้ `503 rooms_full` |
| `CREATES_PER_HOUR` | 20 ครั้งต่อชั่วโมงนาฬิกา รวมเว็บ | `429 too_many_rooms` |
| `IDLE_MS` | 24 ชั่วโมงหลังเขียนข้อมูลคิวล่าสุด | ลบห้องตอนสร้างสาธารณะหรือผู้ดูแลดูรายการ ไม่ใช่งานตามเวลา |
| `SEARCHES_PER_HOUR` | 120 คำขอต่อห้องต่อชั่วโมงนาฬิกา | `429 search_budget` |
| `JOIN_FAILS_PER_MINUTE` | ใส่ PIN ผิด 30 ครั้งต่อนาทีนาฬิกา รวมเว็บ | หลังถึงเพดาน join ทั้งหมดได้ `429 too_many_attempts` จนเปลี่ยนนาที; QR และลิงก์ยังใช้ได้ |

การค้นหาและรายงานการเล่นไม่ต่ออายุห้อง มีเพียงคำสั่งเขียนข้อมูลคิว (`q`) เท่านั้น ห้องเก่าที่ `updatedAt` เป็น 0 ยังไม่ถูกลบอัตโนมัติ
ผู้ดูแลสร้างห้องได้โดยข้ามเพดานจำนวนห้องและความถี่ คิวรอสูงสุด 200 เพลง ประวัติ 30 เพลง กำหนดแยกใน [public/js/store.js](../public/js/store.js)

หน้า `/admin` มีสวิตช์ปิดรับการสร้างห้อง ปิดแล้วห้องเดิมยังใช้งานได้ ส่วน `CREATE_DISABLED=1` บังคับปิดแม้ผู้ดูแลเปิดสวิตช์
ใช้ `SEARCH_DISABLED=1` เพื่อปิดค้นหาและตรวจเพลงฉุกเฉิน ทั้งสองตัวต้อง deploy ใหม่หลังเปลี่ยน

ตั้งกฎ rate limit เพิ่มใน Vercel Dashboard → โปรเจกต์ของคุณ → Firewall สำหรับเส้นทาง `/api/*` โดยจำกัดตาม IP
เริ่มจากเพดานที่รองรับจำนวนคนใช้งานจริง ทดสอบทั้งสร้างห้อง เข้า PIN และค้นหา ปรับตามบันทึกการใช้งานและความสามารถของแผนบัญชี
โค้ดไม่ได้จำกัดราย IP และเพดานในแอปไม่ทดแทน Firewall หรือโควตาของผู้ให้บริการ
ติดตามการใช้ฟังก์ชันและทราฟฟิกใน Vercel รวมถึงการเชื่อมต่อ พื้นที่ และข้อมูลที่ดาวน์โหลดใน Firebase เป็นระยะ

## 9. ข้อจำกัดและความรับผิดชอบของผู้ติดตั้ง

การค้นหาใช้ช่องทาง InnerTube และการตรวจเพลงอ่านหน้า embed ซึ่งเป็นช่องทางที่ไม่เป็นทางการของ YouTube อาจหยุดทำงานหรือถูกจำกัด IP ได้ทุกเมื่อ
วิดีโอเล่นผ่านตัวเล่นแบบฝังของ YouTube (IFrame Player API) อาจมีโฆษณา บางเพลงไม่ให้ฝัง และผลตรวจล่วงหน้าไม่รับประกันว่าจะเล่นได้ทุกเครื่อง
ไม่มีความสามารถปรับคีย์ ตัดเสียงร้อง หรือให้คะแนน

ผู้ติดตั้งต้องตรวจข้อตกลงการใช้บริการของ YouTube, Vercel และ Firebase รวมถึงลิขสิทธิ์การเล่นเพลงด้วยตัวเอง โดยเฉพาะเมื่อเปิดให้คนนอกใช้หรือใช้เชิงพาณิชย์
แผนฟรีมีโควตาและข้อจำกัดของตัวเอง อาจต้องเปลี่ยนแผนหรือหยุดให้บริการเมื่อใช้เกิน ตรวจข้อมูลในบัญชีของคุณก่อนเปิดใช้งานและติดตามต่อเนื่อง

## 10. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่ควรตรวจ | วิธีแก้ |
|---|---|---|
| `503 not_configured` | ตัวแปรบังคับขาดหรือว่าง หรือตั้งผิด environment | ตรวจ `FIREBASE_DB_URL`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `ROOM_SECRET` ใน Production แล้ว deploy ใหม่ |
| `502 store_failed` ตอนสร้างห้องหรือจัดการห้อง | กุญแจบัญชีบริการผิด ถูกเพิกถอน ไม่มีสิทธิ์ หรือ URL ฐานข้อมูลผิด | ใช้ไฟล์กุญแจของโปรเจกต์เดียวกัน ตรวจ `client_email`, `private_key` และ URL จากหน้าฐานข้อมูล ตั้งใหม่แล้ว deploy อย่าแสดงกุญแจใน log |
| หน้าเว็บขึ้นออฟไลน์ตลอด | ยังไม่ได้ Publish กฎฐานข้อมูล หรือ URL/การเชื่อมต่อผิด | วางกฎขั้น 4 แล้ว Publish ตรวจ URL และอินเทอร์เน็ต อย่าเปิดเขียนสาธารณะเพื่อแก้ปัญหา |
| ล็อกอินขึ้น `auth/unauthorized-domain` | โดเมนปัจจุบันไม่อยู่ใน Firebase Authorized domains | เพิ่มชื่อโดเมนที่กำลังเปิดใน Authentication → Settings → Authorized domains แล้วลองใหม่ |
| ล็อกอินได้แต่ขึ้นไม่มีสิทธิ์ (`not_admin`) | อีเมล Google ไม่อยู่ใน `ADMIN_EMAILS` | เพิ่มอีเมลที่ใช้จริง คั่นรายการด้วยจุลภาค แล้ว deploy ใหม่ |
| ค้นหาไม่ได้ | YouTube จำกัดหรือเปลี่ยนช่องทาง, `SEARCH_DISABLED=1` หรือเกินงบห้อง | ถ้า `search_disabled` ให้แก้สวิตช์แล้ว deploy; ถ้า `search_budget` รอชั่วโมงถัดไป; ถ้า `upstream_failed` ตรวจการจำกัดจาก YouTube หรือลองรันบนเครื่อง |
| `mode: cloud` แต่ `createEnabled: false` | สวิตช์ปิดรับห้อง, `CREATE_DISABLED=1` หรืออ่านข้อมูลควบคุมจากฐานข้อมูลไม่ได้ | ตรวจสวิตช์ใน `/admin` ตรวจ env และกุญแจ/URL ฐานข้อมูล การแคชสถานะอาจใช้เวลาถึง 30 วินาที |
| หน้า admin ไม่พร้อมใช้ (`admin_disabled`) หรือไม่มี Google login | ไม่ได้ตั้ง Google admin ครบ และไม่มี `ADMIN_KEY` | ตรวจ `ADMIN_EMAILS`, `FIREBASE_WEB_CONFIG` ทั้งสี่ค่า และ project id ที่ใช้ตรวจ token แล้ว deploy ใหม่ |

รายละเอียดสัญญา API และการรักษาสิทธิ์อยู่ใน [DESIGN](DESIGN.md)
