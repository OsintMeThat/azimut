// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COARSE_STEP,
  createHorizonState,
  detailCovers,
  detailRequest,
  FINE_STEP,
  PEAKS_KEY,
  NEAR_REACH,
  SHADOW_DELAY,
  SHADOWS_KEY,
  shadowFits,
  STEP_M,
} from './horizon.svelte.js';

const EYE = { lat: 46.5586, lon: 7.8353 };

/** A grid as the app answers it, decoded (the rasters are not read here). */
function picture(step, extra = {}) {
  return {
    observer: { lat: EYE.lat, lon: EYE.lon, ground: 2970, altitude: 2971.7 },
    far: 150000,
    azimuth: { start: 0, step, count: Math.round(360 / step), full: true },
    elevation: { top: 12, step, count: Math.round(37 / step) + 1 },
    ...extra,
  };
}

let timers;
let api;
let requests;
let storage;

/** A browser storage held in memory, one per test. */
function memoryStorage(seed = {}) {
  const held = new Map(Object.entries(seed));
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, String(value)),
  };
}

function store() {
  return createHorizonState({
    storage,
    open: async (bytes) => bytes,
    api,
    decode: async (answer) => answer,
    image: async (base64) => ({ bitmap: base64 }),
    later: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel: (handle) => {
      timers[handle - 1] = null;
    },
  });
}

/** Run every timer due, as the clock would. */
async function tick() {
  const due = timers.filter(Boolean);
  timers = [];
  for (const fn of due) await fn();
  await Promise.resolve();
}

beforeEach(() => {
  timers = [];
  requests = [];
  storage = memoryStorage();
  api = {
    post: vi.fn(async (path, body) => {
      requests.push({ path, body });
      if (path === '/api/horizon/target') {
        return { azimuth: 90, angle: 1.2, distance: 5000, visible: true, margin_deg: 0.4, ground: 1200 };
      }
      if (body.azimuth_span) return picture(body.step, { azimuth: { start: body.azimuth_start, step: body.step, count: 10, full: false } });
      return picture(body.step);
    }),
    get: vi.fn(async () => ({ peaks: [{ name: 'Eiger', azimuth: 80, angle: 2, distance: 9000 }] })),
  };
});

