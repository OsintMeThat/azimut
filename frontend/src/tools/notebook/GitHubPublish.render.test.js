// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const drawDiagrams = vi.fn(async () => ({ k1: '<svg/>' }));
const uiState = { tool: 'notebook', settingsTab: null };
// what Settings › Website and Settings › Publishing hold of the site's name
const prefs = { siteTitle: '', reportName: '' };
vi.mock('../../lib/api.js', () => ({ api: { get, post, put } }));
vi.mock('../../lib/state.svelte.js', () => ({ uiState, prefs, toast: vi.fn() }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams, asSvg: (svg) => svg }));
const { default: GitHubPublish } = await import('./GitHubPublish.svelte');

const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', token: { set: true, hint: '…wxyz' } };
const PUBLISHED = { published: true, address: 'https://octo.github.io/articles/port-strike/', repository: 'octo/articles', commit: 'c'.repeat(40) };

/** The server as the dialog asks it: the site's state, the note's look, its editions and the point it offers. */
function serve({ github = SET, look = {}, editions = [GITHUB_EDITION], offer = null } = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github };
    if (path.endsWith('/look')) {
      if (look === null) throw new Error('no look');
      return { look };
    }
    if (path.endsWith('/editions')) return { editions };
    if (path.endsWith('/place')) return { suggested: offer };
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
  prefs.siteTitle = '';
  prefs.reportName = '';
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

/** The branch as the dialog holds it, its bindings read back as the dialog reads them. */
function show({ address = '', title = 'Port strike', entities = [] } = {}) {
  bound.address = address;
  const props = { caseId: 'c1', noteId: 'n1', title, entities, prepare: vi.fn(async () => {}), onaddress: vi.fn(), onlook: vi.fn(), onleave: vi.fn(),
    onpublish: vi.fn() };
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
    category: '', role: 'article', place: null });
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
  // only who wrote the note, which can be said with GitHub off
  expect([...target.querySelectorAll('.lbl')].map((node) => node.textContent.trim())).toEqual(['Author', 'Author picture']);
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
const categoryShown = () => category().textContent.trim();
const choice = (name) => [...target.querySelectorAll('[role="radiogroup"][aria-label="On the site"] [role="radio"]')].find((node) => node.textContent.trim() === name);
const option = (name) => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.trim() === name);
/** What the category's list holds, opened by a press and closed by another. */
const options = async () => {
  category().click();
  await settle();
  const found = [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent.trim());
  category().click();
  await settle();
  return found;
};
const pickCategory = async (name) => {
  category().click();
  await settle();
  option(name).click();
  await settle();
};
/** A new category typed in the field New category… opens, ended with Enter. */
const typeCategory = async (value) => {
  await pickCategory('New category…');
  const field = category();
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
};

it('suggests the categories the site uses and the note\'s own, from what this machine kept, reaching nothing', async () => {
  serve({ github: { ...SET, categories: ['Conflict Watch', 'Methods & Tools'] }, look: { category: 'Harbour' } });
  show();
  await settle();
  expect(categoryShown()).toBe('Harbour');
  // an app list, never the system's: none, what the site uses with the note's own, and a new one
  expect(category().tagName).toBe('BUTTON');
  expect(category().getAttribute('role')).toBe('combobox');
  expect(target.querySelector('datalist, select')).toBeNull();
  expect(await options()).toEqual(['No category', 'Conflict Watch', 'Methods & Tools', 'Harbour', 'New category…']);
  expect(post).not.toHaveBeenCalled();
});

it('reads the site\'s categories on a press of its own, and says what the read found', async () => {
  serve({ look: {} });
  post.mockResolvedValue({ ok: true, categories: ['Investigations', 'Conflict Watch'], warnings: ['The site holds too many files for Azimut to read.'] });
  show();
  await settle();
  expect(await options()).toEqual(['No category', 'New category…']);
  button('Read the site').click();
  await settle();
  expect(post).toHaveBeenCalledWith('/api/publishing/github/categories');
  expect(await options()).toEqual(['No category', 'Investigations', 'Conflict Watch', 'New category…']);
  expect(target.querySelector('#export-category-said').textContent).toContain('2 categories on the site.');
  expect(target.querySelector('#export-category-said').textContent).toContain('too many files');
});

