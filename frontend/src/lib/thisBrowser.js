/**
 * Which browser is showing this page.
 *
 * The app is a local server and a browser tab, so the tab *is* the analyst's browser —
 * and the session Azimut is being asked to read is almost always the one they are looking
 * at it in. Defaulting the cookie prompt to Firefox meant a Chrome user answered a
 * question whose answer was on screen the whole time.
 *
 * Read off the user agent, which is a guess and is treated as one: it fills a select the
 * analyst can change, never a setting written behind them. The order matters — every
 * Chromium browser claims to be Chrome, and most claim to be Safari too — so the
 * particular ones are tested before the general.
 */
const SIGNATURES = [
  [/\bEdg[A-Z]?\//, 'edge'],
  [/\bOPR\/|\bOpera\//, 'opera'],
  [/\bVivaldi\//, 'vivaldi'],
  [/\bBrave\//, 'brave'],
  [/\bFirefox\/|\bFxiOS\//, 'firefox'],
  [/\bChromium\//, 'chromium'],
  [/\bChrome\/|\bCriOS\//, 'chrome'],
  [/\bSafari\//, 'safari'],
];

/** The browser this page is in, or `fallback` when nothing in the agent says.
 *
 *  Brave hides itself from the agent on purpose and answers `navigator.brave` instead, so
 *  it is asked directly — a Brave user offered "chrome" is offered a cookie store that
 *  does not exist on their machine. */
export function thisBrowser(fallback = 'firefox', agent = null, nav = null) {
  const runtime = nav ?? (typeof navigator === 'undefined' ? null : navigator);
  if (runtime?.brave) return 'brave';
  const said = agent ?? runtime?.userAgent ?? '';
  return SIGNATURES.find(([pattern]) => pattern.test(said))?.[1] ?? fallback;
}
