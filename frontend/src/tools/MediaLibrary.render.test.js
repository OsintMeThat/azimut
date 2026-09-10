// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The header's upkeep menu, driven the way an analyst drives it.
 *
 * `MediaLibrary.test.js` reads the source for what the tool is wired to. This
 * one presses the `⋮`, because the two failures that matter here — a row that
 * sends the other row's sweep, and a menu that closes before its row fires —
 * both read as correct wiring in the source.
 */

const ITEMS = [
  {
    path: 'media/quai.jpg',
    filename: 'quai.jpg',
    kind: 'image',
    size: 1024,
    folder: '',
    added_at: '2026-08-01T10:00:00Z',
    sha256: '1'.repeat(64),
    thumbnail: 'media/.thumbs/quai-g2.jpg',
    thumb_state: 'ready',
    enrich_state: 'ready',
  },
  {
    path: 'media/clip.mp4',
    filename: 'clip.mp4',
    kind: 'video',
    size: 2048,
    folder: '',
    added_at: '2026-08-02T10:00:00Z',
    sha256: '2'.repeat(64),
    thumbnail: null,
    thumb_state: 'failed',
    enrich_state: 'none',
  },
];

let page = { items: ITEMS, total: ITEMS.length, next_cursor: null, facets: {} };

const get = vi.fn(async (url) => {
  if (url.includes('/media/page')) return page;
  if (url.includes('/entity-types')) return [];
  return {};
});
const post = vi.fn(async () => ({ queued: 1 }));
vi.mock('../lib/api.js', () => ({
  api: { get, post, del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: Error,
}));

const toast = vi.fn();
const reloadCase = vi.fn(async () => {});
const ensureCase = vi.fn(async () => ({ id: 'case-a' }));
const uiState = { tool: 'media', focusMedia: null, composeQueue: [], inspectPath: null };
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('../components/views.fixture.svelte.js');
  return { caseState, uiState, ensureCase, reloadCase, toast, fmtCoords: (v) => String(v) };
});
vi.mock('../components/EntityDetails.svelte', async () => await import('../components/Modal.svelte'));

const { default: MediaLibrary } = await import('./MediaLibrary.svelte');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(MediaLibrary, { target });
  flushSync();
  await settle();
  return target;
}

const toggle = () => target.querySelector('.upkeep-toggle');
const menu = () => target.querySelector('.upkeep-menu');
const rows = () => [...target.querySelectorAll('.upkeep-option')];
const row = (label) => rows().find((r) => r.textContent.trim().includes(label));

async function press(element) {
  element.click();
  flushSync();
  await settle();
}

async function key(name) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  flushSync();
  await settle();
}

beforeEach(() => {
  page = { items: ITEMS, total: ITEMS.length, next_cursor: null, facets: {} };
  vi.clearAllMocks();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('the upkeep menu', () => {
  it('keeps both sweeps behind one door, and shows no bare buttons for them', async () => {
    await open();

    expect(toggle()).not.toBeNull();
    expect(menu()).toBeNull(); // closed until asked for
    const labels = [...target.querySelectorAll('.tool-header button')].map((b) =>
      b.textContent.trim()
    );
    expect(labels).not.toContain('Thumbnails');
    expect(labels).not.toContain('Enrich');
  });

  it('opens on the door and lists the two sweeps', async () => {
    await open();
    await press(toggle());

    expect(menu()).not.toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(rows().map((r) => r.textContent.trim())).toEqual([
      'Regenerate missing thumbnails',
      'Read file metadata',
    ]);
  });

  it('sends the thumbnail sweep for the whole case, not for one file', async () => {
    await open();
    await press(toggle());
    await press(row('Regenerate missing thumbnails'));

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/media/thumbnails/regenerate', {});
    expect(menu()).toBeNull(); // the menu never hangs over the request it sent
  });

  it('sends the metadata sweep', async () => {
    await open();
    await press(toggle());
    await press(row('Read file metadata'));

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/media/enrich', {});
    expect(menu()).toBeNull();
  });

  it('closes on the backdrop and on Escape, sending nothing', async () => {
    await open();

    await press(toggle());
    await press(target.querySelector('.upkeep-backdrop'));
    expect(menu()).toBeNull();

    await press(toggle());
    await key('Escape');
    expect(menu()).toBeNull();

    expect(post).not.toHaveBeenCalled();
  });

  it('leaves the door in place on a case with no media, with both rows refused', async () => {
    page = { items: [], total: 0, next_cursor: null, facets: {} };
    await open();
    await press(toggle());

    expect(toggle().disabled).toBe(false);
    expect(rows().map((r) => r.disabled)).toEqual([true, true]);
  });
});