it('says it is reading on the press, with a spinner, and is the same press again after a failure', async () => {
  serve();
  let fail;
  post.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  show();
  await settle();
  const press = button('Read the site');
  press.click();
  await settle();
  expect(press.textContent.trim()).toBe('Reading…');
  expect(press.querySelector('.busy-spin')).not.toBeNull();
  expect(press.disabled).toBe(true);
  expect(press.getAttribute('aria-busy')).toBe('true');
  fail(new Error('GitHub did not answer.'));
  await settle();
  expect(press.textContent.trim()).toBe('Read the site');
  expect(press.disabled).toBe(false);
  expect(press.querySelector('.busy-spin')).toBeNull();
  expect(target.querySelector('[role="alert"]').textContent).toContain('GitHub did not answer.');
});

it('says what it sends while it publishes, and Replace it waits with it', async () => {
  serve();
  let release;
  post.mockImplementation(async (path) => {
    if (path.endsWith('/github/check')) return TAKEN;
    if (path.endsWith('/pdf/diagrams')) return { diagrams: [] };
    return new Promise((resolve) => { release = () => resolve(PUBLISHED); });
  });
  show();
  await settle();
  await live.publish();
  await settle();
  const replace = button('Replace it');
  const publishing = live.publish();
  await settle();
  expect(bound.busy).toBe(true);
  expect(target.querySelector('.sending').textContent.trim()).toBe('Making the folder and sending it to octo/articles…');
  expect(target.querySelector('.sending .busy-spin')).not.toBeNull();
  expect(replace.textContent.trim()).toBe('Publishing…');
  expect(replace.disabled).toBe(true);
  expect(button('Pick another address').disabled).toBe(true);
  release();
  expect((await publishing).published).toBe(true);
  await settle();
  expect(bound.busy).toBe(false);
  expect(target.querySelector('.sending')).toBeNull();
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

it('sends the category picked, a new one typed included, and none when No category is picked', async () => {
  serve({ github: { ...SET, categories: ['Conflict Watch'] }, look: { category: 'Harbour' } });
  publishOk();
  show();
  await settle();
  await typeCategory('  Port   news ');
  expect(categoryShown()).toBe('Port news');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ category: 'Port news', role: 'article' });
  await pickCategory('No category');
  expect(categoryShown()).toBe('No category');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ category: '' });
  await pickCategory('Conflict Watch');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ category: 'Conflict Watch' });
  await typeCategory('x'.repeat(90));
  expect(categoryShown()).toHaveLength(60);
});

it('walks the category\'s list with the keys and picks with Enter', async () => {
  serve({ github: { ...SET, categories: ['Conflict Watch', 'Methods & Tools'] }, look: {} });
  publishOk();
  show();
  await settle();
  const key = async (name) => {
    category().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    await settle();
  };
  category().focus();
  await key('m');
  expect([...document.querySelectorAll('[role="option"]')].map((node) => node.textContent.trim())).toEqual(['Methods & Tools', 'New category…']);
  await key('Enter');
  expect(categoryShown()).toBe('Methods & Tools');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ category: 'Methods & Tools' });
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
  expect(categoryShown()).toBe('Harbour');
  expect(target.textContent).toContain('Picture in the list');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ role: 'article', category: 'Harbour' });
  for (const node of [choice('Article'), choice('Page'), category(), button('Read the site')]) expect(node.getAttribute('title')).toBeTruthy();
});

it('offers Unlisted beside Article and Page: no category or list picture, said in a line, sent as the role', async () => {
  serve({ look: { role: 'unlisted', category: 'Harbour' } });
  publishOk();
  show({ entities: PICTURES });
  await settle();
  expect(['Article', 'Page', 'Unlisted'].map((name) => choice(name) !== undefined)).toEqual([true, true, true]);
  // started from the look, which keeps unlisted as a role of its own
  expect(choice('Unlisted').getAttribute('aria-checked')).toBe('true');
  expect(target.textContent).toContain('Online at its address only, in no list, feed or sitemap.');
  expect(category()).toBeNull();
  expect(target.textContent).not.toContain('Picture in the list');
  expect(choice('Unlisted').getAttribute('title')).toBe('Put it online without listing it anywhere');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ role: 'unlisted' });
  choice('Article').click();
  await settle();
  expect(target.textContent).not.toContain('Online at its address only');
  choice('Unlisted').click();
  await settle();
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ role: 'unlisted' });
});

it('says beside the role choice that Unlisted is how a page is tried', async () => {
  serve();
  show();
  await settle();
  const line = target.querySelector('.choice-line');
  expect(line.querySelector('[role="radiogroup"]')).not.toBeNull();
  expect(line.querySelector('.choice-said').textContent).toBe('Unlisted lets you read it online before you announce it.');
});

