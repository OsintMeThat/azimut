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
  ['Your own bar', 'put your header and its `<style>` in `azimut-bar.html` at the site\'s root: articles carry it in place of Azimut\'s bar, maps keep theirs, and Update the site brings an edit to all of them. Scripts are dropped, links start from the site\'s root, and each `<svg>` needs a `width` and a `height`.'],
  ['A page per category', 'the same markers with `section="Investigations"` list that category only.'],
  ['Your own domain', 'buy one, then point it to GitHub Pages ([GitHub\'s guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)).'],
  ['Your own scripts', '`articles.json` lists every article with its title, date, category and picture.'],
]);
export const LEGAL_SENTENCE = 'Depending on your country, a website may need a legal notice.';
export const HAND_EDITED = 'This folder was changed on GitHub since you published it: publishing replaces it.';
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
export const CLOUDFLARE_MISSING = 'Paste the token below for the count to start.';
export const GOATCOUNTER_BAD = 'That does not read as a GoatCounter code: lower-case letters, digits and hyphens, such as mycode.';
export const CLOUDFLARE_BAD = 'That does not read as a Cloudflare token: 8 to 64 letters, digits, hyphens and underscores.';

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
  ['Copy the token', 'Under Manage site, the snippet holds data-cf-beacon with a token: copy the letters and digits after "token":.'],
  ['Paste the token', 'Type it below, or paste the whole snippet. Counting starts with the next publish or Update the site.'],
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
export function updatingSaid(repository) {
  return `Updating ${repository}…`;
}
export function updatedSaid(when) {
  return `Updated ${when}`;
}

// the overview

/** The four steps from a note to a reader; the last two name the repository and the site once known. */
export function flowSteps({ repository = '', host = '' } = {}) {
  return [
    ['Write', 'A note in the Notebook, with its pictures, maps and sources.'],
    ['Publish', 'Notebook › Publish › GitHub Pages, as an article, a page or unlisted.'],
    ['GitHub keeps it', `One folder per note in ${repository || 'your repository'}.`],
    ['Readers find it', `On ${host || 'your site'}, in its lists, its feed and search engines.`],
  ];
}
export const FLOW_AFTER = 'Each publish also refreshes';
export const FLOW_REFRESHES = Object.freeze(['the home list', 'the feed', 'the sitemap']);

export const CHECKLIST_TITLE = 'Your site, step by step';
export const OPTIONAL = 'optional';
export const NEEDS_READ = 'Read the site, in Articles, to tell.';
/** What a read says when GitHub cut the tree short: the site holds more files than it lists. */
export const TOO_MANY = 'The site holds too many files to read.';
export const TOO_MANY_SHORT = 'Too many files to read';

/**
 * The six things that make a site, each `done`, `todo` or `unknown` (a read of the site tells), with
 * what it says and the panel it opens. The optional ones say so, and still count.
 */
export function checklist({ ready = false, repository = '', branch = '', title = '', fallback = '', siteLogo = false, logoFrom = '', counting = '',
  stats = '', read = null } = {}) {
  // a read cut short lists nothing, which tells nothing of the site
  const unread = !read || read.truncated;
  const why = read ? TOO_MANY : NEEDS_READ;
  const articles = read ? read.items.filter((item) => item.role === 'article').length : 0;
  const asked = stats === 'goatcounter' ? 'code' : 'token';
  return [
    { id: 'hosting', label: 'Connect GitHub Pages', go: 'hosting', state: ready ? 'done' : 'todo',
      said: ready ? `${repository} on ${branch}` : 'Add the account, the repository and the token.' },
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

/** The three tips of the Overview, each a title and a line. */
export const HUB_TIPS = Object.freeze([
  ['Try before you announce', 'Publish as Unlisted: the page is online at its address but in no list, feed or sitemap.'],
  ['Take an article down', 'Press Delete on its line in Articles: the lists, the feed and the sitemap forget it in the same commit.'],
  ['Change the name or the logo', 'The lists change at the next publish or Update the site. Each article\'s bar changes when you publish it again.'],
]);

/** The tip shown once the site passes four fifths of what GitHub Pages serves. */
export const SIZE_TIP_TITLE = 'The site is getting big';
export function sizeTipSaid(weight, percent) {
  return `It weighs ${weight}, ${percent}% of the 1 GB GitHub Pages serves.`;
}
export const SIZE_TIP_GO = 'See the limits';

// identity

export const SITE_NAME_LABEL = 'Site name';
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
/** The site's own bar, `azimut-bar.html`, and what the Article bar preview says once a read finds it in use. */
export const OWN_BAR_FILE = 'azimut-bar.html';
export const OWN_BAR_IN_USE = 'Your own bar, on every article';
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
export function readingSaid(repository) {
  return `Reading ${repository}…`;
}
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
  ['unlisted', 'Online at its address only. For a test, or a draft to show someone.'],
]);
export const KINDS_NOTE = 'You pick the kind in the publish window, each time you publish a note.';
export const CATEGORIES_TITLE = 'Categories';
export const CATEGORIES_SAID = 'Made in the publish window: pick one the site uses or type a new one.';
export const CATEGORIES_NOTE = 'A category gets a page of its own with the markers in Make it yours.';
export const CATEGORIES_UNREAD = 'Read the site to list its categories.';
export const CATEGORIES_NONE = 'No category on the site yet.';
export function categoryCountSaid(count) {
  return plural(count, 'article');
}
export function categoryPagesSaid(pages) {
  return pages.length ? `${pages.map((page) => `/${page}`).join(', ')} ${pages.length === 1 ? 'lists' : 'list'} them` : 'no page of its own';
}
export const PAGES_TITLE = 'Pages every site should have';
export const PAGES_NOTE = 'Each starts as a note in the open case, with the host named. You fill in the rest.';
export const PRIVACY_PRESS = 'Start a Privacy page';
export const PRIVACY_SAID = 'It names the host and what the counter records.';
export const PAGE_ON_SITE = 'On the site';
export const STARTING = 'Starting…';

