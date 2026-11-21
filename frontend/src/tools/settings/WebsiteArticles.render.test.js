// @vitest-environment happy-dom
/**
 * Settings › Website › Articles, mounted: nothing is asked of GitHub until Read the site is pressed, what
 * the read lists (rows with their picture, address, category, kind, date and weight, chips that filter
 * them), an article's category picked on its line and sent to GitHub at once, the pages every site
 * should have, and a delete that reaches GitHub only through its confirmation, then takes the row off the
 * list and out of every part that counted it, or says why the server refused it.
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
  date_label: '20 November 2026', category: '', role: 'article', layout: 'article', image: '', bytes: MB, deletable: true, ...more });
const NESTED = '2026/01/05/lost-in-low-res';
const READ = {
  ok: true, address: 'https://octo.github.io/articles/', home: 'azimut',
  items: [
    item('bab', { title: 'The Bab front', category: 'Conflict Watch', layout: 'story', image: 'https://octo.github.io/articles/bab/cover.jpg', bytes: Math.round(4.2 * MB) }),
    item('guide', { title: 'Installing Azimut', category: 'Methods', date: '2026-08-13', date_label: '13 August 2026' }),
    item('bab-map', { title: 'On one map', layout: 'map', bytes: 3 * MB }),
    item('about', { title: 'About', role: 'page', bytes: 2048 }),
    item('draft', { title: 'A draft', role: 'unlisted', category: 'Methods', bytes: 500 }),
    item(NESTED, { title: 'Lost in Low-Res', category: 'Methods', date: '2026-01-05', date_label: '5 January 2026', deletable: false }),
  ],
  categories: [{ name: 'Conflict Watch', count: 1, pages: ['conflict-watch/'] }, { name: 'Methods', count: 2, pages: [] }],
  marked: ['', 'conflict-watch/'], legal: '', privacy: '', last: { date: '2026-11-21T13:55:52Z', message: 'Update the site' },
  size: { site: 312 * MB, repository: null }, warnings: [],
};
/** What the api says of a refusal: the server's detail, and its status. */
const refused = (status, detail) => Object.assign(new Error(detail), { status });
const MOVED = { ok: true, commit: 'c'.repeat(40), changed: 1, written: ['articles.json', 'bab/article.json', 'feed.xml'], warnings: [],
  categories: ['Conflict Watch', 'Harbour', 'Methods'], added: [] };
const DELETED = (folder) => ({ ok: true, commit: 'c'.repeat(40), folder, removed: 4, written: ['articles.json', 'feed.xml', 'sitemap.xml'], warnings: [] });

let live;
let target;
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); flushSync(); };
const panel = () => target.querySelector('#hub-panel-articles');
const hero = () => target.querySelector('section[aria-label="The site at a glance"]');
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((node) => node.textContent.trim().startsWith(name));
const button = (text, within = panel()) => [...within.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));
const rows = () => [...panel().querySelectorAll('.rows .item')];
const row = (folder) => panel().querySelector(`.rows .item[data-folder="${folder}"]`);
const chip = (label) => [...panel().querySelectorAll('.chip')].find((node) => node.textContent.trim().startsWith(label));
const status = () => panel().querySelector('.toolbar [role="status"]');
const dialog = () => document.querySelector('[role="alertdialog"]');
const asks = (path) => post.mock.calls.filter(([called]) => called === path);

