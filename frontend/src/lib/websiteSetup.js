/**
 * What Settings › Website and the publish dialog say about the analyst's site, said the same way
 * wherever it is needed.
 *
 * The words the folder's `HOW-TO-PUBLISH.md` carries too are the engine's (`engine/site.py`):
 * `tests/test_site.py` holds the copies here to the same text. The rest is this side's: the hub's
 * panels, its checklist and what each of its parts says, the statistics setup, what each press says,
 * and the hover texts of the hub and of the dialog's fields. `lib/websiteHub.js` works out what a read
 * of the site holds and asks its words of this file.
 */
import { COUNTER_STEPS, GOATCOUNTER_SIGNUP, counterCode } from './goatcounterSetup.js';
import { parseLatLon } from './sheetRoles.js';

export { GOATCOUNTER_SIGNUP, counterCode };

// -- the engine's own words (engine/site.py) ------------------------------------------------------

export const SITE_TITLE = 'Website';
export const SITE_INTRO = 'Publish your notes as a simple website on GitHub Pages: a home page and the list of your articles, kept up to date each time you publish.';
export const SITE_STAYS_YOURS = 'The site stays yours to change, and Azimut only ever rewrites the files it made.';
export const SITE_OWN_TITLE = 'Make it yours';
/** Each way to make the site one's own: its lead, then what to do, with `code` and one [link](address). */
export const SITE_OWN = Object.freeze([
  ['Your own home page', 'write your `index.html` and put `<!-- azimut:articles -->` `<!-- /azimut:articles -->` where the list goes.'],
  ['Your own bar and footer', 'put your header and its `<style>` in `azimut-bar.html` at the site\'s root, and your footer in `azimut-footer.html`. Articles carry the header in place of Azimut\'s bar and the footer at their end, after Azimut\'s own lines; maps carry neither. Update the site brings an edit to all of them. Scripts are dropped, links start from the site\'s root, and each `<svg>` needs a `width` and a `height`.'],
  ['A page per category', 'the same markers with `section="Investigations"` list that category only.'],
  ['Your own domain', 'buy one, then point it to GitHub Pages ([GitHub\'s guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)).'],
  ['Your own scripts', '`articles.json` lists every article with its title, date, category and picture.'],
]);
export const LEGAL_SENTENCE = 'Depending on your country, a website may need a legal notice.';
export const HAND_EDITED = 'This folder was changed on GitHub since you published it: publishing replaces it.';
/** A check of the address that failed: the next press publishes, so nothing is replaced unread on one press. */
export const CHECK_UNREAD = 'Could not read what this address holds. Publish again to go ahead anyway.';
/** The same, with the reason the check gave, so a token or a network problem is named before the publish meets it. */
export function checkUnreadSaid(why = '') {
  const reason = String(why || '').trim();
  if (!reason) return CHECK_UNREAD;
  return `Could not read what this address holds: ${/[.!?]$/.test(reason) ? reason : `${reason}.`} Publish again to go ahead anyway.`;
}
export const WORKFLOW_NOTICE = 'Pages here is built by a GitHub Actions workflow: its build must copy Azimut\'s folders through to the site.';

/** The three ways readers are counted, as the engine names them (`site.STATS`). */
export const STATS_CHOICES = Object.freeze([
  { id: '', label: 'Off' },
  { id: 'goatcounter', label: 'GoatCounter' },
  { id: 'cloudflare', label: 'Cloudflare Web Analytics' },
]);

/** The longest title and tagline, as the server bounds them (`api/settings.py`). */
export const TITLE_MAX = 120;
export const TAGLINE_MAX = 200;
/** The longest category, as a note's look keeps it (`engine/notelook.py`). */
export const CATEGORY_MAX = 60;
/** The longest author's name, as a note's look keeps it (`notelook.AUTHOR_MAX`). */
export const AUTHOR_MAX = 120;

/** The words of Make it yours cut into what a line shows: text, `code` and one link. */
export function ownParts(text) {
  const parts = [];
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let from = 0;
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > from) parts.push({ text: text.slice(from, match.index) });
    parts.push(match[1] !== undefined ? { code: match[1] } : { link: match[2], href: match[3] });
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}

// -- the tab's own words --------------------------------------------------------------------------

export const TITLE_HINT = 'In the header, the bar over each article and the feed.';
export const TAGLINE_HINT = 'One line under the name, on the home page and in the feed.';
export const CREDIT_HINT = 'Ends Azimut\'s home page with Made with Azimut and its version.';

/** What an empty site name falls back to, as the server reads it (`site.from_settings`): the Publishing name, else the account. */
export function nameFallbackSaid({ report = '', account = '' } = {}) {
  if (report) return `Empty, it takes your Publishing name, ${report}.`;
  if (account) return `Empty, it takes your GitHub account, ${account}.`;
  return 'Empty, it takes the name set in Settings › Publishing, else your GitHub account.';
}

export const STATS_INTRO = 'Count the readers of every page of the site. It is off until you pick one, and starts with the next publish or Update the site.';
export const STATS_OFF_SAID = 'Nobody is counted: the pages carry no counter.';
export const GOATCOUNTER_SAID = 'Free. Counts each page view on your own GoatCounter site, with no cookie.';
export const CLOUDFLARE_SAID = 'Free. Loads one script from static.cloudflareinsights.com and counts with no cookie.';
export const GOATCOUNTER_MISSING = 'Paste the site code below for the count to start.';
export const CLOUDFLARE_MISSING = 'Paste the site token below for the count to start.';
export const GOATCOUNTER_BAD = 'That does not read as a GoatCounter code: lower-case letters, digits and hyphens, such as mycode.';
export const CLOUDFLARE_BAD = 'That does not read as a Cloudflare site token: 8 to 64 letters, digits, hyphens and underscores.';

/** Where a Cloudflare account is made, and its own guide to the site's snippet. */
export const CLOUDFLARE_SIGNUP = 'https://dash.cloudflare.com/sign-up';
export const CLOUDFLARE_GUIDE = 'https://developers.cloudflare.com/web-analytics/get-started/';

/** GoatCounter's steps for the whole site: its sign-up, then the code, then the optional view line. */
export const GOATCOUNTER_STEPS = Object.freeze([
  COUNTER_STEPS[0],
  ['Paste the code', 'Type the code below, or paste the site’s address. Counting starts with the next publish or Update the site.'],
  ['Show the views', 'Optional: in GoatCounter, open Settings and tick Allow adding visitor counts on your website, so a map page can say “N views” under its title.'],
]);

/** Cloudflare's steps, each with what to do and where Cloudflare shows it. */
export const CLOUDFLARE_STEPS = Object.freeze([
  ['Sign up', 'Make a free account at cloudflare.com. The site does not have to use Cloudflare for anything else.'],
  ['Add the site', 'In the dashboard, open Web Analytics and press Add a site. Type the site’s host name, such as your-name.github.io, pick it in the box that appears and press Done.'],
  ['Copy the site token', 'Under Manage site, the snippet holds data-cf-beacon with a token: copy the letters and digits after "token":.'],
  ['Paste the site token', 'Type it below, or paste the whole snippet. Counting starts with the next publish or Update the site.'],
]);

