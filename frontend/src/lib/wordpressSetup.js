/**
 * How to connect a WordPress site, said the same way wherever it is needed.
 *
 * Settings › Website is where the three answers are typed in, and the Notebook's
 * export dialog shows the same steps while they are missing, so both read them here.
 * The address and the username are settings; the application password is kept apart,
 * on this machine only (`engine/publishsecrets.py`), and never read back.
 */

/** WordPress's own guide to application passwords, core since 5.6. */
export const WORDPRESS_GUIDE = 'https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/';

/** The three fields, each with what to type and where WordPress shows it. */
export const WORDPRESS_FIELDS = Object.freeze([
  ['Site address', 'Your site as readers type it, such as https://example.org. A site on this computer can be http://localhost.'],
  ['Username', 'The name you sign in to WordPress with, not the name your posts show.'],
  ['Application password', 'In WordPress, open Users › Profile and scroll to Application Passwords. Name it Azimut, press Add Application Password, and copy the password it shows once.'],
]);

/** What it costs and what it can do: free, built in, and a draft only. */
export const WORDPRESS_FREE = 'Free: application passwords are built into WordPress since version 5.6, no plugin needed. Azimut only makes drafts; you publish them in WordPress.';

/** Where it does not work, said plainly rather than half-supported. */
export const WORDPRESS_COM = 'WordPress.com sites need an OAuth app instead, which Azimut does not have. A self-hosted WordPress works.';

/** Where WordPress shows the password field, for the field's own hint. */
export const PASSWORD_WHERE = 'Users › Profile › Application Passwords';

/** Whether a site is set up enough to send to: an address, a username and a password kept. */
export function wordpressReady(state) {
  return Boolean(state?.site && state?.user && state?.password?.set);
}

/** `example.org`, or the address as written when it does not read as one. */
export function siteHost(site) {
  try {
    const url = new URL(site);
    return url.pathname && url.pathname !== '/' ? `${url.host}${url.pathname.replace(/\/$/, '')}` : url.host;
  } catch {
    return String(site ?? '');
  }
}

/** An address the server handed back, kept only when it is http or https. */
export function webLink(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}
