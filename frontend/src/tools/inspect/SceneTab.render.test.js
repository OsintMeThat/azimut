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
  it('says what to do when the clip has none', () => {
    const root = render(SceneTab, { scenes: [] });
    expect(root.textContent).toContain('Press S where a place shows');
    expect(root.textContent).toContain('Shift+S');
  });

  it('writes each closed scene\'s name, kind and time, in clip order, the whole video first', () => {
    const list = rows(render(SceneTab, { scenes: SCENES() }));
    expect(list.map((r) => [r.querySelector('.row-title').textContent, r.querySelector('.row-when')?.textContent ?? null])).toEqual([
      ['which town?', 'Whole video'],
      ['Proof 28', 'Whole video'],
      // a scene with no name goes by its time
      ['Instant · 1:00', null],
      ['Depot', 'Passage · 2:10–2:38'],
      ['Crossroads', '3 moments · 3:20–3:35 +2'],
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
    expect(button(open[0], 'Another moment')).toBeUndefined();
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
    const { root } = opened(scenes, 'sc_all');
    const list = rows(root);
    const state = (row) => row.querySelector('[data-testid="scene-state"]');
    expect(state(list[0]).textContent).toContain('Geolocating · 1 capture');
    expect(state(list[0]).getAttribute('title')).toBe('Being geolocated: every capture filed now is gathered for it');
    expect(list[0].classList.contains('active')).toBe(true);
    const stop = list[0].querySelector('.locate');
    expect(stop.textContent.trim()).toBe('Stop');
    expect(stop.getAttribute('aria-pressed')).toBe('true');
    expect(stop.getAttribute('title')).toBe('Stop geolocating it; its captures stay');
    // closed, it still says so
    expect(state(list[2]).textContent).toContain('In progress · 2 captures');
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
    button(row, 'Another moment').click();
    expect(onaddmoment).toHaveBeenCalled();
  });

  it('says a proof about the whole video keeps its frames pinned', () => {
    const { root } = opened(SCENES(), 'proof:Proof 28');
    expect(root.textContent).toContain('No timecode, the scene is about the whole video. Its frames stay pinned on the bar');
  });

  it('gives the field Another moment just added the keys, and no other', async () => {
    const scenes = SCENES();
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    edit.begin(scenes.find((sc) => sc.key === 'proof:Crossroads'));
    const onaddmoment = () => edit.add(600);
    const root = render(SceneTab, { scenes, edit, open: 'proof:Crossroads', onaddmoment });
    expect(document.activeElement).toBe(document.body);
    button(root, 'Another moment').click();
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

  it('brings a scene asked for into view, unfolding its group when it was abandoned', async () => {
    const root = render(SceneTab, { scenes: abandoned(SCENES(), 'sc_1', ''), focus: { key: 'sc_1', n: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(button(root, 'Abandoned (1)').getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-testid="scene-row-abandoned"]').classList.contains('lit')).toBe(true);
  });

  it('keeps the word about S off a clip holding only abandoned scenes', () => {
    const one = sceneList([], [{ id: 'sc_1', start: 60, end: null, label: '' }]);
    const root = render(SceneTab, { scenes: abandoned(one, 'sc_1', '') });
    expect(root.textContent).not.toContain('Press S where a place shows');
    expect(button(root, 'Abandoned (1)')).toBeDefined();
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
    expect(row.querySelector('[data-testid="scene-state"]').textContent).toContain('To geolocate');
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
    expect(row.querySelector('[data-testid="scene-state"]').textContent).toContain('Geolocating · 1 capture');
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
