// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  CAPTION_MAX, PAGE_TALL, PICTURE_SIZES, captionField, cleanCaption, pictureAt, pictureLine, picturesIn, readAttrs, rovingToolbar,
  blockAlignAt, sameRef, sizeWidth, sizedLine, writeAttrs,
} from './pictureSize.js';

describe('a picture line', () => {
  it('reads each picture with what it shows and its size and place', () => {
    const line = 'See [[media:m1|Roof]]{width=50% align=center} and ![Shot](/files/c1/a.png "Title"){width=200px}';
    const [media, image] = picturesIn(line);
    expect(media).toMatchObject({ ref: 'media:m1', width: '50%', align: 'center' });
    expect(line.slice(media.attrFrom, media.to)).toBe('{width=50% align=center}');
    expect(image).toMatchObject({ ref: '/files/c1/a.png', width: '200px', align: '', title: 'Title', caption: '' });
  });

  it('knows where braces would go on a picture that has none', () => {
    const [picture] = picturesIn('[[media:m1|Roof]] after');
    expect(picture.attrFrom).toBe(picture.to);
    expect(picture.width).toBe('');
  });

  it('reads and writes the braces, leaving out the default place', () => {
    expect(readAttrs('align=right  width=75%')).toEqual({ width: '75%', align: 'right', caption: '', rest: '' });
    expect(writeAttrs({ width: '50%', align: 'left' })).toBe('{width=50%}');
    expect(writeAttrs({ width: '', align: 'center' })).toBe('{align=center}');
    expect(writeAttrs({})).toBe('');
  });
});

describe('a caption', () => {
  it('is read from the braces, and its words are never taken for a size', () => {
    expect(readAttrs('width=50% caption="Smoke over the port" align=center')).toEqual({
      width: '50%', align: 'center', caption: 'Smoke over the port', rest: '',
    });
    expect(readAttrs('caption="width=90% of the quay" width=33%')).toMatchObject({ width: '33%', caption: 'width=90% of the quay' });
    const [picture] = picturesIn('[[media:m1|Roof]]{width=50% align=center caption="Smoke over the port"}');
    expect(picture).toMatchObject({ ref: 'media:m1', width: '50%', align: 'center', caption: 'Smoke over the port' });
  });

  it('is written after the size and place, as one clean line', () => {
    expect(writeAttrs({ width: '50%', align: 'center', caption: 'Smoke over the port' }))
      .toBe('{width=50% align=center caption="Smoke over the port"}');
    expect(writeAttrs({ caption: '  Quote "this" {and}\nthat  ' })).toBe('{caption="Quote this {and that"}');
    expect(writeAttrs({ caption: '   ' })).toBe('');
    expect(cleanCaption('x'.repeat(400))).toHaveLength(CAPTION_MAX);
  });

  it('is changed, kept or taken off without touching the rest of the line', () => {
    const line = 'Seen [[media:m1|Roof]]{width=50% align=center} today';
    const captioned = sizedLine(line, 'media:m1', { caption: 'Smoke over the port' });
    expect(captioned).toBe('Seen [[media:m1|Roof]]{width=50% align=center caption="Smoke over the port"} today');
    expect(sizedLine(captioned, 'media:m1', { width: '33%' }))
      .toBe('Seen [[media:m1|Roof]]{width=33% align=center caption="Smoke over the port"} today');
    expect(sizedLine(captioned, 'media:m1', { caption: '' })).toBe(line);
    expect(sizedLine('![Shot](/a.png "Title")', '/a.png', { caption: 'Pier' })).toBe('![Shot](/a.png "Title"){caption="Pier"}');
  });

  it('keeps a key it does not know, as written', () => {
    const line = '[[media:m1|Roof]]{width=50% frame=thin}';
    expect(picturesIn(line)[0].rest).toBe('frame=thin');
    expect(sizedLine(line, 'media:m1', { caption: 'Roof' })).toBe('[[media:m1|Roof]]{width=50% caption="Roof" frame=thin}');
  });

  it('is found on the line the server gave, or the nearest holding the picture', () => {
    const lines = ['Intro', '[[media:m1|A]]{caption="North"}', 'x', '[[media:m2|B]]'];
    expect(pictureAt(lines, 0, 'media:m1')).toMatchObject({ caption: 'North' });
    expect(pictureAt(lines, 3, 'media:zz')).toBeNull();
  });
});

