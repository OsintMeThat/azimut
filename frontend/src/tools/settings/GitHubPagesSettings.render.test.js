// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const toast = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post, put, del } }));
vi.mock('../../lib/state.svelte.js', () => ({ toast }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams: vi.fn(), asSvg: (svg) => svg }));
const { default: GitHubPagesSettings } = await import('./GitHubPagesSettings.svelte');

const NOTHING = { account: '', repo: 'articles', branch: 'main', site: '', token: { set: false, hint: '' } };
const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', token: { set: true, hint: '…wxyz' } };
const TOKEN = `github_pat_${'x'.repeat(70)}wxyz`;

let live;
let target;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));
const field = (placeholder) => target.querySelector(`input[placeholder^="${placeholder}"]`);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

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

it('reads the site from this machine only, and opens the steps while nothing is set', async () => {
  get.mockResolvedValue({ github: NOTHING });
  live = mount(GitHubPagesSettings, { target });
  await settle();
  expect(get).toHaveBeenCalledWith('/api/publishing');
  expect(post).not.toHaveBeenCalled();
  const steps = target.querySelector('details.how');
  expect(steps.open).toBe(true);
  for (const said of ['Free: a GitHub account', 'Only select repositories', 'Contents and Pages', 'public', 'New repository']) {
    expect(steps.textContent, said).toContain(said);
  }
  const link = [...steps.querySelectorAll('a')].find((node) => node.textContent.includes('Make the token'));
  expect(link.getAttribute('href')).toContain('contents=write');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(button('Test connection').disabled).toBe(true);
});

it('saves each name when left, and the token once, never shown again', async () => {
  get.mockResolvedValue({ github: NOTHING });
  put.mockImplementation(async (_, patch) => ({ ...NOTHING, ...SET, ...('account' in patch ? { account: patch.account } : {}) }));
  live = mount(GitHubPagesSettings, { target });
  await settle();
  type(field('your-name'), 'octo');
  await settle();
  expect(put).toHaveBeenCalledWith('/api/publishing/github', { account: 'octo' });
  const secret = target.querySelector('input[type="password"]');
  type(secret, TOKEN);
  await settle();
  expect(put).toHaveBeenLastCalledWith('/api/publishing/github', { token: TOKEN });
  expect(secret.value).toBe('');
  expect(target.textContent).toContain('ending wxyz');
  expect(target.textContent).not.toContain(TOKEN);
  expect(target.textContent).toContain('Articles go to https://octo.github.io/articles/short-name/');
  expect(target.querySelector('details.how').open).toBe(false);
});

it('tests on its press, says who and where, and what to mind', async () => {
  get.mockResolvedValue({ github: SET });
  live = mount(GitHubPagesSettings, { target });
  await settle();
  expect(post).not.toHaveBeenCalled();
  post.mockResolvedValue({ ok: true, login: 'octo', base: 'https://octo.github.io/articles/',
    warnings: ['The repository is private, but its Pages site is public.'] });
  button('Test connection').click();
  await settle();
  expect(post).toHaveBeenCalledWith('/api/publishing/github/test');
  expect(target.textContent).toContain('Signed in as octo. octo/articles is served at https://octo.github.io/articles/');
  expect(target.querySelector('[aria-label="To mind"]').textContent).toContain('Pages site is public');
});

it('offers to make the repository when the test found none, and tests again once made', async () => {
  get.mockResolvedValue({ github: SET });
  live = mount(GitHubPagesSettings, { target });
  await settle();
  post.mockResolvedValueOnce({ ok: false, login: 'octo', needs: 'repository',
    detail: 'There is no repository octo/articles that this token can reach.' });
  button('Test connection').click();
  await settle();
  expect(target.textContent).toContain('Makes a public repository under your account');
  post.mockResolvedValueOnce({ ok: false, detail: 'This token may not make repositories: make it on github.com, then let the token reach it.', manual: true });
  button('Create the repository').click();
  await settle();
  expect(post).toHaveBeenLastCalledWith('/api/publishing/github/repository');
  expect(target.querySelector('[role="alert"]').textContent).toContain('This token may not make repositories');
  const way = [...target.querySelectorAll('a')].find((node) => node.textContent.includes('New repository on github.com'));
  expect(way.getAttribute('href')).toBe('https://github.com/new?name=articles&visibility=public&owner=octo');
  post.mockResolvedValueOnce({ ok: true, repository: 'octo/articles' })
    .mockResolvedValueOnce({ ok: false, login: 'octo', needs: 'pages', detail: 'Pages is off for octo/articles.' });
  button('Create the repository').click();
  await settle();
  expect(post).toHaveBeenLastCalledWith('/api/publishing/github/test');
  expect(button('Turn on Pages')).toBeTruthy();
});

it('forgets the account and the token on this computer', async () => {
  get.mockResolvedValue({ github: SET });
  del.mockResolvedValue(NOTHING);
  live = mount(GitHubPagesSettings, { target });
  await settle();
  button('Forget').click();
  await settle();
  expect(del).toHaveBeenCalledWith('/api/publishing/github');
  expect(field('your-name').value).toBe('');
  expect(button('Forget').disabled).toBe(true);
});

it('says it is set up once an account and a token are kept, and not before', async () => {
  get.mockResolvedValue({ github: NOTHING });
  live = mount(GitHubPagesSettings, { target });
  await settle();
  expect(target.querySelector('h3 .badge')).toBeNull();
  unmount(live);
  get.mockResolvedValue({ github: SET });
  live = mount(GitHubPagesSettings, { target });
  await settle();
  expect(target.querySelector('h3 .badge').textContent).toBe('Set up');
});