it('starts a note never published to this site on Unlisted, and on the role it last went up with after', async () => {
  serve({ editions: [], look: {} });
  publishOk();
  show();
  await settle();
  expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/n1/editions');
  expect(choice('Unlisted').getAttribute('aria-checked')).toBe('true');
  expect(target.textContent).toContain('Online at its address only, in no list, feed or sitemap.');
  await live.publish();
  expect(publishes().at(-1)[1]).toMatchObject({ role: 'unlisted' });
  // a page published to another site is no page of this one
  unmount(live);
  live = null;
  serve({ editions: [{ ...GITHUB_EDITION, repository: 'someone/else' }, { ...GITHUB_EDITION, format: 'web' }], look: {} });
  show();
  await settle();
  expect(choice('Unlisted').getAttribute('aria-checked')).toBe('true');
  // published here before: the look's role, an article
  unmount(live);
  live = null;
  serve({ editions: [{ ...GITHUB_EDITION, repository: 'Octo/Articles' }], look: {} });
  show();
  await settle();
  expect(choice('Article').getAttribute('aria-checked')).toBe('true');
  // a page the look names stays a page, first publish or not
  unmount(live);
  live = null;
  serve({ editions: [], look: { role: 'page' } });
  show();
  await settle();
  expect(choice('Page').getAttribute('aria-checked')).toBe('true');
});

it('keeps the role picked before the editions are read, and an Article when they cannot be read', async () => {
  serve({ editions: [], look: {} });
  let answer;
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github: SET };
    if (path.endsWith('/editions')) return new Promise((resolve) => { answer = resolve; });
    if (path.endsWith('/place')) return { suggested: null };
    return { look: {} };
  });
  show();
  await settle();
  choice('Page').click();
  await settle();
  answer({ editions: [] });
  await settle();
  expect(choice('Page').getAttribute('aria-checked')).toBe('true');
  unmount(live);
  live = null;
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github: SET };
    if (path.endsWith('/editions')) throw new Error('offline');
    if (path.endsWith('/place')) return { suggested: null };
    return { look: {} };
  });
  show();
  await settle();
  expect(choice('Article').getAttribute('aria-checked')).toBe('true');
});

it('says where an article will appear, naming the site by its title, else by what it falls back to', async () => {
  serve();
  prefs.siteTitle = 'Octo Desk';
  show();
  await settle();
  expect(target.textContent).toContain('Goes on Octo Desk\'s home page and in its feed.');
  // named, there is nothing to tell about the name
  expect(target.textContent).not.toContain('has no name yet');
  expect(button('Name the site')).toBeUndefined();
  choice('Page').click();
  await settle();
  expect(target.textContent).toContain('Off the list, linked from the site\'s header.');
  expect(target.textContent).not.toContain('Goes on');
});

it('says the site has no name yet, what it shows as, and opens Settings on Identity to name it', async () => {
  serve();
  prefs.reportName = 'A. Analyst';
  const props = show();
  await settle();
  expect(target.textContent).toContain('Goes on A. Analyst\'s home page and in its feed.');
  expect(target.textContent).toContain('Your site has no name yet: it shows as A. Analyst.');
  expect(button('Name the site').getAttribute('title')).toBe('Open Settings › Website, to name the site');
  button('Name the site').click();
  expect(props.onleave).toHaveBeenCalled();
  expect(uiState).toMatchObject({ tool: 'settings', settingsTab: 'website:identity' });
  expect(post).not.toHaveBeenCalled();
});

it('falls back to the GitHub account when there is no Publishing name either', async () => {
  serve();
  show();
  await settle();
  expect(target.textContent).toContain('Your site has no name yet: it shows as octo.');
  expect(target.textContent).toContain('Goes on octo\'s home page and in its feed.');
});

it('sends neither when the look could not be read and nothing was chosen, so the note\'s own stands', async () => {
  serve({ look: null });
  publishOk();
  show();
  await settle();
  await live.publish();
  const body = post.mock.calls.at(-1)[1];
  expect('category' in body || 'role' in body || 'place' in body).toBe(false);
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
  const pick = () => target.querySelector('button[data-pick="list"]');
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
  target.querySelector('button[data-pick="list"]').click();
  await settle();
  [...target.querySelectorAll('.picture-row')][1].click();
  await settle();
  expect(target.querySelector('button[data-pick="list"]').textContent.trim()).toBe('Harbour');
  expect(props.onlook).not.toHaveBeenCalled();
});

// -- where the article stands on the site's map --------------------------------------------

const KEPT = { lat: 12.725004, lon: 43.5075, name: 'Bab al-Mandab' };
const OFFER = { lat: 12.7250041, lon: 43.5075, name: 'Bab al-Mandab', from: 'place', label: 'Bab al-Mandab' };
const coords = () => target.querySelector('#export-place');
const placeName = () => target.querySelector('#export-place-name');
const placeSaid = () => target.querySelector('#export-place-said').textContent.trim();
const offerPress = () => button('Use ');
const more = () => button('More options');
const openMore = async () => {
  if (more().getAttribute('aria-expanded') !== 'true') more().click();
  await settle();
};
const fill = async (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
};

