import { describe, expect, it } from 'vitest';
import { align, distribute, fittedHeight, numbered, pasted, placeLabels, sameSize, shortDay, tableRows } from './arrange.js';

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
