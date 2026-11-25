# KaraDuck — ใบงาน 20

สร้างด้วย built-in `image_gen` เมื่อ 2026-11-25 จำนวน 4 calls แบบละ 1 ครั้ง ไม่มีการสร้างซ้ำ
ไม่พบ AGENTS.md ในโปรเจกต์ โฟลเดอร์ tasks หรือไดเรกทอรีแม่ที่ตรวจ
อ่านธีมจาก `public/tokens.css` และ `docs/mockups/glass.html` โดยไม่แก้ไฟล์เหล่านั้น

## ไฟล์ส่งมอบ

| ภาพเต็ม (1024×1024) | bytes | ภาพย่อ (128×128) | bytes | สิ่งที่เห็นจริง |
| --- | ---: | --- | ---: | --- |
| duck-1-neon-line.png | 349597 | duck-1-neon-line-128.png | 11893 | หัวเป็ดด้านข้างเส้นทอง ปากอ้า ตาโค้งชมพู ร้องใส่ไมค์ฟ้า มีเส้นเสียงชมพูและม่วง |
| duck-2-mascot.png | 462211 | duck-2-mascot-128.png | 12871 | เป็ดทองตัวกลมทั้งตัว ตาปิด ปากอ้า ถือไมค์ฟ้า อีกปีกยกขึ้น มีขอบเรืองชมพูม่วงฟ้า |
| duck-3-minimal.png | 269909 | duck-3-minimal-128.png | 8718 | เป็ดด้านข้างไล่ชมพูถึงม่วง ปากทองอ้า ลำตัวเชื่อมเป็นก้านและหัวโน้ตเดียวกัน |
| duck-4-app-icon.png | 603819 | duck-4-app-icon-128.png | 16777 | กระจกสี่เหลี่ยมมุมมนขอบสีรุ้ง หน้าเป็ดตรงปากอ้า พร้อมโน้ตฟ้าและชมพูสองตัว |

ทุกไฟล์เป็น PNG ทึบ ไม่มี alpha channel ไม่ได้เลือกแบบใดเป็นโลโก้จริงของแอป
ไม่มีภาพที่ยังต้องสร้างใหม่ตามการตรวจครั้งนี้ มาสคอตและไอคอนมีการไล่เฉดอ่อนในพื้นที่สี แต่ยังเป็นกราฟิกแบน ไม่มีมิติแบบภาพ 3D สมจริง

## Prompt set

ข้อกำหนดร่วมที่ใช้ในทุก prompt: `Use case: logo-brand`, one square 1024×1024 PNG for a family karaoke app; no text, letters, numbers, wordmark, watermark or existing character resemblance; opaque uniform #06050c background; original joyful singing duck with an open bill; bold simple clean flat vector shapes readable at 64px; centered inside approximately 76% of canvas with about 12% empty margin; no photo, realistic 3D, room or stage.

1. **Neon line:** Minimal neon tube line drawing of an original duck head in side profile, open beak singing into a separate simple handheld microphone; friendly closed curved eye; few bold continuous strokes; gold #ffd166 head and bill, cyan #33e1ff microphone, pink #ff3d9a and violet #8b5cf6 accents; restrained soft glow immediately around strokes; no border.
2. **Mascot:** Original cute full-body round golden duck singing happily, open broad bill, eyes closed in smiling arcs, one wing holding a simple cyan microphone close to its mouth, second wing expressing joy; gold #ffd166 body, orange-gold bill and two feet, subtle pink/violet/cyan edge glow; no costume, hat, clothes, rubber-duck toy styling or decorative specks.
3. **Minimal:** A few bold geometric shapes form a clearly recognizable side-profile singing duck; rounded head and curved body with pink #e11d74 to purple #7c3aed gradient; small gold #ffd166 open bill formed by two simple wedges separated by dark mouth; simple curved closed eye; seamlessly combine duck body/neck with one musical eighth-note stem and rounded note head into one unified mark; duck first, music second; no floating decorations, neon tubes, full mascot with legs or border.
4. **App icon:** Rounded-square dark glass tile with a subtle translucent curved highlight; crisp continuous border gradient cyan #33e1ff → violet #8b5cf6 → pink #ff3d9a → gold #ffd166; large original front-facing gold duck face, joyful closed eyes, open broad bill singing, dark mouth with small pink tongue; no body; exactly two large simple eighth notes beside face inside tile, one cyan and one pink; ample separation; no tiny decorations, clothes or hat.

