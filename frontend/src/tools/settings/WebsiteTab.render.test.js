// @vitest-environment happy-dom
/**
 * Settings › Website as a hub, mounted: its bar of panels and the hero over them, the Overview's
 * checklist, Identity with its live preview and the site logo, Hosting with its limits, Readers (the
 * statistics choice with its code and token checked before they are sent, the feed and the sitemap),
 * Upkeep (Update the site in each state it can answer, who writes what), Make it yours and WordPress.
 * The Articles panel has its own file (`WebsiteArticles.render.test.js`).
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
const copyText = vi.fn(async () => true);
vi.mock('../../lib/clipboard.js', () => ({ copyText }));
const { applyPrefs, caseState, prefs, uiState } = await import('../../lib/state.svelte.js');
const { forgetRead, siteRead } = await import('../../lib/siteRead.svelte.js');
const { default: WebsiteTab } = await import('./WebsiteTab.svelte');
const { HAND_EDITED, WORKFLOW_NOTICE } = await import('../../lib/websiteSetup.js');

const MB = 1024 * 1024;
const GB = 1024 * MB;
const NOTHING = { account: '', repo: 'articles', branch: 'main', site: '', base: '', token: { set: false, hint: '' } };
const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
  token: { set: true, hint: '…wxyz' }, website: { title: 'Octo Desk', logo: false, counting: '' }, categories: [] };
const CODE = '0123456789abcdef0123456789abcdef';
const READ = {
  ok: true, address: 'https://octo.github.io/articles/', home: 'azimut',
  items: [
    { folder: 'bab', address: 'https://octo.github.io/articles/bab/', title: 'The Bab front', summary: '', date: '2026-11-20', date_label: '20 November 2026',
      category: 'Conflict Watch', role: 'article', layout: 'story', image: 'https://octo.github.io/articles/bab/cover.jpg', bytes: 4 * MB },
    { folder: 'bab-map', address: 'https://octo.github.io/articles/bab-map/', title: 'On one map', summary: '', date: '2026-11-19', date_label: '19 November 2026',
      category: '', role: 'article', layout: 'map', image: '', bytes: 3 * MB },
  ],
  categories: [{ name: 'Conflict Watch', count: 1, pages: ['conflict-watch/'] }],
  marked: ['', 'conflict-watch/'], legal: '', privacy: '', last: { date: '2026-11-21T13:55:52Z', message: 'Update the site' },
  size: { site: 312 * MB, repository: Math.round(1.4 * GB) }, warnings: [],
};

let live;
let target;
let saved;
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); flushSync(); };
const section = (name) => target.querySelector(`section[aria-label="${name}"]`);
const panel = (id) => target.querySelector(`#hub-panel-${id}`);
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((node) => node.textContent.trim().startsWith(name));
const button = (text, within = target) => [...within.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));
const radio = (name) => [...target.querySelectorAll('[role="radiogroup"][aria-label="Count readers with"] [role="radio"]')].find((node) => node.textContent.trim() === name);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const typeOnly = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
/** The tab opened, as a press on it opens it. */
const open = async (name) => {
  tab(name).click();
  await settle();
};
/** The press that reads the site, answered with what the test gives. */
async function readSite(answer = READ) {
  post.mockImplementation(async (path) => (path === '/api/publishing/github/site/read' ? answer : {}));
  await open('Articles');
  button('Read the site', panel('articles')).click();
  await settle();
}

/** What Settings.svelte hands the tab: a save that adopts the server's answer, as the shell does. */
function savePrefs(patch) {
  const answer = { ...saved, ...patch };
  saved = answer;
  applyPrefs(answer);
  return Promise.resolve(answer);
}

async function show(github = SET, extra = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github, wordpress: { site: '', user: '', password: { set: false, hint: '' } } };
    return {};
  });
  const props = { prefs, savePrefs: vi.fn(savePrefs), ...extra };
  live = mount(WebsiteTab, { target, props });
  await settle();
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetRead();
  saved = { site_title: '', site_tagline: '', site_credit_azimut: true, site_stats: '', site_stats_code: '', site_stats_token: '', report_name: '',
    signature: false, site_logo: false };
  applyPrefs(saved);
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
  caseState.current = null;
  forgetRead();
});

