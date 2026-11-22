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

const PROOFS = [{ name: 'p-1', title: 'Depot strike', png: 'proofs/p-1.png', thumb: '.thumbs/p-1.jpg', when: '2025-10-03', place: 'Energodar, Ukraine',
  points: [{ lat: 47.5, lon: 34.6 }] }, { name: 'p-2', title: 'Unfinished', png: null, points: [] }];
const MEDIA = [{ key: 'm1@1,2', path: 'media/strike.mp4', media_kind: 'video', title: 'Strike', lat: 47.5, lon: 34.6, country_en: 'Ukraine' },
  { key: 'm2@1,2', path: 'media/loop.gif', media_kind: 'image', title: 'Loop', lat: 47.5, lon: 34.6 },
  { key: 'm3@1,2', path: 'media/roof.jpg', media_kind: 'image', title: 'Roof', lat: 47.5, lon: 34.6 },
  { key: 'm4@1,2', path: 'media/notes.pdf', media_kind: 'document', title: 'Notes', lat: 47.5, lon: 34.6 }];

async function show(props = {}, index = INDEX) {
  get.mockImplementation(async (url) => (url.endsWith('/proofs') ? PROOFS : url.endsWith('/satellite/media') ? MEDIA : index));
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
    expect(get.mock.calls).toEqual([['/api/cases/c1/satellite/index']]);
    expect(rows().map((row) => row.querySelector('.title').textContent)).toEqual(['Energodar', 'port']);
    expect(rows()[0].querySelector('.sub').textContent).toBe('4 Mar 2022 → 2 Nov 2025');
    expect(rows()[1].querySelector('.sub').textContent).toBe('Before → After');
    expect(rows()[0].querySelector('img').getAttribute('src')).toContain('.thumbs/energodar.jpg');
  });

  it('lays a pair as two maps at a press, or its newest kept image, and says when none is kept', async () => {
    const calls = await show();
    rows()[0].querySelector('.main').click();
    expect(calls.onpick).toHaveBeenCalledWith({ what: 'comparison', row: INDEX[1], how: 'maps' });
    expect(calls.onclose).toHaveBeenCalled();
    const picture = (row) => [...row.querySelectorAll('button')].find((button) => button.textContent.includes('Picture'));
    picture(rows()[0]).click();
    expect(calls.onpick).toHaveBeenLastCalledWith({ what: 'comparison', row: INDEX[1], how: 'picture' });
    expect(picture(rows()[1]).disabled).toBe(true);
    expect(picture(rows()[1]).title).toContain('Keep one in Compare');
  });

  it('keeps the pair to its picture when the plate has no room for two more maps', async () => {
    await show({ room: 1 });
    expect(document.body.textContent).toContain('eight maps at most');
    expect(rows()[0].querySelector('.main').disabled).toBe(true);
  });

  it('opens on the section asked, reads each section only when shown, and lists proofs with a picture', async () => {
    const calls = await show({ what: 'proof' });
    expect(get.mock.calls).toEqual([['/api/cases/c1/proofs']]);
    expect(rows().map((row) => row.querySelector('.title').textContent)).toEqual(['Depot strike']);
    expect(rows()[0].querySelector('.sub').textContent).toBe('3 Oct 2025 · Energodar, Ukraine');
    rows()[0].querySelector('.main').click();
    expect(calls.onpick).toHaveBeenCalledWith({ what: 'proof', row: PROOFS[0], how: '' });
  });

  it('lists the footage and photos placed on the map, a GIF played as a video, nothing it cannot show', async () => {
    await show({ what: 'media' });
    expect(get.mock.calls).toEqual([['/api/cases/c1/satellite/media']]);
    expect(rows().map((row) => row.querySelector('.sub').textContent)).toEqual(['Video, on a slide · Ukraine', 'Video, on a slide', 'Photo']);
    const tab = [...document.body.querySelectorAll('[role="tab"]')].find((node) => node.textContent === 'Comparisons');
    tab.click(); flushSync(); await tick(); await tick(); flushSync();
    expect(get.mock.calls.at(-1)).toEqual(['/api/cases/c1/satellite/index']);
    expect(rows()).toHaveLength(2);
  });

  it('says what was picked even when closing the panel takes it off the page first', async () => {
    const picked = [];
    await show({ what: 'proof', onclose: () => { unmount(held); held = null; }, onpick: (choice) => picked.push(choice) });
    rows()[0].querySelector('.main').click();
    expect(picked).toEqual([{ what: 'proof', row: PROOFS[0], how: '' }]);
  });

  it('lays footage ticked from several places as angles of one event, a slide each or all on one, and one alone with its cone', async () => {
    const calls = await show({ what: 'media' });
    const lay = () => document.body.querySelector('.lay button');
    const played = (text) => [...document.body.querySelectorAll('.played button')].find((node) => node.textContent === text);
    expect(lay().disabled).toBe(true);
    const ticks = [...document.body.querySelectorAll('input.tick')];
    ticks[2].click(); flushSync();
    // one file alone gets its cone too, facing north to be turned
    expect(lay().textContent.trim()).toBe('Lay 1 as an angle');
    expect(document.body.querySelector('.lay span').textContent).toContain('facing north');
    expect(played('One slide each')).toBeUndefined();
    ticks[0].click(); flushSync();
    expect(lay().textContent.trim()).toBe('Lay 2 as angles');
    // the choice says how they play, a slide each first
    expect(played('One slide each').getAttribute('aria-pressed')).toBe('true');
    expect(document.body.querySelector('.lay span').textContent).toContain('one after the other');
    lay().click();
    // in the order they were ticked: the angles are numbered so
    expect(calls.onpick).toHaveBeenCalledWith({ what: 'angles', row: [MEDIA[2], MEDIA[0]], how: 'apart' });
  });

  it('plays the angles together on one slide when asked, and a single one on its own slide', async () => {
    const calls = await show({ what: 'media' });
    const ticks = [...document.body.querySelectorAll('input.tick')];
    ticks[0].click(); ticks[2].click(); flushSync();
    [...document.body.querySelectorAll('.played button')].find((node) => node.textContent === 'All on one slide').click(); flushSync();
    expect(document.body.querySelector('.lay span').textContent).toContain('played together');
    document.body.querySelector('.lay button').click();
    expect(calls.onpick).toHaveBeenCalledWith({ what: 'angles', row: [MEDIA[0], MEDIA[2]], how: 'together' });
  });

  it('says a picture will not point at its place when the page has no map', async () => {
    await show({ what: 'proof', mapped: false });
    expect(document.body.textContent).toContain('No map on the page');
  });

  it('says how to make one when the case has none', async () => {
    await show({}, [{ id: 'p1', kind: 'place' }]);
    expect(document.body.textContent).toContain('No comparison in this case yet');
  });
});
