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
const { default: WordPressSettings } = await import('./WordPressSettings.svelte');

const NOTHING = { site: '', user: '', password: { set: false, hint: '' } };
const SET = { site: 'https://desk.example.org', user: 'desk', password: { set: true, hint: '…6789' } };

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
  get.mockResolvedValue({ wordpress: NOTHING });
  live = mount(WordPressSettings, { target });
  await settle();
  expect(get).toHaveBeenCalledWith('/api/publishing');
  expect(post).not.toHaveBeenCalled();
  const steps = target.querySelector('details.how');
  expect(steps.open).toBe(true);
  expect(steps.textContent).toContain('Users › Profile');
  expect(steps.textContent).toMatch(/Free: application passwords/);
  expect(steps.textContent).toContain('WordPress.com');
  expect(button('Test connection').disabled).toBe(true);
});

it('saves the address and the username when left, and the password once, never shown again', async () => {
  get.mockResolvedValue({ wordpress: NOTHING });
  put.mockImplementation(async (_, patch) => ({ ...SET, site: patch.site ?? SET.site }));
  live = mount(WordPressSettings, { target });
  await settle();
  type(field('https://example.org'), 'desk.example.org');
  await settle();
  expect(put).toHaveBeenCalledWith('/api/publishing/wordpress', { site: 'desk.example.org' });
  expect(field('https://example.org').value).toBe('desk.example.org');
  const secret = target.querySelector('input[type="password"]');
  type(secret, 'abcd EFGH 1234 ijkl MNOP 6789');
  await settle();
  expect(put).toHaveBeenLastCalledWith('/api/publishing/wordpress', { password: 'abcd EFGH 1234 ijkl MNOP 6789' });
  expect(secret.value).toBe('');
  expect(target.textContent).toContain('ending 6789');
  expect(target.querySelector('details.how').open).toBe(false);
});

it('tests the connection on its press and says who it signed in as, or why not', async () => {
  get.mockResolvedValue({ wordpress: SET });
  live = mount(WordPressSettings, { target });
  await settle();
  expect(post).not.toHaveBeenCalled();
  expect(target.textContent).toContain('Drafts go to desk.example.org as desk.');
  post.mockResolvedValue({ ok: true, name: 'Desk editor', site_name: 'Open Source Desk', detail: '' });
  button('Test connection').click();
  await settle();
  expect(post).toHaveBeenCalledWith('/api/publishing/wordpress/test');
  expect(target.textContent).toContain('Connected as Desk editor on Open Source Desk.');
  post.mockResolvedValue({ ok: false, detail: 'WordPress refused the password: make an application password in Users › Profile, then paste it here.' });
  button('Test connection').click();
  await settle();
  expect(target.querySelector('.said').dataset.state).toBe('error');
  expect(target.textContent).toContain('WordPress refused the password');
});

it('forgets the site on this computer', async () => {
  get.mockResolvedValue({ wordpress: SET });
  del.mockResolvedValue(NOTHING);
  live = mount(WordPressSettings, { target });
  await settle();
  button('Forget').click();
  await settle();
  expect(del).toHaveBeenCalledWith('/api/publishing/wordpress');
  expect(field('https://example.org').value).toBe('');
  expect(button('Forget').disabled).toBe(true);
});