/** A Cloudflare token as the server reads one: 8 to 64 letters, digits, hyphens and underscores. */
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The token a typed answer names: the token itself, or the snippet Cloudflare shows
 * (`data-cf-beacon='{"token": "…"}'`); "" for nothing typed, null for something that names none.
 */
export function beaconToken(text) {
  let value = String(text ?? '').trim();
  if (!value) return '';
  const inside = /["']?token["']?\s*:\s*["']([^"']+)["']/.exec(value) ?? /&quot;token&quot;\s*:\s*&quot;([^&]+)&quot;/.exec(value);
  if (inside) value = inside[1].trim();
  return TOKEN.test(value) ? value : null;
}

export const UPDATE_SAID = 'Rebuilds the home, list, feed and sitemap from the articles on GitHub, in one commit, and leaves the files you wrote as they are.';
export const UPDATE_UPTODATE = 'The site is up to date.';
export const UPDATE_NOT_SET = 'Set up GitHub Pages under Hosting first';

/** What an Update the site answer says: up to date, or how many files it wrote. */
export function updateSaid(answer) {
  if (!answer?.updated) return UPDATE_UPTODATE;
  const count = Array.isArray(answer.written) ? answer.written.length : 0;
  return count ? `The site is updated: ${count} file${count === 1 ? '' : 's'} written.` : 'The site is updated.';
}

/** What Upkeep says while pages give the address the site had before it moved (a domain, a new repository name). */
export function oldAddressSaid(count) {
  return count === 1 ? '1 page still gives the site\'s old address: Update the site refreshes it.'
    : `${count} pages still give the site's old address: Update the site refreshes them.`;
}

/** What a press says while it waits on its answer, beside a small spinner (`components/BusyLabel.svelte`). */
export const BUSY = Object.freeze({
  read: 'Reading…', publish: 'Publishing…', update: 'Updating…', delete: 'Deleting…', test: 'Testing…', start: 'Starting…',
  rename: 'Renaming…', move: 'Moving…', home: 'Putting it online…',
});

export const LEGAL_PRESS = 'Start a Legal notice page';
export const LEGAL_SAID = 'It names GitHub as the host and leaves the publisher lines to you.';
export const LEGAL_NO_CASE = 'Open a case first: the page is a note of that case';

// -- the hub: its panels and what each part says --------------------------------------------------

/** The panels of Settings › Website, in order; WordPress stands apart, after a divider. */
export const HUB_TABS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'identity', label: 'Identity' },
  { id: 'hosting', label: 'Hosting' },
  { id: 'articles', label: 'Articles' },
  { id: 'categories', label: 'Categories' },
  { id: 'readers', label: 'Readers' },
  { id: 'upkeep', label: 'Upkeep' },
  { id: 'yours', label: 'Make it yours' },
  { id: 'wordpress', label: 'WordPress' },
]);

/** The heading and the line under it of each panel. */
export const HUB_LEADS = Object.freeze({
  overview: ['How your site works', `${SITE_INTRO} ${SITE_STAYS_YOURS}`],
  identity: ['What readers see', 'The name, the line and the logo of the site. Type and watch the preview.'],
  hosting: ['Where the site lives', 'GitHub keeps the site\'s files and serves them for free. The token stays on this computer.'],
  articles: ['What\'s on the site', 'Every article, map and page the site holds, as GitHub keeps them. Nothing is read from GitHub until you press.'],
  categories: ['How articles are grouped', 'Add, rename or delete a category. A change rewrites the articles that carry it and the lists, in one commit.'],
  readers: ['Who reads it', 'Count your readers, and help them follow and find the site.'],
  upkeep: ['Keep it in shape', 'What Azimut writes, what stays yours, and how to do the usual chores.'],
  yours: [SITE_OWN_TITLE, 'Azimut\'s site is a simple start. Change as much of it as you like: Azimut keeps filling the lists.'],
  wordpress: ['Also send to WordPress', 'A note can go to a WordPress site as a draft, apart from the GitHub site.'],
});

// the words a count, a kind and a time are said in

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

/** What each card of the site is called, on its badge and its chip. */
export const KIND_LABEL = Object.freeze({ article: 'Article', map: 'Map', page: 'Page', unlisted: 'Unlisted' });
export const KIND_CHIP = Object.freeze({ map: 'Maps', page: 'Pages', unlisted: 'Unlisted' });
export const ALL_CHIP = 'All';

/** `5 articles · 2 maps`, the kinds the site holds and no other. */
export function countsSaid({ article = 0, map = 0, page = 0, unlisted = 0 } = {}) {
  const parts = [article && plural(article, 'article'), map && plural(map, 'map'), page && plural(page, 'page'), unlisted && `${unlisted} unlisted`];
  return parts.filter(Boolean).join(' · ') || 'Nothing on the site yet';
}

/** `today at 13:55`, `yesterday at 13:55`, `20 Nov at 13:55`, or `20 Nov 2025` a year or more back; '' for no date. */
export function whenSaid(value, now = new Date()) {
  const at = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(at.getTime())) return '';
  const day = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}`;
  if (days === 0) return `today at ${clock}`;
  if (days === 1) return `yesterday at ${clock}`;
  if (at.getFullYear() === now.getFullYear()) return `${at.getDate()} ${MONTHS[at.getMonth()]} at ${clock}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

/** `20 Nov 2026` of a `2026-11-20`; what is not such a day is given back as it is. */
export function dayShort(date) {
  const found = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  return found && MONTHS[Number(found[2]) - 1] ? `${Number(found[3])} ${MONTHS[Number(found[2]) - 1]} ${found[1]}` : String(date ?? '');
}

/** The counters by name, as the hero and the checklist say who counts. */
export const COUNTER_NAME = Object.freeze({ goatcounter: 'GoatCounter', cloudflare: 'Cloudflare Web Analytics' });

// the hero

/** What the site is called while nothing names it: no title, no Publishing name, no GitHub account. */
export const UNNAMED = 'Your site';
export const NO_ADDRESS = 'No address until GitHub Pages is set up';
export const NOT_READ = 'Not read yet';
export const OPEN_SITE = 'Open the site';
export const UPDATE_PRESS = 'Update the site';
export function readersSaid(counter) {
  return counter ? `Readers counted by ${counter}` : 'Readers not counted';
}
export function changedSaid(when) {
  return `Last change ${when}`;
}
export function updatedSaid(when) {
  return `Updated ${when}`;
}

// the overview

