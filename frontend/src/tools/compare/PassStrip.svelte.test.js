// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get } }));
const { default: PassStrip } = await import('./PassStrip.svelte');

const DAYS = ['2026-05-03', '2026-05-08', '2026-05-13', '2026-05-18', '2026-05-23'];
const side = (date) => ({ present: true, provider: 'sentinel2', sentinel: { date, layer: 'TRUE_COLOR', maxcc: 100 } });

let live;
let target;
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));

function open(props) {
  const state = $state({ a: side(DAYS[0]), b: side(DAYS[4]) });
  const onassign = vi.fn((letter, entry) => { state[letter] = side(entry.date); });
  live = mount(PassStrip, {
    target,
    props: {
      archive: 'sentinel2',
      get a() { return state.a; },
      get b() { return state.b; },
      view: { lat: 51.9, lon: 4.0, zoom: 14 },
      viewWidth: 900,
      provider: { tile_size: 512, max_native_zoom: 14, max_zoom: 18 },
      variantFor: (entry) => `sentinel2~TRUE_COLOR~${entry.date}~${entry.date}`,
      onassign,
      onbilled: vi.fn(),
      ...props,
    },
  });
  return { state, onassign };
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ dates: DAYS.map((date) => ({ date, cloud: 4, granules: 1 })).reverse() });
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

it('reads the archive once, oldest first, and draws no picture until asked', async () => {
  open();
  await settle();
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0][0]).toContain('/api/satellite/sentinel/dates?lat=51.9&lon=4');
  const cards = [...target.querySelectorAll('li')];
  expect(cards.map((node) => node.querySelector('.when').textContent.trim())).toEqual(DAYS);
  expect(target.querySelector('img')).toBe(null);
  expect(button('Show pictures').textContent).toMatch(/about \d+ requests/);
  button('Show pictures').click(); await settle();
  expect(target.querySelector('img').getAttribute('src')).toMatch(/^\/api\/tiles\/sentinel2~TRUE_COLOR~2026-05-03~2026-05-03\/10\//);
});

it('shows a picture on B with a press, and on A from its own button', async () => {
  const { onassign } = open();
  await settle();
  target.querySelectorAll('li .card')[2].click();
  expect(onassign).toHaveBeenLastCalledWith('b', expect.objectContaining({ date: '2026-05-13' }));
  target.querySelectorAll('li')[1].querySelector('.set').click();
  expect(onassign).toHaveBeenLastCalledWith('a', expect.objectContaining({ date: '2026-05-08' }));
});