it('folds the coordinates under More options each time it opens, with what they are for', async () => {
  serve({ offer: OFFER });
  show();
  await settle();
  expect(more().getAttribute('aria-expanded')).toBe('false');
  expect(more().getAttribute('title')).toBeTruthy();
  expect(coords()).toBeNull();
  expect(offerPress()).toBeUndefined();
  more().click();
  await settle();
  expect(more().getAttribute('aria-expanded')).toBe('true');
  const group = target.querySelector('[role="group"][aria-label="Coordinates for this article (optional)"]');
  expect(group.id).toBe(more().getAttribute('aria-controls'));
  expect(group.textContent).toContain('They show the article as a pin on the site\'s map.');
  // the offer and its rule are as they were, inside
  expect(offerPress().textContent.trim()).toBe('Use 12.7250, 43.5075 · Bab al-Mandab');
  // nothing typed says nothing more under the fields
  expect(placeSaid()).toBe('');
  more().click();
  await settle();
  expect(coords()).toBeNull();
  // opened again, it is shut once more
  unmount(live);
  live = null;
  show();
  await settle();
  expect(more().getAttribute('aria-expanded')).toBe('false');
});

it('opens More options on a place the note keeps, and keeps it open while what is typed is no place', async () => {
  serve({ look: { place: KEPT } });
  show();
  await settle();
  expect(more().getAttribute('aria-expanded')).toBe('true');
  expect(coords().value).toBe('12.725004, 43.5075');
  await fill(coords(), 'the strait');
  expect(bound.problem).not.toBe('');
  more().click();
  await settle();
  // what holds the publish back is never folded away
  expect(coords()).not.toBeNull();
  expect(more().getAttribute('aria-expanded')).toBe('true');
  await fill(coords(), '');
  more().click();
  await settle();
  expect(coords()).toBeNull();
});

it('starts the place from the look, reads what is typed, and holds the publish back while it is no place', async () => {
  serve({ look: { place: KEPT } });
  publishOk();
  show();
  await settle();
  expect(coords().value).toBe('12.725004, 43.5075');
  expect(placeName().value).toBe('Bab al-Mandab');
  expect(placeName().maxLength).toBe(80);
  expect(placeSaid()).toBe('Reads as 12.725004° N, 43.5075° E.');
  expect([coords(), placeName()].map((node) => node.getAttribute('title'))).toEqual([
    'Where this article stands on the site\'s map, pasted as lat, lon', 'The name of the place, shown on its pin']);
  // a press that changes nothing keeps it
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ place: KEPT });
  await fill(coords(), 'the strait');
  expect(placeSaid()).toBe('That does not read as a point: paste it as lat, lon, such as 12.725, 43.5075.');
  expect(coords().getAttribute('aria-invalid')).toBe('true');
  expect(bound.problem).toBe(placeSaid());
  const sent = publishes().length;
  expect(await live.publish()).toBeNull();
  expect(publishes()).toHaveLength(sent);
  await fill(coords(), '86, 43.5');
  expect(bound.problem).toBe('The latitude must be between -85 and 85, where web maps stop.');
  await fill(coords(), '33°54\'00"S 18°25\'12"E');
  expect(placeSaid()).toBe('Reads as 33.9° S, 18.42° E.');
  expect(bound.problem).toBe('');
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ place: { lat: -33.9, lon: 18.42, name: 'Bab al-Mandab' } });
  // emptied, the article has no place: the name alone is said to pin nothing
  await fill(coords(), '');
  expect(placeSaid()).toBe('A name needs coordinates: left so, the article has no pin.');
  await fill(placeName(), '');
  expect(placeSaid()).toBe('');
  await live.publish();
  expect(post.mock.calls.at(-1)[1].place).toBeNull();
});

