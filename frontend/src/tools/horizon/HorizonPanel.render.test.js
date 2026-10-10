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
import { createHorizonState, waybackSource } from './state/horizon.svelte.js';
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
      if (path === '/api/horizon/tiles/estimate') return { requests: 3, tiles: 9 };
      if (path === '/api/horizon/target') {
        return { azimuth: 90, angle: 1.2, distance: 5000, visible: true, margin_deg: 0.4, ground: 1200 };
      }
      if (path === '/api/horizon/sky') {
        const track = { azimuth: [90, 180], altitude: [-5, 30], clear: [false, true], events: [] };
        return { date: body.date ?? '2026-10-08', step_minutes: 720, sun: track, moon: { ...track, illuminated: 0.5 } };
      }
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
const openImagery = (root) => {
  root.querySelector('[aria-controls="hz-imagery"]').click();
  flushSync();
};
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
    const groups = [...root.querySelectorAll('details')].map((group) => [group.querySelector('.group-title').textContent, group.open]);
    expect(groups).toEqual([
      ['Viewpoint', true],
      ['Lens', true],
      ['On the view', true],
      ['More settings', false],
    ]);
    expect(text(root)).toContain('Eye height');
    expect(text(root)).toContain('Ground 2866 m above sea level');
    expect(text(root)).toContain('Summit names OpenStreetMap');
    // the heading is the caret's alone
    expect(text(root)).not.toMatch(/Heading/);
  });

  it('says a folded group\'s gist on its title line, and only while it is folded', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const root = render(HorizonPanel, { view });
    const lens = [...root.querySelectorAll('details')].find((group) => group.querySelector('.group-title').textContent === 'Lens');
    expect(lens.querySelector('.gist')).toBeNull();
    lens.open = false;
    lens.dispatchEvent(new Event('toggle'));
    flushSync();
    expect(lens.querySelector('.gist').textContent).toMatch(/^\d+° · \d+ mm$/);
    const more = [...root.querySelectorAll('details')].find((group) => group.querySelector('.group-title').textContent === 'More settings');
    expect(more.querySelector('.gist')).toBeNull(); // nothing set there yet
    view.look({ tilt: 3 });
    flushSync();
    expect(more.querySelector('.gist').textContent).toBe('Leaning');
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
    expect(text(root)).toContain('Height');
    expect(text(root)).toContain('above the ground');
    button(root, 'Aircraft').click();
    flushSync();
    expect(text(root)).toContain('Altitude');
    expect(text(root)).toContain('above sea level');
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

  it('clears the ground clicked in the view, and says again how to read it', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    view.point({ lat: 46.6, lon: 7.95, azimuth: 60, elevation: -1, distance: 9010 });
    const root = render(HorizonPanel, { view });
    const reading = root.querySelector('.reading.pointed');
    [...reading.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Clear').click();
    flushSync();
    expect(view.pointed).toBeNull();
    expect(reading.textContent).toContain('Click the view to read the ground there.');
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

  it('says quietly that some summits are missing while the app asks again by itself', async () => {
    let fail = true;
    const api = fakeApi({
      peaks: async () => (fail ? { peaks: [], pending: 0, failed: 3, retry_in: 30 } : { peaks: [], pending: 0, failed: 0 }),
    });
    const view = state(api);
    view.standAt(EYE);
    await settle();
    view.showPeaks(true);
    await settle();
    const root = render(HorizonPanel, { view });
    expect(root.querySelector('[role="alert"]')).toBeNull();
    const note = root.querySelector('.problem[role="status"]');
    expect(note.textContent).toContain('OpenFreeMap did not answer for some summits');
    fail = false;
    button(note, 'Try again').click();
    await settle();
    expect(api.get.mock.calls.at(-1)[0]).toContain('&retry=true');
    expect(root.querySelector('.problem')).toBeNull();
  });

  it('says when the imagery was refused, and asks for it again', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    view.setGround('imagery');
    view.imageryRefused('Sentinel Hub is paused: 90% of the monthly free tier is used');
    const root = render(HorizonPanel, { view });
    const alert = root.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Sentinel Hub is paused');
    const before = view.retries;
    button(alert, 'Try again').click();
    flushSync();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(view.retries).toBe(before + 1);
  });

  it('hides the ground closer than a limit, leaving Sentinel-2 alone', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const root = render(HorizonPanel, { view });
    const field = [...root.querySelectorAll('label')].find((label) => label.textContent.includes('Hide nearer than'));
    const input = root.querySelector(`#${field.htmlFor}`);
    input.value = '750';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(view.near).toBe(750);
    expect(view.nearOn).toBe(false);
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

describe('a photo laid over the view, in the inspector', () => {
  function photo(over = {}) {
    return {
      source: { name: 'summit.jpg', kind: 'image' },
      lens: null,
      facts: {},
      size: { width: 4000, height: 3000 },
      strokes: [],
      busy: false,
      bend: 0,
      setBend: vi.fn(),
      useLens: vi.fn(),
      undoStroke: vi.fn(),
      clearTrace: vi.fn(),
      ...over,
    };
  }

  it('undoes a lens’s curve from a slider, says which kind, and double-click sets none', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const overlay = photo({ bend: -0.12 });
    const root = render(HorizonPanel, { view, overlay, onmove: vi.fn() });
    const slider = root.querySelector('input[aria-label="Lens distortion"]');
    expect(slider.getAttribute('aria-valuetext')).toBe('Barrel 0.12');
    expect(text(root)).toContain('Distortion');
    slider.value = '0.05';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(overlay.setBend).toHaveBeenLastCalledWith('0.05');
    slider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(overlay.setBend).toHaveBeenLastCalledWith(0);
    const straight = render(HorizonPanel, { view, overlay: photo(), onmove: vi.fn() });
    expect(straight.querySelector('input[aria-label="Lens distortion"]').getAttribute('aria-valuetext')).toBe('None');
  });
});

describe('a photo locked to the terrain, in the inspector', () => {
  it('holds still whatever would part photo and terrain, and says why', async () => {
    const view = state();
    view.standAt(EYE);
    await settle();
    const overlay = {
      source: { name: 'summit.jpg', kind: 'image' },
      lens: null,
      facts: {},
      size: { width: 4000, height: 3000 },
      strokes: [],
      busy: false,
      bend: 0,
      locked: true,
      setBend: vi.fn(),
    };
    const root = render(HorizonPanel, { view, overlay, onmove: vi.fn() });
    expect(text(root)).toContain('Photo and terrain move together');
    const sheet = (title) =>
      [...root.querySelectorAll('details')].find((group) => group.querySelector('.group-title').textContent === title).querySelector('fieldset');
    expect(sheet('Viewpoint').disabled).toBe(true);
    expect(sheet('Lens').disabled).toBe(true);
    expect(sheet('On the view').disabled).toBe(false);
    expect(root.querySelector('input[aria-label="Lens distortion"]').disabled).toBe(true);
    expect(root.querySelector('input[aria-label="Tilt"]').disabled).toBe(true);
    expect(root.querySelector('input[aria-label="Visibility"]').disabled).toBe(false);
  });
});

describe('a number with its arrows', () => {
  it('steps by a tenth, ten tenths with Shift, within its bounds', async () => {
    const { default: NumberField } = await import('./NumberField.svelte');
    const onchange = vi.fn();
    const root = render(NumberField, { value: 1.7, unit: 'm', step: 0.1, min: 0.5, max: 2, label: 'Eye height', onchange });
    const up = root.querySelector('button[aria-label="Eye height up"]');
    const down = root.querySelector('button[aria-label="Eye height down"]');
    up.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(onchange).toHaveBeenLastCalledWith(1.8);
    down.dispatchEvent(new PointerEvent('pointerdown', { button: 0, shiftKey: true, bubbles: true }));
    down.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(onchange).toHaveBeenLastCalledWith(0.7);
    const low = render(NumberField, { value: 0.6, step: 0.1, min: 0.5, label: 'Low', onchange });
    low.querySelector('button[aria-label="Low down"]').dispatchEvent(new PointerEvent('pointerdown', { button: 0, shiftKey: true, bubbles: true }));
    low.querySelector('button[aria-label="Low down"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(onchange).toHaveBeenLastCalledWith(0.5);
    const input = root.querySelector('input');
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onchange).toHaveBeenLastCalledWith(null);
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

  it('keep Sentinel-2 locked without a Copernicus key, and say how to get one', () => {
    const view = state();
    view.setGround('imagery');
    const onsetup = vi.fn();
    const root = render(PictureControls, { view, copernicus: false, onsetup });
    openImagery(root);
    const locked = [...root.querySelectorAll('button')].find((b) => b.textContent.includes('Sentinel-2'));
    expect(locked.textContent.trim()).toBe('Sentinel-2 near the eye');
    locked.click();
    expect(onsetup).toHaveBeenCalledTimes(1);
  });

  it('offer Sentinel-2 near the eye with a Copernicus key, out to a distance picked', () => {
    const view = state();
    view.setGround('imagery');
    const root = render(PictureControls, { view, copernicus: true });
    openImagery(root);
    const near = [...root.querySelectorAll('button')].find((b) => b.textContent.includes('Sentinel-2 nearer than'));
    expect(near.getAttribute('aria-pressed')).toBe('false');
    const reach = root.querySelector('[aria-label="How far Sentinel-2 is laid"]');
    expect([...reach.options].map((option) => option.textContent)).toEqual(['2 km', '5 km', '10 km', '20 km', '30 km']);
  });

  it('offer a release of the imagery only with satellite ground, folded under one button', () => {
    const view = state();
    const root = render(PictureControls, { view });
    expect(root.querySelector('[aria-controls="hz-imagery"]')).toBeNull();
    button(root, 'Satellite').click();
    flushSync();
    // one row on the sky: the settings wait under the button that names the release
    expect(root.querySelector('select')).toBeNull();
    expect(root.querySelector('[aria-controls="hz-imagery"]').textContent.trim()).toBe('Latest imagery');
    openImagery(root);
    const select = root.querySelector('select');
    expect(select.options[0].textContent).toBe('Latest imagery');
    expect(select.options[1].textContent).toBe('Older releases…');
    // another ground folds them away, and coming back finds them folded
    button(root, 'Relief').click();
    flushSync();
    button(root, 'Satellite').click();
    flushSync();
    expect(root.querySelector('#hz-imagery')).toBeNull();
  });

  it('name the release drawn and Sentinel-2 near on the folded button, and fold away on Escape or a press elsewhere', () => {
    const view = {
      ground: 'imagery',
      lines: false,
      drapeSource: waybackSource(13192),
      releases: [{ release: 13192, date: '2023-05-10' }],
      releasesBusy: false,
      nearOn: true,
      nearReach: 5000,
      nearEstimate: null,
      nearPasses: [],
      placed: null,
      setGround: vi.fn(),
      setLines: vi.fn(),
    };
    const root = render(PictureControls, { view, copernicus: true });
    const more = root.querySelector('[aria-controls="hz-imagery"]');
    expect(text(more).trim()).toBe('2023-05-10 S2 · 5 km');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    openImagery(root);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('#hz-imagery [aria-label="How far Sentinel-2 is laid"]')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(root.querySelector('#hz-imagery')).toBeNull();
    openImagery(root);
    root.querySelector('#hz-imagery select').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    flushSync();
    expect(root.querySelector('#hz-imagery')).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    flushSync();
    expect(root.querySelector('#hz-imagery')).toBeNull();
  });

  it('lay the imagery open, without the lines, inside a menu that has them elsewhere', () => {
    const view = state();
    view.setGround('imagery');
    const root = render(PictureControls, { view, lines: false, menu: false });
    expect([...root.querySelectorAll('button')].some((b) => b.textContent.includes('Ridge lines'))).toBe(false);
    expect(root.querySelector('[aria-controls="hz-imagery"]')).toBeNull();
    expect(root.querySelector('[aria-label="Which imagery"]')).not.toBeNull();
  });
});
