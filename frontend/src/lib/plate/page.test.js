import { describe, expect, it } from 'vitest';
import { facesOf, focusApart, inLook, addStep, beatKey, beatKeys, bornAt, bornOn, bringTo, carryOn, currentStep, dayBefore, DECOR_MAX_PIXELS, decorDensity, duplicatedStep, endOn, framedAs, framingOf, standsOver, TRANSITIONS, transitionsOf, fillTokens, fitPage, fromTemplate, hasSteps, houseLayout,
  labelBox, landingIn, listedOf, longDay, mainMap, mapsFirst, MAX_MAPS, MAX_STEPS, movedStep, restacked, stepOf, onPaper, PAGE, PAGE_ZOOM, pageSize, periodSaid, pickedDays, placeOf, skippedDays, settleOn, shownOn, SIGNATURE, startOn, stepsOf, templateOf,
  turnable, unsettled, withoutMaps, withoutStep, zoomPageAt } from './page.js';

describe('a plate page', () => {
  it('turns its paper as it is set', () => {
    expect(pageSize({ paper: 'a4', orientation: 'landscape' })).toEqual({ width: 297, height: 210 });
    expect(pageSize({ paper: 'a3', orientation: 'portrait' })).toEqual({ width: 297, height: 420 });
    expect(pageSize({ paper: 'screen', orientation: 'landscape' })).toEqual({ width: 338.67, height: 190.5 });
  });

  it('opens on the house layout, every element on the page and reading the one map', () => {
    const spec = houseLayout({ view: { lat: 50, lon: 30, zoom: 9, bearing: 0 }, layers: ['front'] });
    const { width, height } = pageSize(spec.page);
    for (const element of spec.elements) {
      const [x, y, w, h] = element.box;
      expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(width + 0.01); expect(y + h).toBeLessThanOrEqual(height + 0.01);
      if (element.of) expect(element.of).toBe('map');
    }
    expect(mainMap(spec).layers).toEqual([{ name: 'front', hidden: [], stroke: 1, icons: 1 }]);
    // the title names the case by its token, so a template made of it names the next case
    expect(spec.elements.find((element) => element.id === 'title').text).toBe('{case}');
    expect(new Set(spec.elements.map((element) => element.kind))).toEqual(
      new Set(['map', 'text', 'legend', 'inset', 'scale', 'north', 'credits']));
  });

  it('lays the house layout out again on another paper, and upright on an upright one', () => {
    const spec = houseLayout();
    const turned = onPaper(spec, { paper: 'a4', orientation: 'portrait' });
    const map = mainMap(turned).box;
    const legend = turned.elements.find((element) => element.id === 'legend').box;
    // upright, the legend goes under the map rather than beside it
    expect(legend[1]).toBeGreaterThan(map[1] + map[3]);
    expect(map[2]).toBeGreaterThan(pageSize(turned.page).width * 0.8);
    const { width, height } = pageSize(turned.page);
    for (const element of turned.elements) {
      expect(element.box[0] + element.box[2]).toBeLessThanOrEqual(width + 0.01);
      expect(element.box[1] + element.box[3]).toBeLessThanOrEqual(height + 0.01);
    }
  });

  it('keeps what has its own proportions even when the rest of the page stretches', () => {
    const spec = { page: { paper: 'a4', orientation: 'landscape' }, theme: {}, elements: [
      { id: 'big', kind: 'map', box: [10, 10, 100, 80] },
      { id: 'n', kind: 'north', of: 'big', box: [100, 12, 8, 12] },
    ] };
    const moved = onPaper(spec, { paper: 'a4', orientation: 'portrait' });
    const north = moved.elements.find((element) => element.id === 'n').box;
    expect(north[2] / north[3]).toBeCloseTo(8 / 12, 1);
    const map = moved.elements.find((element) => element.id === 'big').box;
    expect(map[2] / 100).toBeCloseTo(210 / 297, 1);
  });

  it('reads a paper typed in and says which papers turn', () => {
    expect(pageSize({ paper: 'custom', size: [120, 80] })).toEqual({ width: 120, height: 80 });
    expect(pageSize({ paper: 'social', orientation: 'portrait' })).toEqual({ width: 216, height: 270 });
    expect(turnable({ paper: 'square' })).toBe(false);
    expect(turnable({ paper: 'custom' })).toBe(false);
    expect(turnable({ paper: 'a4' })).toBe(true);
  });

  it('keeps maps under the writing whatever order they were added in', () => {
    const ordered = mapsFirst([{ id: 't', kind: 'text' }, { id: 'm', kind: 'map' }, { id: 'i', kind: 'inset' }, { id: 'l', kind: 'legend' }]);
    expect(ordered.map((element) => element.id)).toEqual(['m', 'i', 't', 'l']);
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
    expect(again.time).toEqual({ at: null, trail: true, since: null, window: null });
    // how long a day holds goes with the layout, never a day's own time
    const held = templateOf({ ...spec, time: { at: '2026-10-01', hold: 2.5 }, holds: { now: 4 } });
    expect([held.time, held.holds]).toEqual([{ hold: 2.5 }, undefined]);
    expect(fromTemplate(held, {}).time.hold).toBe(2.5);
  });

  it('keeps a logo inside a template, and the signature, but no picture of a case nor what stands on the ground', () => {
    const spec = houseLayout({ view: { lat: 50, lon: 30, zoom: 9, bearing: 0 } });
    spec.elements.push({ id: 'logo', kind: 'image', box: [1, 1, 5, 5], data: 'data:image/png;base64,AAAA' });
    spec.elements.push({ id: 'badge', kind: 'image', box: [1, 1, 5, 5], src: SIGNATURE });
    spec.elements.push({ id: 'photo', kind: 'image', box: [1, 1, 5, 5], src: 'media/photo.jpg', of: 'map', at: [44.2, 15.3] });
    spec.elements.push({ id: 'z', kind: 'zone', box: [0, 0, 1, 1], of: 'map', points: [[0, 0], [1, 0], [1, 1]] });
    spec.elements.push({ id: 'note', kind: 'text', box: [1, 1, 5, 5], text: 'x', onward: '2026-10-01', until: '2026-10-03' });
    const data = templateOf(spec);
    const byId = Object.fromEntries(data.elements.map((element) => [element.id, element]));
    expect(byId.logo.data).toBe('data:image/png;base64,AAAA');
    expect(byId.badge.src).toBe(SIGNATURE);
    expect(byId.photo.src).toBeUndefined();
    // the frame of a picture that pointed at a place stays, never the place
    expect(byId.photo.at).toBeUndefined();
    expect(byId.z).toBeUndefined();
    expect(byId.note.onward).toBeUndefined();
    expect(byId.note.until).toBeUndefined();
  });

  it('fills the words a text stands for', () => {
    const today = new Date('2026-10-14T12:00:00Z');
    expect(longDay('2026-10-12T14:00')).toBe('12 October 2026, 14:00');
    expect(fillTokens('As of {date} · {case} · made {today}', { date: '2026-10-12', caseName: 'Front', today }))
      .toBe('As of 12 October 2026 · Front · made 14 October 2026');
    expect(fillTokens('{date}', { today })).toBe('14 October 2026');
    // no day of its own: the day its layers last changed, rather than a today that would claim too much
    expect(fillTokens('{date}', { today, updated: '2026-09-30' })).toBe('30 September 2026');
    expect(fillTokens('{scale} {handle}', { today, scale: '1:25,000', handle: '@desk' })).toBe('1:25,000 @desk');
    // today is this computer's day, even half an hour after its midnight
    expect(fillTokens('{today}', { today: new Date(2026, 9, 15, 0, 30) })).toBe('15 October 2026');
  });
});

