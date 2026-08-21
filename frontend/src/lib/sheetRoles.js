/**
 * What a sheet's column can know about itself.
 *
 * The rule this module exists to serve, and never to break:
 *
 * > The CSV keeps **the words**. A status, a list of values, a quantity, a lat/lon are
 * > text a spreadsheet shows as it found them. The sidecar keeps **what the app knows
 * > about the column** — its role, its vocabulary, its separator, its unit. Losing the
 * > sidecar costs chips and colours, never a finding.
 *
 * So nothing here rewrites a cell. Everything here *reads* one, and every reader is
 * allowed to fail: `To be found` in a coordinates column, `?` in a date column and
 * `OK en cours` outside a status vocabulary are what the real binders hold on every
 * page. A role that refused them would refuse the work, so a role is a lens, never a
 * validator — the value stays, it is shown as it is, and the filter can still find it.
 *
 * Pure: text in, readings out. No DOM, no case, no fetch, and no import from
 * `lib/sheet.js` — that one imports this, and the arrow points one way.
 */

/** Every role a column may hold. Mirrors `engine/sheetroles.ROLE_KINDS`. `url` is the
 *  column a promotion files as sources, `row` points at another row of the same sheet,
 *  `offset` carries a time relative to a named anchor.
 *
 *  `locked` is the odd one: a column whose text the **app** owns and the analyst reads. It
 *  exists because a sheet built out of the case is a view of the case, and a view somebody
 *  can type over is a view that starts lying the first time they do. Unlike `stamped` and
 *  `computed` it carries a link — the point of those columns is that the cell opens the
 *  entity — so `linkable()` admits it where it refuses every other role. */
export const ROLE_KINDS = [
  'state',
  'choice',
  'boolean',
  'number',
  'latlon',
  'when',
  'picture',
  'url',
  'row',
  'offset',
  'stamped',
  'computed',
  'locked',
];

/** What a cell of a `picture` column has to hold before anything is drawn from it: an
 *  address, not somebody's filename. A path off another disk is a picture nobody but them
 *  can see, and drawing a broken frame for it would say the cell was wrong when it is
 *  merely elsewhere. */
const PICTURE_URL = /\bhttps?:\/\/[^\s<>"'()[\]]+/i;

/** Addresses that end in something a browser draws. Used to *suggest* the role — a URL
 *  with no extension is an image often enough that a declared column does not consult
 *  this — and to recognise a file **inside the case**, where there is no host to ask. */
const IMAGE_PATH = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i;

/** The picture one cell points at, or null. The first address it holds: a cell carrying
 *  a photo and its archive copy is one row of work, and a strip of two thumbnails in a
 *  cell thirty pixels tall would be neither. */
export function pictureUrl(cell) {
  const found = String(cell ?? '').match(PICTURE_URL);
  return found ? found[0].replace(/[.,;:!?]+$/, '') : null;
}

/**
 * A cell of a picture column read as **a file of this case**, or null.
 *
 * The gap this closes was the plainest one in the tool: a geolocation index is worked on
 * the images the case already holds, and a picture column that only understood `http`
 * could draw a stranger's photo and not the case's own. The Notebook could already cite
 * case media; the grid could not.
 *
 * A case-relative path and nothing else — no scheme, no leading slash, no `..` — because
 * the cell is text a collaborator will read in a spreadsheet and `media/quai-sud.jpg` is
 * the only spelling that means the same thing to them as to the app. Anything absolute is
 * refused rather than drawn: it names a disk this case does not travel with.
 */
export function picturePath(cell) {
  const body = String(cell ?? '').trim();
  if (!body || /^[a-z]+:/i.test(body) || body.startsWith('/') || body.startsWith('\\')) return null;
  if (body.includes('..') || /[\r\n\t]/.test(body)) return null;
  const path = body.replace(/\\/g, '/');
  return IMAGE_PATH.test(path) ? path : null;
}

/**
 * How a picture cell is drawn: an address to fetch, or a file to read out of the case.
 *
 * One answer for both, so the grid asks once and the two cannot drift into two rules about
 * what a picture is. `kind` is what decides whether anything leaves the machine.
 */
export function pictureRef(cell) {
  const url = pictureUrl(cell);
  if (url) return { kind: 'url', value: url };
  const path = picturePath(cell);
  return path ? { kind: 'case', value: path } : null;
}

/** The state vocabulary a column starts with. Ordered, least done first: that order
 *  *is* the ranking the sort reads, so reordering the list reorders the column. */
export const STATE_DEFAULTS = ['to do', 'in progress', 'done', 'ruled out'];

/** And the colour each of those four is painted, because a worklist is read at a glance
 *  before it is read row by row: nothing started grey, work in flight blue, settled
 *  green, eliminated red. Seeded when a state column is born and the analyst's from then
 *  on — the defaults sit *under* what the role declares, so clearing the green off `done`
 *  clears it for good. Mirrors `engine/sheetroles.STATE_COLOURS`. */
export const STATE_COLOURS = {
  'to do': 'grey',
  'in progress': 'blue',
  'done': 'green',
  'ruled out': 'red',
};

/** The two words a boolean column starts with, in that order: yes first, so the sort puts
 *  what is true above what is not. Capitals because that is how the binders write them, and
 *  because `computed` writes the same pair — one column of `YES`/`NO` in the file, whether
 *  the app filled it or the analyst did. */
export const BOOLEAN_DEFAULTS = ['YES', 'NO'];

/** The colours the grid offers, for a row and for a chip alike. Mirrors
 *  `engine/sheets.ROW_COLOURS`, and `lib/sheet.js` re-exports it so there is one list on
 *  this side. Drawn from the annotation palette, never the amber accent: that one means
 *  selection, and a value painted with it would read as a selected value. */
export const ROW_COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'grey'];

/** What a multi-value column is split on unless the analyst says otherwise. The
 *  binders' own separator, comma-space, which is also what a spreadsheet's own
 *  concatenations produce. */
export const DEFAULT_SEPARATOR = ', ';

/** The three things a `when` column can hold, which are the three the binders write: a
 *  date, a bare time of day whose date lives in the sheet's title, or both together. */
export const WHEN_SHAPES = ['date', 'time', 'datetime'];

