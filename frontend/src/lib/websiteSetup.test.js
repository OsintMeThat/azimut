import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as setup from './websiteSetup.js';
import {
  CLOUDFLARE_STEPS, GOATCOUNTER_STEPS, HUB_LEADS, HUB_TABS, LEGAL_SENTENCE, LIMITS_LINES, NEEDS_READ, ON_SITE, SITE_OWN, STATS_CHOICES, TOO_MANY,
  WEBSITE_HELP, barSaid, beaconToken, categoryPagesSaid, checklist, counterCode, countsSaid, dayShort, deleteSaid, deletedSaid, flowSteps,
  nameFallbackSaid, noNameSaid, onSiteSaid, ownParts, ownersOf, placeDegrees, placeOf, placeText, placeUseSaid, progressSaid, readPlace, sizeTipSaid,
  updateSaid, whenSaid,
} from './websiteSetup.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// the hub is the tab and one component per panel
const PANELS = readdirSync(new URL('../tools/settings/website/', import.meta.url)).filter((name) => name.endsWith('.svelte'));
const HUB_FILES = [read('../tools/settings/WebsiteTab.svelte'), ...PANELS.map((name) => read(`../tools/settings/website/${name}`))];
const TAB = HUB_FILES.join('\n');
const markupOf = (source) => source.slice(source.indexOf('</script>'));
const GITHUB = read('../tools/settings/GitHubPagesSettings.svelte');
const WORDPRESS = read('../tools/settings/WordPressSettings.svelte');
const GITHUB_PRESS = read('../components/GitHubSetupPress.svelte');
const DIALOG = read('../tools/notebook/GitHubPublish.svelte');
// Publish anyway is the dialog's own button, which the Notebook holds
const NOTEBOOK = read('../tools/Notebook.svelte');

