// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SceneTab from './SceneTab.svelte';
import { sceneList } from '../../lib/scenes.js';
import { SceneEdit } from '../../lib/sceneEdit.svelte.js';

/**
 * The Scenes tab, used the way an analyst uses it: a closed row writes its kind and
 * time and a press opens it, the open row shows its time as it stands with its acts,
 * a picture is marked whole, and the abandoned wait folded at the foot.
 */

let live = [];
let targets = [];

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
});

afterEach(() => {
  for (const one of live) unmount(one);
  live = [];
  for (const node of targets) node.remove();
  targets = [];
});

function render(Component, props) {
  const target = document.createElement('div');
  document.body.append(target);
  targets.push(target);
  live.push(mount(Component, { target, props }));
  flushSync();
  return target;
}

const proof = (name, extra = {}) => ({
  kind: 'proof', proof: name, title: name, moments: [], at: [], stated: false, draft: null, points: [], ...extra,
});

const SCENES = () => sceneList(
  [
    proof('Proof 28', { at: [3.4] }),
    proof('Depot', { moments: [{ start: 130, end: 158 }], stated: true, points: [{}, {}] }),
    proof('Crossroads', { moments: [{ start: 200, end: 215 }, { start: 400, end: 410 }, { start: 500, end: null }], stated: true }),
  ],
  [{ id: 'sc_1', start: 60, end: null, label: '' }, { id: 'sc_all', start: null, end: null, label: 'which town?' }],
);

const rows = (root) => [...root.querySelectorAll('[data-testid="scene-row"]')];
const field = (root, name, index = 0) => root.querySelectorAll(`input[aria-label="${name}"]`)[index] ?? null;
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const type = (input, text) => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};
const key = (node, k, extra = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));

