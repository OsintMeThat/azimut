import { describe, expect, it } from 'vitest';
import { qrMatrix } from './qr.js';

// Read back by a reference decoder when it was written: the bytes, the blocks, the
// correction, the format and the mask, all of them right.
const EXAMPLE = ['1111111000100010101111111', '1000001000000101101000001', '1011101010100000101011101', '1011101010101110001011101',
  '1011101011110000101011101', '1000001010110111001000001', '1111111010101010101111111', '0000000011010010100000000',
  '1011111000010000001111100', '0010100111110100010100010', '1010111000010111100101011', '1110110010111101101100001',
  '0111001100011011011010111', '1111110100000000100101010', '1011111010011001001111011', '1011100010110011111110001',
  '1001101010010000111110100', '0000000011101111100011000', '1111111000100110101010111', '1000001010101100100011010',
  '1011101010101011111110101', '1011101011000001011011111', '1011101011111001000001101', '1000001001010010110111001',
  '1111111011110000011111111'];
const bits = (matrix) => matrix.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));

describe('a QR code', () => {
  it('encodes a link exactly as a reader reads it back', () => {
    expect(bits(qrMatrix('https://example.org'))).toEqual(EXAMPLE);
  });

  it('grows with what it holds, up to an address of about two hundred characters, and says when it cannot', () => {
    expect(qrMatrix('x')).toHaveLength(21);
    expect(qrMatrix('https://example.org/' + 'a'.repeat(190))).toHaveLength(57);
    expect(qrMatrix('x'.repeat(300))).toBeNull();
  });

  it('has its three finders in their corners', () => {
    const matrix = qrMatrix('Hello, world!');
    const size = matrix.length;
    for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      expect(matrix[r][c]).toBe(true);
      expect(matrix[r + 1][c + 1]).toBe(false);
      expect(matrix[r + 3][c + 3]).toBe(true);
    }
  });
});
