/**
 * What Ctrl+V means on each surface.
 *
 * The clipboard is the one place an analyst already holds material Azimut has
 * never seen: a crop taken with the system screenshot tool exists nowhere on
 * disk, and an address copied out of a browser is one keystroke from a bookmark.
 * Dropping a file already works wherever it makes sense, so this covers the two
 * things that have no file to drop.
 *
 * No surface takes everything, and a paste that quietly does nothing is worse
 * than one that says why: `resolvePaste` answers with a form to fill or a refusal
 * to read, never with silence. The refusals live in the table below rather than in
 * four tools, because scattered copy becomes four vocabularies inside a week.
 */
import { api } from './api.js';

const IMAGE_TYPE = /^image\//i;
const HTTP_URL = /^https?:\/\/\S+$/i;

/** The API's own cap on a swallowed image (api/limits.py), said here so the
 *  refusal names the limit instead of waiting for a 413. */
export const MAX_PASTE_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * The http(s) address of the first `<img>` in a copied HTML fragment.
 *
 * An image copied out of a page carries the markup beside the pixels, and the
 * markup is where the image's own address is. Worth reading because a pasted
 * screenshot otherwise arrives with no origin at all.
 */
export function sourceFromHtml(html) {
  const match = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(html ?? '');
  const url = (match?.[1] ?? match?.[2] ?? '').trim();
  return HTTP_URL.test(url) ? url : '';
}

function imageFrom(clipboardData) {
  const items = [...(clipboardData.items ?? [])];
  for (const item of items) {
    if (item.kind === 'file' && IMAGE_TYPE.test(item.type ?? '')) {
      const file = item.getAsFile?.();
      if (file) return file;
    }
  }
  return [...(clipboardData.files ?? [])].find((file) => IMAGE_TYPE.test(file.type ?? '')) ?? null;
}

/**
 * What the clipboard is offering, or null when it holds nothing a case could take.
 *
 * An image wins over a link, because a screenshot copied from a browser carries
 * both — the pixels and the page they were on — and the pixels are the thing being
 * pasted. The address rides along as the image's source instead of competing with it.
 */
export function readPaste(clipboardData) {
  if (!clipboardData) return null;
  const text = (clipboardData.getData?.('text/plain') ?? '').trim();
  const file = imageFrom(clipboardData);
  if (file) {
    const fromMarkup = sourceFromHtml(clipboardData.getData?.('text/html') ?? '');
    return { kind: 'image', file, sourceUrl: fromMarkup || (HTTP_URL.test(text) ? text : '') };
  }
  if (HTTP_URL.test(text)) return { kind: 'url', url: text };
  if (text) return { kind: 'text', text };
  return null;
}

/**
 * What each surface takes, and what it says when it will not take something.
 *
 * `fields` is what the dialog asks for, in the order it asks. A folder is offered
 * only where filing is the surface's whole job: pasted into the drawing or the
 * table, a thing lands unfiled, exactly as a dropped file does there today.
 */
export const PASTE_RULES = {
  media: {
    image: { fields: ['title', 'source'] },
    url: { refuse: 'A link here is a download. Paste it in the URL field above the grid.' },
  },
  files: {
    image: { fields: ['title', 'folder', 'source'] },
    url: { fields: ['title', 'folder', 'notes'] },
  },
  graph: {
    image: { fields: ['title', 'source'] },
    url: { fields: ['title', 'notes'] },
  },
  board: {
    image: { fields: ['title', 'source'] },
    url: { fields: ['title', 'notes'] },
  },
};

/** Said wherever a surface takes neither: the clipboard held something, and this
 *  screen is not where it goes. */
const TEXT_REFUSAL = 'Only an image or a link can be pasted into a case. Text belongs in a note.';

const OVERSIZE_REFUSAL =
  `That image is over ${MAX_PASTE_IMAGE_BYTES / 1024 / 1024} MB. ` +
  'Save it to a file and drop it in instead.';

/** The hostname a pasted link is named after until the analyst types something
 *  better. The same default the extension's own bookmark route applies. */
export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function pasteDefaults(payload, folder) {
  return {
    title: payload.kind === 'url' ? hostOf(payload.url) : '',
    source: payload.kind === 'image' ? payload.sourceUrl ?? '' : '',
    folder: folder ?? '',
    notes: '',
  };
}

/**
 * Turn one clipboard reading into what the dialog should show on this surface.
 *
 * Returns null only when there is nothing to say at all — an empty clipboard, or a
 * surface that does not take pastes — so a caller can treat a resolution as "open
 * the dialog" without a second test.
 */
export function resolvePaste(tool, payload, { folder = '' } = {}) {
  const rules = PASTE_RULES[tool];
  if (!rules || !payload) return null;
  const rule = rules[payload.kind];
  if (!rule) return { mode: 'refuse', kind: payload.kind, reason: TEXT_REFUSAL };
  if (rule.refuse) return { mode: 'refuse', kind: payload.kind, reason: rule.refuse };
  if (payload.kind === 'image' && payload.file?.size > MAX_PASTE_IMAGE_BYTES) {
    return { mode: 'refuse', kind: payload.kind, reason: OVERSIZE_REFUSAL };
  }
  return {
    mode: 'form',
    kind: payload.kind,
    fields: [...rule.fields],
    payload,
    values: pasteDefaults(payload, folder),
  };
}

/** What is wrong with the dialog as filled in, or '' when nothing is. */
export function pasteProblem(resolved) {
  const values = resolved?.values ?? {};
  if (resolved?.kind === 'url' && !(values.title ?? '').trim()) return 'A bookmark needs a title.';
  const source = (values.source ?? '').trim();
  if (source && !HTTP_URL.test(source)) return 'The source must be an http(s) address.';
  return '';
}

/**
 * Listen for a paste on this surface, and hand over what it held.
 *
 * Returns the teardown, so a tool installs it inside an `$effect` gated on being
 * the tool on screen: every tab the analyst has opened stays mounted behind the
 * visible one (App.svelte), so a listener that did not check would have four
 * surfaces answering one Ctrl+V. A paste into a field is left alone — there,
 * Ctrl+V is the ordinary one.
 */
export function listenForPaste(handler) {
  const onPaste = (event) => {
    if (ignorePasteTarget(event.target)) return;
    const payload = readPaste(event.clipboardData);
    if (!payload) return;
    event.preventDefault();
    handler(payload);
  };
  window.addEventListener('paste', onPaste);
  return () => window.removeEventListener('paste', onPaste);
}

/** Whether this paste belongs to whatever the analyst is typing into. */
export function ignorePasteTarget(target) {
  const editable = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
  return Boolean(target?.closest?.(editable));
}

/**
 * File a pasted image as case media.
 *
 * Its own route rather than the upload one: a paste has no file behind it and no
 * origin the bytes can be read for, so the name comes from the dialog and the
 * source is whatever was typed beside it. Does not reload the case — the caller
 * refetches once, as every other import here does.
 */
export async function pasteImage(caseId, { file, title = '', sourceUrl = '' }) {
  const form = new FormData();
  form.append('file', file);
  if (title.trim()) form.append('title', title.trim());
  if (sourceUrl.trim()) form.append('source_url', sourceUrl.trim());
  return api.post(`/api/cases/${caseId}/media/paste`, form);
}
