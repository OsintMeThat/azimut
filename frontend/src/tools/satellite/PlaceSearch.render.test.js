// @vitest-environment happy-dom
/**
 * The search bar, mounted: what it does when its suggestions fail, and what
 * Enter does with nothing highlighted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get } }));
const { default: PlaceSearch } = await import('./PlaceSearch.svelte');

let live;
let target;

function open(props = {}) {
  const onsubmit = vi.fn();
  const onpick = vi.fn();
  live = mount(PlaceSearch, {
    target,
    props: { value: '', savedRows: [], centre: { lat: 50, lon: 30 }, onpick, onsubmit, ...props },
  });
  flushSync();
  return { onsubmit, onpick, input: target.querySelector('input[role="combobox"]') };
}

function type(input, text) {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function press(input, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  flushSync();
  return event;
}

const goButton = () =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Go');

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  localStorage.clear();
  target = document.createElement('div');
  document.body.append(target);
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
  vi.useRealTimers();
});

describe('a failed suggestion', () => {
  it('leaves the bar working: Go and Enter still hand the text over', async () => {
    get.mockRejectedValue(new Error('offline'));
    const { input, onsubmit } = open();

    type(input, 'Kyiv');
    await vi.advanceTimersByTimeAsync(1000);
    flushSync();

    // both lookups were tried and both failed, quietly
    expect(get.mock.calls.map(([path]) => path.split('?')[0])).toEqual([
      '/api/geo/suggest',
      '/api/geo/places',
    ]);
    expect(target.querySelector('[role="listbox"]')).toBeNull();
    expect(goButton().disabled).toBe(false);

    press(input, 'Enter');
    expect(onsubmit).toHaveBeenCalledWith('Kyiv');
  });
});

describe('Enter with nothing highlighted', () => {
  it('hands the text to the bar and stops the lookups still on the clock', async () => {
    get.mockResolvedValue({ coords: null, cities: [], places: [] });
    const { input, onsubmit, onpick } = open();

    type(input, 'Kyiv centre');
    const event = press(input, 'Enter');
    await vi.advanceTimersByTimeAsync(2000);

    expect(event.defaultPrevented).toBe(true);
    expect(onsubmit).toHaveBeenCalledTimes(1);
    expect(onsubmit).toHaveBeenCalledWith('Kyiv centre');
    expect(onpick).not.toHaveBeenCalled();
    // the bar's own search asks for itself, so this one never reaches the geocoder
    expect(get).not.toHaveBeenCalled();
  });
});
