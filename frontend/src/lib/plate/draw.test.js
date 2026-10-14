import { describe, expect, it, vi } from 'vitest';
import { drawPage, wrap } from './draw.js';
import { houseLayout } from './page.js';

/** A canvas context that records what is written and drawn, measuring a character as 5 pixels. */
function recorder() {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  const ctx = new Proxy({ canvas: { width: 1123, height: 794 }, calls, measureText: (text) => ({ width: String(text).length * 5 }) }, {
    get(target, key) { return key in target ? target[key] : record(key); },
    set(target, key, value) { target[key] = value; return true; },
  });
  return ctx;
}

describe('drawing a plate page', () => {
  it('wraps text to its box and keeps its breaks', () => {
    expect(wrap({ measureText: (text) => ({ width: text.length * 5 }) }, 'one two three\nfour', 40)).toEqual(['one two', 'three', 'four']);
  });

  it('draws every element of the house layout, the words filled and the credits forced', () => {
    const spec = houseLayout({ view: { lat: 48.85, lon: 2.35, zoom: 10, bearing: 0 }, title: 'Front' });
    spec.elements.push({ id: 'l', kind: 'label', box: [60, 60, 30, 8], of: 'map', at: [2.36, 48.86], text: 'Depot', style: 'bubble' });
    spec.elements.push({ id: 'a', kind: 'arrow', box: [0, 0, 1, 1], of: 'map', at: [2.3, 48.8], to: [2.4, 48.9], width: 1.2 });
    const ctx = recorder();
    const markerImage = vi.fn(() => ({ width: 64, height: 64 }));
    drawPage(ctx, spec, {
      scale: 3.78, paper: true,
      views: { map: { view: spec.elements[0].view, frame: { width: 700, height: 600 } },
        inset: { view: { lat: 48.85, lon: 2.35, zoom: 5, bearing: 0 }, frame: { width: 200, height: 150 } } },
      legend: { map: [{ key: 'front/Lines', label: 'Front line', kind: 'line', colour: '#d55e00' },
        { key: 'front/Posts', label: 'Posts', kind: 'point', colour: '#0072b2', symbol: 'badge-tank' },
        { key: 'gained', label: 'Gained since 3 Oct', kind: 'gained', colour: '#15181e' }] },
      credits: { map: '© OpenMapTiles' },
      markerImage,
      tokens: { date: '2026-10-12', caseName: 'Kupiansk', today: new Date('2026-10-14T00:00:00Z') },
    });
    const written = ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    expect(written).toEqual(expect.arrayContaining(['Front', 'Situation as of 12 October 2026', 'Legend', 'Front line',
      'Kupiansk', '© OpenMapTiles', 'N', 'Depot']));
    expect(markerImage).toHaveBeenCalledWith('badge-tank', '#0072b2', { status: '' });
    // the paper first, then the frames and the rest over it
    expect(ctx.calls[0][0]).toBe('fillRect');
  });

  it('draws a map\'s picture under everything else when exporting', () => {
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    const ctx = recorder();
    const picture = { width: 10, height: 10 };
    drawPage(ctx, spec, { scale: 10, paper: true, maps: { map: picture }, views: {} });
    const first = ctx.calls.findIndex(([name, image]) => name === 'drawImage' && image === picture);
    const firstText = ctx.calls.findIndex(([name]) => name === 'fillText');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(firstText);
  });
});
