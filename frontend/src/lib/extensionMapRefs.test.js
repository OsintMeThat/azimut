// @vitest-environment happy-dom
/**
 * The reference windows over someone else's map (extension/mapref.js).
 *
 * The arithmetic — where a pane sits, how far into an image it is zoomed — is
 * `maptools.js` and is checked against the app's own in
 * `extensionMapTools.test.js`. What is left here is the glue, and glue is where
 * this feature can fail quietly: a window that cannot be closed, an image that
 * never arrives and says nothing, a pane that opens over the panel that opened
 * it. So the DOM is driven the way a pointer drives it.
 *
 * The canvas is faked, as in `extensionMapDraw.test.js` — happy-dom has no 2D
 * context. What is asserted is what the analyst can see and reach.
 */
import { describe, expect, it, beforeEach, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, `../../../extension/${name}`), 'utf8');

const PANE = { w: 320, h: 260 }; // what a window's body measures, since happy-dom measures nothing
const PICTURE = {
  path: 'media/roof.jpg',
  filename: 'roof.jpg',
  title: 'The roof',
  kind: 'image',
  thumbnail: 'media/.thumbs/a.jpg',
};
const CLIP = {
  path: 'media/walk.mp4',
  filename: 'walk.mp4',
  title: 'The walk',
  kind: 'video',
  thumbnail: 'media/.thumbs/b.jpg',
};

let tools;
let refsLib;

beforeAll(() => {
  const scope = { window: globalThis.window };
  for (const file of ['mapmath.js', 'maptheme.js', 'maptools.js', 'mapref.js']) {
    new Function('window', read(file))(scope.window);
  }
  tools = scope.window.AzimutMapTools;
  refsLib = scope.window.AzimutMapRefs;
  window.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => {}) });
  // neither exists in happy-dom: decoding an image and handing a video a URL
  globalThis.createImageBitmap = async () => bitmap();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:azimut/1');
  globalThis.URL.revokeObjectURL = vi.fn();
  // happy-dom measures nothing, and a pane of no size is one the code declines
  // to paint — so it is given the size a window's body actually has
  for (const [name, value] of [['clientWidth', PANE.w], ['clientHeight', PANE.h]]) {
    Object.defineProperty(window.HTMLElement.prototype, name, { get: () => value, configurable: true });
  }
});

/** A decoded image, as `createImageBitmap` would hand one over. */
const bitmap = () => ({ width: 1600, height: 1200, close: vi.fn() });

let refs;
let layer;
let asked; // the paths the panel was asked to fetch
let searches; // the narrowings it asked the case for
let notes;
let changes;
let answer; // what the case says when the picker searches

function mount({ file, search } = {}) {
  asked = [];
  searches = [];
  notes = [];
  changes = 0;
  answer = { items: [PICTURE], total: 1 };
  document.body.innerHTML = '';
  refs = tools.createRefs();
  layer = refsLib.create({
    root: document.body,
    refs,
    file:
      file ??
      ((path) => {
        asked.push(path);
        return Promise.resolve({ type: 'image/jpeg' }); // a blob, as far as this goes
      }),
    search:
      search ??
      ((params) => {
        searches.push(params);
        return Promise.resolve(answer);
      }),
    onchange: () => {
      changes += 1;
    },
    onnote: (message) => notes.push(message),
  });
}

