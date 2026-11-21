/**
 * What Settings › Website and the publish dialog say about the analyst's site, said the same way
 * wherever it is needed.
 *
 * The words the folder's `HOW-TO-PUBLISH.md` carries too are the engine's (`engine/site.py`):
 * `tests/test_site.py` holds the copies here to the same text. The rest is this side's: the
 * statistics setup, what each press says and the hover texts of the tab and of the dialog's fields.
 */
import { COUNTER_STEPS, GOATCOUNTER_SIGNUP, counterCode } from './goatcounterSetup.js';

export { GOATCOUNTER_SIGNUP, counterCode };

// -- the engine's own words (engine/site.py) ------------------------------------------------------

export const SITE_TITLE = 'Website';
export const SITE_INTRO = 'Publish your notes as a simple website on GitHub Pages: a home page and the list of your articles, kept up to date each time you publish.';
export const SITE_STAYS_YOURS = 'The site stays yours to change, and Azimut only ever rewrites the files it made.';
export const SITE_OWN_TITLE = 'Make it yours';
/** Each way to make the site one's own: its lead, then what to do, with `code` and one [link](address). */
export const SITE_OWN = Object.freeze([
  ['Your own home page', 'write your `index.html` and put `<!-- azimut:articles -->` `<!-- /azimut:articles -->` where the list goes.'],
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

// -- the hub: its panels, its checklist, what each part says --------------------------------------

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
  articles: ['What\'s on the site', 'Every article, map and page the site lists, as GitHub holds them. Nothing is read from GitHub until you press.'],
  readers: ['Who reads it', 'Count your readers, and help them follow and find the site.'],
  upkeep: ['Keep it in shape', 'What Azimut writes, what stays yours, and how to do the usual chores.'],
  yours: [SITE_OWN_TITLE, 'Azimut\'s site is a simple start. Change as much of it as you like: Azimut keeps filling the lists.'],
  wordpress: ['Also send to WordPress', 'A note can go to a WordPress site as a draft, apart from the GitHub site.'],
});

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
export const NEEDS_READ = 'Read the site, in Articles, to tell.';
/** What a read says when GitHub cut the tree short: the site holds more files than can be listed. */
export const TOO_MANY = 'The site holds too many files to read.';
export const TOO_MANY_SHORT = 'Too many files to read';
export const SIZE_UNKNOWN = 'Size unknown: the site holds too many files to read.';

/** The three tips of the Overview, each a title and a line. */
export const HUB_TIPS = Object.freeze([
  ['Try before you announce', 'Publish as Unlisted: the page is online at its address but in no list, feed or sitemap.'],
  ['Take an article down', 'Press Delete on its line in Articles: the lists, the feed and the sitemap forget it in the same commit.'],
  ['Change the name or the logo', 'The lists change at the next publish or Update the site. Each article\'s bar changes when you publish it again.'],
]);

/** The tip shown once the site passes four fifths of what GitHub Pages serves. */
export const SIZE_TIP_TITLE = 'The site is getting big';
export function sizeTipSaid(weight, percent) {
  return `It weighs ${weight}, ${percent}% of the 1 GB GitHub Pages serves. Limits, in Hosting, says what that means.`;
}

// identity
export const SITE_NAME_LABEL = 'Site name';
export const SITE_NAME_PLACEHOLDER = 'Your site\'s name';
export const SITE_LOGO_LABEL = 'Site logo';
export const SITE_LOGO_PICK = 'Choose a PNG…';
export const SITE_LOGO_RESET = 'Use the Publishing logo';
export const SITE_LOGO_SAID = Object.freeze({
  site: 'A picture of its own, on every page of the site.',
  publishing: 'The Publishing logo, the one on your reports. Pick a picture to give the site its own.',
  '': 'A square PNG, up to 2 MB. The pages carry no logo until you pick one.',
});
export const SITE_LOGO_BIG = 'The logo must be under 2 MB';
export const SITE_LOGO_NOT_PNG = 'The logo must be a PNG picture';
export const PREVIEWS = Object.freeze([
  { id: 'bar', label: 'Article bar' },
  { id: 'home', label: 'Home page' },
  { id: 'feed', label: 'Feed' },
]);
/** What the previews show before the site is read, and what the bar's link says. */
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
export function ownHomeSaid(host) {
  return `${host || 'The site'} has a home page of your own: Azimut fills its lists and leaves its header as you wrote it.`;
}