/** The four steps from a note to a reader; the last two name the repository and the site once known. */
export function flowSteps({ repository = '', host = '' } = {}) {
  return [
    ['Write', 'A note in the Notebook, with its pictures, maps and sources.'],
    ['Publish', 'Export › Web folder › Publish to GitHub Pages, as an article, a page or unlisted.'],
    ['GitHub keeps it', `One folder per note in ${repository || 'your repository'}.`],
    ['Readers find it', `On ${host || 'your site'}, in its lists, its feed and search engines.`],
  ];
}
export const FLOW_AFTER = 'Each publish also refreshes';
export const FLOW_REFRESHES = Object.freeze(['the home list', 'the feed', 'the sitemap']);

export const CHECKLIST_TITLE = 'Your site, step by step';
/** The step that puts Azimut's home page online before any article, its press, and the link that follows. */
export const HOME_STEP = 'Put your home page online';
export const HOME_PRESS = 'Put it online';
export const HOME_SEE = 'See it';
export const OPTIONAL = 'optional';
export const NEEDS_READ = 'Read the site, in Articles, to tell.';
/** What a read says when GitHub cut the tree short: the site holds more files than it lists. */
export const TOO_MANY = 'The site holds too many files to read.';
export const TOO_MANY_SHORT = 'Too many files to read';

/**
 * The seven things that make a site, each `done`, `todo` or `unknown` (a read of the site tells), with
 * what it says and the panel it opens. The optional ones say so, and still count. The home page's step has a
 * press of its own (`act`): `online` while the read finds no home, `see` once it is there.
 */
export function checklist({ ready = false, repository = '', branch = '', title = '', fallback = '', siteLogo = false, logoFrom = '', counting = '',
  stats = '', read = null } = {}) {
  // a read cut short lists nothing, which tells nothing of the site
  const unread = !read || read.truncated;
  const why = read ? TOO_MANY : NEEDS_READ;
  const articles = read ? read.items.filter((item) => item.role === 'article').length : 0;
  const asked = stats === 'goatcounter' ? 'code' : 'token';
  const home = read?.home;
  return [
    { id: 'hosting', label: 'Connect GitHub Pages', go: 'hosting', state: ready ? 'done' : 'todo',
      said: ready ? `${repository} on ${branch}` : 'Add the account, the repository and the token.' },
    !ready ? { id: 'home', label: HOME_STEP, go: 'hosting', state: 'todo', said: 'Connect GitHub Pages first.' }
      : unread ? { id: 'home', label: HOME_STEP, go: 'articles', state: 'unknown', said: why }
        : home === 'none' ? { id: 'home', label: HOME_STEP, go: 'upkeep', state: 'todo', act: 'online',
          said: 'The site has no home page yet. This one lists your articles as you publish them.' }
          : { id: 'home', label: HOME_STEP, go: 'upkeep', state: 'done', act: 'see',
            said: home === 'yours' ? 'Your own home page is online.' : 'Azimut\'s home page is online.' },
    { id: 'name', label: 'Name the site', go: 'identity', state: title ? 'done' : 'todo',
      said: title || (fallback ? `It shows as ${fallback} for now.` : 'It has no name yet.') },
    { id: 'logo', label: 'Pick the site\'s logo', go: 'identity', state: siteLogo ? 'done' : 'todo',
      said: siteLogo ? 'A picture of its own.' : logoFrom === 'publishing' ? 'Uses your Publishing logo for now.' : 'No logo yet.' },
    { id: 'readers', label: 'Count readers', optional: true, go: 'readers', state: counting ? 'done' : 'todo',
      said: counting ? COUNTER_NAME[counting] : stats ? `${COUNTER_NAME[stats]} is picked: paste its ${asked}.` : 'Nobody is counted.' },
    { id: 'legal', label: 'A legal notice', optional: true, go: 'articles', state: unread ? 'unknown' : read.legal ? 'done' : 'todo',
      said: unread ? why : read.legal ? `${read.legal} is on the site.` : 'No legal notice on the site yet.' },
    { id: 'first', label: 'Publish a first article', go: 'articles', state: unread ? 'unknown' : articles ? 'done' : 'todo',
      said: unread ? why : articles ? `${plural(articles, 'article')} on the site.` : 'Nothing is listed on the site yet.' },
  ];
}

/** `4 of 6 done.`, and how many steps a read of the site would tell. */
export function progressSaid(steps) {
  const done = steps.filter((step) => step.state === 'done').length;
  const unread = steps.filter((step) => step.said === NEEDS_READ).length;
  const more = unread ? ` ${unread} ${unread === 1 ? 'needs' : 'need'} a read of the site.` : '';
  return `${done} of ${steps.length} done.${more}`;
}

/** The tip shown once the site passes four fifths of what GitHub Pages serves. */
export const SIZE_TIP_TITLE = 'The site is getting big';
export function sizeTipSaid(weight, percent) {
  return `It weighs ${weight}, ${percent}% of the 1 GB GitHub Pages serves.`;
}
export const SIZE_TIP_GO = 'See the limits';

// identity

export const SITE_NAME_LABEL = 'Site name';
/** Said under the name and the logo: when what is changed there reaches the site. */
export const IDENTITY_SAID = 'A new name or logo reaches the lists at the next publish or Update the site, and an article\'s bar when it is published again.';
export const TAGLINE_LABEL = 'Tagline';
export const TAGLINE_PLACEHOLDER = 'What the site is about';
export const SITE_LOGO_LABEL = 'Site logo';
export const CREDIT_LABEL = 'Made with Azimut';
export const SITE_LOGO_PICK = 'Choose a picture…';
export const SITE_LOGO_RESET = 'Use the Publishing logo';
export const SITE_LOGO_REMOVE = 'Remove the logo';
/** What the logo field says, by where the site's logo comes from. */
export const SITE_LOGO_SAID = Object.freeze({
  site: 'The site\'s own picture, on each of its pages.',
  publishing: 'The Publishing logo, the one on your reports. A square PNG gives the site its own.',
  '': 'A square PNG, up to 2 MB. With none, the pages carry no logo.',
});
export const SITE_LOGO_BIG = 'The logo must be under 2 MB.';
export const SITE_LOGO_NOT_PNG = 'The logo must be a PNG picture.';
export const PREVIEWS = Object.freeze([
  { id: 'bar', label: 'Article bar' },
  { id: 'home', label: 'Home page' },
  { id: 'feed', label: 'Feed' },
]);
/** What the previews show before the site is read. */
export const PREVIEW_SAMPLE = Object.freeze({
  title: 'The title of your latest article',
  other: 'The one before it',
  category: 'Category',
  back: 'All articles',
  all: 'All',
  day: '20 November 2026',
  short: '20 Nov 2026',
});
export const OWN_HOME_PILL = 'Your home page';
/** The site's own bar and footer, `azimut-bar.html` and `azimut-footer.html`, and what the Article bar preview says once a read finds them in use. */
export const OWN_BAR_FILE = 'azimut-bar.html';
export const OWN_BAR_IN_USE = 'Your own bar, on every article';
export const OWN_FOOTER_FILE = 'azimut-footer.html';
export const OWN_FOOTER_IN_USE = 'Your own footer, on every article';
export function ownHomeSaid(host) {
  return `${host || 'The site'} has a home page of your own: Azimut fills its lists and leaves its header as you wrote it.`;
}