describe('the list of scenes', () => {
  it('asks one place or several when the clip has no scene, each choice its own press', () => {
    const onwhole = vi.fn();
    const onseveral = vi.fn();
    const root = render(SceneTab, { scenes: [], onwhole, onseveral });
    const choice = root.querySelector('[data-testid="scene-choice"]');
    expect(choice.textContent).toContain('One place or several?');
    const whole = button(choice, 'The whole video: one place');
    const several = [...choice.querySelectorAll('button')].find((b) => b.textContent.includes('Several places: mark them as you watch'));
    expect(whole.getAttribute('title')).toBe('One scene about the whole video, with no timecode');
    expect(several.getAttribute('title')).toBe('Press S where each place shows as the video plays');
    expect(several.querySelector('kbd').textContent).toBe('S');
    whole.click();
    expect(onwhole).toHaveBeenCalledOnce();
    several.click();
    expect(onseveral).toHaveBeenCalledOnce();
    // nothing to remember: no Not now
    expect(button(choice, 'Not now')).toBeUndefined();
  });

  it('waits for the clip\'s list before asking, so a proof resting on it never sees the question flash', () => {
    const root = render(SceneTab, { scenes: [], read: false });
    expect(root.querySelector('[data-testid="scene-choice"]')).toBeNull();
  });

  it('writes each closed scene\'s name, kind and time, in clip order, the whole video first', () => {
    const list = rows(render(SceneTab, { scenes: SCENES() }));
    expect(list.map((r) => [r.querySelector('.row-title').textContent, r.querySelector('.row-when')?.textContent ?? null])).toEqual([
      ['which town?', 'Whole video'],
      ['Proof 28', 'Whole video'],
      // a scene with no name goes by its time
      ['Instant · 1:00', null],
      ['Depot', 'Passage · 2:10–2:38'],
      ['Crossroads', '3 passages · 3:20–3:35 +2'],
    ]);
    expect(list[1].textContent).toContain('Proved');
    expect(list[3].textContent).toContain('2 places');
    expect(list.every((r) => r.tagName === 'BUTTON' && r.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(list.every((r) => !r.querySelector('input'))).toBe(true);
  });

  it('opens a closed row from a press anywhere on it', () => {
    const onopen = vi.fn();
    const list = rows(render(SceneTab, { scenes: SCENES(), onopen }));
    list[3].querySelector('.row-when').click();
    expect(onopen).toHaveBeenCalledWith(expect.objectContaining({ proof: 'Depot' }));
  });
});

describe('the open row', () => {
  const opened = (scenes, id, handlers = {}) => {
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    const scene = scenes.find((sc) => sc.key === id);
    edit.begin(scene);
    return { edit, root: render(SceneTab, { scenes, edit, open: id, ...handlers }) };
  };

  it('shows one row open, its time as it stands, and takes no key from the player', () => {
    const { root } = opened(SCENES(), 'sc_1');
    const open = rows(root).filter((r) => r.classList.contains('open'));
    expect(open).toHaveLength(1);
    expect(open[0].querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Instant');
    expect(field(root, 'Scene start').value).toBe('1:00');
    expect(field(root, 'Scene end')).toBeNull();
    expect(document.activeElement).not.toBe(field(root, 'Scene start'));
    expect(button(open[0], 'Another passage')).toBeUndefined();
  });

  it('asks for Apply only once something changed, and drops it on Cancel', () => {
    const onapply = vi.fn();
    const oncancel = vi.fn();
    const { edit, root } = opened(SCENES(), 'sc_1', { onapply, oncancel });
    expect(button(root, 'Apply')).toBeUndefined();
    expect(button(root, 'Cancel')).toBeUndefined();
    type(field(root, 'Scene start'), '1:05');
    expect(edit.changed).toBe(true);
    button(root, 'Apply').click();
    expect(onapply).toHaveBeenCalledTimes(1);
    key(field(root, 'Scene start'), 'Enter');
    expect(onapply).toHaveBeenCalledTimes(2);
    button(root, 'Cancel').click();
    expect(oncancel).toHaveBeenCalledTimes(1);
    key(field(root, 'Scene start'), 'Escape');
    expect(oncancel).toHaveBeenCalledTimes(2);
  });

  it('reads what is typed, says what is wrong, and only applies a real time', () => {
    const { edit, root } = opened(SCENES(), 'sc_1');
    type(field(root, 'Scene start'), '1:05,5');
    expect(edit.start).toBeCloseTo(65.52, 6); // the nearest frame at 25 fps
    expect(root.querySelector('.problem')).toBeNull();
    type(field(root, 'Scene start'), 'soon');
    expect(root.querySelector('.problem').textContent).toBe('Type a time, like 1:05 or 65');
    expect(field(root, 'Scene start').getAttribute('aria-invalid')).toBe('true');
    expect(button(root, 'Apply').disabled).toBe(true);
  });

  it('takes either end from the frame on screen and nudges it with the arrows', () => {
    const onhere = vi.fn();
    const onnudge = vi.fn();
    const { root } = opened(SCENES(), 'proof:Depot', { onhere, onnudge });
    const [startHere, endHere] = [...root.querySelectorAll('.here')];
    startHere.click();
    endHere.click();
    expect(onhere.mock.calls).toEqual([['start', 0], ['end', 0]]);
    key(field(root, 'Scene end'), 'ArrowUp');
    key(field(root, 'Scene start'), 'ArrowDown', { shiftKey: true });
    expect(onnudge.mock.calls).toEqual([['end', 1, false, 0], ['start', -1, true, 0]]);
  });

  it('names, ends and removes a scene still to prove, and plays a passage', () => {
    const handlers = { onlabel: vi.fn(), onend: vi.fn(), onremove: vi.fn(), onplay: vi.fn() };
    const scenes = sceneList([], [{ id: 'sc_1', start: 60, end: 70, label: '' }]);
    const { root } = opened(scenes, 'sc_1', handlers);
    const row = rows(root)[0];
    type(field(root, 'Scene label'), 'Bridge?');
    expect(handlers.onlabel).toHaveBeenCalledWith('sc_1', 'Bridge?');
    expect(field(root, 'Scene label').placeholder).toBe('What to find here');
    button(row, 'End here').click();
    expect(handlers.onend).toHaveBeenCalledWith('sc_1');
    row.querySelector('[aria-label="Remove scene"]').click();
    expect(handlers.onremove).toHaveBeenCalledWith('sc_1');
    row.querySelector('[aria-label="Play scene"]').click();
    expect(handlers.onplay).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc_1' }));
  });

  it('offers nothing to end on a scene about the whole video, and no play on an instant', () => {
    const { root } = opened(SCENES(), 'sc_all');
    expect(button(root, 'End here')).toBeUndefined();
    expect(root.querySelector('[aria-label="Play scene"]')).toBeNull();
    expect(root.textContent).toContain('No timecode, the scene is about the whole video');
  });

  it('offers Geolocate as its main act, last, Make the proof before it', () => {
    const onmakeproof = vi.fn();
    const ongeolocate = vi.fn();
    const { root } = opened(SCENES(), 'sc_1', { onmakeproof, ongeolocate });
    const row = rows(root).find((r) => r.classList.contains('open'));
    expect([...row.querySelectorAll('.acts button')].map((b) => b.textContent.trim())).toEqual(['End here', 'Make the proof', 'Geolocate']);
    const make = row.querySelector('[aria-label="Make the proof"]');
    expect(make.getAttribute('title')).toBe('Make the proof of this scene in Geo Proof, from its frames and captures');
    make.click();
    expect(onmakeproof).toHaveBeenCalledWith(expect.objectContaining({ kind: 'draft', id: 'sc_1', start: 60 }));
    const go = button(row, 'Geolocate');
    expect(go.classList.contains('locate')).toBe(true);
    expect(go.getAttribute('title')).toBe('Find it on the map, the video open beside it');
    go.click();
    expect(ongeolocate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'draft', id: 'sc_1' }));
  });

  it('says where a scene stands, closed or open, and turns Geolocate into Stop on the one being looked for', () => {
    const scenes = SCENES().map((sc) => {
      if (sc.id === 'sc_1') return { ...sc, state: 'progress', captures: ['a.png', 'b.png'] };
      if (sc.id === 'sc_all') return { ...sc, state: 'progress', captures: ['c.png'], geolocating: true };
      return sc;
    });
    const { root } = opened(scenes, 'sc_all', { footage: new Map([['sc_all', 6], ['sc_1', 2]]) });
    const list = rows(root);
    const state = (row) => row.querySelector('[data-testid="scene-state"]');
    const counts = (row) => [...state(row).querySelectorAll('[data-testid^="count-"]')].map((c) => c.textContent.trim());
    // its mark and its two counts, the map's and the clip's, the hover saying them in words
    expect(counts(list[0])).toEqual(['1', '6']);
    expect(state(list[0]).querySelector('[data-testid="scene-counts"]').dataset.stage).toBe('live');
    expect(state(list[0]).querySelector('[data-testid="scene-counts"]').title).toBe('Geolocating: 1 map capture, 6 pictures from the video');
    expect(list[0].classList.contains('active')).toBe(true);
    const stop = list[0].querySelector('.locate');
    expect(stop.textContent.trim()).toBe('Stop');
    expect(stop.getAttribute('aria-pressed')).toBe('true');
    expect(stop.getAttribute('title')).toBe('Stop geolocating it; its captures stay');
    // closed, it still says so
    expect(counts(list[2])).toEqual(['2', '2']);
    expect(state(list[2]).querySelector('[data-testid="scene-counts"]').title).toBe('In progress: 2 map captures, 2 pictures from the video');
    expect(list[2].classList.contains('active')).toBe(false);
    // a proof states nothing of the kind
    expect(state(list[1])).toBeNull();
  });

  it('opens a proved scene\'s time, offers its moments and its proof, and nothing to remove it', () => {
    const onopenproof = vi.fn();
    const onaddmoment = vi.fn();
    const { root } = opened(SCENES(), 'proof:Crossroads', { onopenproof, onaddmoment });
    const row = rows(root).find((r) => r.classList.contains('open'));
    expect(row.textContent).toContain('Crossroads');
    expect(row.querySelectorAll('[data-testid="scene-moment"]')).toHaveLength(3);
    expect(row.querySelector('[aria-label="Remove scene"]')).toBeNull();
    expect(button(row, 'Geolocate')).toBeUndefined();
    button(row, 'Open the proof').click();
    expect(onopenproof).toHaveBeenCalledWith(expect.objectContaining({ proof: 'Crossroads' }));
    button(row, 'Another passage').click();
    expect(onaddmoment).toHaveBeenCalled();
  });

  it('says a proof about the whole video keeps its frames pinned', () => {
    const { root } = opened(SCENES(), 'proof:Proof 28');
    expect(root.textContent).toContain('No timecode, the scene is about the whole video. Its frames stay pinned on the bar');
  });

  it('gives the field Another passage just added the keys, and no other', async () => {
    const scenes = SCENES();
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    edit.begin(scenes.find((sc) => sc.key === 'proof:Crossroads'));
    const onaddmoment = () => edit.add(600);
    const root = render(SceneTab, { scenes, edit, open: 'proof:Crossroads', onaddmoment });
    expect(document.activeElement).toBe(document.body);
    button(root, 'Another passage').click();
    flushSync();
    expect(root.querySelectorAll('[data-testid="scene-moment"]')).toHaveLength(4);
    expect(document.activeElement).toBe(field(root, 'Scene start', 3));
  });

  it('hands the keys back to the player on a press outside', () => {
    const { root } = opened(SCENES(), 'sc_1');
    const player = document.createElement('div');
    document.body.append(player);
    field(root, 'Scene start').focus();
    expect(document.activeElement).toBe(field(root, 'Scene start'));
    player.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.activeElement).not.toBe(field(root, 'Scene start'));
    player.remove();
  });
});