describe('the bar of panels', () => {
  it('lists the panels in order with WordPress after a divider, opens on the Overview and shows one panel at a time', async () => {
    await show();
    const bar = target.querySelector('[role="tablist"]');
    expect(bar.getAttribute('data-guide')).toBe('settings.website-hub');
    expect([...bar.querySelectorAll('[role="tab"]')].map((node) => node.textContent.trim())).toEqual(
      ['Overview', 'Identity', 'Hosting', 'Articles', 'Readers', 'Upkeep', 'Make it yours', 'WordPress']);
    expect(bar.querySelector('.sep').nextElementSibling.textContent.trim()).toBe('WordPress');
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    expect(panel('overview').hidden).toBe(false);
    for (const id of ['identity', 'hosting', 'articles', 'readers', 'upkeep', 'yours', 'wordpress']) expect(panel(id).hidden, id).toBe(true);
    await open('Hosting');
    expect(tab('Hosting').getAttribute('aria-selected')).toBe('true');
    expect(tab('Overview').getAttribute('aria-selected')).toBe('false');
    expect(panel('hosting').hidden).toBe(false);
    expect(panel('overview').hidden).toBe(true);
    // each panel says what it holds, and is labelled by its tab
    expect(panel('hosting').querySelector('h2').textContent).toBe('Where the site lives');
    expect(panel('hosting').getAttribute('aria-labelledby')).toBe(tab('Hosting').id);
  });

  it('moves between the panels with the arrow keys, and keeps only the open tab in the tab order', async () => {
    await show();
    tab('Overview').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(tab('Identity').getAttribute('aria-selected')).toBe('true');
    expect(tab('Identity').tabIndex).toBe(0);
    expect(tab('Overview').tabIndex).toBe(-1);
    tab('Identity').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    tab('Overview').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await settle();
    // it wraps round to the last
    expect(tab('WordPress').getAttribute('aria-selected')).toBe('true');
    tab('WordPress').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await settle();
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
  });

  it('opens on the panel another part of the app asked for, once', async () => {
    const props = { focus: 'identity' };
    await show(SET, props);
    expect(tab('Identity').getAttribute('aria-selected')).toBe('true');
    expect(panel('identity').hidden).toBe(false);
  });

  it('reaches nothing on mount but a local read, and puts a hover text on every control', async () => {
    await show();
    // the GitHub Pages and WordPress sections each read what this machine kept
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/api/publishing', '/api/publishing']);
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    for (const control of target.querySelectorAll('input, button, summary, a')) {
      expect(control.getAttribute('title') ?? control.closest('label')?.getAttribute('title'), control.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });
});

describe('the hero', () => {
  it('shows the site as it reads now: logo, name, tagline, where it lives and that nothing is read yet', async () => {
    applyPrefs({ site_title: 'Octo Desk', site_tagline: 'Clarity is the tool.', signature: true });
    await show();
    const hero = section('The site at a glance');
    expect(hero.getAttribute('data-guide')).toBe('settings.website');
    expect(hero.querySelector('h1').textContent).toBe('Octo Desk');
    expect(hero.querySelector('.tag').textContent).toBe('Clarity is the tool.');
    // with no logo of its own the site wears the Publishing logo, asked of the one address
    expect(hero.querySelector('img.logo').getAttribute('src')).toMatch(/^\/api\/settings\/site-logo\.png\?v=/);
    const link = hero.querySelector('.where a');
    expect(link.textContent).toBe('octo.github.io/articles');
    expect(link.getAttribute('href')).toBe('https://octo.github.io/articles/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(hero.textContent).toContain('GitHub Pages · octo/articles · main');
    expect(hero.textContent).toContain('Site not read yet');
    expect(hero.textContent).toContain('Readers not counted');
    expect(hero.textContent).not.toContain('Last change');
    expect(hero.querySelector('a.btn').getAttribute('href')).toBe('https://octo.github.io/articles/');
  });

  it('falls back to the Publishing name, else the account, and wears no logo when there is none', async () => {
    applyPrefs({ report_name: 'A. Analyst' });
    await show();
    const hero = section('The site at a glance');
    expect(hero.querySelector('h1').textContent).toBe('A. Analyst');
    expect(hero.querySelector('img.logo')).toBeNull();
    expect(hero.querySelector('.tag')).toBeNull();
    applyPrefs({ report_name: '' });
    await settle();
    expect(hero.querySelector('h1').textContent).toBe('octo');
  });

  it('says its counts, its size, who counts the readers and the last change once the site is read', async () => {
    applyPrefs({ site_stats: 'cloudflare', site_stats_token: CODE });
    await show();
    await readSite();
    const hero = section('The site at a glance');
    expect(hero.textContent).toContain('1 article · 1 map · 312 MB');
    expect(hero.textContent).toContain('Readers counted by Cloudflare Web Analytics');
    expect(hero.textContent).toMatch(/Last change (today|yesterday|\d+ \w+) at \d\d:\d\d|Last change \d+ \w+ \d{4}/);
    expect(hero.textContent).not.toContain('Site not read yet');
  });

  it('has no address to open and cannot update while GitHub is not set up', async () => {
    await show({ ...NOTHING, website: { title: '', logo: false, counting: '' }, categories: [] });
    const hero = section('The site at a glance');
    expect(hero.querySelector('.where a')).toBeNull();
    const open = hero.querySelector('a.btn');
    expect(open.getAttribute('aria-disabled')).toBe('true');
    expect(open.hasAttribute('href')).toBe(false);
    expect(button('Update the site', hero).disabled).toBe(true);
    expect(button('Update the site', hero).getAttribute('title')).toBe('Set up GitHub Pages under Hosting first');
  });
});

describe('the Overview', () => {
  const steps = () => [...panel('overview').querySelectorAll('.check li')];
  const stepOf = (label) => steps().find((node) => node.textContent.includes(label));

  it('shows the four steps from a note to a reader, naming the repository and the site', async () => {
    await show();
    const flow = [...panel('overview').querySelectorAll('.flow .step')];
    expect(flow.map((node) => node.querySelector('h3').textContent)).toEqual(['Write', 'Publish', 'GitHub keeps it', 'Readers find it']);
    expect(flow[2].textContent).toContain('One folder per note in octo/articles.');
    expect(flow[3].textContent).toContain('On octo.github.io, in its lists, its feed and search engines.');
    expect(panel('overview').textContent).toContain('Each publish also refreshes');
    expect([...panel('overview').querySelectorAll('.pill')].map((node) => node.textContent)).toEqual(['the home list', 'the feed', 'the sitemap']);
  });

  it('says the state of each step, asks for a read of what it cannot tell, and opens the panel where it is set', async () => {
    applyPrefs({ site_title: 'Octo Desk', signature: true });
    await show();
    expect(steps().map((node) => node.dataset.state)).toEqual(['done', 'done', 'todo', 'todo', 'unknown', 'unknown']);
    expect(stepOf('Connect GitHub Pages').textContent).toContain('octo/articles on main');
    expect(stepOf('Name the site').textContent).toContain('Octo Desk');
    expect(stepOf('Pick the site').textContent).toContain('Uses your Publishing logo for now.');
    expect(stepOf('Count readers').textContent).toContain('optional');
    expect(stepOf('Count readers').textContent).toContain('Nobody is counted.');
    expect(stepOf('A legal notice').textContent).toContain('Read the site, in Articles, to tell.');
    expect(stepOf('Publish a first article').textContent).toContain('Read the site, in Articles, to tell.');
    expect(panel('overview').textContent).toContain('2 of 6 done. 2 need a read of the site.');
    expect(panel('overview').querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('2');
    button('Identity ›', stepOf('Pick the site')).click();
    await settle();
    expect(panel('identity').hidden).toBe(false);
    expect(tab('Identity').getAttribute('aria-selected')).toBe('true');
    await open('Overview');
    button('Articles ›', stepOf('A legal notice')).click();
    await settle();
    expect(panel('articles').hidden).toBe(false);
    for (const go of panel('overview').querySelectorAll('.go')) expect(go.getAttribute('title')).toBeTruthy();
  });

  it('is done once the site is read and holds an article and a legal notice, and the logo is the site\'s own', async () => {
    applyPrefs({ site_title: 'Octo Desk', site_logo: true, site_stats: 'goatcounter', site_stats_code: 'desk' });
    await show();
    await readSite({ ...READ, legal: 'legal-notice/' });
    await open('Overview');
    expect(steps().map((node) => node.dataset.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(stepOf('A legal notice').textContent).toContain('legal-notice/ is on the site');
    expect(stepOf('Publish a first article').textContent).toContain('2 articles on the site');
    expect(panel('overview').textContent).toContain('6 of 6 done.');
    expect(panel('overview').textContent).not.toContain('need a read');
  });

  it('gives the three tips, and a fourth once the site passes four fifths of what Pages serves', async () => {
    await show();
    const tips = () => [...panel('overview').querySelectorAll('.tips h3')].map((node) => node.textContent);
    expect(tips()).toEqual(['Try before you announce', 'Take an article down', 'Change the name or the logo']);
    expect(panel('overview').querySelector('.tips').textContent).toContain('Publish as Unlisted');
    // 700 MB of the gigabyte is under four fifths
    await readSite({ ...READ, size: { site: 700 * MB, repository: null } });
    await open('Overview');
    expect(tips()).toHaveLength(3);
    await readSite({ ...READ, size: { site: 850 * MB, repository: null } });
    await open('Overview');
    expect(tips()[0]).toBe('The site is getting big');
    expect(panel('overview').textContent).toContain('It weighs 850 MB, 83% of the 1 GB GitHub Pages serves.');
    button('Hosting ›', panel('overview').querySelector('.tips')).click();
    await settle();
    expect(panel('hosting').hidden).toBe(false);
  });
});

describe('Identity', () => {
  const name = () => panel('identity').querySelector('#hub-site-name');
  const tagline = () => panel('identity').querySelector('#hub-site-tagline');
  const preview = () => panel('identity').querySelector('.paper');

  it('saves the name and the tagline once the field is left, spaces gathered, and says what an empty name falls back to', async () => {
    const { savePrefs: save } = await show();
    expect(name().getAttribute('maxlength')).toBe('120');
    expect(tagline().getAttribute('maxlength')).toBe('200');
    // empty, the name is the Publishing name, else the account
    expect(name().getAttribute('placeholder')).toBe('octo');
    expect(panel('identity').textContent).toContain('Empty, it takes your GitHub account, octo.');
    applyPrefs({ report_name: 'A. Analyst' });
    await settle();
    expect(name().getAttribute('placeholder')).toBe('A. Analyst');
    expect(panel('identity').textContent).toContain('Empty, it takes your Publishing name, A. Analyst.');
    type(name(), '  Open   Desk ');
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_title: 'Open Desk' });
    expect(name().value).toBe('Open Desk');
    type(tagline(), 'Clarity   is the tool.');
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_tagline: 'Clarity is the tool.' });
    expect(prefs.siteTitle).toBe('Open Desk');
    expect(prefs.siteTagline).toBe('Clarity is the tool.');
    for (const control of [name(), tagline()]) expect(control.getAttribute('title')).toBeTruthy();
  });

  it('follows what is typed in the hero and in the three previews, before the field is even left', async () => {
    const { savePrefs: save } = await show();
    typeOnly(name(), 'Live Desk');
    typeOnly(tagline(), 'A line as typed.');
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(section('The site at a glance').querySelector('h1').textContent).toBe('Live Desk');
    expect(section('The site at a glance').querySelector('.tag').textContent).toBe('A line as typed.');
    // the bar over an article
    expect(preview().querySelector('[data-preview="name"]').textContent).toBe('Live Desk');
    button('Home page', panel('identity')).click();
    await settle();
    expect(preview().querySelector('[data-preview="name"]').textContent).toBe('Live Desk');
    expect(preview().querySelector('[data-preview="tagline"]').textContent).toBe('A line as typed.');
    expect(preview().querySelector('[data-preview="credit"]').textContent).toMatch(/^Made with Azimut/);
    button('Feed', panel('identity')).click();
    await settle();
    expect(preview().querySelector('[data-preview="name"]').textContent).toBe('Live Desk');
    expect(preview().querySelector('[data-preview="tagline"]').textContent).toBe('A line as typed.');
    // emptied, the name falls back
    typeOnly(name(), '');
    await settle();
    expect(preview().querySelector('[data-preview="name"]').textContent).toBe('octo');
    for (const press of panel('identity').querySelectorAll('.switch button')) expect(press.getAttribute('title')).toBeTruthy();
  });

  it('has the credit on by default, saves it when switched and takes it off the home preview', async () => {
    const { savePrefs: save } = await show();
    const credit = target.querySelector('input[aria-label="Made with Azimut"]');
    expect(credit.checked).toBe(true);
    button('Home page', panel('identity')).click();
    await settle();
    expect(preview().querySelector('[data-preview="credit"]')).not.toBeNull();
    credit.checked = false;
    credit.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_credit_azimut: false });
    expect(prefs.siteCreditAzimut).toBe(false);
    expect(preview().querySelector('[data-preview="credit"]')).toBeNull();
  });

  it('shows the real articles and categories of a read site in the previews, a sample before', async () => {
    await show();
    button('Home page', panel('identity')).click();
    await settle();
    expect(preview().textContent).toContain('The title of your latest article');
    await readSite();
    await open('Identity');
    expect(preview().textContent).toContain('The Bab front');
    expect(preview().textContent).toContain('Conflict Watch');
    expect(preview().textContent).not.toContain('The title of your latest article');
  });

  it('says the home page is the analyst\'s own when the read found one', async () => {
    await show();
    expect(panel('identity').textContent).not.toContain('Your home page');
    await readSite({ ...READ, home: 'yours' });
    await open('Identity');
    expect(panel('identity').querySelector('.own-home').textContent).toContain('octo.github.io has a home page of your own: Azimut fills its lists and leaves its header as you wrote it.');
    await readSite({ ...READ, home: 'azimut' });
    await open('Identity');
    expect(panel('identity').querySelector('.own-home')).toBeNull();
  });
});