// hosting

export const ADDRESS_TITLE = 'The address';
export const ADDRESS_OWN = 'Your own domain';
export const ADDRESS_GITHUB = 'GitHub\'s address';
export const ADDRESS_NONE = 'Set up GitHub Pages first, and the address shows here.';
export const ADDRESS_NOTE = 'Set in the repository\'s CNAME file. Without one, the site lives at your-account.github.io/repository.';
export const DOMAIN_TITLE = 'A domain of your own';
export const DOMAIN_SAID = 'Buy one from any registrar, then point it to GitHub Pages.';
export const DOMAIN_LINK = 'GitHub\'s guide';
export const HOSTING_DOMAIN_GUIDE = 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site';

/** What GitHub Pages holds a site to: a gigabyte, read as 1024 cubed like the sizes GitHub gives. */
export const SITE_LIMIT_BYTES = 1024 ** 3;
export const LIMITS_AMBER = 0.8;
export const LIMITS_RED = 0.95;
export const LIMITS_TITLE = 'Limits';
export const LIMITS_UNREAD = 'Read the site to see its size.';
export const SIZE_UNKNOWN = 'Size unknown: the site holds too many files to read.';
export const REPOSITORY_UNKNOWN = 'GitHub gave no size for the repository.';
/** The two bars, each with what it weighs against. */
export const BARS = Object.freeze({
  site: { label: 'Site', of: '1 GB' },
  repository: { label: 'Repository with its history', of: '1 GB recommended' },
});
export function barSaid(bar, weight) {
  return `${BARS[bar].label}: ${weight} of ${BARS[bar].of}`;
}
export const LIMITS_LINES = Object.freeze([
  'The site: 1 GB at most.',
  'The repository: under 1 GB recommended, its history included.',
  'Readers: 100 GB of traffic a month, a soft limit.',
  'Builds: 10 an hour, a soft limit.',
  'A file: 50 MB at most in Azimut. GitHub warns from 50 MB and refuses past 100 MB.',
  'One publish: 200 MB and 1,000 files at most.',
  'Not for a shop, a paid service, or passwords and card numbers.',
]);
export const LIMITS_LINK = 'https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits';
export const LIMITS_LINK_TEXT = 'GitHub\'s limits';

// articles

export const READ_PRESS = 'Read the site';
export const READ_AGAIN = 'Read the site again';
export const READ_NOT_SET = 'Set up GitHub Pages under Hosting first';
export function readAtSaid(when) {
  return `Read ${when}`;
}
export const READ_FIRST_TITLE = 'Not read yet';
export const READ_FIRST = 'Press Read the site to list its articles, maps and pages.';
export const READ_NONE_TITLE = 'Nothing on the site yet';
export const READ_NONE = 'Publish a note from the Notebook and it shows here.';
export const COLUMNS = Object.freeze(['Title', 'Category', 'Kind', 'Published', 'Size']);
export const NO_CATEGORY = 'no category';
export const OPEN_ITEM = 'Open';
export const DELETE_PRESS = 'Delete';
/** Said under the list, by its Delete presses. */
export const DELETE_SAID = 'Delete takes an article down, and off the lists, the feed and the sitemap, in one commit.';
/** Said in place of Delete on a card the server would not delete, such as one a WordPress export made. */
export const OUTSIDE_AZIMUT = 'Outside Azimut';
export const DELETE_TITLE = 'Delete this article from the site?';
export const DELETE_CONFIRM = 'Delete from the site';
export function deleteSaid(folder, repository) {
  return `Deletes ${folder}/ from ${repository} and takes it off the lists, the feed and the sitemap, in one commit. `
    + 'The note stays in your case: publish it again to put it back.';
}
/** What a delete did: how many files it wrote, or only that the folder went when the server counted none. */
export function deletedSaid(folder, answer) {
  if (answer?.removed === null || answer?.removed === undefined) return `Deleted ${folder}/.`;
  return `Deleted ${folder}/: ${plural(Array.isArray(answer.written) ? answer.written.length : 0, 'file')} written.`;
}
export const KINDS = Object.freeze([
  ['article', 'In the site\'s list, its feed and its sitemap.'],
  ['page', 'Off the lists, linked from the site\'s header. For About or Legal notice.'],
  ['unlisted', 'Online at its address only, and out of search engines. For a test, or a draft to show someone.'],
]);
export const KINDS_NOTE = 'You pick the kind in the publish window, each time you publish a note.';
export const CATEGORIES_TITLE = 'Categories';
export const CATEGORIES_NOTE = 'A category gets a page of its own with the markers in Make it yours.';
export const CATEGORIES_UNREAD = 'Read the site to list its categories.';
export const CATEGORIES_NONE = 'No category on the site yet.';
export function categoryCountSaid(count) {
  return count ? plural(count, 'article') : CATEGORY_WAITING;
}
export function categoryPagesSaid(pages) {
  return pages.length ? `${pages.map((page) => `/${page}`).join(', ')} ${pages.length === 1 ? 'lists' : 'list'} them` : 'no page of its own';
}
export const PAGES_TITLE = 'Pages every site should have';
export const PAGES_NOTE = 'Each starts as a note in the open case, with the host named. You fill in the rest.';
export const PRIVACY_PRESS = 'Start a Privacy page';
export const PRIVACY_SAID = 'It names the host and what the counter records.';
export const PAGE_ON_SITE = 'On the site';

// readers

export const STATS_TITLE = 'Count readers';
export const COUNTING_SAID = 'Counting every page of the site.';
export const CLOUDFLARE_DASHBOARD = 'https://dash.cloudflare.com/?to=/:account/web-analytics';
export const FOLLOW_TITLE = 'Follow and find';
export const FEED_SAID = 'Readers subscribe to the feed with any feed reader.';
export const SITEMAP_SAID = 'Give the sitemap to Google Search Console or Bing Webmaster Tools, to be found sooner.';
export const FOLLOW_NONE = 'Set up GitHub Pages first, and the addresses show here.';
export const COPY_PRESS = 'Copy';

// the numbers, read from Cloudflare Web Analytics on a press (`api/publishing.py`, `engine/sitestats.py`)

