/**
 * Creating a bookmark entity. A bookmark is just an entity of type `bookmark`
 * whose target lives in `attrs.url`; `attrs.folder` files it into a My-work
 * folder (''=unfiled) and `attrs.notes` holds a one-line context. The mirror of
 * notes.js — the extension files the same shape over /api/ingest/bookmark when
 * the open page isn't a map site.
 *
 * Does not reload the case: the caller refetches once it returns. Returns the
 * entity, which is what lets the drawing put the new bookmark where it was pasted
 * and the table open it — a caller that only needed it filed ignores the value.
 */
import { api } from './api.js';

export async function createBookmark(caseId, { title, url, folder = '', notes = '', author = '', published = '' }) {
  const label = (title ?? '').trim();
  const target = (url ?? '').trim();
  if (!label) throw new Error('Title required');
  if (!/^https?:\/\//i.test(target)) throw new Error('Enter an http(s) URL');
  return api.post(`/api/cases/${caseId}/entities`, {
    type: 'bookmark',
    label,
    attrs: { url: target, notes: (notes ?? '').trim(), folder: (folder ?? '').trim(), ...whoAndWhen({ author, published }) },
  });
}

/** Who put a bookmarked page up and when, as the bookmark's Author and Published keep them: only what was said. */
export function whoAndWhen({ author = '', published = '' } = {}) {
  const said = {};
  if (String(author ?? '').trim()) said.author = String(author).trim();
  if (String(published ?? '').trim()) said.published_at = String(published).trim();
  return said;
}

/** Write who put a bookmarked page up and when on its bookmark. */
export function describeBookmark(caseId, id, facts) {
  return api.patch(`/api/cases/${caseId}/entities/${id}`, { attrs: whoAndWhen(facts) });
}