describe('the days an annotation is shown on', () => {
  it('shows an undated one every day, and a dated one through its period only', () => {
    expect(shownOn({}, '2026-10-01')).toBe(true);
    const yesterday = { onward: '2026-10-01', until: '2026-10-01' };
    expect(shownOn(yesterday, '2026-10-01')).toBe(true);
    expect(shownOn(yesterday, '2026-10-02')).toBe(false);
    expect(shownOn(yesterday, null)).toBe(false);
    expect(shownOn({ onward: 'now' }, null)).toBe(true);
    const week = { onward: '2026-10-03', until: '2026-10-10' };
    expect(shownOn(week, '2026-10-02')).toBe(false);
    expect(shownOn(week, '2026-10-06')).toBe(true);
    expect(shownOn(week, '2026-10-11')).toBe(false);
    // open at either end: from the first day, or up to now
    expect(shownOn({ until: '2026-10-10' }, '2020-01-01')).toBe(true);
    expect(shownOn({ onward: '2026-10-03' }, null)).toBe(true);
  });

  it('lasts the whole of a last day given without its time', () => {
    const day = { onward: '2026-10-15', until: '2026-10-15' };
    expect(shownOn(day, '2026-10-15T14:30')).toBe(true);
    expect(shownOn(day, '2026-10-16T00:00')).toBe(false);
    const minute = { onward: '2026-10-15T09:00', until: '2026-10-15T12:00' };
    expect(shownOn(minute, '2026-10-15T14:30')).toBe(false);
    expect(shownOn(minute, '2026-10-15T10:00')).toBe(true);
  });

  it('is born on the day it is made on a played plate, every day on another', () => {
    expect(bornOn('2026-10-01', true)).toEqual({ onward: '2026-10-01', until: '2026-10-01' });
    expect(bornOn(null, true)).toEqual({ onward: PAGE, until: null });
    expect(bornOn('2026-10-01', false)).toEqual({});
  });

  it('takes a first and a last day, the other end pulled along when they would cross', () => {
    const made = { id: 'a', onward: '2026-10-03', until: '2026-10-05' };
    expect(startOn(made, '2026-10-01')).toMatchObject({ onward: '2026-10-01', until: '2026-10-05' });
    expect(startOn(made, '2026-10-09')).toMatchObject({ onward: '2026-10-09', until: '2026-10-09' });
    expect(startOn(made, '')).toMatchObject({ onward: null, until: '2026-10-05' });
    expect(startOn(made, 'now')).toMatchObject({ onward: 'now', until: null });
    expect(endOn(made, '2026-10-12')).toMatchObject({ onward: '2026-10-03', until: '2026-10-12' });
    expect(endOn(made, '2026-10-01')).toMatchObject({ onward: '2026-10-01', until: '2026-10-01' });
    // up to now is no end at all, and both ends open is every day
    expect(endOn(made, 'now')).toMatchObject({ onward: '2026-10-03', until: null });
    expect(shownOn(endOn(startOn(made, ''), ''), '2030-01-01')).toBe(true);
  });

  it('is stretched to another day with the days between, or carried from a day on', () => {
    const made = { id: 'a', onward: '2026-10-01', until: '2026-10-01' };
    const later = bringTo(made, '2026-10-05');
    expect(later).toMatchObject({ onward: '2026-10-01', until: '2026-10-05' });
    expect(shownOn(later, '2026-10-03')).toBe(true);
    expect(bringTo({ onward: '2026-10-05', until: '2026-10-09' }, '2026-10-02')).toMatchObject({ onward: '2026-10-02', until: '2026-10-09' });
    expect(bringTo(made, null)).toMatchObject({ onward: '2026-10-01', until: null });
    expect(bringTo(made, '2026-10-01')).toBe(made);
    const on = carryOn({ onward: '2026-10-05', until: '2026-10-06' }, '2026-10-03');
    expect(on).toMatchObject({ onward: '2026-10-03', until: null });
    expect(shownOn(on, '2026-10-02')).toBe(false);
    expect(shownOn(on, null)).toBe(true);
    expect(carryOn(made, '2026-10-09')).toMatchObject({ onward: '2026-10-01', until: null });
  });

  it('says its days in a few words', () => {
    const label = (day) => day.replace('2026-10-', '') + ' Oct';
    expect(periodSaid({}, label)).toBe('Every day');
    expect(periodSaid({ onward: PAGE }, label)).toBe('Only on the page');
    expect(periodSaid({ onward: '2026-10-03', until: '2026-10-03' }, label)).toBe('Only on 03 Oct');
    expect(periodSaid({ onward: '2026-10-03' }, label)).toBe('From 03 Oct on');
    expect(periodSaid({ until: '2026-10-10' }, label)).toBe('Up to 10 Oct');
    expect(periodSaid({ onward: '2026-10-03', until: '2026-10-10' }, label)).toBe('03 Oct to 10 Oct');
  });

  it('orders the page after every day', () => {
    expect(dayBefore('2026-10-01', 'now')).toBe(true);
    expect(dayBefore('now', '2026-10-01')).toBe(false);
    expect(dayBefore('2026-10-01', '2026-10-01T09:00')).toBe(true);
  });
});