export const NUMBERS_TITLE = 'Numbers';
export const NUMBERS_INTRO = 'Page views of each article over 7 and 30 days, read from Cloudflare when you press.';
export const NUMBERS_PRESS = 'Read the numbers';
export const NUMBERS_AGAIN = 'Read again';
export const NUMBERS_BUSY = 'Reading…';
export const NUMBERS_NOT_SET = 'Fill in the account ID, the API token and the site token first';
export const NUMBERS_FIRST = 'Press Read the numbers to see what is read, and from where.';
export const NUMBERS_NONE = 'No page view in 30 days: if readers came, check the site token, and the site tag if you set it by hand.';
export const NUMBERS_SAMPLED = 'Cloudflare samples what is older than 7 days, so the 30-day counts are estimates.';
export const NUMBERS_GOATCOUNTER = 'Numbers are read from Cloudflare Web Analytics only; open GoatCounter\'s own page.';
export const NUMBERS_HEAD = Object.freeze(['Page', '7 days', '30 days']);
export const NUMBERS_TOTAL = 'Whole site';
export const NUMBERS_HOME = 'Home page';
export const REFERRERS_TITLE = 'Where visits came from';
export const COUNTRIES_TITLE = 'Countries';
export const NO_REFERRER = 'No referrer';
export const RANKED_NONE = 'None in 30 days.';
/** A count as the panel writes it: `1,234`. */
export function countSaid(count) {
  return Number.isFinite(count) ? Math.max(0, Math.round(count)).toLocaleString('en-US') : '0';
}
/** What a window's total says under its page views: `page views · 980 visits`. */
export function tileSaid({ views = 0, visits = 0 } = {}) {
  return `${views === 1 ? 'page view' : 'page views'} · ${countSaid(visits)} ${visits === 1 ? 'visit' : 'visits'}`;
}

/**
 * Where each answer is found in Cloudflare, field by field, as its token page reads (Manage account ›
 * Account API tokens › Create a token), and what the token may do: two read-only permissions, one to read
 * the numbers, one to list the account's Web Analytics sites so the site tag is found from the site token.
 */
export const NUMBERS_SETUP = 'How to let Azimut read the numbers';
export const TOKEN_NAME = 'azimut-reader-numbers';
export const NUMBERS_FREE = 'Both permissions are free and only read.';
export const NUMBERS_STAYS = 'The token stays on this computer, never in a backup.';
export const NUMBERS_STEPS = Object.freeze([
  ['Account ID', 'In Cloudflare\'s dashboard, press Ctrl+K (⌘K on a Mac), type Copy account ID and pick it.'],
  ['Token page', 'Open Manage account › Account API tokens and press Create a token.'],
  ['Token name', `Type ${TOKEN_NAME}.`],
  ['Permission policies', 'Pick Start from scratch (Custom): the Read analytics and Read all resources templates give far more than Azimut needs.'],
  ['Permissions', 'Add two lines, Account Analytics: Read and Account Settings: Read.'],
  ['Create it', 'Create the token and copy it, as Cloudflare shows it once, then paste it below.'],
]);
export const CLOUDFLARE_TOKEN_GUIDE = 'https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/';
export const ACCOUNT_HINT = 'From Copy account ID in Cloudflare\'s dashboard.';
export const TAG_HAND_TITLE = 'Set the site tag by hand';
export const TAG_HINT = 'Left empty, Azimut finds it from the site token.';
export const TAG_FOUND_HINT = 'Found from the site token. A tag typed here wins.';
export const TAG_WHERE = 'In Web Analytics, open your site: the page\'s address holds siteTag~in= and the tag. Paste the address or the tag.';
export const API_TOKEN_HINT = 'Account Analytics and Account Settings, both Read. Kept on this computer only, never in a backup.';
export const ACCOUNT_BAD = 'That does not read as an account ID: 32 letters and digits, a to f and 0 to 9.';
export const TAG_BAD = 'That does not read as a site tag: 32 letters and digits, a to f and 0 to 9.';
export const API_TOKEN_BAD = 'That does not read as a Cloudflare API token: copy it whole, as Cloudflare showed it.';
/** What the token field says once one is kept: its last characters only, never the token. */
export function apiTokenKeptSaid(hint = '') {
  return `Kept on this computer${hint ? `, ending ${hint.replace('…', '')}` : ''}. Paste a new one to replace it.`;
}

const CLOUDFLARE_ID = /^[0-9a-f]{32}$/;

/**
 * An account ID or a site tag a typed answer names, lower case: the 32 digits themselves, or, from an
 * address of Cloudflare's dashboard, the account (`dash.cloudflare.com/<account>/…`) or the site tag
 * (`siteTag~in=<tag>`). "" for nothing typed, null for something that names none.
 */
export function cloudflareId(text, which = 'account') {
  const value = String(text ?? '').trim();
  if (!value) return '';
  if (CLOUDFLARE_ID.test(value.toLowerCase())) return value.toLowerCase();
  const found = which === 'tag'
    ? /siteTag(?:~in)?=([0-9a-fA-F]{32})(?![0-9a-fA-F])/.exec(value)
    : /dash\.cloudflare\.com\/([0-9a-fA-F]{32})(?![0-9a-fA-F])/.exec(value);
  return found ? found[1].toLowerCase() : null;
}

/** An API token as the server takes one: what a Bearer header carries, 20 to 255 characters; null for none. */
export function apiToken(text) {
  const value = String(text ?? '').trim();
  return /^[A-Za-z0-9._~+/=-]{20,255}$/.test(value) ? value : null;
}

// upkeep

export const OWNERS_TITLE = 'Who writes what';
export const OWNERS_HEAD = Object.freeze(['File', 'Made by', 'What Azimut does']);
export const OWNERS_UNREAD = 'Read the site, in Articles, to see which of your pages Azimut fills.';
export const OWNERS_TRUNCATED = 'The site holds too many files to read, so its pages are not listed here.';

/**
 * The files of the site and whose they are. `read` is the last read of the site, or null: the root page
 * is the analyst's once a read says so, and the pages it found marked are listed as theirs.
 */
export function ownersOf(read) {
  const known = read && !read.truncated ? read : null;
  const pages = (known?.marked ?? []).filter((page) => page !== '');
  return [
    { files: ['each article\'s folder'], who: 'azimut', text: 'Replaces it when you publish that note again, and asks first if it changed on GitHub.' },
    { files: ['articles.json', 'feed.xml', 'sitemap.xml'], who: 'azimut', text: 'Rewrites them at each publish and update.' },
    known?.home === 'yours'
      ? { files: ['index.html'], who: 'you', text: 'Fills the list between its markers, nothing else.' }
      : { files: ['index.html'], who: 'azimut', text: 'Writes the default home page, until you write your own.' },
    ...(pages.length ? [{ files: pages, who: 'you', text: 'Fills the list between their markers, nothing else.' }] : []),
    { files: [OWN_BAR_FILE], who: 'you', text: 'Copied into each article\'s bar.' },
    { files: [OWN_FOOTER_FILE], who: 'you', text: 'Copied to the end of each article.' },
    { files: ['everything else'], who: 'you', text: 'Never touches it.' },
  ];
}
export const OWNER_LABEL = Object.freeze({ azimut: 'Azimut', you: 'You' });

export const CHORES_TITLE = 'Usual chores';
export const CHORES = Object.freeze([
  ['Take an article down', 'Press Delete on its line in Articles. Deleted on GitHub instead, press Update the site so the lists, the feed and the sitemap forget it.'],
  ['Move an article to another category', 'Pick the category on its line in Articles. Its page is not published again.'],
  ['Rename the site or change its logo', 'Update the site changes the lists and the feed. Each article\'s bar changes when you publish it again.'],
  ['Fix a typo on GitHub directly', 'Fine. The next publish of that note asks before it replaces your fix.'],
  ['Test an article before it shows', 'Publish it as Unlisted, then as Article once it is ready.'],
  ['Give the site its own domain', 'Set it in the repository\'s Settings › Pages on GitHub, then press Update the site so the pages published before give the new address.'],
]);

