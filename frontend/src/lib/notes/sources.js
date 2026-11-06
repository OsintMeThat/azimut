/**
 * Citing a web source in a note, and stating where a picture comes from.
 *
 * A link is looked up in the case first (`/sources/lookup`, read off the address and
 * the case, nothing fetched): when the case already filed it, the note cites that
 * item, so one page is never filed twice. Otherwise it can be kept as a bookmark,
 * named from its address and still nothing fetched, or downloaded, which is the one
 * press here that reaches the network.
 *
 * A picture brought in by hand (an import, a paste) has no origin the bytes can say:
 * its bar offers Source… and the address typed there is kept as stated, never
 * fetched, as Details keeps one.
 */
import { api } from '../api.js';
import { createBookmark } from '../bookmarks.js';
import { entityReference } from '../markdown.js';
import { reloadCase } from '../state.svelte.js';
import { canStateSource, sourceProblem } from '../statedSource.js';
import { pastedUrl } from './syntax.js';

/** How often a download is asked how it is going. */
export const DOWNLOAD_POLL_MS = 700;

/**
 * What the case says of a web address: `{ url, title, found: [entity] }`. `title` is
 * the one the page gave itself, when a browser passed it on: it names the page when
 * the address says nothing better.
 */
export function lookupSource(caseId, url, { get = api.get, title = '' } = {}) {
  return get(`/api/cases/${caseId}/sources/lookup?${new URLSearchParams(title ? { url, title } : { url })}`);
}

/** An address typed or pasted, as one the lookup reads, or null. */
export function sourceAddress(text) {
  return pastedUrl(text);
}

/** A case item, cited where the note's cursor is. */
export function citeOffer(entity) {
  return {
    id: 'cite',
    label: `Cite “${entity.label}”`,
    hint: 'Already in the case',
    icon: 'at',
    put: async () => ({ text: entityReference(entity), inline: true }),
  };
}

/** A page kept as a bookmark named from its address, then cited: nothing is fetched. */
export function bookmarkOffer(caseId, { url, title }, { make = createBookmark, reload = reloadCase } = {}) {
  return {
    id: 'bookmark',
    label: 'Bookmark',
    hint: 'Keep the link in the case. Nothing is fetched',
    icon: 'bookmark',
    put: async () => {
      const entity = await make(caseId, { title: title || url, url });
      await reload();
      return { text: entityReference(entity), inline: true, filed: [entity.id] };
    },
  };
}

/** The download's own answer, as what the note cites or why it cannot. */
function downloaded(result) {
  if (result?.multi) throw new Error('This post holds several files. Download it from Media to pick them');
  if (result?.needs_auth) throw new Error('This post needs a login. Download it from Media to sign in');
  if (result?.telegram_only) throw new Error('This link needs the Telegram setup. Download it from Media');
  if (!result?.entity?.id) throw new Error('The download filed nothing');
  return result;
}

/**
 * The post downloaded into the case by the downloader Media uses, then cited. The
 * one offer here that reaches the network, and only on its press. A file the case
 * already held is cited and not filed again.
 */
export function downloadOffer(caseId, url, { post = api.post, get = api.get, reload = reloadCase, wait = DOWNLOAD_POLL_MS } = {}) {
  return {
    id: 'download',
    label: 'Download',
    hint: 'Download the post into the case, with its hash and date',
    icon: 'download',
    busy: 'Downloading the post…',
    put: async ({ signal } = {}) => {
      const { job_id: job } = await post(`/api/cases/${caseId}/media/download`, { url, index: null, title: null, use_cookies: false });
      for (;;) {
        if (signal?.aborted) {
          const stop = new Error('Cancelled. The download goes on, and lands in Media');
          stop.name = 'AbortError';
          throw stop;
        }
        const status = await get(`/api/jobs/${job}`);
        if (status.status === 'done') {
          const result = downloaded(status.result);
          await reload();
          return { text: entityReference(result.entity), inline: true, filed: result.duplicate ? [] : [result.entity.id] };
        }
        if (status.status !== 'running' && status.status !== 'queued') throw new Error(`Download failed: ${status.error || 'no answer'}`);
        await new Promise((done) => setTimeout(done, wait));
      }
    },
  };
}

// -- a post, quoted -------------------------------------------------------------

/** The longest quote put in a note: past it the words are cut, and the cut says so. */
export const QUOTE_MAX = 1000;

/** The account a post's address names (`@port_watch`), read where the site writes it. */
function handleIn(url) {
  let parts;
  try {
    parts = new URL(url);
  } catch {
    return '';
  }
  const host = parts.hostname.replace(/^(www|mobile|m)\./, '');
  const segs = parts.pathname.split('/').filter(Boolean);
  if ((host === 'x.com' || host === 'twitter.com') && segs[1] === 'status' && segs[0] !== 'i') return `@${segs[0]}`;
  if (host === 't.me' || host === 'telegram.me') {
    const rest = segs[0] === 's' ? segs.slice(1) : segs;
    return rest.length >= 2 && /^\d+$/.test(rest[1]) && rest[0] !== 'c' ? `@${rest[0]}` : '';
  }
  if ((host === 'tiktok.com' || host === 'youtube.com' || host.startsWith('threads.')) && segs[0]?.startsWith('@')) return segs[0];
  if (host === 'instagram.com' && ['p', 'reel'].includes(segs[1])) return `@${segs[0]}`;
  if (host === 'bsky.app' && segs[0] === 'profile' && segs[2] === 'post') return `@${segs[1]}`;
  return '';
}