describe('a plate put on a day', () => {
  const old = () => ({
    time: { at: null, trail: true },
    steps: { now: [{ id: 'n1' }], '2026-10-15': [{ id: 'd1' }] },
    holds: { now: 4 },
    framing: { now: { map: { lat: 1, lon: 2, zoom: 9, bearing: 0 } }, n1: { map: { lat: 3, lon: 4, zoom: 9, bearing: 0 } } },
    elements: [
      { id: 'made-now', kind: 'label', onward: 'now', until: null },
      { id: 'up-to-now', kind: 'label', onward: '2026-10-01', until: 'now' },
      { id: 'every-day', kind: 'label' },
      { id: 'of-a-step', kind: 'text', step: 'n1' },
    ],
  });

  it('is unsettled while it stands on no day or keeps anything under its page', () => {
    expect(unsettled(old())).toBe(true);
    expect(unsettled({ time: { at: '2026-10-15' }, steps: {}, elements: [] })).toBe(false);
    expect(unsettled({ time: { at: '2026-10-15' }, holds: { now: 2 }, elements: [] })).toBe(true);
    expect(unsettled({ time: { at: '2026-10-15' }, elements: [{ id: 'a', onward: 'now' }] })).toBe(true);
  });

  it('takes the day it was last saved, with what stood on now moved there', () => {
    const spec = old();
    const settled = { ...spec, ...settleOn(spec, '2026-10-15') };
    expect(settled.time.at).toBe('2026-10-15');
    // the page's steps after the day's own, its seconds and framing where the day had none
    expect(settled.steps).toEqual({ '2026-10-15': [{ id: 'd1' }, { id: 'n1' }] });
    expect(settled.holds).toEqual({ '2026-10-15': 4 });
    expect(Object.keys(settled.framing).sort()).toEqual(['2026-10-15', 'n1']);
    const byId = Object.fromEntries(settled.elements.map((element) => [element.id, element]));
    // made on now, an annotation is that day's alone; up to now, it runs on
    expect([byId['made-now'].onward, byId['made-now'].until]).toEqual(['2026-10-15', '2026-10-15']);
    expect([byId['up-to-now'].onward, byId['up-to-now'].until]).toEqual(['2026-10-01', null]);
    expect(byId['every-day']).toEqual({ id: 'every-day', kind: 'label' });
    expect(byId['of-a-step'].step).toBe('n1');
    expect(unsettled(settled)).toBe(false);
  });

  it('keeps the day it already stands on, and the day\'s own seconds and framing first', () => {
    const spec = { ...old(), time: { at: '2026-10-20' }, holds: { now: 4, '2026-10-12': 2 },
      framing: { now: { map: { lat: 1 }, inset: { lat: 5 } }, '2026-10-12': { map: { lat: 9 } } } };
    const settled = settleOn(spec, '2026-10-12');
    expect(settled.time.at).toBe('2026-10-20');
    expect(settled.holds).toEqual({ '2026-10-12': 2 });
    expect(settled.framing['2026-10-12']).toEqual({ map: { lat: 9 }, inset: { lat: 5 } });
  });

  it('drops what belonged to a step cut off by the most a day holds', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ id: `d${index}` }));
    const spec = { time: {}, steps: { now: [{ id: 'late' }], '2026-10-15': many }, elements: [{ id: 'x', kind: 'text', step: 'late' }] };
    const settled = settleOn(spec, '2026-10-15');
    expect(settled.steps['2026-10-15']).toHaveLength(30);
    expect(settled.elements).toEqual([]);
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

  it('measures its words in its own face when it can, and a number is a round badge', () => {
    const wide = labelBox({ box: [0, 0, 1, 1], text: 'Depot', size: 9, style: 'plain' }, () => 40);
    const narrow = labelBox({ box: [0, 0, 1, 1], text: 'Depot', size: 9, style: 'plain' }, () => 10);
    expect(wide[2]).toBeGreaterThan(narrow[2]);
    const badge = labelBox({ box: [5, 5, 30, 8], text: 'A long note behind the number', size: 9, style: 'number' });
    expect(badge[2]).toBe(badge[3]);
  });
});

