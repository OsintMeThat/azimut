// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const drawDiagrams = vi.fn(async () => ({ k1: '<svg/>' }));
const uiState = { tool: 'notebook', settingsTab: null };
vi.mock('../../lib/api.js', () => ({ api: { get, post } }));
vi.mock('../../lib/state.svelte.js', () => ({ uiState, toast: vi.fn() }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams, asSvg: (svg) => svg }));
const { default: GitHubPublish } = await import('./GitHubPublish.svelte');

const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', token: { set: true, hint: '…wxyz' } };
const NOTHING = { account: '', repo: 'articles', branch: 'main', site: '', token: { set: false, hint: '' } };

let live;
let target;
let bound;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));

beforeEach(() => {
  vi.clearAllMocks();
  target = document.createElement('div');
  document.body.append(target);
  bound = { address: '', connected: false, problem: '', busy: false };
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

/** The branch as the dialog holds it, its bindings read back as the dialog reads them. */
function show({ address = '', title = 'Port strike' } = {}) {
  bound.address = address;
  const props = { caseId: 'c1', noteId: 'n1', title, prepare: vi.fn(async () => {}), onaddress: vi.fn(), onleave: vi.fn() };
  for (const key of ['address', 'connected', 'problem', 'busy']) {
    Object.defineProperty(props, key, { get: () => bound[key], set: (value) => { bound[key] = value; }, enumerable: true });
  }
  live = mount(GitHubPublish, { target, props });
  return props;
}

it('makes the address of the site and a short name from the title, reaching nothing', async () => {
  get.mockResolvedValue({ github: SET });
  show();
  await settle();
  expect(bound.connected).toBe(true);
  expect(target.querySelector('.base').textContent).toBe('https://octo.github.io/articles/');
  expect(target.querySelector('#export-short').value).toBe('port-strike');
  expect(bound.address).toBe('https://octo.github.io/articles/port-strike/');
  expect(post).not.toHaveBeenCalled();
});

it('takes the short name the note was last given, and checks a typed one', async () => {
  get.mockResolvedValue({ github: { ...SET, site: 'https://news.example.org/' } });
  const props = show({ address: 'https://elsewhere.example.org/x/harbour-fire/' });
  await settle();
  expect(bound.address).toBe('https://news.example.org/harbour-fire/');
  const input = target.querySelector('#export-short');
  input.value = 'Bad Name';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  expect(bound.problem).toMatch(/^A short name holds/);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  input.value = 'harbour-fire-2';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  expect(bound.problem).toBe('');
  expect(props.onaddress).toHaveBeenLastCalledWith('https://news.example.org/harbour-fire-2/');
  expect(bound.address).toBe('https://news.example.org/harbour-fire-2/');
});

it('publishes on the press and hands the answer up', async () => {
  get.mockResolvedValue({ github: SET });
  post.mockImplementation(async (path) => (path.endsWith('/pdf/diagrams') ? { diagrams: [{ key: 'k1', source: 'graph LR' }] }
    : { published: true, address: 'https://octo.github.io/articles/port-strike/', repository: 'octo/articles', commit: 'c'.repeat(40) }));
  const props = show();
  await settle();
  const answer = await live.publish({ roundPov: true, changes: 'Fixed a date.' });
  expect(props.prepare).toHaveBeenCalled();
  expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/github', {
    short_name: 'port-strike', diagrams: { k1: '<svg/>' }, round_pov: true, changes: 'Fixed a date.' });
  expect(answer.published).toBe(true);
  expect(bound.busy).toBe(false);
});

it('offers the press that sets up what is missing, and says when all is ready', async () => {
  get.mockResolvedValue({ github: SET });
  post.mockImplementation(async (path) => {
    if (path.endsWith('/pdf/diagrams')) return { diagrams: [] };
    if (path.endsWith('/github/repository')) return { ok: true, repository: 'octo/articles' };
    if (path.endsWith('/github/pages')) return { ok: true, base: 'https://octo.github.io/articles/' };
    return { published: false, needs: 'repository', detail: 'There is no repository octo/articles that this token can reach.' };
  });
  show();
  await settle();
  expect(await live.publish()).toBeNull();
  await settle();
  expect(target.textContent).toContain('There is no repository octo/articles that this token can reach.');
  button('Create the repository').click();
  await settle();
  expect(target.textContent).toContain('Pages is off for octo/articles.');
  button('Turn on Pages').click();
  await settle();
  expect(post).toHaveBeenLastCalledWith('/api/publishing/github/pages');
  expect(target.textContent).toContain('Pages is on. Press Publish to GitHub Pages.');
});

it('says what went wrong in the words GitHub gave', async () => {
  get.mockResolvedValue({ github: SET });
  post.mockImplementation(async (path) => {
    if (path.endsWith('/pdf/diagrams')) return { diagrams: [] };
    throw new Error('The token may not upload the folder\'s files: give it Contents, Read and write on this repository.');
  });
  show();
  await settle();
  expect(await live.publish()).toBeNull();
  await settle();
  expect(target.querySelector('[role="alert"]').textContent).toContain('give it Contents, Read and write');
});

it('while GitHub is not set up, a press shows the way to Settings and publishes nothing', async () => {
  get.mockResolvedValue({ github: NOTHING });
  const props = show();
  await settle();
  expect(bound.connected).toBe(false);
  expect(target.textContent.trim()).toBe('');
  expect(await live.publish()).toBeNull();
  await settle();
  expect(target.textContent).toContain('connect GitHub once, in Settings › Publishing');
  expect(target.textContent).toContain('Free: a GitHub account');
  button('Open Settings').click();
  expect(props.onleave).toHaveBeenCalled();
  expect(uiState).toMatchObject({ tool: 'settings', settingsTab: 'publishing' });
  expect(post).not.toHaveBeenCalled();
});
