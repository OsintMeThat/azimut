// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const drawDiagrams = vi.fn(async () => ({ k1: '<svg/>' }));
const uiState = { tool: 'notebook', settingsTab: null };
vi.mock('../../lib/api.js', () => ({ api: { get, post, put } }));
vi.mock('../../lib/state.svelte.js', () => ({ uiState, toast: vi.fn() }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams, asSvg: (svg) => svg }));
const { default: GitHubPublish } = await import('./GitHubPublish.svelte');

const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', token: { set: true, hint: '…wxyz' } };
const PUBLISHED = { published: true, address: 'https://octo.github.io/articles/port-strike/', repository: 'octo/articles', commit: 'c'.repeat(40) };

/** The server as the dialog asks it: the site's state, the note's look and its editions. */
function serve({ github = SET, look = {}, editions = [] } = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github };
    if (path.endsWith('/look')) {
      if (look === null) throw new Error('no look');
      return { look };
    }
    if (path.endsWith('/editions')) return { editions };
    return {};
  });
  put.mockImplementation(async (path, body) => ({ look: body }));
}
const PICTURES = [
  { id: 'e_b', type: 'media', label: 'Pier at dawn', attrs: { path: 'media/pier.jpg' } },
  { id: 'e_a', type: 'capture', label: 'Harbour', attrs: { path: 'media/harbour.png' } },
  { id: 'e_v', type: 'media', label: 'A clip', attrs: { path: 'media/clip.mp4', kind: 'video' } },
];
const GITHUB_EDITION = { at: '2026-11-18T19:00:00Z', edition: 'public', format: 'github', file: 'port-strike',
  address: 'https://octo.github.io/articles/port-strike/', repository: 'octo/articles', commit: 'c'.repeat(40),
  sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64) };
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
  bound = { address: '', connected: false, problem: '', busy: false, warned: false };
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

/** The branch as the dialog holds it, its bindings read back as the dialog reads them. */
function show({ address = '', title = 'Port strike', entities = [] } = {}) {
  bound.address = address;
  const props = { caseId: 'c1', noteId: 'n1', title, entities, prepare: vi.fn(async () => {}), onaddress: vi.fn(), onlook: vi.fn(), onleave: vi.fn() };
  for (const key of ['address', 'connected', 'problem', 'busy', 'warned']) {
    Object.defineProperty(props, key, { get: () => bound[key], set: (value) => { bound[key] = value; }, enumerable: true });
  }
  live = mount(GitHubPublish, { target, props });
  return props;
}

it('makes the address of the site and a short name from the title, reaching nothing', async () => {
  serve();
  show();
  await settle();
  expect(bound.connected).toBe(true);
  expect(target.querySelector('.base').textContent).toBe('https://octo.github.io/articles/');
  expect(target.querySelector('#export-short').value).toBe('port-strike');
  expect(bound.address).toBe('https://octo.github.io/articles/port-strike/');
  expect(post).not.toHaveBeenCalled();
});

it('takes the short name the note was last given, and checks a typed one', async () => {
  serve({ github: { ...SET, site: 'https://news.example.org/' } });
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
  serve();
  post.mockImplementation(async (path) => (path.endsWith('/pdf/diagrams') ? { diagrams: [{ key: 'k1', source: 'graph LR' }] }
    : { published: true, address: 'https://octo.github.io/articles/port-strike/', repository: 'octo/articles', commit: 'c'.repeat(40) }));
  const props = show();
  await settle();
  const answer = await live.publish({ roundPov: true, changes: 'Fixed a date.', offlineMaps: true });
  expect(props.prepare).toHaveBeenCalled();
  // what the note is on the site goes with it, from its look as read
  expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/github', {
    short_name: 'port-strike', diagrams: { k1: '<svg/>' }, round_pov: true, changes: 'Fixed a date.', offline_maps: true,
    category: '', role: 'article' });
  expect(answer.published).toBe(true);
  expect(bound.busy).toBe(false);
  // the look it changed is told, for the Notebook to read it again
  expect(props.onlook).toHaveBeenCalled();
});

it('offers the press that sets up what is missing, and says when all is ready', async () => {
  serve();
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
  serve();
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
  serve({ github: NOTHING });
  const props = show();
  await settle();
  expect(bound.connected).toBe(false);
  expect(target.textContent.trim()).toBe('');
  expect(await live.publish()).toBeNull();
  await settle();
  expect(target.textContent).toContain('connect GitHub once, in Settings › Website');
  expect(target.textContent).toContain('Free: a GitHub account');
  button('Open Settings').click();
  expect(props.onleave).toHaveBeenCalled();
  expect(uiState).toMatchObject({ tool: 'settings', settingsTab: 'website' });
  expect(post).not.toHaveBeenCalled();
});

// -- what the note is on the site ----------------------------------------------------------

