/**
 * What the note asks the server of a post from X or Bluesky (`api/socialposts.py`): a
 * block drawn as every document draws it (`describePost`), what `/post` offers beside a
 * paste (`postOffers`), a post kept from what the case holds (`postFromCase`), and the
 * read of pasted links (`readPosts`), **the one call here that reaches the network**,
 * only ever on a press.
 *
 * A read is one job polled to its end. While it runs, and after it failed, each link's
 * state is kept here (`postReading`), so every block holding that link draws it, in any
 * editor showing the note, until a read keeps it.
 */
import { api } from '../api.js';

/** How often a read's job is asked how it goes, in ms. */
export const POLL_MS = 600;
/** How many drawings are kept, the oldest going first, and for how long, in ms. */
const KEPT = 60;
const KEPT_MS = 60_000;

const drawings = new Map();

/** A block as every document draws it, kept a minute by its words, the case and what the case says of its posts. */
export async function describePost({ caseId, text, key = '' }, { post = api.post, now = Date.now } = {}) {
  const id = `${caseId}\n${key}\n${text}`;
  const held = drawings.get(id);
  if (held && now() - held.at < KEPT_MS) return held.answer;
  const answer = await post(`/api/cases/${caseId}/social-posts/describe`, { text });
  drawings.delete(id);
  drawings.set(id, { at: now(), answer });
  while (drawings.size > KEPT) drawings.delete(drawings.keys().next().value);
  return answer;
}

/** Forget the drawings, after the case changed under them (a post read again, a proof saved). */
export function forgetPostDrawings() {
  drawings.clear();
}

/** What `/post` offers beside a paste: the posts kept, the files downloaded from a post, the analyst's own published posts. */
export function postOffers(caseId, { get = api.get } = {}) {
  return get(`/api/cases/${caseId}/social-posts/offers`);
}

/** Keep a post from what the case holds, with no network: `{ media }` or `{ draft }`. Answers `{ id, label }`. */
export function postFromCase(caseId, from, { post = api.post } = {}) {
  return post(`/api/cases/${caseId}/social-posts/from-case`, from);
}

// -- reading links ----------------------------------------------------------------------

/** Each link's read, by its address: `{ state: 'busy' }` or `{ state: 'failed', error, needsAuth, refused }`. */
const reading = new Map();
const listeners = new Set();

function said() {
  for (const listener of [...listeners]) listener();
}

/** The read of one link, or null when none runs and none failed. */
export function postReading(link) {
  return reading.get(link) ?? null;
}

/** Be told when a read starts or ends; answers how to stop being told. */
export function onPostReading(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read these links and keep their posts, on the analyst's press. Answers each link's
 * result once the job ends (`{ link, id }` or `{ link, error, needs_auth }`), the links
 * that failed left marked for their blocks to say why and offer Try again.
 */
export async function readPosts({ caseId, links }, { post = api.post, get = api.get, wait = POLL_MS } = {}) {
  const asked = [...new Set((links ?? []).filter(Boolean))];
  if (!caseId || !asked.length) return [];
  for (const link of asked) reading.set(link, { state: 'busy' });
  said();
  let results;
  try {
    const { job_id: job } = await post(`/api/cases/${caseId}/social-posts/fetch`, { links: asked });
    for (;;) {
      const status = await get(`/api/jobs/${job}`);
      if (status.status === 'done') {
        results = status.result?.results ?? [];
        break;
      }
      if (status.status !== 'running') throw new Error(status.error || 'The read stopped');
      await new Promise((done) => setTimeout(done, wait));
    }
  } catch (error) {
    results = asked.map((link) => ({ link, error: error?.message || 'The post could not be read' }));
  }
  for (const result of results) {
    if (result.id) reading.delete(result.link);
    else reading.set(result.link, { state: 'failed', error: result.error || 'The post could not be read',
      needsAuth: Boolean(result.needs_auth), refused: Boolean(result.refused) });
  }
  for (const link of asked) if (reading.get(link)?.state === 'busy') reading.delete(link);
  forgetPostDrawings();
  said();
  return results;
}

/**
 * Store a browser's session as the downloads' own source (Settings keeps one for every
 * download), then read again: what a wall on X asks for.
 */
export async function readSignedIn({ caseId, links, browser }, { put = api.put, read = readPosts } = {}) {
  await put('/api/settings/prefs', { download_cookies: { source: 'browser', browser } });
  return read({ caseId, links });
}
