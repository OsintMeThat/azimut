/**
 * How to put a web folder on GitHub Pages, said the same way wherever it is needed.
 *
 * The folder carries these steps as `HOW-TO-PUBLISH.md`, written by the server from
 * its own copy (`engine/notes_web.py`, `PAGES_*`), and the export dialog shows them
 * under How to publish. A test holds the two copies to the same words, so a step
 * changed in one place is changed in both.
 */

/** Where a free account is opened. */
export const PAGES_SIGNUP = 'https://github.com/signup';

export const PAGES_INTRO = 'GitHub Pages puts this folder on the web for free, at an address you can share on X. It all happens on github.com in your browser, with no command line.';

export const PAGES_PUBLIC = 'A Pages site is public: anyone with the address can read it, and search engines can find it. The folder holds the public edition only.';

export const PAGES_STEPS = Object.freeze([
  'Sign up for a free account at github.com, unless you have one. Your username goes in every address.',
  'Press + at the top right, then New repository. Name it articles, keep it Public, switch on Add README, and press Create repository. You make it once: every article goes in it as a folder.',
  'Pick a short name for this article, such as port-strike. Its address will be https://your-name.github.io/articles/port-strike/, with your username in lower case.',
  'In Azimut, type that address under Address it will live at, and export the web folder. The folder takes the short name, and X gets its picture card.',
  'In the repository, press Add file › Upload files. Drag the folder itself onto the page, not the files inside it, then press Commit changes.',
  'The first time only: open Settings › Pages. Under Build and deployment, choose Deploy from a branch, then main and / (root), and press Save.',
  'Wait about a minute, then open the address. Share it on X like any link.',
]);

export const PAGES_UPDATE = 'Export the note again from Azimut and upload its folder the same way: the new files replace the old ones at the same address.';

export const PAGES_CARD = 'The address typed in Azimut is what gives X its picture card, share.jpg in the folder. Without it, X shows the link alone.';

// -- publishing from Azimut in one press (Settings › Publishing › GitHub Pages) --------

/** The repository and the branch Settings starts from, as the server does (`engine/githubpages.py`). */
export const DEFAULT_REPO = 'articles';
export const DEFAULT_BRANCH = 'main';

/** The four fields, each with what to type. */
export const GITHUB_FIELDS = Object.freeze([
  ['Account', 'Your GitHub username, or the organisation the repository belongs to.'],
  ['Repository', 'Where the articles go, one folder each: articles unless you named it otherwise.'],
  ['Branch', 'The branch Pages serves: main unless you changed it.'],
  ['Token', 'A fine-grained personal access token that reaches that one repository, made as below.'],
]);

/** What it costs, where the token stays, and that the site is public. */
export const GITHUB_FREE = 'Free: a GitHub account, a public repository and Pages cost nothing. The token stays on this computer, never in a backup.';

/** How to make the token, limited to the one repository with exactly what publishing needs. */
export const TOKEN_STEPS = Object.freeze([
  'Make the repository first: a token can only be limited to a repository that exists.',
  'On github.com, press your picture at the top right, then Settings › Developer settings › Personal access tokens › Fine-grained tokens, and Generate new token. The link below opens that page with the permissions picked.',
  'Name it Azimut and pick when it expires. Under Repository access, choose Only select repositories and pick the repository.',
  'Under Permissions, set Contents and Pages to Read and write. Metadata, Read-only, comes with them.',
  'Press Generate token, copy the token GitHub shows once, and paste it under Token.',
]);

/** What the two setup presses need beyond that, and what to do without it. */
export const TOKEN_MORE = 'To let Azimut turn Pages on for you, also set Administration to Read and write. Without it, turn Pages on in the repository yourself.';

/** When the token cannot make the repository: the two steps on github.com. */
export const REPO_STEPS = Object.freeze([
  'On github.com, press + at the top right, then New repository. Name it, keep it Public, switch on Add README, and press Create repository.',
  'Let the token reach it: open the token under Settings › Developer settings › Fine-grained tokens, add the repository under Repository access, and save.',
]);

