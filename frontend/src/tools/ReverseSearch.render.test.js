// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Arriving in Reverse Search with a picture another tool handed over. The tab has
 * to open on that picture rather than on the empty picker, spend the handoff once,
 * and say when what it shows is not a file of the case.
 */

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(async () => []) } }));
const uiState = { tool: 'reverse', reverseTarget: null };
vi.mock('../lib/state.svelte.js', () => ({
  caseState: { current: { id: 'case-a' } },
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

beforeEach(() => {
  uiState.tool = 'reverse';
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
    expect(target.querySelector('.preview-bar .name').textContent).toBe('Quai');
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

    [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Discard')).click();
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
