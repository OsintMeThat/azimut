// @vitest-environment happy-dom
/**
 * Settings › Website, mounted: its sections, what each setting saves and under which key, the
 * statistics choice with its code and token checked before they are sent, Update the site in each
 * state it can answer, and the Legal notice press with a case open and without.
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
const { default: WebsiteTab } = await import('./WebsiteTab.svelte');
const { HAND_EDITED, WORKFLOW_NOTICE } = await import('../../lib/websiteSetup.js');

const NOTHING = { account: '', repo: 'articles', branch: 'main', site: '', base: '', token: { set: false, hint: '' } };
const SET = { account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
  token: { set: true, hint: '…wxyz' }, website: { title: 'Octo Desk', logo: false, counting: '' }, categories: [] };
const CODE = '0123456789abcdef0123456789abcdef';

let live;
let target;
let saved;
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); flushSync(); };
const section = (name) => target.querySelector(`section[aria-label="${name}"]`);
const button = (text, within = target) => [...within.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));
const radio = (name) => [...target.querySelectorAll('[role="radiogroup"][aria-label="Count readers with"] [role="radio"]')].find((node) => node.textContent.trim() === name);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

/** What Settings.svelte hands the tab: a save that adopts the server's answer, as the shell does. */
function savePrefs(patch) {
  const answer = { ...saved, ...patch };
  saved = answer;
  applyPrefs(answer);
  return Promise.resolve(answer);
}

async function show(github = SET) {
  get.mockImplementation(async (path) => {
    if (path === '/api/publishing') return { github, wordpress: { site: '', user: '', password: { set: false, hint: '' } } };
    return {};
  });
  const props = { prefs, savePrefs: vi.fn(savePrefs) };
  live = mount(WebsiteTab, { target, props });
  await settle();
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  saved = { site_title: '', site_tagline: '', site_credit_azimut: true, site_stats: '', site_stats_code: '', site_stats_token: '' };
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
});