describe('the site logo', () => {
  const file = (bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3], name = 'logo.png') => new File([new Uint8Array(bytes)], name, { type: 'image/png' });
  const input = () => panel('identity').querySelector('input[type="file"]');
  const pick = async (picked) => {
    Object.defineProperty(input(), 'files', { value: [picked], configurable: true });
    input().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  };
  const shown = () => panel('identity').querySelector('img.well');

  it('says it uses the Publishing logo when it has none of its own, and offers a PNG to pick', async () => {
    applyPrefs({ signature: true });
    await show();
    expect(shown().getAttribute('src')).toMatch(/^\/api\/settings\/site-logo\.png\?v=/);
    expect(panel('identity').textContent).toContain('The Publishing logo, the one on your reports.');
    expect(input().getAttribute('accept')).toBe('image/png');
    expect(button('Choose a PNG…', panel('identity')).getAttribute('title')).toBe('Pick a square PNG as the logo of the site');
    // nothing to put back while the site has none of its own
    expect(button('Use the Publishing logo', panel('identity'))).toBeUndefined();
  });

  it('says there is no logo when neither is set, and shows no picture', async () => {
    await show();
    expect(shown()).toBeNull();
    expect(panel('identity').textContent).toContain('A square PNG, up to 2 MB. The pages carry no logo until you pick one.');
    expect(section('The site at a glance').querySelector('img.logo')).toBeNull();
  });

  it('sends the picked PNG as the file, then shows it and asks the logo again', async () => {
    await show();
    post.mockResolvedValue({ site_logo: true });
    const before = prefs.picturesRev;
    await pick(file());
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/api/settings/site-logo');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file').name).toBe('logo.png');
    expect(prefs.siteLogoSet).toBe(true);
    expect(prefs.picturesRev).toBe(before + 1);
    expect(toast).toHaveBeenCalledWith('Site logo saved', 'ok');
    expect(shown().getAttribute('src')).toContain(`.${before + 1}`);
    expect(panel('identity').textContent).toContain('A picture of its own, on every page of the site.');
    expect(section('The site at a glance').querySelector('img.logo')).not.toBeNull();
  });

  it('refuses a file that is no PNG or is over 2 MB, before sending anything', async () => {
    await show();
    await pick(file([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6], 'logo.jpg'));
    expect(toast).toHaveBeenLastCalledWith('The logo must be a PNG picture', 'danger');
    const big = file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    Object.defineProperty(big, 'size', { value: 3 * MB });
    await pick(big);
    expect(toast).toHaveBeenLastCalledWith('The logo must be under 2 MB', 'danger');
    expect(post).not.toHaveBeenCalled();
    expect(prefs.siteLogoSet).toBe(false);
  });

  it('says what the server refused and keeps what it had', async () => {
    await show();
    post.mockRejectedValue(new Error('That is not a PNG picture.'));
    await pick(file());
    expect(toast).toHaveBeenLastCalledWith('Could not save the site logo: That is not a PNG picture.', 'danger');
    expect(prefs.siteLogoSet).toBe(false);
  });

  it('puts the Publishing logo back with Use the Publishing logo', async () => {
    applyPrefs({ site_logo: true, signature: true });
    await show();
    expect(panel('identity').textContent).toContain('A picture of its own, on every page of the site.');
    del.mockResolvedValue({ site_logo: false });
    const before = prefs.picturesRev;
    button('Use the Publishing logo', panel('identity')).click();
    await settle();
    expect(del).toHaveBeenCalledWith('/api/settings/site-logo');
    expect(prefs.siteLogoSet).toBe(false);
    expect(prefs.picturesRev).toBe(before + 1);
    expect(panel('identity').textContent).toContain('The Publishing logo, the one on your reports.');
    expect(button('Use the Publishing logo', panel('identity'))).toBeUndefined();
  });
});