/** The last change the read found on the branch, said in Upkeep until Update the site is pressed here. */
export function lastChangeSaid(when, message = '') {
  return `Last change on GitHub ${when}${message ? `: ${message}` : ''}.`;
}

/** What Make it yours shows under a way, as lines each with how it is drawn: `m` markup, `c` a marker, '' plain. */
export const SITE_OWN_SAMPLES = Object.freeze({
  'Your own home page': [['m', '<main>'], ['c', '  <!-- azimut:articles -->'], ['c', '  <!-- /azimut:articles -->'], ['m', '</main>']],
  'Your own bar and footer': [['m', '<style>:host { font: 15px system-ui }</style>'], ['m', '<header><a href="./">'],
    ['m', '  <svg width="24" height="24">…</svg> My site'], ['m', '</a></header>']],
  'A page per category': [['c', '<!-- azimut:articles section="Investigations" -->'], ['c', '<!-- /azimut:articles -->']],
  'Your own scripts': [['', '{ "title": "…", "date": "2026-11-20",'], ['', '  "category": "Conflict Watch", "image": "/…/cover.jpg" }']],
});

// categories

/** Said beside the list: where a category is picked. */
export const CATEGORIES_SAID = 'Pick one when you publish a note, or on an article\'s line in Articles.';
export const CATEGORY_WAITING = 'No article yet';
export const CATEGORY_ADD_LABEL = 'New category';
export const CATEGORY_ADD_PLACEHOLDER = 'A name, such as Investigations';
export const CATEGORY_ADD_PRESS = 'Add';
/** Said under the field: what an added category is until an article carries it. */
export const CATEGORY_ADD_SAID = 'It is offered when you publish and on each article\'s line, and reaches the site with its first article.';
/** Why a name typed to add is not added, by what it is up against (`websiteHub.addProblem`). */
export const CATEGORY_ADD_PROBLEM = Object.freeze({
  site: 'The site has that category already.',
  added: 'You added that category already.',
});
export function categoryAddedSaid(name) {
  return `${name} is added.`;
}
export const CATEGORY_RENAME_PRESS = 'Rename';
export const CATEGORY_DELETE_PRESS = 'Delete';
export const CATEGORY_REMOVE_PRESS = 'Remove';
export const CATEGORY_SAVE_PRESS = 'Save';
export const CATEGORY_CANCEL_PRESS = 'Cancel';
/** Said on a site whose home page is the analyst's own, and at an add there. */
export const CATEGORIES_OWN_PAGES = 'Your site has its own pages: Azimut updates the articles and the lists; your menu and category pages are yours to change.';
export const CATEGORY_ADD_OWN_PAGES = 'Add a page and a menu link for it if you want one; its articles already show in your lists.';
export const RENAME_TITLE = 'Rename this category?';
export const RENAME_CONFIRM = 'Rename';
export const CATEGORY_DELETE_TITLE = 'Delete this category?';
export const CATEGORY_DELETE_CONFIRM = 'Delete the category';

/** `a`, `a and b`, `a, b and c`. */
const listed = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** What a rename touches: the cards that carry the name, and the category of the new name when the site has it. */
export function renameSaid(name, to, count, into = 0) {
  const said = `Renames ${name} to ${to} on ${plural(count, 'article')}, and in the lists and the feed, in one commit.`;
  return into ? `${said} ${to} has ${plural(into, 'article')} already: they are listed together.` : said;
}

/** What a delete of a category touches: its articles stay, with none. */
export function categoryDeleteSaid(name, count) {
  return `Takes ${name} off ${plural(count, 'article')}, in one commit. They stay on the site, with no category.`;
}

/**
 * What the analyst's own pages ask of a rename or a delete (`kind`) of a category they name: each page whose markers
 * name it (`pages`, `investigations/`), and on a site whose home is their own (`own`), the menu. '' for nothing.
 */
export function ownPagesSaid(pages, kind, own = false) {
  const said = [];
  if (pages.length) {
    const one = pages.length === 1;
    const where = `Your ${one ? 'page' : 'pages'} ${listed(pages.map((page) => `/${page}`))} ${one ? 'lists' : 'list'} this category by name`;
    const empty = `${one ? 'its list' : 'their lists'} will be empty`;
    said.push(kind === 'rename' ? `${where}: change it there too, or ${empty}.` : `${where}: ${empty}.`);
  }
  if (own) said.push(kind === 'rename' ? 'Rename its link in your menu.' : 'Take its link out of your menu.');
  return said.join(' ');
}

/** What a rename or a delete did, once GitHub has the commit. */
export function categoryDoneSaid(kind, name, to, changed) {
  return kind === 'rename' ? `${name} is ${to} now, on ${plural(changed, 'article')}.`
    : `${name} is deleted: ${plural(changed, 'article')} left with no category.`;
}

/** What a change of one article's category did: `changed` false when it was in that one already. */
export function movedSaid(title, to, changed = true) {
  const where = to || 'no category';
  if (!changed) return `“${title}” is in ${where} already.`;
  return to ? `“${title}” is in ${to} now.` : `“${title}” has no category now.`;
}

// -- the publish dialog's fields ------------------------------------------------------------------

export const ON_SITE = Object.freeze([
  { id: 'article', label: 'Article' },
  { id: 'page', label: 'Page' },
  { id: 'unlisted', label: 'Unlisted' },
]);
/** Said beside the choice: Unlisted is how a page is tried. */
export const ON_SITE_TRY = 'Unlisted lets you read it online before you announce it.';
/** What a pick says, below the choice. */
export const ON_SITE_SAID = Object.freeze({
  article: 'In the site\'s list and its feed.',
  page: 'Off the list, linked from the site\'s header.',
  unlisted: 'Online at its address only, in no list, feed or sitemap.',
});

/** Where a note will appear, said below the choice: an article names the site it goes on. */
export function onSiteSaid(role, name = '') {
  if (role === 'article' && name) return `Goes on ${name}'s home page and in its feed.`;
  return ON_SITE_SAID[role] ?? ON_SITE_SAID.article;
}

/** The line shown while Settings › Website holds no title: the name the site then takes. */
export function noNameSaid(fallback) {
  return `Your site has no name yet: it shows as ${fallback}.`;
}
export const NO_NAME_PRESS = 'Name the site';

export const CATEGORY_SAID = 'Pick one the site uses, or make a new one.';
/** The category's list: none first, then the site's, then a new one typed. */
export const CATEGORY_NONE = 'No category';
export const CATEGORY_NEW = 'New category…';
export const CATEGORY_NEW_PLACEHOLDER = 'New category';
export const LIST_IMAGE_COVER = 'The cover picture';
export const AUTHOR_LABEL = 'Author';
export const AUTHOR_IMAGE_LABEL = 'Author picture';
export const AUTHOR_IMAGE_NONE = 'No picture';

