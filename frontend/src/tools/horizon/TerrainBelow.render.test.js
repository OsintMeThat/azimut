// @vitest-environment happy-dom
/**
 * The terrain under the photo while Side by side is on: what it shows for its
 * camera, and what the hand does over it, handed up to the view as it happens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TerrainBelow from './TerrainBelow.svelte';

const CAMERA = { heading: 90, tilt: 0, roll: 0, fov: 60, projection: 'camera', width: 800, height: 400 };
const LABEL = { name: 'Jebel Ras', x: 400, y: 180, left: 370, width: 60, baseline: 160, peak: { lat: 1, lon: 2 } };

let live = [];

function pane(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const on = { onpress: vi.fn(), onmove: vi.fn(), onzoom: vi.fn(), onpoint: vi.fn() };
  const component = mount(TerrainBelow, {
    target,
    props: {
      camera: CAMERA,
      labels: [LABEL],
      ticks: [{ azimuth: 90, x: 400, label: 'E', named: true }],
      trace: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], of: 1 }],
      ridges: [false, true],
      ...on,
      ...props,
    },
  });
  live.push(component);
  flushSync();
  const root = target.querySelector('.below');
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400 });
  return { root, ...on };
}

const pointer = (node, type, init) => {
  node.dispatchEvent(new window.PointerEvent(type, { bubbles: true, pointerId: 1, ...init }));
  flushSync();
};

afterEach(() => {
  for (const component of live) unmount(component);
  live = [];
  document.body.innerHTML = '';
});

describe('the terrain under the photo', () => {
  it('names the summits, ticks the ruler and lays the trace for its own camera', () => {
    const { root } = pane();
    expect(root.querySelector('canvas')).not.toBeNull();
    expect(root.querySelector('.peak-name').textContent).toBe('Jebel Ras');
    expect(root.querySelector('.tick.named').textContent).toBe('E');
    const lines = root.querySelectorAll('polyline.over');
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute('points')).toBe('10.0,20.0 30.0,40.0');
    // the run came from the second stroke, a ridge
    expect(lines[0].classList.contains('ridge')).toBe(true);
    expect(root.querySelector('.tag').textContent).toBe('Terrain, simulated');
  });

  it('says when it moves on its own', () => {
    const { root } = pane({ linked: false });
    expect(root.querySelector('.tag').textContent).toBe('Terrain, simulated, free');
    expect(root.getAttribute('aria-label')).toMatch(/free: drag to turn it/);
  });

  it('hands up a drag as it goes, and the wheel about the pointer', () => {
    const { root, onpress, onmove, onzoom } = pane();
    root.setPointerCapture = vi.fn();
    pointer(root, 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    expect(onpress).toHaveBeenCalledOnce();
    pointer(root, 'pointermove', { clientX: 130, clientY: 90 });
    pointer(root, 'pointermove', { clientX: 140, clientY: 90 });
    expect(onmove.mock.calls).toEqual([
      [30, -10],
      [10, 0],
    ]);
    pointer(root, 'pointerup', {});
    // happy-dom's wheel takes no pointer place: it is handed one
    const wheel = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    Object.defineProperties(wheel, { clientX: { value: 200 }, clientY: { value: 50 } });
    root.dispatchEvent(wheel);
    flushSync();
    const [factor, at] = onzoom.mock.calls[0];
    expect(factor).toBeGreaterThan(1);
    expect(at).toEqual({ x: 200, y: 50 });
  });

  it('draws a line where the pointer is and where it stands over the photo', () => {
    const { root, onpoint } = pane({ cross: 250, facing: '93.4°' });
    expect(root.querySelectorAll('.cross')).toHaveLength(1);
    pointer(root, 'pointermove', { clientX: 120, clientY: 50 });
    expect(onpoint).toHaveBeenCalledWith(120);
    expect(root.querySelectorAll('.cross')).toHaveLength(2);
    expect(root.querySelector('.facing').textContent).toBe('93.4°');
    pointer(root, 'pointerleave', {});
    expect(onpoint).toHaveBeenLastCalledWith(null);
  });
});