// readers

export const STATS_TITLE = 'Count readers';
export const COUNTING_SAID = 'Counting every page of the site.';
export const CLOUDFLARE_DASHBOARD = 'https://dash.cloudflare.com/?to=/:account/web-analytics';
export const FOLLOW_TITLE = 'Follow and find';
export const FEED_SAID = 'Readers subscribe to the feed with any feed reader.';
export const SITEMAP_SAID = 'Give the sitemap to Google Search Console or Bing Webmaster Tools, to be found sooner.';
export const FOLLOW_NONE = 'Set up GitHub Pages first, and the addresses show here.';
export const COPY_PRESS = 'Copy';

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
    { files: ['everything else'], who: 'you', text: 'Never touches it.' },
  ];
}
export const OWNER_LABEL = Object.freeze({ azimut: 'Azimut', you: 'You' });

export const CHORES_TITLE = 'Usual chores';
export const CHORES = Object.freeze([
  ['Take an article down', 'Press Delete on its line in Articles. Deleted on GitHub instead, press Update the site so the lists, the feed and the sitemap forget it.'],
  ['Move an article to another category', 'Publish its note again and pick the new category.'],
  ['Rename the site or change its logo', 'Update the site changes the lists and the feed. Each article\'s bar changes when you publish it again.'],
  ['Fix a typo on GitHub directly', 'Fine. The next publish of that note asks before it replaces your fix.'],
  ['Test an article before it shows', 'Publish it as Unlisted, then as Article once it is ready.'],
]);

/** The last change the read found on the branch, said in Upkeep until Update the site is pressed here. */
export function lastChangeSaid(when, message = '') {
  return `Last change on GitHub ${when}${message ? `: ${message}` : ''}.`;
}

/** What Make it yours shows under a way, as lines each with how it is drawn: `m` markup, `c` a marker, '' plain. */
export const SITE_OWN_SAMPLES = Object.freeze({
  'Your own home page': [['m', '<main>'], ['c', '  <!-- azimut:articles -->'], ['c', '  <!-- /azimut:articles -->'], ['m', '</main>']],
  'Your own bar': [['m', '<style>:host { font: 15px system-ui }</style>'], ['m', '<header><a href="./">'],
    ['m', '  <svg width="24" height="24">…</svg> My site'], ['m', '</a></header>']],
  'A page per category': [['c', '<!-- azimut:articles section="Investigations" -->'], ['c', '<!-- /azimut:articles -->']],
  'Your own scripts': [['', '{ "title": "…", "date": "2026-11-20",'], ['', '  "category": "Conflict Watch", "image": "/…/cover.jpg" }']],
});

// -- the publish dialog's fields ------------------------------------------------------------------

export const ON_SITE = Object.freeze([
  { id: 'article', label: 'Article' },
  { id: 'page', label: 'Page' },
  { id: 'unlisted', label: 'Unlisted' },
]);
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

export const CATEGORY_SAID = 'Pick one the site uses or type a new one. Left empty, the article has none.';
export const LIST_IMAGE_COVER = 'The cover picture';
export const AUTHOR_LABEL = 'Author';
export const AUTHOR_IMAGE_LABEL = 'Author picture';
export const AUTHOR_IMAGE_NONE = 'No picture';

// the place on the site's map: optional, never filled without a press

/** How far north or south a place may stand, and the longest its name is (`notelook.PLACE_LAT_MAX`, `PLACE_NAME_MAX`). */
export const PLACE_LAT_MAX = 85;
export const PLACE_NAME_MAX = 80;
export const PLACE_TITLE = 'Place on the site\'s map';
export const PLACE_COORDS_LABEL = 'Coordinates';
export const PLACE_NAME_LABEL = 'Place name';
export const PLACE_COORDS_PLACEHOLDER = 'lat, lon';
export const PLACE_NAME_PLACEHOLDER = 'Name on the pin';
export const PLACE_EMPTY = 'Optional. Left empty, the article has no pin on the site\'s map.';
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
  if (!text) return { place: null, problem: '', said: label ? PLACE_NAME_ALONE : PLACE_EMPTY };
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
  legalStart: 'Make a page titled Legal notice in the open case, with the host named',
  privacyStart: 'Make a page titled Privacy in the open case, with the counting named',
  statsOff: 'Do not count the readers of the site',
  statsGoatcounter: 'Count each page view on your GoatCounter site, with no cookie',
  statsCloudflare: 'Count readers with Cloudflare Web Analytics, which sets no cookie',
  statsCode: 'Your GoatCounter site code, the first part of its address',
  statsToken: 'The token of your Cloudflare Web Analytics site, which every page prints',
  statsHow: 'How to make the counter and where its code is found',
  goatcounterSignup: 'Open GoatCounter, to make a free site',
  cloudflareSignup: 'Open Cloudflare, to make a free account',
  cloudflareGuide: "Cloudflare's own guide to adding a site",
  cloudflareDashboard: "Open Cloudflare's Web Analytics dashboard",
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
  publishPlace: 'Where this article stands on the site\'s map, pasted as lat, lon',
  publishPlaceName: 'The name of the place, shown on its pin',
  publishPlaceUse: 'Fill the place with the point this note names',
  publishAnyway: 'Replace the folder on GitHub with this version',
  publishStop: 'Leave the folder on GitHub as it is',
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