// the place on the site's map: optional, never filled without a press

/** How far north or south a place may stand, and the longest its name is (`notelook.PLACE_LAT_MAX`, `PLACE_NAME_MAX`). */
export const PLACE_LAT_MAX = 85;
export const PLACE_NAME_MAX = 80;
/** The section the place folds into, shut every time the dialog opens unless the note has a place. */
export const MORE_OPTIONS = 'More options';
export const PLACE_TITLE = 'Coordinates for this article (optional)';
export const PLACE_LEAD = 'They show the article as a pin on the site\'s map.';
export const PLACE_COORDS_LABEL = 'Coordinates';
export const PLACE_NAME_LABEL = 'Place name';
export const PLACE_COORDS_PLACEHOLDER = 'lat, lon';
export const PLACE_NAME_PLACEHOLDER = 'Name on the pin';
export const PLACE_NAME_ALONE = 'A name needs coordinates: left so, the article has no pin.';
export const PLACE_UNREAD = 'That does not read as a point: paste it as lat, lon, such as 12.725, 43.5075.';
export const PLACE_LAT_BAD = `The latitude must be between -${PLACE_LAT_MAX} and ${PLACE_LAT_MAX}, where web maps stop.`;
export const PLACE_LON_BAD = 'The longitude must be between -180 and 180.';
/** Why a point is offered, by what the note names (`engine/siteplace.py`). */
export const PLACE_WHY = Object.freeze({
  place: 'The one place the note names.',
  proof: 'Where the note\'s one proof concluded.',
  map: 'Where the note\'s one map looks.',
});

/** A number kept to six places, as the server keeps it, `-0` read as `0`. */
const sixPlaces = (value) => Number(value.toFixed(6)) + 0;

/** A place as kept or offered, `{ lat, lon, name }`, or null when there is none or it does not read as one. */
export function placeOf(value) {
  if (!value || typeof value !== 'object') return null;
  const { lat, lon } = value;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > PLACE_LAT_MAX || Math.abs(lon) > 180) return null;
  const name = typeof value.name === 'string' ? value.name.replace(/\s+/g, ' ').trim().slice(0, PLACE_NAME_MAX) : '';
  return { lat: sixPlaces(lat), lon: sixPlaces(lon), name };
}

/**
 * What the dialog's two fields hold: `place` to send, null for none; `problem`, why the coordinates are no
 * place, which holds the publish back; and `said`, the line under the fields. The coordinates are read as the
 * Sheet reads a cell (`sheetRoles.parseLatLon`): `12.725, 43.5075`, `12.725N 43.5075E` or degrees, minutes and seconds.
 */
export function readPlace(coords, name = '') {
  const text = String(coords ?? '').trim();
  const label = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, PLACE_NAME_MAX);
  if (!text) return { place: null, problem: '', said: label ? PLACE_NAME_ALONE : '' };
  const point = parseLatLon(text);
  const problem = !point ? PLACE_UNREAD : Math.abs(point.lat) > PLACE_LAT_MAX ? PLACE_LAT_BAD : Math.abs(point.lon) > 180 ? PLACE_LON_BAD : '';
  if (problem) return { place: null, problem, said: problem };
  const place = { lat: sixPlaces(point.lat), lon: sixPlaces(point.lon), name: label };
  return { place, problem: '', said: `Reads as ${placeDegrees(place)}.` };
}

/** `12.725004° N, 43.5075° E`: the point as it is kept, its hemispheres named so a pair typed the wrong way round shows. */
export function placeDegrees(place) {
  return `${Math.abs(place.lat)}° ${place.lat < 0 ? 'S' : 'N'}, ${Math.abs(place.lon)}° ${place.lon < 0 ? 'W' : 'E'}`;
}

/** The text a kept place gives back to the coordinates field: `12.725004, 43.5075`. */
export function placeText(place) {
  return place ? `${place.lat}, ${place.lon}` : '';
}

/** The press that takes the note's offer: `Use 12.7250, 43.5075 · Bab al-Mandab`. */
export function placeUseSaid(offer) {
  const point = `${offer.lat.toFixed(4)}, ${offer.lon.toFixed(4)}`;
  return `Use ${point}${offer.name ? ` · ${offer.name}` : ''}`;
}
/** After publishing a note that replaced a folder the analyst had changed, and was not warned before. */
export const REPLACED_EDITED = 'That folder had been changed on GitHub since you published it: this publish replaced it.';

/** What the check before a publish says when the address holds another article, map or page. */
export function takenSaid(title) {
  return `This address already holds “${title}”. Replace it?`;
}
/** The same of a folder Azimut did not make, which a publish never replaces. */
export function takenOutsideSaid(title) {
  return `This address already holds “${title}”, which Azimut did not make.`;
}
export const REPLACE_PRESS = 'Replace it';
export const PICK_ANOTHER = 'Pick another address';

/** “A”, “A” and “B”, “A”, “B” and “C”: titles named as a sentence names them. */
function namedList(titles) {
  const named = titles.map((title) => `“${title}”`);
  return named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0] ?? '';
}
/** The web maps an article links to that the site does not hold yet, named before the press. */
export function mapsMissingSaid(titles) {
  return titles.length > 1 ? `The maps ${namedList(titles)} are not on this site yet.` : `The map ${namedList(titles)} is not on this site yet.`;
}
/** What publishing without them does to the article's links, in one sentence. */
export function mapsPlainSaid(count) {
  return count > 1 ? 'Published without them, the links to them read as plain text.' : 'Published without it, the link to it reads as plain text.';
}
/** The maps an Article lists with it, unlisted on the site until now: said before the press, in one sentence. */
export function mapsListedSaid(titles) {
  return titles.length > 1 ? `The maps ${namedList(titles)} are Unlisted on this site: they are listed with this article.`
    : `The map ${namedList(titles)} is Unlisted on this site: it is listed with this article.`;
}
/** The press that puts them on the site, then the article. */
export function mapsFirstPress(count) {
  return count > 1 ? 'Publish the maps first' : 'Publish the map first';
}
/** What the dialog says while one of them goes up. */
export function mapGoingSaid(title, repository) {
  return `Publishing the map “${title}” to ${repository}…`;
}
/** A map that did not go up, named, with GitHub's reason: the article waits. */
export function mapFailedSaid(title, why) {
  return `The map “${title}” was not published: ${why}`;
}

// -- on hover, one clause each --------------------------------------------------------------------

/**
 * What the tab, its WordPress and GitHub Pages sections, the press that sets GitHub up and the
 * publish dialog's site fields say on hover, one clause each. `websiteSetup.test.js` holds every key to
 * a sentence and to a control showing it, and every control of those to a hover text.
 */
