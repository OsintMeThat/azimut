import { describe, expect, it } from 'vitest';
import { align, distribute, filling, fittedHeight, leastScale, numbered, pasted, pictureOf, placeLabels, sameSize, shortDay, sizedAsOne, tableRows } from './arrange.js';
import { PX_PER_MM, pageMargin, pageSize } from './page.js';
import { project } from './geo.js';
import { readyTemplate } from './gallery.js';

const boxes = [{ id: 'a', box: [10, 10, 20, 10] }, { id: 'b', box: [50, 30, 10, 20] }, { id: 'c', box: [100, 5, 30, 5] }];

describe('laying several elements out', () => {
  it('lines them up on an edge or a middle of the box round them', () => {
    expect(align(boxes, 'left')).toMatchObject({ a: [10, 10, 20, 10], b: [10, 30, 10, 20], c: [10, 5, 30, 5] });
    expect(align(boxes, 'bottom').b[1]).toBe(30);
    expect(align(boxes, 'middle').a[1]).toBe(22.5);
  });

  it('spaces three or more evenly, and gives them the size of the last', () => {
    const spaced = distribute(boxes, 'h');
    expect(spaced.a[0]).toBe(10);
    expect(spaced.c[0]).toBe(100);
    expect(spaced.b[0] - (spaced.a[0] + 20)).toBeCloseTo(spaced.c[0] - (spaced.b[0] + 10), 1);
    expect(distribute(boxes.slice(0, 2), 'h')).toEqual({});
    expect(sameSize(boxes, 'width', boxes[2]).a[2]).toBe(30);
  });

  it('fills the page with a box, to the edges as the Post plate sets its map, or to the margins the guides draw', () => {
    const a4 = { paper: 'a4', orientation: 'landscape' };
    const size = pageSize(a4);
    expect(filling(size)).toEqual([0, 0, 297, 210]);
    expect(filling(size)).toEqual(readyTemplate('post', a4).elements.find((element) => element.id === 'map').box);
    expect(pageMargin(a4)).toBe(9);
    expect(filling(size, pageMargin(a4))).toEqual([9, 9, 279, 192]);
    // an upright page and a square one keep the same margin all round
    expect(filling(pageSize({ paper: 'a4', orientation: 'portrait' }), 9)).toEqual([9, 9, 192, 279]);
    expect(filling({ width: 100, height: 100 }, 6)).toEqual([6, 6, 88, 88]);
    // a margin wider than the page leaves a box of a millimetre at least
    expect(filling({ width: 30, height: 20 }, 50)).toEqual([9.5, 9.5, 11, 1]);
    expect(filling(size, -4)).toEqual([0, 0, 297, 210]);
  });

  it('carries copies to another plate, pointed at its map unless their own came along', () => {
    const copied = [{ id: 'm', kind: 'map', box: [0, 0, 10, 10] }, { id: 's', kind: 'scale', of: 'm', box: [1, 1, 2, 2] },
      { id: 'l', kind: 'legend', of: 'gone', box: [3, 3, 2, 2], group: 'g1' }];
    const out = pasted(copied, 'target', new Set(['target']));
    const map = out.find((item) => item.kind === 'map');
    expect(out.find((item) => item.kind === 'scale').of).toBe(map.id);
    expect(out.find((item) => item.kind === 'legend').of).toBe('target');
    expect(out.every((item) => !['m', 's', 'l'].includes(item.id))).toBe(true);
    expect(out.find((item) => item.kind === 'legend').group).not.toBe('g1');
    expect(pasted([{ id: 'x', kind: 'scale', of: 'gone', box: [0, 0, 1, 1] }], null)).toEqual([]);
  });

  it('places labels so none covers another', () => {
    const placed = placeLabels([{ x: 50, y: 50, width: 20, height: 5 }, { x: 51, y: 50, width: 20, height: 5 }, { x: 50, y: 51, width: 20, height: 5 }]);
    for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) {
      const [a, b] = [placed[i], placed[j]];
      expect(a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]).toBe(false);
    }
  });

  it('fits a box to its words', () => {
    const measure = (line) => line.length * 2;
    const one = fittedHeight({ text: 'short', size: 10, box: [0, 0, 50, 3] }, measure);
    const three = fittedHeight({ text: 'many words that will not fit on a single line at all', size: 10, box: [0, 0, 50, 3] }, measure);
    expect(three).toBeGreaterThan(one * 2);
  });
});

