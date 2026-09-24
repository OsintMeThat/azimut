// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Reverse Search lands on Inspect's file list and leaves it for the picture that
 * was picked. Arriving with a picture another tool handed over, the tab has to
 * open on that picture rather than on the list, spend the handoff once, and say
 * when what it shows is not a file of the case.
 */

const MEDIA = [
  { path: 'media/quai.jpg', kind: 'image', title: 'Quai', source: { type: 'upload' } },
  { path: 'media/clip.mp4', kind: 'video', title: 'Convoy clip', source: { type: 'download' } },
  { path: 'media/notes.pdf', kind: 'document', title: 'Notes', source: { type: 'upload' } },
];

const get = vi.fn(async () => []);
vi.mock('../lib/api.js', () => ({ api: { get } }));
const uiState = { tool: 'reverse', reverseTarget: null };
const caseState = { current: { id: 'case-a' }, rev: 0 };
vi.mock('../lib/state.svelte.js', () => ({
  caseState,
  prefs: { reversePrefill: false },
  uiState,
  toast: vi.fn(),
}));

const { default: ReverseSearch } = await import('./ReverseSearch.svelte');

let live = null;
let target = null;

function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(ReverseSearch, { target });
  flushSync();
}

/** Mount, and let the case's media list come back. */
async function land(media = MEDIA) {
  get.mockResolvedValue(media);
  open();
  await vi.waitFor(() => expect(get).toHaveBeenCalledWith('/api/cases/case-a/media'));
  await Promise.resolve();
  flushSync();
}

const cardTitles = () => [...target.querySelectorAll('.card .title')].map((el) => el.textContent);
const buttonNamed = (text) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text);

beforeEach(() => {
  uiState.tool = 'reverse';
  uiState.reverseTarget = null;
  caseState.current = { id: 'case-a' };
  get.mockReset();
  get.mockResolvedValue([]);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:frame');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  vi.restoreAllMocks();
});

describe('a picture handed over by another tool', () => {
  it('opens on a case image and spends the handoff', () => {
    uiState.reverseTarget = { path: 'media/quai.jpg', blob: null, kind: 'image', label: 'Quai', time: null };
    open();

    expect(target.querySelector('.preview img').getAttribute('src')).toBe('/files/case-a/media/quai.jpg');
    expect(target.querySelector('.tool-header .name').textContent).toBe('Quai');
    expect(uiState.reverseTarget).toBeNull();
    expect(target.textContent).not.toContain('not saved in the case');
  });

  it('shows a frame held only in memory, and says it is not in the case', () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    uiState.reverseTarget = { path: null, blob, kind: 'image', label: 'clip.mp4 · t=12.40s', time: null };
    open();

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(target.querySelector('.preview img').getAttribute('src')).toBe('blob:frame');
    expect(target.textContent).toContain('This image is not saved in the case.');
    // Inspect is where it came from and has no path to reopen it by.
    expect(target.textContent).not.toContain('Finer control in Inspect');
  });

  it('lets the address go when the picture is discarded', () => {
    uiState.reverseTarget = {
      path: null,
      blob: new Blob(['png'], { type: 'image/png' }),
      kind: 'image',
      label: 'Frame',
      time: null,
    };
    open();

    buttonNamed('Close file').click();
    flushSync();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame');
    expect(target.querySelector('.preview')).toBeNull();
  });

  it('waits for its own tab before spending a handoff', () => {
    uiState.tool = 'media';
    uiState.reverseTarget = { path: 'media/quai.jpg', blob: null, kind: 'image', label: 'Quai', time: null };
    open();

    expect(uiState.reverseTarget).not.toBeNull();
    expect(target.querySelector('.preview')).toBeNull();
    uiState.reverseTarget = null;
  });
});

describe('the landing', () => {
  it('is the case file list, images and videos only', async () => {
    await land();

    expect(cardTitles()).toEqual(['Quai', 'Convoy clip']);
    // Reverse Search keeps no work, so nothing leads the list.
    expect(target.querySelector('h4')).toBeNull();
    expect(target.querySelector('.tool-header')).toBeNull();
  });

  it('keeps the engines one click away for a file outside the case', async () => {
    await land();

    const links = [...target.querySelectorAll('.engine-link')];
    expect(links.map((a) => a.textContent.trim())).toEqual(['Google Lens', 'Yandex', 'Bing', 'TinEye']);
    expect(links.every((a) => a.target === '_blank')).toBe(true);
  });

  it('puts a picked picture in front of the engines, and the cross goes back', async () => {
    await land();

    target.querySelector('.card').click();
    flushSync();
    expect(target.querySelector('.preview img').getAttribute('src')).toBe('/files/case-a/media/quai.jpg');
    expect(target.querySelector('.tool-header .name').textContent).toBe('Quai');
    expect(target.querySelector('.start')).toBeNull();

    buttonNamed('Close file').click();
    flushSync();
    expect(cardTitles()).toEqual(['Quai', 'Convoy clip']);
  });

  it('changes the picture from the same list, marking the one shown', async () => {
    await land();
    target.querySelector('.card').click();
    flushSync();

    buttonNamed('Change file').click();
    flushSync();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.querySelector('.card.current .title').textContent).toBe('Quai');

    [...dialog.querySelectorAll('.card')].find((c) => c.textContent.includes('Convoy clip')).click();
    flushSync();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(target.querySelector('.preview video').getAttribute('src')).toBe('/files/case-a/media/clip.mp4');
  });

  it('sends a case with nothing to search to the Media Library', async () => {
    await land([MEDIA[2]]);

    expect(target.textContent).toContain('Add an image or a video to the case to search it.');
    buttonNamed('Go to Media Library').click();
    expect(uiState.tool).toBe('media');
    expect(target.querySelectorAll('.engine-link')).toHaveLength(4);
  });

  it('still offers the engines with no case open, and asks for nothing', () => {
    caseState.current = null;
    open();

    expect(get).not.toHaveBeenCalled();
    expect(target.querySelector('.start')).toBeNull();
    expect(target.textContent).toContain('Open a case to pick one of its pictures.');
    expect(target.querySelectorAll('.engine-link')).toHaveLength(4);
  });
});
