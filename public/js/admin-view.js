export function sortRooms(rooms) {
  return [...rooms].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function relativeTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return 'ไม่ทราบ';
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return 'เมื่อครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} ชั่วโมงที่แล้ว` : `${Math.floor(hours / 24)} วันที่แล้ว`;
}

export function expiresSoon(room, limits, now = Date.now()) {
  if (!Number.isFinite(room.updatedAt) || room.updatedAt <= 0 || !Number.isFinite(limits.idleHours) || limits.idleHours <= 0) return false;
  return room.updatedAt + limits.idleHours * 3_600_000 - now < 2 * 3_600_000;
}
