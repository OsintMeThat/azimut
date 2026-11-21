// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const copyText = vi.fn(async () => true);
vi.mock('../../lib/clipboard.js', () => ({ copyText }));
vi.mock('../../lib/api.js', () => ({ api: { post: vi.fn() } }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams: vi.fn(), asSvg: (svg) => svg }));
const { default: GitHubLive } = await import('./GitHubLive.svelte');

const RESULT = { address: 'https://octo.github.io/articles/port-strike/', repository: 'octo/articles',
  commit: 'abcdef0'.padEnd(40, '1'), removed: 2 };

let live;
let target;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); flushSync(); };

beforeEach(() => {
  vi.clearAllMocks();
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

function show(answer, result = RESULT) {
  let release;
  const watch = vi.fn((commit, { signal }) => new Promise((resolve) => { release = () => resolve(answer); signal.addEventListener('abort', () => resolve({ state: 'stopped' })); }));
  live = mount(GitHubLive, { target, props: { result, watch } });
  return { watch, release: () => release() };
}

it('says GitHub is building the page, then Live at its address with Open and Copy link', async () => {
  const { watch, release } = show({ state: 'built' });
  await settle();
  expect(watch).toHaveBeenCalledWith(RESULT.commit, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(target.textContent).toContain('Published to octo/articles. GitHub is building the page…');
  release();
  await settle();
  const line = target.querySelector('.line.done');
  expect(line.textContent).toContain(`Live at ${RESULT.address}`);
  expect(line.querySelector('a').getAttribute('href')).toBe(RESULT.address);
  const open = [...target.querySelectorAll('a')].find((node) => node.textContent.trim() === 'Open');
  expect(open.getAttribute('target')).toBe('_blank');
  expect(open.getAttribute('rel')).toContain('noopener');
  [...target.querySelectorAll('button')].find((node) => node.textContent.includes('Copy link')).click();
  expect(copyText).toHaveBeenCalledWith(RESULT.address, { said: 'Link copied' });
  expect(target.textContent).toContain('octo/articles · commit abcdef0 · 2 earlier files removed');
});

it('says the page is published and still building when the watch runs out', async () => {
  const { release } = show({ state: 'slow' });
  await settle();
  release();
  await settle();
  expect(target.textContent).toContain('Published; GitHub is still building the page.');
  expect(target.textContent).toContain(`It goes live at ${RESULT.address} within a few minutes.`);
});

it('says GitHub could not build the page, in its words', async () => {
  const { release } = show({ state: 'errored', detail: 'Page build failed.' });
  await settle();
  release();
  await settle();
  expect(target.querySelector('[role="alert"]').textContent).toContain('Published, but GitHub could not build the page: Page build failed.');
});

it('stops watching when the dialog closes', async () => {
  const { watch } = show({ state: 'built' });
  await settle();
  const { signal } = watch.mock.calls[0][1];
  unmount(live);
  live = null;
  expect(signal.aborted).toBe(true);
});

it('lists what the publish had to say of the site under the page, and nothing when it had none', async () => {
  show({ state: 'built' }, { ...RESULT, site: { written: ['articles.json'], warnings: ['The site holds too many files for Azimut to read: its home, list, feed and sitemap were left as they were.'] } });
  await settle();
  const list = target.querySelector('ul[aria-label="To mind"]');
  expect([...list.querySelectorAll('li')].map((node) => node.textContent.trim())).toEqual(
    ['The site holds too many files for Azimut to read: its home, list, feed and sitemap were left as they were.']);
  unmount(live);
  show({ state: 'built' }, { ...RESULT, site: { written: [], warnings: [] }, edited: false });
  await settle();
  expect(target.querySelector('ul[aria-label="To mind"]')).toBeNull();
});

it('says a folder changed on GitHub was replaced only when the press had not warned of it', async () => {
  show({ state: 'built' }, { ...RESULT, edited: true, told: false, site: { warnings: ['Mind this.'] } });
  await settle();
  expect([...target.querySelectorAll('ul[aria-label="To mind"] li')].map((node) => node.textContent.trim())).toEqual(
    ['That folder had been changed on GitHub since you published it: this publish replaced it.', 'Mind this.']);
  unmount(live);
  show({ state: 'built' }, { ...RESULT, edited: true, told: true });
  await settle();
  expect(target.querySelector('ul[aria-label="To mind"]')).toBeNull();
});
