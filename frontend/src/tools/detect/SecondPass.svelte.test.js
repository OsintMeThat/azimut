// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const links = [];
vi.mock('../../lib/map/cameraLink.js', () => ({
  linkCameras: (engines) => {
    const link = { engines, align: vi.fn(), dispose: vi.fn() };
    links.push(link);
    return link;
  },
}));
vi.mock('../satellite/MapSurface.svelte', () => import('./MapSurface.stub.svelte'));
vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../lib/state.svelte.js', () => ({ toast: vi.fn() }));
const { default: SecondPass } = await import('./SecondPass.svelte');

let live, target;
beforeEach(() => { links.length = 0; });
afterEach(() => { if (live) unmount(live); live = null; target?.remove(); });

function open(props = {}) {
  const onsplit = vi.fn();
  const primary = { fake: 'primary' };
  target = document.createElement('div');
  document.body.append(target);
  live = mount(SecondPass, { target, props: {
    imagery: {}, primary, source: { provider: 'sentinel2', date: '2026-05-11', layer: 'NDVI' }, view: { lat: 48, lon: 2, zoom: 13 },
    bearing: 0, home: { lat: 0, lon: 0, zoom: 2 }, divider: 30, onsplit, ...props } });
  flushSync();
  return { onsplit, primary };
}
const slider = () => target.querySelector('[role="slider"]');
const press = (key) => { slider().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); flushSync(); };

it('lays the cut where the divider says, and says so to a screen reader', () => {
  open({ divider: 30 });
  expect(target.querySelector('.second').getAttribute('style')).toContain('--divider: 30%');
  expect(slider().getAttribute('aria-valuenow')).toBe('30');
  expect(slider().getAttribute('aria-label')).toBe('Split between the before and after passes');
});

it('moves the cut from the keys, two points a press, and to either end', () => {
  const { onsplit } = open({ divider: 30 });
  press('ArrowRight'); press('ArrowLeft'); press('Home'); press('End'); press('x');
  expect(onsplit.mock.calls).toEqual([[32], [28], [0], [100]]);
});

it('moves the cut to where the pointer is over the map, as a share of its width', () => {
  const { onsplit } = open();
  target.querySelector('.second').getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 300, right: 500, bottom: 300 });
  const down = new Event('pointerdown', { bubbles: true });
  Object.assign(down, { clientX: 300, pointerId: 1 });
  slider().dispatchEvent(down);
  const move = new Event('pointermove', { bubbles: true });
  Object.assign(move, { clientX: 400, pointerId: 1 });
  slider().dispatchEvent(move);
  const up = new Event('pointerup', { bubbles: true });
  Object.assign(up, { clientX: 450, pointerId: 1 });
  slider().dispatchEvent(up);
  // a move after the release does nothing
  const late = new Event('pointermove', { bubbles: true });
  Object.assign(late, { clientX: 120, pointerId: 1 });
  slider().dispatchEvent(late);
  expect(onsplit.mock.calls).toEqual([[50], [75]]);
});

it('shows the pass it is given on a map of its own, without the map’s chrome', () => {
  open();
  const stub = target.querySelector('.stub');
  expect(stub.dataset.provider).toBe('sentinel2');
  expect(stub.dataset.chrome).toBe('false');
});

it('shows a radar pass from the radar basemap', () => {
  open({ source: { provider: 'sentinel1', date: '2026-05-11', time: '05:30:12' } });
  expect(target.querySelector('.stub').dataset.provider).toBe('sentinel1');
});

it('holds its camera to the map underneath once it is up, and lets go with it', () => {
  const { primary } = open();
  expect(links).toHaveLength(1);
  expect(links[0].engines[0]).toBe(primary);
  expect(links[0].engines[1]).toMatchObject({ fake: true });
  expect(links[0].align).toHaveBeenCalledOnce();
  unmount(live); live = null;
  expect(links[0].dispose).toHaveBeenCalledOnce();
});

it('hands the cursor mode on to its own map, so a pin can be dropped on either half', () => {
  open({ armed: 'selecting' });
  expect(target.querySelector('.stub').dataset.armed).toBe('selecting');
});

it('lets every click through the line, and grabs only on the handle', () => {
  // The line rides beside the engine's controls (`mapStacking.test.js`), well over
  // the ground the tool paints, and the map is centred on what is being checked —
  // so a line that took clicks took them from the pins sitting under it. The drag
  // lives on the handle, which is why letting the line through costs nothing.
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'SecondPass.svelte'), 'utf8');
  const line = source.slice(source.indexOf('.line {'), source.indexOf('.handle::before'));
  expect(line).toMatch(/pointer-events:\s*none/);
  expect(source.slice(source.indexOf('.handle {'))).toMatch(/pointer-events:\s*auto/);
  // and nothing is left behind saying the line ever behaved differently while armed
  expect(source).not.toMatch(/\.line\.armed/);
  expect(source).not.toMatch(/class:armed/);
});