it('offers the note\'s one point as a press, with its rule, and fills nothing until it is pressed', async () => {
  serve({ offer: OFFER });
  publishOk();
  show();
  await settle();
  await openMore();
  expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/n1/place');
  expect(coords().value).toBe('');
  expect(placeName().value).toBe('');
  expect(offerPress().textContent.trim()).toBe('Use 12.7250, 43.5075 · Bab al-Mandab');
  expect(offerPress().getAttribute('title')).toBe('Fill the place with the point this note names');
  expect(target.querySelector('.place-why').textContent).toBe('The one place the note names.');
  // not pressed, nothing is filled, nothing is kept and nothing goes up
  await live.publish();
  expect(post.mock.calls.at(-1)[1].place).toBeNull();
  expect(put).not.toHaveBeenCalled();
  offerPress().click();
  await settle();
  expect(coords().value).toBe('12.725004, 43.5075');
  expect(placeName().value).toBe('Bab al-Mandab');
  expect(offerPress()).toBeUndefined();
  await live.publish();
  expect(post.mock.calls.at(-1)[1]).toMatchObject({ place: KEPT });
  // the analyst's own name is kept when the offer is taken again
  await fill(coords(), '');
  await fill(placeName(), 'The strait');
  offerPress().click();
  await settle();
  expect(placeName().value).toBe('The strait');
  expect(coords().value).toBe('12.725004, 43.5075');
});

it('never offers over a place the note keeps, and says the rule of a map\'s offer', async () => {
  serve({ look: { place: { lat: -33.9, lon: 18.42, name: '' } }, offer: OFFER });
  show();
  await settle();
  expect(coords().value).toBe('-33.9, 18.42');
  expect(offerPress()).toBeUndefined();
  unmount(live);
  live = null;
  serve({ offer: { lat: 12.6, lon: 43.4, name: '', from: 'map', label: 'The strait' } });
  show();
  await settle();
  await openMore();
  expect(offerPress().textContent.trim()).toBe('Use 12.6000, 43.4000');
  expect(target.querySelector('.place-why').textContent).toBe('Where the note\'s one map looks.');
  // an offer the server could not read is no offer
  unmount(live);
  live = null;
  serve({ offer: { lat: 99, lon: 1, name: '', from: 'place', label: '' } });
  show();
  await settle();
  await openMore();
  expect(offerPress()).toBeUndefined();
});

