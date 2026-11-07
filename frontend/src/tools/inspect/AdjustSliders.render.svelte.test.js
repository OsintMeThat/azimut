// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AdjustSliders from './AdjustSliders.svelte';

// The two params as /api/inspect/ops serves them.
const FILTERS = [
  { id: 'brightness', label: 'Brightness', css: 'brightness({v})',
    params: [{ name: 'amount', type: 'range', min: 0, max: 4, step: 0.01, default: 1, unit: '', travel: 'centred' }] },
  { id: 'contrast', label: 'Contrast', css: 'contrast({v})',
    params: [{ name: 'amount', type: 'range', min: 0, max: 2, step: 0.01, default: 1, unit: '', travel: 'linear' }] },
];

let live = null;
let target = null;

function show(values) {
  const state = $state(values);
  target = document.createElement('div');
  document.body.append(target);
  live = mount(AdjustSliders, { target, props: { filters: FILTERS, values: state } });
  flushSync();
  return state;
}

const slider = (label) => [...target.querySelectorAll('label.row')]
  .find((row) => row.textContent.includes(label)).querySelector('input[type="range"]');
const shown = (label) => [...target.querySelectorAll('label.row')]
  .find((row) => row.textContent.includes(label)).querySelector('.val').textContent.trim();

function drag(input, position) {
  input.value = String(position);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('Adjust sliders', () => {
  it('reaches ×4 brightness at the end of the travel and shows the real factor', () => {
    const values = show({ brightness: 1, contrast: 1 });
    const input = slider('Brightness');
    expect([input.min, input.max, input.step]).toEqual(['0', '200', '1']);
    expect(input.value).toBe('100');

    drag(input, 200);
    expect(values.brightness).toBe(4);
    expect(shown('Brightness')).toBe('4.00');

    drag(input, 150);
    expect(values.brightness).toBe(2);
    drag(input, 101);
    expect(values.brightness).toBe(1.01);
  });

  it('puts a saved brightness under its notch without touching it', () => {
    const values = show({ brightness: 1.5, contrast: 1 });
    expect(slider('Brightness').value).toBe('131');
    expect(values.brightness).toBe(1.5);
    expect(shown('Brightness')).toBe('1.50');
  });

  it('keeps contrast on its linear 0–2 travel', () => {
    const values = show({ brightness: 1, contrast: 1.2 });
    const input = slider('Contrast');
    expect([input.min, input.max, input.step]).toEqual(['0', '2', '0.01']);
    expect(input.value).toBe('1.2');
    drag(input, 1.75);
    expect(values.contrast).toBe(1.75);
  });
});
