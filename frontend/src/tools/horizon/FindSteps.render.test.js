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
    detail: null,
    readDetail: vi.fn(),
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

  it('says what the trace holds beside the skyline, and how far a search may grow near relief', () => {
    const marks = { lines: [0, 1, 2], inner: [1], pairs: [[1, 0]], cuts: [0.5] };
    const root = steps({ find: fakeFind(), overlay: { ...overlay, strokes: [[], [], []], marks } });
    expect(root.textContent).toContain('3 lines traced: 1 ridge · 1 pair · 2 pieces.');
    expect(root.textContent).not.toContain('Draw it with the Ridge pen');
    const plain = steps({ find: fakeFind() });
    expect(plain.textContent).toContain('A ridge seen in front of farther land, not the sky? Draw it with the Ridge pen.');
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }];
    const sized = steps({ find: fakeFind({ area, areaProblem: '', searchProblem: '', estimated: { points: 1003, most: 3205, step: 0.5 } }) });
    expect(sized.textContent).toContain('1,003 points, about 5 min; up to 16 min where relief stands near.');
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

  it('says, for each place, how its ridges in front and its pairs lay on the terrain', () => {
    const places = [{ lat: 12.702, lon: 43.5415, explained: 0.79, heading: 271.6, fov: 55, inner: 0.898, pairs: [4, 4] }];
    const root = steps({ find: fakeFind({ search: { name: 's', status: 'done', result: { verdict: 'match', places, points: [] } } }) });
    expect(root.querySelector('.fs-place').textContent).toContain('ridges in front 90% on the terrain · 4 of 4 pairs in order');
  });

  it('says what the search runs with, and warns of a short reach or any lens before it runs', () => {
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }];
    const ready = fakeFind({ area, areaProblem: '', searchProblem: '' });
    const hazed = steps({ find: ready, overlay: { ...overlay, hints: { zoom: 'any', reach: 5000 } } });
    expect(hazed.textContent).toContain('With any lens · ridges within about 5 km · on foot.');
    // searched on to twice the reach given: the ridges past that are the ones left out
    expect(hazed.textContent).toContain('Ridges past 10 km are left out: a far skyline cannot be found.');
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

describe('the two faces of Find', () => {
  it('numbers only the three steps a search needs, and folds what helps it under its gist', () => {
    const root = steps({ find: fakeFind() });
    expect([...root.querySelectorAll('.fs-num')].map((n) => n.textContent)).toEqual(['1', '2', '3']);
    expect([...root.querySelectorAll('.fs-step h3')].map((h) => h.textContent.replace(/^\d/, ''))).toEqual(['Skyline', 'Area', 'Search']);
    // the trace is done, so its number lights alone
    expect([...root.querySelectorAll('.fs-step')].map((step) => step.classList.contains('done'))).toEqual([true, false, false]);
    const parts = [...root.querySelectorAll('.fs-part')];
    expect(parts.map((part) => [part.querySelector('.fs-part-title').textContent, part.querySelector('.fs-gist').textContent, part.open])).toEqual([
      ['Alignments', 'None', false],
      ['What you know', 'Any lens · ridges within 50 km · on foot', false],
    ]);
  });

  it('unfolds the alignments while one is being made', () => {
    const root = steps({ find: fakeFind({ pending: { step: 1 }, step: { text: 'Click what stands behind it on the photo' } }) });
    const part = root.querySelector('.fs-part');
    expect(part.open).toBe(true);
    expect(part.textContent).toContain('2 of 4');
  });

  it('shows the search on show with when and what it was asked, and goes back to Prepare and again', () => {
    const area = [[46.5, 7.8], [46.5, 7.9], [46.6, 7.9]];
    const search = {
      name: 'ridge',
      title: 'Ridge search',
      status: 'done',
      created_at: '2026-10-14T19:05:00',
      ask: { area, hints: { zoom: 'wide' }, who: { mode: 'drone' }, alignments: [{}] },
      result: { verdict: 'match', places: [{ lat: 46.55, lon: 7.85, explained: 0.8 }], points: [] },
    };
    const find = fakeFind({ search });
    const root = steps({ find });
    const shown = root.querySelector('[aria-label="The search on show"]');
    expect(shown.querySelector('h3').textContent).toBe('Ridge search');
    expect(shown.textContent).toContain('14 Oct 2026, 19:05');
    expect(shown.textContent).toMatch(/km² · wide lenses · ridges within 50 km · drone · 1 alignment/);
    expect(root.querySelector('.fs-steps')).toBeNull();
    buttonNamed(root, 'Change and search again').click();
    flushSync();
    expect(root.querySelector('[aria-label="The search on show"]')).toBeNull();
    expect(root.querySelector('.fs-steps')).not.toBeNull();
    buttonNamed(root, 'Back to the result').click();
    flushSync();
    expect(root.querySelector('[aria-label="The search on show"]')).not.toBeNull();
    buttonNamed(root, 'Clear the results').click();
    expect(find.closeSearch).toHaveBeenCalledOnce();
  });
});

describe('the relief under the area', () => {
  it('says how fine it is under the skyline step, once read', () => {
    const coarse = steps({ find: fakeFind({ detail: 30 }) });
    expect(coarse.textContent).toContain('Relief here is known to 30 m: trace a near ridge’s shape, not its rocks or trees.');
    const unknown = steps({ find: fakeFind() });
    expect(unknown.textContent).not.toContain('Relief here');
  });
});
