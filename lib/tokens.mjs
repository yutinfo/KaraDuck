import * as crypto from 'node:crypto';

export const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{16}$/;

const validRoomId = value => typeof value === 'string' && ROOM_ID_PATTERN.test(value);
const validEpoch = value => Number.isInteger(value) && value >= 1 && value <= 999999999;

function signature(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest().subarray(0, 16).toString('base64url');
}

export function makeRoomId(randomInt = crypto.randomInt) {
  return Array.from({ length: 16 }, () => ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)]).join('');
}

export function signToken(secret, { roomId, role, epoch }) {
  if (!validRoomId(roomId) || !['o', 'g'].includes(role) || !validEpoch(epoch)) {
    throw new TypeError('Invalid token claims');
  }
  const payload = `${roomId}.${role}${epoch}`;
  return `${payload}.${signature(secret, payload)}`;
}

export function verifyToken(secret, token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [roomId, claims, sig] = parts;
  const role = claims[0];
  const epochText = claims.slice(1);
  if (!validRoomId(roomId) || !['o', 'g'].includes(role)
    || !/^[1-9]\d{0,8}$/.test(epochText)
    || sig.length !== 22 || !/^[\w-]{22}$/.test(sig)) return null;
  const expected = signature(secret, `${roomId}.${claims}`);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return { roomId, role, epoch: Number(epochText) };
}

export function bearerToken(headers) {
  const value = headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  const token = value.slice(7);
  return token && !/\s/.test(token) ? token : null;
}