/** The server as the panel asks it: the read, the delete and the page starters, each answered by the test. */
function serve({ read = READ, github = SET, deleted = null, moved = null } = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github, wordpress: { site: '', user: '', password: { set: false, hint: '' } } };
    return {};
  });
  post.mockImplementation(async (path, body) => {
    if (path === '/api/publishing/github/site/read') return typeof read === 'function' ? read() : read;
    if (path === '/api/publishing/github/site/delete') return typeof deleted === 'function' ? deleted(body) : (deleted ?? DELETED(body.folder));
    if (path === '/api/publishing/github/site/category') return typeof moved === 'function' ? moved(body) : (moved ?? MOVED);
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

/** Delete pressed on a row and confirmed in its dialog. */
async function deleteRow(folder) {
  button('Delete', row(folder)).click();
  await settle();
  button('Delete from the site', dialog()).click();
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetRead();
  applyPrefs({ site_title: '', site_tagline: '', site_credit_azimut: true, site_stats: '', site_stats_code: '', site_stats_token: '', report_name: '' });
  caseState.current = null;
  uiState.tool = 'settings';
  uiState.openNotebook = null;
  target = document.createElement('div');
  target.className = 'settings-pane';
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
    expect(panel().querySelector('.blank').textContent).toContain('Not read yet');
    expect(panel().querySelector('.blank').textContent).toContain('Press Read the site to list its articles, maps and pages.');
    expect(button('Read the site').getAttribute('title')).toBe('Read the site on GitHub, to list what it holds');
    await readSite();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/publishing/github/site/read');
    expect(rows()).toHaveLength(6);
    expect(status().textContent).toMatch(/^Read today at \d\d:\d\d$/);
    expect(button('Read the site again')).toBeTruthy();
  });

  it('says it is reading on the press itself, with a spinner, and presses once even when pressed twice', async () => {
    await show();
    let answer;
    serve({ read: () => new Promise((resolve) => { answer = resolve; }) });
    const press = button('Read the site');
    press.click();
    await settle();
    expect(press.textContent.trim()).toBe('Reading…');
    expect(press.querySelector('.busy-spin')).not.toBeNull();
    expect(press.disabled).toBe(true);
    expect(press.getAttribute('aria-busy')).toBe('true');
    // the press says it, so the line beside it says nothing more
    expect(status().textContent.trim()).toBe('');
    press.click();
    await settle();
    expect(asks('/api/publishing/github/site/read')).toHaveLength(1);
    answer(READ);
    await settle();
    expect(rows()).toHaveLength(6);
    expect(press.textContent.trim()).toBe('Read the site again');
    expect(press.querySelector('.busy-spin')).toBeNull();
    expect(press.getAttribute('aria-busy')).toBe('false');
  });

  it('is the same press again after a failed read', async () => {
    await show();
    let fail;
    serve({ read: () => new Promise((_, reject) => { fail = reject; }) });
    const press = button('Read the site');
    press.click();
    await settle();
    expect(press.disabled).toBe(true);
    fail(new Error('GitHub did not answer.'));
    await settle();
    expect(press.textContent.trim()).toBe('Read the site');
    expect(press.disabled).toBe(false);
    expect(press.querySelector('.busy-spin')).toBeNull();
  });

  it('cannot read while GitHub is not set up, and says so on hover', async () => {
    await show(NOTHING);
    expect(button('Read the site').disabled).toBe(true);
    expect(button('Read the site').getAttribute('title')).toBe('Set up GitHub Pages under Hosting first');
  });

  it('says what went wrong in the words the server gave, and what to mind', async () => {
    await show();
    serve({ read: () => Promise.reject(new Error('GitHub is having trouble: try again in a minute.')) });
    await readSite();
    expect(status().textContent).toContain('GitHub is having trouble: try again in a minute.');
    expect(status().dataset.state).toBe('error');
    serve({ read: { ...READ, warnings: ['The site holds more than 500 cards: Azimut shows the first 500.'] } });
    await readSite();
    expect(panel().querySelector('ul[aria-label="To mind"]').textContent).toContain('Azimut shows the first 500.');
  });

  it('shows the press that makes what is missing, then asks to read again', async () => {
    await show();
    serve({ read: { ok: false, needs: 'pages', detail: 'Pages is off for octo/articles.' } });
    await readSite();
    expect(status().textContent).toContain('Pages is off for octo/articles.');
    post.mockResolvedValueOnce({ ok: true, base: 'https://octo.github.io/articles/' });
    button('Turn on Pages').click();
    await settle();
    expect(post).toHaveBeenLastCalledWith('/api/publishing/github/pages');
    expect(status().textContent).toContain('Pages is on. Press Read the site.');
  });

  it('says the site lists nothing yet when the read finds nothing', async () => {
    await show();
    serve({ read: { ...READ, items: [], categories: [], home: 'none' } });
    await readSite();
    expect(rows()).toHaveLength(0);
    expect(panel().querySelector('.blank').textContent).toContain('Nothing on the site yet');
    expect(panel().querySelector('.blank').textContent).toContain('Publish a note from the Notebook and it shows here.');
    expect(panel().querySelectorAll('.chip')).toHaveLength(0);
  });

  it('says a site too large to read is so, with GitHub\'s word, and lists nothing', async () => {
    await show();
    serve({ read: { ...READ, items: [], categories: [], home: 'none', size: { site: null, repository: null },
      warnings: ['The site holds too many files for Azimut to read: nothing is shown.'] } });
    await readSite();
    expect(panel().querySelector('.blank').textContent).toContain('The site holds too many files to read.');
    expect(panel().querySelector('ul[aria-label="To mind"]').textContent).toContain('The site holds too many files for Azimut to read: nothing is shown.');
    expect(tab('Articles').querySelector('.count')).toBeNull();
  });
});

