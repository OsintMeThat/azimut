/**
 * The window's chronology as text, for a report, a ticket or a spreadsheet.
 *
 * The axis is read with the eyes and the list with the pointer; neither goes into a
 * message. This turns the same entries into the two things that do: a Markdown table
 * for the Notebook or a ticket, and the tab-separated block a spreadsheet reads back as
 * columns. Both writers are the Sheet's own (`toMarkdown`, `toBlock`), so a pipe or a
 * newline in a statement is escaped the one way the app already escapes it.
 *
 * What is copied is the window, not the page on screen: every page of every track,
 * without the axis's spread sampling, up to the ceiling a snapshot already holds.
 */

import { toMarkdown } from './sheetExport.js';
import { toBlock } from './sheetClipboard.js';
import { formatTemporalValue } from './timeline.js';
import { timelineTrackQuery } from './timelineTracks.js';

/** The most entries one copy carries, the same as a Timeline snapshot. */
export const COPY_LIMIT = 5000;

/** The spreadsheet columns, named for a reader who never saw the app. */
export const CHRONOLOGY_COLUMNS = [
  'date_as_written', 'time_zone', 'earliest_utc', 'latest_utc', 'statement',
  'subjects', 'places', 'sources', 'confidence', 'status',
];

const names = (entries) => (entries ?? []).map((entry) => entry.label || entry.id).join('; ');

/** The dated entries, once each, in the order they happened. */
export function chronologyRows(items = []) {
  const unique = new Map();
  for (const item of items) if (item?.earliest && !unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()]
    .sort((a, b) => String(a.earliest).localeCompare(String(b.earliest))
      || String(a.id).localeCompare(String(b.id)))
    .map((item) => ({
      id: item.id,
      raw: item.raw ?? '',
      // The zone the date was stated in: without it a day written as the 12th
      // cannot be told from UTC's 12th by someone reading the sheet alone.
      zone: item.tz ?? '',
      reading: formatTemporalValue(item.raw ?? '', item.tz, item.time_role).label,
      earliest: item.earliest ?? '',
      latest: item.latest ?? '',
      statement: item.label ?? '',
      subjects: names(item.subject_entities),
      places: names(item.place_entities),
      sources: names(item.source_entities),
      confidence: item.confidence ?? '',
      status: item.status ?? '',
    }));
}

/** A block to paste into a spreadsheet: a header row, then one row per entry. */
export function chronologyBlock(rows) {
  return toBlock([
    CHRONOLOGY_COLUMNS,
    ...rows.map((row) => [
      row.raw, row.zone, row.earliest, row.latest, row.statement,
      row.subjects, row.places, row.sources, row.confidence, row.status,
    ]),
  ]);
}

/** A Markdown table, with the lines that say where it came from quoted above it. */
export function chronologyMarkdown(rows, said = []) {
  return toMarkdown({
    columns: ['Date', 'Statement', 'Subjects', 'Places', 'Sources', 'Confidence'],
    rows: rows.map((row) => [
      row.reading, row.statement, row.subjects, row.places, row.sources, row.confidence,
    ]),
  }, said);
}

/**
 * Every dated entry the tracks hold in the window, page after page.
 *
 * `get` is the API's own reader, handed in so this stays testable without a server.
 * Answers the entries and whether the ceiling cut them.
 */
export async function readChronology(get, { caseId, tracks = [], from, to, entityId, limit = COPY_LIMIT }) {
  const seen = new Map();
  for (const track of tracks) {
    let cursor = null;
    do {
      const params = new URLSearchParams({ include_undated: 'false', limit: '200' });
      for (const category of track.categories) params.append('category', category);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (entityId) params.set('entity', entityId);
      if (cursor) params.set('cursor', cursor);
      params.set('track', timelineTrackQuery(track));
      const page = await get(`/api/cases/${caseId}/timeline?${params}`);
      for (const item of page?.items ?? []) {
        if (seen.has(item.id)) continue;
        if (seen.size >= limit) return { items: [...seen.values()], truncated: true };
        seen.set(item.id, item);
      }
      cursor = page?.next_cursor ?? null;
    } while (cursor);
  }
  return { items: [...seen.values()], truncated: false };
}
