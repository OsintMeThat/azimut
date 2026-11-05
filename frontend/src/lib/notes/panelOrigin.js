/**
 * Who may send a note in the extension's panel something to put in it: the page
 * of a browser extension that frames it, and nothing else. A web page cannot frame
 * the app at all (the server's `frame-ancestors`), and a message from one is dropped.
 *
 * Kept free of imports so a build of it alone shows what ships
 * (`panelOrigin.build.test.js`).
 */

/** The schemes a browser serves an extension's own pages from. */
export const EXTENSION_SCHEMES = ['chrome-extension://', 'moz-extension://', 'safari-web-extension://'];

/** Whether `origin` is an extension's page: its scheme, then an id. */
export function fromExtension(origin) {
  return typeof origin === 'string' && EXTENSION_SCHEMES.some((scheme) => origin.startsWith(scheme) && origin.length > scheme.length);
}

/**
 * Whether a message from `origin` may put something in the panel's note.
 *
 * The browser test cannot be an extension, so it frames the panel from a stand-in
 * page of the app's own origin and says so in the address (`testParent=1`). That
 * allowance exists only while the code runs under test: a build replaces
 * `import.meta.env.MODE` with `production` and drops the branch.
 */
export function acceptsOrigin(origin, place = globalThis.location) {
  if (fromExtension(origin)) return true;
  if (import.meta.env.MODE === 'test') {
    return Boolean(place?.origin) && origin === place.origin && /[?&]testParent=1(?:&|$)/.test(String(place.hash ?? ''));
  }
  return false;
}
