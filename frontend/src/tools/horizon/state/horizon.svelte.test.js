// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  castsShadows,
  createHorizonState,
  DRAPE_PROVIDER,
  LOAD_DELAY,
  NEAR_REACH,
  PANORAMA_STEP,
  PEAKS_KEY,
  SHADOWS_KEY,
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
let delays;
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
    api,
    decode: async (answer) => answer,
    later: (fn, ms) => {
      timers.push(fn);
      delays.push(ms);
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

/** Let every answer already on its way arrive. */
async function settle() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Run every timer due without waiting for what it asks, then let answers arrive. */
async function fire() {
  const due = timers.filter(Boolean);
  timers = [];
  for (const fn of due) fn();
  await settle();
}

const asked = (path) => requests.filter((r) => r.path === path);
const turns = () => asked('/api/horizon/panorama');

beforeEach(() => {
  timers = [];
  delays = [];
  requests = [];
  storage = memoryStorage();
  api = {
    post: vi.fn(async (path, body) => {
      requests.push({ path, body });
      if (path === '/api/horizon/target') {
        return { azimuth: 90, angle: 1.2, distance: 5000, visible: true, margin_deg: 0.4, ground: 1200 };
      }
      if (path === '/api/horizon/tiles/estimate') return { requests: body.near_reach / 1000, tiles: 9 };
      if (path === '/api/horizon/sky') return { date: '2026-10-08', step_minutes: 2, sun: {}, moon: {} };
      return picture(body.step);
    }),
    get: vi.fn(async () => ({ peaks: [{ name: 'Eiger', azimuth: 80, angle: 2, distance: 9000 }] })),
  };
});

afterEach(() => {
  // the picture is drawn in the browser: the app is never asked for one again
  const gone = ['/api/horizon/drape', '/api/horizon/shadow', '/api/horizon/window', '/api/horizon/detail/start'];
  for (const [path] of api.post.mock.calls) expect(gone).not.toContain(path);
});

describe('the Horizon view', () => {
  it('stands nowhere again once left, keeping how the picture is drawn, and drops what was on its way', async () => {
    const view = store();
    view.standAt(EYE);
    view.setGround('imagery');
    view.look({ heading: 120 });
    await tick();
    await view.mark({ lat: 46.6, lon: 7.9 });
    view.standAt({ lat: 46.57, lon: 7.85 });
    view.leave();
    await tick();
    expect(view.observer).toBeNull();
    expect(view.placed).toBeNull();
    expect(view.panorama).toBeNull();
    expect(view.target).toBeNull();
    // the walk asked before leaving never lands
    expect(turns()).toHaveLength(1);
    expect(view.ground).toBe('imagery');
    expect(view.camera.heading).toBe(120);
  });

  it('asks for nothing until the eye stands somewhere', async () => {
    const view = store();
    view.look({ heading: 90 });
    await tick();
    expect(api.post).not.toHaveBeenCalled();
    expect(view.placed).toBeNull();
    expect(view.panorama).toBeNull();
  });

  it('places the eye once it rests, and marches its turn once for the skyline', async () => {
    const view = store();
    view.standAt(EYE);
    expect(api.post).not.toHaveBeenCalled(); // the eye rests a moment first
    expect(view.placed).toBeNull();
    expect(delays).toContain(LOAD_DELAY);
    await tick();
    expect(view.placed).toEqual({ ...EYE, mode: 'ground', height: 1.7, far: 150000 });
    expect(turns()).toHaveLength(1);
    expect(turns()[0].body).toEqual({ lat: EYE.lat, lon: EYE.lon, mode: 'ground', height: 1.7, step: PANORAMA_STEP });
    expect(view.panorama.azimuth.step).toBe(PANORAMA_STEP);
    expect(view.busy).toBe(false);
  });

  it('asks once for an eye dragged across the map', async () => {
    const view = store();
    view.standAt(EYE);
    view.standAt({ lat: 46.56, lon: 7.84 });
    view.standAt({ lat: 46.57, lon: 7.85 });
    await tick();
    expect(turns()).toHaveLength(1);
    expect(turns()[0].body.lat).toBe(46.57);
    expect(view.placed.lat).toBe(46.57);
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
    expect(requests.length).toBe(before);
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
    await tick();
    // an aircraft sees farther, and its ground is laid that far
    expect(view.placed).toMatchObject({ mode: 'aircraft', height: 15000, far: 300000 });
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

  it('keeps reading the names while tiles are still coming in, nearest first', async () => {
    let round = 0;
    api.get = vi.fn(async () => {
      round += 1;
      if (round === 1) return { peaks: [{ name: 'Eiger', azimuth: 80, angle: 2, distance: 9000 }], pending: 2, failed: 0 };
      if (round === 2) return { peaks: [{ name: 'Eiger' }, { name: 'Mönch' }], pending: 0, failed: 1, retry_in: 30 };
      return { peaks: [{ name: 'Eiger' }, { name: 'Mönch' }, { name: 'Jungfrau' }], pending: 0, failed: 0, retry_in: 0 };
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
    // the tile that could not be read is asked again once the app's wait is over
    expect(delays.at(-1)).toBe(30_000);
    await tick();
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get.mock.calls[2][0]).not.toContain('retry');
    expect(view.peaks).toHaveLength(3);
    expect(view.peaksFailed).toBe(0);
    await tick();
    expect(api.get).toHaveBeenCalledTimes(3); // nothing left to wait for
  });

  it('credits the names as the app names their source', async () => {
    const credits = [{ label: 'OpenFreeMap', attribution: 'OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors' }];
    api.get = vi.fn(async () => ({ peaks: [{ name: 'Eiger' }], pending: 0, failed: 0, credits }));
    const view = store();
    expect(view.peaksCredits).toEqual([]);
    view.standAt(EYE);
    await tick();
    view.showPeaks(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(view.peaksCredits).toEqual(credits);
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

  it('reads imagery for the ground only once Satellite is picked: the latest, or a dated release', async () => {
    api.get = vi.fn(async () => ({ releases: [{ release: 64776, date: '2021-06-30' }] }));
    const view = store();
    view.standAt(EYE);
    await tick();
    expect(view.imagery).toBeNull();
    view.setGround('imagery');
    expect(view.imagery).toEqual({ provider: DRAPE_PROVIDER, near: null });
    expect(api.get).not.toHaveBeenCalled(); // the archive is only read when asked
    await view.loadReleases();
    expect(view.releases[0].date).toBe('2021-06-30');
    view.setDrapeSource('esri-wayback~64776');
    expect(view.imagery).toEqual({ provider: 'esri-wayback~64776', near: null });
    view.setGround('relief');
    expect(view.imagery).toBeNull();
    expect(view.drapeSource).toBe('esri-wayback~64776'); // kept for the next time
  });

  it('says when the imagery was refused, and asks the view to try again', async () => {
    const view = store();
    view.standAt(EYE);
    await tick();
    view.setGround('imagery');
    const before = view.retries;
    view.imageryRefused('Sentinel Hub is paused');
    expect(view.imageryError).toBe('Sentinel Hub is paused');
    view.imageryRefused('');
    expect(view.imageryError).toBe('The imagery could not be loaded.');
    view.retryImagery();
    expect(view.imageryError).toBe('');
    expect(view.retries).toBe(before + 1);
    view.retry();
    expect(view.retries).toBe(before + 2);
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
    expect(turns()[0].body).toMatchObject({ lat: 15.3, mode: 'drone', height: 300, far: 200000 });
    expect(view.placed).toMatchObject({ lat: 15.3, mode: 'drone', far: 200000 });
    expect(view.camera.heading).toBe(200);
    expect(view.ground).toBe('plain');
    expect(view.lines).toBe(true); // plain ground comes with its lines unless the address says otherwise
    view.restore({ ground: 'relief', lines: true });
    expect(view.lines).toBe(true);
  });

  it('hazes the far ground for thick air, and reaches farther only for air that sees past the default', async () => {
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
    expect(turns().at(-1).body.far).toBe(250_000);
    expect(view.placed.far).toBe(250_000);
    view.setVisibility(null);
    await tick();
    expect(turns().at(-1).body.far).toBeUndefined();
    expect(view.placed.far).toBe(150_000);
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

  it('takes the near ground away from a limit, without switching Sentinel-2 on', async () => {
    const view = store();
    view.standAt(EYE);
    await tick();
    view.setNearLimit(800);
    expect(view.near).toBe(800);
    expect(view.nearOn).toBe(false);
    await tick();
    expect(turns().at(-1).body.near).toBe(800);
    view.setNearLimit('nonsense');
    expect(view.near).toBe(0);
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

  it('says what it is doing in one line, and nothing once done', async () => {
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

  it('tries summit names, the sky and a marked point again after a failure', async () => {
    let failing = true;
    const base = api.post;
    api.get = vi.fn(async () => {
      if (failing) throw new Error('The app did not answer');
      return { peaks: [{ name: 'Eiger' }], pending: 0, failed: 0 };
    });
    api.post = vi.fn(async (path, body) => {
      if (failing && ['/api/horizon/sky', '/api/horizon/target'].includes(path)) throw new Error('offline');
      return base(path, body);
    });
    const view = store();
    view.standAt(EYE);
    await tick();
    view.showPeaks(true);
    view.showSky(true);
    await view.mark({ lat: 46.6, lon: 7.9 });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.peaksError).toBe('The app did not answer');
    expect(view.skyError).toBe('offline');
    expect(view.target.error).toBe('offline');
    failing = false;
    view.retryPeaks();
    view.retrySky();
    await view.retryTarget();
    await Promise.resolve();
    await Promise.resolve();
    expect(view.peaks[0].name).toBe('Eiger');
    // trying again asks the app not to wait out the tiles that failed
    expect(api.get.mock.calls.at(-1)[0]).toContain('&retry=true');
    expect(view.sky.date).toBe('2026-10-08');
    expect(view.target).toMatchObject({ visible: true, busy: false });
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

describe('Sentinel-2 near the eye', () => {
  function withCopernicus({ dates = [{ date: '2026-09-28', cloud: 64 }, { date: '2026-09-23', cloud: 4 }, { date: '2026-09-18', cloud: 12 }] } = {}) {
    api.get = vi.fn(async (path) => {
      requests.push({ path, body: {} });
      if (path.startsWith('/api/satellite/sentinel/dates')) return { dates };
      return { peaks: [], pending: 0, failed: 0 };
    });
  }
  const lookups = () => requests.filter((r) => r.path.startsWith('/api/satellite/sentinel/dates'));
  const estimates = () => asked('/api/horizon/tiles/estimate');
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
    expect(view.imagery.near).toBeNull();
    await view.setNear(true);
    await settle();
    expect(lookups()).toHaveLength(1);
    expect(view.nearDate).toBe('2026-09-23'); // the newest under 30% cloud, not the cloudy newest
    expect(view.imagery).toEqual({
      provider: 'esri-world-imagery',
      near: { provider: 'sentinel2~TRUE_COLOR~2026-09-23~2026-09-23~CC30', reach: NEAR_REACH },
    });
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
    expect(view.imagery.near.reach).toBe(20_000);
    view.setNearReach(123); // not offered: the default
    expect(view.nearReach).toBe(NEAR_REACH);
    await view.setNearDate('2026-09-18');
    await settle();
    expect(view.imagery.near.provider).toContain('2026-09-18');
    await view.setNear(false);
    expect(view.imagery.near).toBeNull();
  });

  it('looks for a newer pass only once the eye has moved far', async () => {
    withCopernicus();
    const view = store();
    view.standAt(EYE);
    await tick();
    view.setGround('imagery');
    await view.setNear(true);
    await settle();
    view.standAt({ lat: EYE.lat + 0.01, lon: EYE.lon });
    await tick();
    await settle();
    expect(lookups()).toHaveLength(1);
    view.standAt({ lat: EYE.lat + 0.5, lon: EYE.lon });
    await tick();
    await settle();
    expect(lookups()).toHaveLength(2);
  });

  it('says so when no pass is clear enough, and works out the cost for free', async () => {
    withCopernicus({ dates: [{ date: '2026-09-28', cloud: 90 }] });
    const view = store();
    view.standAt(EYE);
    await tick();
    view.setGround('imagery');
    await tick();
    expect(estimates()).toHaveLength(0); // the controls ask, where a Copernicus key is set
    view.askEstimate();
    await tick();
    expect(estimates().at(-1).body).toEqual({ lat: EYE.lat, lon: EYE.lon, near_provider: 'sentinel2', near_reach: NEAR_REACH });
    expect(view.nearEstimate).toEqual({ requests: 5, tiles: 9 });
    view.setNearReach(20_000);
    await tick();
    expect(view.nearEstimate).toEqual({ requests: 20, tiles: 9 });
    await view.setNear(true);
    await settle();
    expect(view.nearError).toContain('No Sentinel-2 pass under 30% cloud');
    expect(view.imagery.near).toBeNull(); // nothing billed without a pass
  });

  it('works out no cost while the ground is not Satellite', async () => {
    const view = store();
    view.standAt(EYE);
    await tick();
    view.askEstimate();
    await tick();
    expect(estimates()).toHaveLength(0);
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
    // a walk of several steps is placed once, where it ends
    expect(turns()).toHaveLength(1);
    expect(view.placed).toMatchObject({ lat: view.observer.lat, lon: view.observer.lon });
  });
});

describe('shadows from the sun and the moon', () => {
  function withSky(answer = day()) {
    const base = api.post;
    api.post = vi.fn(async (path, body) => (path === '/api/horizon/sky' ? answer : base(path, body)));
  }

  it('casts none until a day is read, then follows the hour at once', async () => {
    withSky();
    const view = store();
    view.standAt(EYE);
    await tick();
    expect(view.light.phase).toBe('map');
    expect(view.shaded).toBe(false);
    view.showSky(true);
    await Promise.resolve();
    await Promise.resolve();
    view.setSkyTime('10:00');
    expect(view.light.body).toBe('sun');
    expect(view.shaded).toBe(true);
    // the hour moves the light with nothing asked, now or later
    const count = requests.length;
    const waiting = timers.filter(Boolean).length;
    const morning = view.light.azimuth;
    view.setSkyTime('16:00');
    expect(view.light.azimuth).toBeGreaterThan(morning + 30);
    expect(timers.filter(Boolean)).toHaveLength(waiting);
    expect(requests.length).toBe(count);
    view.showSky(false);
    expect(view.shaded).toBe(false);
  });

  it('casts no shadow on a moonless night', async () => {
    withSky();
    const view = store();
    view.standAt(EYE);
    await tick();
    view.showSky(true);
    await Promise.resolve();
    await Promise.resolve();
    view.setSkyTime('02:00');
    expect(view.light).toMatchObject({ phase: 'night', body: null });
    expect(view.shaded).toBe(false);
  });

  it('lets only the sun or a moon bright enough cast shadows', () => {
    expect(castsShadows({ body: 'sun', strength: 1 })).toBe(true);
    expect(castsShadows({ body: 'moon', strength: 0.05 })).toBe(true);
    expect(castsShadows({ body: 'moon', strength: 0.01 })).toBe(false);
    expect(castsShadows({ body: null, strength: 0.5 })).toBe(false);
    expect(castsShadows(null)).toBe(false);
  });

  it('keeps shadows as dark as asked, remembered in this browser, without touching the light of the hour', async () => {
    withSky();
    const view = store();
    view.standAt(EYE);
    await tick();
    view.showSky(true);
    await Promise.resolve();
    await Promise.resolve();
    const before = view.light;
    view.setShadowDepth(1);
    expect(view.light).toEqual(before); // the light of the hour is the hour's
    expect(storage.getItem(SHADOWS_KEY)).toBe('1');
    expect(store().shadowDepth).toBe(1);
    view.setShadowDepth(-3);
    expect(view.shadowDepth).toBe(0);
    view.setShadowDepth('nonsense');
    expect(view.shadowDepth).toBe(0);
  });
});