/** Every opening tag a pattern starts, whole: braces hold `=>` without ending the tag. */
function tags(markup, start) {
  const found = [];
  for (const match of markup.matchAll(start)) {
    let depth = 0;
    let end = match.index;
    for (; end < markup.length; end += 1) {
      const char = markup[end];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    found.push(markup.slice(match.index, end + 1));
  }
  return found;
}

describe('what Settings › Website says on hover', () => {
  it('says one short clause per setting, in the terse register of the app', () => {
    for (const [key, text] of Object.entries(WEBSITE_HELP)) {
      expect(text, key).toMatch(/^[A-Z]/);
      expect(text, key).not.toMatch(/\.$/);
      expect(text, key).not.toContain('—');
      expect(text.length, key).toBeLessThanOrEqual(100);
    }
  });

  it('has no text left that no control shows', () => {
    for (const key of Object.keys(WEBSITE_HELP)) {
      expect([TAB, GITHUB, WORDPRESS, GITHUB_PRESS, DIALOG, NOTEBOOK].some((source) => source.includes(`HELP.${key}`)), key).toBe(true);
    }
  });

  it.each([['the hub', HUB_FILES.map(markupOf).join('\n'), 30], ['the WordPress section', markupOf(WORDPRESS), 4], ['the GitHub Pages section', markupOf(GITHUB), 7],
    ['the GitHub setup press', markupOf(GITHUB_PRESS), 2], ['the publish dialog', markupOf(DIALOG), 8]])('titles every control of %s', (_, markup, least) => {
    const controls = tags(markup, /<(input|button|select|summary|a)\b/g);
    expect(controls.length).toBeGreaterThan(least);
    for (const control of controls) expect(control, control).toMatch(/\btitle=/);
  });
});

describe('the words of the tab', () => {
  it('says each sentence plainly: a capital, a full stop, no em-dash and no maxim', () => {
    const sentences = Object.entries(setup).filter(([name, value]) => typeof value === 'string'
      && /^(SITE_(INTRO|STAYS_YOURS|OPTIONAL)|LEGAL_(SENTENCE|SAID)|[A-Z]+_(HINT|SAID|MISSING|BAD)|STATS_(INTRO|OFF_SAID)|UPDATE_(SAID|UPTODATE)|HAND_EDITED|WORKFLOW_NOTICE|REPLACED_EDITED)$/.test(name));
    expect(sentences.length).toBeGreaterThan(18);
    for (const [name, text] of sentences) {
      expect(text, name).toMatch(/^[A-Z]/);
      expect(text, name).toMatch(/\.$/);
      expect(text, name).not.toContain('—');
    }
  });

  it('keeps the Legal notice to one sentence of the engine and no other legal advice', () => {
    expect(LEGAL_SENTENCE).toBe('Depending on your country, a website may need a legal notice.');
    expect(setup.LEGAL_SAID).not.toMatch(/law|lawyer|GDPR|required|must/i);
  });

  it('offers three ways to count, off first, and explains each field by field, free', () => {
    expect(STATS_CHOICES.map((choice) => choice.id)).toEqual(['', 'goatcounter', 'cloudflare']);
    expect(setup.GOATCOUNTER_SAID).toMatch(/^Free\./);
    expect(setup.GOATCOUNTER_SAID).toContain('no cookie');
    expect(setup.CLOUDFLARE_SAID).toMatch(/^Free\./);
    expect(setup.CLOUDFLARE_SAID).toContain('static.cloudflareinsights.com');
    expect(setup.CLOUDFLARE_SAID).toContain('no cookie');
    expect(CLOUDFLARE_STEPS.map(([step]) => step)).toEqual(['Sign up', 'Add the site', 'Copy the token', 'Paste the token']);
    const steps = CLOUDFLARE_STEPS.map(([, text]) => text).join(' ');
    for (const said of ['free account', 'Web Analytics', 'Add a site', 'host name', 'Done', 'Manage site', 'data-cf-beacon', 'Update the site']) {
      expect(steps, said).toContain(said);
    }
    expect(GOATCOUNTER_STEPS.map(([step]) => step)).toEqual(['Sign up', 'Paste the code', 'Show the views']);
    // the map page's wording is the site's now: every page, not only a map
    expect(GOATCOUNTER_STEPS.map(([, text]) => text).join(' ')).toContain('next publish or Update the site');
    for (const list of [CLOUDFLARE_STEPS, GOATCOUNTER_STEPS, SITE_OWN, ON_SITE, STATS_CHOICES]) expect(Object.isFrozen(list)).toBe(true);
    expect(setup.CLOUDFLARE_SIGNUP).toMatch(/^https:\/\/dash\.cloudflare\.com\//);
    expect(setup.CLOUDFLARE_GUIDE).toMatch(/^https:\/\/developers\.cloudflare\.com\//);
  });

  it('says what Update the site did', () => {
    expect(updateSaid({ ok: true, updated: false, written: [] })).toBe('The site is up to date.');
    expect(updateSaid({ ok: true, updated: true, written: ['articles.json'] })).toBe('The site is updated: 1 file written.');
    expect(updateSaid({ ok: true, updated: true, written: ['articles.json', 'feed.xml', 'index.html'] })).toBe('The site is updated: 3 files written.');
    expect(updateSaid({ updated: true })).toBe('The site is updated.');
    expect(updateSaid(null)).toBe('The site is up to date.');
  });
});

describe('what a typed code or token reads as', () => {
  it('reads a GoatCounter code, or the site address that holds it', () => {
    expect(counterCode('')).toBe('');
    expect(counterCode('  MyCode ')).toBe('mycode');
    expect(counterCode('https://desk-1.goatcounter.com/')).toBe('desk-1');
    expect(counterCode('not a code')).toBeNull();
    expect(counterCode('-x')).toBeNull();
  });

  it('reads a Cloudflare token, or the snippet that holds it', () => {
    expect(beaconToken('')).toBe('');
    expect(beaconToken(null)).toBe('');
    expect(beaconToken(' 0123456789abcdef0123456789abcdef ')).toBe('0123456789abcdef0123456789abcdef');
    const snippet = `<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "0123456789abcdef0123456789abcdef"}'></script>`;
    expect(beaconToken(snippet)).toBe('0123456789abcdef0123456789abcdef');
    expect(beaconToken(`data-cf-beacon="{&quot;token&quot;: &quot;abcd1234-ef_56&quot;}"`)).toBe('abcd1234-ef_56');
    // what the server refuses: too short, too long, or anything but letters, digits, hyphens and underscores
    for (const bad of ['short', 'x'.repeat(65), 'a b c d e f g h', "'; alert(1)//", 'has.dots.in.it']) expect(beaconToken(bad), bad).toBeNull();
  });
});

describe('Make it yours', () => {
  it('cuts a line into words, code and a link', () => {
    expect(ownParts('write your `index.html` and put `<!-- azimut:articles -->` there.')).toEqual([
      { text: 'write your ' }, { code: 'index.html' }, { text: ' and put ' }, { code: '<!-- azimut:articles -->' }, { text: ' there.' }]);
    expect(ownParts('point it ([GitHub\'s guide](https://docs.github.com/x)).')).toEqual([
      { text: 'point it (' }, { link: 'GitHub\'s guide', href: 'https://docs.github.com/x' }, { text: ').' }]);
    expect(ownParts('plain')).toEqual([{ text: 'plain' }]);
  });

  it('holds the five ways, with no markup left over once cut', () => {
    expect(SITE_OWN.map(([lead]) => lead)).toEqual(['Your own home page', 'Your own bar', 'A page per category', 'Your own domain', 'Your own scripts']);
    const links = SITE_OWN.flatMap(([, text]) => ownParts(text)).filter((part) => part.link);
    expect(links).toEqual([{ link: 'GitHub\'s guide', href: 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site' }]);
    for (const [, text] of SITE_OWN) {
      for (const part of ownParts(text)) if (part.text) expect(part.text).not.toMatch(/[`[\]]/);
    }
  });

  it('says of the site\'s own bar where it goes, where it shows, what is dropped and what each picture needs', () => {
    const text = Object.fromEntries(SITE_OWN)['Your own bar'];
    expect(ownParts(text).filter((part) => part.code).map((part) => part.code)).toEqual(['<style>', 'azimut-bar.html', '<svg>', 'width', 'height']);
    for (const said of ['at the site\'s root', 'in place of Azimut\'s bar', 'maps keep theirs', 'Update the site', 'Scripts are dropped',
      'links start from the site\'s root']) expect(text, said).toContain(said);
    expect(text).not.toContain('—');
    const sample = setup.SITE_OWN_SAMPLES['Your own bar'].map(([, line]) => line).join('\n');
    expect(sample).toContain(':host');
    expect(sample).toContain('<svg width="24" height="24">');
    expect(sample).toContain('href="./"');
    expect(sample).not.toMatch(/<script|on\w+=/);
  });
});

describe('the hub\'s panels', () => {
  it('lists the panels in order with WordPress last, each with a heading and a line', () => {
    expect(HUB_TABS.map((tab) => tab.id)).toEqual(['overview', 'identity', 'hosting', 'articles', 'readers', 'upkeep', 'yours', 'wordpress']);
    expect(Object.keys(HUB_LEADS).sort()).toEqual(HUB_TABS.map((tab) => tab.id).sort());
    for (const [id, [title, sub]] of Object.entries(HUB_LEADS)) {
      expect(title, id).toMatch(/^[A-Z]/);
      expect(sub, id).toMatch(/\.$/);
      expect(`${title} ${sub}`, id).not.toContain('—');
    }
    expect(Object.isFrozen(HUB_TABS)).toBe(true);
    // the overview says what the engine says of the site
    expect(HUB_LEADS.overview[1]).toContain(setup.SITE_INTRO);
    expect(HUB_LEADS.overview[1]).toContain(setup.SITE_STAYS_YOURS);
  });

  it('says each sentence of the panels plainly: a capital, a full stop, no em-dash', () => {
    for (const name of ['NEEDS_READ', 'TOO_MANY', 'READ_FIRST', 'READ_NONE', 'KINDS_NOTE', 'CATEGORIES_SAID', 'CATEGORIES_NOTE', 'CATEGORIES_UNREAD', 'CATEGORIES_NONE',
      'PAGES_NOTE', 'PRIVACY_SAID', 'FEED_SAID', 'SITEMAP_SAID', 'FOLLOW_NONE', 'OWNERS_UNREAD', 'OWNERS_TRUNCATED', 'LIMITS_UNREAD', 'SIZE_UNKNOWN',
      'REPOSITORY_UNKNOWN', 'ADDRESS_NONE', 'ADDRESS_NOTE', 'DOMAIN_SAID', 'COUNTING_SAID', 'SITE_LOGO_BIG', 'SITE_LOGO_NOT_PNG']) {
      expect(setup[name], name).toMatch(/^[A-Z].*\.$/);
      expect(setup[name], name).not.toContain('—');
    }
    for (const [, said] of setup.HUB_TIPS) expect(said).toMatch(/^[A-Z].*\.$/);
    for (const [, how] of setup.CHORES) expect(how).toMatch(/^[A-Z].*\.$/);
    for (const [, said] of setup.KINDS) expect(said).toMatch(/^[A-Z].*\.$/);
    for (const said of Object.values(setup.SITE_LOGO_SAID)) expect(said).toMatch(/^[A-Z].*\.$/);
    expect(setup.HUB_TIPS).toHaveLength(3);
    expect(setup.CHORES).toHaveLength(5);
  });

  it('names the repository and the site in the flow once they are known', () => {
    expect(flowSteps().map(([name]) => name)).toEqual(['Write', 'Publish', 'GitHub keeps it', 'Readers find it']);
    expect(flowSteps()[2][1]).toBe('One folder per note in your repository.');
    expect(flowSteps({ repository: 'octo/articles', host: 'octo.example' })[2][1]).toBe('One folder per note in octo/articles.');
    expect(flowSteps({ repository: 'octo/articles', host: 'octo.example' })[3][1]).toBe('On octo.example, in its lists, its feed and search engines.');
  });

  it('says what an empty name falls back to, as the server reads it', () => {
    expect(nameFallbackSaid({ report: 'A. Analyst', account: 'octo' })).toBe('Empty, it takes your Publishing name, A. Analyst.');
    expect(nameFallbackSaid({ account: 'octo' })).toBe('Empty, it takes your GitHub account, octo.');
    expect(nameFallbackSaid()).toBe('Empty, it takes the name set in Settings › Publishing, else your GitHub account.');
  });

  it('holds the limits as the contract gives them, with GitHub\'s own page', () => {
    expect(LIMITS_LINES).toEqual([
      'The site: 1 GB at most.',
      'The repository: under 1 GB recommended, its history included.',
      'Readers: 100 GB of traffic a month, a soft limit.',
      'Builds: 10 an hour, a soft limit.',
      'A file: 50 MB at most in Azimut. GitHub warns from 50 MB and refuses past 100 MB.',
      'One publish: 200 MB and 1,000 files at most.',
      'Not for a shop, a paid service, or passwords and card numbers.',
    ]);
    expect(setup.LIMITS_LINK).toBe('https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits');
    expect(setup.SITE_LIMIT_BYTES).toBe(1024 ** 3);
    expect([setup.LIMITS_AMBER, setup.LIMITS_RED]).toEqual([0.8, 0.95]);
    expect(setup.HOSTING_DOMAIN_GUIDE).toBe(ownParts(Object.fromEntries(SITE_OWN)['Your own domain']).find((part) => part.href).href);
    expect(sizeTipSaid('850 MB', 83)).toBe('It weighs 850 MB, 83% of the 1 GB GitHub Pages serves.');
    expect(barSaid('site', '312 MB')).toBe('Site: 312 MB of 1 GB');
    expect(barSaid('repository', '1.4 GB')).toBe('Repository with its history: 1.4 GB of 1 GB recommended');
  });
});

describe('the publish dialog\'s words', () => {
  it('offers Article, Page and Unlisted, each said in a line', () => {
    expect(ON_SITE.map((choice) => choice.id)).toEqual(['article', 'page', 'unlisted']);
    expect(setup.ON_SITE_SAID.unlisted).toBe('Online at its address only, in no list, feed or sitemap.');
    expect(WEBSITE_HELP.publishUnlisted).toBe('Put it online without listing it anywhere');
    expect(Object.isFrozen(setup.ON_SITE_SAID)).toBe(true);
  });

  it('says where a note will appear, naming the site for an article', () => {
    expect(onSiteSaid('article', 'Octo Desk')).toBe('Goes on Octo Desk\'s home page and in its feed.');
    expect(onSiteSaid('article')).toBe('In the site\'s list and its feed.');
    expect(onSiteSaid('page', 'Octo Desk')).toBe('Off the list, linked from the site\'s header.');
    expect(onSiteSaid('unlisted', 'Octo Desk')).toBe('Online at its address only, in no list, feed or sitemap.');
    expect(noNameSaid('octo')).toBe('Your site has no name yet: it shows as octo.');
  });
});

describe('what a delete says', () => {
  it('names the folder and the repository in the dialog, and what was written after', () => {
    expect(deleteSaid('port-strike', 'octo/articles')).toBe('Deletes port-strike/ from octo/articles and takes it off the lists, the feed and the sitemap, in one commit. '
      + 'The note stays in your case: publish it again to put it back.');
    expect(setup.DELETE_TITLE).toBe('Delete this article from the site?');
    expect(setup.DELETE_CONFIRM).toBe('Delete from the site');
    expect(deletedSaid('port-strike', { removed: 4, written: ['articles.json', 'feed.xml', 'sitemap.xml'] })).toBe('Deleted port-strike/: 3 files written.');
    expect(deletedSaid('port-strike', { removed: 4, written: ['feed.xml'] })).toBe('Deleted port-strike/: 1 file written.');
    // a site too large to read: the folder went, and no list was written
    expect(deletedSaid('port-strike', { removed: 3, written: [] })).toBe('Deleted port-strike/: 0 files written.');
    // the server counted nothing it removed: only that the folder went
    expect(deletedSaid('port-strike', { removed: null, written: ['feed.xml'] })).toBe('Deleted port-strike/.');
    expect(deletedSaid('port-strike', null)).toBe('Deleted port-strike/.');
  });
});

describe('the words of a count, a kind and a time', () => {
  it('says the kinds the site holds and no other', () => {
    expect(countsSaid({ article: 5, map: 2 })).toBe('5 articles · 2 maps');
    expect(countsSaid({ article: 1, map: 1, page: 1, unlisted: 2 })).toBe('1 article · 1 map · 1 page · 2 unlisted');
    expect(countsSaid({})).toBe('Nothing on the site yet');
  });

  it('says today, yesterday, a day this year and a day of another year', () => {
    const now = new Date(2026, 10, 21, 15, 0);
    expect(whenSaid(new Date(2026, 10, 21, 13, 55), now)).toBe('today at 13:55');
    expect(whenSaid(new Date(2026, 10, 20, 9, 5), now)).toBe('yesterday at 09:05');
    expect(whenSaid(new Date(2026, 2, 12, 8, 0), now)).toBe('12 Mar at 08:00');
    expect(whenSaid(new Date(2025, 11, 31, 8, 0), now)).toBe('31 Dec 2025');
    expect(whenSaid('', now)).toBe('');
    expect(whenSaid('not a date', now)).toBe('');
    expect(dayShort('2026-11-20')).toBe('20 Nov 2026');
    expect(dayShort('2026-01-05T10:00:00Z')).toBe('5 Jan 2026');
    expect(dayShort('')).toBe('');
    expect(dayShort('someday')).toBe('someday');
  });

  it('names the pages that list a category, or says it has none', () => {
    expect(categoryPagesSaid(['investigations/'])).toBe('/investigations/ lists them');
    expect(categoryPagesSaid(['a/', 'b/'])).toBe('/a/, /b/ list them');
    expect(categoryPagesSaid([])).toBe('no page of its own');
  });
});

describe('the checklist', () => {
  const read = (more = {}) => ({ truncated: false, legal: '', items: [], ...more });
  const base = { ready: true, repository: 'octo/articles', branch: 'main', fallback: 'octo', logoFrom: 'publishing', stats: '' };

  it('says each state and where it is set, and asks for a read of what it cannot tell', () => {
    const steps = checklist(base);
    expect(steps.map((step) => [step.id, step.state, step.go])).toEqual([
      ['hosting', 'done', 'hosting'], ['name', 'todo', 'identity'], ['logo', 'todo', 'identity'], ['readers', 'todo', 'readers'],
      ['legal', 'unknown', 'articles'], ['first', 'unknown', 'articles']]);
    expect(steps.map((step) => step.said)).toEqual(['octo/articles on main', 'It shows as octo for now.', 'Uses your Publishing logo for now.',
      'Nobody is counted.', NEEDS_READ, NEEDS_READ]);
    expect(steps.filter((step) => step.optional).map((step) => step.id)).toEqual(['readers', 'legal']);
    expect(progressSaid(steps)).toBe('1 of 6 done. 2 need a read of the site.');
  });

  it('says what is left to do while nothing is set', () => {
    const steps = checklist({ ready: false, logoFrom: '', stats: 'goatcounter' });
    expect(steps.map((step) => step.said).slice(0, 4)).toEqual(['Add the account, the repository and the token.', 'It has no name yet.', 'No logo yet.',
      'GoatCounter is picked: paste its code.']);
    expect(checklist({ stats: 'cloudflare' })[3].said).toBe('Cloudflare Web Analytics is picked: paste its token.');
  });

  it('is done once the site is read and holds a legal notice and an article, and the logo and the name are the site\'s own', () => {
    const steps = checklist({ ...base, title: 'Octo Desk', siteLogo: true, counting: 'cloudflare',
      read: read({ legal: 'legal-notice/', items: [{ role: 'article' }, { role: 'page' }, { role: 'article' }] }) });
    expect(steps.every((step) => step.state === 'done')).toBe(true);
    expect(steps.map((step) => step.said).slice(1)).toEqual(['Octo Desk', 'A picture of its own.', 'Cloudflare Web Analytics', 'legal-notice/ is on the site.',
      '2 articles on the site.']);
    expect(progressSaid(steps)).toBe('6 of 6 done.');
  });

  it('says what a read found missing, and tells nothing from a read cut short', () => {
    const empty = checklist({ ...base, read: read() });
    expect(empty.slice(4).map((step) => [step.state, step.said])).toEqual([['todo', 'No legal notice on the site yet.'],
      ['todo', 'Nothing is listed on the site yet.']]);
    const cut = checklist({ ...base, read: read({ truncated: true }) });
    expect(cut.slice(4).map((step) => [step.state, step.said])).toEqual([['unknown', TOO_MANY], ['unknown', TOO_MANY]]);
    // a read was made: nothing more to read for
    expect(progressSaid(cut)).toBe('1 of 6 done.');
  });
});

describe('who writes what', () => {
  it('shows the default home as Azimut\'s until a read says the analyst wrote one, and lists the pages the read found marked', () => {
    const before = ownersOf(null);
    expect(before.map((row) => [row.files.join(' '), row.who])).toEqual([
      ['each article\'s folder', 'azimut'], ['articles.json feed.xml sitemap.xml', 'azimut'], ['index.html', 'azimut'], ['azimut-bar.html', 'you'],
      ['everything else', 'you']]);
    expect(before[3].text).toBe('Copied into each article\'s bar.');
    const yours = ownersOf({ truncated: false, home: 'yours', marked: ['', 'investigations/', 'conflict-watch/'] });
    expect(yours.map((row) => [row.files.join(' '), row.who])).toEqual([
      ['each article\'s folder', 'azimut'], ['articles.json feed.xml sitemap.xml', 'azimut'], ['index.html', 'you'],
      ['investigations/ conflict-watch/', 'you'], ['azimut-bar.html', 'you'], ['everything else', 'you']]);
    expect(yours[2].text).toBe('Fills the list between its markers, nothing else.');
    // a read cut short found no page: the table stays as before a read
    expect(ownersOf({ truncated: true, home: 'none', marked: [] })).toEqual(before);
  });
});

describe('the place on the site\'s map', () => {
  it('reads coordinates pasted as lat, lon, with hemispheres or in degrees, kept to six places', () => {
    expect(readPlace('12.7250041, 43.5075', ' Bab  al-Mandab ')).toEqual({ place: { lat: 12.725004, lon: 43.5075, name: 'Bab al-Mandab' }, problem: '',
      said: 'Reads as 12.725004° N, 43.5075° E.' });
    expect(readPlace('33.9S 18.42E').place).toEqual({ lat: -33.9, lon: 18.42, name: '' });
    expect(readPlace('33°54\'00"S 18°25\'12"E').place).toEqual({ lat: -33.9, lon: 18.42, name: '' });
    expect(readPlace('-33.9 -70.5').said).toBe('Reads as 33.9° S, 70.5° W.');
  });

  it('says why coordinates are no place, and an empty field is no place and no problem', () => {
    expect(readPlace('')).toEqual({ place: null, problem: '', said: setup.PLACE_EMPTY });
    expect(readPlace('  ', 'Bab al-Mandab')).toEqual({ place: null, problem: '', said: setup.PLACE_NAME_ALONE });
    expect(readPlace('Bab al-Mandab').problem).toBe(setup.PLACE_UNREAD);
    expect(readPlace('12.7').problem).toBe(setup.PLACE_UNREAD);
    expect(readPlace('85.1, 10').problem).toBe('The latitude must be between -85 and 85, where web maps stop.');
    expect(readPlace('-89, 10').problem).toBe(setup.PLACE_LAT_BAD);
    expect(readPlace('10, 180.5').problem).toBe(setup.PLACE_LON_BAD);
    for (const text of ['Bab al-Mandab', '85.1, 10', '10, 180.5']) expect(readPlace(text).place).toBeNull();
    // a name past its bound is cut, as the field's own bound cuts it
    expect(readPlace('1.5, 2.5', 'x'.repeat(120)).place.name).toHaveLength(80);
  });

  it('reads a kept place back for the field and says an offer as its press', () => {
    const kept = placeOf({ lat: 12.725004, lon: 43.5075, name: 'Bab al-Mandab' });
    expect(placeText(kept)).toBe('12.725004, 43.5075');
    expect(readPlace(placeText(kept), kept.name).place).toEqual(kept);
    expect(placeText(null)).toBe('');
    expect(placeUseSaid({ lat: 12.725004, lon: 43.5075, name: 'Bab al-Mandab' })).toBe('Use 12.7250, 43.5075 · Bab al-Mandab');
    expect(placeUseSaid({ lat: 12.6, lon: 43.4, name: '' })).toBe('Use 12.6000, 43.4000');
    expect(placeDegrees({ lat: -0.5, lon: -0.25 })).toBe('0.5° S, 0.25° W');
    expect(Object.keys(setup.PLACE_WHY)).toEqual(['place', 'proof', 'map']);
    for (const said of [...Object.values(setup.PLACE_WHY), setup.PLACE_EMPTY, setup.PLACE_NAME_ALONE, setup.PLACE_UNREAD, setup.PLACE_LAT_BAD, setup.PLACE_LON_BAD]) {
      expect(said).toMatch(/^[A-Z].*\.$/);
      expect(said).not.toContain('—');
    }
  });
});
