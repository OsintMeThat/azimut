// @vitest-environment happy-dom
/**
 * The To-do's "To geolocate" group (ToGeolocate.svelte): the scenes no proof takes
 * up yet, by file, over the analyst's own lists. Driven the way a pointer and a
 * keyboard drive it; what is asserted is what the analyst sees and what the server
 * is asked.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { get, put, del } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get, put, del } }));
const { caseState, uiState } = await import('../../lib/state.svelte.js');
const { geolocating, sceneQueue } = await import('../../lib/geolocating.svelte.js');
const { dispatch } = await import('../../lib/events.js');
const { default: ToGeolocate } = await import('./ToGeolocate.svelte');

const VIDEO = 'media/market.mp4';
const OTHER = 'media/convoy.mp4';
const row = (id, start, end, label = '', extra = {}) => ({
  kind: 'draft', video: VIDEO, id, start, end, label, state: 'todo', captures: [], abandoned: null, ...extra,
});
const ARABIC = 'جسر فوق النهر قرب السوق القديم، والمئذنة خلفه على اليسار';

let component;
let target;
let queue;

function answerWith(next) {
  queue = next;
}

beforeEach(() => {
  Object.assign(geolocating, { caseId: null, scene: null, error: '' });
  Object.assign(sceneQueue, { caseId: null, files: null, busy: false, error: '' });
  uiState.tool = 'overview';
  uiState.inspectScene = null;
  uiState.geolocateRef = null;
  queue = { files: [], geolocating: null };
  get.mockImplementation(async (url) => {
    if (url.endsWith('/scenes/queue')) return structuredClone(queue);
    throw new Error(`unexpected ${url}`);
  });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  target?.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** Let a read land: the group reads after the turn it mounts in. */
async function settle() {
  for (let turn = 0; turn < 2; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  }
  flushSync();
}

async function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  component = mount(ToGeolocate, { target, props: { caseId: 'c1', ...props } });
  flushSync();
  await settle();
}

const section = () => target.querySelector('section[aria-label="To geolocate"]');
const rows = () => [...target.querySelectorAll('li.scene')];
const byLabel = (label) => target.querySelector(`[aria-label="${label}"]`);
const byText = (text) => [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const queueReads = () => get.mock.calls.filter(([url]) => url === '/api/cases/c1/scenes/queue').length;

it('is not there at all while the case has no scene to geolocate', async () => {
  await open();
  expect(queueReads()).toBe(1);
  expect(section()).toBeNull();
  expect(target.textContent.trim()).toBe('');
});

it('lists each file’s scenes with their time, name and state', async () => {
  answerWith({
    files: [
      {
        video: VIDEO,
        title: 'Market walk',
        scenes: [
          row('w', null, null),
          row('p', 238, 252, 'bridge?', { state: 'progress', captures: ['media/c1.png', 'media/c2.png'] }),
        ],
      },
      { video: OTHER, title: 'Convoy', scenes: [{ ...row('i', 3, null, 'Water tower'), video: OTHER }] },
    ],
    geolocating: null,
  });
  await open();
  expect(section().querySelector('h4').textContent).toBe('To geolocate 3');
  const files = [...section().querySelectorAll('.file-title')].map((el) => el.textContent.trim());
  expect(files).toEqual(['Market walk', 'Convoy']);
  const lines = rows().map((li) => [li.querySelector('.name').textContent, li.querySelector('.meta').textContent]);
  expect(lines).toEqual([
    ['Whole video', 'To geolocate'],
    ['bridge?', '3:58–4:12 · In progress · 2 captures'],
    ['Water tower', '0:03 · To geolocate'],
  ]);
  expect(rows()[1].classList.contains('progress')).toBe(true);
  expect(rows()[0].classList.contains('progress')).toBe(false);
});

it('names an unlabelled scene by its time, and reads a label in its own direction', async () => {
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('a', 61, 64), row('b', 70, null, ARABIC)] }], geolocating: null });
  await open();
  const [first, second] = rows();
  expect(first.querySelector('.name').textContent).toBe('1:01–1:04');
  expect(first.querySelector('.meta').textContent).toBe('To geolocate');
  expect(second.querySelector('.name').getAttribute('dir')).toBe('auto');
  expect(second.querySelector('.name').textContent).toBe(ARABIC);
});