describe('the page on the screen', () => {
  it('fits the window centred, a margin round it', () => {
    const camera = fitPage({ width: 1000, height: 500 }, { width: 548, height: 548 });
    expect(camera.scale).toBeCloseTo(0.5);
    expect(camera.x).toBeCloseTo(24);
    expect(camera.y).toBeCloseTo(149);
  });

  it('keeps clear the top a floating bar stands on', () => {
    const camera = fitPage({ width: 1000, height: 1000 }, { width: 1048, height: 1048 }, 24, 100);
    expect(camera.scale).toBeCloseTo(0.9);
    expect(camera.y).toBeCloseTo(124);
    expect(camera.x).toBeCloseTo(74);
  });

  it('zooms round the pointer, which keeps the paper under it, within its bounds', () => {
    const camera = { scale: 0.5, x: 24, y: 149 };
    const next = zoomPageAt(camera, 2, [124, 199]);
    expect(next.scale).toBe(1);
    // the paper point under the pointer before is under it after
    expect((124 - next.x) / next.scale).toBeCloseTo((124 - camera.x) / camera.scale);
    expect((199 - next.y) / next.scale).toBeCloseTo((199 - camera.y) / camera.scale);
    expect(zoomPageAt(camera, 1000, [0, 0]).scale).toBe(PAGE_ZOOM.max);
    expect(zoomPageAt(camera, 0.001, [0, 0]).scale).toBe(PAGE_ZOOM.min);
  });

  it('draws the page sharp at the zoom it is shown at, in steps, within a pixel budget', () => {
    const a4 = { width: 794, height: 1123 };
    // at or under its true size, the screen's own density, as before
    expect(decorDensity(a4, 0.6, 2)).toBe(2);
    expect(decorDensity(a4, 1, 1)).toBe(1);
    // zoomed in, at least what the screen shows, in steps of √2
    const zoomed = decorDensity(a4, 1.7, 1);
    expect(zoomed).toBeGreaterThanOrEqual(1.7);
    expect(Math.log(zoomed) / Math.log(Math.SQRT2)).toBeCloseTo(Math.round(Math.log(zoomed) / Math.log(Math.SQRT2)));
    // a small move of the wheel keeps the same drawing
    expect(decorDensity(a4, 1.75, 1)).toBe(zoomed);
    // never past the budget, never under the screen's density
    const deep = decorDensity(a4, 8, 2);
    expect(a4.width * a4.height * deep * deep).toBeLessThanOrEqual(DECOR_MAX_PIXELS + 1);
    expect(decorDensity({ width: 20000, height: 20000 }, 4, 2)).toBe(2);
  });
});