it('shows a page or an unlisted page no place, sends none, and its place holds nothing back', async () => {
  serve({ look: { role: 'page', place: KEPT }, offer: OFFER });
  publishOk();
  show();
  await settle();
  expect(coords()).toBeNull();
  await live.publish();
  expect('place' in post.mock.calls.at(-1)[1]).toBe(false);
  choice('Article').click();
  await settle();
  await fill(coords(), 'nowhere');
  expect(bound.problem).not.toBe('');
  choice('Unlisted').click();
  await settle();
  expect(bound.problem).toBe('');
  expect((await live.publish()).published).toBe(true);
  expect('place' in post.mock.calls.at(-1)[1]).toBe(false);
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

it('publishes with no warning when the folder is as this Azimut left it, or nothing holds the address', async () => {
  serve({ editions: [GITHUB_EDITION] });
  post.mockImplementation(async (path) => {
    if (path.endsWith('/github/check')) return { checked: true, exists: true, edited: false, warning: '', taken: null, free: '' };
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
  // a note never published here is checked too: another note may hold its address
  serve({ editions: [{ ...GITHUB_EDITION, format: 'web' }] });
  post.mockImplementation(async (path) => {
    if (path.endsWith('/github/check')) return { checked: true, exists: false, edited: false, warning: '', taken: null, free: '' };
    return path.endsWith('/pdf/diagrams') ? { diagrams: [] } : PUBLISHED;
  });
  show();
  await settle();
  expect((await live.publish()).published).toBe(true);
  expect(checks()).toHaveLength(1);
  expect(target.querySelector('[role="alert"]')).toBeNull();
});

const TAKEN = { checked: true, exists: true, edited: false, warning: '', taken: { title: 'Harbour fire', ours: true }, free: 'port-strike-2' };
const holding = (answer) => post.mockImplementation(async (path) => {
  if (path.endsWith('/github/check')) return answer;
  return path.endsWith('/pdf/diagrams') ? { diagrams: [] } : PUBLISHED;
});

it('names what another note left at the address, and Replace it publishes over it', async () => {
  serve();
  holding(TAKEN);
  const props = show();
  await settle();
  expect(await live.publish()).toBeNull();
  await settle();
  expect(publishes()).toEqual([]);
  expect(target.querySelector('[role="alert"] p').textContent.trim()).toBe('This address already holds “Harbour fire”. Replace it?');
  expect(bound.warned).toBe(true);
  for (const name of ['Replace it', 'Pick another address']) expect(button(name).getAttribute('title')).toBeTruthy();
  button('Replace it').click();
  expect(props.onpublish).toHaveBeenCalledTimes(1);
  // the press it stands for publishes without asking again: the analyst has the last word
  const answer = await live.publish();
  await settle();
  expect(answer).toMatchObject({ published: true, told: true });
  expect(checks()).toHaveLength(1);
  expect(publishes()).toHaveLength(1);
  expect(bound.warned).toBe(false);
  expect(target.querySelector('[role="alert"]')).toBeNull();
});

it('Pick another address puts a free short name in the field and the focus on it', async () => {
  serve();
  holding(TAKEN);
  const props = show();
  await settle();
  await live.publish();
  await settle();
  button('Pick another address').click();
  await settle();
  const input = target.querySelector('#export-short');
  expect(input.value).toBe('port-strike-2');
  expect(document.activeElement).toBe(input);
  expect(bound.warned).toBe(false);
  expect(target.querySelector('[role="alert"]')).toBeNull();
  expect(props.onaddress).toHaveBeenLastCalledWith('https://octo.github.io/articles/port-strike-2/');
  expect(bound.address).toBe('https://octo.github.io/articles/port-strike-2/');
  expect(publishes()).toEqual([]);
  // the new address is checked as any other
  holding({ ...TAKEN, exists: false, taken: null, free: '' });
  expect((await live.publish()).published).toBe(true);
  expect(checks().at(-1)[1]).toEqual({ short_name: 'port-strike-2' });
});

it('offers only another address for a folder Azimut did not make, and a press checks again', async () => {
  serve();
  holding({ ...TAKEN, taken: { title: 'harbour', ours: false }, free: 'harbour-2' });
  show();
  await settle();
  await live.publish();
  await settle();
  expect(target.querySelector('[role="alert"] p').textContent.trim()).toBe('This address already holds “harbour”, which Azimut did not make.');
  expect(button('Replace it')).toBeUndefined();
  expect(button('Pick another address')).toBeTruthy();
  expect(bound.warned).toBe(false);
  expect(await live.publish()).toBeNull();
  expect(checks()).toHaveLength(2);
  expect(publishes()).toEqual([]);
});

it('says a check that failed, and publishes only on the press after it', async () => {
  serve({ editions: [GITHUB_EDITION] });
  post.mockImplementation(async (path) => {
    if (path.endsWith('/github/check')) throw new Error('GitHub did not answer.');
    return path.endsWith('/pdf/diagrams') ? { diagrams: [] } : PUBLISHED;
  });
  show();
  await settle();
  expect(await live.publish()).toBeNull();
  await settle();
  expect(publishes()).toEqual([]);
  expect(bound.warned).toBe(true);
  expect(target.querySelector('[role="alert"] p').textContent.trim()).toBe('Could not read what this address holds: GitHub did not answer. Publish again to go ahead anyway.');
  expect(button("Don't publish")).toBeTruthy();
  // the analyst has the last word: the next press publishes without reading again
  const answer = await live.publish();
  await settle();
  expect(answer).toMatchObject({ published: true, told: true });
  expect(publishes()).toHaveLength(1);
  expect(checks()).toHaveLength(1);
});

it('reads what the address holds as soon as it is known, and says it before any press', async () => {
  vi.useFakeTimers();
  try {
    serve();
    holding(TAKEN);
    show();
    await settle();
    // nothing read on every keystroke: the address settles first
    expect(checks()).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(checks()).toEqual([['/api/cases/c1/notes/n1/github/check', { short_name: 'port-strike' }]]);
    expect(target.querySelector('[role="alert"] p').textContent.trim()).toBe('This address already holds “Harbour fire”. Replace it?');
    expect(bound.warned).toBe(true);
    expect(publishes()).toEqual([]);
    // a short name typed is read once it settles, the warning gone meanwhile
    holding({ ...TAKEN, exists: false, taken: null, free: '' });
    const input = target.querySelector('#export-short');
    input.value = 'port-strike-2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(target.querySelector('[role="alert"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(checks().at(-1)).toEqual(['/api/cases/c1/notes/n1/github/check', { short_name: 'port-strike-2' }]);
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(bound.warned).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('says the folder changed on GitHub since as soon as the dialog opens', async () => {
  vi.useFakeTimers();
  try {
    serve({ editions: [GITHUB_EDITION] });
    holding({ checked: true, exists: true, edited: true, warning: '', taken: null, free: '' });
    show();
    await settle();
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(target.querySelector('[role="alert"]').textContent).toContain('This folder was changed on GitHub since you published it: publishing replaces it.');
    expect(publishes()).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it('publishes when the editions cannot be read', async () => {
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
  expect(checks()).toHaveLength(1);
});

// -- who wrote it ---------------------------------------------------------------------------

const author = () => target.querySelector('#export-author');
const leave = async (field, value) => {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};

it('opens on the author the note keeps, its placeholder the name it falls back to, for every role', async () => {
  prefs.reportName = 'A. Analyst';
  serve({ look: { author: 'Jane Guest', author_image: 'e_a' } });
  show({ entities: PICTURES });
  await settle();
  expect(author().value).toBe('Jane Guest');
  expect(author().getAttribute('placeholder')).toBe('A. Analyst');
  expect(author().getAttribute('title')).toBeTruthy();
  expect(target.querySelector('button[data-pick="author"]').textContent.trim()).toBe('Harbour');
  for (const role of ['Page', 'Unlisted', 'Article']) {
    choice(role).click();
    flushSync();
    expect(author()).not.toBeNull();
  }
});

it('keeps the author in the look as the field is left, and an emptied one goes back to the default', async () => {
  serve({ look: { style: 'report' } });
  const props = show({ entities: PICTURES });
  await settle();
  await leave(author(), '  Jane   Guest ');
  expect(put).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/look', expect.objectContaining({ style: 'report', author: 'Jane Guest' }));
  expect(author().value).toBe('Jane Guest');
  expect(props.onlook).toHaveBeenCalledTimes(1);
  // leaving it unchanged writes nothing
  await leave(author(), 'Jane Guest');
  expect(put).toHaveBeenCalledTimes(1);
  await leave(author(), '');
  expect('author' in put.mock.calls.at(-1)[1]).toBe(false);
});

it('picks the author picture among the case pictures, never a clip, and clears it', async () => {
  serve({ look: {} });
  show({ entities: PICTURES });
  await settle();
  const pick = () => target.querySelector('button[data-pick="author"]');
  expect(pick().textContent.trim()).toBe('No picture');
  pick().click();
  await settle();
  expect([...target.querySelectorAll('.picture-row')].map((node) => node.textContent.trim())).toEqual(['Harbour', 'Pier at dawn']);
  [...target.querySelectorAll('.picture-row')][0].click();
  await settle();
  expect(put).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/look', expect.objectContaining({ author_image: 'e_a' }));
  expect(pick().textContent.trim()).toBe('Harbour');
  target.querySelector('button[aria-label="No author picture"]').click();
  await settle();
  expect('author_image' in put.mock.calls.at(-1)[1]).toBe(false);
  expect(pick().textContent.trim()).toBe('No picture');
});

it('with GitHub off, the author can still be set, so it travels with the case', async () => {
  serve({ github: NOTHING, look: {} });
  show({ entities: PICTURES });
  await settle();
  await leave(author(), 'Jane Guest');
  expect(put).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/look', expect.objectContaining({ author: 'Jane Guest' }));
  expect(post).not.toHaveBeenCalled();
});

it('publishes only once the author just typed is in the look', async () => {
  serve({ look: {} });
  publishOk();
  let release;
  put.mockImplementation((path, body) => new Promise((resolve) => { release = () => resolve({ look: body }); }));
  show({ entities: PICTURES });
  await settle();
  await leave(author(), 'Jane Guest');
  const publishing = live.publish();
  await settle();
  expect(post.mock.calls.some(([path]) => path.endsWith('/github'))).toBe(false);
  release();
  await publishing;
  expect(post.mock.calls.some(([path]) => path.endsWith('/github'))).toBe(true);
});

// -- the maps the note links to ------------------------------------------------------------

const ROAD = { id: 'n_road', title: 'Road map', address: '', short: '', mentioned: true };
const ROAD_HERE = 'https://octo.github.io/articles/road-map/';
let served = [];

/** The server as `serve` has it, and the web maps the note links to, which a publish of a map changes. */
function serveMaps(maps, options) {
  serve(options);
  served = maps;
  const before = get.getMockImplementation();
  get.mockImplementation(async (path) => (path.endsWith('/github/maps') ? { maps: served } : before(path)));
}
/** The presses that published a note, this one or a map, in order, each with what it sent. */
const published = () => post.mock.calls.filter(([path]) => /\/github$/.test(path));

it('names a map the site lacks before any press, reading the note as saved, and publishes the article without it', async () => {
  // the coast on the site already, the harbour linked by an address that still opens it elsewhere: neither said
  serveMaps([ROAD, { id: 'n_coast', title: 'Coast', address: 'https://octo.github.io/articles/coast/', short: '', mentioned: true },
    { id: 'n_harbour', title: 'Harbour', address: '', short: 'harbour', mentioned: false }]);
  publishOk();
  const props = show();
  await settle();
  expect(props.prepare).toHaveBeenCalled();
  expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/n1/github/maps');
  const box = target.querySelector('.maps');
  expect([...box.querySelectorAll('p')].map((line) => line.textContent.trim())).toEqual([
    'The map “Road map” is not on this site yet.', 'Published without it, the link to it reads as plain text.']);
  expect(button('Publish the map first').title).toBe('Publish each map to this site, then this article');
  // a warning, never a stop: the dialog's own press publishes the article alone
  expect((await live.publish()).published).toBe(true);
  expect(published().map(([path]) => path)).toEqual(['/api/cases/c1/notes/n1/github']);
});

it('names several maps in one sentence, and none when the site holds them all', async () => {
  serveMaps([ROAD, { id: 'n_strikes', title: 'Strikes', address: '', short: '', mentioned: true }]);
  show();
  await settle();
  expect(target.querySelector('.maps p').textContent.trim()).toBe('The maps “Road map” and “Strikes” are not on this site yet.');
  expect(target.querySelector('.maps-said').textContent).toBe('Published without them, the links to them read as plain text.');
  expect(button('Publish the maps first')).toBeTruthy();
  unmount(live);
  serveMaps([{ ...ROAD, address: ROAD_HERE }]);
  live = null;
  show();
  await settle();
  expect(target.querySelector('.maps')).toBeNull();
});

it('Publish the map first puts the map up under its title, listed, then the article, and the warning goes', async () => {
  serveMaps([ROAD]);
  post.mockImplementation(async (path) => {
    if (path.endsWith('/pdf/diagrams')) return { diagrams: [] };
    if (path.endsWith('/github/check')) return { checked: true, exists: false, edited: false, taken: null, free: '' };
    if (path === '/api/cases/c1/notes/n_road/github') {
      served = [{ ...ROAD, address: ROAD_HERE }];
      return { ...PUBLISHED, address: ROAD_HERE };
    }
    return PUBLISHED;
  });
  const props = show();
  props.onpublish.mockImplementation(() => live.publish({ roundPov: true, offlineMaps: true }));
  await settle();
  button('Publish the map first').click();
  await settle();
  await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/n_road/github/check', { short_name: 'road-map' });
  expect(published().map(([path]) => path)).toEqual(['/api/cases/c1/notes/n_road/github', '/api/cases/c1/notes/n1/github']);
  expect(published()[0][1]).toMatchObject({ short_name: 'road-map', role: 'article', round_pov: true, offline_maps: true });
  expect(published()[1][1]).toMatchObject({ short_name: 'port-strike', role: 'article' });
  expect(target.querySelector('.maps')).toBeNull();
  // the next press is the dialog's own again: no map goes first
  post.mockClear();
  await live.publish();
  expect(published().map(([path]) => path)).toEqual(['/api/cases/c1/notes/n1/github']);
});

it('an unlisted article takes its map up unlisted, never over the article\'s name nor another\'s folder', async () => {
  // never published to this site: the article starts on Unlisted
  serveMaps([{ ...ROAD, short: 'port-strike' }], { editions: [] });
  post.mockImplementation(async (path, body) => {
    if (path.endsWith('/pdf/diagrams')) return { diagrams: [] };
    if (path.endsWith('/n_road/github/check')) {
      return body.short_name === 'port-strike-map' ? { checked: true, exists: true, taken: { title: 'Old map', ours: true }, free: 'port-strike-map-2' }
        : { checked: true };
    }
    if (path.endsWith('/github/check')) return { checked: true };
    return PUBLISHED;
  });
  const props = show();
  props.onpublish.mockImplementation(() => live.publish());
  await settle();
  button('Publish the map first').click();
  await settle();
  await settle();
  expect(published()[0][0]).toBe('/api/cases/c1/notes/n_road/github');
  expect(published()[0][1]).toMatchObject({ short_name: 'port-strike-map-2', role: 'unlisted' });
  expect(published()[1][1]).toMatchObject({ short_name: 'port-strike', role: 'unlisted' });
});

it('a map that does not go up is named with GitHub\'s words, and the article waits', async () => {
  serveMaps([ROAD]);
  post.mockImplementation(async (path) => {
    if (path.endsWith('/pdf/diagrams')) return { diagrams: [] };
    if (path.endsWith('/github/check')) return { checked: true };
    if (path.endsWith('/n_road/github')) throw new Error('GitHub did not answer.');
    return PUBLISHED;
  });
  const props = show();
  props.onpublish.mockImplementation(() => live.publish());
  await settle();
  button('Publish the map first').click();
  await settle();
  await settle();
  expect(target.querySelector('.failed').textContent.trim()).toBe('The map “Road map” was not published: GitHub did not answer.');
  expect(published().map(([path]) => path)).toEqual(['/api/cases/c1/notes/n_road/github']);
  expect(target.querySelector('.maps')).not.toBeNull();
});
