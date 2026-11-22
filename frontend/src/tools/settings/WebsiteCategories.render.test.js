// @vitest-environment happy-dom
/**
 * Settings › Website › Categories, mounted: the categories the read found, with their articles and the pages
 * that name them; Add, which keeps a name on this computer until an article carries it; Rename and Delete,
 * which reach GitHub only through their confirmation, saying what they touch, and whose result the read
 * follows; and on a site whose home page is the analyst's own, what each change asks of their pages and menu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post, put, del } }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams: vi.fn(), asSvg: (svg) => svg }));
const { applyPrefs, caseState, prefs, uiState } = await import('../../lib/state.svelte.js');
const { forgetRead, siteRead } = await import('../../lib/siteRead.svelte.js');
const { default: WebsiteTab } = await import('./WebsiteTab.svelte');

const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
  token: { set: true, hint: '…wxyz' }, website: { title: 'Octo Desk', logo: false, counting: '' }, categories: ['Harbour', 'Roads'], added: [] };
const item = (folder, more = {}) => ({ folder, address: `https://octo.github.io/articles/${folder}/`, title: `Title of ${folder}`, summary: '', date: '2026-11-20',
  date_label: '20 November 2026', category: '', role: 'article', layout: 'article', image: '', bytes: 100, deletable: true, ...more });
const READ = {
  ok: true, address: 'https://octo.github.io/articles/', home: 'azimut',
  items: [item('pier', { category: 'Harbour' }), item('dock', { category: 'Harbour' }), item('road', { category: 'Roads' }),
    item('about', { role: 'page', category: 'Harbour' })],
  categories: [{ name: 'Harbour', count: 2, pages: [] }, { name: 'Roads', count: 1, pages: [] }],
  marked: [], legal: '', privacy: '', last: null, size: { site: 1000, repository: null }, warnings: [],
};
const OWN = {
  ...READ, home: 'yours', marked: ['', 'harbour/', 'ports/'],
  categories: [{ name: 'Harbour', count: 2, pages: ['harbour/', 'ports/'] }, { name: 'Roads', count: 1, pages: [] },
    { name: 'Deep Dives', count: 0, pages: ['deep-dives/'] }],
};
const DONE = (changed) => ({ ok: true, commit: 'c'.repeat(40), changed, written: ['articles.json', 'feed.xml', 'index.html'], warnings: [],
  categories: ['Ports', 'Roads'], added: [] });
const refused = (status, detail) => Object.assign(new Error(detail), { status });

let live;
let target;
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); flushSync(); };
const panel = () => target.querySelector('#hub-panel-categories');
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((node) => node.textContent.trim().startsWith(name));
const button = (text, within = panel()) => [...within.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));
const line = (name) => panel().querySelector(`.cats li[data-category="${name}"]`);
const lines = () => [...panel().querySelectorAll('.cats li')];
const dialog = () => document.querySelector('[role="alertdialog"]');
const status = () => panel().querySelector('.toolbar [role="status"]');
const asks = (path) => post.mock.calls.filter(([called]) => called === path);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

function serve({ github = SET, read = READ, renamed = null, deleted = null, kept = null } = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github, wordpress: { site: '', user: '', password: { set: false, hint: '' } } };
    return {};
  });
  post.mockImplementation(async (path, body) => {
    if (path === '/api/publishing/github/site/read') return read;
    if (path === '/api/publishing/github/categories/rename') return typeof renamed === 'function' ? renamed(body) : (renamed ?? DONE(3));
    if (path === '/api/publishing/github/categories/delete') return typeof deleted === 'function' ? deleted(body) : (deleted ?? DONE(3));
    return {};
  });
  put.mockImplementation(async (path, body) => {
    if (path === '/api/publishing/github/categories/added') {
      return typeof kept === 'function' ? kept(body) : { added: body.names, categories: [...new Set([...github.categories, ...body.names])].sort() };
    }
    return {};
  });
}

async function show(options = {}) {
  serve(options);
  live = mount(WebsiteTab, { target, props: { prefs, savePrefs: vi.fn(async (patch) => patch) } });
  await settle();
  tab('Categories').click();
  await settle();
}

async function readSite() {
  button('Read the site').click();
  await settle();
}

async function rename(name, to) {
  button('Rename', line(name)).click();
  await settle();
  type(line(name).querySelector('input'), to);
  await settle();
  button('Save', line(name)).click();
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetRead();
  applyPrefs({ site_title: '', site_tagline: '', site_credit_azimut: true, site_stats: '', site_stats_code: '', site_stats_token: '', report_name: '' });
  caseState.current = null;
  uiState.tool = 'settings';
  target = document.createElement('div');
  target.className = 'settings-pane';
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
  document.body.innerHTML = '';
  forgetRead();
});

describe('the categories of the site', () => {
  it('has a tab of its own after Articles, asks nothing of GitHub until a press, then lists each with its articles', async () => {
    await show();
    expect(tab('Categories').getAttribute('title')).toBe('Add, rename or delete the categories of the site');
    expect(panel().querySelector('h2').textContent).toBe('How articles are grouped');
    expect(panel().textContent).toContain('Read the site to list its categories.');
    expect(post).not.toHaveBeenCalled();
    await readSite();
    expect(asks('/api/publishing/github/site/read')).toHaveLength(1);
    expect(lines().map((node) => [node.dataset.category, node.querySelector('.cat-count').textContent, node.querySelector('.cat-pages').textContent]))
      .toEqual([['Harbour', '2 articles', 'no page of its own'], ['Roads', '1 article', 'no page of its own']]);
    expect(panel().textContent).toContain('A category gets a page of its own with the markers in Make it yours.');
    // Azimut's own site: nothing said of pages or a menu
    expect(panel().querySelector('.own')).toBeNull();
    for (const control of panel().querySelectorAll('button, a, input')) expect(control.getAttribute('title'), control.outerHTML.slice(0, 90)).toBeTruthy();
  });

  it('says no category is on the site yet when the read finds none', async () => {
    await show({ read: { ...READ, categories: [], items: [] } });
    await readSite();
    expect(panel().textContent).toContain('No category on the site yet.');
  });
});

describe('add', () => {
  it('keeps the name on this computer, offered until an article carries it, and lists it with no article', async () => {
    await show();
    await readSite();
    const field = panel().querySelector('form.add input');
    expect(field.getAttribute('title')).toBe('The name of a category to add');
    expect(button('Add').disabled).toBe(true);
    type(field, '  Rail   yards ');
    await settle();
    expect(button('Add').disabled).toBe(false);
    button('Add').click();
    await settle();
    expect(put).toHaveBeenCalledWith('/api/publishing/github/categories/added', { names: ['Rail yards'] });
    // nothing reaches GitHub for it
    expect(post.mock.calls.map(([path]) => path)).toEqual(['/api/publishing/github/site/read']);
    expect(field.value).toBe('');
    expect(status().textContent).toContain('Rail yards is added.');
    const added = line('Rail yards');
    expect(added.querySelector('.cat-count').textContent).toBe('No article yet');
    expect(added.querySelector('.cat-pages').textContent).toContain('reaches the site with its first article');
    expect(button('Remove', added).getAttribute('title')).toBe('Stop offering this category');
  });

  it('refuses a name the site or this list has already, case aside', async () => {
    await show({ github: { ...SET, added: ['Bridges'] } });
    await readSite();
    const field = panel().querySelector('form.add input');
    type(field, 'harbour');
    await settle();
    expect(button('Add').disabled).toBe(true);
    expect(panel().querySelector('.add-said').textContent).toContain('The site has that category already.');
    type(field, 'BRIDGES');
    await settle();
    expect(panel().querySelector('.add-said').textContent).toContain('You added that category already.');
    expect(put).not.toHaveBeenCalled();
  });

  it('renames and removes an added one here, with no confirmation and nothing sent to GitHub', async () => {
    await show({ github: { ...SET, added: ['Bridges'] } });
    await readSite();
    await rename('Bridges', 'Bridges and tunnels');
    expect(dialog()).toBeNull();
    expect(put).toHaveBeenLastCalledWith('/api/publishing/github/categories/added', { names: ['Bridges and tunnels'] });
    expect(line('Bridges and tunnels')).not.toBeNull();
    button('Remove', line('Bridges and tunnels')).click();
    await settle();
    expect(put).toHaveBeenLastCalledWith('/api/publishing/github/categories/added', { names: [] });
    expect(line('Bridges and tunnels')).toBeNull();
    expect(asks('/api/publishing/github/categories/rename')).toHaveLength(0);
  });
});

describe('rename', () => {
  it('asks first, naming the articles it touches, and reaches GitHub on the confirmation only', async () => {
    await show();
    await readSite();
    button('Rename', line('Harbour')).click();
    await settle();
    const field = line('Harbour').querySelector('input');
    expect(field.value).toBe('Harbour');
    expect(field.getAttribute('title')).toBe('The new name of the category');
    type(field, 'Ports');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(dialog().textContent).toContain('Rename this category?');
    // the page that carries it counts, as every card that names it changes
    expect(dialog().textContent).toContain('Renames Harbour to Ports on 3 articles, and in the lists and the feed, in one commit.');
    expect(dialog().querySelector('.detail')).toBeNull();
    expect(asks('/api/publishing/github/categories/rename')).toHaveLength(0);
    button('Rename', dialog()).click();
    await settle();
    expect(asks('/api/publishing/github/categories/rename')).toEqual([['/api/publishing/github/categories/rename', { name: 'Harbour', to: 'Ports' }]]);
    expect(dialog()).toBeNull();
    expect(status().textContent).toContain('Harbour is Ports now, on 3 articles.');
    expect(lines().map((node) => [node.dataset.category, node.querySelector('.cat-count').textContent])).toEqual([['Ports', '2 articles'], ['Roads', '1 article']]);
    expect(siteRead.data.items.filter((entry) => entry.category === 'Ports')).toHaveLength(3);
  });

  it('says when the new name gathers two categories, and Escape or the same name changes nothing', async () => {
    await show();
    await readSite();
    button('Rename', line('Roads')).click();
    await settle();
    line('Roads').querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(line('Roads').querySelector('input')).toBeNull();
    await rename('Roads', 'Roads');
    expect(dialog()).toBeNull();
    await rename('Roads', 'Harbour');
    expect(dialog().textContent).toContain('Harbour has 2 articles already: they are listed together.');
  });

  it('says it is renaming on the confirm press, and keeps everything when GitHub refuses', async () => {
    await show();
    await readSite();
    let fail;
    serve({ renamed: () => new Promise((_, reject) => { fail = reject; }) });
    await rename('Harbour', 'Ports');
    const confirm = button('Rename', dialog());
    confirm.click();
    await settle();
    expect(confirm.textContent.trim()).toBe('Renaming…');
    expect(confirm.disabled).toBe(true);
    fail(refused(409, 'The branch changed on GitHub while Azimut was changing the categories: press again.'));
    await settle();
    expect(dialog()).toBeNull();
    expect(status().textContent).toContain('press again');
    expect(status().dataset.state).toBe('error');
    expect(line('Harbour')).not.toBeNull();
  });
});

describe('delete', () => {
  it('asks first, saying the articles stay with no category, then the read follows', async () => {
    await show();
    await readSite();
    button('Delete', line('Harbour')).click();
    await settle();
    expect(dialog().textContent).toContain('Delete this category?');
    expect(dialog().textContent).toContain('Takes Harbour off 3 articles, in one commit. They stay on the site, with no category.');
    expect(button('Delete the category', dialog()).className).toContain('btn-danger');
    button('Delete the category', dialog()).click();
    await settle();
    expect(asks('/api/publishing/github/categories/delete')).toEqual([['/api/publishing/github/categories/delete', { name: 'Harbour' }]]);
    expect(status().textContent).toContain('Harbour is deleted: 3 articles left with no category.');
    expect(lines().map((node) => node.dataset.category)).toEqual(['Roads']);
  });

  it('says what is missing when GitHub is not set up for it', async () => {
    await show();
    await readSite();
    serve({ deleted: { ok: false, needs: 'pages', detail: 'Pages is off for octo/articles.' } });
    button('Delete', line('Roads')).click();
    await settle();
    button('Delete the category', dialog()).click();
    await settle();
    expect(panel().textContent).toContain('Pages is off for octo/articles.');
    expect(line('Roads')).not.toBeNull();
  });
});

describe('a site whose home page is the analyst\'s own', () => {
  it('says the menu and the pages stay theirs, on the tab and at each change, naming the pages from what the site holds', async () => {
    await show({ read: OWN });
    await readSite();
    expect(panel().querySelector('.own').textContent).toBe(
      'Your site has its own pages: Azimut updates the articles and the lists; your menu and category pages are yours to change.');
    expect(line('Harbour').querySelector('.cat-pages').textContent).toBe('/harbour/, /ports/ list them');
    // a category only a page names yet is listed, and Azimut has nothing of it to change
    expect(line('Deep Dives').querySelector('.cat-count').textContent).toBe('No article yet');
    expect(button('Rename', line('Deep Dives'))).toBeUndefined();
    await rename('Harbour', 'Ports');
    expect(dialog().querySelector('.detail').textContent).toBe(
      'Your pages /harbour/ and /ports/ list this category by name: change it there too, or their lists will be empty. Rename its link in your menu.');
    button('Cancel', dialog()).click();
    await settle();
    button('Delete', line('Roads')).click();
    await settle();
    expect(dialog().querySelector('.detail').textContent).toBe('Take its link out of your menu.');
    button('Cancel', dialog()).click();
    await settle();
    // an add says how to give it a page and a link
    expect(panel().querySelector('.add-said').textContent).toBe(
      'Add a page and a menu link for it if you want one; its articles already show in your lists.');
    type(panel().querySelector('form.add input'), 'Bridges');
    await settle();
    button('Add').click();
    await settle();
    expect(status().textContent).toContain('Bridges is added. Add a page and a menu link for it if you want one');
  });
});