describe('Hosting', () => {
  const bar = (label) => panel('hosting').querySelector(`[role="meter"][aria-label="${label}"]`);

  it('holds the GitHub Pages settings as a card, says it is set up, and gives the address with what to do for a domain of one\'s own', async () => {
    await show();
    const github = panel('hosting').querySelector('section[aria-label="GitHub Pages"]');
    expect(github.querySelector('.badge').textContent).toBe('Set up');
    expect(panel('hosting').textContent).toContain('https://octo.github.io/articles/');
    expect(panel('hosting').textContent).toContain('GitHub\'s address');
    expect(panel('hosting').textContent).toContain('Set in the repository\'s CNAME file.');
    expect(panel('hosting').textContent).toContain('A domain of your own');
    const guide = [...panel('hosting').querySelectorAll('a')].find((node) => node.textContent.includes('GitHub\'s guide'));
    expect(guide.getAttribute('href')).toBe('https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site');
  });

  it('says the site has a domain of its own when its address is not on github.io', async () => {
    await show({ ...SET, site: 'https://news.example.org/', base: 'https://news.example.org/' });
    expect(panel('hosting').textContent).toContain('Your own domain');
    expect(panel('hosting').textContent).toContain('https://news.example.org/');
  });

  it('is not set up with nothing set: no badge, and the address says to set up first', async () => {
    await show({ ...NOTHING, website: { title: '', logo: false, counting: '' }, categories: [] });
    expect(panel('hosting').querySelector('section[aria-label="GitHub Pages"] .badge')).toBeNull();
    expect(panel('hosting').textContent).toContain('Set up GitHub Pages first, and the address shows here.');
  });

  it('says its limits as the contract gives them, with GitHub\'s own page, and asks for a read to show the sizes', async () => {
    await show();
    const limits = section('Limits');
    expect([...limits.querySelectorAll('.limits li')].map((node) => node.textContent)).toEqual([
      'The site: 1 GB at most.',
      'The repository: under 1 GB recommended, its history included.',
      'Readers: 100 GB of traffic a month, a soft limit.',
      'Builds: 10 an hour, a soft limit.',
      'A file: 50 MB at most in Azimut. GitHub warns from 50 MB and refuses past 100 MB.',
      'One publish: 200 MB and 1,000 files at most.',
      'Not for a shop, a paid service, or passwords and card numbers.',
    ]);
    const link = [...limits.querySelectorAll('a')].find((node) => node.textContent.includes('GitHub\'s limits'));
    expect(link.getAttribute('href')).toBe('https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits');
    expect(link.getAttribute('title')).toBe('GitHub\'s own page of Pages limits');
    expect(limits.textContent).toContain('Read the site to see its size.');
    expect(bar('Site').getAttribute('data-level')).toBe('none');
    expect(bar('Site').hasAttribute('aria-valuenow')).toBe(false);
  });

  it('reads the site from the limits too, on its press only, then draws both bars', async () => {
    await show();
    post.mockResolvedValue(READ);
    expect(post).not.toHaveBeenCalled();
    button('Read the site', section('Limits')).click();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/publishing/github/site/read');
    const limits = section('Limits');
    expect(limits.textContent).toContain('Site: 312 MB of 1 GB');
    expect(limits.textContent).toContain('Repository with its history: 1.4 GB of 1 GB recommended');
    expect(limits.textContent).not.toContain('Read the site to see its size.');
    // 312 MB of a gigabyte is under four fifths; the repository is past it
    expect(bar('Site').getAttribute('data-level')).toBe('ok');
    expect(bar('Site').getAttribute('aria-valuenow')).toBe('30');
    expect(bar('Repository with its history').getAttribute('data-level')).toBe('danger');
    expect(bar('Repository with its history').querySelector('i').style.width).toBe('100%');
    expect(limits.querySelector('.usage').getAttribute('title')).toBe('How much the published site weighs, of the 1 GB GitHub Pages serves');
  });

  it.each([[0.5, 'ok'], [0.79, 'ok'], [0.8, 'warn'], [0.94, 'warn'], [0.95, 'danger'], [1.2, 'danger']])(
    'turns the bar of a site at %s of the gigabyte %s', async (share, level) => {
      await show();
      await readSite({ ...READ, size: { site: Math.ceil(share * GB), repository: null } });
      await open('Hosting');
      expect(bar('Site').getAttribute('data-level')).toBe(level);
      // a repository the server gave no size for has no bar to draw
      expect(bar('Repository with its history').getAttribute('data-level')).toBe('none');
    });
});