describe('the sections', () => {
  it('shows the intro, the site, both places a note goes, the statistics, the update, the legal notice and Make it yours', async () => {
    await show();
    expect([...target.querySelectorAll('h3')].map((node) => node.textContent)).toEqual(
      ['Website', 'Site', 'GitHub Pages', 'WordPress', 'Statistics', 'Update the site', 'Legal notice']);
    const intro = section('Website').textContent;
    expect(intro).toContain('Publish your notes as a simple website on GitHub Pages: a home page and the list of your articles, kept up to date each time you publish.');
    expect(intro).toContain('The site stays yours to change, and Azimut only ever rewrites the files it made.');
    expect(intro).toContain('optional');
    expect(section('Legal notice').textContent).toContain('Depending on your country, a website may need a legal notice.');
    const own = target.querySelector('details.own');
    expect(own.open).toBe(false);
    expect(own.querySelector('summary').textContent).toBe('Make it yours');
    expect([...own.querySelectorAll('li strong')].map((node) => node.textContent)).toEqual(
      ['Your own home page', 'A page per category', 'Your own domain', 'Your own scripts']);
    expect([...own.querySelectorAll('code')].map((node) => node.textContent)).toContain('<!-- azimut:articles -->');
    const link = own.querySelector('a');
    expect(link.getAttribute('href')).toBe('https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(own.textContent).not.toContain('`');
  });

  it('reaches nothing on mount but a local read, and puts a hover text on every setting', async () => {
    await show();
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/api/publishing', '/api/publishing']);
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    for (const control of target.querySelectorAll('input, button, summary, a')) {
      expect(control.getAttribute('title') ?? control.closest('label')?.getAttribute('title'), control.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });
});

describe('the site', () => {
  it('saves the title and the tagline once the field is left, spaces gathered, and says what the title falls back to', async () => {
    const { savePrefs: save } = await show();
    const title = target.querySelector('input[maxlength="120"]');
    const tagline = target.querySelector('input[maxlength="200"]');
    // empty, the title is whatever the server reads it as
    expect(title.getAttribute('placeholder')).toBe('Octo Desk');
    type(title, '  Open   Desk ');
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_title: 'Open Desk' });
    type(tagline, 'Clarity   is the tool.');
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_tagline: 'Clarity is the tool.' });
    expect(prefs.siteTitle).toBe('Open Desk');
    expect(prefs.siteTagline).toBe('Clarity is the tool.');
  });

  it('has the credit on by default and saves it when switched', async () => {
    const { savePrefs: save } = await show();
    const credit = target.querySelector('input[aria-label="Made with Azimut"]');
    expect(credit.checked).toBe(true);
    credit.checked = false;
    credit.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(save).toHaveBeenLastCalledWith({ site_credit_azimut: false });
    expect(prefs.siteCreditAzimut).toBe(false);
  });
});

describe('the statistics', () => {
  it('starts off, with no field and nobody counted, and says what each choice does in a line', async () => {
    await show();
    const choices = [...target.querySelectorAll('[aria-label="Count readers with"] [role="radio"]')];
    expect(choices.map((node) => node.textContent.trim())).toEqual(['Off', 'GoatCounter', 'Cloudflare Web Analytics']);
    expect(radio('Off').getAttribute('aria-checked')).toBe('true');
    expect(target.querySelector('input[aria-label="GoatCounter site code"]')).toBeNull();
    expect(target.querySelector('input[aria-label="Cloudflare token"]')).toBeNull();
    expect(section('Statistics').textContent).toContain('Nobody is counted');
    expect(section('Statistics').textContent).toContain('starts with the next publish or Update the site');
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

  it('counts with Cloudflare Web Analytics from its token or the snippet it shows, field by field, free', async () => {
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
});

describe('Test connection', () => {
  it('says the build of a site made by a workflow must copy Azimut\'s folders through', async () => {
    await show();
    post.mockResolvedValue({ ok: true, login: 'octo', base: 'https://octo.github.io/articles/', pages: 'Pages serves main.', warnings: [WORKFLOW_NOTICE], workflow: true });
    button('Test connection').click();
    await settle();
    expect(post).toHaveBeenCalledWith('/api/publishing/github/test');
    const warnings = target.querySelector('ul[aria-label="To mind"]');
    expect(warnings.textContent).toContain('Pages here is built by a GitHub Actions workflow: its build must copy Azimut\'s folders through to the site.');
  });
});

describe('Update the site', () => {
  const update = () => button('Update the site', section('Update the site'));

  it('waits for GitHub to be set up, and says so on hover', async () => {
    await show({ ...NOTHING, website: { title: '', logo: false, counting: '' }, categories: [] });
    expect(update().disabled).toBe(true);
    expect(update().getAttribute('title')).toBe('Set up GitHub Pages above first');
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
    answer({ ok: true, updated: false, commit: '', written: [], warnings: [], categories: [] });
    await settle();
    expect(section('Update the site').querySelector('.spinner')).toBeNull();
    expect(section('Update the site').querySelector('[role="status"]').textContent).toContain('The site is up to date.');
    expect(update().disabled).toBe(false);
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
  });

  it('shows the press that makes what is missing, then asks to update again', async () => {
    await show();
    post.mockResolvedValueOnce({ ok: false, needs: 'repository', detail: 'There is no repository octo/articles that this token can reach.' });
    update().click();
    await settle();
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

describe('the Legal notice page', () => {
  const start = () => button('Start a Legal notice page');

  it('cannot start with no case open, and says to open one first', async () => {
    await show();
    expect(start().disabled).toBe(true);
    expect(start().getAttribute('title')).toBe('Open a case first: the page is a note of that case');
    start().click();
    await settle();
    expect(post).not.toHaveBeenCalled();
  });

  it('makes the note in the open case, reads the case again and opens the Notebook on it', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    expect(start().disabled).toBe(false);
    post.mockResolvedValue({ id: 'n9', title: 'Legal notice', created: true });
    start().click();
    await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/legal-notice');
    expect(reloadCase).toHaveBeenCalled();
    expect(uiState.tool).toBe('notebook');
    expect(uiState.openNotebook).toEqual({ noteId: 'n9' });
  });

  it('opens the one already made when pressed again', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    post.mockResolvedValue({ id: 'n3', title: 'Legal notice', created: false });
    start().click();
    await settle();
    expect(uiState.openNotebook).toEqual({ noteId: 'n3' });
  });

  it('says when the page could not be started, and stays on Settings', async () => {
    caseState.current = { id: 'c1', name: 'Port strike' };
    await show();
    post.mockRejectedValue(new Error('The case is read-only.'));
    start().click();
    await settle();
    expect(toast).toHaveBeenCalledWith('Could not start the Legal notice: The case is read-only.', 'danger');
    expect(uiState.tool).toBe('settings');
    expect(start().disabled).toBe(false);
  });
});

it('keeps the engine\'s hand-edit warning for the dialog, not this tab', async () => {
  await show();
  expect(target.textContent).not.toContain(HAND_EDITED);
});