it('reads a picture’s row as a picture: Whole picture, its icon, and no mark', async () => {
  const PHOTO = 'media/harbour.png';
  const picture = (id, label = '', extra = {}) => ({ ...row(id, null, null, label, extra), video: PHOTO, file_kind: 'image' });
  answerWith({
    files: [{ video: PHOTO, title: 'Harbour photo', kind: 'image', scenes: [picture('a'), picture('b', 'Harbour wall')] }],
    geolocating: null,
  });
  await open();
  const lines = rows().map((li) => [li.querySelector('.name').textContent, li.querySelector('.meta').textContent]);
  expect(lines).toEqual([
    ['Whole picture', 'To geolocate'],
    ['Harbour wall', 'Whole picture · To geolocate'],
  ]);
  // an image icon on the file's line, drawn from its path, unlike a video's
  const icon = section().querySelector('.file-title svg').innerHTML;
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', kind: 'video', scenes: [row('v', 3, null)] }], geolocating: null });
  dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settle();
  expect(section().querySelector('.file-title svg').innerHTML).not.toBe(icon);
  expect(target.querySelector('.mark')).not.toBeNull();
});

it('says what Geolocate will hold beside the map, a picture or a video', async () => {
  const PHOTO = 'media/harbour.png';
  answerWith({
    files: [
      { video: PHOTO, title: 'Harbour photo', kind: 'image', scenes: [{ ...row('a', null, null, 'Wall'), video: PHOTO, file_kind: 'image' }] },
      { video: VIDEO, title: 'Market walk', kind: 'video', scenes: [row('v', 3, null, 'Tower')] },
    ],
    geolocating: null,
  });
  await open();
  expect(byLabel('Geolocate Wall').title).toBe('Find it on the map, its picture beside it');
  expect(byLabel('Geolocate Tower').title).toBe('Find it on the map, its video beside it');
});

it('sends a picture to Satellite as a picture', async () => {
  const PHOTO = 'media/harbour.png';
  const scene = { ...row('a', null, null, 'Wall'), video: PHOTO, file_kind: 'image' };
  answerWith({ files: [{ video: PHOTO, title: 'Harbour photo', kind: 'image', scenes: [scene] }], geolocating: null });
  put.mockResolvedValue({ geolocating: { ...scene, since: 'now' } });
  await open();
  byLabel('Geolocate Wall').click();
  await settle();
  expect(uiState.geolocateRef).toMatchObject({ video: PHOTO, draft: 'a', kind: 'image' });
});

it('shows the queue a sidebar already holds up to date, with no read of its own', async () => {
  const { holdSceneCount } = await import('../../lib/geolocating.svelte.js');
  const release = holdSceneCount();
  try {
    answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?')] }], geolocating: null });
    await open();
    expect(queueReads()).toBe(1);
    const again = mount(ToGeolocate, { target, props: { caseId: 'c1' } });
    await settle();
    unmount(again);
    expect(queueReads()).toBe(1);
  } finally {
    release();
  }
});

it('marks each scene as its bar does, in the colour Inspect gives it', async () => {
  answerWith({
    files: [{ video: VIDEO, title: 'Market walk', scenes: [
      row('w', null, null, '', { order: 0 }),
      row('p', 238, 252, 'bridge?', { order: 2 }),
      row('i', 301, null, '', { order: 3 }),
    ] }],
    geolocating: null,
  });
  await open();
  const [whole, passage, instant] = rows();
  expect(whole.querySelector('.mark')).toBeNull();
  // a labelled scene marks its time; one named by its time marks its name
  const band = passage.querySelector('.meta .mark');
  expect(band.classList.contains('passage')).toBe(true);
  expect(band.style.background).toBe('var(--anno-4)');
  const pin = instant.querySelector('.name .mark');
  expect(pin.classList.contains('instant')).toBe(true);
  expect(pin.style.background).toBe('var(--anno-6)');
  expect(passage.querySelector('.meta').textContent).toBe('3:58–4:12 · To geolocate');
});

it('marks the scene being geolocated', async () => {
  const live = row('p', 238, 252, 'bridge?', { state: 'progress', captures: ['media/c1.png'] });
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('w', null, null), live] }], geolocating: live });
  await open();
  const [, marked] = rows();
  expect(marked.classList.contains('live')).toBe(true);
  expect(marked.querySelector('.meta').textContent).toBe('3:58–4:12 · Geolocating · 1 capture');
  expect(rows()[0].classList.contains('live')).toBe(false);
});

