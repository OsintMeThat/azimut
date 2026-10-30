/**
 * A QR code for a plate's link: byte mode, error correction level M, versions 1 to
 * 10, which holds an address of about two hundred characters. Small and local, so a
 * plate draws one without a library and without asking anybody.
 *
 * `qrMatrix(text)` gives the modules as rows of booleans (dark = true), without the
 * quiet zone, or null when the text is too long for version 10.
 */

// [error correction codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each]
const BLOCKS = [null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value;
    LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];
}
const multiply = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree) {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let at = 0; at < poly.length; at += 1) {
      next[at] ^= poly[at];
      next[at + 1] ^= multiply(poly[at], EXP[index]);
    }
    poly = next;
  }
  return poly;
}

function remainder(data, degree) {
  const gen = generator(degree);
  const out = [...data, ...new Array(degree).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const factor = out[index];
    if (!factor) continue;
    for (let at = 0; at < gen.length; at += 1) out[index + at] ^= multiply(gen[at], factor);
  }
  return out.slice(data.length);
}

const capacity = (version) => {
  const [, b1, d1, b2, d2] = BLOCKS[version];
  return b1 * d1 + b2 * d2;
};

/** The data codewords: mode, length, bytes, terminator and padding. */
function codewords(bytes, version) {
  const bits = [];
  const put = (value, length) => { for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1); };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  const total = capacity(version) * 8;
  put(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) data.push(bits.slice(index, index + 8).reduce((sum, bit) => sum * 2 + bit, 0));
  for (let pad = 0; data.length < capacity(version); pad += 1) data.push(pad % 2 ? 0x11 : 0xec);
  return data;
}

/** The data cut into blocks, each with its correction, interleaved. */
function interleave(data, version) {
  const [ec, b1, d1, b2, d2] = BLOCKS[version];
  const blocks = [];
  let at = 0;
  for (let index = 0; index < b1 + b2; index += 1) {
    const length = index < b1 ? d1 : d2;
    const block = data.slice(at, at + length);
    at += length;
    blocks.push({ data: block, ec: remainder(block, ec) });
  }
  const out = [];
  for (let index = 0; index < Math.max(d1, d2); index += 1) for (const block of blocks) if (index < block.data.length) out.push(block.data[index]);
  for (let index = 0; index < ec; index += 1) for (const block of blocks) out.push(block.ec[index]);
  return out;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function build(version, stream, mask) {
  const size = version * 4 + 17;
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, dark) => { grid[r][c] = dark; fixed[r][c] = true; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) {
      const rr = r0 + r;
      const cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(rr, cc, ring !== 2 && ring !== 4);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let index = 8; index < size - 8; index += 1) { set(6, index, index % 2 === 0); set(index, 6, index % 2 === 0); }
  const centres = ALIGN[version];
  for (const r of centres) for (const c of centres) {
    if ((r === 6 && c === 6) || (r === 6 && c === centres.at(-1)) || (r === centres.at(-1) && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // format (level M is 00) and version areas, in the reference layout: `put(x, y)` is column, row
  const put = (x, y, dark) => set(y, x, dark);
  let rem = mask;
  for (let index = 0; index < 10; index += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((mask << 10) | rem) ^ 0x5412;
  const fbit = (index) => ((format >>> index) & 1) === 1;
  for (let index = 0; index <= 5; index += 1) put(8, index, fbit(index));
  put(8, 7, fbit(6)); put(8, 8, fbit(7)); put(7, 8, fbit(8));
  for (let index = 9; index < 15; index += 1) put(14 - index, 8, fbit(index));
  for (let index = 0; index < 8; index += 1) put(size - 1 - index, 8, fbit(index));
  for (let index = 8; index < 15; index += 1) put(8, size - 15 + index, fbit(index));
  put(8, size - 8, true);
  if (version >= 7) {
    let vrem = version;
    for (let index = 0; index < 12; index += 1) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25);
    const info = (version << 12) | vrem;
    for (let index = 0; index < 18; index += 1) {
      const dark = ((info >>> index) & 1) === 1;
      const a = size - 11 + (index % 3);
      const b = Math.floor(index / 3);
      put(a, b, dark); put(b, a, dark);
    }
  }
  // the data, in the zigzag, masked
  let bit = 0;
  const bits = stream.flatMap((byte) => Array.from({ length: 8 }, (_, index) => ((byte >>> (7 - index)) & 1) === 1));
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) for (let j = 0; j < 2; j += 1) {
      const c = right - j;
      const upward = ((right + 1) & 2) === 0;
      const r = upward ? size - 1 - vert : vert;
      if (fixed[r][c]) continue;
      const dark = bit < bits.length ? bits[bit] : false;
      bit += 1;
      grid[r][c] = dark !== MASKS[mask](r, c);
    }
  }
  return grid;
}

function penalty(grid) {
  const size = grid.length;
  let score = 0;
  for (const read of [(a, b) => grid[a][b], (a, b) => grid[b][a]]) {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (read(a, b) === read(a, b - 1)) { run += 1; if (run === 5) score += 3; else if (run > 5) score += 1; } else run = 1;
      }
      for (let b = 0; b + 6 < size; b += 1) {
        const pattern = [1, 0, 1, 1, 1, 0, 1].every((want, k) => read(a, b + k) === !!want);
        if (pattern) score += 40;
      }
    }
  }
  for (let r = 0; r + 1 < size; r += 1) for (let c = 0; c + 1 < size; c += 1) {
    const v = grid[r][c];
    if (grid[r][c + 1] === v && grid[r + 1][c] === v && grid[r + 1][c + 1] === v) score += 3;
  }
  const dark = grid.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

/** The QR code of `text`, as rows of dark modules, or null when it does not fit. */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text ?? ''))];
  let version = 1;
  while (version <= 10 && bytes.length + (version < 10 ? 2 : 3) > capacity(version)) version += 1;
  if (version > 10) return null;
  const stream = interleave(codewords(bytes, version), version);
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = build(version, stream, mask);
    const score = penalty(grid);
    if (score < bestScore) { best = grid; bestScore = score; }
  }
  return best;
}
