import { describe, expect, it, vi } from 'vitest';
import { cardPictures, nameNumber, pictureKind, picturesQuery, showable, suggestion } from './layerPicture.js';

describe('a feature’s picture', () => {
  it('reads the number a feature is named by, without its leading zeros', () => {
    expect(nameNumber('#7')).toBe('7');
    expect(nameNumber('Vehicle 007, T-72')).toBe('7');
    expect(nameNumber('#0')).toBe('0');
    expect(nameNumber('Checkpoint')).toBe('');
  });

  it('offers the pictures holding that number on its own, never one holding it inside another', () => {
    const rule = suggestion('#7');
    expect(rule.query).toBe('7');
    expect(rule.said).toBe('With 7 in the name');
    const kept = ['Vehicle 07', '#7 Oshkosh M-ATV', 'M-ATV 7 on or before 14 Oct', '7.jpg', 'crop-7']
      .filter(rule.keeps);
    expect(kept).toHaveLength(5);
    expect(['Vehicle 17', '#70', 'Board 71', '2026-11-17', 'clip 0m31.7s', 'Crop 7.5'].filter(rule.keeps)).toEqual([]);
    // those saying #7 first, then those whose first number it is, then the rest
    const shuffled = ['00-00-07 capture', 'Board 07 ERAF', '#7 Oshkosh M-ATV'];
    expect(shuffled.sort((a, b) => rule.rank(a) - rule.rank(b))).toEqual(['#7 Oshkosh M-ATV', 'Board 07 ERAF', '00-00-07 capture']);
  });

  it('looks for a name with no number whole, and for nothing under two letters', () => {
    expect(suggestion('  Gate   north ')).toMatchObject({ query: 'Gate north', said: 'Named like “Gate north”' });
    expect(suggestion('A')).toBeNull();
    expect(suggestion('')).toBeNull();
  });

  it('takes pictures, videos, captures and proofs, and nothing else', () => {
    expect(showable({ type: 'media', attrs: { kind: 'image' } })).toBe(true);
    expect(showable({ type: 'media', attrs: { kind: 'video' } })).toBe(true);
    expect(showable({ type: 'media', attrs: { kind: 'audio' } })).toBe(false);
    expect(showable({ type: 'capture', attrs: {} })).toBe(true);
    expect(showable({ type: 'proof', attrs: {} })).toBe(true);
    expect(showable({ type: 'place', attrs: {} })).toBe(false);
    expect(showable(null)).toBe(false);
    expect([{ type: 'proof' }, { type: 'capture' }, { type: 'media', attrs: { kind: 'video' } }, { type: 'media', attrs: { kind: 'image' } }]
      .map(pictureKind)).toEqual(['Proof', 'Capture', 'Video', 'Picture']);
  });

  it('asks the catalog for the three kinds with their small pictures, newest first with no words', () => {
    expect(picturesQuery('c1', '7', 200)).toBe('/api/cases/c1/catalog/entities?limit=200&type=media%2Ccapture%2Cproof&q=7&order=relevance&previews=true');
    expect(picturesQuery('c1')).toBe('/api/cases/c1/catalog/entities?limit=40&type=media%2Ccapture%2Cproof&order=-created&previews=true');
  });

  it('shows on the card the picture named for it, alone, over what the feature follows', () => {
    const open = vi.fn();
    const followed = { entity_id: 'p1', entity_type: 'proof', entity_label: 'Strike', entity_picture: 'proofs/strike.png',
      source_id: 'v1', source_label: 'rooftop', source_picture: 'media/.thumbs/v.jpg' };
    expect(cardPictures(followed, 'c1', open).map((one) => one.caption)).toEqual(['Source', 'Proof']);
    const [own] = cardPictures({ ...followed, picture: 'e_7', picture_path: 'media/.thumbs/7.jpg', picture_label: 'Vehicle 07' }, 'c1', open);
    expect(cardPictures({ ...followed, picture: 'e_7', picture_path: 'media/.thumbs/7.jpg' }, 'c1', open)).toHaveLength(1);
    expect(own).toMatchObject({ src: '/files/c1/media/.thumbs/7.jpg', whole: true, caption: '', title: 'Open “Vehicle 07”' });
    own.open();
    expect(open).toHaveBeenCalledWith('e_7');
    // a picture with nothing to show yet leaves the card as it was
    expect(cardPictures({ picture: 'e_7', name: 'Own' }, 'c1', open)).toEqual([]);
  });
});
