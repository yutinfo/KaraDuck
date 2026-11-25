import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, qrSvg } from '../lib/qr.mjs';

// Independent small decoder: only the byte-mode/M/versions 1–6 subset under test.
// It uses geometry, BCH long division and GF log tables rather than encoder helpers.
const DATA_WORDS = [0, 16, 28, 44, 64, 86, 108];
const BLOCK_COUNTS = [0, 1, 1, 1, 2, 2, 4];
const ECC_WORDS = [0, 10, 16, 26, 18, 24, 16];
const MASK = [
  (r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => r * c % 2 + r * c % 3 === 0,
  (r, c) => (r * c % 2 + r * c % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + r * c % 3) % 2 === 0,
];

function functionModules(size) {
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const rect = (left, top, width, height) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) reserved[y][x] = true;
  };
  rect(0, 0, 9, 9);
  rect(size - 8, 0, 8, 9);
  rect(0, size - 8, 9, 8);
  rect(6, 0, 1, size);
  rect(0, 6, size, 1);
  if (size > 21) rect(size - 9, size - 9, 5, 5);
  return reserved;
}

function readFormat(matrix) {
  const size = matrix.length;
  const first = [...Array.from({ length: 6 }, (_, y) => [8, y]), [8, 7], [8, 8], [7, 8],
    ...Array.from({ length: 6 }, (_, i) => [5 - i, 8])];
  const second = [...Array.from({ length: 8 }, (_, i) => [size - 1 - i, 8]),
    ...Array.from({ length: 7 }, (_, i) => [8, size - 7 + i])];
  const word = coords => coords.reduce((n, [x, y], bit) => n | (Number(matrix[y][x]) << bit), 0);
  const encoded = word(first);
  assert.equal(word(second), encoded, 'both format copies match');
  const unmasked = encoded ^ 0x5412;
  let remainder = unmasked;
  for (let i = 14; i >= 10; i--) if (remainder & (1 << i)) remainder ^= 0x537 << (i - 10);
  assert.equal(remainder, 0, 'format BCH remainder');
  assert.equal(unmasked >>> 13, 0, 'M error correction level');
  return (unmasked >>> 10) & 7;
}

const exp = [], log = [];
for (let i = 0, n = 1; i < 255; i++) {
  exp[i] = n;
  log[n] = i;
  n *= 2;
  if (n >= 256) n ^= 0x11d;
}
const gf = (a, b) => a && b ? exp[(log[a] + log[b]) % 255] : 0;

function decode(qr) {
  const { modules, size, version } = qr;
  assert.equal(size, 17 + 4 * version);
  assert.equal(modules.length, size);
  assert.ok(modules.every(row => row.length === size && row.every(cell => typeof cell === 'boolean')));
  const mask = readFormat(modules);
  const reserved = functionModules(size);
  const bits = [];
  const columns = Array.from({ length: size }, (_, i) => size - 1 - i).filter(x => x !== 6);
  for (let pair = 0; pair < columns.length / 2; pair++) {
    for (let step = 0; step < size; step++) {
      const row = pair % 2 ? step : size - 1 - step;
      for (const col of columns.slice(pair * 2, pair * 2 + 2)) {
        if (!reserved[row][col]) bits.push(Number(modules[row][col] !== MASK[mask](row, col)));
      }
    }
  }
  const blockCount = BLOCK_COUNTS[version], ecc = ECC_WORDS[version];
  const wordCount = DATA_WORDS[version] + ecc * blockCount;
  assert.equal(bits.length, wordCount * 8 + (version === 1 ? 0 : 7), 'data and remainder module count');
  assert.ok(bits.slice(wordCount * 8).every(bit => bit === 0), 'zero remainder bits');
  const interleaved = Array.from({ length: wordCount }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((n, bit) => n * 2 + bit, 0));
  const blocks = Array.from({ length: blockCount }, () => []);
  interleaved.forEach((word, i) => blocks[i % blockCount].push(word));
  for (const block of blocks) {
    for (let root = 0; root < ecc; root++) {
      const syndrome = block.reduce((sum, word) => gf(sum, exp[root]) ^ word, 0);
      assert.equal(syndrome, 0, `RS syndrome at alpha^${root}`);
    }
  }
  const data = blocks.flatMap(block => block.slice(0, block.length - ecc));
  const payload = data.flatMap(byte => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  let cursor = 0;
  const read = count => {
    const result = payload.slice(cursor, cursor + count).reduce((n, bit) => n * 2 + bit, 0);
    cursor += count;
    return result;
  };
  assert.equal(read(4), 4, 'byte mode');
  const byteLength = read(8);
  const bytes = Uint8Array.from({ length: byteLength }, () => read(8));
  assert.equal(read(4), 0, 'terminator');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function checkPatterns({ modules: m, size }) {
  for (const [left, top] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const dark = x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4);
      assert.equal(m[top + y][left + x], dark, 'finder pattern');
    }
  }
  for (let i = 8; i <= size - 9; i++) {
    assert.equal(m[6][i], i % 2 === 0, 'horizontal timing');
    assert.equal(m[i][6], i % 2 === 0, 'vertical timing');
  }
  assert.equal(m[size - 8][8], true, 'fixed dark module');
  if (size > 21) for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    assert.equal(m[size - 9 + y][size - 9 + x], x === 0 || y === 0 || x === 4 || y === 4 || (x === 2 && y === 2), 'alignment');
  }
}

