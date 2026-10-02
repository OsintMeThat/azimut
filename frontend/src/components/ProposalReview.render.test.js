// @vitest-environment happy-dom
/**
 * The review of the links the case proposed by itself: a pass on a press, one line per
 * proposal, and Confirm or Drop on each, which is the whole of what it does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn(async () => ({}));
const del = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get, post, patch, del } }));

const toast = vi.fn();
const reloadCase = vi.fn(async () => {});
const uiState = { openGraphEntity: null };
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('./views.fixture.svelte.js');
  return { caseState, toast, uiState, reloadCase };
});

const { default: ProposalReview } = await import('./ProposalReview.svelte');

const NONE = {
  pending: { accounts: 0, posted: 0, sites: 0 }, items: [], listed: 0, radius: 300, through: null,
};
const ITEMS = [
  {
    id: 'l_post', type: 'posted',
    from: { id: 'e_acc', label: '@BashaReport', type: 'account' },
    to: { id: 'e_clip', label: 'clip.mp4', type: 'media' },
  },
  {
    id: 'l_site', type: 'same-site-as', metres: 110,
    from: { id: 'e_a', label: 'Hangar', type: 'place' },
    to: { id: 'e_b', label: 'Runway', type: 'place' },
  },
];
const SOME = {
  pending: { accounts: 1, posted: 1, sites: 1 }, items: ITEMS, listed: 2, radius: 300,
  through: '2026-10-01T10:00:00Z',
};

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  flushSync();
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(ProposalReview, { target, props: { caseId: 'case-a' } });
  await settle();
}

const button = (label) =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));

beforeEach(() => {
  vi.clearAllMocks();
  uiState.openGraphEntity = null;
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('the proposed links', () => {
  it('offers a pass on a case never read, and opens on what it found', async () => {
    get.mockResolvedValue(NONE);
    post.mockResolvedValue({ filed: { accounts: 1, posted: 1, sites: 1 }, ...SOME });
    await open();

    button('Find links').click();
    await settle();

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/proposals', {});
    expect(toast).toHaveBeenCalledWith('Proposed 1 account, 1 posted link, 1 same-site link.');
    expect(reloadCase).toHaveBeenCalled();
    const lines = [...target.querySelectorAll('.say')].map((node) => node.textContent.trim());
    expect(lines).toEqual([
      '@BashaReport posted clip.mp4',
      'Hangar and Runway are one site, 110 m apart',
    ]);
  });

  it('stays out of the toolbar once the case was read and nothing waits', async () => {
    get.mockResolvedValue({ ...NONE, through: '2026-10-01T10:00:00Z' });
    await open();

    expect(target.querySelectorAll('button')).toHaveLength(0);
  });

  it('counts what waits and confirms one through the ordinary link patch', async () => {
    get.mockResolvedValue(SOME);
    await open();
    expect(button('2 proposed')).toBeDefined();

    button('2 proposed').click();
    flushSync();
    get.mockResolvedValue({ ...NONE, pending: { accounts: 0, posted: 0, sites: 1 }, items: [ITEMS[1]], listed: 1 });
    button('Confirm').click();
    await settle();

    expect(patch).toHaveBeenCalledWith('/api/cases/case-a/links/l_post', { status: 'confirmed' });
    expect(target.querySelectorAll('.say')).toHaveLength(1);
  });

  it('drops one and takes the answer the server gives back', async () => {
    get.mockResolvedValue(SOME);
    del.mockResolvedValue({ ...NONE, pending: { accounts: 0, posted: 0, sites: 1 }, items: [ITEMS[1]], listed: 1 });
    await open();
    button('2 proposed').click();
    flushSync();

    button('Drop').click();
    await settle();

    expect(del).toHaveBeenCalledWith('/api/cases/case-a/proposals/l_post');
    expect(target.querySelectorAll('.say')).toHaveLength(1);
  });

  it('shows a line in the graph when it is pressed', async () => {
    get.mockResolvedValue(SOME);
    await open();
    button('2 proposed').click();
    flushSync();

    target.querySelectorAll('.say')[1].click();

    expect(uiState.openGraphEntity).toBe('e_b');
  });
});

describe('closing the panel', () => {
  it('closes on Escape like every other panel', async () => {
    get.mockResolvedValue(SOME);
    await open();
    button('2 proposed').click();
    flushSync();
    expect(target.querySelector('[aria-label="Proposed links"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();

    expect(target.querySelector('[aria-label="Proposed links"]')).toBeNull();
  });
});
