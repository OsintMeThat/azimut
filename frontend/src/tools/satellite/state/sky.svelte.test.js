// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createSkyState, usableDate } from './sky.svelte.js';

/**
 * Sun & moon, apart from the map it draws on.
 *
 * The geometry has its own tests (lib/skyOverlay.js); what is asserted here is
 * the point the reading is taken from, the hour it is taken at, and what does
 * and does not reach the map.
 */

const PARIS = { lat: 48.85, lon: 2.35 };
const KYIV = { lat: 50.45, lon: 30.52 };

/** A day of samples, on the hour, with both bodies up in the middle of it. */
function skyFor(date = '2026-06-21') {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const arc = (peak) => hours.map((h) => peak * Math.sin(((h - 6) / 12) * Math.PI));
  return {
    date,
    zone: { name: 'Europe/Paris', abbreviation: 'CEST' },
    moment: { local: `${date}T09:40` },
    moon: { waxing: true, phase: 'waxing gibbous' },
    curve: {
      minutes: hours.map((h) => h * 60),
      clock: hours.map((h) => `${String(h).padStart(2, '0')}:00`),
      sun_azimuth: hours.map((h) => (h * 15) % 360),
      sun_altitude: arc(60),
      moon_azimuth: hours.map((h) => (h * 15 + 180) % 360),
      moon_altitude: arc(40),
      moon_illuminated: hours.map(() => 0.6),
    },
  };
}

let api;
let notify;
let layer;
let surface;
let engine;
let asked;

function store() {
  return createSkyState({
    engine: () => engine,
    api,
    notify,
    colour: (_name, fallback) => fallback,
    surface,
  });
}

beforeEach(() => {
  asked = [];
  notify = vi.fn();
  api = {
    get: vi.fn(async (path) => {
      asked.push(path);
      return skyFor();
    }),
  };
  layer = { set: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
  surface = vi.fn(() => layer);
  engine = { viewSpanMeters: () => ({ across: 4000, down: 3000 }) };
});

describe('the anchor', () => {
  it('opens on the point it is handed when nothing is planted yet', () => {
    const s = store();
    s.open(PARIS);
    expect(s.anchor).toEqual(PARIS);
  });

  it('keeps the planted point across a close, rather than following the view', () => {
    const s = store();
    s.open(PARIS);
    s.close();
    s.open(KYIV); // the map has since drifted
    expect(s.anchor).toEqual(PARIS);
  });

  it('takes a map click only while placing is armed', () => {
    const s = store();
    s.open(PARIS);
    expect(s.place(KYIV)).toBe(false);
    expect(s.anchor).toEqual(PARIS);

    s.togglePlacing();
    expect(s.place(KYIV)).toBe(true);
    expect(s.anchor).toEqual(KYIV);
    // …and one click is one anchor: the mode disarms itself
    expect(s.placing).toBe(false);
  });

  it('drops the reading when the point moves, so nothing stale is drawn', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    expect(s.sky).not.toBe(null);

    s.togglePlacing();
    s.place(KYIV);
    expect(s.sky).toBe(null);
  });
});