const publishOk = () => post.mockImplementation(async (path) => (path.endsWith('/pdf/diagrams') ? { diagrams: [] } : PUBLISHED));
const category = () => target.querySelector('#export-category');
const options = () => [...target.querySelectorAll('#export-categories option')].map((node) => node.getAttribute('value'));
const choice = (name) => [...target.querySelectorAll('[role="radiogroup"][aria-label="On the site"] [role="radio"]')].find((node) => node.textContent.trim() === name);
const typeCategory = async (value) => {
  category().value = value;
  category().dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
};

it('suggests the categories the site uses and the note\'s own, from what this machine kept, reaching nothing', async () => {
  serve({ github: { ...SET, categories: ['Conflict Watch', 'Methods & Tools'] }, look: { category: 'Harbour' } });
  show();
  await settle();
  expect(category().value).toBe('Harbour');
  expect(category().getAttribute('list')).toBe('export-categories');
  expect(options()).toEqual(['Conflict Watch', 'Methods & Tools', 'Harbour']);
  expect(category().maxLength).toBe(60);
  expect(post).not.toHaveBeenCalled();
});

it('reads the site\'s categories on a press of its own, and says what the read found', async () => {
  serve({ look: {} });
  post.mockResolvedValue({ ok: true, categories: ['Investigations', 'Conflict Watch'], warnings: ['The site holds too many files for Azimut to read.'] });
  show();
  await settle();
  expect(options()).toEqual([]);
  button('Read the site').click();
  await settle();
  expect(post).toHaveBeenCalledWith('/api/publishing/github/categories');
  expect(options()).toEqual(['Investigations', 'Conflict Watch']);
  expect(target.querySelector('#export-category-said').textContent).toContain('2 categories on the site.');
  expect(target.querySelector('#export-category-said').textContent).toContain('too many files');
});

it('shows the press that sets the site up when the read finds Pages off', async () => {
  serve();
  post.mockResolvedValue({ ok: false, needs: 'pages', detail: 'Pages is off for octo/articles.' });
  show();
  await settle();
  button('Read the site').click();
  await settle();
  expect(target.textContent).toContain('Pages is off for octo/articles.');
  expect(button('Turn on Pages')).toBeTruthy();
});

it('sends the category typed, a new one included, and none when it is emptied', async () => {
  serve({ github: { ...SET, categories: ['Conflict Watch'] }, look: { category: 'Harbour' } });
  publishOk();
  show();
  await settle();
  await typeCategory('  Port   news ');
  expect(category().value).toBe(' Port news ');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ category: 'Port news', role: 'article' });
  await typeCategory('');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ category: '' });
  await typeCategory('x'.repeat(90));
  expect(category().value).toHaveLength(60);
});

it('starts the Article or Page choice from the look, and a page needs no category or list picture', async () => {
  serve({ look: { role: 'page', category: 'Harbour' } });
  publishOk();
  show({ entities: PICTURES });
  await settle();
  expect(choice('Page').getAttribute('aria-checked')).toBe('true');
  expect(choice('Article').getAttribute('aria-checked')).toBe('false');
  expect(target.textContent).toContain('Off the list, linked from the site\'s header.');
  expect(category()).toBeNull();
  expect(target.textContent).not.toContain('Picture in the list');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ role: 'page' });
  choice('Article').click();
  await settle();
  expect(category().value).toBe('Harbour');
  expect(target.textContent).toContain('Picture in the list');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ role: 'article', category: 'Harbour' });
  for (const node of [choice('Article'), choice('Page'), category(), button('Read the site')]) expect(node.getAttribute('title')).toBeTruthy();
});

it('sends neither when the look could not be read and nothing was chosen, so the note\'s own stands', async () => {
  serve({ look: null });
  publishOk();
  show();
  await settle();
  await live.publish();
  const body = post.mock.calls.at(-1)[1];
  expect('category' in body || 'role' in body).toBe(false);
  // a choice made anyway is a choice
  choice('Page').click();
  await settle();
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ role: 'page' });
});

it('keeps the picture of the list in the note\'s look as it is picked, clears it, and tells the look changed', async () => {
  serve({ look: { style: 'report', list_image: 'e_a' } });
  const props = show({ entities: PICTURES });
  await settle();
  const pick = () => target.querySelector('button.pick');
  expect(pick().textContent.trim()).toBe('Harbour');
  expect(pick().getAttribute('title')).toBeTruthy();
  pick().click();
  await settle();
  // photographs and captures of the case, not its clips
  expect([...target.querySelectorAll('.picture-row')].map((node) => node.textContent.trim())).toEqual(['Harbour', 'Pier at dawn']);
  [...target.querySelectorAll('.picture-row')][1].click();
  await settle();
  expect(put).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/look', expect.objectContaining({ style: 'report', list_image: 'e_b' }));
  expect(pick().textContent.trim()).toBe('Pier at dawn');
  expect(props.onlook).toHaveBeenCalledTimes(1);
  target.querySelector('button[aria-label="Use the cover picture"]').click();
  await settle();
  expect('list_image' in put.mock.calls.at(-1)[1]).toBe(false);
  expect(pick().textContent.trim()).toBe('The cover picture');
  expect(target.querySelector('button[aria-label="Use the cover picture"]')).toBeNull();
  expect(props.onlook).toHaveBeenCalledTimes(2);
});