describe('Readers', () => {
  it('starts off, with no field and nobody counted, and says what each choice does in a line', async () => {
    await show();
    const choices = [...target.querySelectorAll('[aria-label="Count readers with"] [role="radio"]')];
    expect(choices.map((node) => node.textContent.trim())).toEqual(['Off', 'GoatCounter', 'Cloudflare Web Analytics']);
    expect(radio('Off').getAttribute('aria-checked')).toBe('true');
    expect(target.querySelector('input[aria-label="GoatCounter site code"]')).toBeNull();
    expect(target.querySelector('input[aria-label="Cloudflare token"]')).toBeNull();
    expect(section('Statistics').getAttribute('data-guide')).toBe('settings.statistics');
    expect(section('Statistics').textContent).toContain('Nobody is counted');
    expect(section('Statistics').textContent).toContain('starts with the next publish or Update the site');
    expect(target.querySelector('a[href^="https://dash.cloudflare.com/?to="]')).toBeNull();
  });

  it('counts with GoatCounter once chosen and its code is typed, a site address included, and refuses what is no code', async () => {
    const { savePrefs: save } = await show();
    radio('GoatCounter').click();
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats: 'goatcounter' });
    expect(radio('GoatCounter').getAttribute('aria-checked')).toBe('true');
    const code = target.querySelector('input[aria-label="GoatCounter site code"]');
    // named without its code, it says so rather than pretend to count
    expect(section('Statistics').textContent).toContain('Paste the site code below for the count to start.');
    // the steps are open while the code is missing, free, with the sign-up
    const steps = section('Statistics').querySelector('details.how');
    expect(steps.open).toBe(true);
    expect(steps.textContent).toContain('Make a free account at goatcounter.com');
    expect(steps.querySelector('a').getAttribute('href')).toBe('https://www.goatcounter.com/signup');
    save.mockClear();
    type(code, 'not a code!');
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(section('Statistics').querySelector('[role="alert"]').textContent).toContain('does not read as a GoatCounter code');
    type(code, 'https://Desk-1.goatcounter.com/');
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats_code: 'desk-1' });
    expect(code.value).toBe('desk-1');
    expect(section('Statistics').querySelector('[role="alert"]')).toBeNull();
    expect(section('Statistics').textContent).toContain('Counting every page of the site.');
    expect(section('Statistics').querySelector('details.how').open).toBe(false);
    // emptied, the count has no code again: saved as none
    type(code, '');
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats_code: '' });
  });

  it('counts with Cloudflare Web Analytics from its token or the snippet it shows, with its dashboard a press away, free', async () => {
    const { savePrefs: save } = await show();
    radio('Cloudflare Web Analytics').click();
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats: 'cloudflare' });
    expect(target.querySelector('input[aria-label="GoatCounter site code"]')).toBeNull();
    const token = target.querySelector('input[aria-label="Cloudflare token"]');
    expect(section('Statistics').textContent).toContain('Free. Loads one script from static.cloudflareinsights.com and counts with no cookie.');
    const steps = section('Statistics').querySelector('details.how');
    expect(steps.open).toBe(true);
    for (const said of ['Make a free account at cloudflare.com', 'Web Analytics', 'Add a site', 'Manage site', 'data-cf-beacon']) expect(steps.textContent, said).toContain(said);
    expect([...steps.querySelectorAll('a')].map((node) => node.getAttribute('href'))).toEqual(
      ['https://dash.cloudflare.com/sign-up', 'https://developers.cloudflare.com/web-analytics/get-started/']);
    const dashboard = [...section('Statistics').querySelectorAll('a')].find((node) => node.textContent.includes('Open Cloudflare\'s dashboard'));
    expect(dashboard.getAttribute('href')).toBe('https://dash.cloudflare.com/?to=/:account/web-analytics');
    expect(dashboard.getAttribute('target')).toBe('_blank');
    expect(dashboard.getAttribute('rel')).toContain('noopener');
    save.mockClear();
    type(token, 'too short');
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(section('Statistics').querySelector('[role="alert"]').textContent).toContain('does not read as a Cloudflare token');
    type(token, `<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${CODE}"}'></script>`);
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats_token: CODE });
    expect(token.value).toBe(CODE);
    expect(section('Statistics').querySelector('[role="alert"]')).toBeNull();
    expect(section('Statistics').textContent).toContain('Counting every page of the site.');
  });

  it('turns off again, and shows the code the server kept after a backup restored it', async () => {
    const { savePrefs: save } = await show();
    radio('GoatCounter').click();
    await settle();
    radio('Off').click();
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_stats: '' });
    expect(target.querySelector('input[aria-label="GoatCounter site code"]')).toBeNull();
    applyPrefs({ site_stats: 'goatcounter', site_stats_code: 'restored' });
    await settle();
    expect(target.querySelector('input[aria-label="GoatCounter site code"]').value).toBe('restored');
    // the same choice again is no press
    save.mockClear();
    radio('GoatCounter').click();
    await settle();
    expect(save).not.toHaveBeenCalled();
  });

  it('gives the feed and the sitemap addresses, built from the site\'s address, each with a Copy press', async () => {
    await show();
    const follow = [...panel('readers').querySelectorAll('section')].find((node) => node.textContent.includes('Follow and find'));
    expect([...follow.querySelectorAll('code')].map((node) => node.textContent)).toEqual([
      'https://octo.github.io/articles/feed.xml', 'https://octo.github.io/articles/sitemap.xml']);
    expect(follow.textContent).toContain('Readers subscribe to the feed with any feed reader.');
    expect(follow.textContent).toContain('Google Search Console or Bing Webmaster Tools');
    const [feed, sitemap] = [...follow.querySelectorAll('button')];
    expect([feed.getAttribute('title'), sitemap.getAttribute('title')]).toEqual(['Copy the address of the feed', 'Copy the address of the sitemap']);
    feed.click();
    await settle();
    expect(copyText).toHaveBeenLastCalledWith('https://octo.github.io/articles/feed.xml', { said: 'Feed address copied' });
    sitemap.click();
    await settle();
    expect(copyText).toHaveBeenLastCalledWith('https://octo.github.io/articles/sitemap.xml', { said: 'Sitemap address copied' });
    expect(post).not.toHaveBeenCalled();
  });

  it('builds them on the site\'s own domain once the read says it has one, and on nothing while GitHub is not set up', async () => {
    await show();
    await readSite({ ...READ, address: 'https://news.example.org/' });
    await open('Readers');
    expect([...panel('readers').querySelectorAll('code')].map((node) => node.textContent)).toEqual([
      'https://news.example.org/feed.xml', 'https://news.example.org/sitemap.xml']);
    unmount(live);
    forgetRead();
    await show({ ...NOTHING, website: { title: '', logo: false, counting: '' }, categories: [] });
    expect(panel('readers').textContent).toContain('Set up GitHub Pages first, and the addresses show here.');
    for (const press of panel('readers').querySelectorAll('.copyline button')) expect(press.disabled).toBe(true);
  });
});

