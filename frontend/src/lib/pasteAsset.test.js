import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  assetName, assetExtension, base64Of, PASTE_TYPES, MAX_PASTE_BYTES, MAX_PASTES,
} from './pasteAsset.js';

const bytes = (...values) => new Uint8Array(values);

describe('pasted asset naming', () => {
  it('names an image after its own content', async () => {
    const data = bytes(1, 2, 3, 4, 5);
    const expected = createHash('sha256').update(data).digest('hex').slice(0, 16);

    expect(await assetName(data, 'image/png')).toBe(`${expected}.png`);
  });

  it('gives the same paste the same name twice, and different pixels a new one', async () => {
    const a = await assetName(bytes(9, 9, 9), 'image/png');
    const b = await assetName(bytes(9, 9, 9), 'image/png');
    const c = await assetName(bytes(9, 9, 8), 'image/png');

    expect(a).toBe(b); // pasting a screenshot twice writes one file
    expect(a).not.toBe(c);
  });

  it('keeps the image type in the extension', async () => {
    expect(assetExtension('image/jpeg')).toBe('jpg');
    expect(assetExtension('image/webp')).toBe('webp');
    expect(assetExtension('image/png')).toBe('png');
    expect(assetExtension('image/gif')).toBe('png'); // never a type we did not accept
    expect(await assetName(bytes(1), 'image/jpeg')).toMatch(/^[0-9a-f]{16}\.jpg$/);
  });

  it('produces a name the API will accept', async () => {
    // the server checks this exact shape before writing anything
    expect(await assetName(bytes(7, 7), 'image/webp')).toMatch(/^[0-9a-f]{16}\.(png|jpe?g|webp)$/);
  });

  it('encodes bytes past one chunk correctly', () => {
    const big = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 256);

    expect(base64Of(big)).toBe(Buffer.from(big).toString('base64'));
  });

  it('agrees with the caps the API enforces', () => {
    expect(MAX_PASTES).toBe(12);
    expect(MAX_PASTE_BYTES).toBe(20 * 1024 * 1024);
    expect(PASTE_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });
});
