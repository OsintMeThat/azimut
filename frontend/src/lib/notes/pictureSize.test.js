// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  CAPTION_MAX, PAGE_TALL, PICTURE_SIZES, POSTED_HELP, captionField, cleanCaption, pictureAt, pictureLine, picturesIn, readAttrs, rovingToolbar,
  BLOCK_OPEN, CORNERS, blockAlignAt, blockSide, sameRef, sizeWidth, sizedLine, writeAttrs, sourceField,
  casePictures, isGraphic, nearestSize, pictureReference, postedAddress, replacedLine, storyZoom, withGraphic, withZoom, zoomText,
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

  it('takes a corner block for the side it sits on', () => {
    expect(CORNERS).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
    for (const name of ['left', 'center', 'right', ...CORNERS]) expect(BLOCK_OPEN.test(`::: ${name}`), name).toBe(true);
    expect(BLOCK_OPEN.test('::: middle')).toBe(false);
    expect(BLOCK_OPEN.test('::: top')).toBe(false);
    expect(['top-left', 'bottom-left', 'top-right', 'bottom-right', 'center'].map(blockSide)).toEqual(['left', 'left', 'right', 'right', 'center']);
    const lines = ['::: top-right', '![Logo](azimut:logo){width=25%}', ':::', '::: bottom-left', '![Map](/m.png)', ':::'];
    expect(blockAlignAt(lines, 1)).toBe('right');
    expect(blockAlignAt(lines, 4)).toBe('');
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

  it('go down to a fifth and a tenth of the page, for a small picture or a logo', () => {
    expect(PICTURE_SIZES.map((size) => size.label)).toEqual(['XXS', 'XS', 'S', 'M', 'L', 'Full']);
    expect(sizeWidth(share('xs'), 0.5)).toBe('20%');
    expect(sizeWidth(share('xxs'), 0.5)).toBe('10%');
    // a phone screenshot at a tenth of the page height
    expect(sizeWidth(share('xxs'), 2.16)).toBe('6%');
  });

  it('size a picture whose shape is not known yet as a wide one', () => {
    expect(sizeWidth(share('large'))).toBe('75%');
  });

  it('never write a width the PDF would refuse', () => {
    expect(sizeWidth(share('small'), 500)).toBe('5%');
  });
});

describe('the address field under a picture', () => {
  const keyed = (field, key) => field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('holds the address kept, and an emptied field takes it off', async () => {
    const write = vi.fn(async () => {});
    const done = vi.fn();
    const field = sourceField({ write, done, help: POSTED_HELP, value: 'https://x.com/me/status/1' });
    expect(field.value).toBe('https://x.com/me/status/1');
    expect(field.placeholder).toBe(POSTED_HELP.placeholder);
    field.value = '';
    keyed(field, 'Enter');
    await settle();
    expect(write).toHaveBeenCalledWith('');
    expect(done).toHaveBeenCalledWith('keyboard');
  });

  it('writes nothing for an empty field that held nothing, and refuses what is not an address', async () => {
    const write = vi.fn(async () => {});
    const field = sourceField({ write, done: vi.fn() });
    keyed(field, 'Enter');
    field.value = 'a friend';
    keyed(field, 'Enter');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-label')).toBe('Source');
  });
});

describe('where a proof was posted', () => {
  // the order `urltitles.own_posts` reads them in, so the button and the report agree
  const post = (url, at = '2026-11-09T10:00:00Z') => ({ site: 'x', at, ...(url ? { url } : {}) });

  it('is the address stated on the proof, else the latest post Post was given a link for', () => {
    const posted = [post('https://x.com/me/status/1'), post('https://x.com/me/status/2'), post(null)];
    expect(postedAddress({ attrs: { posted_url: ' https://x.com/me/status/9 ', posted } })).toBe('https://x.com/me/status/9');
    expect(postedAddress({ attrs: { posted_url: '', posted } })).toBe('https://x.com/me/status/2');
    expect(postedAddress({ attrs: { posted: [post(null)] } })).toBe('');
  });

  it('is nothing for a proof never posted, or a record that is not an address', () => {
    expect(postedAddress({ attrs: {} })).toBe('');
    expect(postedAddress(null)).toBe('');
    expect(postedAddress({ attrs: { posted_url: 'a friend', posted: 'yes' } })).toBe('');
    expect(postedAddress({ attrs: { posted: [null, 'x', { url: 'ftp://host/1' }] } })).toBe('');
  });
});

