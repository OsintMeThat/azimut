// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AnalysisOverlay from './AnalysisOverlay.svelte';
import { liveProps } from './props.fixture.svelte.js';

const engine = { on: () => () => {}, setView: vi.fn(), getZoom: () => 12,
  latLngToContainerPoint: ({ lon, lat }) => ({ x: lon * 100, y: lat * 100 }) };
const row = (id, lon, extra = {}) => ({ id, coordinates: [lon, 1], bbox: [lon, 1, lon + 0.1, 1.1],
  review: 'new', phenomenon: 'Surface change', ...extra });
const layer = (extra = {}) => ({ id: 'run', visible: true, input: { recipe: { colour: '#f6a81a', style: 'both' } },
  results: [row('a', 1), row('b', 1.1, { origin: 'manual' }), row('c', 2), row('gone', 3, { review: 'dismissed' })], ...extra });
let live, target;
afterEach(() => { if (live) unmount(live); target?.remove(); vi.clearAllMocks(); });
function open(extra = {}) {
  const props = liveProps({ engine, layers: [layer()], ...extra });
  target = document.createElement('div'); document.body.append(target);
  live = mount(AnalysisOverlay, { target, props }); flushSync();
  return props;
}

it('hides markers and numbered groups independently from outlines without changing results', () => {
  const props = open();
  expect(target.querySelectorAll('.outline')).toHaveLength(3);
  expect(target.querySelectorAll('g')).toHaveLength(2);
  expect(target.querySelector('text').textContent).toBe('2');
  props.markers = false; flushSync();
  expect(target.querySelectorAll('circle, g, text')).toHaveLength(0);
  expect(target.querySelectorAll('.outline')).toHaveLength(3);
  expect(props.layers[0].results).toHaveLength(4);
  props.markers = true; props.outlines = false; flushSync();
  expect(target.querySelectorAll('.outline')).toHaveLength(0);
  expect(target.querySelectorAll('g')).toHaveLength(2);
  props.markers = false; flushSync();
  expect(target.querySelector('svg').children).toHaveLength(0);
});

it('selects an exact candidate through its outline and highlights it with the markers hidden', () => {
  const onpick = vi.fn();
  const props = open({ markers: false, selected: 'b', onpick });
  const paths = [...target.querySelectorAll('.outline')];
  expect(paths.map((path) => path.getAttribute('tabindex'))).toEqual(['0', '0', '0']);
  expect(paths[1].getAttribute('stroke')).toBe('#f6a81a');
  expect(paths[1].getAttribute('stroke-width')).toBe('3');
  expect(paths[1].getAttribute('stroke-dasharray')).toBe('5 3');
  paths[1].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  expect(onpick).toHaveBeenLastCalledWith('run', 'b');
  paths[0].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 1 }));
  expect(onpick).toHaveBeenCalledTimes(1);
  const key = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  paths[2].dispatchEvent(key);
  expect(key.defaultPrevented).toBe(true);
  expect(onpick).toHaveBeenLastCalledWith('run', 'c');
  props.selected = 'c'; flushSync();
  expect(paths[1].classList.contains('selected')).toBe(false);
  expect(paths[2].classList.contains('selected')).toBe(true);
  expect(engine.setView).not.toHaveBeenCalled();
});

it('preserves pin-only recipes and draws no empty selectable outline for a point', () => {
  open({ layers: [layer({ input: { recipe: { colour: '#f6a81a', style: 'pins' } } }),
    layer({ id: 'points', results: [row('point', 4, { geometry: { type: 'Point', coordinates: [4, 1] } })] })] });
  expect(target.querySelectorAll('.outline')).toHaveLength(0);
  expect(target.querySelectorAll('g')).toHaveLength(3);
});

it('respects hidden layers and the active gate with either display choice', () => {
  const props = open({ layers: [layer({ visible: false })] });
  expect(target.querySelector('svg').children).toHaveLength(0);
  props.layers = [layer()]; props.active = false; flushSync();
  expect(target.querySelector('svg').children).toHaveLength(0);
});

it('leaves the click to drawing or measurement without hiding the outlines', () => {
  const onpick = vi.fn();
  const props = open({ markers: false, interactive: false, onpick });
  const paths = [...target.querySelectorAll('.outline')];
  expect(paths).toHaveLength(3);
  expect(paths.every((path) => path.classList.contains('passive') && path.getAttribute('tabindex') === '-1')).toBe(true);
  paths[0].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  paths[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(onpick).not.toHaveBeenCalled();
  props.markers = true; flushSync();
  target.querySelector('g').dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  expect(engine.setView).not.toHaveBeenCalled();
});

it('relays zoom to the map when the pointer is over a clickable outline', () => {
  const container = document.createElement('div'), canvas = document.createElement('canvas');
  container.append(canvas); document.body.append(container);
  const zoomed = vi.fn(); canvas.addEventListener('wheel', zoomed);
  open({ engine: { ...engine, container }, markers: false });
  const shape = target.querySelector('.outline');
  const original = document.elementsFromPoint;
  document.elementsFromPoint = () => [shape, canvas];
  shape.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
  expect(zoomed).toHaveBeenCalledTimes(1);
  document.elementsFromPoint = original; container.remove();
});
