// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn(async (path) => (path.startsWith('/api/cases/') ? { id: path.split('/').pop() } : []));
const post = vi.fn(async () => ({ id: 'harbour' }));
vi.mock('../lib/api.js', () => ({ api: { get, post } }));
const { caseState, openCase, promoteCase } = await import('../lib/state.svelte.js');
const { holdsUnsaved } = await import('../lib/backButton.js');
const { default: CaseChangeGuard } = await import('./CaseChangeGuard.svelte');

let live;
let stopHolding;
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}
const click = (label) => [...document.querySelectorAll('button')].find((button) => button.textContent === label).click();

beforeEach(() => {
  get.mockClear();
  post.mockClear();
  caseState.current = { id: 'case-a' };
  live = mount(CaseChangeGuard, { target: document.body });
});
afterEach(() => {
  if (live) unmount(live);
  stopHolding?.();
  stopHolding = null;
  document.body.innerHTML = '';
});

describe('case changes from any entry point', () => {
  it('opens directly when the mounted tools hold no unsaved work', async () => {
    await openCase('case-b');
    expect(caseState.current.id).toBe('case-b');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('cancels without reading another case or clearing queued work', async () => {
    stopHolding = holdsUnsaved('proof', () => true);
    const opening = openCase('case-b');
    await settle();
    expect(document.activeElement.textContent).toBe('Keep editing');
    click('Keep editing');
    await opening;
    expect(get).not.toHaveBeenCalled();
    expect(caseState.current.id).toBe('case-a');
    expect(caseState.loading).toBe(false);
  });

  it('opens after explicit confirmation', async () => {
    stopHolding = holdsUnsaved('post', () => true);
    const opening = openCase('case-b');
    await settle();
    click('Change case');
    await opening;
    expect(caseState.current.id).toBe('case-b');
  });

  it('supersedes an older question when a newer case is requested', async () => {
    stopHolding = holdsUnsaved('proof', () => true);
    const older = openCase('case-b');
    await settle();
    const newer = openCase('case-c');
    await settle();
    click('Change case');
    await Promise.all([older, newer]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(caseState.current.id).toBe('case-c');
  });

  it('settles a pending switch on teardown and unregisters the guard', async () => {
    stopHolding = holdsUnsaved('proof', () => true);
    const opening = openCase('case-b');
    await settle();
    unmount(live);
    live = null;
    await opening;
    expect(caseState.current.id).toBe('case-a');
    await openCase('case-c');
    expect(caseState.current.id).toBe('case-c');
  });
});

describe('keeping a scratch session as a case', () => {
  it('asks in its own words before the session moves, and keeps it on Keep editing', async () => {
    caseState.current = { id: 'scratch_a', scratch: true };
    stopHolding = holdsUnsaved('post', () => true);
    const promoting = promoteCase('Harbour');
    await settle();
    expect(document.querySelector('[role="alertdialog"]').textContent).toContain('Keep this session as a case?');
    click('Keep editing');
    expect(await promoting).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(caseState.current.id).toBe('scratch_a');
  });

  it('opens the kept case without asking a second time', async () => {
    caseState.current = { id: 'scratch_a', scratch: true };
    stopHolding = holdsUnsaved('post', () => true);
    const promoting = promoteCase('Harbour');
    await settle();
    click('Keep as case');
    await promoting;
    await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/scratch_a/promote', { name: 'Harbour' });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(caseState.current.id).toBe('harbour');
  });
});