describe('giving up on a scene', () => {
  const abandoned = (scenes, id, reason) => scenes.map((sc) => (sc.id === id
    ? { ...sc, state: 'abandoned', abandoned: { reason, at: '2026-11-06T10:00:00+00:00' } }
    : sc));
  const openOn = (scenes, id, handlers = {}) => {
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    edit.begin(scenes.find((sc) => sc.key === id));
    return render(SceneTab, { scenes, edit, open: id, ...handlers });
  };

  it('asks for a word in the row, Enter abandoning it with what was typed, even nothing', () => {
    const onabandon = vi.fn();
    const root = openOn(SCENES(), 'sc_1', { onabandon });
    const row = () => rows(root).find((r) => r.classList.contains('open'));
    button(row(), 'Abandon').click();
    flushSync();
    const word = field(root, 'Why it is abandoned');
    expect(document.activeElement).toBe(word);
    // the row's acts make way for the word while it is asked
    expect(button(row(), 'Geolocate')).toBeUndefined();
    type(word, '  no landmark in view ');
    key(word, 'Enter');
    flushSync();
    expect(onabandon).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc_1' }), 'no landmark in view');
    expect(field(root, 'Why it is abandoned')).toBeNull();

    button(row(), 'Abandon').click();
    flushSync();
    button(row(), 'Abandon').click();
    expect(onabandon).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'sc_1' }), '');
  });

  it('keeps it on Escape or Cancel', () => {
    const onabandon = vi.fn();
    const root = openOn(SCENES(), 'sc_1', { onabandon });
    const row = () => rows(root).find((r) => r.classList.contains('open'));
    button(row(), 'Abandon').click();
    flushSync();
    key(field(root, 'Why it is abandoned'), 'Escape');
    flushSync();
    expect(field(root, 'Why it is abandoned')).toBeNull();
    button(row(), 'Abandon').click();
    flushSync();
    button(row().querySelector('.leave'), 'Cancel').click();
    flushSync();
    expect(field(root, 'Why it is abandoned')).toBeNull();
    expect(onabandon).not.toHaveBeenCalled();
  });

  it('folds the abandoned at the foot of the tab, greyed with their word, and restores one', () => {
    const onrestore = vi.fn();
    const ongo = vi.fn();
    const root = render(SceneTab, { scenes: abandoned(SCENES(), 'sc_1', 'bridge out of shot'), onrestore, ongo });
    // the main list goes on without it
    expect(rows(root)).toHaveLength(4);
    const head = button(root, 'Abandoned (1)');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[data-testid="scene-row-abandoned"]')).toBeNull();
    head.click();
    flushSync();
    const given = root.querySelector('[data-testid="scene-row-abandoned"]');
    expect(given.textContent).toContain('bridge out of shot');
    expect(given.textContent).toContain('No label');
    // only looked at: its time goes there, and nothing else is offered but Restore
    given.querySelector('.gone-time').click();
    expect(ongo).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc_1' }));
    expect(button(given, 'Geolocate')).toBeUndefined();
    button(given, 'Restore').click();
    expect(onrestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc_1' }));
  });

  it('reads a proof with no place yet as In progress, abandons it with a word, and restores it from the foot', () => {
    const onabandon = vi.fn();
    const onopenproof = vi.fn();
    const scenes = sceneList([
      proof('Depot', { moments: [{ start: 130, end: 158 }], stated: true, points: [{ lat: 1, lon: 2 }], state: 'proved' }),
      proof('Bridge', { moments: [{ start: 60, end: 70 }], stated: true, state: 'progress', abandoned: null }),
    ], []);
    const closed = render(SceneTab, { scenes });
    const states = [...closed.querySelectorAll('[data-testid="scene-row"]')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
    expect(states.find((t) => t.includes('Bridge'))).toContain('In progress · no place');
    expect(states.find((t) => t.includes('Bridge'))).not.toContain('Proved');
    expect(states.find((t) => t.includes('Depot'))).toContain('Proved');

    const root = openOn(scenes, 'proof:Bridge', { onabandon, onopenproof });
    const row = () => rows(root).find((r) => r.classList.contains('open'));
    button(row(), 'Open the proof').click();
    expect(onopenproof).toHaveBeenCalledWith(expect.objectContaining({ proof: 'Bridge' }));
    button(row(), 'Abandon').click();
    flushSync();
    type(field(root, 'Why it is abandoned'), 'no landmark');
    key(field(root, 'Why it is abandoned'), 'Enter');
    expect(onabandon).toHaveBeenCalledWith(expect.objectContaining({ proof: 'Bridge' }), 'no landmark');
    // a proof that states a place is proved, and offers no Abandon
    const placed = openOn(scenes, 'proof:Depot');
    expect(button(rows(placed).find((r) => r.classList.contains('open')), 'Abandon')).toBeUndefined();

    const onrestore = vi.fn();
    const left = sceneList([
      proof('Bridge', { moments: [{ start: 60, end: 70 }], stated: true, state: 'abandoned', abandoned: { reason: 'too blurry' } }),
    ], []);
    const foot = render(SceneTab, { scenes: left, onrestore });
    expect(rows(foot)).toHaveLength(0);
    button(foot, 'Abandoned (1)').click();
    flushSync();
    const given = foot.querySelector('[data-testid="scene-row-abandoned"]');
    expect(given.textContent).toContain('Bridge');
    expect(given.textContent).toContain('too blurry');
    button(given, 'Restore').click();
    expect(onrestore).toHaveBeenCalledWith(expect.objectContaining({ proof: 'Bridge' }));
  });

  it('brings a scene asked for into view, unfolding its group when it was abandoned', async () => {
    const root = render(SceneTab, { scenes: abandoned(SCENES(), 'sc_1', ''), focus: { key: 'sc_1', n: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(button(root, 'Abandoned (1)').getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-testid="scene-row-abandoned"]').classList.contains('lit')).toBe(true);
  });

  it('asks again on a clip holding only abandoned scenes, and not once one is live', () => {
    const one = sceneList([], [{ id: 'sc_1', start: 60, end: null, label: '' }]);
    const root = render(SceneTab, { scenes: abandoned(one, 'sc_1', '') });
    expect(root.querySelector('[data-testid="scene-choice"]')).not.toBeNull();
    expect(button(root, 'Abandoned (1)')).toBeDefined();
    const live = render(SceneTab, { scenes: one });
    expect(live.querySelector('[data-testid="scene-choice"]')).toBeNull();
  });
});

describe('a picture', () => {
  const marked = (extra = {}) => sceneList([], [{ id: 'sc_p', start: null, end: null, label: 'Market' }]).map((sc) => ({ ...sc, ...extra }));

  it('offers Mark to geolocate, one press, with what it does in a word', () => {
    const onmark = vi.fn();
    const root = render(SceneTab, { scenes: [], picture: true, onmark });
    expect(root.textContent).toContain('It waits in the To-do until a proof lays it out.');
    button(root, 'Mark to geolocate').click();
    expect(onmark).toHaveBeenCalledTimes(1);
  });

  it('shows its mark with no time at all, its state and its acts', () => {
    const handlers = { onlabel: vi.fn(), ongeolocate: vi.fn(), onmakeproof: vi.fn() };
    const root = render(SceneTab, { scenes: marked(), picture: true, ...handlers });
    expect(button(root, 'Mark to geolocate')).toBeUndefined();
    const [row] = rows(root);
    expect(row.querySelector('[role="radio"]')).toBeNull();
    // a picture gives itself: one from the file, and nothing from the map yet
    expect(row.querySelector('[data-testid="scene-counts"]').title).toBe('To geolocate: no map capture yet, the picture itself');
    expect(field(root, 'Scene label').value).toBe('Market');
    expect(button(row, 'End here')).toBeUndefined();
    expect(button(row, 'Abandon')).toBeDefined();
    expect(button(row, 'Geolocate').getAttribute('title')).toBe('Find it on the map, the picture open beside it');
    button(row, 'Geolocate').click();
    expect(handlers.ongeolocate).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc_p' }));
    const make = row.querySelector('[aria-label="Make the proof"]');
    expect(make.getAttribute('title')).toBe('Make the proof in Geo Proof, from the picture and its captures');
    make.click();
    expect(handlers.onmakeproof).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc_p' }));
  });

  it('says Geolocating and offers Stop on the one being looked for', () => {
    const root = render(SceneTab, { scenes: marked({ geolocating: true, captures: ['a.png'], state: 'progress' }), picture: true });
    const [row] = rows(root);
    expect(row.querySelector('[data-testid="scene-counts"]').title).toBe('Geolocating: 1 map capture, the picture itself');
    expect(button(row, 'Stop')).toBeDefined();
  });

  it('lists the proof laying it out, which opens it', () => {
    const onopenproof = vi.fn();
    const scenes = sceneList([proof('p12', { title: 'Proof 12' })], []);
    const root = render(SceneTab, { scenes, picture: true, onopenproof });
    const [row] = rows(root);
    expect(row.textContent).toContain('Proved · Proof 12');
    row.click();
    expect(onopenproof).toHaveBeenCalledWith(expect.objectContaining({ proof: 'p12' }));
    expect(button(root, 'Mark to geolocate')).toBeUndefined();
  });

  it('keeps an abandoned mark folded, with no second mark offered', () => {
    const scenes = marked({ state: 'abandoned', abandoned: { reason: 'too dark', at: 't' } });
    const root = render(SceneTab, { scenes, picture: true });
    expect(button(root, 'Mark to geolocate')).toBeUndefined();
    button(root, 'Abandoned (1)').click();
    flushSync();
    const given = root.querySelector('[data-testid="scene-row-abandoned"]');
    expect(given.textContent).toContain('too dark');
    expect(given.querySelector('.gone-time')).toBeNull();
  });
});

describe('the collages of the clip', () => {
  const collage = (name, start, end = null) => ({ collage: name, title: name, start, end, times: end == null ? [start] : [start, end] });

  it('hang under the scenes they fall in, and open in the Collage tool on a press', () => {
    const scenes = SCENES();
    const byKey = new Map([['sc_1', [collage('Pan', 60.2, 63.4)]], ['sc_all', [collage('Quay', 900)]]]);
    const onopencollage = vi.fn();
    const root = render(SceneTab, { scenes, collages: byKey, onopencollage });

    const lines = [...root.querySelectorAll('[data-testid="scene-collage"]')];
    expect(lines.map((el) => el.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Quay 15:00', 'Pan 1:00–1:03']);
    // each sits right under its own row
    const under = (el) => el.closest('ul').previousElementSibling.dataset.sceneKey;
    expect(lines.map(under)).toEqual(['sc_all', 'sc_1']);
    lines[1].click();
    expect(onopencollage).toHaveBeenCalledWith(expect.objectContaining({ collage: 'Pan' }));
  });

  it('adds nothing to a scene holding none', () => {
    const root = render(SceneTab, { scenes: SCENES() });
    expect(root.querySelector('.collage-lines')).toBeNull();
  });
});

describe('one scene, several moments', () => {
  const LIST = () => sceneList(
    [proof('Depot', { moments: [{ start: 130, end: 158 }], stated: true })],
    [
      { id: 'sc_a', start: 0, end: 7, label: 'Bridge', more: [{ start: 65, end: 72 }] },
      { id: 'sc_b', start: 30, end: null, label: '' },
      { id: 'sc_c', start: 300, end: 310, label: 'Mast' },
      { id: 'sc_all', start: null, end: null, label: 'which town?' },
    ],
  );
  const opened = (scenes, id, handlers = {}) => {
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    edit.begin(scenes.find((sc) => sc.key === id));
    return render(SceneTab, { scenes, edit, open: id, ...handlers });
  };
  const choices = () => [...document.querySelectorAll('[data-testid="same-place-choice"]')];

  it('writes every moment on the closed row, as a proof holding several does', () => {
    const row = rows(render(SceneTab, { scenes: LIST() })).find((r) => r.dataset.sceneKey === 'sc_a');
    expect([row.querySelector('.row-title').textContent, row.querySelector('.row-when').textContent])
      .toEqual(['Bridge', '2 passages · 0:00–0:07 · 1:05–1:12']);
  });

  it('opens on a line per moment, each with a way to take it off, and offers another', () => {
    const onaddmoment = vi.fn();
    const root = opened(LIST(), 'sc_a', { onaddmoment, onjoin: vi.fn() });
    const moments = [...root.querySelectorAll('[data-testid="scene-moment"]')];
    expect(moments.map((m) => m.querySelector('input').value)).toEqual(['0:00', '1:05']);
    expect(moments.every((m) => m.querySelector('[aria-label="Remove this passage"]'))).toBe(true);
    button(root, 'Another passage').click();
    expect(onaddmoment).toHaveBeenCalled();
  });

  it('lists the clip’s other scenes still to prove under Same place as…, each in its colour with its time, and joins the one picked', () => {
    const onjoin = vi.fn();
    const scenes = LIST();
    const root = opened(scenes, 'sc_b', { onaddmoment: vi.fn(), onjoin });
    const open = button(root, 'Same place as…');
    expect(open.getAttribute('aria-expanded')).toBe('false');
    open.click();
    flushSync();
    expect(open.getAttribute('aria-expanded')).toBe('true');
    // never a proof, the whole video or the scene itself
    expect(choices().map((c) => c.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Bridge 0:00–0:07 · 1:05–1:12',
      'Mast 5:00–5:10',
    ]);
    const bridge = scenes.find((sc) => sc.key === 'sc_a');
    expect(choices()[0].getAttribute('style')).toContain(bridge.color);
    choices()[1].click();
    flushSync();
    expect(onjoin).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sc_b' }),
      expect.objectContaining({ id: 'sc_c', label: 'Mast' }),
    );
    expect(choices()).toHaveLength(0);
  });

  it('offers no Same place as… with no other scene to join, on the whole video or on a proof', () => {
    const alone = sceneList([], [{ id: 'sc_1', start: 30, end: null, label: '' }]);
    expect(button(opened(alone, 'sc_1', { onjoin: vi.fn() }), 'Same place as…')).toBeUndefined();
    expect(button(opened(LIST(), 'sc_all', { onjoin: vi.fn() }), 'Same place as…')).toBeUndefined();
    expect(button(opened(LIST(), 'proof:Depot', { onjoin: vi.fn() }), 'Same place as…')).toBeUndefined();
  });
});

describe('one place or several', () => {
  const opened = (scenes, id, handlers = {}) => {
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    edit.begin(scenes.find((sc) => sc.key === id));
    return { edit, root: render(SceneTab, { scenes, edit, open: id, ...handlers }) };
  };
  const kind = (root, name) => [...root.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === name);

  it('greys Whole video on a scene still to prove beside one holding passages, and says why on hover', () => {
    const onkind = vi.fn();
    const scenes = sceneList([], [{ id: 'sc_1', start: 60, end: null, label: '' }, { id: 'sc_2', start: 90, end: 95, label: '' }]);
    const { root } = opened(scenes, 'sc_1', { onkind });
    const whole = kind(root, 'Whole video');
    expect(whole.disabled).toBe(true);
    expect(whole.getAttribute('title')).toBe('Another scene holds passages of this video, so the whole of it is not one place');
    whole.click();
    expect(onkind).not.toHaveBeenCalled();
    expect(kind(root, 'Passage').disabled).toBe(false);
    kind(root, 'Passage').click();
    expect(onkind).toHaveBeenCalledWith('passage');
  });

  it('counts a proof\'s passages too, and offers Whole video to a scene alone', () => {
    const beside = sceneList([proof('Depot', { moments: [{ start: 130, end: 158 }], stated: true })], [{ id: 'sc_1', start: 60, end: null, label: '' }]);
    expect(kind(opened(beside, 'sc_1').root, 'Whole video').disabled).toBe(true);
    const alone = sceneList([proof('Proof 28', { at: [3.4] })], [{ id: 'sc_1', start: 60, end: null, label: '' }]);
    const whole = kind(opened(alone, 'sc_1').root, 'Whole video');
    expect(whole.disabled).toBe(false);
    expect(whole.getAttribute('title')).toBe('The whole video, with no timecode');
  });

  it('keeps Whole video on a scene about it already, and on a proof, which is an answer', () => {
    // an older case holding both kinds: its whole-video scene stays chosen and can come back
    const both = sceneList([], [{ id: 'sc_all', start: null, end: null, label: '' }, { id: 'sc_1', start: 60, end: null, label: '' }]);
    const { edit, root } = opened(both, 'sc_all');
    expect([kind(root, 'Whole video').disabled, kind(root, 'Whole video').getAttribute('aria-checked')]).toEqual([false, 'true']);
    // left for an instant before Apply, it can still come back
    edit.setKind('instant', { start: 3, end: 3.04 });
    flushSync();
    expect([kind(root, 'Whole video').disabled, kind(root, 'Instant').getAttribute('aria-checked')]).toEqual([false, 'true']);
    expect(kind(opened(SCENES(), 'proof:Depot').root, 'Whole video').disabled).toBe(false);
  });

  it('says under the passages when Another passage finds no room, and adds none', () => {
    const scenes = sceneList([], [{ id: 'sc_1', start: 880, end: 900, label: '' }]);
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    edit.begin(scenes[0]);
    const box = render(SceneTab, { scenes, edit, open: 'sc_1', onaddmoment: () => edit.another({ start: 890, end: 890.04 }) });
    button(box, 'Another passage').click();
    flushSync();
    expect(box.querySelectorAll('[data-testid="scene-moment"]')).toHaveLength(1);
    expect(box.querySelector('[role="status"]').textContent).toBe('No room here for another passage');
    expect(document.activeElement).toBe(document.body);
  });

  it('adds a stretch as long as the first, its start field in hand', () => {
    const scenes = sceneList([], [{ id: 'sc_1', start: 10, end: 14, label: '' }]);
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    edit.begin(scenes[0]);
    const root = render(SceneTab, { scenes, edit, open: 'sc_1', onaddmoment: () => edit.another({ start: 30, end: 30.04 }) });
    button(root, 'Another passage').click();
    flushSync();
    expect([field(root, 'Scene start', 1).value, field(root, 'Scene end', 1).value]).toEqual(['0:30', '0:34']);
    expect(document.activeElement).toBe(field(root, 'Scene start', 1));
    expect(root.querySelectorAll('.moment.held')).toHaveLength(1);
  });
});
