// @vitest-environment happy-dom
/**
 * The Horizon inspector and the picture controls on the view, mounted over the
 * tab's real state with a stand-in for the app.
 *
 * The state's own rules (what asks the app for what) are `horizon.svelte.test.js`;
 * this checks what a first-time user meets: four named groups with the rarely
 * touched settings folded away, a reading for the marked point and the clicked
 * ground with the act each one calls for, what failed with a way to try again,
 * and segmented buttons that say which one is pressed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { createHorizonState } from './state/horizon.svelte.js';
import HorizonPanel from './HorizonPanel.svelte';
import PictureControls from './PictureControls.svelte';

const EYE = { lat: 46.5586, lon: 7.8353 };

function picture(step) {
  return {
    observer: { lat: EYE.lat, lon: EYE.lon, ground: 2866, altitude: 2867.7 },
    far: 150000,
    azimuth: { start: 0, step, count: Math.round(360 / step), full: true },
    elevation: { top: 12, step, count: Math.round(37 / step) + 1 },
  };
}

function fakeApi({ peaks = async () => ({ peaks: [], pending: 0, failed: 0 }) } = {}) {
  return {
    post: vi.fn(async (path, body) => {
      if (path === '/api/horizon/target') {
        return { azimuth: 90, angle: 1.2, distance: 5000, visible: true, margin_deg: 0.4, ground: 1200 };
      }
      if (path === '/api/horizon/sky') {
        const track = { azimuth: [90, 180], altitude: [-5, 30], clear: [false, true], events: [] };
        return { date: body.date ?? '2026-10-08', step_minutes: 720, sun: track, moon: { ...track, illuminated: 0.5 } };
      }
      if (path === '/api/horizon/shadow') throw new Error('not asked here');
      return picture(body.step);
    }),
    get: vi.fn(peaks),
  };
}

let live = [];
let timers = [];

function state(api = fakeApi()) {
  const held = new Map();
  return createHorizonState({
    api,
    decode: async (answer) => answer,
    image: async () => ({}),
    later: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel: (handle) => {
      timers[handle - 1] = null;
    },
    storage: { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => held.set(key, value) },
  });
}

async function settle() {
  for (let round = 0; round < 3; round += 1) {
    const due = timers.filter(Boolean);
    timers = [];
    for (const fn of due) await fn();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }
  flushSync();
}

function render(Component, props) {
  const target = document.createElement('div');
  document.body.append(target);
  live.push(mount(Component, { target, props }));
  flushSync();
  return target;
}

const button = (root, name) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
const text = (root) => root.textContent.replace(/\s+/g, ' ');

afterEach(() => {
  for (const component of live) unmount(component);
  live = [];
  timers = [];
  document.body.innerHTML = '';
});

describe('the Horizon inspector', () => {
  it('shows nothing to set before there is a viewpoint', () => {
    const root = render(HorizonPanel, { view: state() });
    expect(root.querySelectorAll('details')).toHaveLength(0);
  });

  it('names four groups, the rarely touched ones folded away', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const root = render(HorizonPanel, { view, onmove: vi.fn() });
    const groups = [...root.querySelectorAll('details')].map((group) => [group.querySelector('summary').textContent, group.open]);
    expect(groups).toEqual([
      ['Viewpoint', true],
      ['Lens', true],
      ['On the view', true],
      ['More settings', false],
    ]);
    expect(text(root)).toContain('Eye height');
    expect(text(root)).toContain('Ground 2866 m above sea level');
    expect(text(root)).toContain('Summit names (OpenStreetMap)');
    // the heading is the caret's alone
    expect(text(root)).not.toMatch(/Heading/);
  });

  it('says which kind of eye is pressed, and names its height for it', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const root = render(HorizonPanel, { view });
    expect(button(root, 'On foot').getAttribute('aria-pressed')).toBe('true');
    button(root, 'Drone').click();
    flushSync();
    expect(button(root, 'Drone').getAttribute('aria-pressed')).toBe('true');
    expect(button(root, 'On foot').getAttribute('aria-pressed')).toBe('false');
    expect(text(root)).toContain('Height above ground');
    button(root, 'Aircraft').click();
    flushSync();
    expect(text(root)).toContain('Altitude above sea');
  });

  it('offers Move the viewpoint only where it can be done', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const onmove = vi.fn();
    const looking = render(HorizonPanel, { view, onmove });
    button(looking, 'Move the viewpoint').click();
    expect(onmove).toHaveBeenCalledTimes(1);
    const moving = render(HorizonPanel, { view, onmove: null });
    expect(button(moving, 'Move the viewpoint')).toBeUndefined();
  });

  it('reads the marked point first, and turns to it or clears it', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    await view.mark({ lat: 46.56, lon: 7.9 });
    const onturn = vi.fn();
    const root = render(HorizonPanel, { view, onturn });
    expect(text(root)).toContain('In sight');
    expect(text(root)).toContain('5.00 km away · bearing 90°');
    expect(text(root)).toContain('0.4° above the ground in front');
    button(root, 'Turn to it').click();
    expect(onturn).toHaveBeenCalledWith({ azimuth: 90, elevation: 1.2 });
    button(root, 'Clear').click();
    flushSync();
    // the reading keeps its place and says how to fill it again
    expect(text(root)).toContain('Click the map to mark a point.');
    expect(button(root, 'Turn to it')).toBeUndefined();
  });

  it('keeps both readings in place before anything is read, each saying how', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const root = render(HorizonPanel, { view });
    const readings = root.querySelector('.readings');
    expect(readings.textContent).toContain('Click the map to mark a point.');
    expect(readings.textContent).toContain('Click the view to read the ground there.');
    // the readings come before the settings, so the settings never move under a click
    expect(readings.compareDocumentPosition(root.querySelector('details')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('stands on the ground clicked in the view', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    view.point({ lat: 46.6, lon: 7.95, azimuth: 60, elevation: -1, distance: 9010 });
    const root = render(HorizonPanel, { view });
    expect(text(root)).toContain('Clicked in the view');
    expect(text(root)).toContain('9.01 km away');
    button(root, 'Stand here').click();
    expect(view.observer).toMatchObject({ lat: 46.6, lon: 7.95 });
  });

  it('says what failed beside the picture, with a way to try again', async () => {
    let fail = true;
    const view = state(
      fakeApi({
        peaks: async () => {
          if (fail) throw new Error('OpenStreetMap did not answer');
          return { peaks: [], pending: 0, failed: 0 };
        },
      })
    );
    view.standAt(EYE);
    await settle();
    view.showPeaks(true);
    await settle();
    const root = render(HorizonPanel, { view });
    const alert = root.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('OpenStreetMap did not answer');
    fail = false;
    button(alert, 'Try again').click();
    await settle();
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('picks the sun\'s day on a calendar as well as by typing it', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    view.showSky(true);
    view.setSkyDate('2026-10-08');
    const root = render(HorizonPanel, { view });
    const pick = root.querySelector('[aria-label="Pick the day on a calendar"]');
    expect(root.querySelector('[role="group"][aria-label="Day at the viewpoint calendar"]')).toBeNull();
    pick.click();
    flushSync();
    const grid = root.querySelector('[role="group"][aria-label="Day at the viewpoint calendar"]');
    expect(grid).not.toBeNull();
    const day = [...grid.querySelectorAll('button')].find((b) => b.textContent.trim() === '21');
    day.click();
    flushSync();
    expect(view.skyDate).toBe('2026-10-21');
    expect(root.querySelector('[role="group"][aria-label="Day at the viewpoint calendar"]')).toBeNull();
  });

  it('levels the view only once it leans, and sets line density only while lines are drawn', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const root = render(HorizonPanel, { view });
    expect(button(root, 'Level the view').disabled).toBe(true);
    expect(root.querySelector('[aria-label="How many ridge lines"]')).toBeNull();
    view.look({ tilt: 4, roll: -2 });
    view.setLines(true);
    flushSync();
    expect(button(root, 'Level the view').disabled).toBe(false);
    expect(root.querySelector('[aria-label="How many ridge lines"]')).not.toBeNull();
    button(root, 'Level the view').click();
    expect(view.camera).toMatchObject({ tilt: 0, roll: 0 });
  });
});

describe('the picture controls on the view', () => {
  it('say which ground is drawn, and plain ground brings its lines', () => {
    const view = state();
    const root = render(PictureControls, { view });
    const lines = () => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ridge lines');
    const group = root.querySelector('[role="group"]');
    expect(group.getAttribute('aria-label')).toBe('Ground drawn as');
    expect(button(root, 'Relief').getAttribute('aria-pressed')).toBe('true');
    expect(lines().getAttribute('aria-pressed')).toBe('false');
    button(root, 'Plain').click();
    flushSync();
    expect(button(root, 'Plain').getAttribute('aria-pressed')).toBe('true');
    expect(lines().getAttribute('aria-pressed')).toBe('true');
    lines().click();
    flushSync();
    expect(view.lines).toBe(false);
  });

  it('switch full detail on and off, and say which', () => {
    const view = state();
    const root = render(PictureControls, { view });
    const full = () => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Full detail');
    expect(full().getAttribute('aria-pressed')).toBe('false');
    full().click();
    flushSync();
    expect(view.fullDetail).toBe(true);
    expect(full().getAttribute('aria-pressed')).toBe('true');
  });

  it('keep Sentinel-2 locked without a Copernicus key, and say how to get one', () => {
    const view = state();
    view.setGround('imagery');
    const onsetup = vi.fn();
    const root = render(PictureControls, { view, copernicus: false, onsetup });
    const locked = [...root.querySelectorAll('button')].find((b) => b.textContent.includes('Sentinel-2'));
    expect(locked.textContent.trim()).toBe('Sentinel-2 near the eye');
    locked.click();
    expect(onsetup).toHaveBeenCalledTimes(1);
  });

  it('offer Sentinel-2 near the eye with a Copernicus key, out to a distance picked', () => {
    const view = state();
    view.setGround('imagery');
    const root = render(PictureControls, { view, copernicus: true });
    const near = [...root.querySelectorAll('button')].find((b) => b.textContent.includes('Sentinel-2 nearer than'));
    expect(near.getAttribute('aria-pressed')).toBe('false');
    const reach = root.querySelector('[aria-label="How far Sentinel-2 is laid"]');
    expect([...reach.options].map((option) => option.textContent)).toEqual(['2 km', '5 km', '10 km', '20 km', '30 km']);
  });

  it('offer a release of the imagery only with satellite ground', () => {
    const view = state();
    const root = render(PictureControls, { view });
    expect(root.querySelector('select')).toBeNull();
    button(root, 'Satellite').click();
    flushSync();
    const select = root.querySelector('select');
    expect(select.options[0].textContent).toBe('Latest imagery');
    expect(select.options[1].textContent).toBe('Older releases…');
  });
});