/** The one answer a number column's footer gives. Asked rather than assumed: a total is
 *  what a column of counts wants and nonsense on a column of percentages, and a column
 *  of years wants neither. Mirrors `engine/sheetroles.NUMBER_SUMMARIES`. */
export const NUMBER_SUMMARIES = ['none', 'count', 'sum', 'mean', 'range'];

/** How long a unit may be. `%`, `€`, `km`, `rounds` — a label, not a sentence. */
const MAX_UNIT = 8;

/** How long a synchronisation anchor may be named. `IGLA launch`, `second impact` — read
 *  in a heading and in a Claim's reasoning, so a phrase and not a note. Mirrors
 *  `engine/sheetroles.MAX_ANCHOR_NAME`. */
export const MAX_ANCHOR_NAME = 60;

/** How many anchors one sheet may declare. An event has a handful of moments several
 *  videos can be lined up on; past that the sheet is a transcript. */
export const MAX_ANCHORS = 12;

/**
 * What a computed column may be. Mirrors `engine/sheetroles.COMPUTED_NATURES`.
 *
 * `has_point` is the one the binders' `On map: YES/NO` actually meant: not "this row
 * points at something" but "the thing it points at has a place". A brigade points at an
 * entity and is not on a map.
 *
 * The other two are the number a **comparison grid** needs and had no way to get. This
 * app has no formulas on purpose — a spreadsheet's second copy of the case is exactly what
 * a sheet is not — but eleven candidates against six criteria asks one arithmetic question
 * and asks it constantly: how far is this row done (`filled_of`), and how many of its
 * criteria are met (`yes_of`). They are computed on the **server** like the other one,
 * because a computed column is written into the CSV and the collaborator opening the file
 * is owed the number rather than an empty column.
 *
 * `point` and `relations` are what `has_point` is not. It answers *whether* the case knows
 * the row's subject; those two answer **what it knows** — the coordinates, and the entities
 * at the far end of its edges. Without them a column pointed at the case said nothing about
 * the case, so the coordinates and the parent unit went on being copied by hand into the
 * column alongside, which is the retyping the whole bridge exists to end.
 *
 * `in_case` is the only one that reads `built` rather than `links`, because it is the only
 * one asking about an entity that may be **gone**: a link naming something deleted is swept
 * on the next read, so by the time anyone asks, the cell that would have answered is blank.
 * The row that lost its proof is exactly the row worth finding.
 */
export const COMPUTED_NATURES = [
  'has_point',
  'filled_of',
  'yes_of',
  'point',
  'relations',
  'in_case',
];

/** The natures that count over a chosen set of columns rather than asking the graph. */
export const COUNTING_NATURES = ['filled_of', 'yes_of'];

/** The natures that follow **one named column's** link and restate what the case holds
 *  at the end of it. Named rather than swept, because a sheet may point at the case from
 *  a subject column and a place column both, and "whatever this row points at" would
 *  answer about whichever the walk reached first. */
export const LINKED_NATURES = ['point', 'relations'];

/** How many columns one of those may read. Mirrors `engine/sheetroles.MAX_COUNTED_COLUMNS`:
 *  a score over sixty columns is not a score. */
export const MAX_COUNTED_COLUMNS = 24;

/** How many distinct values a column may hold and still read as a set of answers.
 *  Mirrors `lib/sheet.js`'s own bound on the values a filter menu offers. */
const MAX_CHOICE_VALUES = 40;

function blank(value) {
  return !String(value ?? '').trim();
}

/** What a yes and a no look like across the spellings the binders use. Read by detection —
 *  once a column is a boolean, its own two words are the ones that count — and by a
 *  `yes_of` score, for the columns nobody declared. Mirrors `engine/sheetroles.YES_WORDS`. */
export const YES_WORDS = new Set(['yes', 'y', 'true', 'oui', 'x', '1', 'ok', 'done']);
const NO_WORDS = new Set(['no', 'n', 'false', 'non', '-', '0', 'ko']);

// -- the role record ----------------------------------------------------------

/**
 * One column's role, reduced to the fields its kind actually uses.
 *
 * Fields a kind does not use are dropped rather than carried: a column that was a
 * `choice` and became a `when` would otherwise keep a vocabulary nobody reads, and the
 * next reader would wonder which of the two the column is.
 */