it('says a picture was not kept, and shows the one it was', async () => {
  serve({ look: { list_image: 'e_a' } });
  const props = show({ entities: PICTURES });
  await settle();
  put.mockRejectedValue(new Error('That picture is not in the case.'));
  target.querySelector('button.pick').click();
  await settle();
  [...target.querySelectorAll('.picture-row')][1].click();
  await settle();
  expect(target.querySelector('button.pick').textContent.trim()).toBe('Harbour');
  expect(props.onlook).not.toHaveBeenCalled();
});

// -- before it replaces a folder -----------------------------------------------------------

const checks = () => post.mock.calls.filter(([path]) => path.endsWith('/github/check'));
const publishes = () => post.mock.calls.filter(([path]) => path.endsWith('/n1/github'));

it('warns when the folder was changed on GitHub since this Azimut published it, and publishes anyway on the next press', async () => {
  serve({ editions: [GITHUB_EDITION] });
  post.mockImplementation(async (path) => {
    if (path.endsWith('/github/check')) return { checked: true, exists: true, edited: true, warning: 'This folder was changed on GitHub since you published it: publishing replaces it.' };
    return path.endsWith('/pdf/diagrams') ? { diagrams: [] } : PUBLISHED;
  });
  show();
  await settle();
  expect(await live.publish()).toBeNull();
  await settle();
  expect(checks()).toEqual([['/api/cases/c1/notes/n1/github/check', { short_name: 'port-strike' }]]);
  expect(publishes()).toEqual([]);
  expect(bound.warned).toBe(true);
  expect(bound.busy).toBe(false);
  expect(target.querySelector('[role="alert"]').textContent).toContain('This folder was changed on GitHub since you published it: publishing replaces it.');
  // one more press: published, the check not asked again, and the answer says the analyst was told
  const answer = await live.publish();
  await settle();
  expect(answer).toMatchObject({ published: true, told: true });
  expect(checks()).toHaveLength(1);
  expect(publishes()).toHaveLength(1);
  expect(bound.warned).toBe(false);
});

it('lets the analyst stop at the warning, and asks again for another short name', async () => {
  serve({ editions: [GITHUB_EDITION] });
  post.mockImplementation(async (path) => (path.endsWith('/github/check')
    ? { checked: true, exists: true, edited: true, warning: '' } : { diagrams: [] }));
  show();
  await settle();
  await live.publish();
  await settle();
  expect(bound.warned).toBe(true);
  button("Don't publish").click();
  await settle();
  expect(bound.warned).toBe(false);
  expect(target.querySelector('[role="alert"]')).toBeNull();
  expect(publishes()).toEqual([]);
  // the warning is about the folder the short name names: another name starts over
  await live.publish();
  await settle();
  expect(bound.warned).toBe(true);
  const input = target.querySelector('#export-short');
  input.value = 'port-strike-2';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  expect(bound.warned).toBe(false);
  expect(publishes()).toEqual([]);
});

it('publishes with no warning when the folder is as this Azimut left it, or the note was never published there', async () => {
  serve({ editions: [GITHUB_EDITION] });
  post.mockImplementation(async (path) => {
    if (path.endsWith('/github/check')) return { checked: true, exists: true, edited: false, warning: '' };
    return path.endsWith('/pdf/diagrams') ? { diagrams: [] } : PUBLISHED;
  });
  show();
  await settle();
  expect((await live.publish()).published).toBe(true);
  expect(checks()).toHaveLength(1);
  expect(bound.warned).toBe(false);
  unmount(live);
  live = null;
  vi.clearAllMocks();
  // a note with no page of its own on GitHub has nothing to be changed: the press asks nothing first
  serve({ editions: [{ ...GITHUB_EDITION, format: 'web' }] });
  publishOk();
  show();
  await settle();
  expect((await live.publish()).published).toBe(true);
  expect(checks()).toEqual([]);
});

it('publishes anyway when the check itself fails', async () => {
  serve({ editions: [GITHUB_EDITION] });
  post.mockImplementation(async (path) => {
    if (path.endsWith('/github/check')) throw new Error('GitHub did not answer.');
    return path.endsWith('/pdf/diagrams') ? { diagrams: [] } : PUBLISHED;
  });
  show();
  await settle();
  expect((await live.publish()).published).toBe(true);
  expect(bound.warned).toBe(false);
  expect(target.querySelector('[role="alert"]')).toBeNull();
});

it('publishes when the editions cannot be read, as with a check that fails', async () => {
  serve();
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github: SET };
    if (path.endsWith('/editions')) throw new Error('offline');
    return { look: {} };
  });
  publishOk();
  show();
  await settle();
  expect((await live.publish()).published).toBe(true);
  expect(checks()).toEqual([]);
});