/** How to turn Pages on by hand, when the token may not. */
export const PAGES_BY_HAND = 'In the repository on github.com, open Settings › Pages. Under Build and deployment, choose Deploy from a branch, then the branch and / (root), and press Save.';

/** What each setup press does, said beside it. */
export const CREATE_SAID = 'Makes a public repository under your account, with a README, for Pages to serve.';
export const PAGES_ON_SAID = 'Serves the branch from its root. The site is public.';

/** The token page with Contents and Pages picked (GitHub's token templates, docs.github.com). */
export function tokenLink(account = '') {
  const query = new URLSearchParams({ name: 'Azimut', description: 'Publish reports to GitHub Pages', contents: 'write', pages: 'write' });
  const owner = accountProblem(account) ? '' : String(account ?? '').trim().replace(/^@/, '');
  if (owner) query.set('target_name', owner);
  return `https://github.com/settings/personal-access-tokens/new?${query}`;
}

/** The new-repository page with the name and Public picked. */
export function newRepositoryLink(account = '', repo = DEFAULT_REPO) {
  const query = new URLSearchParams({ name: repo || DEFAULT_REPO, visibility: 'public' });
  const owner = accountProblem(account) ? '' : String(account ?? '').trim().replace(/^@/, '');
  if (owner) query.set('owner', owner);
  return `https://github.com/new?${query}`;
}

/** The repository's own Pages settings, where Pages is turned on by hand. */
export function pagesSettingsLink(account, repo) {
  return `https://github.com/${encodeURIComponent(account)}/${encodeURIComponent(repo)}/settings/pages`;
}

/** Whether publishing is set up: an account, a repository, a branch and a token kept. */
export function githubReady(state) {
  return Boolean(state?.account && state?.repo && state?.branch && state?.token?.set);
}

/**
 * Where the articles live: the address Pages last said the site has (a custom domain
 * included), else `https://<account>.github.io/<repo>/`, or the account's own site for
 * a repository named `<account>.github.io`, as `githubpages.site_base` says it.
 */
export function siteBase(account, repo, site = '') {
  if (site) {
    try {
      const url = new URL(site);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        url.protocol = 'https:';
        url.search = '';
        url.hash = '';
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        if (url.hostname.includes('.')) return url.href;
      }
    } catch { /* not an address: the default stands */ }
  }
  const host = `${String(account ?? '').toLowerCase()}.github.io`;
  return String(repo ?? '').toLowerCase() === host ? `https://${host}/` : `https://${host}/${repo}/`;
}

/** What is wrong with an account name, in the server's words, or ''. */
export function accountProblem(value) {
  const text = String(value ?? '').trim().replace(/^@/, '');
  if (!text) return '';
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(text) ? ''
    : 'An account name holds letters, digits and single hyphens, 39 at most, and does not start or end with a hyphen.';
}

/** The longest short name, as the server bounds it. */
export const MAX_SHORT = 80;

/** What is wrong with an article's short name, in the server's words, or ''. */
export function shortNameProblem(value) {
  const text = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!text) return 'Give the article a short name, such as port-strike.';
  if (text.length > MAX_SHORT) return `A short name is ${MAX_SHORT} characters at most.`;
  return /^[a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?$/.test(text) ? ''
    : 'A short name holds lower-case letters, digits, hyphens and underscores, and starts and ends with a letter or a digit.';
}

/** How long a short name made from a title may grow, cut between words. */
const SHORT_FROM_TITLE = 48;

/** A short name made from a title: `Port strike, 3 May` → `port-strike-3-may`, cut between words. */
export function shortNameOf(title) {
  const folded = String(title ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let slug = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > SHORT_FROM_TITLE) {
    const cut = slug.slice(0, SHORT_FROM_TITLE + 1);
    slug = cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut.slice(0, SHORT_FROM_TITLE);
  }
  return slug || 'article';
}

/** The short name an address ends on, when it reads as one, else ''. */
export function shortNameFrom(address) {
  try {
    const last = new URL(String(address ?? '')).pathname.replace(/\/+$/, '').split('/').pop() ?? '';
    const lowered = decodeURIComponent(last).toLowerCase();
    return shortNameProblem(lowered) ? '' : lowered;
  } catch {
    return '';
  }
}