describe('a look', () => {
  it('sets the page and every map, and a look that is not grey gives the imagery its colour back', () => {
    const spec = houseLayout();
    spec.elements[0].basemap = 'esri-world-imagery';
    const grey = inLook(spec, 'mono');
    expect(grey.theme).toMatchObject({ ink: '#000000', preset: 'mono' });
    expect(mainMap(grey).tone.saturation).toBe(-1);
    const back = inLook(grey, 'press');
    expect(mainMap(back).tone).toEqual({ opacity: 1, saturation: 0, brightness: 1, contrast: 0, hue: 0 });
    // the imagery stays the ground it was; a plain ground takes the look's
    expect(mainMap(back).basemap).toBe('esri-world-imagery');
    const night = inLook(houseLayout(), 'night');
    expect(mainMap(night).basemap).toBe('plain-dark');
    expect(night.elements.find((element) => element.kind === 'north').fill).toBe('#12161b');
  });
});


describe('the steps of a day', () => {
  const plate = () => ({
    time: { at: '2026-10-15', step: 's2' },
    steps: { '2026-10-15': [{ id: 's1', duration: 3 }, { id: 's2', duration: 3 }, { id: 's3', duration: 3 }], now: [{ id: 'n1' }] },
    elements: [
      { id: 'title', kind: 'text' },
      { id: 'one', kind: 'label', step: 's1' },
      { id: 'kept', kind: 'label', step: 's1', carry: true },
      { id: 'two', kind: 'video', step: 's2' },
    ],
  });

  it('shows a step\'s own elements on it, a carried one on the steps after, and the day\'s on every step', () => {
    const spec = plate();
    const on = (id, step) => shownOn(spec.elements.find((element) => element.id === id), '2026-10-15', placeOf(spec, '2026-10-15', step));
    expect(['title', 'one', 'kept', 'two'].map((id) => on(id, null))).toEqual([true, false, false, false]);
    expect(['title', 'one', 'kept', 'two'].map((id) => on(id, 's1'))).toEqual([true, true, true, false]);
    expect(['title', 'one', 'kept', 'two'].map((id) => on(id, 's2'))).toEqual([true, false, true, true]);
    // another day never shows a step's element, even a carried one
    expect(shownOn(spec.elements[2], '2026-10-16', placeOf(spec, '2026-10-16', null))).toBe(false);
    // without a place (the legend's days, an old caller) a step's element is not shown
    expect(shownOn(spec.elements[1], '2026-10-15')).toBe(false);
  });

  it('knows the step shown only while its day holds it', () => {
    const spec = plate();
    expect(currentStep(spec, '2026-10-15').id).toBe('s2');
    expect(currentStep(spec, '2026-10-16')).toBeNull();
    expect(stepsOf(spec, null).map((step) => step.id)).toEqual(['n1']);
    expect(hasSteps(spec)).toBe(true);
    expect(hasSteps({ steps: { now: [] } })).toBe(false);
  });

  it('adds a step after the one shown, or first, and moves one by its place', () => {
    const spec = plate();
    const after = addStep(spec, '2026-10-15', 's1', { id: 'new', name: '', duration: 3 });
    expect(after.steps['2026-10-15'].map((step) => step.id)).toEqual(['s1', 'new', 's2', 's3']);
    expect(addStep({}, null, null, { id: 'first' }).steps).toEqual({ now: [{ id: 'first' }] });
    expect(movedStep(spec, '2026-10-15', 's3', 0)['2026-10-15'].map((step) => step.id)).toEqual(['s3', 's1', 's2']);
    expect(movedStep(spec, '2026-10-15', 's1', 3)['2026-10-15'].map((step) => step.id)).toEqual(['s2', 's3', 's1']);
  });

  it('takes a step away with what stands on it, and lets go of a day left without steps', () => {
    const gone = withoutStep(plate(), 's2');
    expect(gone.elements.map((element) => element.id)).toEqual(['title', 'one', 'kept']);
    expect(gone.time.step).toBeNull();
    expect(withoutStep(plate(), 'n1').steps.now).toBeUndefined();
  });

  it('refuses a step on a full day rather than let the last one fall off', () => {
    const full = { steps: { '2026-10-15': Array.from({ length: MAX_STEPS }, (_, index) => ({ id: `s${index}` })) } };
    expect(addStep(full, '2026-10-15', 's3')).toBeNull();
  });

  it('takes a map standing on a step along with it, and all that hangs on the map', () => {
    const map = (id, more = {}) => ({ id, kind: 'map', ...more });
    const spec = { time: {}, steps: { now: [{ id: 's1' }, { id: 's2' }] }, framing: { s2: { main: {}, onstep: {} } }, elements: [
      map('main'), map('onstep', { step: 's1', carry: true }), { id: 'legend', kind: 'legend', of: 'onstep' }, { id: 'credits', kind: 'credits', of: 'onstep' }] };
    const gone = withoutStep(spec, 's1');
    expect(gone.framing).toEqual({ s2: { main: {} } });
    expect(gone.elements.map((element) => element.id)).toEqual(['main', 'credits']);
    expect(gone.elements[1].of).toBe('main');
  });

  it('makes a new element on the step shown, else on the day', () => {
    expect(bornAt('2026-10-15', true, 's2')).toEqual({ step: 's2', carry: false, onward: null, until: null });
    expect(bornAt('2026-10-15', true, null)).toEqual(bornOn('2026-10-15', true));
  });

  it('leaves steps and videos out of a template', () => {
    const data = templateOf({ page: {}, theme: {}, elements: plate().elements });
    expect(data.elements.map((element) => element.id)).toEqual(['title']);
    expect(data.steps).toBeUndefined();
  });
});