describe('several picked sized as one picture', () => {
  // a comparison's pair as Add › From the case lays it: two maps, a date badge over each, one group
  const view = { lat: 47.5, lon: 34.6, zoom: 15, bearing: 12 };
  const pair = () => [
    { id: 'a', kind: 'map', group: 'g', box: [20, 40, 120, 90], view: { ...view }, width: 1 },
    { id: 'b', kind: 'map', group: 'g', box: [143, 40, 120, 90], view: { ...view } },
    { id: 'ta', kind: 'text', role: 'badge', group: 'g', box: [23, 43, 34, 6.5], size: 7.5, text: '12 Mar 2024' },
    { id: 'tb', kind: 'text', role: 'badge', group: 'g', box: [146, 43, 34, 6.5], size: 7.5, text: 'After' },
  ];
  const ids = ['a', 'b', 'ta', 'tb'];

  it('scales every box from the corner held, and a map\'s zoom with it, so it shows the same ground', () => {
    const { patches } = sizedAsOne(pair(), ids, { from: [20, 40], by: 0.5 });
    expect(patches.a).toEqual({ box: [20, 40, 60, 45], view: { ...view, zoom: 14 }, width: 0.5 });
    // a frame drawn at its usual weight thins with it
    expect(patches.b).toEqual({ box: [81.5, 40, 60, 45], view: { ...view, zoom: 14 }, width: 0.5 });
    expect(patches.ta.box).toEqual([21.5, 41.5, 17, 3.3]);
    expect(patches.tb.box).toEqual([83, 41.5, 17, 3.3]);
    // a point of the ground stands where the picture took it, on the page
    const ground = [34.61, 47.495];
    const onPage = (map, at) => { const [px, py] = project(at.view, { width: at.box[2] * PX_PER_MM, height: at.box[3] * PX_PER_MM }, ground);
      return [at.box[0] + px / PX_PER_MM, at.box[1] + py / PX_PER_MM]; };
    const before = onPage('a', pair()[0]);
    const after = onPage('a', patches.a);
    expect(after[0]).toBeCloseTo(20 + (before[0] - 20) * 0.5, 1);
    expect(after[1]).toBeCloseTo(40 + (before[1] - 40) * 0.5, 1);
    // twice as big from the bottom right corner: two zoom levels' worth is one
    const grown = sizedAsOne(pair(), ids, { from: [263, 130], by: 2 }).patches;
    expect(grown.a.box).toEqual([-223, -50, 240, 180]);
    expect(grown.a.view.zoom).toBe(16);
  });

  it('sizes the words like a picture, in half points, so a shrunk badge never runs past its box', () => {
    const { patches } = sizedAsOne(pair(), ids, { from: [20, 40], by: 0.8 });
    expect(patches.ta.size).toBe(6);
    expect(sizedAsOne(pair(), ids, { from: [20, 40], by: 1.3 }).patches.ta.size).toBe(10);
    // a size the element never set grows from the one it is drawn at, and goes no lower than 4
    const plain = [{ id: 't', kind: 'text', box: [0, 0, 40, 10] }, { id: 'l', kind: 'legend', box: [50, 0, 30, 30] }];
    expect(sizedAsOne(plain, ['t', 'l'], { from: [0, 0], by: 1.5 }).patches.t.size).toBe(15);
    expect(sizedAsOne(plain, ['t', 'l'], { from: [0, 0], by: 1.5 }).patches.l.size).toBe(12);
    expect(sizedAsOne(plain, ['t', 'l'], { from: [0, 0], by: 0.2 }).patches.t.size).toBe(4);
    // a scale bar never lands on the 10 it reads as its own 7
    const bar = [{ id: 's', kind: 'scale', of: 'a', box: [0, 0, 40, 8], size: 8 }, { id: 'x', kind: 'qr', box: [50, 0, 10, 10] }];
    expect(sizedAsOne(bar, ['s', 'x'], { from: [0, 0], by: 1.25 }).patches.s.size).toBe(10.5);
  });

  it('carries what stands on a sized map\'s ground along, and leaves what is locked or on another map', () => {
    const elements = [...pair(),
      { id: 'label', kind: 'label', of: 'a', at: [34.6, 47.5], box: [60, 70, 20, 5], size: 9, text: 'Depot' },
      { id: 'arrow', kind: 'arrow', of: 'a', at: [34.6, 47.5], to: [34.61, 47.51], box: [0, 0, 1, 1], width: 1.2, size: 8 },
      { id: 'symbol', kind: 'symbol', of: 'b', at: [34.6, 47.5], box: [0, 0, 7, 7] },
      { id: 'kept', kind: 'label', of: 'a', at: [34.6, 47.5], box: [30, 100, 20, 5], locked: true },
      { id: 'away', kind: 'zone', of: 'elsewhere', points: [], box: [0, 0, 1, 1] },
      { id: 'scale', kind: 'scale', of: 'a', box: [25, 120, 30, 6] },
    ];
    const { picked, maps, tied } = pictureOf(elements, ids);
    expect(picked.map((item) => item.id)).toEqual(ids);
    expect([...maps]).toEqual(['a', 'b']);
    expect(tied.map((item) => item.id)).toEqual(['label', 'arrow', 'symbol']);
    // a symbol over its point is sized where it shows, the box the page draws for it
    const { patches } = sizedAsOne(elements, ids, { from: [20, 40], by: 0.5, shown: (item) => (item.id === 'symbol' ? [200, 80, 7, 7] : item.box) });
    expect(patches.label).toEqual({ box: [40, 55, 10, 2.5], size: 4.5 });
    expect(patches.arrow).toEqual({ width: 0.6, size: 4 });
    expect(patches.symbol).toEqual({ box: [110, 60, 3.5, 3.5] });
    expect(patches.kept).toBeUndefined();
    expect(patches.away).toBeUndefined();
    // a scale bar reads its map but stands on the page: it is sized only when picked
    expect(patches.scale).toBeUndefined();
    // locked, a map stays as it is, and so does its ground
    const locked = pair().map((item) => (item.id === 'a' ? { ...item, locked: true } : item));
    expect(sizedAsOne(locked, ids, { from: [20, 40], by: 0.5 }).patches.a).toBeUndefined();
  });

  it('follows every framing of a sized map, on each day and slide, and leaves the others\' alone', () => {
    const framing = { '2026-10-03': { a: { ...view, zoom: 12 }, other: { ...view, zoom: 9 } }, s1: { b: { ...view, zoom: 13.5 } }, s2: { other: { ...view, zoom: 7 } } };
    const out = sizedAsOne(pair(), ids, { from: [20, 40], by: 0.5, framing }).framing;
    expect(out['2026-10-03']).toEqual({ a: { ...view, zoom: 11 }, other: { ...view, zoom: 9 } });
    expect(out.s1.b.zoom).toBe(12.5);
    expect(out.s2).toBe(framing.s2);
    expect(framing['2026-10-03'].a.zoom).toBe(12);
    expect(sizedAsOne(pair(), ids, { from: [20, 40], by: 0.5, framing: { s2: framing.s2 } }).framing).toBeNull();
    expect(sizedAsOne(pair(), ids, { from: [20, 40], by: 0.5 }).framing).toBeNull();
  });

  it('keeps an inset on its ground: its own zoom follows, or the one it shows when its map stays', () => {
    const inset = { id: 'i', kind: 'inset', of: 'm', box: [0, 0, 30, 30] };
    const elements = [{ id: 'm', kind: 'map', box: [40, 0, 100, 80], view: { ...view } }, inset, { id: 't', kind: 'text', box: [0, 35, 30, 6] }];
    expect(sizedAsOne(elements, ['i', 't'], { from: [0, 0], by: 2, insetZoom: () => 10.5 }).patches.i).toEqual({ box: [0, 0, 60, 60], zoom: 11.5, width: 2 });
    expect(sizedAsOne([...elements.slice(0, 1), { ...inset, zoom: 6 }, elements[2]], ['i', 't'], { from: [0, 0], by: 0.5 }).patches.i.zoom).toBe(5);
    // with its map in the picture, it follows the map's zoom as it always does
    expect(sizedAsOne(elements, ['m', 'i'], { from: [0, 0], by: 2, insetZoom: () => 10.5 }).patches.i).toEqual({ box: [0, 0, 60, 60], width: 2 });
    // a globe inset is a drawing: its box alone
    expect(sizedAsOne([{ ...inset, globe: true }, elements[2]], ['i', 't'], { from: [0, 0], by: 2, insetZoom: () => 3 }).patches.i).toEqual({ box: [0, 0, 60, 60], width: 2 });
  });

  it('shrinks no picked box under a millimetre, and back at its size writes nothing', () => {
    expect(leastScale(pair(), ids)).toBeCloseTo(1 / 6.5, 5);
    expect(leastScale([{ id: 'x', kind: 'text', box: [0, 0, 0.5, 4] }], ['x'])).toBe(1);
    expect(sizedAsOne(pair(), ids, { from: [20, 40], by: 1 }).patches).toEqual({});
  });
});

