// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Zone search over Inspect's viewer, driven as an analyst drives it: a drag over
 * the picture draws the zone, a second drag draws a new one, and the bar beside it
 * hands the zone to an engine through the one hand-off Reverse Search uses.
 */

const prefs = { reversePrefill: false };
vi.mock('../../lib/state.svelte.js', () => ({ prefs, toast: vi.fn() }));
let installed = null;
vi.mock('../../lib/extBridge.js', () => ({ extensionVersion: () => installed, handOffReverse: vi.fn() }));
// a press that keeps the link from opening anything here
const pressEngine = vi.fn((event) => event.preventDefault());
const copyPicture = vi.fn();
vi.mock('../../lib/reverseHandoff.js', async (original) => ({
  ...(await original()),
  pressEngine,
  copyPicture,
}));

const { default: ZoneSearch } = await import('./ZoneSearch.svelte');

// The picture stands 640 × 360 at (100, 50) of a viewer at the origin.
const PICTURE = { left: 100, top: 50, width: 640, height: 360, right: 740, bottom: 410, x: 100, y: 50 };

let live = null;
let target = null;
let picture;
let state;

function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  picture = document.createElement('img');
  target.append(picture);
  picture.getBoundingClientRect = () => PICTURE;
  const held = $state({ zone: props.zone ?? null });
  state = held;
  const zonePicture = { png: () => Promise.resolve(new Blob(['png'])), name: 'reverse-clip-zone.png', what: 'zone' };
  const handlers = { picture: vi.fn(() => zonePicture), onclose: vi.fn() };
  live = mount(ZoneSearch, {
    target,
    props: {
      box: () => picture,
      width: 1920,
      height: 1080,
      get zone() {
        return state.zone;
      },
      set zone(value) {
        state.zone = value;
      },
      ...handlers,
      ...props,
    },
  });
  flushSync();
  return handlers;
}

const layer = () => target.querySelector('.cropbox-layer');
const bar = () => target.querySelector('.zone-bar');
const buttonNamed = (text) =>
  [...target.querySelectorAll('button, a')].find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text);

function drag(from, to) {
  const at = (p) => ({ clientX: p[0], clientY: p[1], button: 0, bubbles: true });
  layer().dispatchEvent(new PointerEvent('pointerdown', at(from)));
  window.dispatchEvent(new PointerEvent('pointermove', at(to)));
  window.dispatchEvent(new PointerEvent('pointerup', at(to)));
  flushSync();
}

beforeEach(() => {
  prefs.reversePrefill = false;
  installed = null;
  pressEngine.mockClear();
  copyPicture.mockReset();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('drawing the zone', () => {
  it('asks for a drag first, with the whole picture one press away', () => {
    open();
    expect(bar().textContent).toContain('Drag over what to search');
    expect(target.querySelectorAll('.engine')).toHaveLength(0);
    buttonNamed('Whole picture').click();
    flushSync();
    expect(state.zone).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(buttonNamed('Whole picture')).toBeUndefined();
  });

  it('reads a drag over the picture as fractions of it, again and again', () => {
    open();
    // the layer is the picture's own box
    layer().getBoundingClientRect = () => PICTURE;
    drag([260, 140], [420, 230]);
    expect(state.zone.x).toBeCloseTo(0.25);
    expect(state.zone.y).toBeCloseTo(0.25);
    expect(state.zone.w).toBeCloseTo(0.25);
    expect(state.zone.h).toBeCloseTo(0.25);
    // still armed: a second drag draws a new zone rather than nothing
    drag([100, 50], [420, 230]);
    expect(state.zone.x).toBeCloseTo(0);
    expect(state.zone.w).toBeCloseTo(0.5);
  });

  it('keeps the zone it had when a press never became a drag', () => {
    open({ zone: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } });
    layer().getBoundingClientRect = () => PICTURE;
    drag([300, 200], [301, 200]);
    expect(state.zone).toEqual({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 });
  });
});

describe('the engines beside the zone', () => {
  it('lists the four engines, each saying the road its press takes', () => {
    open({ zone: { x: 0.1, y: 0.1, w: 0.25, h: 0.25 } });
    const engines = [...target.querySelectorAll('.engine')];
    expect(engines.map((a) => a.textContent.trim())).toEqual(['Google Lens', 'Yandex', 'Bing', 'TinEye']);
    expect(engines[0].title).toBe('Copies the zone, then paste it in the tab (Ctrl+V)');
    expect(engines[1].title).toBe('Saves the zone, then drag the file into the tab');
    expect(engines.every((a) => a.target === '_blank')).toBe(true);
  });

  it('says every engine opens with the zone in it once the extension fills them', () => {
    prefs.reversePrefill = true;
    installed = '1.2.0';
    open({ zone: { x: 0.1, y: 0.1, w: 0.25, h: 0.25 } });
    const titles = [...target.querySelectorAll('.engine')].map((a) => a.title);
    expect(new Set(titles)).toEqual(new Set(['Opens with the zone in it']));
  });

  it('hands the engine pressed the zone the tool rendered', () => {
    const { picture: zonePicture } = open({ zone: { x: 0.1, y: 0.1, w: 0.25, h: 0.25 } });
    buttonNamed('Bing').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(zonePicture).toHaveBeenCalledTimes(1);
    expect(pressEngine).toHaveBeenCalledTimes(1);
    const [, engine, given, filled] = pressEngine.mock.calls[0];
    expect(engine.id).toBe('bing');
    expect(given.name).toBe('reverse-clip-zone.png');
    expect(filled).toEqual([]);
  });

  it('copies the zone for an engine of the analyst own', () => {
    open({ zone: { x: 0.1, y: 0.1, w: 0.25, h: 0.25 } });
    buttonNamed('Copy').click();
    expect(copyPicture).toHaveBeenCalledWith(expect.objectContaining({ what: 'zone' }), 'Copied the zone');
  });

  it('gives the zone size in the picture own pixels, and warns when it is small', () => {
    open({ zone: { x: 0.1, y: 0.1, w: 0.25, h: 0.25 } });
    expect(target.querySelector('.size').textContent.trim()).toBe('480 × 270 px');
    expect(target.querySelector('.size.small')).toBeNull();
    unmount(live);
    target.remove();
    open({ zone: { x: 0.1, y: 0.1, w: 0.04, h: 0.25 } });
    expect(target.querySelector('.size.small').title).toBe('A zone this small may match little');
  });

  it('closes from its cross', () => {
    const { onclose } = open();
    buttonNamed('Stop searching').click();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('keeps a press on the bar from reaching the viewer under it', () => {
    open({ zone: { x: 0.1, y: 0.1, w: 0.25, h: 0.25 } });
    // the viewer listens above the bar, as the page does
    const heard = vi.fn();
    document.body.addEventListener('pointerdown', heard);
    buttonNamed('Copy').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    document.body.removeEventListener('pointerdown', heard);
    expect(heard).not.toHaveBeenCalled();
  });
});
