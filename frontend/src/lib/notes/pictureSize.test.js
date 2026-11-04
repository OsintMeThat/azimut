import { describe, expect, it } from 'vitest';
import {
  PAGE_TALL, PICTURE_SIZES, pictureLine, picturesIn, readAttrs, sameRef, sizeWidth, sizedLine, writeAttrs,
} from './pictureSize.js';

describe('a picture line', () => {
  it('reads each picture with what it shows and its size and place', () => {
    const line = 'See [[media:m1|Roof]]{width=50% align=center} and ![Shot](/files/c1/a.png "Title"){width=200px}';
    const [media, image] = picturesIn(line);
    expect(media).toMatchObject({ ref: 'media:m1', width: '50%', align: 'center' });
    expect(line.slice(media.attrFrom, media.to)).toBe('{width=50% align=center}');
    expect(image).toMatchObject({ ref: '/files/c1/a.png', width: '200px', align: '' });
  });

  it('knows where braces would go on a picture that has none', () => {
    const [picture] = picturesIn('[[media:m1|Roof]] after');
    expect(picture.attrFrom).toBe(picture.to);
    expect(picture.width).toBe('');
  });

  it('reads and writes the braces, leaving out the default place', () => {
    expect(readAttrs('align=right  width=75%')).toEqual({ width: '75%', align: 'right' });
    expect(writeAttrs({ width: '50%', align: 'left' })).toBe('{width=50%}');
    expect(writeAttrs({ width: '', align: 'center' })).toBe('{align=center}');
    expect(writeAttrs({})).toBe('');
  });
});

describe('sizing a picture', () => {
  it('writes a size where there was none, keeping the rest of the line', () => {
    expect(sizedLine('[[media:m1|Roof]] (north)', 'media:m1', { width: '33%' })).toBe('[[media:m1|Roof]]{width=33%} (north)');
  });

  it('changes one of size and place and keeps the other', () => {
    const line = '[[media:m1|Roof]]{width=50% align=center}';
    expect(sizedLine(line, 'media:m1', { width: '75%' })).toBe('[[media:m1|Roof]]{width=75% align=center}');
    expect(sizedLine(line, 'media:m1', { align: 'left' })).toBe('[[media:m1|Roof]]{width=50%}');
  });

  it('changes only the picture it names on a line holding two', () => {
    const line = '[[media:a|A]]{width=50%} [[media:b|B]]';
    expect(sizedLine(line, 'media:b', { width: '25%' })).toBe('[[media:a|A]]{width=50%} [[media:b|B]]{width=25%}');
  });

  it('finds an image by its address as the server writes it back', () => {
    expect(sameRef('/files/c1/caf%C3%A9.png', '/files/c1/café.png')).toBe(true);
    expect(sizedLine('![x](/files/c1/café.png)', '/files/c1/caf%C3%A9.png', { width: '50%' }))
      .toBe('![x](/files/c1/café.png){width=50%}');
  });

  it('says so when the line does not hold the picture', () => {
    expect(sizedLine('Just words.', 'media:m1', { width: '50%' })).toBeNull();
  });

  it('finds the line nearest the one the server gave', () => {
    const lines = ['[[media:m1|A]]', 'words', 'words', 'words', '[[media:m1|A]]', 'other'];
    expect(pictureLine(lines, 3, 'media:m1')).toBe(4);
    expect(pictureLine(lines, 1, 'media:m1')).toBe(0);
    expect(pictureLine(lines, 2, 'media:zz')).toBe(-1);
  });
});

describe('the sizes offered', () => {
  const share = (id) => PICTURE_SIZES.find((size) => size.id === id).share;

  it('give a wide picture its share of the width', () => {
    expect(sizeWidth(share('small'), 0.5)).toBe('33%');
    expect(sizeWidth(share('medium'), 0.5)).toBe('50%');
    expect(sizeWidth(share('full'), 0.5)).toBe('100%');
  });

  it('keep a tall picture inside the same share of the page height', () => {
    // a phone screenshot, 2.16 times as tall as wide
    const medium = parseFloat(sizeWidth(share('medium'), 2.16));
    expect(medium).toBeLessThan(50);
    expect((medium / 100) * 2.16).toBeLessThanOrEqual(0.5 * PAGE_TALL + 0.01);
    expect(parseFloat(sizeWidth(share('full'), 2.16))).toBe(65);
  });

  it('size a picture whose shape is not known yet as a wide one', () => {
    expect(sizeWidth(share('large'))).toBe('75%');
  });

  it('never write a width the PDF would refuse', () => {
    expect(sizeWidth(share('small'), 500)).toBe('5%');
  });
});
