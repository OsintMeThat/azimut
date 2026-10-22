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
    facing: [],
    stands: [],
    previewed: null,
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
    toggleFacing: vi.fn(),
    clearFacing: vi.fn(),
    toggleStand: vi.fn(),
    preview: vi.fn(),
    view: [],
    mirror: false,
    tried: null,
    tryProblem: '',
    zones: [],
    zoneDrawn: null,
    sun: { date: '', start: '06:00', end: '18:00', sides: [] },
    sectors: null,
    setSun: vi.fn(),
    toggleSunSide: vi.fn(),
    readSectors: vi.fn(),
    drawZone: vi.fn(),
    removeZone: vi.fn(),
    setZoneSpacing: vi.fn(),
    zoneProblem: () => '',
    startTrying: vi.fn(),
    stopTrying: vi.fn(),
    clearTried: vi.fn(),
    checking: false,
    check: vi.fn(),
    toggleView: vi.fn(),
    setMirror: vi.fn(),
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
    // a grid picked finer than the area allows is said widened; Auto widens unsaid
    const wide = { points: 6000, step: 0.5, asked: 20, spacing: 244.1, zones_wider: 1.6 };
    const picked = steps({ find: fakeFind({ area, areaProblem: '', searchProblem: '', settings: { spacing: 20, tolerance: 1 }, estimated: wide }) });
    expect(picked.textContent).toContain('Too large for a 20 m grid, even in hours: a point every 244 m. A zone searches finer.');
    expect(picked.textContent).toContain('Zones too large for their grid: points 1.6× farther apart.');
    const auto = steps({ find: fakeFind({ area, areaProblem: '', searchProblem: '', estimated: wide }) });
    expect(auto.textContent).not.toContain('Too large for a');
  });

  it('offers what the trace says: a camera looking down past the bounds, a wide picture to cut', () => {
    const find = fakeFind({ traceSays: { looking: 'down', span: 50 } });
    const root = steps({ find });
    expect(root.textContent).toContain('The skyline stands high in the frame: the camera may look down.');
    buttonNamed(root, 'Tick Looking down').click();
    expect(find.toggleView).toHaveBeenCalledWith('down');
    // ticked already, or the trace sits where the bounds reach: nothing to offer
    expect(steps({ find: fakeFind({ traceSays: { looking: 'down', span: 50 }, view: ['down'] }) }).textContent).not.toContain('may look down');
    expect(steps({ find: fakeFind({ traceSays: { looking: null, span: 50 } }) }).textContent).not.toContain('may look');
    const up = steps({ find: fakeFind({ traceSays: { looking: 'up', span: 50 } }) });
    expect(up.textContent).toContain('The skyline stands low in the frame: the camera may look up.');
    // a picture read as one across 126°: cut it; a collage read frame by frame or cut already is left alone
    const setCutting = vi.fn();
    const wide = steps({ find: fakeFind({ traceSays: { looking: null, span: 126 } }), overlay: { ...overlay, setCutting } });
    expect(wide.textContent).toContain('A wide picture drifts at its ends: cut it where its frames meet.');
    buttonNamed(wide, 'Cut').click();
    expect(setCutting).toHaveBeenCalledWith(true);
    const framed = { collage: 'Collage 10', frames: 8, stitched: 3, lens: 30, span: 126 };
    expect(steps({ find: fakeFind({ traceSays: { looking: null, span: 126 } }), overlay: { ...overlay, framesRead: framed } }).textContent).not.toContain('A wide picture');
    expect(steps({ find: fakeFind({ traceSays: { looking: null, span: 126 } }), overlay: { ...overlay, marks: { lines: [0], inner: [], pairs: [], cuts: [0.4] } } }).textContent).not.toContain('A wide picture');
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
    expect(root.textContent).not.toContain('The map shades where');
  });

  it('says where land stands over the lines with only sky above, and nothing where none does', () => {
    const place = { lat: 12.702, lon: 43.5415, explained: 0.31, heading: 271.6, fov: 55 };
    const shown = (over) =>
      steps({ find: fakeFind({ search: { name: 's', status: 'done', result: { verdict: 'loose', places: [{ ...place, over }], points: [] } } }) })
        .querySelector('.fs-place').textContent;
    expect(shown(0.064)).toContain('land over the sky-only lines on 6% of them');
    expect(shown(0)).not.toContain('sky-only');
  });

  it('offers to round near lines where the relief is coarse, and says so before the search', () => {
    const setRound = vi.fn();
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }];
    const coarse = steps({ find: fakeFind({ detail: 30, round: false, setRound }) });
    expect(coarse.textContent).toContain('Relief here is known to 30 m');
    buttonNamed(coarse, 'Round near lines').click();
    expect(setRound).toHaveBeenCalledWith(true);
    const on = steps({ find: fakeFind({ area, areaProblem: '', searchProblem: '', detail: 30, round: true }) });
    expect(on.textContent).toContain('near lines rounded');
    // a national survey holds near ridges as the photo shows them: nothing to round
    const fine = steps({ find: fakeFind({ area, areaProblem: '', searchProblem: '', detail: 1, round: true }) });
    expect(buttonNamed(fine, 'Round near lines')).toBeUndefined();
    expect(fine.textContent).not.toContain('near lines rounded');
  });

  it('says what the map shows when nothing explains the trace', () => {
    const places = [{ lat: 12.67, lon: 43.49, explained: 0, heading: 186, fov: 30, gap: 1.6 }];
    const points = [{ lat: 12.67, lon: 43.49, explained: 0, gap: 1.6, spacing: 100 }, { lat: 12.73, lon: 43.5, explained: 0, gap: 0.4, spacing: 100 }];
    const root = steps({ find: fakeFind({ search: { name: 's', status: 'done', result: { verdict: 'none', places, points } } }) });
    expect(root.textContent).toContain('Nothing in the area explains the trace');
    expect(root.textContent).toContain('The map shades where the trace lies nearest the terrain.');
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
    expect(told.textContent).toContain('With zoom ×0.5 · ridges within 50 km · on foot.');
    expect(told.textContent).not.toContain('left out');
    // several zoom words and the directions ticked are said too
    const unsure = steps({ find: fakeFind({ area, areaProblem: '', searchProblem: '', facing: ['n', 'ne', 'e', 's'] }), overlay: { ...overlay, hints: { zoom: ['wide', 'normal'], reach: 'auto' } } });
    expect(unsure.textContent).toContain('With zoom ×0.5 or ×1 · facing N to E, S · ridges within 50 km · on foot.');
    expect(unsure.textContent).not.toContain('Any lens finds more chance fits');
  });

  it('ticks the directions the photo may face on a compass, any way in its middle', () => {
    const find = fakeFind({ facing: ['ne'] });
    const root = steps({ find });
    const compass = root.querySelector('.fs-compass');
    expect([...compass.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['NW', 'N', 'NE', 'W', 'Any', 'E', 'SW', 'S', 'SE']);
    expect([...compass.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent.trim())).toEqual(['NE']);
    expect(root.textContent).toContain('Only headings NE are searched, drawn on the map.');
    buttonNamed(compass, 'E').click();
    expect(find.toggleFacing).toHaveBeenCalledWith('e');
    buttonNamed(compass, 'Any').click();
    expect(find.clearFacing).toHaveBeenCalledOnce();
    const none = steps({ find: fakeFind() });
    expect(none.querySelector('.fs-compass [aria-pressed="true"]').textContent.trim()).toBe('Any');
    expect(none.textContent).toContain('Tick one or several if you know roughly.');
  });

  it('ticks the ground the eye stands on, says what the grid keeps, and the time with it', () => {
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }];
    const previewed = { total: 400, kept: 100, kinds: { summit: 100, slope: 200, valley: 60, plain: 20, water: 20 }, points: [] };
    const find = fakeFind({ area, areaProblem: '', searchProblem: '', stands: ['summit'], previewed, estimated: { points: 600, coarse: 400, step: 0.5 } });
    const root = steps({ find });
    const row = root.querySelector('[aria-labelledby="find-stands"]');
    expect([...row.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['Summit or ridge', 'Slope', 'Valley', 'Plain', 'Sea or lake']);
    expect(buttonNamed(row, 'Summit or ridge').getAttribute('aria-pressed')).toBe('true');
    // each says its rule
    expect(buttonNamed(row, 'Plain').title).toBe('Flat ground: within 8 m over 400 m, or 30 m over 1.5 km');
    expect(root.textContent).toContain('Keeps 100 of 400 points (25%), 20 on water left out.');
    // three quarters of the grid left out: 300 points fewer
    expect(root.textContent).toContain('300 points, about 2 min.');
    expect(root.textContent).toContain('on foot · on a summit or ridge');
    buttonNamed(row, 'Valley').click();
    expect(find.toggleStand).toHaveBeenCalledWith('valley');
  });

  it('checks a search against decoys of its trace on a press, and says what they explain', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ lat: 0, lon: i / 100, explained: i / 50 }));
    const place = { lat: 12.9, lon: 43.6, explained: 0.79, heading: 123, fov: 42, tilt: -3, roll: 1 };
    const find = fakeFind({ search: { name: 's', status: 'done', ask: { area: [] }, result: { verdict: 'match', places: [place], points } } });
    const root = steps({ find });
    buttonNamed(root, 'Check against decoys').click();
    expect(find.check).toHaveBeenCalledOnce();
    expect(root.querySelector('.fs-place').textContent).toContain('chance 34%');
    const checked = steps({
      find: fakeFind({ search: { name: 's', status: 'done', ask: { area: [] }, result: { verdict: 'match', checked: true, places: [{ ...place, decoy: 0.22 }], points } } }),
    });
    expect(checked.textContent).toContain('Decoys of the trace explain at most 22% at the best place.');
    expect(checked.querySelector('.fs-place').textContent).toContain('decoys 22%');
    expect(buttonNamed(checked, 'Check against decoys')).toBeUndefined();
  });

  it('asks where the sun stood, on what day, and says the headings it leaves', () => {
    const find = fakeFind();
    const root = steps({ find });
    const row = root.querySelector('[aria-labelledby="find-sun"]');
    expect([...row.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['Ahead', 'Left', 'Right', 'Behind']);
    expect(root.textContent).toContain('Tick where the sun stood against the camera, with the day.');
    buttonNamed(row, 'Left').click();
    expect(find.toggleSunSide).toHaveBeenCalledWith('left');
    const dated = { date: '2024-06-21', start: '13:00', end: '15:00', sides: ['left'] };
    const read = steps({ find: fakeFind({ sun: dated, sectors: { sectors: [[180, 30], [20, 10]], sun: { from: 150.4, to: 209.6, up: true } } }) });
    expect(read.textContent).toContain('Sun at 150° to 210° then: 80° of headings left, drawn on the map.');
    expect(read.textContent).toContain('sun left on 2024-06-21');
    const down = steps({ find: fakeFind({ sun: dated, sectors: { sectors: null, sun: { up: false } } }) });
    expect(down.textContent).toContain('The sun was down then: it says nothing.');
    const none = steps({ find: fakeFind({ sun: dated, sectors: { sectors: [], sun: { up: true } } }) });
    expect(none.textContent).toContain('No heading agrees with both the sun and the directions ticked.');
  });

  it('adds zones finer or left out under the area, each with its grid and a way out', () => {
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 1.1 }, { lat: 1.1, lon: 1.1 }];
    const zones = [
      { id: 'a', points: [{ lat: 1.02, lon: 1.02 }, { lat: 1.02, lon: 1.03 }, { lat: 1.03, lon: 1.03 }], spacing: 100, out: false },
      { id: 'b', points: [{ lat: 1.05, lon: 1.05 }, { lat: 1.05, lon: 1.06 }, { lat: 1.06, lon: 1.06 }], spacing: 'auto', out: true },
    ];
    const find = fakeFind({ area, areaProblem: '', zones });
    const root = steps({ find });
    const rows = [...root.querySelectorAll('.fs-zone')];
    expect(rows.map((row) => row.querySelector('.fs-zone-what').textContent.split(' · ')[0])).toEqual(['Finer', 'Left out']);
    // a zone left out has no grid to choose
    expect(rows[1].querySelector('[role="group"]')).toBeNull();
    buttonNamed(rows[0], '250 m').click();
    expect(find.setZoneSpacing).toHaveBeenCalledWith('a', 250);
    rows[1].querySelector('[aria-label="Take zone 2 away"]').click();
    expect(find.removeZone).toHaveBeenCalledWith('b');
    buttonNamed(root, 'Finer zone').click();
    expect(find.drawZone).toHaveBeenCalledWith({ out: false });
    buttonNamed(root, 'Leave out').click();
    expect(find.drawZone).toHaveBeenCalledWith({ out: true });
    const drawing = steps({ find: fakeFind({ area, areaProblem: '', drawing: 'zone', zoneDrawn: { id: 'c', points: [], out: true } }) });
    expect(drawing.textContent).toContain('Click each corner of the zone to leave out.');
  });

  it('tries a point on the map, says what it explains there and looks from it', () => {
    const find = fakeFind();
    const onplace = vi.fn();
    const root = steps({ find, onplace });
    buttonNamed(root, 'Try a point').click();
    expect(find.startTrying).toHaveBeenCalledOnce();
    const place = { lat: 12.9, lon: 43.6, explained: 0.71, heading: 92, fov: 41, relief: 2_400 };
    const tried = steps({ find: fakeFind({ drawing: 'try', tried: { at: place, place, frames: { span: 97 }, busy: false, error: '' } }), onplace });
    const card = tried.querySelector('[aria-label="The point tried"]');
    expect(card.textContent).toContain('Tried here: explains 71%');
    expect(card.textContent).toContain('41° lens · ridges about 2.40 km out');
    buttonNamed(card, 'Look from here').click();
    expect(onplace).toHaveBeenCalledWith({ ...place, frames: { span: 97 } });
    const blocked = steps({ find: fakeFind({ tryProblem: 'Open a case first' }) });
    expect(buttonNamed(blocked, 'Try a point').disabled).toBe(true);
  });

  it('asks how the camera looks and whether it is a selfie, and says it with the rest', () => {
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }];
    const find = fakeFind({ area, areaProblem: '', searchProblem: '', view: ['down'], mirror: true });
    const root = steps({ find });
    const row = root.querySelector('[aria-labelledby="find-view"]');
    expect([...row.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['Looking down', 'Looking up', 'Selfie']);
    expect(root.textContent).toContain('on foot · looking down · mirrored too');
    buttonNamed(row, 'Looking up').click();
    expect(find.toggleView).toHaveBeenCalledWith('up');
    buttonNamed(row, 'Selfie').click();
    expect(find.setMirror).toHaveBeenCalledWith(false);
  });

  it('says the lines the analyst set a distance on take the place of the reach', () => {
    const area = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }];
    const marks = { lines: [0, 1], inner: [1], pairs: [], cuts: [], far: [{ line: 0, bands: ['b1'] }] };
    const root = steps({ find: fakeFind({ area, areaProblem: '', searchProblem: '' }), overlay: { ...overlay, marks, hints: { reach: 5000 } } });
    expect(root.textContent).toContain('lines 1–3 km away');
    expect(root.textContent).not.toContain('are left out');
  });

  it('says a collage of a pan is read frame by frame, its lens the stitch’s', () => {
    const framed = { collage: 'Collage 10', frames: 6, stitched: 3, lens: 30.1, span: 97 };
    const root = steps({ find: fakeFind(), overlay: { ...overlay, framesRead: framed, panoramaOffered: true } });
    expect(root.textContent).toContain('6 frames of 30°');
    expect(root.textContent).toContain('Find reads Collage 10 frame by frame: 6 frames, 30° across each, as the stitch says.');
    expect(root.textContent).not.toContain('Any lens finds more chance fits');
  });

  it('says how far the best place can be trusted, why, and what the area fits by chance', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ lat: 0, lon: i / 100, explained: i / 50 }));
    const best = { lat: -4.2052, lon: 28.796, explained: 0.59, heading: 296, fov: 31.3, tilt: -1, roll: 3 };
    const rival = { lat: -4.101, lon: 28.7955, explained: 0.53 };
    const ask = { area: [], trace: { known: false, within: [30, 65] }, who: { mode: 'ground' }, photo: { path: 'media/p.png' } };
    const weak = steps({ find: fakeFind({ search: { name: 's', status: 'done', ask, result: { verdict: 'match', places: [best, rival], points } } }) });
    const block = weak.querySelector('.fs-trust');
    expect(block.classList.contains('weak')).toBe(true);
    expect(block.textContent).toContain('Weak');
    expect([...block.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Another place 12 km away explains nearly as much',
      'The lens found, 31°, is the narrowest tried',
    ]);
    expect(block.textContent).toContain('Chance fits in this area reach about 34%.');
    const solid = steps({ find: fakeFind({ search: { name: 's', status: 'done', ask, result: { verdict: 'match', places: [{ ...best, fov: 45 }], points } } }) });
    expect(solid.querySelector('.fs-trust.solid').textContent).toContain('Solid: nothing speaks against the best place');
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
    expect(shown.textContent).toMatch(/km² · zoom ×0.5 · ridges within 50 km · drone · 1 alignment/);
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
