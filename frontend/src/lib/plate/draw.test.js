import { describe, expect, it, vi } from 'vitest';
import { drawPage, partOf, smoothThrough, wrap } from './draw.js';
import { PX_PER_MM, houseLayout } from './page.js';
import world from './world.json';

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
    const spec = houseLayout({ view: { lat: 48.85, lon: 2.35, zoom: 10, bearing: 0 } });
    spec.elements.push({ id: 'l', kind: 'label', box: [60, 60, 30, 8], of: 'map', at: [2.36, 48.86], text: 'Depot', style: 'bubble' });
    spec.elements.push({ id: 'a', kind: 'arrow', box: [0, 0, 1, 1], of: 'map', at: [2.3, 48.8], to: [2.4, 48.9], width: 1.2 });
    const ctx = recorder();
    const markerImage = vi.fn(() => ({ width: 64, height: 64 }));
    drawPage(ctx, spec, {
      scale: 3.78, paper: true,
      views: { map: { view: spec.elements[0].view, frame: { width: 700, height: 600 } },
        inset: { view: { lat: 48.85, lon: 2.35, zoom: 5, bearing: 0 }, frame: { width: 200, height: 150 } } },
      legend: { legend: [{ key: 'front/Lines', label: 'Front line', kind: 'line', colour: '#d55e00' },
        { key: 'front/Posts', label: 'Posts', kind: 'point', colour: '#0072b2', symbol: 'badge-tank' },
        { key: 'gained', label: 'Gained since 3 Oct', kind: 'gained', colour: '#15181e' }] },
      credits: { credits: '© OpenMapTiles' },
      markerImage,
      tokens: { date: '2026-10-12', caseName: 'Kupiansk', today: new Date('2026-10-14T00:00:00Z') },
    });
    const written = ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    expect(written).toEqual(expect.arrayContaining(['Kupiansk', 'Situation as of 12 October 2026', 'Legend', 'Front line',
      '© OpenMapTiles', 'N', 'Depot']));
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

  it('leaves the editor\'s placeholders out of an export', () => {
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    spec.elements.push({ id: 'pic', kind: 'image', box: [10, 10, 20, 20] });
    const drawn = (editing) => {
      const ctx = recorder();
      drawPage(ctx, spec, { scale: 3, paper: !editing, editing, views: {}, legend: {} });
      return ctx;
    };
    const said = (ctx) => ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    expect(said(drawn(true))).toContain('What the map draws is listed here');
    expect(said(drawn(false))).not.toContain('What the map draws is listed here');
    const dashed = (ctx) => ctx.calls.some(([name, pattern]) => name === 'setLineDash' && pattern?.length);
    expect(dashed(drawn(true))).toBe(true);
    expect(dashed(drawn(false))).toBe(false);
  });

  it('draws an annotation only on its days, another day\'s faintly in the editor when asked', () => {
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    spec.elements.push({ id: 'note', kind: 'text', box: [10, 10, 40, 8], text: 'Shelling reported', onward: '2026-10-01', until: '2026-10-01' });
    const said = (context) => {
      const ctx = recorder();
      drawPage(ctx, spec, { scale: 3, views: {}, legend: {}, ...context });
      return ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    };
    expect(said({ at: '2026-10-01' })).toContain('Shelling reported');
    expect(said({ at: '2026-10-02' })).not.toContain('Shelling reported');
    expect(said({ at: '2026-10-02', editing: true, ghosts: true })).toContain('Shelling reported');
  });

  it('says which boxes their words run past, and never cuts the credits', () => {
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    spec.elements.push({ id: 'tight', kind: 'text', box: [10, 10, 10, 3], text: 'A sentence far too long for the room it has', size: 10 });
    const credits = spec.elements.find((element) => element.kind === 'credits');
    credits.box = [credits.box[0], credits.box[1], 20, 2];
    const ctx = recorder();
    const ran = drawPage(ctx, spec, { scale: 3, views: {}, legend: {}, credits: { credits: 'Esri, Maxar, Earthstar Geographics · OpenFreeMap © OpenMapTiles' } });
    expect(ran.has('tight')).toBe(true);
    expect(ran.has(credits.id)).toBe(true);
    const written = ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text).join(' ');
    // every word of the credits is written, however small the box
    for (const word of ['Esri,', 'Maxar,', 'OpenFreeMap', 'OpenMapTiles']) expect(written).toContain(word);
  });

  it('says the height a legend needs when its rows run past its box, so the box can be fitted to them', () => {
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    const legend = spec.elements.find((element) => element.kind === 'legend');
    legend.box = [legend.box[0], legend.box[1], legend.box[2], 20];
    const rows = Array.from({ length: 12 }, (_, index) => ({ key: `l/${index}`, label: `Row ${index}`, kind: 'point', colour: '#c8102e', symbol: 'pin' }));
    const ran = drawPage(recorder(), spec, { scale: 3, views: {}, legend: { [legend.id]: rows }, credits: {} });
    const needs = ran.get(legend.id);
    expect(needs).toBeGreaterThan(20);
    // fitted to that height, it fits
    legend.box = [legend.box[0], legend.box[1], legend.box[2], needs];
    expect(drawPage(recorder(), spec, { scale: 3, views: {}, legend: { [legend.id]: rows }, credits: {} }).has(legend.id)).toBe(false);
  });

  it('sets the credits over a map on a plain band rather than a halo, which blurs letters this small', () => {
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    const map = spec.elements.find((element) => element.kind === 'map');
    const credits = spec.elements.find((element) => element.kind === 'credits');
    credits.box = [map.box[0] + 5, map.box[1] + map.box[3] - 6, map.box[2] - 10, 5];
    const ctx = recorder();
    drawPage(ctx, spec, { scale: 3, views: {}, legend: {}, credits: { credits: '© OpenMapTiles' } });
    const at = ctx.calls.findIndex(([name, text]) => name === 'fillText' && text === '© OpenMapTiles');
    expect(at).toBeGreaterThan(-1);
    expect(ctx.calls.some(([name, text]) => name === 'strokeText' && text === '© OpenMapTiles')).toBe(false);
    // the band is laid just before the words, about as wide as them
    const band = ctx.calls.slice(0, at).findLast(([name]) => name === 'fillRect');
    expect(band[3]).toBeGreaterThan('© OpenMapTiles'.length * 5);
    expect(band[3]).toBeLessThan('© OpenMapTiles'.length * 5 + 20);
  });

  it('draws what stands on the ground: a zone with its spotlight, rings, a cone, a distance, a curved arrow', () => {
    const spec = houseLayout({ view: { lat: 48.85, lon: 2.35, zoom: 12, bearing: 0 } });
    const view = spec.elements[0].view;
    spec.elements.push(
      { id: 'z', kind: 'zone', of: 'map', box: [0, 0, 1, 1], points: [[2.34, 48.84], [2.36, 48.84], [2.35, 48.86]], look: 'hatch', mask: { on: true, darkness: 0.5 }, text: 'Area' },
      { id: 'r', kind: 'ring', of: 'map', box: [0, 0, 1, 1], at: [2.35, 48.85], radii: [1, 2] },
      { id: 'c', kind: 'cone', of: 'map', box: [0, 0, 1, 1], at: [2.35, 48.85], bearing: 45, spread: 40, reach: 1 },
      { id: 'd', kind: 'measure', of: 'map', box: [0, 0, 1, 1], at: [2.34, 48.85], to: [2.36, 48.85] },
      { id: 'a', kind: 'arrow', of: 'map', box: [0, 0, 1, 1], at: [2.34, 48.84], to: [2.36, 48.86], bend: 0.4, heads: 'both', shape: 'offensive', text: 'Advance' },
    );
    const ctx = recorder();
    drawPage(ctx, spec, { scale: 3, views: { map: { view, frame: { width: 700, height: 600 } } }, legend: {} });
    const written = ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    expect(written).toEqual(expect.arrayContaining(['Area', '1.0 km', '2.0 km', 'Advance']));
    expect(written.some((text) => /^1\.\d km · 9\d°$/.test(text))).toBe(true);
    // the spotlight dims round the zone with one even-odd fill
    expect(ctx.calls.some(([name, rule]) => name === 'fill' && rule === 'evenodd')).toBe(true);
  });

  it('draws a QR code for a link, and the numbered list of the day\'s numbered labels', () => {
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    spec.elements.push({ id: 'q', kind: 'qr', box: [10, 10, 20, 20], text: 'https://example.org/report' });
    spec.elements.push({ id: 'k', kind: 'key', box: [40, 10, 50, 30], text: 'Sites' });
    const ctx = recorder();
    drawPage(ctx, spec, { scale: 3, views: {}, legend: {}, numbered: [{ id: 'l1', number: 1, text: 'Depot' }, { id: 'l2', number: 2, text: 'Bridge' }] });
    const squares = ctx.calls.filter(([name]) => name === 'fillRect').length;
    expect(squares).toBeGreaterThan(100);
    const written = ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    expect(written).toEqual(expect.arrayContaining(['Sites', '1', 'Depot', '2', 'Bridge']));
  });

  it('signs the page with the analyst\'s picture and words, and says it was made with Azimut', () => {
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    spec.elements.push({ id: 's', kind: 'signature', box: [200, 190, 60, 10], text: '{handle}', size: 7, align: 'right' });
    spec.elements.push({ id: 'b', kind: 'brand', box: [240, 200, 50, 5], text: 'Made with', size: 6, align: 'right' });
    const picture = { width: 200, height: 100 };
    const traced = [];
    const ctx = recorder();
    globalThis.Path2D = class { constructor(d) { traced.push(d); } };
    try {
      drawPage(ctx, spec, { scale: 3, views: {}, legend: {}, images: new Map([['@signature', picture]]), tokens: { handle: '@desk' } });
    } finally { delete globalThis.Path2D; }
    expect(ctx.calls.some(([name, image]) => name === 'drawImage' && image === picture)).toBe(true);
    const written = ctx.calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    expect(written).toEqual(expect.arrayContaining(['@desk', 'Made with']));
    // the mark's two flanks and the wordmark's letters, from the app's own paths
    expect(traced).toContain('M12 1.8 5.8 21.4 12 16.4Z');
    expect(traced.length).toBeGreaterThan(5);
  });

  it('sets the Made with lockup tight, without the air of the app\'s corner', async () => {
    const { signatureWidth } = await import('../brandMark.js');
    expect(signatureWidth(10, { tight: true })).toBeLessThan(signatureWidth(10) * 0.8);
    const spec = houseLayout({ view: { lat: 0, lon: 0, zoom: 4, bearing: 0 } });
    spec.elements.push({ id: 'b', kind: 'brand', box: [100, 100, 60, 5], text: 'Made with', size: 6, align: 'left' });
    const ctx = recorder();
    globalThis.Path2D = class {};
    try {
      drawPage(ctx, spec, { scale: 3, views: {}, legend: {} });
    } finally { delete globalThis.Path2D; }
    // the mark's air hangs left of the words' end, so its flank starts right after the space
    const lead = 'Made with '.length * 5;
    const shift = ctx.calls.find(([name, x]) => name === 'translate' && x < 300 + lead && x > 290);
    expect(shift).toBeTruthy();
  });
});


