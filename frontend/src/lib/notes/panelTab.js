/**
 * What the extension's panel shows of the tab in front (`panel.js`): its host, a
 * preview of the words selected, and whether the page is a map the extension can
 * capture. Whether it is a map is the app's to say, never the extension's: the
 * address goes to `GET /api/ingest/parse`, which knows the sites (`engine/mapsites.py`).
 * That route is the extension's own, behind the pairing token, which the app reads
 * from its settings. An answer is kept per address, so the menu asks once a page; a
 * question that could not be put is asked again.
 */
import { api } from '../api.js';

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

const known = new Map();
let token = null;

/** The pairing token the extension's routes ask for, read once. '' while none is minted. */
async function pairingToken() {
  if (token === null) token = (await api.get('/api/settings'))?.ingest_token ?? '';
  return token;
}

/**
 * The map site `url` is on (`google-maps`, `bing`…), or null: not a map, or the
 * question could not be answered. Asked once per address.
 */
export function mapSiteOf(url) {
  if (!known.has(url)) {
    known.set(url, (async () => {
      try {
        const pairing = await pairingToken();
        if (!pairing) {
          // no token minted yet: asked again once there is one
          token = null;
          known.delete(url);
          return null;
        }
        const answer = await api.get(`/api/ingest/parse?url=${encodeURIComponent(url)}`, { headers: { 'X-Azimut-Token': pairing } });
        return typeof answer?.site === 'string' && answer.site ? answer.site : null;
      } catch {
        // the question could not be put: it is asked again next time
        token = null;
        known.delete(url);
        return null;
      }
    })());
  }
  return known.get(url);
}

/** Forget what was learned, for tests. */
export function forgetMaps() {
  known.clear();
  token = null;
}
