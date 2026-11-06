// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * A reverse search is logged in the pinned note as one line, ending on "Result:" for the
 * analyst. The row is there only while a note is pinned and a picture is picked.
 */
const get = vi.fn(async (url) => (String(url).includes('/entities/lookup')
  ? { entity: { id: 'e_clip', type: 'media', label: 'Convoy clip', attrs: { path: 'media/clip.mp4' } } }
  : []));
vi.mock('../lib/api.js', () => ({ api: { get } }));
const uiState = { tool: 'reverse', reverseTarget: null };
const caseState = { current: { id: 'case-a' }, rev: 0 };
vi.mock('../lib/state.svelte.js', () => ({ caseState, prefs: { reversePrefill: false }, uiState, toast: vi.fn() }));
const { putInNote } = vi.hoisted(() => ({ putInNote: vi.fn(async () => null) }));
vi.mock('../lib/notes/putInNote.svelte.js', async (actual) => ({ ...(await actual()), putInNote }));

const { pinNote } = await import('../lib/notes/putInNote.svelte.js');
const { putsFor } = await import('../lib/noteHere.svelte.js');
const { default: ReverseSearch } = await import('./ReverseSearch.svelte');

let live = null;
let target = null;
let unpin = () => {};

function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(ReverseSearch, { target });
  flushSync();
}
const rowFor = () => target.querySelector('[data-put="reverse-log"]');

beforeEach(() => {
  uiState.tool = 'reverse';
  uiState.reverseTarget = null;
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:frame');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  unpin();
  unpin = () => {};
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('logging a reverse search in the note', () => {
  it('shows no row while no note is pinned', () => {
    uiState.reverseTarget = { path: 'media/clip.mp4', blob: null, kind: 'video', label: 'Convoy clip', time: 12.48 };
    open();
    expect(rowFor()).toBeNull();
  });

  it('names the note, and writes the frame of the video as a chip, on every engine when none was pressed', async () => {
    unpin = pinNote({ caseId: 'case-a', noteId: 'n1', title: 'Port strike', editor: {} });
    flushSync();
    uiState.reverseTarget = { path: 'media/clip.mp4', blob: null, kind: 'video', label: 'Convoy clip', time: 12.48 };
    open();
    expect(rowFor().textContent.trim()).toBe('Log this search in “Port strike”');
    const [offer] = putsFor('reverse');
    const put = await offer.put({});
    expect(put.caret).toBe(true);
    expect(put.text).toMatch(/^Reverse search, \d{1,2} \w{3} \d{4} \d{2}:\d{2} UTC: frame 00:12 of \[\[entity:e_clip\|Convoy clip\]\] on Lens, Yandex, Bing, TinEye\. Result:$/);
    expect(get).toHaveBeenCalledWith('/api/cases/case-a/entities/lookup?attr=path&value=media%2Fclip.mp4');
    rowFor().click();
    expect(putInNote).toHaveBeenCalledOnce();
    expect(putInNote.mock.calls[0][0]).toMatchObject({ id: 'reverse-log' });
  });

  it('names a frame that is not in the case by its label, with no lookup', async () => {
    unpin = pinNote({ caseId: 'case-a', noteId: 'n1', title: 'Port strike', editor: {} });
    flushSync();
    uiState.reverseTarget = { path: null, blob: new Blob(['png'], { type: 'image/png' }), kind: 'image', label: 'clip.mp4 · t=12.40s', time: null };
    open();
    const [offer] = putsFor('reverse');
    expect((await offer.put({})).text).toContain(': clip.mp4 · t=12.40s on Lens, Yandex, Bing, TinEye. Result:');
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/entities/lookup'));
  });

  it('offers nothing until a picture is picked', () => {
    unpin = pinNote({ caseId: 'case-a', noteId: 'n1', title: 'Port strike', editor: {} });
    flushSync();
    open();
    expect(rowFor()).toBeNull();
    expect(putsFor('reverse')).toEqual([]);
  });
});
