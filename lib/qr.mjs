// ISO/IEC 18004, versions 1–6, error correction M. All blocks in each
// of these versions have the same length: [block count, data/block, ECC/block].
const BLOCKS = [null, [1, 16, 10], [1, 28, 16], [1, 44, 26], [2, 32, 18], [2, 43, 24], [4, 27, 16]];
const ALIGNMENT = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function multiply(a, b) {
  let product = 0;
  for (; b; b >>>= 1) {
    if (b & 1) product ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return product;
}

function reedSolomon(data, degree) {
  let generator = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((value, j) => {
      next[j] ^= value;
      next[j + 1] ^= multiply(value, root);
    });
    generator = next;
    root = multiply(root, 2);
  }
  const remainder = Array(degree).fill(0);
  for (const value of data) {
    const factor = value ^ remainder.shift();
    remainder.push(0);
    for (let j = 0; j < degree; j++) remainder[j] ^= multiply(generator[j + 1], factor);
  }
  return remainder;
}

function codewords(bytes, version) {
  const [count, length, ecc] = BLOCKS[version];
  const capacity = count * length * 8;
  const bits = [];
  const append = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(4, 4); // Byte mode, 8-bit byte count for versions < 10.
  append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((n, bit) => n * 2 + bit, 0));
  }
  for (let pad = 0; data.length < count * length; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  const blocks = Array.from({ length: count }, (_, i) => data.slice(i * length, (i + 1) * length));
  const parity = blocks.map(block => reedSolomon(block, ecc));
  const result = [];
  for (let i = 0; i < length; i++) for (const block of blocks) result.push(block[i]);
  for (let i = 0; i < ecc; i++) for (const block of parity) result.push(block[i]);
  return result;
}

const masks = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function drawFormat(set, size, mask) {
  // M's format level is 00; BCH(15,5), generator x^10+x^8+x^5+x^4+x^2+x+1.
  let remainder = mask;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((mask << 10) | remainder) ^ 0x5412;
  const bit = i => Boolean((bits >>> i) & 1);
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true); // Fixed dark module.
}

function baseMatrix(version) {
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = modules.map(row => row.slice());
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const radius = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, radius !== 2 && radius !== 4);
    }
  }
  // The other three possible alignment centers overlap finder patterns.
  const positions = ALIGNMENT[version];
  if (positions.length) {
    const center = positions[1];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(center + dx, center + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(set, size, 0);
  return { modules, reserved };
}

function penalty(modules) {
  const size = modules.length;
  let score = 0;
  // N1: runs of at least five. N3: finder-like 1:1:3:1:1 runs with
  // four light units on either side (the outside quiet zone is light).
  for (let axis = 0; axis < 2; axis++) for (let line = 0; line < size; line++) {
    const history = Array(7).fill(0);
    const addRun = length => {
      if (history[0] === 0) length += size;
      history.pop();
      history.unshift(length);
    };
    const finderCount = () => {
      const n = history[1];
      const core = n > 0 && history[2] === n && history[3] === n * 3
        && history[4] === n && history[5] === n;
      return core ? Number(history[0] >= n * 4 && history[6] >= n)
        + Number(history[6] >= n * 4 && history[0] >= n) : 0;
    };
    let color = false, length = 0;
    for (let i = 0; i < size; i++) {
      const dark = axis === 0 ? modules[line][i] : modules[i][line];
      if (dark === color) {
        length++;
        if (length === 5) score += 3;
        else if (length > 5) score++;
      } else {
        addRun(length);
        if (!color) score += finderCount() * 40;
        color = dark;
        length = 1;
      }
    }
    if (color) { addRun(length); length = 0; }
    addRun(length + size);
    score += finderCount() * 40;
  }
  let darkCount = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    darkCount += Number(modules[y][x]);
    if (x && y && modules[y][x] === modules[y - 1][x]
      && modules[y][x] === modules[y][x - 1] && modules[y][x] === modules[y - 1][x - 1]) score += 3;
  }
  score += Math.floor(Math.abs(darkCount * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

export function encodeQr(text) {
  const bytes = new TextEncoder().encode(text);
  const version = BLOCKS.findIndex((block, v) => v > 0 && 12 + bytes.length * 8 <= block[0] * block[1] * 8);
  if (version < 1) throw Object.assign(new Error('too_long'), { code: 'too_long' });
  const words = codewords(bytes, version);
  const { modules, reserved } = baseMatrix(version);
  const size = modules.length;
  let index = 0;
  // Rightmost column pair first, alternating upward/downward; skip timing column.
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (reserved[y][x]) continue;
        // Remaining modules after the last codeword are zero remainder bits.
        modules[y][x] = index < words.length * 8 && Boolean((words[index >>> 3] >>> (7 - (index & 7))) & 1);
        index++;
      }
    }
  }
  let best, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row, y) => row.map((dark, x) => dark !== (!reserved[y][x] && masks[mask](x, y))));
    drawFormat((x, y, dark) => { candidate[y][x] = dark; }, size, mask);
    const score = penalty(candidate);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return { version, size, modules: best };
}

export function qrSvg(text, { margin = 4 } = {}) {
  if (!Number.isInteger(margin) || margin < 0) throw new RangeError('Invalid QR margin');
  const { size, modules } = encodeQr(text);
  const extent = size + margin * 2;
  const parts = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y][x]) parts.push(`M${x + margin},${y + margin}h1v1h-1z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges"><rect width="${extent}" height="${extent}" fill="#fff"/><path fill="#000" d="${parts.join('')}"/></svg>`;
}