## การจัดเตรียมไฟล์และผลตรวจจริง

เครื่องมือส่งภาพต้นฉบับเป็น 1254×1254 แม้ระบุ 1024×1024 จึงจัดเตรียมด้วย Swift/CoreGraphics: แก้ noise สีเกือบดำให้เป็นพื้น #06050c โดยเก็บสีโลโก้และแสงหลักไว้ ย่อและจัดกึ่งกลางให้ส่วนภาพหลักกินพื้นที่ประมาณ 76% แล้วส่งออก RGB PNG 1024×1024

คำสั่งที่รัน:

- `pwd`, `rg --files ...`, อ่าน AGENTS.md ที่อาจมีในไดเรกทอรีแม่, `cat tasks/20-logo-images.md`, `cat package.json`, อ่าน tokens และ mockup, `git status --short`
- `python3` ตรวจภาพด้วย Pillow — ครั้งแรกไม่สำเร็จเพราะไม่มี PIL; ไม่ติดตั้ง dependency เพิ่ม ใช้ Python standard library อ่าน PNG header แทน แล้วใช้ CoreGraphics ตรวจไฟล์สุดท้าย
- `sips -g pixelWidth -g pixelHeight -g format -g hasAlpha <generated-images>/*.png`
- `CLANG_MODULE_CACHE_PATH=/private/tmp/karaduck-clang-cache swift /private/tmp/karaduck-prepare.swift` — exit 0 สร้างภาพเต็มครบ 4 แบบ
- `sips -Z 128 <ภาพเต็ม> --out <ชื่อเดิม>-128.png` — exit 0 ทั้ง 4 แบบ
- `sips -Z 64 <ภาพเต็ม> --out /private/tmp/<ชื่อเดิม>-64.png` — exit 0 ทั้ง 4 แบบ ใช้ตรวจเท่านั้น
- เปิดดูภาพต้นฉบับ ภาพเต็มสุดท้าย ภาพย่อ 128 และภาพทดสอบ 64 ทุกแบบด้วย `view_image`
- `CLANG_MODULE_CACHE_PATH=/private/tmp/karaduck-clang-cache swift /private/tmp/karaduck-verify.swift` — exit 0, **PASS 8/8 asset checks**

การตรวจอัตโนมัติยืนยันจำนวนไฟล์ภาพ 8 ไฟล์ ขนาดตามชื่อ PNG ไม่มี alpha และพิกเซลทั้งหมดในแถบรอบนอกประมาณ 4% เป็น RGB (6,5,12): ภาพเต็มตรวจ 157440 พิกเซลต่อภาพ ภาพย่อตรวจ 2460 พิกเซลต่อภาพ ระยะว่างขั้นต่ำถึงส่วนภาพที่มีช่องสีสว่างกว่า 55/255 ของภาพเต็มเท่ากับ 123, 120, 109, 118 พิกเซลตามลำดับ (ประมาณ 11–12%; แสงเรืองอ่อนอาจเลยเข้ามาในระยะนี้)

การตรวจด้วยตา: ทั้ง 4 แบบไม่มีตัวหนังสือ ตัวเลข หรือลายน้ำ ไม่มีส่วนถูกตัดขอบ มีปากอ้าและสัญลักษณ์ร้องเพลงชัดเจน ที่ 64×64 ยังแยกเป็ด ไมค์/โน้ต และแนวภาพได้ ไม่อ้างว่าได้ตรวจฐานข้อมูลลิขสิทธิ์ภายนอก แต่ prompt กำหนดให้ออกแบบตัวใหม่และไม่มีชุดหรือเครื่องหมายของตัวละครที่มีอยู่

ไม่รัน `npm test` เพราะไม่ได้เปลี่ยนโค้ดแอป ใช้การตรวจไฟล์ภาพและการดูภาพจริงตรงตามงานนี้ ไม่แก้ไฟล์ใน agy ไม่แก้ใบงาน และไม่ commit