/** `20260312` as `12 Mar 2026`, the day a post went up. */
function postDay(value) {
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? '').replace(/-/g, ''));
  if (!day) return '';
  const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Words as they were posted, written so the note shows them as they read and not as
 * Markdown. An underscore is left: inside a word, as handles and tags have it, it is
 * never read as a mark.
 */
export function asPosted(text) {
  return String(text)
    .replace(/[\\`*[\]<]/g, (mark) => `\\${mark}`)
    .replace(/^(\s*)([#>+|-])/gm, '$1\\$2');
}

/**
 * A downloaded post's own words as a quote, with who posted it and when, then the
 * file it came with: `> "Smoke over the port" (@port_watch, 12 Mar 2026) [[entity:…]]`.
 * Read from what the download recorded; '' when it recorded no words.
 */
export function quotePost(item, entity) {
  const source = item?.source ?? {};
  const words = String(source.description ?? '').replace(/\r\n?/g, '\n').trim();
  if (source.type !== 'download' || !words || !entity?.id) return '';
  const long = words.length > QUOTE_MAX;
  const kept = asPosted(long ? words.slice(0, QUOTE_MAX).replace(/\s+\S*$/, '') : words);
  const lines = `${kept}${long ? ' […]' : ''}`.split('\n').map((line) => line.trimEnd());
  const who = handleIn(source.webpage_url || source.url) || String(source.uploader ?? '').trim();
  const said = [who, postDay(source.upload_date)].filter(Boolean).join(', ');
  lines[0] = `"${lines[0]}`;
  lines[lines.length - 1] = `${lines[lines.length - 1]}"${said ? ` (${said})` : ''} ${entityReference(entity)}`;
  return lines.map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/** Quote the post a downloaded file came from, in the pinned note. */
export function quoteOffer(item, entity) {
  const text = quotePost(item, entity);
  if (!text) return null;
  return {
    id: 'quote',
    label: 'Quote the post',
    hint: 'Its words as posted, who posted them and when',
    icon: 'quote',
    put: async () => ({ text }),
  };
}

// -- a picture's stated source -------------------------------------------------

const asked = new Map();
let waiting = null;

/**
 * Whether the analyst may state where this picture comes from: a file brought in by
 * hand, with no address yet. Read off the media index, one request for every picture
 * the note draws at once, and kept for the visit: a source stated since is on the
 * record itself, which is read first.
 */
export function canStateSourceOf(caseId, entity, { post = api.post } = {}) {
  const path = entity?.attrs?.path;
  if (!caseId || !path || entity.type !== 'media' || entity.attrs?.source_url) return Promise.resolve(false);
  if ((entity.attrs?.kind ?? 'image') !== 'image') return Promise.resolve(false);
  const key = `${caseId}:${path}`;
  if (asked.has(key)) return asked.get(key);
  if (!waiting || waiting.caseId !== caseId) {
    const batch = { caseId, paths: new Map() };
    waiting = batch;
    queueMicrotask(async () => {
      if (waiting === batch) waiting = null;
      let rows = [];
      try {
        rows = await post(`/api/cases/${caseId}/media/metadata`, { paths: [...batch.paths.keys()] });
      } catch {
        rows = [];
      }
      const byPath = new Map((rows ?? []).map((row) => [row.path, row]));
      for (const [one, answer] of batch.paths) {
        const row = byPath.get(one);
        answer(Boolean(row && !row.source?.url && canStateSource(row)));
      }
    });
  }
  const promise = new Promise((answer) => waiting.paths.set(path, answer));
  asked.set(key, promise);
  return promise;
}

/** Forget what was read about pictures' sources. */
export function forgetSourceable() {
  asked.clear();
}

/** State `url` as where this picture comes from; refused with what is wrong. */
export async function stateSourceOf(caseId, entity, url, { patch = api.patch, reload = reloadCase } = {}) {
  const problem = sourceProblem(url);
  if (problem) throw new Error(problem);
  await patch(`/api/cases/${caseId}/media`, { path: entity.attrs.path, source_url: url.trim() });
  asked.delete(`${caseId}:${entity.attrs.path}`);
  await reload();
}

/**
 * Where the analyst published proof `entity`, kept on the proof (`posted_url`, a
 * field its Details shows too): a report links the proof there. "" takes it off.
 */
export async function statePostedOf(caseId, entity, url, { patch = api.patch, reload = reloadCase } = {}) {
  const value = String(url ?? '').trim();
  if (value && !/^https?:\/\/\S+$/i.test(value)) throw new Error('The address must be an http(s) one.');
  await patch(`/api/cases/${caseId}/entities/${entity.id}`, { attrs: { posted_url: value } });
  await reload();
}
