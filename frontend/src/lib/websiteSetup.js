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

export const SITE_OPTIONAL = 'Everything on this tab is optional: a site works with it all left empty.';
export const TITLE_HINT = 'Left empty, the site takes the name set in Settings › Publishing, else your GitHub account.';
export const TAGLINE_HINT = 'One line under the title on the home page.';
export const CREDIT_HINT = 'Ends the home page with Made with Azimut and its version.';

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
export const UPDATE_NOT_SET = 'Set up GitHub Pages above first';

/** What an Update the site answer says: up to date, or how many files it wrote. */
export function updateSaid(answer) {
  if (!answer?.updated) return UPDATE_UPTODATE;
  const count = Array.isArray(answer.written) ? answer.written.length : 0;
  return count ? `The site is updated: ${count} file${count === 1 ? '' : 's'} written.` : 'The site is updated.';
}

export const LEGAL_PRESS = 'Start a Legal notice page';
export const LEGAL_SAID = 'It names GitHub as the host and leaves the publisher lines to you.';
export const LEGAL_NO_CASE = 'Open a case first: the page is a note of that case';

// -- the publish dialog's fields ------------------------------------------------------------------

export const ON_SITE = Object.freeze([
  { id: 'article', label: 'Article' },
  { id: 'page', label: 'Page' },
]);
/** What a pick says, below the choice. */
export const ON_SITE_SAID = Object.freeze({
  article: 'In the site\'s list and its feed.',
  page: 'Off the list, linked from the site\'s header.',
});
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
  siteOwn: 'Four ways to change what Azimut makes for the site',
  siteOwnGuide: "GitHub's guide to a custom domain",
  publishCategory: 'The category this article is listed under on the site',
  publishRead: 'Read the categories the site already uses',
  publishArticle: 'List it on the site, in its feed and its sitemap',
  publishPage: 'Keep it off the lists and link it from the site\'s header',
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
