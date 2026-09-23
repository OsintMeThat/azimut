// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const post = vi.fn();
const put = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { post, put } }));
vi.mock('../../lib/state.svelte.js', () => ({ toast: vi.fn() }));
const { default: RadarLayer } = await import('./RadarLayer.svelte');

let live;
let target;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));

beforeEach(() => {
  vi.clearAllMocks();
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

it('asks nothing until Find is pressed, then keeps the layer that answered', async () => {
  const onchanged = vi.fn();
  post.mockResolvedValue({ ok: true, layer: 'SAR_IW', detail: 'reads Sentinel-1 VV and VH', tried: [] });
  live = mount(RadarLayer, { target, props: { layer: '', onchanged } });
  flushSync();
  expect(post).not.toHaveBeenCalled();
  expect(target.querySelector('[aria-label="Sentinel-1 layer form"]').textContent).toContain('Sentinel-1 GRD');
  expect(target.textContent).toContain('Any predefined product');
  button('Find the radar layer').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel1/layer', {});
  expect(target.textContent).toContain('Radar reads SAR_IW');
  expect(onchanged).toHaveBeenCalled();
});

it('says why a named layer is not a radar one', async () => {
  post.mockResolvedValue({ ok: false, layer: 'TRUE_COLOR', detail: 'Band VV not found', tried: [] });
  live = mount(RadarLayer, { target, props: { layer: '' } });
  flushSync();
  const field = target.querySelector('[aria-label="Sentinel-1 layer name"]');
  field.value = 'TRUE_COLOR'; field.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  button('Check').click(); await settle();
  expect(post).toHaveBeenCalledWith('/api/satellite/sentinel1/layer', { layer: 'TRUE_COLOR' });
  expect(target.textContent).toContain('Band VV not found');
});
