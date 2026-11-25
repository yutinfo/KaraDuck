import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function run({ log = console.log } = {}) {
  log('คัดลอกค่าต่อไปนี้เก็บไว้เป็นส่วนตัว สคริปต์นี้ไม่บันทึกไฟล์หรือเรียกเครือข่าย:');
  log(`ROOM_SECRET=${randomBytes(32).toString('base64url')}`);
  log(`ADMIN_KEY=${randomBytes(24).toString('base64url')}`);
  log('รันคำสั่งต่อไปนี้เอง แล้วใส่ค่าที่พรอมต์ของ Vercel:');
  for (const name of ['ROOM_SECRET', 'ADMIN_KEY', 'FIREBASE_DB_URL', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
    'PUBLIC_ORIGIN', 'SEARCH_DISABLED', 'CREATE_DISABLED', 'ADMIN_EMAILS', 'FIREBASE_WEB_CONFIG', 'FIREBASE_PROJECT_ID']) {
    log(`vercel env add ${name} production`);
  }
  log('ROOM_SECRET (บังคับ): ความลับเซ็นโทเคนห้อง ใช้ค่าที่สุ่มด้านบน');
  log('ADMIN_KEY (ไม่บังคับ): กุญแจผู้ดูแลสำหรับ CLI; ใช้ Google อย่างเดียวไม่ต้องตั้ง');
  log('FIREBASE_DB_URL (บังคับ): URL ของ Realtime Database จาก Firebase console');
  log('FIREBASE_CLIENT_EMAIL (บังคับ): ค่า client_email จากไฟล์กุญแจบัญชีบริการ');
  log('FIREBASE_PRIVATE_KEY (บังคับ): ค่า private_key จากไฟล์กุญแจบัญชีบริการ (รองรับทั้งขึ้นบรรทัดใหม่และ \\n)');
  log('ADMIN_EMAILS (จำเป็นสำหรับผู้ดูแลผ่าน Google): อีเมลที่อนุญาต คั่นด้วยจุลภาค');
  log('FIREBASE_WEB_CONFIG (จำเป็นสำหรับ Google login บนเว็บ): JSON มี apiKey, authDomain, projectId, appId');
  log('FIREBASE_PROJECT_ID (ไม่บังคับ): project id ตรวจ ID token; ถ้าไม่ตั้งใช้ Web config หรืออนุมานจากอีเมลบัญชีบริการ');
  log('เผยแพร่กฎจาก database.rules.json ไปยัง Realtime Database ด้วยตนเอง');
  log('PUBLIC_ORIGIN (ไม่บังคับ): โดเมนเว็บจริง เช่น https://karaoke.example');
  log('SEARCH_DISABLED=1 (ไม่บังคับ): ปิดค้นหาและตรวจเพลงฉุกเฉิน');
  log('CREATE_DISABLED=1 (ไม่บังคับ): ปิดรับสร้างห้องสาธารณะ');
  log('จัดการห้อง: ตั้ง KARAOKE_ADMIN_KEY เป็นค่า ADMIN_KEY แล้วใช้ node tools/room.mjs create "ชื่อบ้าน" --url https://โดเมนเว็บ');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
