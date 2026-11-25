export const MAX_ROOMS = 30;
export const CREATES_PER_HOUR = 20;
export const IDLE_MS = 24 * 60 * 60 * 1000;
export const SEARCHES_PER_HOUR = 120;
export const JOIN_FAILS_PER_MINUTE = 30;
export const hourOf = ms => Math.floor(ms / 3_600_000);
export const minuteOf = ms => Math.floor(ms / 60_000);