/** Let the promises behind a file or a search land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const panes = () => [...document.body.querySelectorAll('.rw')];
const press = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const point = (node, type, at = {}) =>
  node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: at.x ?? 0, clientY: at.y ?? 0 }));

beforeEach(() => mount());

describe('opening an image over the map', () => {
  it('mounts one window per reference, named after the file', async () => {
    refs.add(PICTURE);
    layer.sync();
    await settle();
    expect(panes()).toHaveLength(1);
    expect(panes()[0].querySelector('.rw-title').textContent).toBe('The roof');
    expect(asked).toEqual(['media/roof.jpg']);
    expect(panes()[0].querySelector('.rw-wait')).toBe(null); // the image arrived
  });

  it('sits above the drawing and below the panel', () => {
    refs.add(PICTURE);
    refs.add(PICTURE);
    layer.sync();
    // the draw layer is z-index 1 and the panel is above every window; what
    // matters is that opening windows never climbs
    expect(panes().map((el) => el.style.zIndex)).toEqual(['2', '3']);
  });

  it('keeps the window when the file cannot be handed over, and says why', async () => {
    mount({ file: () => Promise.reject(new Error('that picture is too large to hand over')) });
    refs.add(PICTURE);
    layer.sync();
    await settle();
    expect(panes()).toHaveLength(1);
    expect(panes()[0].querySelector('.rw-wait').textContent).toBe('that picture is too large to hand over');
    expect(notes).toEqual(['that picture is too large to hand over']);
  });
});

describe('opening a video over the map', () => {
  const pane = () => panes()[0];

  beforeEach(async () => {
    refs.add(CLIP);
    layer.sync();
    await settle();
  });

  it('plays it in a video element, from an object URL', () => {
    const video = pane().querySelector('video');
    expect(video.src).toBe('blob:azimut/1');
    expect(video.controls).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalled();
    // nothing to zoom: a video has no fit-and-scale of its own here
    expect(pane().querySelector('.rw-foot')).toBe(null);
  });

  it('says so when the site will not play it, instead of sitting there black', () => {
    // a blob: URL is the one thing in this panel a page's content policy can
    // veto, and the veto arrives as an error on the element
    pane().querySelector('video').dispatchEvent(new window.Event('error'));
    expect(pane().querySelector('.rw-wait').textContent).toMatch(/will not play a video/);
    expect(notes.at(-1)).toMatch(/will not play a video/);
    expect(pane().querySelector('video')).toBe(null);
  });

  it('leaves the video its own controls, and still keeps the map still', () => {
    const down = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    pane().querySelector('.rw-body').dispatchEvent(down);
    // cancelling this would kill the scrub bar; the map is held off by the
    // panel's own guard on anything inside the shadow root
    expect(down.defaultPrevented).toBe(false);
  });

  it('gives the URL back when the window closes', () => {
    press(pane().querySelector('[data-rw="close"]'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:azimut/1');
  });
});

describe('working one window', () => {
  const pane = () => panes()[0];
  const control = (act) => pane().querySelector(`[data-rw="${act}"]`);

  beforeEach(async () => {
    refs.add(PICTURE);
    layer.sync();
    await settle();
  });

  it('closes from its own header, and tells the panel', () => {
    press(control('close'));
    expect(panes()).toHaveLength(0);
    expect(refs.open).toEqual([]);
    expect(changes).toBe(1);
  });

  it('folds away to its header and comes back', () => {
    press(control('fold'));
    expect(pane().querySelector('.rw-body').style.display).toBe('none');
    press(control('fold'));
    expect(pane().querySelector('.rw-body').style.display).toBe('');
  });

  it('zooms about the middle of the pane and resets to fit', () => {
    press(control('in'));
    expect(refs.open[0].scale).toBeCloseTo(1.25, 6);
    expect(pane().querySelector('.rw-zoom').textContent).toBe('125%');
    press(control('out'));
    expect(refs.open[0].scale).toBeCloseTo(1, 6);
    press(control('in'));
    press(control('reset'));
    expect(refs.open[0]).toMatchObject({ scale: 1, ox: 0, oy: 0 });
  });

  it('zooms the picture on a wheel and leaves the map alone', () => {
    const wheel = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 });
    pane().querySelector('.rw-body').dispatchEvent(wheel);
    expect(refs.open[0].scale).toBeCloseTo(1.15, 6);
    // the map underneath must not zoom with it
    expect(wheel.defaultPrevented).toBe(true);
  });

  it('drags by the header, and stops at the edge of the screen', () => {
    const head = pane().querySelector('header');
    point(head, 'pointerdown', { x: 100, y: 100 });
    point(window, 'pointermove', { x: 140, y: 130 });
    expect(refs.open[0]).toMatchObject({ x: 100, y: 90 });
    point(window, 'pointermove', { x: 9000, y: 9000 });
    point(window, 'pointerup');
    expect(refs.open[0].x).toBe(window.innerWidth - refs.open[0].w);
    expect(pane().style.left).toBe(`${window.innerWidth - refs.open[0].w}px`);
  });

  it('keeps the fold chevron under the pointer that pressed it', () => {
    // Pressing anywhere in a window focuses it, which restacks every window and
    // re-places them all. Redrawing this glyph there took the node out of the
    // DOM between the press and the release, and the click never landed: a
    // chevron that swallowed its own click and folded nothing.
    const button = pane().querySelector('[data-rw="fold"]');
    const glyph = button.firstElementChild;
    point(pane(), 'pointerdown');
    expect(button.firstElementChild).toBe(glyph);

    press(button);
    expect(refs.open[0].collapsed).toBe(true);
    expect(button.firstElementChild).not.toBe(glyph); // it turns over when it folds
    expect(button.title).toBe('Unfold');
  });

  it('folds on a double-click on the title bar', () => {
    pane().querySelector('header').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    expect(refs.open[0].collapsed).toBe(true);
    expect(pane().querySelector('.rw-body').style.display).toBe('none');
    // the panel lists the open windows, so it has to hear about it
    expect(changes).toBe(1);
  });

  it('raises the window it is pointed at', () => {
    refs.add(PICTURE);
    layer.sync();
    expect(panes().map((el) => el.style.zIndex)).toEqual(['2', '3']);
    point(panes()[0], 'pointerdown');
    expect(panes().map((el) => el.style.zIndex)).toEqual(['3', '2']);
  });
});

describe('choosing what to open', () => {
  const picker = () => document.body.querySelector('.pick');

  it('lists what the case answers and opens the one pressed', async () => {
    layer.openPicker();
    await settle();
    expect(picker().querySelectorAll('.pick-item')).toHaveLength(1);
    expect(picker().querySelector('.pick-name').textContent).toBe('The roof');
    // the thumbnail is fetched for the grid; the file itself only on a pick
    expect(asked).toEqual(['media/.thumbs/a.jpg']);
    expect(picker().querySelector('.pick-thumb canvas')).not.toBe(null);

    press(picker().querySelector('.pick-item'));
    expect(picker()).toBe(null);
    expect(refs.open).toHaveLength(1);
    expect(panes()).toHaveLength(1);
  });

  it('says how much of a long case it is showing', async () => {
    mount({ search: () => Promise.resolve({ items: [PICTURE, PICTURE], total: 214 }) });
    layer.openPicker();
    await settle();
    expect(picker().querySelector('.hint').textContent).toBe('2 of 214 — search to narrow it down');
  });

  it('says when a case has nothing to offer', async () => {
    mount({ search: () => Promise.resolve({ items: [], total: 0 }) });
    layer.openPicker();
    await settle();
    expect(picker().querySelector('.hint').textContent).toMatch(/no images or videos/i);
  });

  it('says when the app could not be reached, rather than looking empty', async () => {
    mount({ search: () => Promise.reject(new Error('Azimut is not answering. Is the app running?')) });
    layer.openPicker();
    await settle();
    expect(picker().querySelector('.hint').textContent).toMatch(/not answering/);
  });

  it('drops the answer to a search that has already been typed past', async () => {
    // the first letter's answer landing last would put the whole case back over
    // the word the analyst is actually looking at
    const pending = [];
    mount({
      search: ({ q }) =>
        new Promise((resolve) => {
          pending.push(() => resolve({ items: [{ ...PICTURE, title: q || 'everything' }], total: 1 }));
        }),
    });
    layer.openPicker();
    const input = picker().querySelector('input');
    input.value = 'roof';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300)); // past the debounce
    expect(pending).toHaveLength(2);

    pending[1](); // the search for "roof" answers
    await settle();
    pending[0](); // and the one for "" answers after it
    await settle();
    expect(picker().querySelector('.pick-name').textContent).toBe('roof');
  });

  it('asks the case for the narrowing that was chosen', async () => {
    layer.openPicker();
    await settle();
    expect(searches).toEqual([{ q: '', kind: '', sort: 'newest' }]);

    const choose = (which, value) => {
      const select = picker().querySelector(`[data-pick="${which}"]`);
      select.value = value;
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    };
    choose('kind', 'video');
    await settle();
    choose('sort', 'name');
    await settle();
    // filtering and ordering are the app's: a browser tab holds one page of a
    // case, never the case
    expect(searches.at(-1)).toEqual({ q: '', kind: 'video', sort: 'name' });
  });

  it('marks a video in the grid, and counts both kinds as files', async () => {
    mount({ search: () => Promise.resolve({ items: [PICTURE, CLIP], total: 2 }) });
    layer.openPicker();
    await settle();
    const tiles = picker().querySelectorAll('.pick-item');
    expect(tiles[0].querySelector('.pick-kind')).toBe(null);
    expect(tiles[1].querySelector('.pick-kind')).not.toBe(null);
    expect(picker().querySelector('.hint').textContent).toBe('2 files');
  });

  it('closes on Escape and on its own close button', async () => {
    layer.openPicker();
    await settle();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(picker()).toBe(null);
    expect(layer.picking).toBe(false);

    layer.openPicker();
    await settle();
    press(picker().querySelector('[data-pick="close"]'));
    expect(picker()).toBe(null);
  });
});

describe('putting the panel down', () => {
  it('takes every window and the picker with it', async () => {
    refs.add(PICTURE);
    layer.sync();
    layer.openPicker();
    await settle();
    layer.destroy();
    expect(document.body.querySelectorAll('.rw, .pick')).toHaveLength(0);
  });

  it('drops the windows the tool no longer holds', async () => {
    refs.add(PICTURE);
    refs.add(PICTURE);
    layer.sync();
    await settle();
    refs.clear(); // what changing case does
    layer.sync();
    expect(panes()).toHaveLength(0);
  });
});
