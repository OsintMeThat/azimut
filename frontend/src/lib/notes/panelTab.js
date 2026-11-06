/**
 * What the extension's panel shows of the tab in front (`panel.js`): its host and a
 * preview of the words selected. Whether the page is a map comes with the tab, from
 * the extension, which asks the app's own list of map sites (`engine/mapsites.py`)
 * with its pairing.
 */

/** The host a page is on, without `www.`, or '' for an address that is none. */
export function tabHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The words selected, on one line and short: `“Berths 10 to 14 were closed…”`. */
export function quotePreview(text, most = 60) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!words) return '';
  const cut = words.length > most ? `${words.slice(0, most).replace(/\s+\S*$/, '')}…` : words;
  return `“${cut}”`;
}