it('stops the scene in hand when its button is pressed again, the tool left where it is', async () => {
  const live = row('p', 238, 252, 'bridge?', { state: 'progress', captures: ['media/c1.png'] });
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [live] }], geolocating: live });
  del.mockResolvedValue({ ended: true });
  await open();
  const button = byLabel('Stop geolocating bridge?');
  expect(button.textContent.trim()).toBe('Stop');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  const tool = uiState.tool;
  button.click();
  await settle();
  expect(del).toHaveBeenCalledWith('/api/cases/c1/geolocating');
  expect(put).not.toHaveBeenCalled();
  expect(uiState.tool).toBe(tool);
  expect(rows()[0].classList.contains('live')).toBe(false);
  expect(byLabel('Geolocate bridge?').getAttribute('aria-pressed')).toBe('false');
});

it('geolocates a scene: the server holds it, and Satellite opens with its video', async () => {
  const scene = row('p', 238, 252, 'bridge?');
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [scene] }], geolocating: null });
  put.mockResolvedValue({ geolocating: { ...scene, since: 'now' } });
  await open();
  byLabel('Geolocate bridge?').click();
  await settle();
  expect(put).toHaveBeenCalledWith('/api/cases/c1/geolocating', { video: VIDEO, draft: 'p' });
  expect(uiState.geolocateRef).toEqual({ video: VIDEO, draft: 'p', start: 238, end: 252, label: 'bridge?', kind: 'video' });
  expect(uiState.tool).toBe('satellite');
  expect(rows()[0].classList.contains('live')).toBe(true);
});

it('says why a scene could not be geolocated, and reads the queue again', async () => {
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?')] }], geolocating: null });
  put.mockRejectedValue(new Error('a proof already geolocates that scene'));
  await open();
  const before = queueReads();
  byLabel('Geolocate bridge?').click();
  await settle();
  expect(uiState.toasts.at(-1)).toMatchObject({ message: 'a proof already geolocates that scene', kind: 'warn' });
  expect(uiState.tool).toBe('overview');
  expect(queueReads()).toBe(before + 1);
});

it('opens a scene in Inspect from its name', async () => {
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?')] }], geolocating: null });
  await open();
  rows()[0].querySelector('button.open').click();
  expect(uiState.inspectScene).toEqual({ video: VIDEO, draft: 'p' });
  expect(uiState.tool).toBe('inspect');
});

it('opens the collage a picture was exported from, rather than Inspect, from its name', async () => {
  const PICTURE = 'media/Harbour pan.png';
  const whole = row('w', null, null, '', { video: PICTURE, file_kind: 'image' });
  answerWith({
    files: [
      { video: PICTURE, title: 'Harbour pan', kind: 'image', collage: 'Harbour pan', scenes: [whole] },
      { video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?')] },
    ],
    geolocating: null,
  });
  uiState.openCollage = null;
  await open();
  const [picture, video] = rows().map((li) => li.querySelector('button.open'));
  expect(picture.title).toBe('Open the collage');
  expect(video.title).toBe('Open in Inspect');

  picture.click();
  expect(uiState.openCollage).toBe('Harbour pan');
  expect(uiState.tool).toBe('collage');
  expect(uiState.inspectScene).toBeNull();
});

it('abandons a scene with a word, or with none, and Escape keeps it', async () => {
  const scene = row('p', 238, 252, 'bridge?');
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [scene] }], geolocating: null });
  put.mockResolvedValue({ scene: { ...scene, state: 'abandoned', abandoned: { reason: 'too dark', at: 'now' } } });
  await open();

  byLabel('Abandon bridge?').click();
  await settle();
  const field = () => byLabel('Why it is abandoned');
  expect(document.activeElement).toBe(field());
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  expect(field()).toBeNull();
  expect(put).not.toHaveBeenCalled();

  byLabel('Abandon bridge?').click();
  await settle();
  field().value = '  too dark ';
  field().dispatchEvent(new Event('input', { bubbles: true }));
  answerWith({
    files: [{ video: VIDEO, title: 'Market walk', scenes: [{ ...scene, state: 'abandoned', abandoned: { reason: 'too dark', at: 'now' } }] }],
    geolocating: null,
  });
  field().closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(put).toHaveBeenCalledWith('/api/cases/c1/scenes/p/abandon', { video: VIDEO, reason: 'too dark' });
  expect(field()).toBeNull();
  // nothing left to geolocate: only the folded line of the abandoned stays
  expect(section().querySelector('h4')).toBeNull();
  expect(byText('Abandoned (1)').getAttribute('aria-expanded')).toBe('false');
  expect(rows()).toHaveLength(0);
});