describe('what a page writes from its case', () => {
  it('numbers the day\'s numbered labels in page order', () => {
    const elements = [{ id: 'a', kind: 'label', style: 'number', text: 'Depot' }, { id: 'b', kind: 'label', style: 'number', text: 'Gone', onward: '2026-10-01', until: '2026-10-01' },
      { id: 'c', kind: 'label', style: 'bubble', text: 'Not a number' }, { id: 'd', kind: 'label', style: 'number', text: 'Bridge' }];
    expect(numbered(elements, '2026-10-05').map((item) => [item.number, item.text])).toEqual([[1, 'Depot'], [2, 'Bridge']]);
  });

  it('writes a chronology up to the plate\'s day, and the sources once each', () => {
    const features = [
      { properties: { name: 'Strike', date: '2026-10-03', links: ['https://x.com/a/status/1', 'https://t.me/b/2'] } },
      { properties: { name: 'Bridge', states: [{ at: '2026-10-01', status: '' }, { at: '2026-10-06', status: 'destroyed' }], links: ['https://t.me/b/2'] } },
      { properties: { name: 'Undated' } },
    ];
    expect(tableRows({ source: 'events' }, features)).toEqual([['1 Oct 2026', 'Bridge'], ['3 Oct 2026', 'Strike'], ['6 Oct 2026', 'Bridge, destroyed']]);
    expect(tableRows({ source: 'events' }, features, '2026-10-04')).toHaveLength(2);
    expect(tableRows({ source: 'sources' }, features)).toEqual([['x.com', 'https://x.com/a/status/1'], ['t.me', 'https://t.me/b/2']]);
    expect(shortDay('2026-10-12T14:00')).toBe('12 Oct 2026 14:00');
  });
});
