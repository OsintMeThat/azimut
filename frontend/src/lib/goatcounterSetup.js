/**
 * A map page's view counter, said the same way wherever it is asked for: the analyst's own
 * GoatCounter site, free, with no cookie. Azimut keeps only the site's code in the map page's
 * look (`engine/notelook.py`, `counter`); the published web folder alone calls GoatCounter, once
 * read online (`notes_html_assets/reader.count.js`), and its line stays hidden when it does not answer.
 */

/** Where a GoatCounter site is made. */
export const GOATCOUNTER_SIGNUP = 'https://www.goatcounter.com/signup';

/** The three steps, each with what to do and where GoatCounter shows it. */
export const COUNTER_STEPS = Object.freeze([
  ['Sign up', 'Make a free account at goatcounter.com. The code you pick is the first part of your site’s address: mycode in mycode.goatcounter.com.'],
  ['Allow the count', 'In GoatCounter, open Settings, tick Allow adding visitor counts on your website, and save.'],
  ['Paste the code', 'Type the code here, or paste the site’s address. Export or publish the web map again.'],
]);

/** What it costs and what it does, in one line. */
export const COUNTER_SAID = 'Free and optional. The published page shows “N views” under its title, counted on your GoatCounter site with no cookie; Azimut itself never calls it.';

/** A code as GoatCounter allows one: lower case letters, digits and hyphens, not at an end. */
const CODE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/**
 * The code a typed answer names: the code itself, or a site's address (`https://mycode.goatcounter.com/…`);
 * "" for nothing typed, null for something that names no site.
 */
export function counterCode(text) {
  let value = String(text ?? '').trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.goatcounter\.com\.?$/, '');
  return CODE.test(value) ? value : null;
}
