// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const get = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get: (...args) => get(...args), post: vi.fn(), put: vi.fn(), del: vi.fn() } }));
const { default: PlateFromCase } = await import('./PlateFromCase.svelte');

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; get.mockReset(); });

const INDEX = [
  { id: 'p1', kind: 'place', title: 'A place' },
  { id: 'c1', kind: 'comparison', session: 'energodar', title: 'Energodar', imagery_a: '2022-03-04', imagery_b: '2025-11-02',
    thumbnail: '.thumbs/energodar.jpg', kept: [{ path: 'media/old.png', title: 'Old' }, { path: 'media/energodar-kept.png', title: 'Kept' }] },
  { id: 'c2', kind: 'comparison', session: 'port', title: '', imagery_a: null, imagery_b: null, kept: [] },
];

async function show(props = {}, index = INDEX) {
  get.mockImplementation(async () => index);
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const calls = { onpick: vi.fn(), onclose: vi.fn() };
  held = mount(PlateFromCase, { target: document.body, props: { anchor, caseId: 'c1', ...calls, ...props } });
  flushSync();
  await tick(); await tick();
  flushSync();
  return calls;
}
const rows = () => [...document.body.querySelectorAll('.rows li')];

describe('the case\'s work, from Add', () => {
  it('reads the case when it opens, and lists its comparisons with their two days', async () => {
    await show();
    expect(get).toHaveBeenCalledWith('/api/cases/c1/satellite/index');
    expect(rows().map((row) => row.querySelector('.title').textContent)).toEqual(['Energodar', 'port']);
    expect(rows()[0].querySelector('.days').textContent).toBe('4 Mar 2022 → 2 Nov 2025');
    expect(rows()[1].querySelector('.days').textContent).toBe('Before → After');
    expect(rows()[0].querySelector('img').getAttribute('src')).toContain('.thumbs/energodar.jpg');
  });

  it('lays a pair as two maps at a press, or its newest kept image, and says when none is kept', async () => {
    const calls = await show();
    rows()[0].querySelector('.main').click();
    expect(calls.onpick).toHaveBeenCalledWith(INDEX[1], 'maps');
    expect(calls.onclose).toHaveBeenCalled();
    const picture = (row) => [...row.querySelectorAll('button')].find((button) => button.textContent.includes('Picture'));
    picture(rows()[0]).click();
    expect(calls.onpick).toHaveBeenLastCalledWith(INDEX[1], 'picture');
    expect(picture(rows()[1]).disabled).toBe(true);
    expect(picture(rows()[1]).title).toContain('Keep one in Compare');
  });

  it('keeps the pair to its picture when the plate has no room for two more maps', async () => {
    await show({ room: 1 });
    expect(document.body.textContent).toContain('eight maps at most');
    expect(rows()[0].querySelector('.main').disabled).toBe(true);
  });

  it('says how to make one when the case has none', async () => {
    await show({}, [{ id: 'p1', kind: 'place' }]);
    expect(document.body.textContent).toContain('No comparison in this case yet');
  });
});
