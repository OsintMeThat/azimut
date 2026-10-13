// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const toast = vi.fn();
const uiState = { tool: 'horizon' };
vi.mock('../../lib/api.js', () => ({ api: { get, post } }));
vi.mock('../../lib/state.svelte.js', () => ({ toast, uiState }));
const { default: MapNavigation } = await import('./MapNavigation.svelte');

let live;
let target;
let engine;
const point = { lat: 50.4501, lon: 30.5234 };

function open(props = {}) {
  live = mount(MapNavigation, {
    target,
    props: { engine, view: { lat: 46, lon: 7, zoom: 12 }, ...props },
  });
  flushSync();
}

async function submit(text) {
  const input = target.querySelector('[role="combobox"]');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  flushSync();
  await vi.waitFor(() => expect(target.querySelector('.field button').disabled).toBe(false));
  flushSync();
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  toast.mockReset();
  uiState.tool = 'horizon';
  localStorage.clear();
  target = document.createElement('div');
  document.body.append(target);
  engine = {
    container: target,
    getZoom: () => 12,
    setView: vi.fn(),
    setBearing: vi.fn(),
    camera: () => ({ bearing: 0 }),
    containerPointToLatLng: () => point,
  };
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

describe('Horizon map navigation', () => {
  it('asks for nothing until a search is entered', () => {
    open();
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('flies to typed coordinates without geocoding or standing', async () => {
    post.mockResolvedValue(point);
    open();
    await submit('50.4501, 30.5234');
    expect(post).toHaveBeenCalledWith('/api/geo/parse', { text: '50.4501, 30.5234' });
    expect(engine.setView).toHaveBeenCalledWith(point, 13);
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps standing at coordinates when picking or moving a viewpoint', async () => {
    post.mockResolvedValue(point);
    const oncoordinates = vi.fn();
    open({ oncoordinates });
    await submit('50.4501, 30.5234');
    expect(oncoordinates).toHaveBeenCalledWith(point);
    expect(engine.setView).not.toHaveBeenCalled();
  });

  it('flies to a place name after the coordinate parser declines it', async () => {
    post.mockRejectedValue(new Error('Not coordinates'));
    get.mockResolvedValue(point);
    open();
    await submit('Kyiv centre');
    expect(get).toHaveBeenCalledWith('/api/geo/geocode?q=Kyiv%20centre');
    expect(engine.setView).toHaveBeenCalledWith(point, 13);
  });

  it('leaves the map in place and reports a failed search', async () => {
    post.mockRejectedValue(new Error('Not coordinates'));
    get.mockRejectedValue(new Error('No match'));
    open();
    await submit('Unknown place');
    expect(engine.setView).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('No match'), 'danger');
  });

  it('uses the shared compass to type a bearing and reset north', () => {
    open({ bearing: 90 });
    target.querySelector('.deg').click();
    flushSync();
    const input = target.querySelector('[aria-label="Set bearing in degrees"]');
    input.value = '215';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(engine.setBearing).toHaveBeenCalledWith(215);
    target.querySelector('[aria-label="Reset to north"]').click();
    expect(engine.setBearing).toHaveBeenLastCalledWith(0);
  });

  it('shows the shared pivot guide for a middle press and clears it on release', () => {
    open();
    const event = new MouseEvent('mousedown', { button: 1, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    flushSync();
    expect(event.defaultPrevented).toBe(true);
    expect(target.querySelector('.turn-guide')).not.toBeNull();
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1 }));
    flushSync();
    expect(target.querySelector('.turn-guide')).toBeNull();
    expect(engine.setBearing).toHaveBeenCalledWith(0);
  });

  it('turns from a map key but leaves search field keys alone', () => {
    open();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    expect(engine.setBearing).toHaveBeenCalledWith(15);
    engine.setBearing.mockClear();
    target.querySelector('[role="combobox"]').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true,
    }));
    expect(engine.setBearing).not.toHaveBeenCalled();
  });

  it('leaves gestures alone while the main map is behind Find or another tab', () => {
    open({ active: false });
    const event = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(engine.setBearing).not.toHaveBeenCalled();
  });

  it('removes the turn listeners when the compact map takes over', () => {
    open();
    unmount(live);
    live = null;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    const event = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(engine.setBearing).not.toHaveBeenCalled();
  });
});
