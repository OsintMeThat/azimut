import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as setup from './websiteSetup.js';
import {
  CLOUDFLARE_STEPS, GOATCOUNTER_STEPS, LEGAL_SENTENCE, ON_SITE, SITE_OWN, STATS_CHOICES, WEBSITE_HELP, beaconToken, counterCode, ownParts, updateSaid,
} from './websiteSetup.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const TAB = read('../tools/settings/WebsiteTab.svelte');
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

  it.each([['the tab', TAB, 14], ['the WordPress section', WORDPRESS, 4], ['the GitHub Pages section', GITHUB, 7],
    ['the GitHub setup press', GITHUB_PRESS, 2], ['the publish dialog', DIALOG, 8]])('titles every control of %s', (_, source, least) => {
    const markup = source.slice(source.indexOf('</script>'));
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

  it('holds the four ways, with no markup left over once cut', () => {
    expect(SITE_OWN.map(([lead]) => lead)).toEqual(['Your own home page', 'A page per category', 'Your own domain', 'Your own scripts']);
    const links = SITE_OWN.flatMap(([, text]) => ownParts(text)).filter((part) => part.link);
    expect(links).toEqual([{ link: 'GitHub\'s guide', href: 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site' }]);
    for (const [, text] of SITE_OWN) {
      for (const part of ownParts(text)) if (part.text) expect(part.text).not.toMatch(/[`[\]]/);
    }
  });
});
