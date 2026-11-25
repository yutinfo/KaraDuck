import { createState, deserialize } from '../public/js/store.js';

export function cleanRoomName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name.length >= 1 && name.length <= 40 ? name : null;
}

export function newRoomDoc(name, now = Date.now()) {
  return { rev: 0, name, guestEpoch: 1, ownerEpoch: 1, createdAt: now, updatedAt: now, ...createState() };
}

export function encodeRoomDoc(doc) {
  return JSON.stringify(doc);
}

export function decodeRoomDoc(text) {
  if (typeof text !== 'string') return null;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)
    || !Number.isSafeInteger(doc.rev) || doc.rev < 0) return null;
  for (const epoch of [doc.guestEpoch, doc.ownerEpoch]) {
    if (!Number.isInteger(epoch) || epoch < 1 || epoch > 999999999) return null;
  }
  const name = cleanRoomName(doc.name);
  if (name === null) return null;
  return {
    rev: doc.rev, name, guestEpoch: doc.guestEpoch, ownerEpoch: doc.ownerEpoch,
    createdAt: Number.isInteger(doc.createdAt) && doc.createdAt >= 0 ? doc.createdAt : 0,
    updatedAt: Number.isInteger(doc.updatedAt) && doc.updatedAt >= 0 ? doc.updatedAt : 0,
    ...deserialize(text),
  };
}