export function normalizeRole(role) {
  const kind = ROLE_KINDS.includes(role?.kind) ? role.kind : null;
  if (!kind) return null;
  const clean = { kind };
  if (kind === 'state' || kind === 'choice' || kind === 'boolean') {
    const values = Array.isArray(role.values)
      ? [...new Set(role.values.map((value) => String(value)).filter((value) => value !== ''))]
      : [];
    clean.values = values.slice(0, MAX_CHOICE_VALUES);
    // A state column nobody has said anything about is born with the four words and the
    // four colours together: the words alone would be a status column that reads as grey
    // text, and painting four chips by hand is the kind of setup a default is for.
    const born = kind === 'state' && !clean.values.length;
    if (born) clean.values = [...STATE_DEFAULTS];
    // Exactly two, because that is what makes one click a toggle rather than a menu. A
    // third word would leave the cell with nowhere to go next.
    if (kind === 'boolean') {
      clean.values = clean.values.slice(0, 2);
      while (clean.values.length < 2) clean.values.push(BOOLEAN_DEFAULTS[clean.values.length]);
      // How the cell is drawn, and nothing more. A tick column is a yes/no column: the
      // file still holds the two words, the sort still reads them, the filter still
      // finds them. Its own kind would have been a second copy of all of that for a
      // difference of one glyph — and a column whose file said nothing readable.
      clean.tick = Boolean(role.tick);
    }
    // A colour per value, kept apart from the values themselves: the value is what a cell
    // is matched against, so it must stay exactly the word the file holds. What the role
    // says wins over the birth colours, value by value, so a colour can be changed and a
    // colour can be removed.
    clean.colours = Object.fromEntries(
      Object.entries({ ...(born ? STATE_COLOURS : {}), ...(role.colours ?? {}) }).filter(
        ([value, colour]) => clean.values.includes(value) && ROW_COLOURS.includes(colour),
      ),
    );
  }
  if (kind === 'choice') {
    // Whether one cell may hold several values, and what they are written between. A
    // separator or nothing: reading a quantity out of `2x S-125` used to live here too,
    // and it was a count kept in a column of values — a count belongs in a number column
    // beside a column saying what is being counted.
    clean.multi = typeof role.multi === 'string' && role.multi ? role.multi : null;
  }
  if (kind === 'number') {
    // What follows the number when it is written out — `%`, `€`, `km`. A unit rather
    // than a list of formats: a percentage and a currency differ by the sign after the
    // digits, and an enum of five would have had to grow a sixth the first time a
    // column held tonnes.
    clean.unit = typeof role.unit === 'string' ? role.unit.trim().slice(0, MAX_UNIT) : '';
    // Where it is written. Beside the heading always, since that is where a spreadsheet
    // puts it and the file holds the digits alone; after every cell only when the column
    // says so, because `40 %` reads as the value where four hundred repeated `km` read
    // as noise.
    clean.unitInCells = Boolean(role.unitInCells);
    // Which one answer the footer gives. `sum` is what a count column wants and the
    // wrong answer for a column of percentages, which is exactly why it is asked.
    clean.summary = NUMBER_SUMMARIES.includes(role.summary) ? role.summary : 'sum';
  }
  if (kind === 'when') {
    // Which of the three the column holds. Declared rather than inferred on every read:
    // the analyst can say "these are times" about a column that is still empty, and an
    // inferred shape would flip under them as the first rows are filled.
    clean.shape = WHEN_SHAPES.includes(role.shape) ? role.shape : 'date';
    // Which number a slash date leads with. Guessing silently reverses twelve days a
    // month, and the binders read `dd/MM/yyyy`, so that is the default and it is
    // stated rather than inferred.
    clean.dayFirst = role.dayFirst === undefined ? true : Boolean(role.dayFirst);
  }
  if (kind === 'row') {
    // Which column's words name the other row. The binders' `Links with others` held
    // unit names, and that is kept: a file whose links read `r7f3a` is a file the
    // collaborator opening it cannot follow. Null means the first column that is not
    // the key, resolved where the table is known.
    clean.of = typeof role.of === 'string' && role.of ? role.of : null;
    // A brigade lists several companies, so a cell holds several names.
    clean.multi = typeof role.multi === 'string' && role.multi ? role.multi : null;
  }
  if (kind === 'offset') {
    // Which anchor the cell is counted from. One column per anchor and no syntax in the
    // cell: the binders held `start synchro` *and* `end synchro`, so a single anchor per
    // sheet would not have survived the first real event.
    clean.anchor = typeof role.anchor === 'string' ? role.anchor.trim().slice(0, MAX_ANCHOR_NAME) : '';
  }
  if (kind === 'computed') {
    clean.of = COMPUTED_NATURES.includes(role.of) ? role.of : COMPUTED_NATURES[0];
    if (COUNTING_NATURES.includes(clean.of)) {
      // Which columns it counts, in the order they were chosen: the number does not
      // depend on it, but the panel lists them back and a list that reshuffles itself
      // reads as a different answer.
      clean.columns = [...new Set((Array.isArray(role.columns) ? role.columns : []).map(String))]
        .filter(Boolean)
        .slice(0, MAX_COUNTED_COLUMNS);
    }
    if (LINKED_NATURES.includes(clean.of)) {
      clean.from = typeof role.from === 'string' && role.from ? role.from : null;
    }
    if (clean.of === 'relations') {
      clean.multi = typeof role.multi === 'string' && role.multi ? role.multi : DEFAULT_SEPARATOR;
    }
  }
  return clean;
}

/** How a counting column reads in a heading or a footer: `3 of 6`, or nothing when it has
 *  been told to read no columns. Said once here, because the number in the cell is bare —
 *  the denominator repeated down four hundred rows would be four hundred copies of one
 *  fact. */
export function countedOf(role) {
  return COUNTING_NATURES.includes(role?.of) ? (role.columns?.length ?? 0) : 0;
}

/** The colour a value's chip is painted, or null for the neutral one. */
export function valueColour(role, value) {
  return role?.colours?.[value] ?? null;
}

/**
 * A vocabulary with one value moved, added, renamed, painted or dropped.
 *
 * One function rather than five, because every one of them is the same edit — a list and
 * a colour map, out the other side — and because the **order is the ranking** the sort
 * reads. That is why nothing here sorts on its own: `to do → in progress → done` is the
 * order of the work, and an editor that alphabetised it would have put `done` first.
 *
 * `at` is where the value is now; `to` is where it goes, or -1 to drop it. A value that
 * is not in the list yet is appended.
 */
export function editVocabulary(role, { value, at = -1, to = null, colour = undefined }) {
  const values = [...(role?.values ?? [])];
  const colours = { ...(role?.colours ?? {}) };
  const name = String(value ?? '').trim();
  const from = at >= 0 ? at : values.indexOf(name);

  if (to === -1) {
    if (from === -1) return { values, colours };
    delete colours[values[from]];
    values.splice(from, 1);
    return { values, colours };
  }
  if (from === -1) {
    if (!name || values.includes(name)) return { values, colours };
    values.push(name);
  } else if (name && values[from] !== name) {
    // A rename carries the colour with it: the colour belongs to the answer, not to the
    // characters, and a value fixed for a typo that lost its paint reads as a new one.
    if (values.includes(name)) return { values, colours };
    const painted = colours[values[from]];
    delete colours[values[from]];
    values[from] = name;
    if (painted) colours[name] = painted;
  }
  if (to !== null && to !== -1 && from !== -1) {
    const moved = values.splice(from, 1);
    values.splice(Math.max(0, Math.min(values.length, to)), 0, ...moved);
  }
  if (colour !== undefined) {
    const target = name || values[from];
    if (colour && ROW_COLOURS.includes(colour)) colours[target] = colour;
    else delete colours[target];
  }
  return { values, colours };
}

/** The same values, ordered by their words. Asked for by name and never applied on its
 *  own: a state column's order is the order of the work, not the alphabet. */