describe('reading the sky', () => {
  it('asks about the anchored point, not the view', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    expect(asked[0]).toContain(`lat=${PARIS.lat}`);
    expect(asked[0]).toContain(`lon=${PARIS.lon}`);
  });

  it('leaves the date out until one is chosen, so the backend says what today is there', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    expect(asked[0]).not.toContain('date=');
    expect(s.day).toBe('2026-06-21'); // …and the answer names it

    s.setDay('2026-01-05');
    await s.load();
    expect(asked[1]).toContain('date=2026-01-05');
  });

  it('never phones out with no point planted', async () => {
    const s = store();
    await s.load();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('never phones out while closed', async () => {
    const s = store();
    s.open(PARIS);
    s.close();
    await s.load();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('lands the slider on the moment the answer names', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    expect(s.sky.curve.clock[s.index]).toBe('10:00'); // 09:40 rounds to the nearer sample
  });

  it('says so when the sky cannot be read, and stops loading', async () => {
    api.get = vi.fn(async () => {
      throw new Error('offline');
    });
    const s = store();
    s.open(PARIS);
    await s.load();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Could not read the sky'), 'danger');
    expect(s.loading).toBe(false);
  });

  it('lets a late answer land nowhere once the point has moved on', async () => {
    const pending = [];
    api.get = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
    const s = store();
    s.open(PARIS);
    const abandoned = s.load();
    s.setDay('2026-09-09');
    const current = s.load();

    pending[1](skyFor('2026-09-09'));
    await current;
    pending[0](skyFor('2026-03-01')); // …and only now does the first one answer
    await abandoned;

    expect(s.day).toBe('2026-09-09');
    expect(s.loading).toBe(false);
  });
});

describe('a point handed over by another tool', () => {
  it('opens the mode on it, with the date it came with', () => {
    const s = store();
    s.handOff({ ...KYIV, date: '2026-02-14', time: '17:00' });
    expect(s.on).toBe(true);
    expect(s.anchor).toEqual(KYIV);
    expect(s.day).toBe('2026-02-14');
  });

  it('lands the slider on the hour that was asked about, not the current one', async () => {
    const s = store();
    s.handOff({ ...KYIV, date: '2026-06-21', time: '17:00' });
    await s.load();
    expect(s.sky.curve.clock[s.index]).toBe('17:00');
  });

  it('spends that clock once: the next day is read at its own hour', async () => {
    const s = store();
    s.handOff({ ...KYIV, date: '2026-06-21', time: '17:00' });
    await s.load();
    s.setDay('2026-06-22');
    await s.load();
    expect(s.sky.curve.clock[s.index]).toBe('10:00'); // the moment the answer names
  });
});

describe('what reaches the map', () => {
  it('draws nothing before the map is up', async () => {
    engine = null;
    const s = store();
    s.open(PARIS);
    await s.load();
    s.draw();
    expect(surface).not.toHaveBeenCalled();
  });

  it('clears the layer instead of drawing when the mode is off', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    s.draw();
    expect(layer.set).toHaveBeenCalled();

    s.close();
    s.draw();
    expect(layer.clear).toHaveBeenCalled();
  });

  it('marks the anchor, and rides each body on its own ray', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    s.draw();
    const shapes = layer.set.mock.calls.at(-1)[0];
    expect(shapes.filter((shape) => shape.kind === 'dot')).toHaveLength(1);
    // one mark per body, both up at the sample the slider landed on
    expect(shapes.filter((shape) => shape.kind === 'marker')).toHaveLength(2);
  });

  it('draws no mark for a body under the horizon — a dashed ray already says where it is', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    s.setIndex(0); // midnight: both bodies are down
    s.draw();
    const shapes = layer.set.mock.calls.at(-1)[0];
    expect(shapes.filter((shape) => shape.kind === 'marker')).toHaveLength(0);
    expect(shapes.some((shape) => shape.style?.dash === '6 6')).toBe(true);
  });

  it('sizes the arc off the shorter side of the view, so it fits a wide window', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    s.draw();
    const wide = layer.set.mock.calls.at(-1)[0];

    engine = { viewSpanMeters: () => ({ across: 40000, down: 3000 }) };
    s.destroy();
    const tall = store();
    tall.open(PARIS);
    await tall.load();
    tall.draw();
    // the same 3000 m short side either way: the same arc
    expect(layer.set.mock.calls.at(-1)[0][0].points).toEqual(wide[0].points);
  });

  it('draws one layer, however many times it is redrawn', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    s.draw();
    s.setIndex(12);
    s.draw();
    expect(surface).toHaveBeenCalledTimes(1);
  });
});

describe('teardown', () => {
  it('takes its layer off the map', async () => {
    const s = store();
    s.open(PARIS);
    await s.load();
    s.draw();
    s.destroy();
    expect(layer.destroy).toHaveBeenCalled();
  });

  it('is safe on a store that never drew anything', () => {
    expect(() => store().destroy()).not.toThrow();
  });
});

