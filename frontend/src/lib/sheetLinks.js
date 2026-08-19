/**
 * Whether a column of sources still answers.
 *
 * Most of a worklist is links: the post a claim rests on, the channel it came from, the
 * archive copy somebody made. They rot, and nothing in the grid said which ones already
 * had — so a finding could be published on a source that had been gone for a month, and
 * the only way to know was to open four hundred tabs.
 *
 * Distinct addresses rather than rows, because eleven rows sourced to one channel hold one
 * address eleven times, and asking that host eleven times would be the rudest way to learn
 * one fact. The answers come back per address and are spread over the rows holding it.
 *
 * The request is the only part of a sheet that leaves the machine, and it goes on a press:
 * `engine/sheetlinks.py` is where the verdict is made and what the five states mean.
 */

import { api } from './api.js';
import { urlsIn } from './sheet.js';

/** How many addresses travel in one request. Mirrors `engine/sheetlinks.MAX_LINKS`: the
 *  column is walked in chunks so the pass can show progress and be stopped half way. */
export const CHUNK = 25;

/**
 * The distinct addresses one column holds, each with the rows holding it.
 *
 * Read over the rows given — the ones on screen — for the same reason the cleaning passes
 * and the number footers are: a filter narrowed to the twelve rows left to check is the
 * question being asked, and checking all four hundred answers a different one.
 */
export function urlsInColumn(table, columnIndex, rows) {
  const found = new Map();
  for (const index of rows ?? []) {
    const row = table?.rows?.[index];
    if (!row) continue;
    for (const url of urlsIn(row[columnIndex])) {
      if (!found.has(url)) found.set(url, { url, rows: [] });
      const entry = found.get(url);
      if (entry.rows.at(-1) !== index) entry.rows.push(index);
    }
  }
  return [...found.values()];
}

/** A list cut into the batches the route takes. */
export function chunk(list, size = CHUNK) {
  const out = [];
  for (let at = 0; at < (list?.length ?? 0); at += size) out.push(list.slice(at, at + size));
  return out;
}

/** Ask about one batch. The answer is keyed by address, exactly as it was sent. */
export async function checkLinks(caseId, sheetId, urls) {
  const answer = await api.post(`/api/cases/${caseId}/sheets/${sheetId}/links/check`, { urls });
  return answer.links ?? {};
}

/** The states worth acting on, in the order a reading lists them. `refused` is deliberately
 *  not among them: a 403 behind a login says nothing about whether the page is there. */
const BAD = ['gone', 'unreachable'];

/**
 * What a sweep found, as the reading the grid draws: how many answered, which addresses
 * did not, and the rows holding them.
 *
 * Rows rather than a bare count, because the answer has to land in the table — the point of
 * knowing eleven sources are dead is painting those eleven rows.
 */
export function readVerdicts(entries, verdicts) {
  const bad = [];
  let ok = 0;
  let refused = 0;
  let skipped = 0;
  for (const entry of entries ?? []) {
    const verdict = verdicts?.[entry.url];
    if (!verdict) continue;
    if (verdict.state === 'ok') ok += 1;
    else if (verdict.state === 'refused') refused += 1;
    // Counted rather than folded into the bad ones: the batch ran out of its budget and
    // never asked, which says nothing about the page. A sweep that quietly reported them
    // as answered would be the worst of the five states.
    else if (verdict.state === 'skipped') skipped += 1;
    if (BAD.includes(verdict.state)) {
      bad.push({ url: entry.url, rows: entry.rows, state: verdict.state, code: verdict.code ?? null });
    }
  }
  return {
    ok,
    refused,
    skipped,
    bad: bad.sort((a, b) => b.rows.length - a.rows.length),
    rows: [...new Set(bad.flatMap((entry) => entry.rows))],
  };
}
