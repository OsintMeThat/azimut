// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

// One answer per month asked, as the Sentinel-2 catalogue gives it: newest first.
const MONTHS = {
  '2017-03': [{ date: '2017-03-21', cloud: 64 }, { date: '2017-03-04', cloud: 2 }],
  '2024-05': [{ date: '2024-05-18', cloud: 8 }, { date: '2024-05-03', cloud: 0 }],
  '2026-08': [{ date: '2026-08-27', cloud: 12 }],
};
const get = vi.fn(async (path) => {
  const start = /start=(\d{4}-\d{2})-01/.exec(path)?.[1];
  return { dates: structuredClone(MONTHS[start] ?? []) };
});
vi.mock('../../lib/api.js', () => ({ api: { get } }));

const { default: EvolutionPicker } = await import('./EvolutionPicker.svelte');

const side = (date) => ({ present: true, provider: 'sentinel2', sentinel: { layer: 'TRUE_COLOR', date, maxcc: 100 } });
const PROVIDER = { id: 'sentinel2', tile_size: 512, max_zoom: 18, max_native_zoom: 14 };

let live;
let target;
let chosen = [];
const onbilled = vi.fn();

async function settle() {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
  flushSync();
}

async function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(EvolutionPicker, {
    target,
    props: {
      archive: 'sentinel2',
      a: side('2024-05-03'),
      b: side('2026-08-27'),
      view: { lat: 48.85, lon: 2.35, zoom: 16 },
      maxcc: 30,
      perPicture: 2,
      provider: PROVIDER,
      variantFor: (entry) => `sentinel2~TRUE_COLOR~${entry.date}~${entry.date}`,
      thumbView: { lat: 48.85, lon: 2.35, zoom: 16, viewWidth: 900 },
      onchoose: (next) => (chosen = next),
      onbilled,
      ...props,
    },
  });
  flushSync();
  await settle();
}

const button = (label) => [...target.querySelectorAll('button')].find((entry) => entry.textContent.trim() === label
  || entry.getAttribute('aria-label') === label);
const cards = () => [...target.querySelectorAll('.cards li')];
const months = () => get.mock.calls.map(([path]) => /start=(\d{4}-\d{2})/.exec(path)?.[1]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
  get.mockClear();
  onbilled.mockClear();
  chosen = [];
});

afterEach(() => {
  vi.useRealTimers();
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('choosing Sentinel-2 passes by hand', () => {
  it('opens on A’s month, reads B’s too, and ticks both passes', async () => {
    await open();
    expect(months()).toEqual(['2024-05', '2026-08']);
    expect(onbilled).toHaveBeenCalledTimes(2);
    expect(target.textContent).toContain('May 2024');
    expect(cards().map((card) => card.querySelector('.mono').textContent)).toEqual(['2024-05-03', '2024-05-18']);
    expect(chosen.map((entry) => entry.date)).toEqual(['2024-05-03', '2026-08-27']);
    // each pass shows its own picture of the ground
    expect(cards()[0].querySelector('.thumb img').getAttribute('src'))
      .toMatch(/^\/api\/tiles\/sentinel2~TRUE_COLOR~2024-05-03~2024-05-03\//);
    expect(target.textContent).toContain('2 months read');
  });

  it('goes back to any month since 2015, keeps what was ticked, and adds from there', async () => {
    await open();
    const input = target.querySelector('input[type="month"]');
    input.value = '2017-03';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.textContent).toContain('March 2017');
    const [early, cloudy] = cards();
    expect(early.querySelector('small').textContent).toBe('2% cloud');
    // over the ceiling, shown and still tickable by hand
    expect(cloudy.querySelector('small').textContent).toBe('64% cloud, over the cloud ceiling');
    button('Clearest of the month').click();
    flushSync();
    expect(chosen.map((entry) => entry.date)).toEqual(['2017-03-04', '2024-05-03', '2026-08-27']);
    // the chips untick a pass read in another month
    button('Untick 2026-08-27').click();
    flushSync();
    expect(chosen.map((entry) => entry.date)).toEqual(['2017-03-04', '2024-05-03']);
    expect(target.textContent).toContain('3 months read');
    input.value = '2015-07';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    button('Previous month').click();
    await settle();
    // Sentinel-2 began in June 2015: nothing is asked before it.
    expect(target.textContent).toContain('June 2015');
    expect(months().at(-1)).toBe('2015-06');
    expect(button('Previous month').disabled).toBe(true);
    // a month already read is not asked twice
    button('Next month').click();
    await settle();
    button('Previous month').click();
    await settle();
    expect(months().filter((entry) => entry === '2015-06')).toHaveLength(1);
  });

  it('says it is loading while the archive answers, with cards on their way', async () => {
    let answer;
    get.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await open();
    const status = target.querySelector('[role="status"]');
    expect(status.textContent).toContain('Loading the pictures…');
    expect(status.textContent).toContain('May 2024');
    expect(target.querySelectorAll('.cards .ghost')).toHaveLength(6);
    answer({ dates: structuredClone(MONTHS['2024-05']) });
    await settle();
    expect(target.querySelector('.ghost')).toBeNull();
    // each picture shimmers until one of its tiles is in
    const thumb = cards()[0].querySelector('.thumb');
    expect(thumb.classList.contains('ready')).toBe(false);
    thumb.querySelector('img').dispatchEvent(new Event('load'));
    flushSync();
    expect(thumb.classList.contains('ready')).toBe(true);
  });

  it('opens on this month when both sides show their latest pass and none is known', async () => {
    await open({ a: side(''), b: side('') });
    expect(months()).toEqual(['2026-09']);
    expect(target.textContent).toContain('No Sentinel-2 pass over this point that month.');
    expect(button('Next month').disabled).toBe(true);
  });
});
