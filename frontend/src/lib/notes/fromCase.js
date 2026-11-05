/**
 * The note *From the case* writes: every geolocation of a period, a figure each or
 * a table, under the parts a geolocation report needs.
 *
 * The server says which geolocations a period holds and how each is dated
 * (`GET /notes/from-case`, `engine/notefromcase.py`); this writes them as the
 * Markdown the editor and the PDF already read. Everything named is a case
 * reference (`[[media:…]]` for a picture, `[[entity:…]]` for a place or a file), so
 * the list of sources and the imagery credits work on it as on any note. The
 * guidance lines (`<!--? … -->`) say what the analyst writes, and never print.
 */
import { api } from '../api.js';
import { entityReference, mediaReference } from '../markdown.js';
import { chipsCell, cutLine, toMarkdown } from '../sheetExport.js';
import { zonedFields } from '../timeline.js';
import { hintLine } from './look.js';
import { writeAttrs } from './pictureSize.js';
import { pointText } from './syntax.js';

/** The most geolocations one note holds, as the server caps them. */
export const FROM_CASE_LIMIT = 200;

/** How a note made from the case prints: a report, ending on its sources. */
export const FROM_CASE_LOOK = Object.freeze({ style: 'report', sources: 'on' });

/** The two readings of a period, and the two layouts. */
export const READINGS = [
  { id: 'shown', label: 'What they show', title: 'The day a proof gives, else the camera, post or imagery day' },
  { id: 'geolocated', label: 'When they were geolocated', title: 'The day the place was stated in the case' },
];
export const LAYOUTS = [
  { id: 'figures', label: 'A figure each', title: 'A picture, where, when and the source for each' },
  { id: 'table', label: 'A table', title: 'One row each: day, place, coordinates and source' },
];

/** A proof is a composite of panels side by side: wide on the page. A file keeps the
 *  default, within half the page, so a phone picture is not a page tall. */
const PROOF_WIDTH = '75%';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];
const pad = (value) => String(value).padStart(2, '0');
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?([~?%])?$/;
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/;

/** The geolocations of a period, as the server reads them. */
export function readFromCase(caseId, { from = '', to = '', by = 'shown', zone = 'UTC' } = {}, { signal } = {}) {
  const query = new URLSearchParams({ by, zone });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  return api.get(`/api/cases/${caseId}/notes/from-case?${query}`, { signal });
}

