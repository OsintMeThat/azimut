// @vitest-environment happy-dom
/**
 * Settings › Website › Articles, mounted: nothing is asked of GitHub until Read the site is pressed, what
 * the read lists (rows with their picture, address, category, kind, date and weight, chips that filter
 * them), the categories and the pages every site should have, and a delete that reaches GitHub only
 * through its confirmation, then takes the row off the list and out of every part that counted it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post, put, del } }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams: vi.fn(), asSvg: (svg) => svg }));
const reloadCase = vi.fn(async () => {});
const toast = vi.fn();
vi.mock('../../lib/state.svelte.js', async (original) => ({ ...(await original()), reloadCase, toast }));
const { applyPrefs, caseState, prefs, uiState } = await import('../../lib/state.svelte.js');
const { forgetRead, siteRead } = await import('../../lib/siteRead.svelte.js');
const { default: WebsiteTab } = await import('./WebsiteTab.svelte');

const MB = 1024 * 1024;
const NOTHING = { account: '', repo: 'articles', branch: 'main', site: '', base: '', token: { set: false, hint: '' } };
const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
  token: { set: true, hint: '…wxyz' }, website: { title: 'Octo Desk', logo: false, counting: '' }, categories: [] };
const item = (folder, more = {}) => ({ folder, address: `https://octo.github.io/articles/${folder}/`, title: `Title of ${folder}`, summary: '', date: '2026-11-20',
  date_label: '20 November 2026', category: '', role: 'article', layout: 'article', image: '', bytes: MB, ...more });
const READ = {
  ok: true, address: 'https://octo.github.io/articles/', home: 'azimut',
  items: [
    item('bab', { title: 'The Bab front', category: 'Conflict Watch', layout: 'story', image: 'https://octo.github.io/articles/bab/cover.jpg', bytes: Math.round(4.2 * MB) }),
    item('guide', { title: 'Installing Azimut', category: 'Methods', date_label: '13 August 2026' }),
    item('bab-map', { title: 'On one map', layout: 'map', bytes: 3 * MB }),
    item('about', { title: 'About', role: 'page', bytes: 2048 }),
    item('draft', { title: 'A draft', role: 'unlisted', category: 'Methods', bytes: 500 }),
  ],
  categories: [{ name: 'Conflict Watch', count: 1, pages: ['conflict-watch/'] }, { name: 'Methods', count: 1, pages: [] }],
  marked: ['', 'conflict-watch/'], legal: '', privacy: '', last: { date: '2026-11-21T13:55:52Z', message: 'Update the site' },
  size: { site: 312 * MB, repository: null }, warnings: [],
};

let live;
let target;
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); flushSync(); };
const panel = () => target.querySelector('#hub-panel-articles');
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((node) => node.textContent.trim().startsWith(name));
const button = (text, within = panel()) => [...within.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));
const rows = () => [...panel().querySelectorAll('.rows .item:not(.head)')];
const chip = (label) => [...panel().querySelectorAll('.chip')].find((node) => node.textContent.trim().startsWith(label));
const dialog = () => document.querySelector('[role="alertdialog"]');

/** The server as the panel asks it: the read, the delete and the page starters, each answered by the test. */
function serve({ read = READ, github = SET, deleted = null } = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github, wordpress: { site: '', user: '', password: { set: false, hint: '' } } };
    return {};
  });
  post.mockImplementation(async (path, body) => {
    if (path === '/api/publishing/github/site/read') return typeof read === 'function' ? read() : read;
    if (path === '/api/publishing/github/site/delete') return typeof deleted === 'function' ? deleted(body) : (deleted ?? { ok: true, commit: 'c'.repeat(40), folder: body.folder, removed: 4, written: ['articles.json', 'feed.xml', 'sitemap.xml'], warnings: [] });
    if (path.endsWith('/notes/privacy-notice')) return { id: 'n7', title: 'Privacy', created: true };
    if (path.endsWith('/notes/legal-notice')) return { id: 'n9', title: 'Legal notice', created: true };
    return {};
  });
}

async function show(github = SET) {
  serve({ github });
  live = mount(WebsiteTab, { target, props: { prefs, savePrefs: vi.fn(async (patch) => patch) } });
  await settle();
  tab('Articles').click();
  await settle();
}

const readSite = async () => {
  button('Read the site').click();
  await settle();
};