it('abandons with an empty word', async () => {
  const scene = row('p', 238, 252, 'bridge?');
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [scene, row('q', 300, null)] }], geolocating: null });
  put.mockResolvedValue({ scene });
  await open();
  byLabel('Abandon bridge?').click();
  await settle();
  byLabel('Why it is abandoned').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(put).toHaveBeenCalledWith('/api/cases/c1/scenes/p/abandon', { video: VIDEO, reason: '' });
});

it('keeps the abandoned folded below, each with its word, and restores one', async () => {
  const gone = row('g', 61, 64, 'Minaret', { state: 'abandoned', abandoned: { reason: 'no landmark', at: 'then' } });
  const bare = row('h', 90, null, '', { state: 'abandoned', abandoned: { reason: '', at: 'then' } });
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?'), gone, bare] }], geolocating: null });
  del.mockResolvedValue({ scene: { ...gone, state: 'todo', abandoned: null } });
  await open();
  expect(rows()).toHaveLength(1);
  byText('Abandoned (2)').click();
  await settle();
  const left = [...target.querySelectorAll('li.gone')];
  expect(left.map((li) => li.querySelector('.meta').textContent)).toEqual(['1:01–1:04 · no landmark', 'Abandoned']);
  expect(left[0].querySelector('q').textContent).toBe('no landmark');
  expect(left[1].querySelector('.name').textContent).toBe('1:30');
  byLabel('Restore Minaret').click();
  await settle();
  expect(del).toHaveBeenCalledWith(`/api/cases/c1/scenes/g/abandon?video=${encodeURIComponent(VIDEO)}`);
});

it('lists a proof saved with no place yet among its file’s scenes: In progress, opened in Geo Proof, abandoned and restored', async () => {
  const placeless = (name, start, extra = {}) => ({
    kind: 'proof', id: `proof:${name}`, proof: name, video: VIDEO, label: name, start, end: null, state: 'progress',
    abandoned: null, captures: [], ...extra,
  });
  answerWith({ files: [
    { video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?', { order: 1 })],
      proofs: [placeless('Depot', 30, { order: 0 }), placeless('Ridge', 300, { order: 2, state: 'abandoned', abandoned: { reason: 'too far', at: 'then' } })] },
    { video: OTHER, title: 'Convoy', scenes: [], proofs: [placeless('Gate', 10, { video: OTHER, order: 0 })] },
  ], geolocating: null });
  put.mockResolvedValue({ proof: 'Depot', video: VIDEO, state: 'abandoned' });
  del.mockResolvedValue({ proof: 'Ridge', video: VIDEO, state: 'progress' });
  await open();
  // in the order the video's bar draws them, the count taking the proofs in
  expect(rows().map((li) => li.querySelector('.name').textContent)).toEqual(['Depot', 'bridge?', 'Gate']);
  expect(section().querySelector('h4 .count').textContent).toBe('3');
  const depot = rows()[0];
  expect(depot.querySelector('.meta').textContent).toContain('In progress · no place');
  expect(byLabel('Geolocate Depot')).toBeNull();

  byLabel('Open Depot').click();
  expect(uiState.openProof).toBe('Depot');
  expect(uiState.tool).toBe('proof');

  byLabel('Abandon Depot').click();
  await settle();
  const word = byLabel('Why it is abandoned');
  word.value = 'no landmark';
  word.dispatchEvent(new Event('input', { bubbles: true }));
  word.closest('form').requestSubmit();
  await settle();
  expect(put).toHaveBeenCalledWith('/api/cases/c1/proofs/Depot/abandon', { reason: 'no landmark' });

  byText('Abandoned (1)').click();
  await settle();
  byLabel('Restore Ridge').click();
  await settle();
  expect(del).toHaveBeenCalledWith('/api/cases/c1/proofs/Ridge/abandon');
});

it('gives a time of several moments its own line, so no line ends on a dot', async () => {
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [
    row('j', 0, 7, 'Road bridge', { more: [{ start: 65, end: 72 }] }),
    row('k', 30, 34, 'Square'),
  ] }], geolocating: null });
  await open();
  const [joined, single] = rows().map((li) => li.querySelector('.meta'));
  expect(joined.textContent).toBe('0:00–0:07 · 1:05–1:12To geolocate');
  expect(joined.querySelector('br')).not.toBeNull();
  expect(single.textContent).toBe('0:30–0:34 · To geolocate');
  expect(single.querySelector('br')).toBeNull();
});