describe('the order of the page', () => {
  // page order, bottom first: two maps, then the writing; `hers` waits on step s1
  const plate = () => ({
    time: { at: '2026-10-15', step: 's2' },
    steps: { '2026-10-15': [{ id: 's1' }, { id: 's2' }] },
    elements: [
      { id: 'map', kind: 'map' }, { id: 'inset', kind: 'inset' },
      { id: 'legend', kind: 'legend' }, { id: 'hers', kind: 'label', step: 's1' }, { id: 'title', kind: 'text' }, { id: 'north', kind: 'north' },
    ],
  });
  const ids = (elements) => elements.map((element) => element.id);
  const listed = (spec) => listedOf(spec, '2026-10-15', placeOf(spec, '2026-10-15', 's2'));

  it('lists the writing on top and the maps under it, leaving another step\'s elements out', () => {
    expect(ids(listed(plate()))).toEqual(['north', 'title', 'legend', 'inset', 'map']);
  });

  it('moves a row above the one it is let go on, the left-out ones keeping their places', () => {
    const spec = plate();
    // the legend to the top
    expect(ids(restacked(spec.elements, listed(spec), 'legend', 0))).toEqual(['map', 'inset', 'hers', 'title', 'north', 'legend']);
    // the north arrow down under the title: the label of the other step stays between them as it was
    expect(ids(restacked(spec.elements, listed(spec), 'north', 2))).toEqual(['map', 'inset', 'legend', 'north', 'hers', 'title']);
    // let go where it stands, nothing moves
    expect(restacked(spec.elements, listed(spec), 'title', 1)).toBe(spec.elements);
    expect(restacked(spec.elements, listed(spec), 'title', 2)).toBe(spec.elements);
  });

  it('keeps the writing above the maps and a map among them, wherever it is let go', () => {
    const spec = plate();
    const list = listed(spec);
    expect(landingIn(list, 'north', 5)).toBe(3);
    expect(landingIn(list, 'map', 0)).toBe(3);
    expect(ids(restacked(spec.elements, list, 'north', 5))).toEqual(['map', 'inset', 'north', 'legend', 'hers', 'title']);
    expect(ids(restacked(spec.elements, list, 'map', 0))).toEqual(['inset', 'map', 'legend', 'hers', 'title', 'north']);
  });

  it('steps a row forward or back among what the list shows, and says when it can go no further', () => {
    const list = listed(plate());
    expect(stepOf(list, 'title', 1)).toBe(0);
    expect(stepOf(list, 'title', -1)).toBe(3);
    expect(stepOf(list, 'north', 1)).toBeNull();
    expect(stepOf(list, 'legend', -1)).toBeNull();
    expect(stepOf(list, 'inset', 1)).toBeNull();
    expect(stepOf(list, 'inset', -1)).toBe(5);
    expect(stepOf(list, 'map', -1)).toBeNull();
    expect(stepOf(list, 'hers', 1)).toBeNull();
  });
});

