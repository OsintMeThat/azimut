// @vitest-environment happy-dom
/**
 * A marker preview wearing one of the analyst's icons. Pinned here: a list of
 * them settles. The first build held the read picture in plain $state inside an
 * effect that read it back, so every preview ran its effect for ever, and a
 * copied map's 195 markers froze every button of the app.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const picture = { image: { width: 100, height: 50 }, box: { x: 10, y: 0, w: 80, h: 50 } };
vi.mock('../../lib/map/ownIcons.js', () => ({
  readyPicture: vi.fn(() => picture),
  loadPicture: vi.fn(async () => picture),
}));
const { default: MarkerSymbol } = await import('./MarkerSymbol.svelte');

let held = [];
afterEach(() => { for (const one of held) unmount(one); held = []; document.body.innerHTML = ''; });
const show = (props) => { held.push(mount(MarkerSymbol, { target: document.body, props })); flushSync(); };

it('settles with a picture already read, however many are shown', () => {
  expect(() => {
    for (let index = 0; index < 50; index++) show({ colour: '#d55e00', icon: { src: '/icons/a', mode: index % 2 ? 'disc' : 'image' } });
  }).not.toThrow();
  expect(document.querySelectorAll('svg image')).toHaveLength(50);
});

it('fits the painted part of a disc icon to the glyph square', () => {
  show({ colour: '#d55e00', icon: { src: '/icons/a', mode: 'disc' } });
  const image = document.querySelector('mask image');
  // 80 painted pixels across become the 36-unit glyph, centred on the disc
  expect(Number(image.getAttribute('width'))).toBeCloseTo(100 * (36 / 80));
  expect(document.querySelector('rect').getAttribute('fill')).toBe('#ffffff');
});

it('draws the app symbol when no icon is worn', () => {
  show({ symbol: 'badge-tank', colour: '#d55e00' });
  expect(document.querySelector('svg image')).toBeNull();
  expect(document.querySelectorAll('svg path').length).toBeGreaterThan(2);
});