describe('a shadow, read only when asked for', () => {
  const FOOT = { lat: 48.85, lon: 2.35 };
  const TIP = { lat: 48.85, lon: 2.3502 }; // about 15 m east
  const MOMENT = { local: '2026-06-21T14:12:05+02:00', abbreviation: 'CEST', height_m: 23.4, sun_azimuth: 270, sun_altitude: 41.2 };
  let made;
  let picture;
  let answer;

  /** A store whose layers are each their own, and whose backend answers the sky and the shadow. */
  function shadowStore() {
    made = [];
    surface = vi.fn(() => {
      const one = { set: vi.fn(), clear: vi.fn(), destroy: vi.fn(), patch: vi.fn() };
      made.push(one);
      return one;
    });
    api.get = vi.fn(async (path) => {
      asked.push(path);
      if (path.startsWith('/api/geo/shadow')) return answer;
      return skyFor(new URLSearchParams(path.split('?')[1]).get('date') ?? undefined);
    });
    return createSkyState({
      engine: () => engine,
      api,
      notify,
      pictureDate: () => picture,
      units: () => 'metric',
      coords: (lat, lon) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      colour: (_name, fallback) => fallback,
      surface,
    });
  }

  const shadowAsked = () => asked.filter((path) => path.startsWith('/api/geo/shadow'));
  const query = (path) => new URLSearchParams(path.split('?')[1]);
  const shadowLayer = () => made[1];

  /** Open on the foot, the day read, then the shadow put down and answered. */
  async function traced(s) {
    s.open(FOOT);
    await s.load();
    s.draw();
    s.traceShadow();
    s.place(FOOT);
    s.place(TIP);
    await vi.waitFor(() => expect(s.shadow.answered).toBe(true));
  }

  beforeEach(() => {
    picture = null;
    answer = { date: '2026-06-21', moments: [MOMENT] };
  });

  it('asks nothing and draws no layer for it until it is asked for', async () => {
    const s = shadowStore();
    s.open(FOOT);
    await s.load();
    s.draw();
    expect(s.shadow).toBe(null);
    expect(s.place(TIP)).toBe(false);
    expect(surface).toHaveBeenCalledTimes(1);
    expect(shadowAsked()).toEqual([]);
  });

  it('takes the foot, then the tip, and reads the hour on the day and in the zone of the sky', async () => {
    const s = shadowStore();
    s.open(FOOT);
    await s.load();
    s.traceShadow();
    expect(s.tracing).toBe('foot');
    expect(s.place(FOOT)).toBe(true);
    expect(s.tracing).toBe('tip');
    expect(s.shadow).toMatchObject({ step: 'tip', traced: false });
    expect(s.place(TIP)).toBe(true);
    expect(s.tracing).toBe(null);
    await vi.waitFor(() => expect(s.shadow.answered).toBe(true));
    const [path] = shadowAsked();
    expect(query(path).get('date')).toBe('2026-06-21');
    expect(query(path).get('zone')).toBe('Europe/Paris');
    expect(Number(query(path).get('bearing'))).toBeCloseTo(90, 0);
    expect(Number(query(path).get('length'))).toBeCloseTo(14.7, 0);
    expect(s.shadow.moments).toEqual([{ clock: '14:12', zone: 'CEST', height: '23 m', sun: 'sun at 270°, 41.2° up' }]);
    // the slider goes to that hour, so the sun's ray lines up with the shadow
    expect(s.index).toBe(14);
  });

  it('puts the slider back on an hour of the shadow when it is pressed', async () => {
    answer = { date: '2026-06-21', moments: [MOMENT, { ...MOMENT, local: '2026-06-21T17:02:00+02:00', height_m: 9 }] };
    const s = shadowStore();
    await traced(s);
    s.showMoment(1);
    expect(s.index).toBe(17);
    s.setIndex(3);
    s.showMoment(0);
    expect(s.index).toBe(14);
  });

  it('reads it on the imagery’s day, and says so when the imagery has none', async () => {
    picture = '2024-03-02';
    const s = shadowStore();
    s.open(FOOT);
    await s.load();
    s.traceShadow();
    expect(s.day).toBe('2024-03-02');
    expect(s.sky).toBe(null);
    expect(s.shadow.noDay).toBe(false);
    s.place(FOOT);
    s.place(TIP);
    // the tip waits for that day's sky, then the shadow is read on it
    expect(shadowAsked()).toEqual([]);
    await s.load();
    await vi.waitFor(() => expect(shadowAsked()).toHaveLength(1));
    expect(query(shadowAsked()[0]).get('date')).toBe('2024-03-02');

    picture = '2021';
    const other = shadowStore();
    other.open(FOOT);
    await other.load();
    other.traceShadow();
    expect(other.day).toBe('2026-06-21');
    expect(other.shadow.noDay).toBe(true);
  });

  it('reads it again for another day', async () => {
    const s = shadowStore();
    await traced(s);
    s.setDay('2026-12-21');
    await s.load();
    await vi.waitFor(() => expect(shadowAsked()).toHaveLength(2));
    expect(query(shadowAsked()[1]).get('date')).toBe('2026-12-21');
  });

  it('puts no shadow down at the second click of a double click on the foot', () => {
    const s = shadowStore();
    s.open(FOOT);
    s.traceShadow();
    s.place(FOOT);
    expect(s.place({ ...FOOT })).toBe(true);
    expect(s.tracing).toBe('tip');
  });

  it('lets go of a shadow half put down on Escape, a close or Move, and keeps a whole one', async () => {
    const s = shadowStore();
    s.open(FOOT);
    s.traceShadow();
    s.place(FOOT);
    expect(s.stopTracing()).toBe(true);
    expect(s.shadow).toBe(null);
    expect(s.stopTracing()).toBe(false);
    s.traceShadow();
    s.togglePlacing();
    expect(s.tracing).toBe(null);
    s.togglePlacing();
    s.traceShadow();
    s.close();
    expect(s.shadow).toBe(null);

    const whole = shadowStore();
    await traced(whole);
    whole.close();
    expect(whole.shadow.traced).toBe(true);
    expect(shadowLayer().clear).toHaveBeenCalled();
  });

  it('draws it on a layer of its own, its ends to drag, and reads it again where an end is dropped', async () => {
    const s = shadowStore();
    await traced(s);
    expect(surface).toHaveBeenCalledTimes(2);
    const shapes = shadowLayer().set.mock.calls.at(-1)[0];
    expect(shapes.find((shape) => shape.id === 'shadow').points).toEqual([FOOT, TIP]);
    expect(shapes.find((shape) => shape.id === 'shadow-word').html).toContain('≈ 23 m tall');
    const tip = shapes.find((shape) => shape.id === 'shadow-end-1');
    expect(tip.title).toBe('Drag to move the tip of the shadow');
    const moved = { lat: 48.8501, lon: 2.3502 };
    tip.onDrag(moved);
    expect(shadowLayer().patch).toHaveBeenCalledWith('shadow', expect.objectContaining({ points: [FOOT, moved] }));
    tip.onDragEnd();
    await vi.waitFor(() => expect(shadowAsked()).toHaveLength(2));
    expect(Number(query(shadowAsked()[1]).get('bearing'))).toBeLessThan(90);
  });

  it('keeps its ends under the hand while one is dragged, whatever effect redraws the sky', async () => {
    const s = shadowStore();
    await traced(s);
    // the map's redraw, as Satellite runs it: on the day, the hour and the point
    const stop = $effect.root(() => {
      $effect(() => {
        s.on;
        s.sky;
        s.index;
        s.anchor;
        s.draw();
      });
    });
    flushSync();
    const laid = shadowLayer().set.mock.calls.length;
    const tip = shadowLayer().set.mock.calls.at(-1)[0].find((shape) => shape.id === 'shadow-end-1');
    tip.onDrag({ lat: 48.8501, lon: 2.3502 });
    // due north of the foot: the fixture's noon, so the hour moves and the sky is drawn again
    tip.onDrag({ lat: 48.8502, lon: 2.35 });
    flushSync();
    expect(s.index).toBe(12);
    // laid again, the handle held would be torn down and the drag would stop
    expect(shadowLayer().set).toHaveBeenCalledTimes(laid);
    stop();
  });

  it('follows the pointer from the foot while the tip is aimed', () => {
    const s = shadowStore();
    s.open(FOOT);
    s.draw();
    s.traceShadow();
    s.place(FOOT);
    s.follow(TIP);
    expect(shadowLayer().set.mock.calls.at(-1)[0].find((shape) => shape.id === 'shadow-live').points).toEqual([FOOT, TIP]);
    s.follow(FOOT);
    expect(shadowLayer().patch).toHaveBeenCalledWith('shadow-live', expect.objectContaining({ points: [FOOT, FOOT] }));
  });

  const NORTH = { lat: 48.8501, lon: 2.35 }; // about 11 m north: the fixture's sun is due south at noon
  const SOUTH = { lat: 48.8499, lon: 2.35 }; // toward a sun that never stands north
  const aimed = () => made[2].set.mock.calls.at(-1)[0][0].html;
  const lastShapes = () => shadowLayer().set.mock.calls.at(-1)[0];
  const turned = (bearing, to) => Math.abs(((bearing - to + 540) % 360) - 180) < 1;

  it('moves the sun to the foot at the hour it was on, so its ray and the shadow make one line', async () => {
    const s = shadowStore();
    s.open(KYIV);
    await s.load();
    s.draw();
    s.setIndex(15);
    s.traceShadow();
    s.place(FOOT);
    expect(s.anchor).toEqual(FOOT);
    await s.load();
    expect(query(asked.at(-1)).get('lat')).toBe('48.85');
    expect(s.index).toBe(15);
  });

  it('reads the hour and the height by the hand while the tip is aimed, the sun swinging to it', async () => {
    const s = shadowStore();
    s.open(FOOT);
    await s.load();
    s.draw();
    s.traceShadow();
    s.place(FOOT);
    s.follow(NORTH);
    // the fixture's noon: the sun due south, 60° up, so 11 m of shadow stand 19 m tall
    expect(aimed()).toContain('12:00 · ≈ 19 m tall');
    expect(s.index).toBe(12);
    const arrow = lastShapes().find((shape) => shape.id === 'shadow-live-tip');
    expect(arrow.className).toContain('shadow-tip live');
    expect(turned(arrow.rotation, 0)).toBe(true);
    s.follow(SOUTH);
    expect(aimed()).toContain('No hour of the day');
    expect(shadowLayer().patch).toHaveBeenCalledWith('shadow-live', expect.objectContaining({ style: expect.objectContaining({ stroke: '#9b9b9b' }) }));
    expect(s.index).toBe(12); // nowhere to swing to
    // the backend is asked at the click, not as the hand moves
    expect(shadowAsked()).toEqual([]);
    s.place(NORTH);
    expect(made[2].clear).toHaveBeenCalled();
  });

  it('draws the tip as an arrow away from the foot, grey when no hour casts it', async () => {
    const s = shadowStore();
    await traced(s);
    let tip = lastShapes().find((shape) => shape.id === 'shadow-end-1');
    expect(tip.className).toContain('shadow-tip');
    expect(turned(tip.rotation, 90)).toBe(true);
    expect(tip.html).toContain('#f5a623');
    answer = { date: '2026-06-21', sun_azimuth: 270, moments: [], falls: { from: 240, to: 120, middle: 0, whole: false } };
    s.clearShadow();
    await traced(s);
    tip = lastShapes().find((shape) => shape.id === 'shadow-end-1');
    expect(tip.html).toContain('#9b9b9b');
    expect(lastShapes().find((shape) => shape.id === 'shadow').style.stroke).toBe('#9b9b9b');
  });

  it('says which way that day’s shadows fall, and reads it the other way round when that has an hour', async () => {
    answer = { date: '2026-06-21', sun_azimuth: 270, moments: [], falls: { from: 240, to: 120, middle: 0, whole: false } };
    const s = shadowStore();
    await traced(s);
    expect(s.shadow.falls).toBe('That day, shadows fall between 240° and 120°, through north.');
    expect(s.shadow.swappable).toBe(true);
    answer = { date: '2026-06-21', moments: [MOMENT] };
    s.swapShadow();
    await vi.waitFor(() => expect(s.shadow.moments).toHaveLength(1));
    expect(turned(Number(query(shadowAsked().at(-1)).get('bearing')), 270)).toBe(true);
    // the sun went with the foot
    expect(s.anchor).toEqual(TIP);
    expect(s.shadow.falls).toBe('');
    expect(s.shadow.swappable).toBe(false);
  });

  it('offers no swap when the shadow the other way round has no hour either', async () => {
    answer = { date: '2026-06-21', sun_azimuth: 270, moments: [], falls: { from: 300, to: 60, middle: 0, whole: false } };
    const s = shadowStore();
    await traced(s);
    expect(s.shadow.swappable).toBe(false);
  });

  it('reads it again when the sky comes back in another zone', async () => {
    const s = shadowStore();
    await traced(s);
    const read = api.get;
    api.get = vi.fn(async (path) => {
      const one = await read(path);
      return path.startsWith('/api/geo/sky') ? { ...one, zone: { name: 'Europe/Berlin', abbreviation: 'CEST' } } : one;
    });
    await s.load();
    await vi.waitFor(() => expect(shadowAsked()).toHaveLength(2));
    expect(query(shadowAsked()[1]).get('zone')).toBe('Europe/Berlin');
  });

  it('says so when no hour of the day casts it', async () => {
    answer = { date: '2026-06-21', moments: [] };
    const s = shadowStore();
    await traced(s);
    expect(s.shadow).toMatchObject({ answered: true, moments: [], date: '2026-06-21' });
    expect(s.shadowText()).toBe('No hour of 2026-06-21 casts this shadow\nShadow from 48.8500, 2.3500 to 48.8500, 2.3502, read for 2026-06-21');
  });

  it('copies what it says, with where it was drawn, and goes with a press', async () => {
    const s = shadowStore();
    await traced(s);
    expect(s.shadowText()).toBe(
      'About 23 m tall (sun at 270°, 41.2° up at 14:12 CEST)\nShadow from 48.8500, 2.3500 to 48.8500, 2.3502, read for 2026-06-21'
    );
    s.clearShadow();
    expect(s.shadow).toBe(null);
    expect(s.shadowText()).toBe('');
  });

  it('takes the imagery’s date only when it is a whole day', () => {
    expect(usableDate('2024-06-21')).toBe('2024-06-21');
    expect(usableDate('2021')).toBe(null);
    expect(usableDate(null)).toBe(null);
  });
});