describe('the days a plate\'s video skips', () => {
  it('skips a day in order, once, and plays it again', () => {
    const spec = { skipped: ['2026-10-20'] };
    expect(skippedDays(spec, '2026-10-12', true)).toEqual(['2026-10-12', '2026-10-20']);
    expect(skippedDays({ skipped: ['2026-10-12'] }, '2026-10-12', true)).toEqual(['2026-10-12']);
    expect(skippedDays(spec, '2026-10-20', false)).toEqual([]);
    expect(skippedDays({}, PAGE, true)).toEqual([]);
  });
});

describe('the days a plate is told to play', () => {
  it('adds a day in order, once, and lets it go', () => {
    const spec = { days: ['2026-10-20'] };
    expect(pickedDays(spec, '2026-10-12', true)).toEqual(['2026-10-12', '2026-10-20']);
    expect(pickedDays({ days: ['2026-10-12'] }, '2026-10-12', true)).toEqual(['2026-10-12']);
    expect(pickedDays(spec, '2026-10-20', false)).toEqual([]);
    expect(pickedDays({}, PAGE, true)).toEqual([]);
  });
  it('is no part of a template', () => {
    expect(templateOf({ page: {}, theme: {}, time: {}, days: ['2026-10-12'], elements: [] }).days).toBeUndefined();
  });
});

describe('a map framed day by day', () => {
  const map = { id: 'map', kind: 'map', view: { lat: 1, lon: 1, zoom: 5, bearing: 0 } };
  const near = { lat: 2, lon: 2, zoom: 9, bearing: 10 };
  const order = ['2026-10-01', 's1', 's2', '2026-10-02'];

  it('keeps the map\'s own view on the first day, and the framing before it on the next', () => {
    const spec = { framing: {} };
    expect(framingOf(spec, map, order, '2026-10-01')).toEqual({ view: map.view, own: false, first: true });
    expect(framingOf(spec, map, order, 's2')).toEqual({ view: map.view, own: false, first: false });
    // a day the play does not go through shows, and frames, the map's own view
    expect(framingOf(spec, map, order, 'now').first).toBe(true);
  });

  it('frames a step its own way, and the steps after it follow until one frames it too', () => {
    const spec = { framing: framedAs({}, 's1', 'map', near) };
    expect(framingOf(spec, map, order, 's1')).toEqual({ view: near, own: true, first: false });
    expect(framingOf(spec, map, order, 's2')).toEqual({ view: near, own: false, first: false });
    expect(framingOf(spec, map, order, '2026-10-01').view).toBe(map.view);
    // let go, the step keeps the one before it again, and nothing is left of it
    expect(framedAs(spec, 's1', 'map', null)).toEqual({});
  });

  it('names a day or a step as its framing is kept, in the order a play goes through them', () => {
    expect(beatKey('2026-10-01', null)).toBe('2026-10-01');
    expect(beatKey(null, null)).toBe('now');
    expect(beatKey('2026-10-01', 's1')).toBe('s1');
    expect(beatKeys([{ day: '2026-10-01', step: null }, { day: '2026-10-01', step: 's1' }])).toEqual(['2026-10-01', 's1']);
  });

  it('forgets a step\'s framing with the step', () => {
    const spec = { steps: { now: [{ id: 's1' }] }, framing: { s1: { map: near }, now: { map: near } }, elements: [], time: {} };
    expect(Object.keys(withoutStep(spec, 's1').framing)).toEqual(['now']);
  });

  it('forgets a map\'s framings with the map, on every day and step', () => {
    const spec = { framing: { s1: { map: near, detail: near }, '2026-10-01': { detail: near } }, elements: [{ id: 'map', kind: 'map' }, { id: 'detail', kind: 'map', of: 'map' }] };
    const { framing, elements } = withoutMaps(spec, ['detail']);
    expect(framing).toEqual({ s1: { map: near } });
    expect(elements.map((element) => element.id)).toEqual(['map']);
  });

  it('lets what reads a map gone go with it, moves the credits to a map left and frees a detail', () => {
    const spec = { elements: [{ id: 'map', kind: 'map' }, { id: 'other', kind: 'map' }, { id: 'detail', kind: 'map', of: 'map' },
      { id: 'legend', kind: 'legend', of: 'map' }, { id: 'credits', kind: 'credits', of: 'map' }] };
    const { elements } = withoutMaps(spec, ['map']);
    expect(elements).toEqual([{ id: 'other', kind: 'map' }, { id: 'detail', kind: 'map', of: null }, { id: 'credits', kind: 'credits', of: 'other' }]);
    // no other map to credit: the credits go too
    expect(withoutMaps({ elements: [spec.elements[0], spec.elements[4]] }, ['map']).elements).toEqual([]);
  });

  it('copies no step that would hold one map too many', () => {
    const maps = Array.from({ length: MAX_MAPS - 1 }, (_, index) => ({ id: `m${index}`, kind: 'map' }));
    const spec = { steps: { now: [{ id: 's1' }] }, elements: [...maps, { id: 'onstep', kind: 'map', step: 's1' }] };
    expect(duplicatedStep(spec, null, 's1')).toBeNull();
    expect(duplicatedStep({ ...spec, elements: spec.elements.slice(1) }, null, 's1')).not.toBeNull();
  });

  it('settles a page past what a day holds with nothing left hanging on the steps that go', () => {
    const steps = (length, prefix) => Array.from({ length }, (_, index) => ({ id: `${prefix}${index}` }));
    const spec = { time: {}, steps: { now: steps(MAX_STEPS, 'p'), '2026-10-15': steps(1, 'd') }, framing: { [`p${MAX_STEPS - 1}`]: { map: near } },
      elements: [{ id: 'map', kind: 'map' }, { id: 'lost', kind: 'text', step: `p${MAX_STEPS - 1}` }, { id: 'kept', kind: 'text', step: 'p0' }] };
    const settled = settleOn(spec, '2026-10-15');
    expect(settled.steps['2026-10-15']).toHaveLength(MAX_STEPS);
    expect(settled.framing).toEqual({});
    expect(settled.elements.map((element) => element.id)).toEqual(['map', 'kept']);
  });
});