describe('Upkeep: Update the site', () => {
  const update = () => button('Update the site', section('Update the site'));

  it('waits for GitHub to be set up, and says so on hover', async () => {
    await show({ ...NOTHING, website: { title: '', logo: false, counting: '' }, categories: [] });
    expect(update().disabled).toBe(true);
    expect(update().getAttribute('title')).toBe('Set up GitHub Pages under Hosting first');
    update().click();
    await settle();
    expect(post).not.toHaveBeenCalled();
  });

  it('asks GitHub on its press only, shows it working, and says the site is up to date', async () => {
    await show();
    expect(update().disabled).toBe(false);
    expect(post).not.toHaveBeenCalled();
    let answer;
    post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    update().click();
    await settle();
    expect(post).toHaveBeenCalledWith('/api/publishing/github/site');
    expect(section('Update the site').querySelector('.spinner')).not.toBeNull();
    expect(section('Update the site').textContent).toContain('Updating octo/articles…');
    expect(update().disabled).toBe(true);
    // the hero says it too, and cannot be pressed again
    expect(section('The site at a glance').textContent).toContain('Updating octo/articles…');
    expect(button('Update the site', section('The site at a glance')).disabled).toBe(true);
    answer({ ok: true, updated: false, commit: '', written: [], warnings: [], categories: [] });
    await settle();
    expect(section('Update the site').querySelector('.spinner')).toBeNull();
    expect(section('Update the site').querySelector('[role="status"]').textContent).toContain('The site is up to date.');
    expect(section('The site at a glance').textContent).toContain('The site is up to date.');
    expect(update().disabled).toBe(false);
  });

  it('is pressed from the hero as well, the same press, saying its result in both places and when', async () => {
    await show();
    post.mockResolvedValue({ ok: true, updated: true, commit: 'c'.repeat(40), written: ['articles.json'], warnings: [], categories: [] });
    button('Update the site', section('The site at a glance')).click();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(section('Update the site').textContent).toContain('The site is updated: 1 file written.');
    expect(section('Update the site').querySelector('.when').textContent).toMatch(/^today at \d\d:\d\d$/);
    expect(section('The site at a glance').textContent).toContain('The site is updated: 1 file written.');
  });

  it('says how many files it wrote, and lists the warnings under it', async () => {
    await show();
    post.mockResolvedValue({ ok: true, updated: true, commit: 'c'.repeat(40), written: ['articles.json', 'feed.xml'],
      warnings: ['feed.xml is yours: it was left as it is.'], categories: ['Harbour'] });
    update().click();
    await settle();
    expect(section('Update the site').textContent).toContain('The site is updated: 2 files written.');
    expect([...section('Update the site').querySelectorAll('ul[aria-label="To mind"] li')].map((node) => node.textContent.trim())).toEqual(
      ['feed.xml is yours: it was left as it is.']);
  });

  it('says what went wrong in the words the server gave', async () => {
    await show();
    post.mockRejectedValue(new Error('GitHub did not answer.'));
    update().click();
    await settle();
    const said = section('Update the site').querySelector('[role="status"]');
    expect(said.textContent).toContain('GitHub did not answer.');
    expect(said.dataset.state).toBe('error');
    expect(section('The site at a glance').querySelector('.status').dataset.state).toBe('error');
  });

  it('says the last change on GitHub from the read, until it is pressed here', async () => {
    await show();
    expect(section('Update the site').textContent).not.toContain('Last change on GitHub');
    await readSite();
    await open('Upkeep');
    expect(section('Update the site').textContent).toMatch(/Last change on GitHub .*: Update the site\./);
  });

  it('shows the press that makes what is missing, then asks to update again', async () => {
    await show();
    post.mockResolvedValueOnce({ ok: false, needs: 'repository', detail: 'There is no repository octo/articles that this token can reach.' });
    // pressed from the hero, which sends the analyst where the press is
    button('Update the site', section('The site at a glance')).click();
    await settle();
    expect(panel('upkeep').hidden).toBe(false);
    expect(section('Update the site').textContent).toContain('There is no repository octo/articles that this token can reach.');
    post.mockResolvedValueOnce({ ok: true, repository: 'octo/articles' });
    button('Create the repository', section('Update the site')).click();
    await settle();
    expect(post).toHaveBeenLastCalledWith('/api/publishing/github/repository');
    expect(section('Update the site').textContent).toContain('Pages is off for octo/articles.');
    post.mockResolvedValueOnce({ ok: true, base: 'https://octo.github.io/articles/' });
    button('Turn on Pages', section('Update the site')).click();
    await settle();
    expect(post).toHaveBeenLastCalledWith('/api/publishing/github/pages');
    expect(section('Update the site').textContent).toContain('Pages is on. Press Update the site.');
    expect(section('Update the site').querySelector('.needs')).toBeNull();
  });
});