describe('the Horizon view', () => {
  it('asks for nothing until the eye stands somewhere', async () => {
    const view = store();
    view.look({ heading: 90 });
    await tick();
    expect(api.post).not.toHaveBeenCalled();
    expect(view.quality).toBe('none');
  });

  it('draws a quick coarse picture, then the full one, from the band the first found', async () => {
    const view = store();
    view.standAt(EYE);
    expect(api.post).not.toHaveBeenCalled(); // the eye rests a moment first
    await tick();
    expect(requests.map((r) => r.body.step)).toEqual([COARSE_STEP, FINE_STEP]);
    expect(requests[0].body).toMatchObject({ lat: EYE.lat, lon: EYE.lon, mode: 'ground', height: 1.7 });
    expect(requests[1].body.top).toBe(12);
    expect(requests[1].body.bottom).toBe(-25);
    expect(view.quality).toBe('fine');
    expect(view.panorama.azimuth.step).toBe(FINE_STEP);
    expect(view.busy).toBe(false);
  });

  it('asks once for an eye dragged across the map', async () => {
    const view = store();
    view.standAt(EYE);
    view.standAt({ lat: 46.56, lon: 7.84 });
    view.standAt({ lat: 46.57, lon: 7.85 });
    await tick();
    expect(requests.filter((r) => r.body.step === COARSE_STEP)).toHaveLength(1);
    expect(requests[0].body.lat).toBe(46.57);
  });

  it('turning, tilting and zooming never ask for a new turn', async () => {
    const view = store();
    view.standAt(EYE);
    await tick();
    const before = requests.length;
    view.look({ heading: 400, tilt: 120, fov: 500 });
    expect(view.camera.heading).toBe(40);
    expect(view.camera.tilt).toBe(89);
    expect(view.camera.fov).toBe(150);
    await tick();
    expect(requests.slice(before).every((r) => r.body.azimuth_span)).toBe(true);
  });

  it('gives a drone and an aircraft their own heights, and keeps a set one on a move', async () => {
    const view = store();
    view.standAt(EYE);
    view.setMode('drone');
    expect(view.observer.height).toBe(120);
    view.setHeight(450);
    view.standAt({ lat: 46.6, lon: 7.9 });
    expect(view.observer).toMatchObject({ mode: 'drone', height: 450 });
    view.setMode('aircraft');
    expect(view.observer.height).toBe(3000);
    view.setHeight(99999);
    expect(view.observer.height).toBe(15000);
  });

  it('asks for a finer window once a telephoto rests, and not again inside it', async () => {
    const view = store();
    view.setFrame({ width: 1200, height: 600 });
    view.look({ fov: 90 });
    view.standAt(EYE);
    await tick();
    await tick();
    expect(requests.some((r) => r.body.azimuth_span)).toBe(false); // 90° on 1200 px: the turn is fine
    view.look({ fov: 10, heading: 80 });
    await tick();
    const window = requests.at(-1).body;
    expect(window.azimuth_span).toBeCloseTo(18, 6);
    expect(window.step).toBeLessThanOrEqual(0.01);
    expect(view.detail).not.toBeNull();
    const count = requests.length;
    view.look({ heading: 81 });
    await tick();
    expect(requests.length).toBe(count);
  });

  it('names summits only once they are switched on', async () => {
    const view = store();
    view.standAt(EYE);
    await tick();
    expect(api.get).not.toHaveBeenCalled();
    view.showPeaks(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls[0][0]).toContain('altitude=2971.7');
    expect(view.peaks[0].name).toBe('Eiger');
  });

  it('keeps reading the names while areas are still coming in, nearest first', async () => {
    let round = 0;
    api.get = vi.fn(async () => {
      round += 1;
      return round === 1
        ? { peaks: [{ name: 'Eiger', azimuth: 80, angle: 2, distance: 9000 }], pending: 2, failed: 0 }
        : { peaks: [{ name: 'Eiger' }, { name: 'Mönch' }], pending: 0, failed: 1 };
    });
    const view = store();
    view.standAt(EYE);
    await tick();
    view.showPeaks(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(view.peaks).toHaveLength(1);
    expect(view.peaksPending).toBe(2);
    await tick();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(view.peaks).toHaveLength(2);
    expect(view.peaksPending).toBe(0);
    expect(view.peaksFailed).toBe(1);
    await tick();
    expect(api.get).toHaveBeenCalledTimes(2); // nothing left to wait for
  });

  it('reads the sun and the moon only once asked, for the place\'s own day, and again on a move', async () => {
    const sky = { date: '2026-10-08', step_minutes: 2, sun: {}, moon: {} };
    const base = api.post;
    api.post = vi.fn(async (path, body) => (path === '/api/horizon/sky' ? sky : base(path, body)));
    const view = store();
    view.standAt(EYE);
    await tick();
    expect(api.post.mock.calls.some(([path]) => path === '/api/horizon/sky')).toBe(false);
    view.showSky(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(view.sky).toBe(sky);
    expect(view.skyDate).toBe('2026-10-08');
    view.setSkyDate('2026-06-21');
    await Promise.resolve();
    const asked = api.post.mock.calls.filter(([path]) => path === '/api/horizon/sky');
    expect(asked.at(-1)[1].date).toBe('2026-06-21');
    view.standAt({ lat: 46.6, lon: 7.9 });
    await tick();
    expect(api.post.mock.calls.filter(([path]) => path === '/api/horizon/sky').at(-1)[1].lat).toBe(46.6);
  });

  it('places a point of the map in the view, and again from a new eye', async () => {
    const view = store();
    view.standAt(EYE);
    await tick();
    await view.mark({ lat: 46.6, lon: 7.9 });
    expect(view.target).toMatchObject({ visible: true, distance: 5000, busy: false });
    view.standAt({ lat: 46.5, lon: 7.8 });
    await tick();
    const marks = requests.filter((r) => r.path === '/api/horizon/target');
    expect(marks).toHaveLength(2);
    expect(marks[1].body.lat).toBe(46.5);
  });

  it('lays imagery over the full picture only once Imagery is picked, on the same grid', async () => {
    const base = api.post;
    api.post = vi.fn(async (path, body) =>
      path === '/api/horizon/drape' ? { image: 'AAAA', credits: [{ attribution: 'Esri' }] } : base(path, body)
    );
    const view = store();
    view.standAt(EYE);
    await tick();
    expect(api.post.mock.calls.some(([path]) => path === '/api/horizon/drape')).toBe(false);
    view.setGround('imagery');
    await Promise.resolve();
    await Promise.resolve();
    const [, asked] = api.post.mock.calls.find(([path]) => path === '/api/horizon/drape');
    const fine = api.post.mock.calls.find(([path, body]) => path === '/api/horizon/panorama' && body.step === FINE_STEP)[1];
    expect(asked).toEqual({ ...fine, provider: 'esri-world-imagery' });
    expect(view.drape.image).toEqual({ bitmap: 'AAAA' });
    view.setGround('plain');
    view.setGround('imagery');
    await Promise.resolve();
    expect(api.post.mock.calls.filter(([path]) => path === '/api/horizon/drape')).toHaveLength(1);
  });

  it('lays a dated Wayback release over the ground once one is picked', async () => {
    const base = api.post;
    api.post = vi.fn(async (path, body) =>
      path === '/api/horizon/drape' ? { image: body.provider, credits: [] } : base(path, body)
    );
    api.get = vi.fn(async () => ({ releases: [{ release: 64776, date: '2021-06-30' }] }));
    const view = store();
    view.standAt(EYE);
    await tick();
    view.setGround('imagery');
    await Promise.resolve();
    await Promise.resolve();
    expect(api.get).not.toHaveBeenCalled(); // the archive is only read when asked
    await view.loadReleases();
    expect(view.releases[0].date).toBe('2021-06-30');
    view.setDrapeSource('esri-wayback~64776');
    await Promise.resolve();
    await Promise.resolve();
    expect(view.drape.image).toEqual({ bitmap: 'esri-wayback~64776' });
  });

  it('draws more or fewer ridges within its steps', () => {
    const view = store();
    expect(view.ridges).toBe(2);
    view.setRidges(9);
    expect(view.ridges).toBe(4);
    view.setRidges('-3');
    expect(view.ridges).toBe(0);
  });

  it('says what went wrong and keeps nothing stale', async () => {
    api.post = vi.fn(async () => {
      throw new Error('Terrain could not be loaded: offline');
    });
    const view = store();
    view.standAt(EYE);
    await tick();
    expect(view.error).toContain('offline');
    expect(view.busy).toBe(false);
  });

  it('takes a whole view back from the address in one move', async () => {
    const view = store();
    view.restore({
      observer: { lat: 15.3, lon: 44.2, mode: 'drone', height: 300 },
      camera: { heading: 200, fov: 30 },
      visibility: 200000,
      ground: 'plain',
    });
    await tick();
    expect(requests[0].body).toMatchObject({ lat: 15.3, mode: 'drone', height: 300, far: 200000 });
    expect(view.camera.heading).toBe(200);
    expect(view.ground).toBe('plain');
    expect(view.lines).toBe(true); // plain ground comes with its lines unless the address says otherwise
    view.restore({ ground: 'relief', lines: true });
    expect(view.lines).toBe(true);
  });

  it('hazes the far ground for thick air, and marches farther only for air that sees past the default', async () => {
    const view = store();
    view.standAt(EYE);
    await tick();
    const before = requests.length;
    view.setVisibility(40_000);
    expect(view.visibility).toBe(40_000);
    await tick();
    expect(requests.length).toBe(before); // haze is drawn, not marched
    view.setVisibility(250_000);
    await tick();
    expect(requests.at(-1).body.far).toBe(250_000);
    view.setVisibility(null);
    await tick();
    expect(requests.at(-1).body.far).toBeUndefined();
    view.setVisibility(-4);
    expect(view.visibility).toBeNull();
    expect(view.place.visibility).toBeNull();
  });

  it('opens on shaded relief without lines; plain ground turns them on, and they can go', () => {
    const view = store();
    expect(view.ground).toBe('relief');
    expect(view.lines).toBe(false);
    view.setGround('plain');
    expect(view.lines).toBe(true);
    view.setLines(false);
    expect(view.lines).toBe(false);
    view.setGround('nonsense');
    expect(view.ground).toBe('plain');
    expect(view.place).toMatchObject({ ground: 'plain', lines: false });
  });

  it('remembers summit names switched on in this browser, and survives a refused storage', async () => {
    const first = store();
    expect(first.peaksOn).toBe(false);
    first.showPeaks(true);
    expect(storage.getItem(PEAKS_KEY)).toBe('1');
    expect(store().peaksOn).toBe(true);
    first.showPeaks(false);
    expect(store().peaksOn).toBe(false);
    storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const refused = store();
    expect(refused.peaksOn).toBe(false);
    expect(() => refused.showPeaks(true)).not.toThrow();
    expect(refused.peaksOn).toBe(true);
  });

  it('says what it is doing in one line, the picture first, and nothing once done', async () => {
    let round = 0;
    api.get = vi.fn(async () => {
      round += 1;
      return round === 1 ? { peaks: [], pending: 3, failed: 0 } : { peaks: [], pending: 0, failed: 0 };
    });
    const view = store();
    expect(view.status).toBe('');
    view.standAt(EYE);
    await tick();
    expect(view.status).toBe('');
    view.showPeaks(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(view.status).toBe('Reading summit names…');
    await tick();
    expect(view.status).toBe('');
  });

  it('tries summit names, imagery, the sky and a marked point again after a failure', async () => {
    let failing = true;
    const base = api.post;
    api.get = vi.fn(async () => {
      if (failing) throw new Error('OpenStreetMap is busy');
      return { peaks: [{ name: 'Eiger' }], pending: 0, failed: 0 };
    });
    api.post = vi.fn(async (path, body) => {
      if (failing && ['/api/horizon/drape', '/api/horizon/sky', '/api/horizon/target'].includes(path)) {
        throw new Error('offline');
      }
      if (path === '/api/horizon/drape') return { image: 'AAAA', credits: [] };
      if (path === '/api/horizon/sky') return { date: '2026-10-08', step_minutes: 2, sun: {}, moon: {} };
      return base(path, body);
    });
    const view = store();
    view.standAt(EYE);
    await tick();
    view.showPeaks(true);
    view.setGround('imagery');
    view.showSky(true);
    await view.mark({ lat: 46.6, lon: 7.9 });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.peaksError).toContain('busy');
    expect(view.drapeError).toBe('offline');
    expect(view.skyError).toBe('offline');
    expect(view.target.error).toBe('offline');
    failing = false;
    view.retryPeaks();
    view.retryDrape();
    view.retrySky();
    await view.retryTarget();
    await Promise.resolve();
    await Promise.resolve();
    expect(view.peaks[0].name).toBe('Eiger');
    expect(view.drape.image).toEqual({ bitmap: 'AAAA' });
    expect(view.sky.date).toBe('2026-10-08');
    expect(view.target).toMatchObject({ visible: true, busy: false });
  });
});

describe('a finer window for a narrow lens', () => {
  const turn = picture(0.1);
  const frame = { width: 1200, height: 700 };

  it('is not asked for while a cell of the turn is under two pixels', () => {
    expect(detailRequest({ heading: 0, tilt: 0, roll: 0, fov: 90 }, frame, turn)).toBeNull();
  });

  it('spans the view and a margin at about a cell a pixel, inside the band', () => {
    const { body: wanted } = detailRequest({ heading: 5, tilt: 0, roll: 0, fov: 8 }, frame, turn);
    expect(wanted.azimuth_start).toBeCloseTo(357.6, 6);
    expect(wanted.step).toBe(0.01);
    expect(wanted.top).toBeLessThanOrEqual(12);
    expect(wanted.bottom).toBeGreaterThanOrEqual(-25);
    expect((wanted.azimuth_span / wanted.step) * ((wanted.top - wanted.bottom) / wanted.step)).toBeLessThanOrEqual(3e6);
  });

  it('coarsens rather than overflow the app', () => {
    const { body: wanted } = detailRequest({ heading: 0, tilt: 0, roll: 0, fov: 2 }, { width: 4000, height: 3000 }, turn);
    expect((wanted.azimuth_span / wanted.step) * ((wanted.top - wanted.bottom) / wanted.step)).toBeLessThanOrEqual(3e6);
  });

  it('knows when the window held already shows what the view needs', () => {
    const held = { azimuth_start: 350, azimuth_span: 30, step: 0.01, top: 5, bottom: -5 };
    const need = (start, step = 0.01) => ({ need: { start, span: 20, step, top: 4, bottom: -4 } });
    expect(detailCovers(held, need(355))).toBe(true);
    expect(detailCovers(held, need(10))).toBe(false);
    expect(detailCovers(held, need(355, 0.005))).toBe(false);
    expect(detailCovers(null, need(355))).toBe(false);
  });
});

/** A day sampled every 2 minutes: the sun up from 06:00 to 18:00, 40° at noon; no moon up. */
function day() {
  const sun = { azimuth: [], altitude: [], clear: [], events: [] };
  const moon = { azimuth: [], altitude: [], clear: [], events: [], illuminated: 0.42 };
  for (let i = 0; i < 721; i += 1) {
    const minute = i * 2;
    sun.azimuth.push((60 + (minute / 1440) * 240) % 360);
    sun.altitude.push(40 * Math.sin(((minute - 360) / 720) * Math.PI));
    sun.clear.push(true);
    moon.azimuth.push(200);
    moon.altitude.push(-10);
    moon.clear.push(false);
  }
  return { date: '2026-10-08', step_minutes: 2, sun, moon };
}

describe('full detail', () => {
  it('marches the turn again over the finest terrain once asked, on the full picture\'s grid', async () => {
    const view = store();
    view.standAt(EYE);
    await tick();
    expect(requests.some((r) => r.body.full_detail)).toBe(false); // never on its own
    view.setFullDetail(true);
    await tick();
    await Promise.resolve();
    await Promise.resolve();
    const full = requests.find((r) => r.body.full_detail && !r.body.azimuth_span);
    const fine = requests.find((r) => r.body.step === FINE_STEP && !r.body.full_detail);
    expect(full.body).toEqual({ ...fine.body, full_detail: true });
    expect(view.fullHeld).toBe(true);
    expect(view.quality).toBe('fine');
    // the next eye gets it too, after its usual pictures
    view.standAt({ lat: 46.6, lon: 7.9 });
    await tick();
    await tick();
    const steps = requests.slice(-3).map((r) => [r.body.step, Boolean(r.body.full_detail)]);
    expect(steps).toEqual([[COARSE_STEP, false], [FINE_STEP, false], [FINE_STEP, true]]);
  });

  it('sharpens what the lens shows first, whatever its width, then the turn, and says so', async () => {
    let release;
    const base = api.post;
    api.post = vi.fn(async (path, body, options) => {
      if (body.full_detail && !body.azimuth_span) await new Promise((resolve) => (release = resolve));
      return base(path, body, options);
    });
    const view = store();
    view.setFrame({ width: 1200, height: 600 });
    view.look({ fov: 90 }); // wide enough that the turn needs no window of its own
    view.standAt(EYE);
    await tick();
    await tick();
    expect(requests.some((r) => r.body.azimuth_span)).toBe(false);
    view.setFullDetail(true);
    await tick();
    await Promise.resolve();
    const asked = requests.filter((r) => r.body.full_detail);
    // the lens's own window first, at about a cell a pixel, then the turn
    expect(asked[0].body.azimuth_span).toBeGreaterThan(90);
    expect(asked[0].body.step).toBeLessThan(FINE_STEP);
    expect(view.status).toBe('Loading full detail…');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    // the turn is asked once the window is in (held here until released)
    const turn = api.post.mock.calls.filter(([, sent]) => sent.full_detail).at(-1)[1];
    expect(turn.azimuth_span).toBeUndefined();
    release();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(view.fullHeld).toBe(true);
    expect(view.status).toBe('');
  });
});

describe('Sentinel-2 near the eye', () => {
  function withCopernicus({ dates = [{ date: '2026-09-28', cloud: 64 }, { date: '2026-09-23', cloud: 4 }, { date: '2026-09-18', cloud: 12 }] } = {}) {
    const base = api.post;
    api.get = vi.fn(async (path) => {
      requests.push({ path, body: {} });
      if (path.startsWith('/api/satellite/sentinel/dates')) return { dates };
      return { peaks: [], pending: 0, failed: 0 };
    });
    api.post = vi.fn(async (path, body, options) => {
      if (path === '/api/horizon/drape') {
        requests.push({ path, body });
        return { image: 'AAAA', credits: [] };
      }
      if (path === '/api/horizon/drape/estimate') {
        requests.push({ path, body });
        return { requests: body.near_reach / 1000, tiles: 9 };
      }
      return base(path, body, options);
    });
  }
  const drapes = () => requests.filter((r) => r.path === '/api/horizon/drape');
  const lookups = () => requests.filter((r) => r.path.startsWith('/api/satellite/sentinel/dates'));
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  it('asks nothing of Copernicus until switched on, then lays the newest pass under 30% cloud near, Esri beyond', async () => {
    withCopernicus();
    const view = store();
    view.standAt(EYE);
    await tick();
    view.setGround('imagery');
    await settle();
    expect(lookups()).toHaveLength(0);
    expect(drapes().at(-1).body.near_provider).toBeUndefined();
    await view.setNear(true);
    await settle();
    expect(lookups()).toHaveLength(1);
    expect(view.nearDate).toBe('2026-09-23'); // the newest under 30% cloud, not the cloudy newest
    const laid = drapes().at(-1).body;
    expect(laid.provider).toBe('esri-world-imagery');
    expect(laid.near_provider).toBe('sentinel2~TRUE_COLOR~2026-09-23~2026-09-23~CC30');
    expect(laid.near_reach).toBe(NEAR_REACH);
  });

  it('lays it as far as asked, from the pass picked, and back to Esri alone when off', async () => {
    withCopernicus();
    const view = store();
    view.standAt(EYE);
    await tick();
    view.setGround('imagery');
    await view.setNear(true);
    await settle();
    view.setNearReach(20_000);
    await settle();
    expect(drapes().at(-1).body.near_reach).toBe(20_000);
    view.setNearReach(123); // not offered: the default
    expect(view.nearReach).toBe(NEAR_REACH);
    await view.setNearDate('2026-09-18');
    await settle();
    expect(drapes().at(-1).body.near_provider).toContain('2026-09-18');
    await view.setNear(false);
    await settle();
    expect(drapes().at(-1).body.near_provider).toBeUndefined();
  });

  it('says so when no pass is clear enough, and works out the cost for free', async () => {
    withCopernicus({ dates: [{ date: '2026-09-28', cloud: 90 }] });
    const view = store();
    view.standAt(EYE);
    await tick();
    view.setGround('imagery');
    view.askEstimate();
    await tick();
    const estimate = requests.filter((r) => r.path === '/api/horizon/drape/estimate').at(-1).body;
    expect(estimate.near_provider).toBe('sentinel2');
    expect(view.nearEstimate).toEqual({ requests: 5, tiles: 9 });
    await view.setNear(true);
    await settle();
    expect(view.nearError).toContain('No Sentinel-2 pass under 30% cloud');
    expect(drapes().at(-1).body.near_provider).toBeUndefined(); // nothing billed without a pass
  });
});

describe('walking from the viewpoint', () => {
  it('steps along the heading, back, and across, each eye at its own pace, facing the same way', async () => {
    const view = store();
    view.walk({ forward: 1 });
    expect(view.observer).toBeNull(); // no eye, no step
    view.standAt(EYE);
    view.look({ heading: 90 });
    view.walk({ forward: 1 });
    expect(view.observer.lat).toBeCloseTo(EYE.lat, 5);
    expect(view.observer.lon).toBeGreaterThan(EYE.lon);
    const east = (view.observer.lon - EYE.lon) * 111_320 * Math.cos((EYE.lat * Math.PI) / 180);
    expect(east).toBeCloseTo(STEP_M.ground, -1);
    view.walk({ forward: -1 });
    expect(view.observer.lon).toBeCloseTo(EYE.lon, 6);
    view.walk({ side: 1 }); // to the right of east is south
    expect(view.observer.lat).toBeLessThan(EYE.lat);
    view.setMode('aircraft');
    const before = view.observer;
    view.walk({ forward: 1, scale: 5 });
    const metres = (view.observer.lon - before.lon) * 111_320 * Math.cos((EYE.lat * Math.PI) / 180);
    expect(metres).toBeCloseTo(STEP_M.aircraft * 5, -1);
    expect(view.observer).toMatchObject({ mode: 'aircraft', height: 3000 });
    expect(view.camera.heading).toBe(90);
    await tick();
    // a walk of several steps asks for one picture, where it ends
    expect(requests.filter((r) => r.body.step === COARSE_STEP)).toHaveLength(1);
  });
});

describe('shadows from the sun and the moon', () => {
  function withSky(answer = day()) {
    const base = api.post;
    api.post = vi.fn(async (path, body) => {
      requests.push({ path, body });
      if (path === '/api/horizon/sky') return answer;
      if (path === '/api/horizon/shadow') {
        return {
          light: 'bytes',
          azimuth: { start: 0, step: 0.2, count: 1800, full: true },
          elevation: { top: 12, step: 0.2, count: 186 },
          light_azimuth: body.light_azimuth,
          light_altitude: body.light_altitude,
        };
      }
      return base(path, body);
    });
  }
  const shadows = () => requests.filter((r) => r.path === '/api/horizon/shadow');

  it('marches nothing until a day is read, then the hour\'s light once it rests', async () => {
    withSky();
    const view = store();
    view.standAt(EYE);
    await tick();
    await tick();
    expect(view.light.phase).toBe('map');
    expect(shadows()).toHaveLength(0);
    view.showSky(true);
    await Promise.resolve();
    await Promise.resolve();
    // the hour is dragged: the light follows at once, one march once it rests
    view.setSkyTime('09:00');
    view.setSkyTime('09:30');
    view.setSkyTime('10:00');
    expect(view.light.body).toBe('sun');
    await tick();
    expect(shadows()).toHaveLength(1);
    const asked = shadows()[0].body;
    expect(asked.light_altitude).toBeCloseTo(view.light.altitude, 1);
    expect(asked.step).toBe(FINE_STEP); // the full picture's grid
    expect(view.shadow.light).toBe('bytes');
    expect(shadowFits(view.shadow, view.light)).toBe(true);
    // the same hour again asks nothing
    view.setSkyTime('10:00');
    await tick();
    expect(shadows()).toHaveLength(1);
  });

  it('casts no shadow on a moonless night, and drops what it held on a move', async () => {
    withSky();
    const view = store();
    view.standAt(EYE);
    await tick();
    view.showSky(true);
    await Promise.resolve();
    await Promise.resolve();
    await tick();
    expect(view.shadow).not.toBeNull();
    view.setSkyTime('02:00');
    expect(view.light).toMatchObject({ phase: 'night', body: null });
    expect(shadowFits(view.shadow, view.light)).toBe(false);
    const count = shadows().length;
    await tick();
    expect(shadows()).toHaveLength(count);
    view.standAt({ lat: 46.6, lon: 7.9 });
    await tick();
    expect(view.shadow).toBeNull();
  });

  it('says when it is casting them, and tries again after a failure', async () => {
    withSky();
    const base = api.post;
    let fail = true;
    api.post = vi.fn(async (path, body) => {
      if (path === '/api/horizon/shadow' && fail) throw new Error('Terrain could not be loaded');
      return base(path, body);
    });
    const view = store();
    view.standAt(EYE);
    await tick();
    view.showSky(true);
    await Promise.resolve();
    await Promise.resolve();
    await tick();
    expect(view.shadowError).toContain('Terrain');
    fail = false;
    view.retryShadow();
    expect(timers.filter(Boolean)).toHaveLength(1); // after SHADOW_DELAY, like any other ask
    expect(SHADOW_DELAY).toBeGreaterThan(0);
    await tick();
    expect(view.shadowError).toBe('');
    expect(view.shadow).not.toBeNull();
  });

  it('keeps shadows as dark as asked, remembered in this browser, without touching the open ground or a new march', async () => {
    withSky();
    const view = store();
    view.standAt(EYE);
    await tick();
    view.showSky(true);
    await Promise.resolve();
    await Promise.resolve();
    await tick();
    const marches = shadows().length;
    const before = view.light;
    view.setShadowDepth(1);
    expect(view.light).toEqual(before); // the light of the hour is the hour's
    expect(storage.getItem(SHADOWS_KEY)).toBe('1');
    expect(store().shadowDepth).toBe(1);
    view.setShadowDepth(-3);
    expect(view.shadowDepth).toBe(0);
    view.setShadowDepth('nonsense');
    expect(view.shadowDepth).toBe(0);
    await tick();
    expect(shadows()).toHaveLength(marches);
  });

  it('lets shadows held stand only for a light within a hair of theirs', () => {
    const held = { lightAzimuth: 120, lightAltitude: 20 };
    const sun = { body: 'sun', strength: 1, azimuth: 120.3, altitude: 20.2 };
    expect(shadowFits(held, sun)).toBe(true);
    expect(shadowFits(held, { ...sun, azimuth: 121 })).toBe(false);
    expect(shadowFits(held, { ...sun, strength: 0.01 })).toBe(false);
    expect(shadowFits({ lightAzimuth: 359.8, lightAltitude: 5 }, { ...sun, azimuth: 0.1, altitude: 5 })).toBe(true);
    expect(shadowFits(null, sun)).toBe(false);
  });
});