beforeEach(() => {
  vi.clearAllMocks();
  forgetRead();
  applyPrefs({ site_title: '', site_tagline: '', site_credit_azimut: true, site_stats: '', site_stats_code: '', site_stats_token: '', report_name: '' });
  caseState.current = null;
  uiState.tool = 'settings';
  uiState.openNotebook = null;
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
  document.body.innerHTML = '';
  caseState.current = null;
  forgetRead();
});

describe('reading the site', () => {
  it('asks GitHub nothing until Read the site is pressed, then once', async () => {
    await show();
    expect(post).not.toHaveBeenCalled();
    expect(panel().textContent).toContain('The site is not read yet. Press Read the site to list its articles, maps and pages.');
    expect(rows()).toHaveLength(0);
    expect(tab('Articles').querySelector('.n')).toBeNull();
    expect(button('Read the site').getAttribute('title')).toBe('Read the site on GitHub, to list what it holds');
    await readSite();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/publishing/github/site/read');
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(button('Read the site again')).toBeTruthy();
    expect(panel().querySelector('.read-line .said').textContent).toMatch(/^\s*Read today at \d\d:\d\d\s*$/);
    // the count of what the site holds is on the tab
    expect(tab('Articles').querySelector('.n').textContent).toBe('5');
  });

  it('shows it working, and presses once even when pressed twice', async () => {
    await show();
    let answer;
    post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    button('Read the site').click();
    await settle();
    expect(panel().textContent).toContain('Reading octo/articles…');
    expect(panel().querySelector('.spinner')).not.toBeNull();
    expect(button('Reading…').disabled).toBe(true);
    button('Reading…').click();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    answer(READ);
    await settle();
    expect(panel().querySelector('.spinner')).toBeNull();
    expect(rows()).toHaveLength(5);
  });

  it('cannot read while GitHub is not set up, and says so on hover', async () => {
    await show({ ...NOTHING, website: { title: '', logo: false, counting: '' }, categories: [] });
    expect(button('Read the site').disabled).toBe(true);
    expect(button('Read the site').getAttribute('title')).toBe('Set up GitHub Pages under Hosting first');
    button('Read the site').click();
    await settle();
    expect(post).not.toHaveBeenCalled();
  });

  it('says what went wrong in the words the server gave, and what to mind', async () => {
    await show();
    serve({ read: { ...READ, warnings: ['The site holds too many files for Azimut to read.'] } });
    await readSite();
    expect([...panel().querySelectorAll('ul[aria-label="To mind"] li')].map((node) => node.textContent.trim())).toEqual(['The site holds too many files for Azimut to read.']);
    post.mockRejectedValue(new Error('GitHub did not answer.'));
    button('Read the site again').click();
    await settle();
    const said = panel().querySelector('.read-line .said');
    expect(said.textContent).toContain('GitHub did not answer.');
    expect(said.dataset.state).toBe('error');
  });

  it('shows the press that makes what is missing, then asks to read again', async () => {
    await show();
    serve({ read: { ok: false, needs: 'repository', detail: 'There is no repository octo/articles that this token can reach.' } });
    await readSite();
    expect(panel().textContent).toContain('There is no repository octo/articles that this token can reach.');
    post.mockResolvedValueOnce({ ok: true, repository: 'octo/articles' });
    button('Create the repository').click();
    await settle();
    expect(panel().textContent).toContain('Pages is off for octo/articles.');
    post.mockResolvedValueOnce({ ok: true, base: 'https://octo.github.io/articles/' });
    button('Turn on Pages').click();
    await settle();
    expect(panel().textContent).toContain('Pages is on. Press Read the site.');
    expect(panel().querySelector('.needs')).toBeNull();
  });

  it('says the site lists nothing yet when the read finds nothing', async () => {
    await show();
    serve({ read: { ok: true, address: 'https://octo.github.io/articles/', home: 'none', items: [], categories: [], marked: [], legal: '', privacy: '' } });
    await readSite();
    expect(panel().textContent).toContain('The site lists nothing yet. Publish a note from the Notebook.');
    expect(rows()).toHaveLength(0);
  });
});