describe('the caption field', () => {
  function field(options = {}) {
    const write = vi.fn();
    const done = vi.fn();
    const input = captionField({ caption: 'Old', write, done, ...options });
    document.body.append(input);
    input.focus();
    return { input, write, done };
  }
  const key = (input, name) => input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

  it('writes on Enter, once, and gives the keyboard back', () => {
    const { input, write, done } = field();
    input.value = '  Smoke  over the "port" ';
    key(input, 'Enter');
    input.dispatchEvent(new Event('blur'));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('Smoke over the port');
    expect(done).toHaveBeenCalledWith('keyboard');
    input.remove();
  });

  it('leaves the caption as it was on Escape', () => {
    const { input, write, done } = field();
    input.value = 'Changed';
    key(input, 'Escape');
    expect(write).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith('keyboard');
    input.remove();
  });

  it('writes what was typed when it is left, and nothing when nothing changed', () => {
    const first = field();
    first.input.value = 'New';
    first.input.dispatchEvent(new Event('blur'));
    expect(first.write).toHaveBeenCalledWith('New');
    expect(first.done).toHaveBeenCalledWith('blur');
    const second = field();
    second.input.dispatchEvent(new Event('blur'));
    expect(second.write).not.toHaveBeenCalled();
    first.input.remove();
    second.input.remove();
  });

  it('offers an image\'s title as what prints when it is left empty', () => {
    const { input } = field({ caption: '', title: 'Pier at dawn' });
    expect(input.placeholder).toBe('Pier at dawn');
    expect(input.maxLength).toBe(CAPTION_MAX);
    expect(input.getAttribute('aria-label')).toBe('Caption');
    input.remove();
  });
});

describe('a picture bar from the keyboard', () => {
  it('is one Tab stop, on the button last used, walked with the arrows', () => {
    const bar = document.createElement('div');
    bar.innerHTML = '<button>S</button><button>M</button><button>L</button><button>Caption</button>';
    document.body.append(bar);
    const undo = rovingToolbar(bar);
    const [small, medium, , caption] = bar.querySelectorAll('button');
    expect([...bar.querySelectorAll('button')].map((button) => button.tabIndex)).toEqual([0, -1, -1, -1]);
    small.focus();
    small.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(medium);
    expect(medium.tabIndex).toBe(0);
    expect(small.tabIndex).toBe(-1);
    medium.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(caption);
    caption.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(small);
    undo();
    bar.remove();
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

  it('takes the place of the block it stands in, and writes only a place that differs from it', () => {
    const lines = ['Intro', '::: center', '![Logo](azimut:my-logo){width=25%}', ':::', '![Map](/m.png)', '::: right', 'x', ':::'];
    expect(blockAlignAt(lines, 2)).toBe('center');
    expect(blockAlignAt(lines, 4)).toBe('');
    expect(blockAlignAt(lines, 6)).toBe('right');
    expect(blockAlignAt(['::: left', 'x', ':::'], 1)).toBe('');
    // an open block never closed is no block
    expect(blockAlignAt(['::: center', 'x'], 1)).toBe('');
    const centred = { blockAlign: 'center' };
    expect(sizedLine(lines[2], 'azimut:my-logo', { width: '50%' }, centred)).toBe('![Logo](azimut:my-logo){width=50%}');
    expect(sizedLine(lines[2], 'azimut:my-logo', { align: 'left' }, centred)).toBe('![Logo](azimut:my-logo){width=25% align=left}');
    expect(sizedLine('![Logo](azimut:my-logo){width=25% align=left}', 'azimut:my-logo', { align: 'center' }, centred))
      .toBe('![Logo](azimut:my-logo){width=25%}');
    expect(writeAttrs({ align: 'right' }, { fallback: 'right' })).toBe('');
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