for (const [text, version] of [
  ['A', 1], ['http://192.168.1.23:8791/remote?k=AB12CD', 3],
  ['http://192.168.100.200:8791/remote?k=AB12CD', 4], ['คาราโอเกะ', 3], ['a'.repeat(100), 6],
]) test(`QR decodes UTF-8 and every RS block: ${text.slice(0, 45)}`, () => {
  const qr = encodeQr(text);
  assert.equal(qr.version, version);
  assert.equal(decode(qr), text);
  checkPatterns(qr);
});

test('smallest M version at every byte capacity boundary, including multi-block versions 4/5', () => {
  for (const [length, version] of [[0, 1], [14, 1], [15, 2], [26, 2], [27, 3], [42, 3], [43, 4], [62, 4], [63, 5], [84, 5], [85, 6], [106, 6]]) {
    const text = Array.from({ length }, (_, i) => String.fromCharCode(33 + (i % 90))).join('');
    const qr = encodeQr(text);
    assert.equal(qr.version, version, `${length} bytes`);
    assert.equal(decode(qr), text);
    checkPatterns(qr);
  }
  assert.throws(() => encodeQr('x'.repeat(107)), { code: 'too_long' });
  assert.throws(() => encodeQr('x'.repeat(200)), { code: 'too_long' });
  assert.throws(() => encodeQr('ก'.repeat(36)), { code: 'too_long' });
});

// Independently score complete candidate matrices with run lists and virtual light
// borders; rebuild all eight masks to verify minimum-penalty selection.
function score(matrix) {
  const size = matrix.length;
  const lines = [...matrix, ...matrix.map((_, x) => matrix.map(row => row[x]))];
  let total = 0;
  for (const line of lines) {
    let length = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) length++;
      else { if (length >= 5) total += length - 2; length = 1; }
    }
    const padded = [...Array(size).fill(false), ...line, ...Array(size).fill(false)];
    const runs = [];
    for (const dark of padded) {
      if (runs.at(-1)?.dark === dark) runs.at(-1).length++;
      else runs.push({ dark, length: 1 });
    }
    for (let i = 1; i + 5 < runs.length; i++) {
      const n = runs[i].length;
      if (!runs[i].dark || runs[i + 1].length !== n || runs[i + 2].length !== n * 3
        || runs[i + 3].length !== n || runs[i + 4].length !== n) continue;
      if (runs[i - 1].length >= 4 * n && runs[i + 5].length >= n) total += 40;
      if (runs[i + 5].length >= 4 * n && runs[i - 1].length >= n) total += 40;
    }
  }
  for (let y = 1; y < size; y++) for (let x = 1; x < size; x++) {
    const v = matrix[y][x];
    if (matrix[y][x - 1] === v && matrix[y - 1][x] === v && matrix[y - 1][x - 1] === v) total += 3;
  }
  const dark = matrix.flat().filter(Boolean).length;
  total += Math.floor(Math.abs(100 * dark / (size * size) - 50) / 5) * 10;
  return total;
}

function changeMask(qr, mask) {
  const { size, modules } = qr;
  const original = readFormat(modules);
  const reserved = functionModules(size);
  const copy = modules.map((row, y) => row.map((dark, x) => reserved[y][x] ? dark : dark !== (MASK[original](y, x) !== MASK[mask](y, x))));
  let code = mask << 10;
  let rest = code;
  for (let i = 14; i >= 10; i--) if (rest & (1 << i)) rest ^= 0x537 << (i - 10);
  code = (code | rest) ^ 0x5412;
  const set = (x, y, bit) => { copy[y][x] = Boolean((code >>> bit) & 1); };
  for (let i = 0; i < 15; i++) {
    if (i < 6) set(8, i, i);
    else if (i < 8) set(8, i + 1, i);
    else if (i === 8) set(7, 8, i);
    else set(14 - i, 8, i);
    if (i < 8) set(size - 1 - i, 8, i);
    else set(8, size - 15 + i, i);
  }
  return copy;
}

test('mask selection minimizes all four ISO penalties across all eight masks', () => {
  for (const length of [1, 15, 30, 50, 70, 100]) {
    const qr = encodeQr('A'.repeat(length));
    const alternatives = Array.from({ length: 8 }, (_, mask) => score(changeMask(qr, mask)));
    assert.equal(score(qr.modules), Math.min(...alternatives));
    assert.equal(readFormat(qr.modules), alternatives.indexOf(Math.min(...alternatives)), 'lowest mask wins ties');
  }
});

test('SVG is always black on opaque white, a single path and correct quiet-zone extent', () => {
  for (const margin of [0, 4, 8]) {
    const extent = encodeQr('A').size + margin * 2;
    const svg = qrSvg('A', { margin });
    assert.ok(svg.includes(`viewBox="0 0 ${extent} ${extent}"`));
    assert.match(svg, /shape-rendering="crispEdges"/);
    assert.ok(svg.includes(`<rect width="${extent}" height="${extent}" fill="#fff"/>`));
    assert.match(svg, /<path fill="#000" d="/);
    assert.equal((svg.match(/<path /g) ?? []).length, 1);
    assert.deepEqual(svg.match(/#[a-fA-F0-9]+/g), ['#fff', '#000']);
    assert.equal(qrSvg('A'), qrSvg('A', { margin: 4 }));
  }
});