describe('what stands on the ground, written and drawn', () => {
  const view = { lat: 48.85, lon: 2.35, zoom: 12, bearing: 0 };
  const base = () => {
    const spec = houseLayout({ view });
    spec.elements = spec.elements.filter((element) => element.kind === 'map');
    return spec;
  };
  const context = (spec, extra = {}) => ({ scale: 3, views: { map: { view, frame: { width: 700, height: 600 } } }, legend: {}, ...extra });

  it('draws a line through its points, curved when asked, its heads at its end and its words along it', () => {
    const spec = base();
    spec.elements.push({ id: 'l', kind: 'line', of: 'map', box: [0, 0, 1, 1], points: [[2.33, 48.84], [2.35, 48.86], [2.37, 48.85]],
      shape: 'curve', heads: 'end', line: 'dashed', text: 'Road', ink: '#123456' });
    const ctx = recorder();
    drawPage(ctx, spec, context(spec));
    const lines = ctx.calls.filter(([name]) => name === 'lineTo').length;
    // a curve through three points is drawn smooth, many short strokes rather than two
    expect(lines).toBeGreaterThan(10);
    expect(ctx.calls.some(([name, dash]) => name === 'setLineDash' && dash.length === 2)).toBe(true);
    expect(ctx.calls.some(([name, text]) => name === 'fillText' && text === 'Road')).toBe(true);
    expect(ctx.fillStyle).toBe('#123456');
  });

  it('sets words on the ground in their own weight, case and backing', () => {
    const spec = base();
    spec.elements.push({ id: 'z', kind: 'zone', of: 'map', box: [0, 0, 1, 1], points: [[2.34, 48.84], [2.36, 48.84], [2.36, 48.86]], text: 'Depot',
      weight: 400, upper: true, back: 'box', fill: '#eeeeee' });
    const ctx = recorder();
    const fonts = [];
    const proxy = new Proxy(ctx, { set(target, key, value) { if (key === 'font') fonts.push(value); target[key] = value; return true; } });
    drawPage(proxy, spec, context(spec));
    expect(ctx.calls.some(([name, text]) => name === 'fillText' && text === 'DEPOT')).toBe(true);
    // a box behind them, no halo round them
    expect(ctx.calls.some(([name, text]) => name === 'strokeText' && text === 'DEPOT')).toBe(false);
    expect(fonts.some((value) => value.startsWith('400 '))).toBe(true);
  });

  it('stands a symbol over its point, drawn at the size it prints at, turned, and cut at its map', () => {
    const spec = base();
    spec.elements.push({ id: 's', kind: 'symbol', of: 'map', box: [0, 0, 8, 8], at: [view.lon, view.lat], symbol: 'badge-tank', colour: '#123456',
      status: 'damaged', rotate: 30 });
    const asked = [];
    const picture = { width: 128, height: 128 };
    const ctx = recorder();
    drawPage(ctx, spec, context(spec, { markerImage: (...args) => { asked.push(args); return picture; } }));
    // the marker the case's layers draw, as large as its box prints
    expect(asked).toEqual([['badge-tank', '#123456', { status: 'damaged' }, 24]]);
    const map = spec.elements.find((element) => element.id === 'map').box.map((value) => value * 3);
    const at = ctx.calls.findIndex(([name, x, y]) => name === 'translate' && Math.abs(x - (map[0] + 350 * (3 / PX_PER_MM))) < 1e-6
      && Math.abs(y - (map[1] + 300 * (3 / PX_PER_MM))) < 1e-6);
    expect(at).toBeGreaterThan(0);
    expect(ctx.calls.slice(at)).toEqual(expect.arrayContaining([['rotate', Math.PI / 6], ['drawImage', picture, -12, -12, 24, 24]]));
    expect(ctx.calls.slice(0, at).some(([name]) => name === 'clip')).toBe(true);
  });

  it('cuts what stands on the ground at its map\'s frame, its words with it', () => {
    const spec = base();
    // a zone far off the frame, its words in the middle of it
    spec.elements.push({ id: 'z', kind: 'zone', of: 'map', box: [0, 0, 1, 1], points: [[8, 48], [8.2, 48], [8.1, 48.2]], text: 'Far away' });
    const ctx = recorder();
    drawPage(ctx, spec, context(spec));
    // the clips standing when the words are written, through the saves and restores before them
    const written = ctx.calls.findIndex(([name, text]) => name === 'fillText' && text === 'Far away');
    expect(written).toBeGreaterThan(0);
    let clips = [];
    const saved = [];
    let path = [];
    for (const [name, ...args] of ctx.calls.slice(0, written)) {
      if (name === 'save') saved.push(clips);
      else if (name === 'restore') clips = saved.pop() ?? [];
      else if (name === 'beginPath') path = [];
      else if (name === 'rect') path.push(args);
      else if (name === 'clip') clips = [...clips, ...path];
    }
    const map = spec.elements.find((element) => element.id === 'map').box.map((value) => value * 3);
    expect(clips.some((rect) => rect.every((value, at) => Math.abs(value - map[at]) < 1e-6))).toBe(true);
  });

  it('brings in what a transition reveals: faded, or drawn as far as it has gone', () => {
    const spec = base();
    spec.elements.push({ id: 'a', kind: 'arrow', of: 'map', box: [0, 0, 1, 1], at: [2.33, 48.84], to: [2.37, 48.86] });
    const alphas = [];
    const ctx = recorder();
    const proxy = new Proxy(ctx, { set(target, key, value) { if (key === 'globalAlpha') alphas.push(value); target[key] = value; return true; } });
    drawPage(proxy, spec, context(spec, { reveal: { ids: new Set(['a']), t: 0.25, mode: 'fade' } }));
    expect(alphas).toContain(0.25);
    const drawn = recorder();
    drawPage(drawn, spec, context(spec, { reveal: { ids: new Set(['a']), t: 0.25, mode: 'draw' } }));
    const whole = recorder();
    drawPage(whole, spec, context(spec));
    const reach = (rec) => Math.max(...rec.calls.filter(([name]) => name === 'lineTo').map(([, x]) => x));
    expect(reach(drawn)).toBeLessThan(reach(whole));
    // nothing yet at the very start
    const none = recorder();
    drawPage(none, spec, context(spec, { reveal: { ids: new Set(['a']), t: 0, mode: 'draw' } }));
    expect(none.calls.filter(([name]) => name === 'lineTo')).toHaveLength(0);
  });

  it('places the ground through a map\'s own camera when it is in 3D, and gives it no scale', () => {
    const spec = base();
    spec.elements.push({ id: 'n', kind: 'label', of: 'map', box: [10, 10, 20, 6], at: [2.35, 48.85], leader: 'none', style: 'plain', text: 'Ridge' });
    spec.elements.push({ id: 's', kind: 'scale', of: 'map', box: [5, 5, 40, 6] });
    const project = vi.fn(() => [100, 50]);
    const ctx = recorder();
    drawPage(ctx, spec, { scale: 3, legend: {}, views: { map: { view: { ...view, pitch: 60 }, frame: { width: 700, height: 600 }, project } } });
    expect(project).toHaveBeenCalledWith([2.35, 48.85]);
    // the text stands over its point: its middle where the camera puts the point
    const written = ctx.calls.find(([name, text]) => name === 'fillText' && text === 'Ridge');
    expect(written).toBeTruthy();
    // a tilted map has no length that holds across it
    expect(ctx.calls.some(([name, text]) => name === 'fillText' && text === '0')).toBe(false);
  });
});