it('shows a few rows and counts the rest, the one being geolocated among them', async () => {
  const scenes = [1, 2, 3, 4, 5, 6].map((n) => row(`s${n}`, n * 10, null, `Scene ${n}`));
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes }], geolocating: scenes[5] });
  await open();
  expect(rows().map((li) => li.querySelector('.name').textContent)).toEqual(['Scene 1', 'Scene 2', 'Scene 3', 'Scene 6']);
  byText('2 more').click();
  flushSync();
  expect(rows()).toHaveLength(6);
  byText('Show fewer').click();
  flushSync();
  expect(rows()).toHaveLength(4);
});

it('reads again for another case, and after a reload', async () => {
  vi.useFakeTimers();
  target = document.createElement('div');
  document.body.append(target);
  const props = $state({ caseId: 'c1' });
  component = mount(ToGeolocate, { target, props });
  flushSync();
  await vi.advanceTimersByTimeAsync(0);
  expect(get).toHaveBeenLastCalledWith('/api/cases/c1/scenes/queue');

  props.caseId = 'c2';
  flushSync();
  await vi.advanceTimersByTimeAsync(0);
  expect(get).toHaveBeenLastCalledWith('/api/cases/c2/scenes/queue');

  get.mockClear();
  caseState.rev += 1;
  flushSync();
  await vi.advanceTimersByTimeAsync(0);
  expect(get).toHaveBeenCalledTimes(1);
});

it('reads again, once, when a file’s scenes moved or something was deleted elsewhere', async () => {
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?')] }], geolocating: null });
  await open();
  get.mockClear();
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?'), row('q', 300, null, 'Minaret')] }], geolocating: null });
  // an Inspect save, a proof's time stated, a deletion: one read for the burst
  dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
  dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
  dispatch({ type: 'saved', case_id: 'c1' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await settle();
  expect(queueReads()).toBe(1);
  expect(rows()).toHaveLength(2);
});

it('folds what was unfolded when the case changes', async () => {
  const gone = row('g', 61, 64, 'Minaret', { state: 'abandoned', abandoned: { reason: '', at: 'then' } });
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?'), gone] }], geolocating: null });
  target = document.createElement('div');
  document.body.append(target);
  const props = $state({ caseId: 'c1' });
  component = mount(ToGeolocate, { target, props });
  await settle();
  byText('Abandoned (1)').click();
  byLabel('Abandon bridge?').click();
  await settle();
  expect(byLabel('Why it is abandoned')).not.toBeNull();
  props.caseId = 'c2';
  await settle();
  expect(byText('Abandoned (1)').getAttribute('aria-expanded')).toBe('false');
  expect(byLabel('Why it is abandoned')).toBeNull();
});

it('is one read for the sidebar and the Overview showing it at once', async () => {
  target = document.createElement('div');
  document.body.append(target);
  const one = mount(ToGeolocate, { target, props: { caseId: 'c1' } });
  component = mount(ToGeolocate, { target, props: { caseId: 'c1' } });
  flushSync();
  await settle();
  expect(queueReads()).toBe(1);
  unmount(one);
});

it('follows the server when it says the scene being geolocated changed', async () => {
  const scene = row('p', 238, 252, 'bridge?');
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [scene] }], geolocating: null });
  await open();
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [{ ...scene, state: 'progress', captures: ['media/c.png'] }] }], geolocating: { ...scene, captures: ['media/c.png'] } });
  dispatch({ type: 'geolocating', case_id: 'c1', video: VIDEO, draft: 'p' });
  await settle();
  expect(rows()[0].querySelector('.meta').textContent).toBe('3:58–4:12 · Geolocating · 1 capture');
});

it('says when the queue could not be read, and reads it again on Retry', async () => {
  get.mockRejectedValueOnce(new Error('offline'));
  await open();
  expect(target.querySelector('[role="alert"]').textContent).toContain('could not be read');
  answerWith({ files: [{ video: VIDEO, title: 'Market walk', scenes: [row('p', 238, 252, 'bridge?')] }], geolocating: null });
  byText('Retry').click();
  await settle();
  expect(target.querySelector('[role="alert"]')).toBeNull();
  expect(rows()).toHaveLength(1);
});