describe('the video\'s transitions', () => {
  it('are off until asked for, and fill in what a plate leaves out', () => {
    expect(transitionsOf({})).toEqual(TRANSITIONS);
    expect(TRANSITIONS.on).toBe(false);
    expect(transitionsOf({ transitions: { on: true, blur: false } })).toEqual({ ...TRANSITIONS, on: true, blur: false });
  });

  it('go with a template, as part of how its plates look', () => {
    const spec = { page: { paper: 'a4' }, theme: {}, elements: [], transitions: { on: true, seconds: 1.2 } };
    expect(templateOf(spec).transitions).toEqual({ on: true, seconds: 1.2 });
    expect(fromTemplate(templateOf(spec), {}).transitions).toEqual({ on: true, seconds: 1.2 });
  });
});

describe('a text on the map', () => {
  it('is a label without a leader, tied to its point', () => {
    expect(standsOver({ kind: 'label', leader: 'none', at: [1, 2], of: 'map' })).toBe(true);
    expect(standsOver({ kind: 'label', leader: 'straight', at: [1, 2], of: 'map' })).toBe(false);
    // a symbol stands over its point too
    expect(standsOver({ kind: 'symbol', at: [1, 2], of: 'map' })).toBe(true);
    expect(standsOver({ kind: 'symbol', of: 'map' })).toBe(false);
    expect(standsOver({ kind: 'text', leader: 'none', at: [1, 2], of: 'map' })).toBe(false);
  });

  it('can be set in a survey\'s or a staff map\'s look, on their topographic grounds', () => {
    const spec = houseLayout({});
    expect(inLook(spec, 'survey').elements.find((element) => element.id === 'map').basemap).toBe('plain-topo');
    expect(inLook(spec, 'staff').elements.find((element) => element.id === 'map').basemap).toBe('plain-staff');
  });
});

describe('the faces a plate writes in', () => {
  it('names its own face and each element\'s, in every weight and in italic, for the browser to load', () => {
    const faces = facesOf({ theme: { font: 'serif' }, elements: [{ id: 'a', kind: 'text', font: 'plexmono' }, { id: 'b', kind: 'text' }] });
    expect(faces).toContain('700 16px "Source Serif 4", "Noto Sans Arabic"');
    expect(faces).toContain('italic 400 16px "IBM Plex Mono", "Noto Sans Arabic"');
    expect(faces).toHaveLength(8);
  });
});

describe('a plate saved while the focus was the map\'s own', () => {
  it('moves each map\'s focus onto its ground as an element, on every day and step as it was', () => {
    const elements = [{ id: 'map', kind: 'map', spotlight: { country: 'Ukraine', dim: 0.4, mode: 'fade' } }, { id: 'other', kind: 'map' },
      { id: 't', kind: 'text', spotlight: { country: 'Nowhere' } }];
    const moved = focusApart(elements);
    expect(moved[0]).toEqual({ id: 'map', kind: 'map' });
    expect(moved[1]).toMatchObject({ kind: 'focus', of: 'map', name: 'Ukraine', spotlight: { country: 'Ukraine', dim: 0.4, mode: 'fade' } });
    expect(moved[1].step).toBeUndefined();
    expect(moved.slice(2)).toEqual(elements.slice(1));
    // a plate with none is handed back as it is
    expect(focusApart(elements.slice(1))).toEqual(elements.slice(1));
  });
});