describe('the drawing of lines', () => {
  it('takes the part of a line a share of its length reaches', () => {
    expect(partOf([[0, 0], [10, 0], [10, 10]], 0.75)).toEqual([[0, 0], [10, 0], [10, 5]]);
    expect(partOf([[0, 0], [10, 0]], 1)).toEqual([[0, 0], [10, 0]]);
  });

  it('runs a curve through every point it is given', () => {
    const through = [[0, 0], [10, 10], [20, 0]];
    const curve = smoothThrough(through, 4);
    for (const point of through) expect(curve.some(([x, y]) => Math.abs(x - point[0]) < 1e-9 && Math.abs(y - point[1]) < 1e-9)).toBe(true);
    expect(curve.length).toBe(9);
  });

  it('draws the rest of the world back round a country lit, under a soft edge, and nothing on a tilted map', () => {
    const spec = houseLayout({ view: { lat: 49, lon: 31, zoom: 5, bearing: 0 } });
    const map = spec.elements.find((element) => element.kind === 'map');
    map.spotlight = { country: 'Ukraine', dim: 0.5, mode: 'dark' };
    const views = { [map.id]: { view: map.view, frame: { width: 700, height: 500 } } };
    // the shade is made on a sheet apart: the lit areas cut out of it, then the sheet laid over the map, blurred
    const sheet = recorder();
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => sheet }) });
    try {
      const ctx = recorder();
      drawPage(ctx, spec, { scale: 3, views, legend: {}, credits: {}, world });
      expect(sheet.globalCompositeOperation).toBe('source-over');
      expect(sheet.calls.filter(([name]) => name === 'fill')).toHaveLength(2);
      expect(ctx.calls.some(([name, picture]) => name === 'drawImage' && picture?.getContext)).toBe(true);
      const tiltedCtx = recorder();
      drawPage(tiltedCtx, spec, { scale: 3, views: { [map.id]: { ...views[map.id], view: { ...map.view, pitch: 40 } } }, legend: {}, credits: {}, world });
      expect(tiltedCtx.calls.some(([name, picture]) => name === 'drawImage' && picture?.getContext)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});
