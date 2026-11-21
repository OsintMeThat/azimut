/**
 * The site's numbers, read from Cloudflare Web Analytics on a press (`api/publishing.py`,
 * `engine/sitestats.py`), and the API token that reads them.
 *
 * `runNumbers` is the Read the numbers press and the only way out: nothing here runs on mount, and
 * the answer is kept for the session, never on disk. `key` is the account and site tag it was read
 * with, so a read of another site is dropped (`forgetNumbers`) rather than shown under it. Saving
 * and forgetting the token stay on this computer; the token goes up once, when typed, and never
 * comes back: the server answers whether one is kept and its last four characters.
 */
import { api } from './api.js';
import { numbersOf } from './websiteHub.js';

export const siteNumbers = $state({
  /** The numbers, `null` until the press: see `numbersOf` for their shape. */
  data: null,
  /** When they were read, on this computer's clock. */
  at: null,
  busy: false,
  /** What went wrong, in the server's words. */
  error: '',
  /** The account and site tag they were read with, `account/tag`. */
  key: '',
});

/** Read the numbers once; a second press while one is running does nothing. */
export async function runNumbers(key = '') {
  if (siteNumbers.busy) return false;
  siteNumbers.busy = true;
  siteNumbers.error = '';
  try {
    const answer = await api.post('/api/publishing/cloudflare/numbers');
    siteNumbers.data = numbersOf(answer);
    siteNumbers.at = new Date();
    siteNumbers.key = key;
    return true;
  } catch (error) {
    siteNumbers.error = error.message;
    return false;
  } finally {
    siteNumbers.busy = false;
  }
}

/** Forget what was read: the account or the site tag changed. */
export function forgetNumbers() {
  siteNumbers.data = null;
  siteNumbers.at = null;
  siteNumbers.error = '';
  siteNumbers.key = '';
}

/** Whether an API token is kept, and its last characters: `{ token: { set, hint } }`. */
export function cloudflareState(state) {
  return { token: { set: Boolean(state?.token?.set), hint: String(state?.token?.hint ?? '') } };
}

/** The token as this computer keeps it, read from this computer only. */
export async function readCloudflare() {
  const answer = await api.get('/api/publishing');
  return cloudflareState(answer?.cloudflare);
}

/** Keep a new API token on this computer. */
export async function saveCloudflareToken(token) {
  return cloudflareState(await api.put('/api/publishing/cloudflare', { token }));
}

/** Forget the API token on this computer. */
export async function forgetCloudflareToken() {
  return cloudflareState(await api.del('/api/publishing/cloudflare'));
}
