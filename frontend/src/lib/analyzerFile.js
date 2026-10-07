/**
 * An analyzer as a file: what leaves this machine, and what arrives from another.
 *
 * Sharing an analyzer is the one thing a settings backup could already do and
 * shouldn't, since that backup carries the user's API keys. This file carries
 * the rules, and the checks when they are let through.
 */
import { api } from './api.js';

export function analyzerFileUrl(id, { checks = true } = {}) {
  return `/api/compare/analyzers/${encodeURIComponent(id)}/share${checks ? '' : '?checks=false'}`;
}

/** Download it the way a case bundle downloads: a link the browser follows. */
export function downloadAnalyzer(id, options) {
  const link = document.createElement('a');
  link.href = analyzerFileUrl(id, options);
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

export async function importAnalyzerFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('This file is not JSON. Use the Share button on an analyzer to make one.');
  }
  return api.post('/api/compare/analyzers/import', parsed);
}

/**
 * What the analyst has to know about an analyzer that just arrived, in a line
 * each. Nothing here stops it being used; it says where it may not behave like
 * it did on the machine that sent it.
 */
export function importNotes(result) {
  const notes = [];
  if (result?.renamed_from) {
    notes.push(`You already had an analyzer called “${result.renamed_from}”, so this one is “${result.analyzer.name}”.`);
  }
  const missing = result?.missing_layers ?? [];
  if (missing.length) {
    notes.push(`Its checks read ${missing.join(' and ')}, which this machine has no Copernicus layer for.`);
  }
  const ignored = result?.ignored_fields ?? [];
  if (ignored.length) {
    const by = result.written_by ? `Azimut ${result.written_by}` : 'a newer Azimut';
    notes.push(`Written by ${by}, so ${ignored.join(', ')} went unread here and the analyzer may find less.`);
  }
  return notes;
}