// hosting
export const HOSTING_DOMAIN_GUIDE = 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site';
export const ADDRESS_OWN = 'Your own domain';
export const ADDRESS_GITHUB = 'GitHub\'s address';
export const ADDRESS_NONE = 'Set up GitHub Pages first, and the address shows here.';
export const ADDRESS_NOTE = 'Set in the repository\'s CNAME file. Without one, the site lives at your-account.github.io/repository.';
export const DOMAIN_TITLE = 'A domain of your own';
export const DOMAIN_SAID = 'Buy one from any registrar, then point it to GitHub Pages.';
export const DOMAIN_LINK = 'GitHub\'s guide';

/** What GitHub Pages holds a site to: a gigabyte, read as 1024 cubed like the sizes GitHub reports. */
export const SITE_LIMIT_BYTES = 1024 ** 3;
export const LIMITS_TITLE = 'Limits';
export const LIMITS_UNREAD = 'Read the site to see its size.';
export const LIMITS_AMBER = 0.8;
export const LIMITS_RED = 0.95;
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
export const READ_FIRST = 'The site is not read yet. Press Read the site to list its articles, maps and pages.';
export const READ_NONE = 'The site lists nothing yet. Publish a note from the Notebook.';
export const READ_NOT_SET = 'Set up GitHub Pages under Hosting first';
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
export const PAGES_TITLE = 'Pages every site should have';
export const PAGES_NOTE = 'Each starts as a note in the open case, with the host named. You fill in the rest.';
export const PRIVACY_PRESS = 'Start a Privacy page';
export const PRIVACY_SAID = 'It names the host and what the counter records.';
export const PAGE_ON_SITE = 'On the site';
export const DELETE_TITLE = 'Delete this article from the site?';
export const DELETE_CONFIRM = 'Delete from the site';
export function deleteSaid(folder, repository) {
  return `Deletes ${folder}/ from ${repository} and takes it off the lists, the feed and the sitemap, in one commit. `
    + 'The note stays in your case: publish it again to put it back.';
}
/** What a delete did: how many files it wrote, or just that the folder is gone when the server counted none. */
export function deletedSaid(folder, answer) {
  if (answer?.removed === null || !Array.isArray(answer?.written)) return `Deleted ${folder}/.`;
  const count = answer.written.length;
  return `Deleted ${folder}/: ${count} file${count === 1 ? '' : 's'} written.`;
}
/** Said beside a card the server would not delete: it was made by something else, such as a WordPress export. */
export const OUTSIDE_AZIMUT = 'Made outside Azimut';

// readers
export const FOLLOW_TITLE = 'Follow and find';
export const FEED_SAID = 'Readers subscribe to the feed with any feed reader.';
export const SITEMAP_SAID = 'Give the sitemap to Google Search Console or Bing Webmaster Tools, to be found sooner.';
export const FOLLOW_NONE = 'Set up GitHub Pages first, and the addresses show here.';
/** Cloudflare's dashboard on the Web Analytics page of whichever account the analyst picks. */
export const CLOUDFLARE_DASHBOARD = 'https://dash.cloudflare.com/?to=/:account/web-analytics';

// upkeep
export const OWNERS_TITLE = 'Who writes what';
export const OWNERS_UNREAD = 'Read the site, in Articles, to see which of your pages Azimut fills.';
export const OWNERS_TRUNCATED = 'The site holds too many files to read, so its pages are not listed here.';
export const CHORES_TITLE = 'Usual chores';
export const CHORES = Object.freeze([
  ['Take an article down', 'Press Delete on its line in Articles. Deleting its folder on GitHub works too: then press Update the site, so the lists, the feed and the sitemap forget it.'],
  ['Move an article to another category', 'Publish its note again and pick the new category.'],
  ['Rename the site or change its logo', 'Update the site changes the lists and the feed. Each article\'s bar changes when you publish it again.'],
  ['Fix a typo on GitHub directly', 'Fine. The next publish of that note asks before it replaces your fix.'],
  ['Test an article before it shows', 'Publish it as Unlisted, then as Article once it is ready.'],
]);

/** The last change the read found on the branch, when no Update the site was pressed here. */
export function lastChangeSaid(when, message = '') {
  return `Last change on GitHub ${when}${message ? `: ${message}` : ''}.`;
}