function parts(day) {
  const match = DAY.exec(String(day ?? ''));
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

/** `12 March 2026`. */
export function dayWords(day) {
  const at = parts(day);
  return at ? `${at.day} ${MONTHS[at.month - 1]} ${at.year}` : '';
}

/** A run of days in words: `1–14 March 2026`, `28 February – 3 March 2026`, `12 March 2026`. */
export function spanWords(first, last) {
  const a = parts(first);
  const b = parts(last);
  if (!a || !b) return dayWords(first) || dayWords(last);
  if (first === last) return dayWords(first);
  if (a.year !== b.year) return `${dayWords(first)} – ${dayWords(last)}`;
  if (a.month !== b.month) return `${a.day} ${MONTHS[a.month - 1]} – ${dayWords(last)}`;
  return `${a.day}–${b.day} ${MONTHS[a.month - 1]} ${a.year}`;
}

/** The note's name: the period in words, and what it was read by. */
export function periodTitle(from, to, by = 'shown') {
  const span = spanWords(from, to);
  if (by === 'geolocated') return span ? `Geolocated ${span}` : 'Geolocated';
  return span ? `Geolocations, ${span}` : 'Geolocations';
}

/** One stated date in words: a day, a month or a year, with its qualifier. */
function dateWords(raw) {
  const match = DATE.exec(raw);
  if (!match) return raw;
  const [, year, month, day, mark] = match;
  const said = day ? `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}` : month ? `${MONTHS[Number(month) - 1]} ${year}` : year;
  if (mark === '~') return `about ${said}`;
  if (mark === '?') return `${said}, uncertain`;
  if (mark === '%') return `about ${said}, uncertain`;
  return said;
}

/**
 * A time in words, to the minute: on the zone it was stated in, else the case's,
 * `12 March 2026, 14:05 (Europe/Kyiv)`. A time with no clock of its own reads as
 * written, and says so.
 */
function timeWords(raw, tz, zone, unknown) {
  const match = TIME.exec(raw);
  if (!match) return raw;
  const [, year, month, day, hour, minute, , suffix] = match;
  if (!suffix) {
    const wall = `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}, ${hour}:${minute}`;
    return tz ? `${wall} (${tz})` : `${wall}, ${unknown}`;
  }
  const clock = tz || zone || 'UTC';
  const at = zonedFields(Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00${suffix}`), clock);
  const wall = `${at.day} ${MONTHS[at.month - 1]} ${at.year}, ${pad(at.hour)}:${pad(at.minute)}`;
  return clock === 'UTC' ? `${wall} UTC` : `${wall} (${clock})`;
}

/** A stored value in words, a range included. */
function valueWords(raw, tz, zone, unknown) {
  const words = (part) => (TIME.test(part) ? timeWords(part, tz, zone, unknown) : dateWords(part));
  const [first, second] = String(raw ?? '').split('/');
  return second ? `between ${words(first)} and ${words(second)}` : words(first);
}

/**
 * When a geolocation's content is from, saying which date it is: the day a proof
 * gives, the file's own clock, the day it was posted or the imagery's day.
 */
export function whenWords(reading, zone = 'UTC') {
  if (!reading?.raw) return '';
  if (reading.kind === 'captured') {
    const words = valueWords(reading.raw, reading.tz, zone, 'camera clock');
    return words.endsWith('camera clock') ? words : `${words}, from the file`;
  }
  const words = valueWords(reading.raw, reading.tz, zone, 'local time');
  if (reading.kind === 'published') return `posted ${words}`;
  if (reading.kind === 'imagery') return `imagery of ${words}`;
  return words;
}

/** The Day cell of the table: the days on the case's clock, and which date they are. */
function dayCell(reading) {
  if (!reading) return '';
  const days = spanWords(reading.day, reading.last);
  const kind = { captured: 'camera', published: 'posted', imagery: 'imagery' }[reading.kind];
  return kind ? `${days} (${kind})` : days;
}

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Where a geolocation stands: each place it is confirmed at, and its point. */
function whereWords(points) {
  return (points ?? []).map((point) => {
    const coords = pointText(point.lat, point.lon);
    if (!point.place?.id) return coords;
    const chip = entityReference({ id: point.place.id, label: oneLine(point.place.label) || coords });
    return point.place.coords ? chip : `${chip} ${coords}`;
  }).join('; ');
}

/** The proof or the file a block shows: a picture when there is one to show. */
function pictureLine(item, label) {
  if (item.type === 'proof' && !item.picture) return entityReference({ id: item.id, label });
  const width = item.type === 'proof' ? PROOF_WIDTH : '';
  return `${mediaReference({ id: item.id, label })}${writeAttrs({ width })}`;
}

function sourceChips(item) {
  return (item.sources ?? []).map((source) => entityReference({ id: source.id, label: oneLine(source.label) || 'File' })).join(', ');
}

function block(item, { by, zone }) {
  const label = oneLine(item.label) || 'Geolocation';
  return [
    `### ${label}`,
    '',
    pictureLine(item, label),
    '',
    `- Where: ${whereWords(item.points)}`.trimEnd(),
    `- When: ${whenWords(item.shown, zone)}`.trimEnd(),
    ...(by === 'geolocated' ? [`- Geolocated: ${dayWords(item.geolocated?.day)}`.trimEnd()] : []),
    `- Source: ${sourceChips(item)}`.trimEnd(),
    '',
    hintLine('What it shows, and how it was matched.'),
    '',
  ];
}

function table(items, { by }) {
  const reading = by === 'geolocated' ? 'geolocated' : 'shown';
  return toMarkdown({
    columns: [by === 'geolocated' ? 'Geolocated' : 'Day', 'Place', 'Coordinates', 'Source'],
    rows: items.map((item) => [
      dayCell(item[reading]),
      // a place named by its coordinates would say them twice beside the Coordinates cell
      chipsCell((item.points ?? []).map((point) => point.place).filter((place) => place?.id && !place.coords)),
      (item.points ?? []).map((point) => pointText(point.lat, point.lon)).filter(Boolean).join('; '),
      chipsCell([...(item.type === 'proof' ? [{ id: item.id, label: item.label }] : []), ...(item.sources ?? [])]
        .filter((entry, at, all) => all.findIndex((other) => other.id === entry.id) === at)),
    ]),
  }).trimEnd();
}

/**
 * The note for a period: `{ title, body }`. `found` is the server's answer (`items`,
 * `total`); `title` is the name the note is given, the period in words unless a note
 * of that name is already there.
 */
export function fromCaseNote(found, { from = '', to = '', by = 'shown', zone = 'UTC', layout = 'figures', title = '' } = {}) {
  const items = found?.items ?? [];
  const name = title || periodTitle(from, to, by);
  const cut = cutLine({ kept: items.length, total: found?.total ?? items.length, noun: 'geolocations', narrow: 'Narrow the period for the rest.' });
  const findings = layout === 'table'
    ? [...(items.length ? [table(items, { by }), ''] : [])]
    : items.flatMap((item) => block(item, { by, zone }));
  const lines = [
    `# ${name}`,
    '',
    '## Summary',
    '',
    hintLine('What these geolocations show, in two or three sentences.'),
    '',
    '## Findings',
    '',
    ...(cut ? [`*${cut}*`, ''] : []),
    ...findings,
    '## Ruled out',
    '',
    hintLine('What was checked and did not hold.'),
    '',
    '## Limits',
    '',
    hintLine('Imagery dates, gaps, what could not be confirmed.'),
  ];
  return { title: name, body: `${lines.join('\n')}\n` };
}

/** What the tile shows on its page: the parts, without anything of a case. */
export const FROM_CASE_SAMPLE = [
  '## Summary', '', '## Findings', '',
  '### Strike on the depot', '', '- Where: 48.12345, 37.12345', '- When: 12 March 2026, 14:05', '- Source: ', '',
  '### Convoy on the bridge', '', '- Where: 48.13021, 37.14210', '- When: posted 13 March 2026', '- Source: ', '',
  '## Ruled out', '', '## Limits', '',
].join('\n');

/** The count the dialog says as the period changes. */
export function countWords(found, by = 'shown') {
  if (!found) return '';
  const total = found.total ?? 0;
  const said = total === 0
    ? 'No geolocation in these days.'
    : `${total.toLocaleString('en-US')} geolocation${total === 1 ? '' : 's'}${total > FROM_CASE_LIMIT ? `, the note holds the first ${FROM_CASE_LIMIT}` : ''}.`;
  const undated = found.undated ?? 0;
  if (!undated) return said;
  const one = undated === 1;
  const none = by === 'geolocated'
    ? `no day ${one ? 'it was' : 'they were'} placed`
    : `no date of ${one ? 'its' : 'their'} own`;
  return `${said} ${undated} more ${one ? 'has' : 'have'} ${none}.`;
}