describe('what the read lists', () => {
  it('says under the list, by its Delete presses, what a delete does, and nothing before a read', async () => {
    await show();
    expect(panel().querySelector('.del-said')).toBeNull();
    await readSite();
    expect(panel().querySelector('.del-said').textContent)
      .toBe('Delete takes an article down, and off the lists, the feed and the sitemap, in one commit.');
    // a list with nothing Azimut published has no Delete, and nothing to say of it
    serve({ read: { ...READ, items: READ.items.map((entry) => ({ ...entry, deletable: false })) } });
    await readSite();
    expect(panel().querySelector('.del-said')).toBeNull();
  });

  it('shows a row for each card with its picture, title, address, category, kind, date and weight', async () => {
    await show();
    await readSite();
    const first = row('bab');
    expect(first.querySelector('.th img').getAttribute('src')).toBe('https://octo.github.io/articles/bab/cover.jpg');
    expect(first.querySelector('.th img').getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(first.querySelector('.t b').textContent).toBe('The Bab front');
    expect(first.querySelector('.t b').getAttribute('title')).toBe('The Bab front');
    expect(first.querySelector('.t small').textContent).toBe('/articles/bab/');
    expect(first.querySelector('.cat').textContent.trim()).toBe('Conflict Watch');
    expect(first.querySelector('.kind').textContent).toBe('Article');
    expect(first.querySelector('.d').textContent).toBe('20 Nov 2026');
    expect(first.querySelector('.d').getAttribute('title')).toBe('20 November 2026');
    expect(first.querySelector('.w').textContent).toBe('4.2 MB');
    const link = first.querySelector('a.open');
    expect(link.getAttribute('href')).toBe('https://octo.github.io/articles/bab/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('title')).toBe('Open this page on the site');
    expect(button('Delete', first).getAttribute('title')).toBe('Delete this folder from the site, and from its lists');
    // a card with no picture shows its kind's mark; a map, a page and an unlisted one say what they are, with no category
    expect(row('bab-map').querySelector('.th img')).toBeNull();
    expect(row('bab-map').querySelector('.th svg')).not.toBeNull();
    expect(row('bab-map').querySelector('.kind').textContent).toBe('Map');
    expect(row('about').querySelector('.kind').textContent).toBe('Page');
    expect(row('about').querySelector('.cat').textContent).toBe('no category');
    expect(row('draft').querySelector('.kind').textContent).toBe('Unlisted');
    expect(row('draft').querySelector('.cat').textContent).toBe('no category');
    expect(row('about').querySelector('.w').textContent).toBe('2 KB');
    // the tab counts the rows
    expect(tab('Articles').querySelector('.count').textContent).toBe('6');
  });

  it('shows the mark of the kind when a picture does not load', async () => {
    await show();
    await readSite();
    row('bab').querySelector('.th img').dispatchEvent(new Event('error'));
    await settle();
    expect(row('bab').querySelector('.th img')).toBeNull();
    expect(row('bab').querySelector('.th svg')).not.toBeNull();
  });

  it('gives no Delete to a card made outside Azimut, and says on hover to delete it on GitHub', async () => {
    await show();
    await readSite();
    const nested = row(NESTED);
    expect(nested.querySelector('.t small').textContent).toBe(`/articles/${NESTED}/`);
    expect(button('Delete', nested)).toBeUndefined();
    expect(nested.getAttribute('title')).toBe('Made outside Azimut: delete it on GitHub');
    expect(nested.querySelector('.outside').textContent).toBe('Outside Azimut');
    expect(row('bab').hasAttribute('title')).toBe(false);
  });

  it('refuses a link that is no web address, so a card cannot send the analyst anywhere else', async () => {
    await show();
    serve({ read: { ...READ, items: [item('x', { address: 'javascript:alert(1)', image: 'javascript:alert(2)' })] } });
    await readSite();
    expect(row('x').querySelector('a.open')).toBeNull();
    expect(row('x').querySelector('img')).toBeNull();
  });

  it('filters by category, by Maps, Pages and Unlisted, and back to All', async () => {
    await show();
    await readSite();
    expect([...panel().querySelectorAll('.chip')].map((node) => node.textContent.trim())).toEqual(
      ['All6', 'Conflict Watch1', 'Methods2', 'Maps1', 'Pages1', 'Unlisted1']);
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');
    chip('Methods').click();
    await settle();
    // a category keeps its listed articles, never an unlisted one
    expect(rows().map((node) => node.dataset.folder)).toEqual(['guide', NESTED]);
    expect(chip('Methods').getAttribute('aria-pressed')).toBe('true');
    chip('Maps').click();
    await settle();
    expect(rows().map((node) => node.dataset.folder)).toEqual(['bab-map']);
    chip('Unlisted').click();
    await settle();
    expect(rows().map((node) => node.dataset.folder)).toEqual(['draft']);
    chip('All').click();
    await settle();
    expect(rows()).toHaveLength(6);
    for (const node of panel().querySelectorAll('.chip')) expect(node.getAttribute('title')).toBe('Show only these on the list');
  });

  it('says what the three kinds are, and that the kind is picked in the publish window', async () => {
    await show();
    const kinds = [...panel().querySelectorAll('.kinds section')];
    expect(kinds.map((node) => node.querySelector('.kind').textContent)).toEqual(['Article', 'Page', 'Unlisted']);
    expect(kinds[2].textContent).toContain('Online at its address only, and out of search engines. For a test, or a draft to show someone.');
    expect(panel().textContent).toContain('You pick the kind in the publish window, each time you publish a note.');
  });

  it('leaves the categories to their own panel', async () => {
    await show();
    await readSite();
    expect(panel().querySelector('section[aria-label="Categories"]')).toBeNull();
    expect(target.querySelector('#hub-panel-categories section[aria-label="Categories"]')).not.toBeNull();
  });

  it('shares the read with the hero and the other panels', async () => {
    await show();
    await readSite();
    expect(siteRead.data.items).toHaveLength(6);
    expect(hero().textContent).toContain('3 articles · 1 map · 1 page · 1 unlisted · 312 MB');
  });

  it('keeps each press as a hover text, and the network rule on mount: nothing is asked before a press', async () => {
    await show();
    await readSite();
    for (const control of panel().querySelectorAll('button, a, input, summary')) expect(control.getAttribute('title'), control.outerHTML.slice(0, 80)).toBeTruthy();
    expect(post.mock.calls.map(([path]) => path)).toEqual(['/api/publishing/github/site/read']);
  });
});

describe('an article\'s category, on its line', () => {
  const trigger = (folder) => row(folder).querySelector('.cat-pick [role="combobox"]');
  const options = () => [...document.querySelectorAll('[role="listbox"] [role="option"]')];
  const pick = async (folder, name) => {
    trigger(folder).click();
    await settle();
    options().find((node) => node.textContent.trim() === name).click();
    await settle();
  };

  it('is a list on each article\'s line, of the site\'s categories and the ones added here, and none on a page or an unlisted one', async () => {
    await show({ ...SET, added: ['Harbour'] });
    await readSite();
    expect(trigger('bab').getAttribute('title')).toBe('The category of this article, changed on GitHub as you pick it');
    expect(trigger('bab').getAttribute('aria-label')).toBe('Category of The Bab front');
    expect(trigger('bab-map').textContent.trim()).toBe('No category');
    expect(row('about').querySelector('.cat-pick')).toBeNull();
    expect(row('draft').querySelector('.cat-pick')).toBeNull();
    trigger('bab').click();
    await settle();
    expect(options().map((node) => node.textContent.trim())).toEqual(['No category', 'Conflict Watch', 'Methods', 'Harbour', 'New category…']);
    // nothing reaches GitHub until a pick
    expect(asks('/api/publishing/github/site/category')).toHaveLength(0);
  });

  it('sends a pick to GitHub at once, says it is moving on the line, then the read and the counts follow', async () => {
    await show({ ...SET, added: ['Harbour'] });
    await readSite();
    let answer;
    serve({ github: { ...SET, added: ['Harbour'] }, moved: () => new Promise((resolve) => { answer = resolve; }) });
    await pick('bab', 'Harbour');
    expect(asks('/api/publishing/github/site/category')).toEqual([['/api/publishing/github/site/category', { folder: 'bab', category: 'Harbour' }]]);
    expect(row('bab').querySelector('.cat-pick').textContent.trim()).toBe('Moving…');
    expect(row('bab').querySelector('.cat-pick .busy-spin')).not.toBeNull();
    // one change at a time: the other lines wait
    expect(trigger('guide').disabled).toBe(true);
    answer(MOVED);
    await settle();
    expect(trigger('bab').textContent.trim()).toBe('Harbour');
    expect(status().textContent).toContain('“The Bab front” is in Harbour now.');
    expect(siteRead.data.categories.map((entry) => [entry.name, entry.count])).toEqual([['Methods', 2], ['Harbour', 1], ['Conflict Watch', 0]]);
    expect(chip('Harbour').textContent).toContain('1');
    // the added one is on the site now
    expect([...target.querySelectorAll('#hub-panel-categories .cats li')].map((node) => node.dataset.category)).toEqual(['Methods', 'Harbour', 'Conflict Watch']);
  });

  it('takes an article out of its category, and changes nothing for the one it has already', async () => {
    await show();
    await readSite();
    await pick('bab', 'Conflict Watch');
    expect(asks('/api/publishing/github/site/category')).toHaveLength(0);
    await pick('bab', 'No category');
    expect(asks('/api/publishing/github/site/category')).toEqual([['/api/publishing/github/site/category', { folder: 'bab', category: '' }]]);
    expect(status().textContent).toContain('“The Bab front” has no category now.');
  });

  it('takes a new category typed on the line once the field is left, and nothing for a field left empty', async () => {
    await show();
    await readSite();
    trigger('guide').click();
    await settle();
    options().find((node) => node.textContent.includes('New category')).click();
    await settle();
    const field = row('guide').querySelector('.cat-pick input');
    field.value = 'Deep  dives';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(asks('/api/publishing/github/site/category')).toHaveLength(0);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(asks('/api/publishing/github/site/category')).toEqual([['/api/publishing/github/site/category', { folder: 'guide', category: 'Deep dives' }]]);
    post.mockClear();
    trigger('bab').click();
    await settle();
    options().find((node) => node.textContent.includes('New category')).click();
    await settle();
    row('bab').querySelector('.cat-pick input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(asks('/api/publishing/github/site/category')).toHaveLength(0);
  });

  it('keeps the category when GitHub refuses, says why, and drops a line whose folder is gone', async () => {
    await show();
    await readSite();
    serve({ moved: () => Promise.reject(refused(409, 'The branch changed on GitHub while Azimut was changing the categories: press again.')) });
    await pick('bab', 'Methods');
    expect(trigger('bab').textContent.trim()).toBe('Conflict Watch');
    expect(status().textContent).toContain('press again');
    expect(status().dataset.state).toBe('error');
    serve({ moved: () => Promise.reject(refused(404, 'That folder is not on the site any more.')) });
    await pick('guide', 'Conflict Watch');
    expect(row('guide')).toBeNull();
  });
});

describe('deleting an article', () => {
  it('asks first, saying what goes and that the note stays, and reaches GitHub for nothing until it is confirmed', async () => {
    await show();
    await readSite();
    button('Delete', row('bab')).click();
    await settle();
    expect(dialog().textContent).toContain('Delete this article from the site?');
    expect(dialog().textContent).toContain('Deletes bab/ from octo/articles and takes it off the lists, the feed and the sitemap, in one commit.');
    expect(dialog().textContent).toContain('The note stays in your case: publish it again to put it back.');
    expect(asks('/api/publishing/github/site/delete')).toHaveLength(0);
    button('Cancel', dialog()).click();
    await settle();
    expect(dialog()).toBeNull();
    expect(rows()).toHaveLength(6);
    expect(asks('/api/publishing/github/site/delete')).toHaveLength(0);
  });

  it('deletes on its confirmation: one commit, the row leaves, and the result line says what was written', async () => {
    await show();
    await readSite();
    await deleteRow('bab');
    expect(asks('/api/publishing/github/site/delete')).toEqual([['/api/publishing/github/site/delete', { folder: 'bab' }]]);
    expect(dialog()).toBeNull();
    expect(row('bab')).toBeNull();
    expect(rows()).toHaveLength(5);
    expect(status().textContent).toContain('Deleted bab/: 3 files written.');
    expect(status().dataset.state).toBe('ok');
    // the tab, the hero, the chips and the categories count it no more, and its weight is off the site's
    expect(tab('Articles').querySelector('.count').textContent).toBe('5');
    expect(chip('Conflict Watch')).toBeUndefined();
    expect(siteRead.data.size.site).toBe(312 * MB - Math.round(4.2 * MB));
    // a category its page names stays, with no article
    const categories = [...target.querySelectorAll('#hub-panel-categories .cats li')];
    expect(categories.map((node) => [node.dataset.category, node.querySelector('.cat-count').textContent]))
      .toEqual([['Methods', '2 articles'], ['Conflict Watch', 'No article yet']]);
    // the next read says when it was read again
    await readSite();
    expect(status().textContent).toMatch(/^Read today at/);
  });

  it('says it is deleting on the confirm press, with a spinner, and is the same press again when refused', async () => {
    await show();
    await readSite();
    let fail;
    serve({ deleted: () => new Promise((_, reject) => { fail = reject; }) });
    button('Delete', row('bab')).click();
    await settle();
    const confirm = button('Delete from the site', dialog());
    confirm.click();
    await settle();
    expect(confirm.textContent.trim()).toBe('Deleting…');
    expect(confirm.querySelector('.busy-spin')).not.toBeNull();
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(button('Cancel', dialog()).disabled).toBe(true);
    fail(refused(409, 'The branch changed on GitHub while Azimut was deleting: press Delete again.'));
    await settle();
    // refused, the dialog is gone and the row's own Delete is there to press again
    expect(dialog()).toBeNull();
    expect(button('Delete', row('bab')).disabled).toBe(false);
    button('Delete', row('bab')).click();
    await settle();
    expect(button('Delete from the site', dialog()).textContent.trim()).toBe('Delete from the site');
    expect(button('Delete from the site', dialog()).querySelector('.busy-spin')).toBeNull();
  });

  it('says only that the folder went when the server counted nothing it removed', async () => {
    await show();
    await readSite();
    serve({ deleted: (body) => ({ ...DELETED(body.folder), removed: null }) });
    await deleteRow('guide');
    expect(status().textContent).toContain('Deleted guide/.');
  });

  it('lists what the server says to mind', async () => {
    await show();
    await readSite();
    serve({ deleted: (body) => ({ ...DELETED(body.folder), written: [], warnings: ['The site holds too many files for Azimut to read: its lists were left.'] }) });
    await deleteRow('guide');
    expect(status().textContent).toContain('Deleted guide/: 0 files written.');
    expect(panel().querySelector('ul[aria-label="To mind"]').textContent).toContain('its lists were left');
  });

  it.each([
    [409, 'The branch changed on GitHub while Azimut was deleting: press Delete again.'],
    [422, 'Azimut deletes only the folders it published.'],
    [422, 'The folder holds more files than Azimut can read: delete it on GitHub.'],
  ])('keeps the row when the server refuses with %s, and says why in the result line', async (code, detail) => {
    await show();
    await readSite();
    serve({ deleted: () => Promise.reject(refused(code, detail)) });
    await deleteRow('bab');
    expect(dialog()).toBeNull();
    expect(status().textContent).toContain(detail);
    expect(status().dataset.state).toBe('error');
    expect(row('bab')).not.toBeNull();
    expect(rows()).toHaveLength(6);
    // and deletes on the next press
    serve();
    await deleteRow('bab');
    expect(row('bab')).toBeNull();
    expect(status().textContent).toContain('Deleted bab/: 3 files written.');
  });

  it('takes the row off when the folder is not on the site any more', async () => {
    await show();
    await readSite();
    serve({ deleted: () => Promise.reject(refused(404, 'That folder is not on the site any more.')) });
    await deleteRow('guide');
    expect(status().textContent).toContain('That folder is not on the site any more.');
    expect(row('guide')).toBeNull();
  });

  it('takes the legal notice off the site when its folder is deleted', async () => {
    await show();
    serve({ read: { ...READ, legal: 'legal-notice/', items: [...READ.items, item('legal-notice', { title: 'Legal notice', role: 'page' })] } });
    await readSite();
    expect(siteRead.data.legal).toBe('legal-notice/');
    await deleteRow('legal-notice');
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

  it('says it is starting on the press, with a spinner, and is the same press again after a failure', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    let fail;
    post.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const press = start('Start a Legal notice page');
    press.click();
    await settle();
    expect(press.textContent.trim()).toBe('Starting…');
    expect(press.querySelector('.busy-spin')).not.toBeNull();
    expect(press.getAttribute('aria-busy')).toBe('true');
    // one at a time: the other press waits too
    expect(start('Start a Privacy page').disabled).toBe(true);
    fail(new Error('The case is read-only.'));
    await settle();
    expect(press.textContent.trim()).toBe('Start a Legal notice page');
    expect(press.querySelector('.busy-spin')).toBeNull();
    expect(press.disabled).toBe(false);
  });

  it('says when a page could not be started, and stays on Settings', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    post.mockRejectedValue(new Error('The case is read-only.'));
    start('Start a Legal notice page').click();
    await settle();
    expect(toast).toHaveBeenCalledWith('Could not start the Legal notice page: The case is read-only.', 'danger');
    start('Start a Privacy page').click();
    await settle();
    expect(toast).toHaveBeenLastCalledWith('Could not start the Privacy page: The case is read-only.', 'danger');
    expect(uiState.tool).toBe('settings');
    expect(start('Start a Legal notice page').disabled).toBe(false);
  });

  it('says a page is on the site once the read found it, and not before', async () => {
    await show();
    expect(pageRow('Legal notice').querySelector('.hub-pill')).toBeNull();
    serve({ read: { ...READ, legal: 'legal-notice/', privacy: '' } });
    await readSite();
    expect(pageRow('Legal notice').querySelector('.hub-pill').textContent).toContain('On the site');
    expect(pageRow('Privacy').querySelector('.hub-pill')).toBeNull();
  });
});