/** What Make it yours shows under a line, as lines of text each with how it is drawn. */
export const SITE_OWN_SAMPLES = Object.freeze({
  'Your own home page': [['m', '<main>'], ['c', '  <!-- azimut:articles -->'], ['c', '  <!-- /azimut:articles -->'], ['m', '</main>']],
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
/** After publishing a note that replaced a folder the analyst had changed, and was not warned before. */
export const REPLACED_EDITED = 'That folder had been changed on GitHub since you published it: this publish replaced it.';

// -- on hover, one clause each --------------------------------------------------------------------

/**
 * What the tab, its WordPress and GitHub Pages sections, the press that sets GitHub up and the
 * publish dialog's site fields say on hover, one clause each. `websiteSetup.test.js` holds every key to
 * a sentence and to a control showing it, and every control of those to a hover text.
 */
export const WEBSITE_HELP = {
  siteTitle: 'The name of your site, shown in its header and its feed',
  siteTagline: 'One line under the title on the home page',
  siteCredit: 'End the home page with Made with Azimut and its version, linked to the project',
  statsOff: 'Do not count the readers of the site',
  statsGoatcounter: 'Count each page view on your GoatCounter site, with no cookie',
  statsCloudflare: 'Count readers with Cloudflare Web Analytics, which sets no cookie',
  statsCode: 'Your GoatCounter site code, the first part of its address',
  statsToken: 'The token of your Cloudflare Web Analytics site, which every page prints',
  statsHow: 'How to make the counter and where its code is found',
  goatcounterSignup: 'Open GoatCounter, to make a free site',
  cloudflareSignup: 'Open Cloudflare, to make a free account',
  cloudflareGuide: "Cloudflare's own guide to adding a site",
  siteUpdate: 'Rebuild the home, list, feed and sitemap from the articles on GitHub',
  legalStart: 'Make a page titled Legal notice in the open case, with the host named',
  privacyStart: 'Make a page titled Privacy in the open case, with the counting named',
  tabOverview: 'How the site works and what is left to set up',
  tabIdentity: 'The name, tagline and logo of the site, with a preview',
  tabHosting: 'Where the site lives, its address and its limits',
  tabArticles: 'What the site lists, read from GitHub on a press',
  tabReaders: 'Count the readers and give them the feed and the sitemap',
  tabUpkeep: 'Update the site, who writes which file and the usual chores',
  tabYours: 'Change as much of the site as you like',
  tabWordpress: 'Send a note to a WordPress site as a draft',
  hubGo: 'Open the panel where this is set',
  siteOpen: 'Open the site in a new tab',
  siteLogoPick: 'Pick a square PNG as the logo of the site',
  siteLogoReset: 'Back to the logo of Settings › Publishing',
  previewBar: 'How the bar over an article reads',
  previewHome: 'How the home page reads',
  previewFeed: 'How the feed reads',
  siteRead: 'Read the site on GitHub, to list what it holds',
  siteFilter: 'Show only these on the list',
  siteOpenItem: 'Open this page on the site',
  siteDelete: 'Delete this folder from the site, and from its lists',
  siteDeleteOutside: 'Made outside Azimut: delete it on GitHub',
  siteSize: 'How much the published site weighs, of the 1 GB GitHub Pages serves',
  repoSize: 'How much the repository weighs with its history, of the 1 GB GitHub recommends',
  githubLimits: "GitHub's own page of Pages limits",
  copyFeed: 'Copy the address of the feed',
  copySitemap: 'Copy the address of the sitemap',
  cloudflareDashboard: "Open Cloudflare's Web Analytics dashboard",
  chore: 'Show how to do it',
  siteOwnGuide: "GitHub's guide to a custom domain",
  publishCategory: 'The category this article is listed under on the site',
  publishRead: 'Read the categories the site already uses',
  publishArticle: 'List it on the site, in its feed and its sitemap',
  publishPage: 'Keep it off the lists and link it from the site\'s header',
  publishUnlisted: 'Put it online without listing it anywhere',
  publishName: 'Open Settings › Website, to name the site',
  publishImage: 'The picture this article has in the site\'s list',
  publishImageClear: 'Back to the cover picture',
  publishAnyway: 'Replace the folder on GitHub with this version',
  publishStop: 'Leave the folder on GitHub as it is',
  wordpressSite: 'The WordPress site a note is sent to as a draft',
  wordpressUser: 'The username you sign in to WordPress with',
  wordpressPassword: 'An application password from Users › Profile, kept on this computer only',
  wordpressTest: 'Sign in to the site and say as whom',
  wordpressForget: 'Forget the address, the username and the password on this computer',
  wordpressHow: 'Where each answer is found in WordPress',
  wordpressGuide: "WordPress's own guide to application passwords",
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