export const WEBSITE_HELP = {
  // the hub
  tabOverview: 'How the site works and what is left to set up',
  tabIdentity: 'The name, tagline and logo of the site, with a preview',
  tabHosting: 'Where the site lives, its address and its limits',
  tabArticles: 'What the site holds, read from GitHub on a press',
  tabCategories: 'Add, rename or delete the categories of the site',
  tabReaders: 'Count the readers and give them the feed and the sitemap',
  tabUpkeep: 'Update the site, who writes which file and the usual chores',
  tabYours: 'Change as much of the site as you like',
  tabWordpress: 'Send a note to a WordPress site as a draft',
  siteOpen: 'Open the site in a new tab',
  siteUpdate: 'Rebuild the home, list, feed and sitemap from the articles on GitHub',
  hubGo: 'Open the panel where this is set',
  siteTitle: 'The name of your site, shown in its header and its feed',
  siteTagline: 'One line under the title on the home page',
  siteCredit: 'End the home page with Made with Azimut and its version, linked to the project',
  siteLogoPick: 'Pick a square PNG as the logo of the site',
  siteLogoReset: 'Back to the logo of Settings › Publishing',
  siteLogoRemove: 'Take the logo off the site',
  previewBar: 'How the bar over an article reads',
  previewHome: 'How the home page reads',
  previewFeed: 'How the feed reads',
  siteOwnGuide: "GitHub's guide to a custom domain",
  siteSize: 'How much the published site weighs, of the 1 GB GitHub Pages serves',
  repoSize: 'How much the repository weighs with its history, of the 1 GB GitHub recommends',
  githubLimits: "GitHub's own page of Pages limits",
  siteRead: 'Read the site on GitHub, to list what it holds',
  siteFilter: 'Show only these on the list',
  siteOpenItem: 'Open this page on the site',
  sitePlace: 'Where this article stands on the site\'s map',
  siteDelete: 'Delete this folder from the site, and from its lists',
  siteDeleteOutside: 'Made outside Azimut: delete it on GitHub',
  siteCategory: 'The category of this article, changed on GitHub as you pick it',
  categoryName: 'The name of a category to add',
  categoryAdd: 'Offer this category when you publish, until an article carries it',
  categoryRename: 'Give this category another name on every article that carries it',
  categoryRenameField: 'The new name of the category',
  categorySave: 'Rename it, once you confirm',
  categoryCancel: 'Keep the name as it is',
  categoryDelete: 'Take this category off every article that carries it',
  categoryRemove: 'Stop offering this category',
  homeOnline: 'Write Azimut\'s home page, its feed and its sitemap on the site now',
  homeSee: 'Open the home page in a new tab',
  legalStart: 'Make a page titled Legal notice in the open case, with the host named',
  privacyStart: 'Make a page titled Privacy in the open case, with the counting named',
  statsOff: 'Do not count the readers of the site',
  statsGoatcounter: 'Count each page view on your GoatCounter site, with no cookie',
  statsCloudflare: 'Count readers with Cloudflare Web Analytics, which sets no cookie',
  statsCode: 'Your GoatCounter site code, the first part of its address',
  statsToken: 'The site token of your Web Analytics site, which every page prints',
  statsHow: 'How to make the counter and where its code is found',
  goatcounterSignup: 'Open GoatCounter, to make a free site',
  cloudflareSignup: 'Open Cloudflare, to make a free account',
  cloudflareGuide: "Cloudflare's own guide to adding a site",
  cloudflareDashboard: "Open Cloudflare's Web Analytics dashboard",
  statsAccount: 'Your Cloudflare account ID, 32 letters and digits',
  statsTag: 'The site tag Web Analytics gives the site, which is not its token',
  statsTagHand: 'Type the site tag yourself, for when Azimut cannot find it',
  statsApiToken: 'A read-only Cloudflare API token, kept on this computer only',
  statsApiForget: 'Forget the API token on this computer',
  statsNumbers: 'Ask Cloudflare for the last 30 days of numbers',
  statsNumbersHow: 'Where each answer is found in Cloudflare',
  statsTokenGuide: "Cloudflare's guide to a token that reads analytics",
  statsOpenPage: 'Open this page on the site',
  statsWeek: 'Page views over the last 7 days',
  statsMonth: 'Page views over the last 30 days',
  goatcounterOwn: 'Open your GoatCounter site, where its numbers are',
  copyFeed: 'Copy the address of the feed',
  copySitemap: 'Copy the address of the sitemap',
  chore: 'Show how to do it',
  // the publish dialog
  publishCategory: 'The category this article is listed under on the site',
  publishRead: 'Read the categories the site already uses',
  publishArticle: 'List it on the site, in its feed and its sitemap',
  publishPage: 'Keep it off the lists and link it from the site\'s header',
  publishUnlisted: 'Put it online without listing it anywhere',
  publishName: 'Open Settings › Website, to name the site',
  publishImage: 'The picture this article has in the site\'s list',
  publishImageClear: 'Back to the cover picture',
  publishAuthor: 'Who wrote it, signed on its page and named in the site\'s lists',
  publishAuthorImage: 'A small round picture before the author\'s name',
  publishAuthorImageClear: 'No picture beside the author\'s name',
  publishMore: 'The article\'s coordinates, for the site\'s map',
  publishPlace: 'Where this article stands on the site\'s map, pasted as lat, lon',
  publishPlaceName: 'The name of the place, shown on its pin',
  publishPlaceUse: 'Fill the place with the point this note names',
  publishAnyway: 'Replace the folder on GitHub with this version',
  publishStop: 'Leave the folder on GitHub as it is',
  publishReplace: 'Publish this note in its place',
  publishPickAnother: 'Leave it there and give this note a free address',
  publishMapsFirst: 'Publish each map to this site, then this article',
  // WordPress
  wordpressSite: 'The WordPress site a note is sent to as a draft',
  wordpressUser: 'The username you sign in to WordPress with',
  wordpressPassword: 'An application password from Users › Profile, kept on this computer only',
  wordpressTest: 'Sign in to the site and say as whom',
  wordpressForget: 'Forget the address, the username and the password on this computer',
  wordpressHow: 'Where each answer is found in WordPress',
  wordpressGuide: "WordPress's own guide to application passwords",
  // GitHub Pages
  githubAccount: 'Your GitHub username, or the organisation that owns the repository',
  githubRepo: 'The repository the articles go in, one folder each',
  githubBranch: 'The branch GitHub Pages serves',
  githubToken: 'A fine-grained token for that one repository, kept on this computer only',
  githubTest: 'Sign in to GitHub and say whether Pages serves the repository',
  githubForget: 'Forget the account and the token on this computer',
  githubHow: 'How to make the repository and the token, step by step',
  githubSignup: 'Open a free GitHub account',
  githubTokenPage: "GitHub's token page, with Contents and Pages picked",
  githubCreate: 'Make the repository on GitHub, public, with a README',
  githubPagesOn: 'Turn GitHub Pages on for the branch',
  githubNewRepo: "GitHub's new repository page, with the name and Public picked",
  githubPagesSettings: "The repository's Pages settings on github.com",
};
