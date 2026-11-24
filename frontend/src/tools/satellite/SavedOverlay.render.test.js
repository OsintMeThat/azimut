// @vitest-environment happy-dom
/**
 * What the saved layer asks the map to draw: every mark opens its card, a located
 * file's included, where the file plays (SavedPopup.test.js covers the card).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const drawn = [];
const patched = [];
const surface = {
  set: (shapes) => drawn.push(shapes),
  patch: (id, change) => patched.push([id, change]),
  element: () => document.createElement('div'),
  closePopup: vi.fn(),
  clear: vi.fn(),
  destroy: vi.fn(),
};
vi.mock('../../lib/map/surface.js', () => ({ createSurface: () => surface }));

const { default: SavedOverlay } = await import('./SavedOverlay.svelte');
const { DROP, DROP_CARD_OFFSET, PLACE_RED, TEARDROP_CARD_OFFSET, placeMark } = await import('../../lib/mapMarkers.js');

let zoomNow = 16;
const engine = { getZoom: () => zoomNow, on: () => () => {} };
let held = null;

const media = (key, kind = 'image') => ({
  id: key,
  key: `${key}@48.1,2.1`,
  kind: 'media',
  media_kind: kind,
  title: key,
  path: `media/${key}.png`,
  lat: 48.1,
  lon: 2.1,
});
const place = { id: 'p1', key: 'p1', kind: 'place', title: 'Quay', lat: 48.1, lon: 2.1 };

function draw(items, props = {}) {
  drawn.length = 0;
  const target = document.createElement('div');
  document.body.appendChild(target);
  held = mount(SavedOverlay, {
    target,
    props: { engine, items, caseId: 'case-1', coords: () => '48.1, 2.1', ...props },
  });
  flushSync();
  return (drawn.at(-1) ?? []).filter((shape) => shape.kind === 'marker');
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

describe('a mark of located files', () => {
  it('opens a card like every mark, where the stack plays', () => {
    const [mark] = draw([media('quay'), media('roof')]);
    expect(mark.onClick).toBeUndefined();
    expect(mark.popup.className).toBe('saved-popup');
    expect(mark.popup.offset).toBe(TEARDROP_CARD_OFFSET);
  });

  it('draws footage as footage and photographs as photographs', () => {
    const [clips] = draw([media('a', 'video'), media('b', 'video')]);
    expect(clips.html).toContain('saved-mark-media');
    const [mixed] = draw([media('a', 'video'), media('b', 'image')]);
    // one glyph for the stack: it says "files here", and the panel says which
    expect(mixed.html).not.toBe(clips.html);
  });

  it('leaves the card to everything filed on a point', () => {
    const [mark] = draw([place]);
    expect(mark.onClick).toBeUndefined();
    expect(mark.popup.className).toBe('saved-popup');
  });

  it('keeps the card where a file shares a spot with saved work', () => {
    // the mark is no longer only files, and the card is what lists a mixed stack
    const [mark] = draw([place, media('quay')]);
    expect(mark.onClick).toBeUndefined();
    expect(mark.popup).toBeTruthy();
  });
});

describe('a place’s mark', () => {
  it('is the drop every place mark is, in the place’s colour, the pin red without one', () => {
    const [mark] = draw([{ ...place, color: '#1f77b4' }]);
    expect(mark.html).toBe(placeMark({ colour: '#1f77b4' }).html);
    expect(mark).toMatchObject({ className: 'saved-mark-wrap', size: DROP.size, anchor: DROP.anchor });
    expect(mark.popup.offset).toBe(DROP_CARD_OFFSET);
    const [red] = draw([place]);
    expect(red.html).toContain(`fill="${PLACE_RED}"`);
  });

  it('counts a stack of places in its heart, and keeps the proof’s dot', () => {
    const [mark] = draw([{ ...place, proofs: 1 }, { ...place, id: 'p2', key: 'p2' }]);
    expect(mark.html).toBe(placeMark({ count: 2, worked: true }).html);
  });

  it('writes the place’s name under it only when Names is on, escaped', () => {
    expect(draw([place])[0].html).not.toContain('saved-mark-name');
    const [named] = draw([{ ...place, title: '<b>Quay</b>' }], { names: true });
    expect(named.html).toContain('<span class="saved-mark-name">&lt;b&gt;Quay&lt;/b&gt;</span>');
    const [stack] = draw([place, { ...place, id: 'p2', key: 'p2' }, { ...place, id: 'p3', key: 'p3' }], { names: true });
    expect(stack.html).toContain('>3 places</span>');
  });

  it('names no file, whose mark says nothing under it', () => {
    const [mark] = draw([media('quay')], { names: true });
    expect(mark.html).not.toContain('saved-mark-name');
  });
});

describe('a place’s traced area', () => {
  const square = { type: 'Polygon', coordinates: [[[2, 48], [2.2, 48], [2.2, 48.2], [2, 48.2], [2, 48]]] };
  const drawnShapes = (items, props = {}) => {
    draw(items, props);
    return drawn.at(-1).filter((shape) => shape.kind === 'geojson');
  };

  it('opens its place’s card when clicked, where no tool owns the map’s clicks', () => {
    const [area] = drawnShapes([{ ...place, footprint: square }], { areas: true });
    expect(area.style.interactive).toBe(true);
    expect(typeof area.onClick).toBe('function');
  });

  it('leaves every click to the map while a tool is armed', () => {
    const [area] = drawnShapes([{ ...place, footprint: square }], { areas: false });
    expect(area.style.interactive).toBe(false);
    expect(area.onClick).toBeUndefined();
  });

  it('wears the colour its place was given, and amber without one', () => {
    expect(drawnShapes([{ ...place, footprint: square, color: '#1f77b4' }])[0].style.stroke).toBe('#1f77b4');
    expect(drawnShapes([{ ...place, footprint: square }])[0].style.stroke).toBe('#f5a623');
  });
});

describe('a zone', () => {
  // about 220 m a side near Paris
  const AREA = { type: 'Polygon', coordinates: [[[2.1, 48.1], [2.103, 48.1], [2.103, 48.102], [2.1, 48.102], [2.1, 48.1]]] };
  const zone = { ...place, title: 'North quay', zone: true, footprint: AREA, lat: 48.101, lon: 2.1015 };
  afterEach(() => (zoomNow = 16));

  it('draws no pin on its point while its area shows, and its card opens on the point', () => {
    const [mark] = draw([zone], { areas: true });
    expect(mark.html).toContain('saved-zone-host');
    expect(mark.html).not.toContain('saved-place-drop');
    expect(mark.popup.offset).toBe(0);
    const [area] = drawn.at(-1).filter((shape) => shape.kind === 'geojson');
    expect(area.style).toMatchObject({ stroke: PLACE_RED, strokeWidth: 2, interactive: true });
  });

  it('puts its small square in once a zoom out leaves the area too small to see', () => {
    zoomNow = 9;
    const [mark] = draw([zone]);
    expect(mark.className).toContain('tiny');
    expect(mark.html).toContain('saved-zone-mark');
    expect(mark.popup.offset).toBeGreaterThan(0);
  });

  it('writes its name on its point when Names is on', () => {
    const [mark] = draw([zone], { names: true });
    expect(mark.html).toContain('<span class="saved-mark-name">North quay</span>');
  });

  it('keeps the pin of a place whose precision was traced, and of a stack', () => {
    const [traced] = draw([{ ...zone, zone: false }]);
    expect(traced.html).toContain('saved-place-drop');
    const [stack] = draw([zone, { ...place, id: 'p2', key: 'p2', lat: 48.101, lon: 2.1015 }]);
    expect(stack.html).toContain('saved-place-drop');
  });
});
