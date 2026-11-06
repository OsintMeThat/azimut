// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ScenePanel from './ScenePanel.svelte';
import SceneButton from './SceneButton.svelte';
import { sceneList } from '../../lib/scenes.js';
import { SceneEdit } from '../../lib/sceneEdit.svelte.js';

/**
 * The scenes of a clip, used the way an analyst uses them: the button on the
 * player's row counts them and opens their drawer, which plays, names, ends and
 * removes each one, opens a proved one's proof, and changes any scene's time.
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

describe('the scenes button', () => {
  it('counts the scenes, marked when some are still to prove, and says whether the drawer is open', () => {
    const onclick = vi.fn();
    const root = render(SceneButton, { scenes: SCENES(), open: true, onclick });
    const btn = root.querySelector('.scenes-btn');
    expect(root.querySelector('.count').textContent).toBe('5');
    expect(root.querySelector('.count').classList.contains('todo')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(onclick).toHaveBeenCalled();
    expect(render(SceneButton, { scenes: [] }).querySelector('.count')).toBeNull();
  });
});

describe('the scenes drawer', () => {
  it('opens on a word about what to do when the clip has none', () => {
    const root = render(ScenePanel, { scenes: [] });
    expect(root.textContent).toContain('Press S where something happens to geolocate');
  });

  it('lists every scene in clip order with its time, the whole video first', () => {
    const list = rows(render(ScenePanel, { scenes: SCENES() }));
    expect(list.map((r) => r.querySelector('.time').textContent.trim())).toEqual([
      'Whole video', 'Whole video', '1:00', '2:10–2:38', '3:20–3:35 +2',
    ]);
    expect(list[1].textContent).toContain('Proved');
    expect(list[3].textContent).toContain('2 places');
    expect(list[2].querySelector('input').placeholder).toBe('What to find here');
    // nothing to end on a scene about the whole video
    expect(button(list[0], 'End here')).toBeUndefined();
    expect(button(list[2], 'End here')).toBeDefined();
  });

  it('plays a passage on a loop from its own button', () => {
    const onplay = vi.fn();
    const list = rows(render(ScenePanel, { scenes: SCENES(), onplay }));
    expect(list[2].querySelector('button.go')).toBeNull();
    list[4].querySelector('button.go').click();
    expect(onplay).toHaveBeenCalledWith(expect.objectContaining({ proof: 'Crossroads' }));
  });

  it('names, ends and removes a scene still to prove, adds one, and closes', () => {
    const handlers = { onlabel: vi.fn(), onend: vi.fn(), onremove: vi.fn(), onadd: vi.fn(), onclose: vi.fn() };
    const root = render(ScenePanel, { scenes: SCENES(), ...handlers });
    const row = rows(root)[2];
    type(row.querySelector('input'), 'Bridge?');
    expect(handlers.onlabel).toHaveBeenCalledWith('sc_1', 'Bridge?');
    button(row, 'End here').click();
    expect(handlers.onend).toHaveBeenCalledWith('sc_1');
    row.querySelector('[aria-label="Remove scene"]').click();
    expect(handlers.onremove).toHaveBeenCalledWith('sc_1');
    [...root.querySelectorAll('button')].find((b) => b.textContent.includes('Scene here')).click();
    expect(handlers.onadd).toHaveBeenCalled();
    root.querySelector('[aria-label="Close the scenes"]').click();
    expect(handlers.onclose).toHaveBeenCalled();
  });

  it('opens a proved scene\'s proof, and offers nothing to remove it', () => {
    const onopenproof = vi.fn();
    const list = rows(render(ScenePanel, { scenes: SCENES(), onopenproof }));
    list[3].querySelector('.proof').click();
    expect(onopenproof).toHaveBeenCalledWith(expect.objectContaining({ proof: 'Depot' }));
    expect(list[3].querySelector('[aria-label="Remove scene"]')).toBeNull();
  });
});

describe('changing a scene\'s time in its row', () => {
  /** The drawer with a real edit behind it, opened the way the tool opens one. */
  function editing(scenes = SCENES(), handlers = {}) {
    const edit = new SceneEdit(() => ({ duration: 900, fps: 25 }));
    const props = {
      scenes,
      edit,
      onedit: vi.fn((sc) => edit.begin(sc)),
      onhere: vi.fn(),
      onkind: vi.fn((kind) => edit.setKind(kind, { start: 0, end: 0.04 })),
      onnudge: vi.fn(),
      onaddmoment: vi.fn(() => edit.add(600)),
      onapply: vi.fn(),
      oncancel: vi.fn(() => edit.close()),
      onleave: vi.fn(() => edit.close()),
      ...handlers,
    };
    const root = render(ScenePanel, props);
    return { edit, props, root, open: (i) => { rows(root)[i].querySelector('.time').click(); flushSync(); } };
  }

  it('opens a scene\'s time in its row, on the start, ready to be typed over', () => {
    const { props, root, open } = editing();
    open(2);
    expect(props.onedit).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc_1' }));
    const row = rows(root)[2];
    expect(row.querySelector('.editor')).not.toBeNull();
    expect(field(root, 'Scene start').value).toBe('1:00');
    expect(document.activeElement).toBe(field(root, 'Scene start'));
    expect(field(root, 'Scene end')).toBeNull();
    expect(row.querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Instant');
    // End here gives way to the editor's own End, and a draft holds one moment
    expect(button(row, 'End here')).toBeUndefined();
    expect(button(row, 'Another moment')).toBeUndefined();
  });

  it('opens a scene about the whole video on just that, and gives it a moment on a choice', () => {
    const { root, open } = editing();
    open(1);
    const row = rows(root)[1];
    expect(row.querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Whole video');
    expect(field(root, 'Scene start')).toBeNull();
    expect(row.textContent).toContain('No timecode, the scene is about the whole video. Its frames stay pinned on the bar');
    button(row, 'Instant').click();
    flushSync();
    expect(field(root, 'Scene start').value).toBe('0:00');
  });

  it('reads what is typed, says what is wrong, and only applies a real time', () => {
    const { edit, props, root, open } = editing();
    open(2);
    type(field(root, 'Scene start'), '1:05,5');
    expect(edit.start).toBeCloseTo(65.52, 6); // the nearest frame at 25 fps
    expect(root.querySelector('.problem')).toBeNull();

    type(field(root, 'Scene start'), 'soon');
    expect(root.querySelector('.problem').textContent).toBe('Type a time, like 1:05 or 65');
    expect(field(root, 'Scene start').getAttribute('aria-invalid')).toBe('true');
    expect(button(root, 'Apply').disabled).toBe(true);

    type(field(root, 'Scene start'), '2:00');
    button(root, 'Passage').click();
    flushSync();
    expect(field(root, 'Scene end').value).toBe('2:05');
    type(field(root, 'Scene end'), '1:30');
    expect(root.querySelector('.problem').textContent).toBe('The end must come after the start');
    type(field(root, 'Scene end'), '2:12');
    key(field(root, 'Scene end'), 'Enter');
    expect(props.onapply).toHaveBeenCalledTimes(1);
    button(root, 'Apply').click();
    expect(props.onapply).toHaveBeenCalledTimes(2);
  });

  it('takes either end from the frame on screen, nudges it with the arrows, and drops it with Escape', () => {
    const { props, root, open } = editing();
    open(3);
    expect(field(root, 'Scene start').value).toBe('2:10');
    expect(field(root, 'Scene end').value).toBe('2:38');
    const [startHere, endHere] = [...root.querySelectorAll('.here')];
    startHere.click();
    endHere.click();
    expect(props.onhere.mock.calls).toEqual([['start', 0], ['end', 0]]);
    key(field(root, 'Scene end'), 'ArrowUp');
    key(field(root, 'Scene start'), 'ArrowDown', { shiftKey: true });
    expect(props.onnudge.mock.calls).toEqual([['end', 1, false, 0], ['start', -1, true, 0]]);
    key(field(root, 'Scene start'), 'Escape');
    expect(props.oncancel).toHaveBeenCalledTimes(1);
  });

  it('gives a proof one line per moment, another on demand, and lets one go', () => {
    const { edit, props, root, open } = editing();
    open(4);
    expect([...root.querySelectorAll('[data-testid="scene-moment"]')]).toHaveLength(3);
    expect([0, 1, 2].map((i) => field(root, 'Scene start', i).value)).toEqual(['3:20', '6:40', '8:20']);
    // a line pressed or typed in is the moment in hand
    field(root, 'Scene start', 1).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(edit.active).toBe(1);

    button(root, 'Another moment').click();
    flushSync();
    expect(props.onaddmoment).toHaveBeenCalled();
    expect(root.querySelectorAll('[data-testid="scene-moment"]')).toHaveLength(4);
    expect(document.activeElement).toBe(field(root, 'Scene start', 3));

    root.querySelectorAll('[aria-label="Remove this moment"]')[0].click();
    flushSync();
    expect(edit.result.moments.map((m) => m.start)).toEqual([400, 500, 600]);
  });

  it('lets go of an open time when the drawer goes away, and hands the keys back to the player', () => {
    const { props, root, open } = editing();
    const player = document.createElement('div');
    document.body.append(player);
    open(2);
    expect(document.activeElement).toBe(field(root, 'Scene start'));
    player.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.activeElement).not.toBe(field(root, 'Scene start'));
    player.remove();

    unmount(live.pop());
    expect(props.onleave).toHaveBeenCalledTimes(1);
  });
});