export function sortVocabulary(role, { desc = false } = {}) {
  const values = [...(role?.values ?? [])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
  return { values: desc ? values.reverse() : values, colours: { ...(role?.colours ?? {}) } };
}

/**
 * A column's vocabulary against what its cells actually say.
 *
 * Three answers a worklist needs and the textarea could not give: how many rows hold each
 * declared value, which declared values nothing uses, and which values the cells hold
 * that the vocabulary has never heard of. The third is the one that matters on an
 * imported binder — `OK en cours` sitting outside a list of four that were never in this
 * file — and it is offered rather than corrected, because the file keeps the words.
 */
export function vocabularyUse(table, columnIndex, role) {
  const totals = valueTotals(table, columnIndex, role) ?? [];
  const held = new Map(totals.map((entry) => [entry.value, entry]));
  const declared = role?.values ?? [];
  const known = new Set(declared);
  return {
    counts: Object.fromEntries(declared.map((value) => [value, held.get(value)?.rows ?? 0])),
    unused: declared.filter((value) => !(held.get(value)?.rows ?? 0)),
    outside: totals.filter((entry) => entry.value && !known.has(entry.value)),
  };
}

/**
 * What a column looks like it holds, as a suggestion.
 *
 * Offered, never applied: the menu shows it and the analyst confirms, because a role
 * imposed by a guess is a role that has to be undone before the work can start. Only
 * the three readings a machine can be sure of are guessed — a point, a moment, a small
 * closed set. A **state** is never guessed: whether `pass` means done or means skipped
 * is a judgement about the investigation, not about the characters in the cell.
 */
export function detectRole(values) {
  const filled = (values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (filled.length < 2) return null;
  const share = (test) => filled.filter(test).length / filled.length;
  // Two thirds rather than all of them: the binders' columns are half-finished by
  // definition, and a column of coordinates with `To be found` in a third of its rows is
  // still a column of coordinates.
  if (share((value) => parseLatLon(value)) >= 0.66) return 'latlon';
  if (share((value) => parseWhen(value)) >= 0.66) return 'when';
  // Suggested off the extension alone, and never off "it is a URL": a column of sources
  // is URLs too, and turning one into a wall of thumbnails would fetch forty pages the
  // analyst never asked for.
  if (share((value) => IMAGE_PATH.test(String(value))) >= 0.66) return 'picture';
  const distinct = new Set(filled);
  // Two words and both of them a yes or a no: `YES/NO`, `true/false`, `oui/non`, `x/-`.
  // Two arbitrary words are a set of values, not a question with two answers.
  if (
    distinct.size === 2 &&
    [...distinct].every((value) => YES_WORDS.has(value.toLowerCase()) || NO_WORDS.has(value.toLowerCase()))
  ) {
    return 'boolean';
  }
  if (distinct.size <= Math.min(MAX_CHOICE_VALUES, filled.length / 2)) return 'choice';
  return null;
}

// -- numbers ------------------------------------------------------------------

const NUMBER_CELL = /^[~≈<>±]?\s*([+-]?[\d\u00a0 ']*\d(?:[.,]\d+)?)\s*%?$/;

/**
 * A cell read as a number, or null.
 *
 * Strict on purpose. `1 234` and `12,5` are read, because a European export writes both,
 * and a leading `~` or `>` is read because an estimate is still a number. `Only 9 in
 * service?` is **not**: extracting a digit out of prose would also turn `AB-123` into 123,
 * and a total built on that is a total nobody can check. What the role cannot read it
 * reports, which is the honest half of the deal.
 */
export function parseNumber(text) {
  const match = String(text ?? '').trim().match(NUMBER_CELL);
  if (!match) return null;
  const digits = match[1].replace(/[\u00a0 ']/g, '').replace(',', '.');
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/**
 * What a number column adds up to over the rows given, and what it could not read.
 *
 * Given **row indices**, not the table, and that is the whole point: the answer is about
 * what is on screen. A sheet filtered to the twelve rows left to check should total those
 * twelve, because the question being asked is about them.
 *
 * `unreadable` is the honest half of a role that lets a cell say `unknown`. A footer
 * reading `20 over 2` on a column of fifteen rows was arithmetic nobody could check: the
 * total is right, and it is right about two cells out of fifteen. The count is what says
 * so, and the grid offers it as a filter.
 */
export function numberTotals(table, columnIndex, rowIndices) {
  let count = 0;
  let sum = 0;
  let min = null;
  let max = null;
  let unreadable = 0;
  for (const index of rowIndices ?? []) {
    const cell = table.rows[index]?.[columnIndex];
    const value = parseNumber(cell);
    if (value === null) {
      if (!blank(cell)) unreadable += 1;
      continue;
    }
    count += 1;
    sum += value;
    min = min === null ? value : Math.min(min, value);
    max = max === null ? value : Math.max(max, value);
  }
  // Floating point: `0.1 + 0.2` must not read as `0.30000000000000004` in a footer.
  const tidy = (value) => (value === null ? null : Math.round(value * 1e6) / 1e6);
  return {
    count,
    unreadable,
    sum: tidy(sum),
    mean: count ? tidy(sum / count) : null,
    min: tidy(min),
    max: tidy(max),
  };
}

/**
 * Whether the column's own lens can read this cell.
 *
 * The rule a role exists under is that it never refuses a cell — `To be found` in a
 * coordinates column is what the real binders hold on every page. The cost of that is
 * silence: a number column summing two cells out of fifteen looks exactly like one
 * summing fifteen. This is the other half of the deal, and the grid spends it on a badge
 * and a filter rather than on a refusal.
 *
 * An empty cell reads: blank is *unknown*, which is an answer, not a mistake.
 */
export function readsCell(role, cell) {
  const body = String(cell ?? '').trim();
  if (!body) return true;
  const kind = role?.kind;
  if (kind === 'number') return parseNumber(body) !== null;
  if (kind === 'latlon') {
    const point = parseLatLon(body);
    return Boolean(point) && !point.outOfBounds;
  }
  if (kind === 'when') return parseWhen(body, role) !== null;
  if (kind === 'picture') return pictureRef(body) !== null;
  if (kind === 'offset') return parseOffset(body) !== null;
  // Whether a row name finds its row is a question about the whole table, so it is
  // answered where the table is (`lib/sheetRows.js`) and not here. Every cell reads.
  if (kind === 'row') return true;
  // A value outside the column's own words is readable in the sense that it is shown,
  // and unreadable in the sense the analyst cares about: it is not one of the answers
  // this column takes, so it is what "to check" means here.
  if (isChipped(role)) return cellChips(body, role).every((chip) => chip.known);
  return true;
}

/** How many of a column's filled cells its lens cannot read, over how many there are. */
export function readable(table, columnIndex, role) {
  let total = 0;
  let read = 0;
  for (const row of table?.rows ?? []) {
    const cell = row[columnIndex];
    if (blank(cell)) continue;
    total += 1;
    if (readsCell(role, cell)) read += 1;
  }
  return { total, read, unreadable: total - read };
}

// -- lat/lon ------------------------------------------------------------------

const DECIMAL_PAIR =
  /^\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*°?\s*([NnSs])?(\s*[,;/]\s*|\s+)([+-]?\d{1,3}(?:[.,]\d+)?)\s*°?\s*([EeWw])?\s*$/;
const DMS =
  /(\d{1,3})\s*°\s*(\d{1,2})?\s*['′]?\s*([\d.]+)?\s*["″]?\s*([NnSsEeWw])/g;

function decimals(text) {
  const at = String(text).replace(',', '.').indexOf('.');
  return at === -1 ? 0 : String(text).length - at - 1;
}

function signed(value, hemisphere, negatives) {
  const number = Number(String(value).replace(',', '.'));
  return negatives.includes(String(hemisphere ?? '').toUpperCase()) ? -Math.abs(number) : number;
}

/**
 * A cell read as a point, or null.
 *
 * Three shapes, because one binder column held all three: a decimal pair
 * (`48.8566, 2.3522`), a decimal pair with hemispheres (`48.8566N 2.3522E`), and
 * degrees-minutes-seconds (`48°51'24"N 2°21'08"E`).
 *
 * `decimals` is how precisely the cell was written, which is a claim about the ground:
 * two decimals is about a kilometre, and a worklist full of two-decimal coordinates is
 * a worklist of neighbourhoods presented as addresses. `outOfBounds` is reported rather
 * than refused — a transposed pair is a finding about the file, not a parse failure.
 *
 * A comma is a decimal mark, so `48,8` is one number rather than two coordinates. It
 * separates a pair only where it cannot be decimal: a space after it, a hemisphere letter,
 * or a full stop already doing the job. Mirrors `engine/sheetroles.parse_latlon`.
 */
export function parseLatLon(text) {
  const body = String(text ?? '').trim();
  if (!body) return null;

  const pair = body.match(DECIMAL_PAIR);
  if (pair) {
    const [, rawLat, latHem, separator, rawLon, lonHem] = pair;
    if (separator === ',' && !body.includes('.') && !latHem && !lonHem) return null;
    const lat = signed(rawLat, latHem, ['S']);
    const lon = signed(rawLon, lonHem, ['W']);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      decimals: Math.min(decimals(rawLat), decimals(rawLon)),
      outOfBounds: Math.abs(lat) > 90 || Math.abs(lon) > 180,
    };
  }

  const parts = [...body.matchAll(DMS)];
  if (parts.length === 2) {
    const read = parts.map(([, deg, min, sec, hem]) => {
      const value = Number(deg) + Number(min ?? 0) / 60 + Number(sec ?? 0) / 3600;
      return { value: signed(value, hem, ['S', 'W']), hem: String(hem).toUpperCase() };
    });
    const lat = read.find((entry) => 'NS'.includes(entry.hem));
    const lon = read.find((entry) => 'EW'.includes(entry.hem));
    if (!lat || !lon) return null;
    // Seconds resolve to about thirty metres, which is five decimal places of
    // confidence the writer did not claim; four is the honest reading.
    return {
      lat: lat.value,
      lon: lon.value,
      decimals: 4,
      outOfBounds: Math.abs(lat.value) > 90 || Math.abs(lon.value) > 180,
    };
  }
  return null;
}

/** About how far apart two points written to this many decimals could be, in metres.
 *  One degree of latitude is 111 320 m, so the last digit written is the uncertainty. */
export function precisionMetres(places) {
  return Math.round(111_320 * 10 ** -Math.max(0, places));
}

/** A point as one canonical string. The only function here that produces a cell rather
 *  than reading one, and it is never called on a save: normalising is an edit the
 *  analyst asks for, and it lands in the undo stack like any other. */
export function formatLatLon(point, places = 5) {
  if (!point) return '';
  return `${point.lat.toFixed(places)}, ${point.lon.toFixed(places)}`;
}

const EARTH_M = 6_371_000;

/** Metres between two points, on a sphere. Close enough at worklist distances, and it
 *  needs no projection to be right about "these two rows are the same place". */
export function distanceMetres(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

// -- offsets, and the anchor they are counted from ----------------------------

const OFFSET = /^([+-]?)(?:(\d+):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?$/;
const BARE_SECONDS = /^([+-]?)(\d{1,5})(?:[.,](\d{1,3}))?\s*s?$/i;

/**
 * A cell read as seconds away from an anchor, or null. Mirrors
 * `engine/sheetroles.parse_offset`.
 *
 * `-00:01:50`, `00:04:04`, `1:05` and a bare `-110` — the four spellings a video player
 * and a spreadsheet between them produce. Negative means *before* the anchor, which is
 * what the binders' leading minus already meant.
 */
export function parseOffset(text) {
  const body = String(text ?? '').trim();
  if (!body) return null;
  const found = body.match(OFFSET);
  if (found) {
    const [, sign, hours, minutes, seconds, fraction] = found;
    if (Number(seconds) > 59 || (hours !== undefined && Number(minutes) > 59)) return null;
    const total =
      Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction ?? 0}`);
    return sign === '-' ? -total : total;
  }
  const bare = body.match(BARE_SECONDS);
  if (!bare) return null;
  const value = Number(bare[2]) + Number(`0.${bare[3] ?? 0}`);
  return bare[1] === '-' ? -value : value;
}

/** Seconds written the way the binders write them, `-00:01:50`. One spelling out,
 *  several in: what the analyst typed stays in the cell. */
export function formatOffset(seconds) {
  const sign = seconds < 0 ? '-' : '';
  const whole = Math.trunc(Math.abs(seconds));
  const pad = (value) => String(value).padStart(2, '0');
  return `${sign}${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}`;
}

/**
 * The absolute instant an offset lands on, as an ISO timestamp, or null.
 *
 * Drawn beside the cell so the relative column reads as an absolute time the moment the
 * anchor is dated — and it stays a *reading*, never written into the cell: an inferred
 * moment is a Claim, and `engine/sheetclaims.py` is the only thing that files one.
 */
export function offsetMoment(anchorAt, seconds) {
  const at = Date.parse(String(anchorAt ?? ''));
  if (!Number.isFinite(at) || seconds === null || seconds === undefined) return null;
  return `${new Date(at + Math.round(seconds) * 1000).toISOString().slice(0, 19)}Z`;
}

// -- dates and times ----------------------------------------------------------

const SLASH = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const RFC = /^(?:\w{3},\s*)?(\d{1,2})\s+(\w{3})\w*\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i;

/**
 * A moment as milliseconds, or NaN when the calendar has no such day.
 *
 * `Date.UTC` rolls a bad day forward — `29/02/2025` comes back as 1 March — so a column
 * holding an impossible date sorted as though it were the day after, silently. Checked
 * rather than rolled, and it is also what keeps this reader and
 * `engine/sheetroles.parse_when` answering the same thing about the same cell, which is
 * what a Claim dated off a column depends on.
 */
/**
 * Whether this is a time of day rather than one that rolls over into the next.
 *
 * `Date.UTC` takes 99:00 and moves the day instead of refusing, and 12:30:75 keeps the day
 * it was given — so a cell the server refuses used to sort here without a word. Asked before
 * the moment is built, exactly as `engine/sheetroles._holds` asks it.
 */
function clockHolds(hour, minute, second) {
  return !(hour > 23 || minute > 59 || second > 59);
}

function utc(year, month, day, hour = 0, minute = 0, second = 0) {
  const key = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(key);
  const same =
    back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return same ? key : NaN;
}

/**
 * A cell read as a moment, or null.
 *
 * Everything the three binders wrote: `dd/MM/yyyy`, `yyyy-MM-dd`, a bare `hh:mm`,
 * either with a time appended, and the full RFC form an email header carries
 * (`Sat, 03 Jan 2026 06:42:02 GMT`).
 *
 * A bare clock is kept as a **time of day** rather than pinned to some arbitrary date:
 * the binder's `Local time` column holds `01:57` for an event whose date lives in the
 * sheet's title, and inventing a date for it would be inventing evidence. `shape` says
 * which of the two a reading is, and `key` sorts within its own shape.
 */
export function parseWhen(text, role = {}) {
  const body = String(text ?? '').trim();
  if (!body) return null;
  const dayFirst = role.dayFirst === undefined ? true : Boolean(role.dayFirst);

  const clock = body.match(CLOCK);
  if (clock) {
    const [, hour, minute, second] = clock.map(Number);
    if (!clockHolds(hour, minute, second)) return null;
    return {
      shape: 'time',
      key: hour * 3600 + minute * 60 + (second || 0),
      text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
  }

  const rfc = body.match(RFC);
  if (rfc) {
    const month = MONTHS.indexOf(rfc[2].slice(0, 3).toLowerCase()) + 1;
    if (month) {
      if (!clockHolds(Number(rfc[4] ?? 0), Number(rfc[5] ?? 0), Number(rfc[6] ?? 0))) return null;
      const key = utc(Number(rfc[3]), month, Number(rfc[1]), Number(rfc[4] ?? 0), Number(rfc[5] ?? 0), Number(rfc[6] ?? 0));
      if (!Number.isFinite(key)) return null;
      return { shape: 'moment', key, text: new Date(key).toISOString().slice(0, rfc[4] ? 16 : 10) };
    }
  }

  const slash = body.match(SLASH);
  if (slash) {
    const [, one, two, three, hour, minute, second] = slash;
    // A four-digit leading group can only be a year, whatever the column's convention.
    const isoish = one.length === 4;
    const year = Number(isoish ? one : three.length === 2 ? `20${three}` : three);
    const day = Number(isoish ? three : dayFirst ? one : two);
    const month = Number(isoish ? two : dayFirst ? two : one);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (!clockHolds(Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0))) return null;
    const key = utc(year, month, day, Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0));
    if (!Number.isFinite(key)) return null;
    return {
      shape: 'moment',
      key,
      text: new Date(key).toISOString().slice(0, hour ? 16 : 10),
    };
  }
  return null;
}

/**
 * Which way round a column already writes its dates.
 *
 * Read from the column rather than declared, and that is the point: a picker that wrote
 * `2026-01-31` into a column of `31/01/2026` would restyle the file from a click, and the
 * file keeps the words. Ties go to the slash form, which is what the binders use.
 */
export function dateSpelling(values) {
  let iso = 0;
  let slash = 0;
  for (const value of values ?? []) {
    const body = String(value ?? '').trim();
    if (/^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}/.test(body)) iso += 1;
    else if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(body)) slash += 1;
  }
  return iso > slash ? 'iso' : 'slash';
}

/**
 * Which of the three shapes a `when` column actually holds.
 *
 * The role is called *a date or a time* because the binders write all three: a column of
 * `dd/MM/yyyy`, a column of bare `01:57` local times whose date lives in the sheet's
 * title, and a column of both together. Read from the column rather than declared, so the
 * picker a cell offers is the one the column is written in — offering a calendar for a
 * column of clocks would be offering to put a date where the analyst deliberately did not.
 */
export function whenShape(values) {
  let times = 0;
  let dated = 0;
  let withHour = 0;
  for (const value of values ?? []) {
    const read = parseWhen(value);
    if (!read) continue;
    if (read.shape === 'time') times += 1;
    else {
      dated += 1;
      if (read.text.includes('T')) withHour += 1;
    }
  }
  if (times > dated) return 'time';
  return withHour * 2 >= dated && withHour > 0 ? 'datetime' : 'date';
}

/** The input type a shape is picked with. One place, so the editor and any test agree. */
export function pickerType(shape) {
  return shape === 'time' ? 'time' : shape === 'datetime' ? 'datetime-local' : 'date';
}

/**
 * A moment chosen from a picker, spelled the way this column spells moments.
 *
 * The picker hands over `HH:MM`, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` whatever the locale;
 * what lands in the cell is the column's own form, so picking in a `dd/MM/yyyy` column
 * leaves it a `dd/MM/yyyy` column. On a date-only column an hour already in the cell is
 * kept: `03/01/2026 06:42` is a moment somebody established, and a date picker has no
 * business dropping the hour from it.
 */
export function spellWhen(picked, { shape = 'date', spelling = 'slash', keep = '' } = {}) {
  const body = String(picked ?? '').trim();
  if (!body) return '';
  if (shape === 'time') return body.slice(0, 5);

  const [datePart, timePart] = body.split('T');
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return '';
  const date = spelling === 'iso' ? `${year}-${month}-${day}` : `${day}/${month}/${year}`;
  if (shape === 'datetime') return timePart ? `${date} ${timePart.slice(0, 5)}` : date;
  const clock = String(keep ?? '').match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  return clock ? `${date} ${clock[1]}` : date;
}

// -- values, and how many of each ---------------------------------------------

/** A cell as the values it holds. One value unless the column says it is a list.
 *  Mirrors `engine/sheetroles.split_values`. Two kinds hold lists and for the same
 *  reason: a `choice` cell holds three pieces of equipment, a `row` cell holds the three
 *  companies of a brigade. */
export function splitValues(cell, role) {
  const body = String(cell ?? '');
  const separator = role?.kind === 'choice' || role?.kind === 'row' ? role.multi : null;
  if (!separator) return blank(body) ? [] : [body.trim()];
  return body
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A cell as chips: the value, how many of it, and whether the vocabulary knows it.
 *  An unknown value is a chip like any other — the binders write outside their own
 *  vocabulary constantly, and a lens that hid those would hide the work. */
/** Whether a column draws its cells as chips: a closed set of answers, of any size —
 *  plus a `row` column, whose answers are the other rows of this sheet and read the same
 *  way, one name per chip. */
export function isChipped(role) {
  return ['state', 'choice', 'boolean', 'row'].includes(role?.kind);
}

/** The other of a boolean column's two words, for a cell that is clicked rather than
 *  edited. Anything outside the pair goes to the first: a cell holding `maybe` in a
 *  yes/no column is answered by clicking it, not by being left alone. */
export function flipBoolean(role, value) {
  const [yes, no] = role?.values ?? [];
  return String(value ?? '').trim() === yes ? no : yes;
}

/**
 * What a tick box holds after it is clicked: nothing → yes → no → nothing.
 *
 * Three states rather than two, and for the reason the sort control has three: a box
 * is drawn on an **empty** cell as well as a filled one, so a two-state toggle would
 * make *not answered yet* and *no* look identical and leave no way back to the first.
 * On a worklist that is the difference between four hundred rows checked and four
 * hundred rows nobody has opened.
 *
 * A word outside the pair answers yes, the way `flipBoolean` does: a cell holding
 * `maybe` is settled by clicking it.
 */
export function cycleTick(role, value) {
  const [yes, no] = role?.values ?? BOOLEAN_DEFAULTS;
  const held = String(value ?? '').trim();
  if (!held) return yes;
  if (held === yes) return no;
  if (held === no) return '';
  return yes;
}

/** Whether a cell reads as this column's yes, its no, or neither. What the tick box
 *  draws, so the three states are decided in one place. */
export function tickState(role, value) {
  const [yes, no] = role?.values ?? BOOLEAN_DEFAULTS;
  const held = String(value ?? '').trim();
  if (!held) return 'blank';
  if (held === yes) return 'yes';
  if (held === no) return 'no';
  return 'other';
}

export function cellChips(cell, role) {
  const known = new Set(role?.values ?? []);
  return splitValues(cell, role).map((value) => ({
    value,
    known: known.has(value),
    colour: valueColour(role, value),
    raw: value,
  }));
}

/**
 * Every value of a column, with how many rows hold it.
 *
 * One number, and it is the one a filter is about: *how many rows say `S-125`*. A cell
 * holding the same value twice counts once, because the row is what the filter hands
 * back. Nothing is cut here — `columnValues` pages the list, since how much of it fits a
 * menu is the menu's question.
 */
export function valueTotals(table, columnIndex, role) {
  const totals = new Map();
  for (const row of table?.rows ?? []) {
    for (const value of new Set(cellChips(row[columnIndex], role).map((chip) => chip.value))) {
      const entry = totals.get(value) ?? { value, rows: 0 };
      entry.rows += 1;
      totals.set(value, entry);
    }
  }
  return [...totals.values()].sort(
    (a, b) => b.rows - a.rows || a.value.localeCompare(b.value),
  );
}

// -- sorting ------------------------------------------------------------------

/**
 * What one cell is worth to a sort, computed once for the whole column.
 *
 * The comparator used to do this work itself, which meant `parseWhen` ran twice per
 * comparison — a hundred and twelve thousand times on twenty thousand rows, and again on
 * every keystroke, because the sorted view is derived from the table. Measured on a full
 * sheet that was eight hundred milliseconds of blocked main thread per cell typed.
 *
 * So a key is read **once per row** and the comparator only orders keys. It is the same
 * move the filters already make one function up ("compiled once per column rather than
 * once per cell"); the sort had been left out of it.
 *
 * Three answers, and they are not the same:
 *
 * - an array of numbers — what the role read, most significant component first;
 * - `null` — the role can read this column but not this cell, which sorts **after**
 *   the ones it can, so a date column puts `?` at the end rather than in mid-January;
 * - `undefined` — this role does not order anything, and the caller compares words.
 */
export function sortKey(role, value) {
  const kind = role?.kind;
  if (kind === 'state' || kind === 'boolean') {
    // The vocabulary's own order is the ranking: `to do` before `done` because that is
    // how the analyst wrote the list, not because of how the words spell.
    const at = (role.values ?? []).indexOf(String(value ?? '').trim());
    return [at === -1 ? Number.MAX_SAFE_INTEGER : at];
  }
  if (kind === 'when') {
    const read = parseWhen(value, role);
    // A column holding both a date and a bare clock cannot interleave them: they are
    // different scales. Dates first, clocks after, each ordered among its own.
    return read ? [read.shape === 'moment' ? 0 : 1, read.key] : null;
  }
  if (kind === 'latlon') {
    const read = parseLatLon(value);
    // North to south, then west to east: the reading order of a map, and the one that
    // puts the rows of one area together. The latitude is negated so that both
    // components read the same way — smaller is earlier.
    return read ? [-read.lat, read.lon] : null;
  }
  if (kind === 'number' || kind === 'offset') {
    // An offset sorts by its seconds and that is the point of it: `-00:01:50` before
    // `00:04:04` is the order the videos actually run in, and it is usable long before
    // anybody has worked out what time the anchor happened.
    const read = kind === 'offset' ? parseOffset(value) : parseNumber(value);
    return read === null ? null : [read];
  }
  return undefined;
}

/** Whether a role orders a column at all, so a caller can skip reading keys it
 *  would then ignore. */
export function sortsByRole(role) {
  return sortKey(role, '') !== undefined;
}

/**
 * Two keys ordered, or null when they do not settle it.
 *
 * Null is the whole design: the caller falls back to its own text comparison, so a
 * column whose role reads half its cells still sorts, and this module never has to
 * know how `lib/sheet.js` compares words.
 */
export function compareSortKeys(a, b) {
  if (a === undefined || b === undefined) return null;
  if (a === null && b === null) return null;
  if (a === null || b === null) return a === null ? 1 : -1;
  for (let at = 0; at < a.length; at += 1) {
    if (a[at] !== b[at]) return a[at] < b[at] ? -1 : 1;
  }
  return null;
}

// -- how far along the work is ------------------------------------------------

/**
 * What a column says about how much is left.
 *
 * Two readings, and the first needs no role at all — which is the point. The binder
 * this tool most has to replace, a 468-row geolocation index, has no status column:
 * its columns are a date, a title, a country, coordinates and a link. Its question,
 * *how many are left to geolocate*, is the fill rate of one column. A progress reading
 * defined only on a status vocabulary would show nothing on the sheet that needs it
 * most.
 */
export function columnProgress(table, columnIndex, role) {
  const rows = table?.rows ?? [];
  const total = rows.length;
  if (columnIndex === -1) return null;
  const empty = rows.filter((row) => blank(row[columnIndex])).length;
  if (role?.kind !== 'state') {
    return { kind: 'fill', total, filled: total - empty, empty };
  }
  const counts = new Map((role.values ?? []).map((value) => [value, 0]));
  let other = 0;
  for (const row of rows) {
    const value = String(row[columnIndex] ?? '').trim();
    if (!value) continue;
    if (counts.has(value)) counts.set(value, counts.get(value) + 1);
    else other += 1;
  }
  return {
    kind: 'state',
    total,
    empty,
    other,
    buckets: [...counts.entries()].map(([value, count]) => ({ value, count })),
  };
}

/**
 * Which column a sheet's progress should be read off, when nobody has said.
 *
 * A suggestion, never a setting: a status column if one has been declared, otherwise
 * the emptiest column that is not the row's handle, because the column with the most
 * gaps in it is the one being worked through. Returns null rather than guess when
 * every column is full — a sheet with nothing left to fill has no progress to show.
 */
export function suggestProgressColumn(table, roles, keyName) {
  const columns = table?.columns ?? [];
  const declared = columns.find((name) => roles?.[name]?.kind === 'state');
  if (declared) return declared;
  let best = null;
  columns.forEach((name, index) => {
    if (name === keyName) return;
    const empty = (table.rows ?? []).filter((row) => blank(row[index])).length;
    if (empty > 0 && (!best || empty > best.empty)) best = { name, empty };
  });
  return best?.name ?? null;
}

// -- what the column says twice, and what sits too close ----------------------

/** The values a column repeats, with the rows holding them. Blank is not a duplicate:
 *  four hundred rows with nothing in a column are a worklist, not a mistake. */
export function duplicateGroups(table, columnIndex, role) {
  const seen = new Map();
  (table?.rows ?? []).forEach((row, index) => {
    for (const chip of cellChips(row[columnIndex], role)) {
      if (!chip.value) continue;
      const key = chip.value.toLowerCase();
      if (!seen.has(key)) seen.set(key, { value: chip.value, rows: [] });
      const group = seen.get(key);
      if (group.rows.at(-1) !== index) group.rows.push(index);
    }
  });
  return [...seen.values()]
    .filter((group) => group.rows.length > 1)
    .sort((a, b) => b.rows.length - a.rows.length || a.value.localeCompare(b.value));
}

/** How many buckets a sweep may hold before it is refused. A sheet at the row bound
 *  with every row placed is 20 000 points, which buckets to far fewer than this. */
const MAX_BUCKETS = 200_000;

/**
 * Rows whose points sit within *metres* of each other.
 *
 * Bucketed rather than compared pair by pair, and that is not an optimisation: at the
 * sheet's own bound of twenty thousand rows a naive sweep is two hundred million
 * pairs, which is a frozen tab. Each point falls in a cell of the given size and is
 * compared against its own cell and the eight around it, so the work is linear in the
 * rows and the answer is exact for the distance asked.
 *
 * `capped` says the list was cut, because a silent cut reads as "there are no more".
 */
export function nearbyPairs(table, columnIndex, metres = 200, { cap = 200 } = {}) {
  const points = [];
  (table?.rows ?? []).forEach((row, index) => {
    const point = parseLatLon(row[columnIndex]);
    if (point && !point.outOfBounds) points.push({ index, ...point });
  });
  const size = Math.max(1, metres);
  const latStep = size / 111_320;
  const buckets = new Map();
  for (const point of points) {
    // Longitude degrees shrink towards the poles; using the latitude step for both
    // would make the cells too narrow near the equator and miss pairs near the poles.
    const lonStep = latStep / Math.max(0.01, Math.cos((point.lat * Math.PI) / 180));
    point.cell = [Math.floor(point.lat / latStep), Math.floor(point.lon / lonStep)];
    point.lonStep = lonStep;
    const key = point.cell.join(':');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(point);
    if (buckets.size > MAX_BUCKETS) return { pairs: [], capped: true };
  }

  const pairs = [];
  const done = new Set();
  for (const point of points) {
    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLon = -1; dLon <= 1; dLon += 1) {
        for (const other of buckets.get(`${point.cell[0] + dLat}:${point.cell[1] + dLon}`) ?? []) {
          if (other.index <= point.index) continue;
          const seen = `${point.index}:${other.index}`;
          if (done.has(seen)) continue;
          done.add(seen);
          const apart = distanceMetres(point, other);
          if (apart <= metres) pairs.push({ rows: [point.index, other.index], metres: apart });
        }
      }
    }
    if (pairs.length >= cap) return { pairs: pairs.slice(0, cap), capped: true };
  }
  return { pairs: pairs.sort((a, b) => a.metres - b.metres), capped: false };
}