describe('Upkeep: who writes what, and the chores', () => {
  const rows = () => [...panel('upkeep').querySelectorAll('.own-table tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent.trim()));

  it('says which files are Azimut\'s and which stay the analyst\'s, the default home as Azimut\'s until a read says otherwise', async () => {
    await show();
    expect(rows().map(([file, who]) => [file, who])).toEqual([
      ['each article\'s folder', 'Azimut'], ['articles.jsonfeed.xmlsitemap.xml', 'Azimut'], ['index.html', 'Azimut'], ['everything else', 'You']]);
    expect(panel('upkeep').textContent).toContain('Read the site, in Articles, to see which of your pages Azimut fills.');
  });

  it('lists the pages the read found marked, and the home page as the analyst\'s when it is', async () => {
    await show();
    await readSite({ ...READ, home: 'yours', marked: ['', 'investigations/', 'conflict-watch/'] });
    await open('Upkeep');
    expect(rows().map(([file, who]) => [file, who])).toEqual([
      ['each article\'s folder', 'Azimut'], ['articles.jsonfeed.xmlsitemap.xml', 'Azimut'], ['index.html', 'You'],
      ['investigations/conflict-watch/', 'You'], ['everything else', 'You']]);
    expect(rows()[2][2]).toBe('Fills the list between its markers, nothing else.');
    expect(panel('upkeep').textContent).not.toContain('to see which of your pages');
  });

  it('gives the five usual chores, the first open, each with a hover text', async () => {
    await show();
    const chores = [...panel('upkeep').querySelectorAll('.chores details')];
    expect(chores.map((node) => node.querySelector('summary').textContent)).toEqual([
      'Take an article down', 'Move an article to another category', 'Rename the site or change its logo', 'Fix a typo on GitHub directly',
      'Test an article before it shows']);
    expect(chores.map((node) => node.open)).toEqual([true, false, false, false, false]);
    expect(chores[0].textContent).toContain('Press Delete on its line in Articles.');
    expect(chores[4].textContent).toContain('Publish it as Unlisted');
  });
});

describe('Make it yours and WordPress', () => {
  it('gives the four ways to change what Azimut makes, in the engine\'s words, with what to write', async () => {
    await show();
    const own = panel('yours').querySelector('[data-guide="settings.website-own"]');
    expect([...own.querySelectorAll('h3')].map((node) => node.textContent)).toEqual(
      ['Your own home page', 'A page per category', 'Your own domain', 'Your own scripts']);
    expect([...own.querySelectorAll('code')].map((node) => node.textContent)).toContain('<!-- azimut:articles -->');
    expect(own.querySelectorAll('pre')).toHaveLength(3);
    expect(own.querySelector('pre').textContent).toContain('<!-- azimut:articles -->');
    const link = own.querySelector('a');
    expect(link.getAttribute('href')).toBe('https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(own.textContent).not.toContain('`');
    expect(own.textContent).toContain('Write your index.html and put');
  });

  it('keeps WordPress apart, with its own section', async () => {
    await show();
    await open('WordPress');
    expect(panel('wordpress').querySelector('h2').textContent).toBe('Also send to WordPress');
    expect(panel('wordpress').querySelector('section[aria-label="WordPress"]').getAttribute('data-guide')).toBe('settings.wordpress');
    expect(panel('hosting').querySelector('section[aria-label="WordPress"]')).toBeNull();
  });
});

describe('Test connection', () => {
  it('says the build of a site made by a workflow must copy Azimut\'s folders through', async () => {
    await show();
    await open('Hosting');
    post.mockResolvedValue({ ok: true, login: 'octo', base: 'https://octo.github.io/articles/', pages: 'Pages serves main.', warnings: [WORKFLOW_NOTICE], workflow: true });
    button('Test connection').click();
    await settle();
    expect(post).toHaveBeenCalledWith('/api/publishing/github/test');
    const warnings = panel('hosting').querySelector('ul[aria-label="To mind"]');
    expect(warnings.textContent).toContain('Pages here is built by a GitHub Actions workflow: its build must copy Azimut\'s folders through to the site.');
  });
});

describe('what the session keeps', () => {
  it('keeps the read across a visit to another tab of Settings, and drops it for another repository', async () => {
    await show();
    await readSite();
    expect(siteRead.data.items).toHaveLength(2);
    unmount(live);
    live = null;
    // the same repository, back on the tab: the read is still there, and nothing was asked again
    post.mockClear();
    await show();
    expect(siteRead.data.items).toHaveLength(2);
    expect(post).not.toHaveBeenCalled();
    expect(tab('Articles').textContent).toContain('2');
    unmount(live);
    live = null;
    await show({ ...SET, repo: 'elsewhere', base: 'https://octo.github.io/elsewhere/' });
    expect(siteRead.data).toBeNull();
  });
});

it('keeps the engine\'s hand-edit warning for the dialog, not this tab', async () => {
  await show();
  expect(target.textContent).not.toContain(HAND_EDITED);
});
