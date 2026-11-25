import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ROOM_ID_ALPHABET, makeRoomId, signToken, verifyToken, bearerToken } from '../lib/tokens.mjs';

const roomId = 'ABCDEFGHJKLMNPQR';

test('เซ็นแล้วตรวจได้ค่าเดิม ด้วย HMAC-SHA256 16 ไบต์แรก', () => {
  for (const role of ['g', 'o']) {
    for (const epoch of [1, 3, 999999999]) {
      const token = signToken('s', { roomId, role, epoch });
      const payload = `${roomId}.${role}${epoch}`;
      const sig = createHmac('sha256', 's').update(payload).digest().subarray(0, 16).toString('base64url');
      assert.equal(token, `${payload}.${sig}`);
      assert.deepEqual(verifyToken('s', token), { roomId, role, epoch });
    }
  }
  assert.match(signToken('s', { roomId, role: 'g', epoch: 3 }), /^ABCDEFGHJKLMNPQR\.g3\.[\w-]{22}$/);
  assert.equal(signToken('s', { roomId, role: 'g', epoch: 3 }).length, 42);
});

test('ปฏิเสธโทเคนที่ถูกแก้หรือผิดรูปแบบ', () => {
  const token = signToken('s', { roomId, role: 'g', epoch: 3 });
  for (const bad of [token.replace('.g3.', '.o3.'), token.replace('.g3.', '.g4.'),
    token.replace('ABCD', 'ABCE'), token.slice(0, -1), `${token}x`, `${token}\n`,
    '', null, 42, {}, 'a.b', `${roomId}.g03.x`, `${roomId}.g0.x`,
    ...['g-1', 'g1.5', 'g1000000000', 'x3', 'g'].map(part => `${roomId}.${part}.${token.split('.')[2]}`),
    ...['I', 'O', '0', '1', 'a'].map(char => token.replace(/^A/, char)),
    token.replace(/.$/, '!'), `${token}=`,
  ]) assert.equal(verifyToken('s', bad), null, String(bad));
  assert.equal(verifyToken('other', token), null);
  // Reject alternate base64 encodings with nonzero unused bits, too.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(token.at(-1));
  assert.equal(verifyToken('s', token.slice(0, -1) + alphabet[last + 1]), null);
});

test('makeRoomId ใช้ชุดอักษรที่กำหนดและสุ่มครบ 16 ตำแหน่ง', () => {
  assert.equal(ROOM_ID_ALPHABET, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  assert.match(makeRoomId(), /^[A-HJ-NP-Z2-9]{16}$/);
  let calls = 0;
  assert.equal(makeRoomId(max => {
    assert.equal(max, ROOM_ID_ALPHABET.length);
    return calls++;
  }), ROOM_ID_ALPHABET.slice(0, 16));
  assert.equal(calls, 16);
  assert.equal(makeRoomId(max => max - 1), '9'.repeat(16));
});

test('signToken ปฏิเสธ roomId, role และ epoch ที่ไม่ถูกต้อง', () => {
  const valid = { roomId, role: 'g', epoch: 1 };
  for (const patch of [
    { roomId: `${roomId}\n` }, { roomId: 'I'.repeat(16) }, { roomId: null },
    { role: 'owner' }, { role: null },
    ...[0, -1, 1.5, '1', NaN, Infinity, 1000000000].map(epoch => ({ epoch })),
  ]) assert.throws(() => signToken('s', { ...valid, ...patch }), TypeError);
});

test('bearerToken อ่านเฉพาะ Bearer พร้อมโทเคนที่ไม่ว่าง', () => {
  assert.equal(bearerToken({ authorization: 'Bearer abc' }), 'abc');
  for (const authorization of ['Basic abc', 'bearer abc', 'Bearer ', 'Bearer a b', 'Bearer abc\n', null, 42]) {
    assert.equal(bearerToken({ authorization }), null);
  }
  assert.equal(bearerToken({}), null);
});
