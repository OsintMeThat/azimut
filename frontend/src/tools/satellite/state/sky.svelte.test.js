// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkyState } from './sky.svelte.js';

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
