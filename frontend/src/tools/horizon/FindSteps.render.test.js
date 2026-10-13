// @vitest-environment happy-dom
/** The steps of Find: what each says, and the search from its press to its places. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import FindSteps from './FindSteps.svelte';

function fakeFind(over = {}) {
  return {
    area: [],
    areaProblem: 'Draw at least three corners',
    drawing: null,
    alignments: [],
    pending: null,
    step: null,
    meeting: null,
    who: { mode: 'ground', low: 1.7, high: 1.7 },
    settings: { spacing: 'auto', tolerance: 1 },
    search: null,
    searching: false,
    searchProblem: 'Draw the area on the map',
    estimated: null,
    list: [],
    estimate: vi.fn(),
    stop: vi.fn(),
    closeSearch: vi.fn(),
    drawArea: vi.fn(),
    clearArea: vi.fn(),
    closeArea: vi.fn(),
    startAlignment: vi.fn(),
    cancelAlignment: vi.fn(),
    removeAlignment: vi.fn(),
    setTops: vi.fn(),
    setWho: vi.fn(),
    setSettings: vi.fn(),
    ...over,
  };
}

const overlay = { source: { name: 'barry', kind: 'image' }, strokes: [[{ u: 0, v: 0.5 }, { u: 1, v: 0.5 }]], hints: {}, lens: null, panoramaOffered: false };

let live = [];
function steps(props) {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(FindSteps, { target, props: { overlay, ...props } });
  live.push({ component, target });
  flushSync();
  return target;
}
afterEach(() => {
  for (const { component, target } of live) {
    unmount(component);
    target.remove();
  }
  live = [];
  vi.useRealTimers();
});

const buttonNamed = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

describe('the steps of Find', () => {
  it('says the trace is there, asks for the area and holds the search until it can run', () => {
    const root = steps({ find: fakeFind() });
    expect(root.textContent).toContain('1 line traced');
    expect(buttonNamed(root, 'Draw the area')).not.toBeUndefined();
    expect(root.textContent).toContain('Draw the area on the map.');
    expect(buttonNamed(root, 'Search').disabled).toBe(true);
  });

  it('says how large the search is, and starts it on a press', async () => {
    const onsearch = vi.fn(async () => {});
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }];
    const root = steps({ find: fakeFind({ area, areaProblem: '', searchProblem: '', estimated: { points: 469, step: 0.5 } }), onsearch });
    expect(root.textContent).toContain('469 points, about 2 min.');
    buttonNamed(root, 'Search').click();
    expect(onsearch).toHaveBeenCalledOnce();
  });

  it('follows a running search and stops it', () => {
    const find = fakeFind({ searching: true, search: { name: 's', status: 'running', progress: { done: 120, total: 469 } } });
    const root = steps({ find });
    expect(root.textContent).toContain('Searching: 120 of 469 points');
    expect(root.querySelector('.fs-bar span').style.width).toBe('26%');
    buttonNamed(root, 'Stop').click();
    expect(find.stop).toHaveBeenCalledOnce();
  });

  it('lists the best places with what each explains, a click looking from one', () => {
    const places = [
      { lat: 16.9985, lon: 45.0912, explained: 0.899, heading: 298.6, fov: 84 },
      { lat: 17.004, lon: 45.1, explained: 0.71, heading: 299.2, fov: 69 },
    ];
    const onplace = vi.fn();
    const find = fakeFind({ search: { name: 's', status: 'done', result: { verdict: 'match', places, points: [] } } });
    const root = steps({ find, onplace });
    expect(root.textContent).toContain('One place stands out');
    const rows = [...root.querySelectorAll('.fs-place')];
    expect(rows.map((r) => r.querySelector('strong').textContent)).toEqual(['explains 90%', 'explains 71%']);
    expect(rows[0].textContent).toContain('16.9985, 45.0912');
    rows[0].click();
    expect(onplace).toHaveBeenCalledWith(places[0]);
    expect(root.textContent).toContain('A score, not a probability');
  });

  it('lists the earlier searches to open or delete', () => {
    const onopensearch = vi.fn();
    const onremovesearch = vi.fn();
    const list = [{ name: 'old', title: 'Old search', status: 'done', best: { explained: 0.62 } }];
    const root = steps({ find: fakeFind({ list }), onopensearch, onremovesearch });
    const open = [...root.querySelectorAll('.fs-link')][0];
    expect(open.textContent).toContain('best 62%');
    open.click();
    expect(onopensearch).toHaveBeenCalledWith('old');
    root.querySelector('button[aria-label="Delete Old search"]').click();
    expect(onremovesearch).toHaveBeenCalledWith('old');
  });

  it('says what the search runs with, and warns of a short reach or any lens before it runs', () => {
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }];
    const ready = fakeFind({ area, areaProblem: '', searchProblem: '' });
    const hazed = steps({ find: ready, overlay: { ...overlay, hints: { zoom: 'any', reach: 5000 } } });
    expect(hazed.textContent).toContain('With any lens · ridges within 5 km · on foot.');
    expect(hazed.textContent).toContain('Ridges past 5 km are left out: a far skyline cannot be found.');
    expect(hazed.textContent).toContain('Any lens finds more chance fits: say the zoom if you can.');
    const told = steps({ find: ready, overlay: { ...overlay, hints: { zoom: 'wide', reach: 'auto' } } });
    expect(told.textContent).toContain('With wide lenses · ridges within 50 km · on foot.');
    expect(told.textContent).not.toContain('left out');
  });

  it('says when no place stands out, and what to change', () => {
    const places = [{ lat: 1, lon: 1, explained: 0.75, heading: 280, fov: 22, reach: 5000 }];
    const root = steps({ find: fakeFind({ search: { name: 's', status: 'done', result: { verdict: 'unclear', places, points: [] } } }) });
    expect(root.textContent).toContain('No place stands out: many explain the trace about as well');
    expect(root.textContent).toContain('Say the zoom, check how far the photo sees');
    // each place says its lens and how far it read, so a stray one shows
    expect(root.querySelector('.fs-place').textContent).toContain('22° lens · ridges within 5 km');
  });
});