describe('what the read lists', () => {
  it('shows a row for each card with its picture, title, address, category, kind, date and weight', async () => {
    await show();
    await readSite();
    expect(rows().map((row) => row.dataset.folder)).toEqual(['bab', 'guide', 'bab-map', 'about', 'draft']);
    const [bab, guide, map, page, draft] = rows();
    expect(bab.querySelector('img.th').getAttribute('src')).toBe('https://octo.github.io/articles/bab/cover.jpg');
    expect(bab.querySelector('img.th').getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(bab.querySelector('.t b').textContent).toBe('The Bab front');
    expect(bab.querySelector('.t small').textContent).toBe('/articles/bab/');
    expect(bab.querySelector('.cat').textContent).toBe('Conflict Watch');
    expect(bab.querySelector('.kind').textContent).toBe('Article');
    expect(bab.textContent).toContain('20 November 2026');
    expect(bab.textContent).toContain('4.2 MB');
    expect(guide.querySelector('img.th')).toBeNull();
    expect(guide.textContent).toContain('13 August 2026');
    expect(map.querySelector('.kind').textContent).toBe('Map');
    expect(map.querySelector('.cat').textContent).toBe('no category');
    expect(page.querySelector('.kind').textContent).toBe('Page');
    expect(page.textContent).toContain('2 KB');
    // an unlisted draft adds no category to the site: it shows none
    expect(draft.querySelector('.kind').textContent).toBe('Unlisted');
    expect(draft.querySelector('.cat').textContent).toBe('no category');
    const open = bab.querySelector('a');
    expect(open.getAttribute('href')).toBe('https://octo.github.io/articles/bab/');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
    for (const control of panel().querySelectorAll('.rows a, .rows button')) expect(control.getAttribute('title')).toBeTruthy();
  });

  it('refuses a link that is no web address, so a card cannot send the analyst anywhere else', async () => {
    await show();
    serve({ read: { ...READ, items: [item('x', { address: 'javascript:alert(1)', image: 'javascript:alert(2)' })] } });
    await readSite();
    expect(rows()[0].querySelector('a')).toBeNull();
    expect(rows()[0].querySelector('img')).toBeNull();
    expect(rows()[0].querySelector('.t small').textContent).toBe('/x/');
  });

  it('filters by category, by Maps, Pages and Unlisted, and back to All', async () => {
    await show();
    await readSite();
    expect([...panel().querySelectorAll('.chip')].map((node) => node.textContent.trim())).toEqual(
      ['All5', 'Conflict Watch1', 'Methods1', 'Maps1', 'Pages1', 'Unlisted1']);
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');
    chip('Methods').click();
    await settle();
    // an unlisted draft with a category is not one of the category's articles
    expect(rows().map((row) => row.dataset.folder)).toEqual(['guide']);
    expect(chip('Methods').getAttribute('aria-pressed')).toBe('true');
    chip('Maps').click();
    await settle();
    expect(rows().map((row) => row.dataset.folder)).toEqual(['bab-map']);
    chip('Pages').click();
    await settle();
    expect(rows().map((row) => row.dataset.folder)).toEqual(['about']);
    chip('Unlisted').click();
    await settle();
    expect(rows().map((row) => row.dataset.folder)).toEqual(['draft']);
    chip('All').click();
    await settle();
    expect(rows()).toHaveLength(5);
    for (const node of panel().querySelectorAll('.chip')) expect(node.getAttribute('title')).toBeTruthy();
  });

  it('says what the three kinds are, and that the kind is picked in the publish window', async () => {
    await show();
    const kinds = [...panel().querySelectorAll('.kinds section')].map((node) => [node.querySelector('.kind').textContent, node.querySelector('p').textContent]);
    expect(kinds).toEqual([
      ['Article', 'In the site\'s list, its feed and its sitemap.'],
      ['Page', 'Off the lists, linked from the site\'s header. For About or Legal notice.'],
      ['Unlisted', 'Online at its address only. For a test, or a draft to show someone.']]);
    expect(panel().textContent).toContain('You pick the kind in the publish window, each time you publish a note.');
  });

  it('lists the categories the read found with their articles and the pages that list them', async () => {
    await show();
    expect(panel().textContent).toContain('Read the site to list its categories.');
    await readSite();
    const cats = [...panel().querySelectorAll('.cats li')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
    expect(cats).toEqual(['Conflict Watch 1 article conflict-watch/ lists it', 'Methods 1 article no page lists it']);
    expect(panel().textContent).toContain('Made in the publish window: pick one the site uses or type a new one.');
    expect(panel().textContent).toContain('A category gets a page of its own with the markers in Make it yours.');
    serve({ read: { ...READ, categories: [] } });
    button('Read the site again').click();
    await settle();
    expect(panel().textContent).toContain('No category on the site yet.');
  });

  it('shares the read with the hero and the other panels', async () => {
    await show();
    await readSite();
    const hero = target.querySelector('section[aria-label="The site at a glance"]');
    expect(hero.textContent).toContain('2 articles · 1 map · 1 page · 1 unlisted · 312 MB');
    tab('Overview').click();
    await settle();
    expect(target.querySelector('#hub-panel-overview .check li[data-state="done"]')).not.toBeNull();
  });

  it('keeps each press as a hover text, and the network rule on mount: nothing is asked before a press', async () => {
    await show();
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/api/publishing', '/api/publishing']);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('deleting an article', () => {
  const ask = async (folder) => {
    button('Delete', rows().find((row) => row.dataset.folder === folder)).click();
    await settle();
  };

  it('asks first, saying what goes and that the note stays, and reaches GitHub for nothing until it is confirmed', async () => {
    await show();
    await readSite();
    post.mockClear();
    await ask('bab');
    expect(dialog().getAttribute('aria-label')).toBe('Delete this article from the site?');
    expect(dialog().textContent).toContain('Deletes bab/ from octo/articles and takes it off the lists, the feed and the sitemap, in one commit.');
    expect(dialog().textContent).toContain('The note stays in your case: publish it again to put it back.');
    expect([...dialog().querySelectorAll('button')].map((node) => node.textContent.trim())).toEqual(['Cancel', 'Delete from the site']);
    expect(post).not.toHaveBeenCalled();
    // Cancel leaves the row and asks nothing
    button('Cancel', dialog()).click();
    await settle();
    expect(dialog()).toBeNull();
    expect(rows()).toHaveLength(5);
    expect(post).not.toHaveBeenCalled();
  });

  it('deletes on its confirmation: one commit, the row leaves, and the result line says what was written', async () => {
    await show();
    await readSite();
    post.mockClear();
    await ask('bab');
    button('Delete from the site', dialog()).click();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/publishing/github/site/delete', { folder: 'bab' });
    expect(dialog()).toBeNull();
    expect(rows().map((row) => row.dataset.folder)).toEqual(['guide', 'bab-map', 'about', 'draft']);
    expect(panel().textContent).toContain('Deleted bab/: 3 files written.');
    // what counted it counts again: the tab, the category it was alone in, the hero
    expect(tab('Articles').querySelector('.n').textContent).toBe('4');
    expect([...panel().querySelectorAll('.chip')].map((node) => node.textContent.trim())).not.toContain('Conflict Watch1');
    expect(panel().textContent).not.toContain('conflict-watch/ lists it');
    expect(target.querySelector('section[aria-label="The site at a glance"]').textContent).toContain('1 article · 1 map');
    // the read itself was not asked again
    expect(post.mock.calls.map(([path]) => path)).toEqual(['/api/publishing/github/site/delete']);
  });

  it('lists what the server says to mind', async () => {
    await show();
    await readSite();
    serve({ deleted: { ok: true, commit: 'c'.repeat(40), folder: 'guide', removed: 2, written: ['feed.xml'], warnings: ['feed.xml is yours: it was left as it is.'] } });
    await ask('guide');
    button('Delete from the site', dialog()).click();
    await settle();
    expect(panel().textContent).toContain('Deleted guide/: 1 file written.');
    expect([...panel().querySelectorAll('ul[aria-label="To mind"] li')].map((node) => node.textContent.trim())).toContain('feed.xml is yours: it was left as it is.');
  });

  it('keeps the dialog and the row when GitHub moved on, says why, and deletes on the next press', async () => {
    await show();
    await readSite();
    let attempts = 0;
    serve({ deleted: (body) => {
      attempts += 1;
      if (attempts === 1) throw new Error('The branch moved on GitHub meanwhile: press Delete again.');
      return { ok: true, commit: 'd'.repeat(40), folder: body.folder, removed: 1, written: ['articles.json'], warnings: [] };
    } });
    await ask('about');
    button('Delete from the site', dialog()).click();
    await settle();
    expect(dialog()).not.toBeNull();
    expect(dialog().textContent).toContain('press Delete again');
    expect(rows()).toHaveLength(5);
    button('Delete from the site', dialog()).click();
    await settle();
    expect(dialog()).toBeNull();
    expect(rows().map((row) => row.dataset.folder)).not.toContain('about');
    expect(attempts).toBe(2);
  });

  it('refuses nothing it did not publish by itself: the server says so and the row stays', async () => {
    await show();
    await readSite();
    serve({ deleted: () => { throw new Error('Azimut deletes only the folders it published.'); } });
    await ask('bab-map');
    button('Delete from the site', dialog()).click();
    await settle();
    expect(dialog().textContent).toContain('Azimut deletes only the folders it published.');
    expect(rows().map((row) => row.dataset.folder)).toContain('bab-map');
  });

  it('takes the legal notice off the site when its folder is deleted', async () => {
    await show();
    serve({ read: { ...READ, items: [...READ.items, item('legal-notice', { title: 'Legal notice', role: 'page' })], legal: 'legal-notice/' } });
    await readSite();
    expect(siteRead.data.legal).toBe('legal-notice/');
    await ask('legal-notice');
    button('Delete from the site', dialog()).click();
    await settle();
    expect(siteRead.data.legal).toBe('');
  });
});

describe('pages every site should have', () => {
  const start = (name) => button(name);
  const pageRow = (name) => [...panel().querySelectorAll('.pages li')].find((node) => node.textContent.includes(name));

  it('lists the Legal notice and the Privacy page, with the legal sentence and what each page says', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    expect(panel().textContent).toContain('Depending on your country, a website may need a legal notice.');
    expect(pageRow('Legal notice').getAttribute('data-guide')).toBe('settings.legal');
    expect(pageRow('Legal notice').textContent).toContain('It names GitHub as the host and leaves the publisher lines to you.');
    expect(pageRow('Privacy').textContent).toContain('It names the host and what the counter records.');
    expect(panel().textContent).toContain('Each starts as a note in the open case, with the host named. You fill in the rest.');
    expect(start('Start a Legal notice page').getAttribute('title')).toBe('Make a page titled Legal notice in the open case, with the host named');
    expect(start('Start a Privacy page').getAttribute('title')).toBe('Make a page titled Privacy in the open case, with the counting named');
  });

  it('cannot start either with no case open, and says to open one first', async () => {
    await show();
    for (const press of ['Start a Legal notice page', 'Start a Privacy page']) {
      expect(start(press).disabled).toBe(true);
      expect(start(press).getAttribute('title')).toBe('Open a case first: the page is a note of that case');
    }
    start('Start a Legal notice page').click();
    await settle();
    expect(post).not.toHaveBeenCalled();
  });

  it('makes the Legal notice in the open case, reads the case again and opens the Notebook on it', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    start('Start a Legal notice page').click();
    await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/legal-notice');
    expect(reloadCase).toHaveBeenCalled();
    expect(uiState.tool).toBe('notebook');
    expect(uiState.openNotebook).toEqual({ noteId: 'n9' });
  });

  it('makes the Privacy page the same way, from its own route', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    start('Start a Privacy page').click();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/privacy-notice');
    expect(reloadCase).toHaveBeenCalled();
    expect(uiState.tool).toBe('notebook');
    expect(uiState.openNotebook).toEqual({ noteId: 'n7' });
  });

  it('opens the one already made when pressed again', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    post.mockResolvedValue({ id: 'n3', title: 'Privacy', created: false });
    start('Start a Privacy page').click();
    await settle();
    expect(uiState.openNotebook).toEqual({ noteId: 'n3' });
  });

  it('says when a page could not be started, and stays on Settings', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    post.mockRejectedValue(new Error('The case is read-only.'));
    start('Start a Legal notice page').click();
    await settle();
    expect(toast).toHaveBeenCalledWith('Could not start the Legal notice: The case is read-only.', 'danger');
    start('Start a Privacy page').click();
    await settle();
    expect(toast).toHaveBeenLastCalledWith('Could not start the Privacy page: The case is read-only.', 'danger');
    expect(uiState.tool).toBe('settings');
    expect(start('Start a Legal notice page').disabled).toBe(false);
  });

  it('says a page is on the site once the read found it, and not before', async () => {
    await show();
    expect(pageRow('Legal notice').querySelector('.badge')).toBeNull();
    serve({ read: { ...READ, legal: 'legal-notice/', privacy: '' } });
    await readSite();
    expect(pageRow('Legal notice').querySelector('.badge').textContent).toContain('On the site');
    expect(pageRow('Privacy').querySelector('.badge')).toBeNull();
  });
});
