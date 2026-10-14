import { describe, expect, it } from 'vitest';
import { fillTokens, fromTemplate, houseLayout, labelBox, longDay, mainMap, onPaper, pageSize, templateOf } from './page.js';

describe('a plate page', () => {
  it('turns its paper as it is set', () => {
    expect(pageSize({ paper: 'a4', orientation: 'landscape' })).toEqual({ width: 297, height: 210 });
    expect(pageSize({ paper: 'a3', orientation: 'portrait' })).toEqual({ width: 297, height: 420 });
    expect(pageSize({ paper: 'screen', orientation: 'landscape' })).toEqual({ width: 338.67, height: 190.5 });
  });

  it('opens on the house layout, every element on the page and reading the one map', () => {
    const spec = houseLayout({ view: { lat: 50, lon: 30, zoom: 9, bearing: 0 }, layers: ['front'], title: 'Front' });
    const { width, height } = pageSize(spec.page);
    for (const element of spec.elements) {
      const [x, y, w, h] = element.box;
      expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(width + 0.01); expect(y + h).toBeLessThanOrEqual(height + 0.01);
      if (element.of) expect(element.of).toBe('map');
    }
    expect(mainMap(spec).layers).toEqual([{ name: 'front', hidden: [], stroke: 1 }]);
    expect(spec.elements.find((element) => element.id === 'title').text).toBe('Front');
    expect(new Set(spec.elements.map((element) => element.kind))).toEqual(
      new Set(['map', 'text', 'legend', 'inset', 'scale', 'north', 'credits']));
  });

  it('keeps each element its share of the page on another paper', () => {
    const spec = houseLayout();
    const moved = onPaper(spec, { paper: 'a3', orientation: 'landscape' });
    const before = mainMap(spec).box;
    const after = mainMap(moved).box;
    expect(after[2] / before[2]).toBeCloseTo(420 / 297, 1);
    expect(after[3] / before[3]).toBeCloseTo(297 / 210, 1);
  });

  it('takes the data out of a template and puts a case\'s back in', () => {
    const spec = houseLayout({ view: { lat: 50, lon: 30, zoom: 9, bearing: 0 }, layers: ['front'] });
    spec.elements.push({ id: 'l', kind: 'label', box: [1, 1, 5, 5], of: 'map', at: [30, 50], text: 'Depot' });
    const data = templateOf(spec);
    expect(data.elements.some((element) => element.kind === 'label')).toBe(false);
    expect(mainMap(data).view).toBeUndefined();
    expect(mainMap(data).layers).toBeUndefined();
    const again = fromTemplate(data, { view: { lat: 1, lon: 2, zoom: 3, bearing: 0 }, layers: ['a', 'b'] });
    expect(mainMap(again).view).toEqual({ lat: 1, lon: 2, zoom: 3, bearing: 0 });
    expect(mainMap(again).layers.map((layer) => layer.name)).toEqual(['a', 'b']);
    expect(again.time).toEqual({ at: null, trail: true, since: null, window: 7 });
  });

  it('fills the words a text stands for', () => {
    const today = new Date('2026-10-14T12:00:00Z');
    expect(longDay('2026-10-12T14:00')).toBe('12 October 2026, 14:00');
    expect(fillTokens('As of {date} · {case} · made {today}', { date: '2026-10-12', caseName: 'Front', today }))
      .toBe('As of 12 October 2026 · Front · made 14 October 2026');
    expect(fillTokens('{date}', { today })).toBe('14 October 2026');
  });
});

describe('a label', () => {
  it('takes the room its words need, framed ones a little more', () => {
    const plain = labelBox({ box: [10, 20, 1, 1], text: 'Depot', size: 9, style: 'plain' });
    const framed = labelBox({ box: [10, 20, 1, 1], text: 'Depot', size: 9, style: 'bubble' });
    expect(plain.slice(0, 2)).toEqual([10, 20]);
    expect(framed[2]).toBeGreaterThan(plain[2]);
    expect(labelBox({ box: [0, 0, 1, 1], text: 'One\nTwo', size: 9 })[3]).toBeGreaterThan(plain[3]);
  });
});