describe('a graphic picture', () => {
  it('is read off its braces as the server reads it, never off a caption or another word', () => {
    expect(isGraphic('graphic')).toBe(true);
    expect(isGraphic('zoom=0.1,0.1,0.5,0.5 graphic')).toBe(true);
    expect(isGraphic('graphics')).toBe(false);
    expect(isGraphic('data-graphic')).toBe(false);
    expect(isGraphic('')).toBe(false);
    // the caption is taken out before: its words never veil a picture
    expect(isGraphic(readAttrs('caption="A graphic scene"').rest)).toBe(false);
  });

  it('is veiled and unveiled on its line alone, everything else in the braces kept as written', () => {
    const line = '[[media:m1|Roof]]{width=50% align=center caption="Smoke" zoom=0.1,0.2,0.3,0.4}';
    const veiled = sizedLine(line, 'media:m1', { graphic: true });
    expect(veiled).toBe('[[media:m1|Roof]]{width=50% align=center caption="Smoke" zoom=0.1,0.2,0.3,0.4 graphic}');
    expect(sizedLine(veiled, 'media:m1', { graphic: false })).toBe(line);
    expect(sizedLine('[[media:m1|Roof]]', 'media:m1', { graphic: true })).toBe('[[media:m1|Roof]]{graphic}');
    expect(sizedLine('[[media:m1|Roof]]{graphic}', 'media:m1', { graphic: false })).toBe('[[media:m1|Roof]]');
    expect(withGraphic('graphic width-ish', true)).toBe('width-ish graphic');
  });
});

describe('a story\'s zoom', () => {
  it('is written to a thousandth, inside the picture, and reads back the same', () => {
    expect(zoomText({ x: 0.25, y: 0.1, w: 0.5, h: 0.4 })).toBe('0.25,0.1,0.5,0.4');
    expect(zoomText({ x: 0.33333, y: 0.66666, w: 0.9, h: 0.5 })).toBe('0.333,0.667,0.667,0.333');
    expect(storyZoom(`zoom=${zoomText({ x: 0.7, y: 0.7, w: 0.31, h: 0.4 })}`)).toEqual({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 });
  });

  it('is set where it was written, else last, and taken out', () => {
    expect(withZoom('graphic', { x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe('graphic zoom=0.1,0.2,0.3,0.4');
    expect(withZoom('zoom=0.5,0.5,0.1,0.1 graphic', { x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe('zoom=0.1,0.2,0.3,0.4 graphic');
    expect(withZoom('zoom=0.5,0.5,0.1,0.1 graphic', null)).toBe('graphic');
    expect(sizedLine('[[media:m1|Roof]]{caption="Yard"}', 'media:m1', { zoom: { x: 0, y: 0, w: 0.5, h: 0.5 } }))
      .toBe('[[media:m1|Roof]]{caption="Yard" zoom=0,0,0.5,0.5}');
  });
});

describe('another picture in its place', () => {
  const SHIP = { id: 'm2', type: 'media', label: 'Ship [at sea]', attrs: { path: 'media/ship.png', kind: 'image' } };

  it('shows the case picture, its size, place, caption, veil and zoom kept', () => {
    expect(replacedLine('[[media:m1|Roof]]{width=50% caption="Smoke" graphic}', 'media:m1', SHIP))
      .toBe('[[media:m2|Ship at sea]]{width=50% caption="Smoke" graphic}');
    expect(replacedLine('[[media:m1|Roof]]', 'media:m1', SHIP)).toBe('[[media:m2|Ship at sea]]');
    expect(replacedLine('[[media:m1|Roof]]', 'media:m9', SHIP)).toBeNull();
  });

  it('turns an image\'s title, which printed as its caption, into its caption', () => {
    expect(replacedLine('![Shot](/files/c1/a.png "The quay"){width=30%}', '/files/c1/a.png', SHIP))
      .toBe('[[media:m2|Ship at sea]]{width=30% caption="The quay"}');
    expect(pictureReference({ id: 'm3', label: '' })).toBe('[[media:m3|Picture]]');
  });

  it('is chosen among the case\'s pictures, found by name or folder, never a video or a record without a file', () => {
    const entities = [
      SHIP,
      { id: 'p1', type: 'proof', label: 'Proof 1', attrs: { path: 'proofs/Proof 1.png', folder: 'Écluse' } },
      { id: 'v1', type: 'media', label: 'Clip', attrs: { path: 'media/clip.mp4', kind: 'video' } },
      { id: 'n1', type: 'note', label: 'Note', attrs: { path: 'notes/n.md' } },
      { id: 'c1', type: 'capture', label: 'Airport', attrs: { path: 'media/a.png', kind: 'image' } },
    ];
    expect(casePictures(entities).map((entity) => entity.id)).toEqual(['c1', 'p1', 'm2']);
    expect(casePictures(entities, 'ecluse').map((entity) => entity.id)).toEqual(['p1']);
    expect(casePictures(entities, 'clip')).toEqual([]);
  });
});

describe('a picture sized by its corner', () => {
  it('snaps to the nearest size, as wide as that size writes', () => {
    expect(nearestSize(0.52).size.id).toBe('medium');
    expect(nearestSize(0.52).width).toBe('50%');
    expect(nearestSize(0.01).size.id).toBe('xxs');
    expect(nearestSize(1.4).size.id).toBe('full');
    // a tall picture: its sizes are narrower, and the drag snaps to them
    const tall = 2;
    expect(nearestSize(0.36, tall)).toEqual({ size: PICTURE_SIZES[3], width: sizeWidth(0.5, tall) });
  });
});
