import { describe, expect, it } from 'vitest';
import {
  compareSortKeys,
  sortKey,
  sortsByRole,
  BOOLEAN_DEFAULTS,
  COMPUTED_NATURES,
  COUNTING_NATURES,
  LINKED_NATURES,
  ROW_COLOURS,
  DEFAULT_SEPARATOR,
  ROLE_KINDS,
  STATE_COLOURS,
  STATE_DEFAULTS,
  cellChips,
  countedOf,
  columnProgress,
  cycleTick,
  dateSpelling,
  detectRole,
  distanceMetres,
  duplicateGroups,
  editVocabulary,
  flipBoolean,
  formatLatLon,
  formatOffset,
  nearbyPairs,
  normalizeRole,
  numberTotals,
  offsetMoment,
  parseLatLon,
  parseNumber,
  parseOffset,
  picturePath,
  pictureRef,
  pictureUrl,
  parseWhen,
  precisionMetres,
  readable,
  readsCell,
  pickerType,
  sortVocabulary,
  spellWhen,
  splitValues,
  suggestProgressColumn,
  tickState,
  valueTotals,
  vocabularyUse,
  whenShape,
} from './sheetRoles.js';
import shared from './sheetReading.fixture.json';

/** Two cells ordered by what the column knows, the way `visibleRows` ends up ordering
 *  them once it has read a key per row. Written here rather than shipped: the grid never
 *  compares two raw cells, so a module-level version of this would be code the app does
 *  not call. */
const compareByRole = (role, a, b) => compareSortKeys(sortKey(role, a), sortKey(role, b));

describe('the role record', () => {
  it('refuses a kind it does not implement rather than storing it', () => {
    expect(normalizeRole({ kind: 'invented' })).toBeNull();
    expect(normalizeRole(null)).toBeNull();
    expect(ROLE_KINDS).toEqual([
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
    ]);
  });

  it('reads a row column as the words that name the other rows', () => {
    // Names and not keys: a file whose links read `r7f3a` is a file the collaborator
    // opening it cannot follow, and names are what the binders actually wrote.
    expect(normalizeRole({ kind: 'row' })).toEqual({ kind: 'row', of: null, multi: null });
    const role = normalizeRole({ kind: 'row', of: 'Unit', multi: ', ' });
    expect(splitValues('1st Coy, 2nd Coy', role)).toEqual(['1st Coy', '2nd Coy']);
    // Whether a name finds its row is a question about the whole table, so this reader
    // never calls a cell unreadable on its own.
    expect(readsCell(role, 'a unit nobody listed')).toBe(true);
  });

  it('reads an offset as seconds either side of its anchor', () => {
    const role = normalizeRole({ kind: 'offset', anchor: '  IGLA launch  ' });
    expect(role).toEqual({ kind: 'offset', anchor: 'IGLA launch' });
    expect(parseOffset('-00:01:50')).toBe(-110);
    expect(parseOffset('00:04:04')).toBe(244);
    expect(parseOffset('1:05')).toBe(65);
    expect(parseOffset('-110')).toBe(-110);
    expect(parseOffset('1:05:00')).toBe(3900);
    // Sixty-one seconds is not a time somebody meant to write.
    expect(parseOffset('00:00:61')).toBeNull();
    expect(parseOffset('then')).toBeNull();
    expect(formatOffset(-110)).toBe('-00:01:50');
    // The relative order is usable before anybody has dated the shot, which is the whole
    // reason the column exists.
    expect(compareByRole(role, '-00:01:50', '00:04:04')).toBe(-1);
    expect(offsetMoment('2026-01-03T01:57:00Z', -110)).toBe('2026-01-03T01:55:10Z');
    expect(offsetMoment('', -110)).toBeNull();
  });

  it('reads a picture column as the address its cells hold', () => {
    const role = normalizeRole({ kind: 'picture' });
    expect(role).toEqual({ kind: 'picture' });
    expect(pictureUrl('https://example.org/a.jpg')).toBe('https://example.org/a.jpg');
    expect(pictureUrl('shot at https://example.org/a.jpg.')).toBe('https://example.org/a.jpg');
    // A path off somebody else's disk is elsewhere, not wrong: nothing is drawn for it.
    expect(pictureUrl('C:\\photos\\a.jpg')).toBeNull();
    expect(readsCell(role, 'to be found')).toBe(false);
    expect(readsCell(role, '')).toBe(true);
  });

  it('reads a picture column as a file this case holds, as well as an address', () => {
    // A geolocation index is worked on the images the case already holds, and a column
    // that only understood `http` could draw a stranger's photo and not the case's own.
    expect(picturePath('media/quai-sud.jpg')).toBe('media/quai-sud.jpg');
    expect(pictureRef('media/quai-sud.jpg')).toEqual({ kind: 'case', value: 'media/quai-sud.jpg' });
    expect(pictureRef('https://a.org/1.jpg')).toEqual({
      kind: 'url',
      value: 'https://a.org/1.jpg',
    });
    expect(pictureRef('to be found')).toBeNull();
  });

  it('refuses a path that names a disk this case does not travel with', () => {
    // The cell is text a collaborator reads in a spreadsheet, and `media/quai-sud.jpg` is
    // the only spelling that means the same thing to them as to the app.
    expect(picturePath('/home/someone/a.jpg')).toBeNull();
    expect(picturePath('C:\\photos\\a.jpg')).toBeNull();
    expect(picturePath('media/../../etc/passwd.jpg')).toBeNull();
    expect(picturePath('media/notes.txt')).toBeNull();
    expect(picturePath('')).toBeNull();
  });

  it('says how many columns a counting column counts, for the heading to state once', () => {
    // The denominator is said in the heading and the panel; the cells hold the bare
    // number, because repeating it down four hundred rows is four hundred copies of one
    // fact in cells thirty pixels tall.
    expect(countedOf({ kind: 'computed', of: 'filled_of', columns: ['a', 'b'] })).toBe(2);
    expect(countedOf({ kind: 'computed', of: 'has_point' })).toBe(0);
    expect(countedOf(null)).toBe(0);
  });

  it('suggests a picture off the extension, never off "it is a link"', () => {
    expect(detectRole(['https://a.org/1.jpg', 'https://a.org/2.png'])).toBe('picture');
    expect(detectRole(['https://t.me/c/1', 'https://t.me/c/2'])).not.toBe('picture');
  });

  it('gives a state column the default vocabulary when it has none', () => {
    expect(normalizeRole({ kind: 'state' }).values).toEqual(STATE_DEFAULTS);
  });

  it('paints those four defaults, because a worklist is read at a glance', () => {
    const role = normalizeRole({ kind: 'state' });
    expect(role.colours).toEqual({
      'to do': 'grey',
      'in progress': 'blue',
      'done': 'green',
      'ruled out': 'red',
    });
    expect(STATE_COLOURS).toEqual(role.colours);
    // Every one of them from the palette a row is painted with, so a chip and a row read
    // in the same six colours.
    for (const colour of Object.values(STATE_COLOURS)) expect(ROW_COLOURS).toContain(colour);
  });

  it('lets the column change one of those colours and remove another', () => {
    // The defaults sit under what the role says, value by value. Removing a `#colour`
    // from a line has to stick, or the analyst could never un-paint a value.
    const role = normalizeRole({
      kind: 'state',
      values: [...STATE_DEFAULTS],
      colours: { 'to do': 'orange', 'in progress': 'blue' },
    });
    expect(role.colours).toEqual({ 'to do': 'orange', 'in progress': 'blue' });
  });

  it('does not paint a vocabulary the column brought itself', () => {
    // An imported binder's own words are the vocabulary. `done` among them means what the
    // binder meant, and a colour the app chose for it would be the app reading the case.
    const role = normalizeRole({ kind: 'state', values: ['pass', 'done', 'OK en cours'] });
    expect(role.colours).toEqual({});
  });

  it('keeps a state vocabulary in the order it was given, because that is the ranking', () => {
    const role = normalizeRole({ kind: 'state', values: ['seen', 'geolocated', 'ruled out'] });
    expect(role.values).toEqual(['seen', 'geolocated', 'ruled out']);
  });

  it('drops the fields a kind does not use', () => {
    // A column that was a choice and became a when would otherwise keep a vocabulary
    // nobody reads, and the next reader could not tell which of the two it is.
    const role = normalizeRole({ kind: 'when', values: ['a', 'b'], multi: ', ' });
    expect(role).toEqual({ kind: 'when', shape: 'date', dayFirst: true });
  });

  it('defaults a slash date to day first, because guessing reverses twelve days a month', () => {
    expect(normalizeRole({ kind: 'when' }).dayFirst).toBe(true);
    expect(normalizeRole({ kind: 'when', dayFirst: false }).dayFirst).toBe(false);
  });

  it('pins a computed column to a nature it knows', () => {
    expect(normalizeRole({ kind: 'computed' }).of).toBe('has_point');
    expect(normalizeRole({ kind: 'computed', of: 'invented' }).of).toBe('has_point');
    // The order is the contract: the server falls back to the first of them.
    expect(COMPUTED_NATURES).toEqual([
      'has_point',
      'filled_of',
      'yes_of',
      'point',
      'relations',
    ]);
    expect(COUNTING_NATURES).toEqual(['filled_of', 'yes_of']);
    expect(LINKED_NATURES).toEqual(['point', 'relations']);
  });

  it('makes a linked nature name the column whose link it follows', () => {
    // A sheet can point at the case from a subject column and a place column both, so
    // "whatever this row points at" would answer about whichever came first.
    expect(normalizeRole({ kind: 'computed', of: 'point', from: 'Subject' })).toEqual({
      kind: 'computed',
      of: 'point',
      from: 'Subject',
    });
    expect(normalizeRole({ kind: 'computed', of: 'point' }).from).toBeNull();
    // A list of relations is written with a separator, so the column reads as chips the
    // way any other multi-valued column does.
    expect(normalizeRole({ kind: 'computed', of: 'relations', from: 'Unit' }).multi).toBe(', ');
    // And a counting nature keeps none of that: the fields a kind does not use go.
    expect(normalizeRole({ kind: 'computed', of: 'yes_of', from: 'Unit' }).from).toBeUndefined();
  });

  it('keeps only the columns a counting nature actually counts', () => {
    // The columns are named in the role, so a column dropped in a spreadsheet must not
    // leave the score counting something that is not there.
    const role = normalizeRole({ kind: 'computed', of: 'filled_of', columns: ['a', 'a', 'b', ''] });
    expect(role.columns).toEqual(['a', 'b']);
    // And a nature that counts nothing is not a nature that counts every column.
    expect(normalizeRole({ kind: 'computed', of: 'yes_of' }).columns).toEqual([]);
    // The one that walks the graph has no columns to name.
    expect(normalizeRole({ kind: 'computed', of: 'has_point' }).columns).toBeUndefined();
  });

  it('deduplicates a vocabulary rather than showing one value twice', () => {
    expect(normalizeRole({ kind: 'choice', values: ['a', 'a', 'b'] }).values).toEqual(['a', 'b']);
  });

});

describe('a column with two answers', () => {
  it('starts on the words the binders write, yes first', () => {
    // Yes first because that order is the ranking the sort reads, and because `computed`
    // writes the same pair — one column of YES/NO in the file either way.
    expect(normalizeRole({ kind: 'boolean' }).values).toEqual(BOOLEAN_DEFAULTS);
    expect(BOOLEAN_DEFAULTS).toEqual(['YES', 'NO']);
  });

  it('takes the column own two words', () => {
    expect(normalizeRole({ kind: 'boolean', values: ['oui', 'non'] }).values).toEqual([
      'oui',
      'non',
    ]);
  });

  it('holds exactly two, because one click has to be a toggle', () => {
    const three = normalizeRole({ kind: 'boolean', values: ['a', 'b', 'c'] });
    expect(three.values).toEqual(['a', 'b']);
    expect(normalizeRole({ kind: 'boolean', values: ['only'] }).values).toEqual(['only', 'NO']);
  });

  it('flips to the other word, and answers anything else with the first', () => {
    const role = normalizeRole({ kind: 'boolean' });
    expect(flipBoolean(role, 'YES')).toBe('NO');
    expect(flipBoolean(role, 'NO')).toBe('YES');
    expect(flipBoolean(role, '')).toBe('YES');
    expect(flipBoolean(role, 'maybe')).toBe('YES');
  });

  it('sorts what is true above what is not', () => {
    const role = normalizeRole({ kind: 'boolean' });
    expect(compareByRole(role, 'YES', 'NO')).toBe(-1);
  });

  it('can be drawn as a tick box without becoming another kind of column', () => {
    // A drawing choice and nothing more: the file holds the same two words, so the CSV
    // a collaborator opens reads the same whether the grid drew chips or boxes.
    const role = normalizeRole({ kind: 'boolean', values: ['oui', 'non'], tick: true });
    expect(role.kind).toBe('boolean');
    expect(role.tick).toBe(true);
    expect(role.values).toEqual(['oui', 'non']);
    expect(normalizeRole({ kind: 'boolean' }).tick).toBe(false);
  });

  it('cycles a box through three states, because it is drawn on an empty cell too', () => {
    // Two states would make "nobody has been through this row" and "no" identical, and
    // leave no way back to the first.
    const role = normalizeRole({ kind: 'boolean', tick: true });
    expect(cycleTick(role, '')).toBe('YES');
    expect(cycleTick(role, 'YES')).toBe('NO');
    expect(cycleTick(role, 'NO')).toBe('');
    // A word the pair does not hold is settled by clicking it, as a flip is.
    expect(cycleTick(role, 'maybe')).toBe('YES');
  });

  it('names the three states a box draws, plus the word it cannot read', () => {
    const role = normalizeRole({ kind: 'boolean', values: ['oui', 'non'], tick: true });
    expect(tickState(role, 'oui')).toBe('yes');
    expect(tickState(role, 'non')).toBe('no');
    expect(tickState(role, '  ')).toBe('blank');
    expect(tickState(role, 'peut-être')).toBe('other');
  });

  it('is guessed only when both words are a yes or a no', () => {
    expect(detectRole(['YES', 'NO', 'YES', 'NO'])).toBe('boolean');
    expect(detectRole(['true', 'false', 'true', 'false'])).toBe('boolean');
    expect(detectRole(['oui', 'non', 'oui', 'non'])).toBe('boolean');
    // Two arbitrary words are a set of values, not a question with two answers.
    expect(detectRole(['VID', 'PIC', 'VID', 'PIC'])).toBe('choice');
  });
});

describe('a column of numbers', () => {
  it('reads what a European export writes', () => {
    expect(parseNumber('1 200')).toBe(1200);
    expect(parseNumber("1'200")).toBe(1200);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('42%')).toBe(42);
  });

  it('reads an estimate, because an estimate is still a number', () => {
    expect(parseNumber('~9')).toBe(9);
    expect(parseNumber('>100')).toBe(100);
  });

  it('refuses a digit buried in prose', () => {
    // `Only 9 in service?` is a real cell. Extracting the 9 would also turn `AB-123` into
    // 123, and a total built on that is a total nobody can check.
    expect(parseNumber('Only 9 in service?')).toBeNull();
    expect(parseNumber('AB-123')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('-')).toBeNull();
  });

  it('totals the rows it is given, which is what is on screen', () => {
    const table = {
      columns: ['id', 'Count'],
      rows: [['r1', '3'], ['r2', '1 200'], ['r3', 'Only 9 in service?'], ['r4', '-5']],
    };
    expect(numberTotals(table, 1, [0, 1, 2, 3])).toEqual({
      count: 3,
      // `Only 9 in service?` is filled and unread, which is what the badge and the
      // "to check" filter are made of: a total over three of four cells says so.
      unreadable: 1,
      sum: 1198,
      mean: 399.333333,
      min: -5,
      max: 1200,
    });
    // Filtered to one row, the answer is about that row.
    expect(numberTotals(table, 1, [0])).toEqual({
      count: 1, unreadable: 0, sum: 3, mean: 3, min: 3, max: 3,
    });
    expect(numberTotals(table, 1, [2])).toEqual({
      count: 0, unreadable: 1, sum: 0, mean: null, min: null, max: null,
    });
  });

  it('keeps a footer free of floating-point noise', () => {
    const table = { columns: ['id', 'n'], rows: [['r1', '0.1'], ['r2', '0.2']] };
    expect(numberTotals(table, 1, [0, 1]).sum).toBe(0.3);
  });

  it('sorts by the number, and sends what it cannot read to the end', () => {
    const role = normalizeRole({ kind: 'number' });
    expect(compareByRole(role, '9', '10')).toBe(-1);
    expect(compareByRole(role, '1 200', '9')).toBe(1);
    expect(compareByRole(role, '9', 'Only 9 in service?')).toBe(-1);
    expect(compareByRole(role, 'a', 'b')).toBeNull();
  });
});

describe('a colour on a value', () => {
  it('keeps a value that merely contains a hash', () => {
    // `#REF!` is what a binder's own broken formula leaves behind, and it is in this
    // repo's fixtures. The colour is picked from a palette rather than typed at the end
    // of the word, so nothing has to guess where the value stops.
    const role = normalizeRole({ kind: 'choice', values: ['#REF!'], colours: { '#REF!': 'grey' } });
    expect(role.values).toEqual(['#REF!']);
    expect(role.colours).toEqual({ '#REF!': 'grey' });
  });

  it('drops a colour whose value or name it does not know', () => {
    const role = normalizeRole({
      kind: 'state',
      values: ['done'],
      colours: { done: 'green', gone: 'red', gone2: 'chartreuse' },
    });
    expect(role.colours).toEqual({ done: 'green' });
  });

  it('hands a chip the colour of its value', () => {
    const role = normalizeRole({ kind: 'state', values: ['done'], colours: { done: 'green' } });
    expect(cellChips('done', role)[0].colour).toBe('green');
    expect(cellChips('pass', role)[0].colour).toBeNull();
  });

  it('paints the same palette a row is painted with', () => {
    // One colour language in the app: a third list would be the one that goes wrong.
    expect(ROW_COLOURS).toEqual(['red', 'orange', 'yellow', 'green', 'blue', 'grey']);
  });
});

describe('guessing what a column holds', () => {
  it('recognises a column of points', () => {
    expect(detectRole(['48.85, 2.35', '50.10, 3.00', '-33.87, 151.21'])).toBe('latlon');
  });

  it('recognises one through the gaps, because a binder is half-finished', () => {
    // A coordinates column with `To be found` in a third of its rows is still a
    // coordinates column, and refusing to see that is refusing the real file.
    expect(detectRole(['48.85, 2.35', '50.10, 3.00', 'To be found'])).toBe('latlon');
  });

  it('recognises a column of dates', () => {
    expect(detectRole(['03/01/2026', '14/02/2026', '?'])).toBe('when');
  });

  it('recognises a small closed set of answers', () => {
    expect(detectRole(['VID', 'PIC', 'VID', 'SAT', 'VID', 'PIC'])).toBe('choice');
  });

  it('never guesses a state, because that is a judgement and not a shape', () => {
    // Whether `pass` means done or means skipped is a fact about the investigation.
    expect(detectRole(['to do', 'done', 'pass', 'to do', 'done', 'pass'])).toBe('choice');
  });

  it('guesses nothing about prose, or about one cell', () => {
    expect(detectRole(['a note about the quay', 'another, longer note', 'a third one'])).toBeNull();
    expect(detectRole(['48.85, 2.35'])).toBeNull();
    expect(detectRole([])).toBeNull();
  });
});

describe('reading a point', () => {
  it('reads the decimal pair the binders write four hundred times', () => {
    expect(parseLatLon('48.8566, 2.3522')).toMatchObject({ lat: 48.8566, lon: 2.3522 });
    expect(parseLatLon('48.8566,2.3522')).toMatchObject({ lat: 48.8566, lon: 2.3522 });
    expect(parseLatLon(' 48.8566 2.3522 ')).toMatchObject({ lat: 48.8566, lon: 2.3522 });
    expect(parseLatLon('-33.87, 151.21')).toMatchObject({ lat: -33.87, lon: 151.21 });
  });

  it('reads hemispheres as signs', () => {
    expect(parseLatLon('33.87S, 151.21E')).toMatchObject({ lat: -33.87, lon: 151.21 });
    expect(parseLatLon('40.71N, 74.01W')).toMatchObject({ lat: 40.71, lon: -74.01 });
  });

  it('reads degrees, minutes and seconds', () => {
    const point = parseLatLon(`48°51'24"N 2°21'08"E`);
    expect(point.lat).toBeCloseTo(48.8567, 3);
    expect(point.lon).toBeCloseTo(2.3522, 3);
  });

  it('reads a comma decimal, which a European export writes', () => {
    expect(parseLatLon('48,8566; 2,3522')).toMatchObject({ lat: 48.8566, lon: 2.3522 });
    expect(parseLatLon('48,8566 2,3522')).toMatchObject({ lat: 48.8566, lon: 2.3522 });
  });

  it('reads a bare comma as the decimal mark rather than as a pair', () => {
    // `48,8` is one number in the convention the whole app reads, so it is not a point.
    // The comma separates two coordinates only where it cannot be decimal: a space after
    // it, a hemisphere letter, or a full stop already doing the job.
    expect(parseLatLon('48,8')).toBeNull();
    expect(parseLatLon('-1,5')).toBeNull();
    expect(parseLatLon('48, 8')).toMatchObject({ lat: 48, lon: 8 });
    expect(parseLatLon('48.5,2.3')).toMatchObject({ lat: 48.5, lon: 2.3 });
    expect(parseLatLon('48,8N 2,3E')).toMatchObject({ lat: 48.8, lon: 2.3 });
  });

  it('refuses what is not a point, without complaining', () => {
    // `To be found` is on every page of the real binders. A role that threw here would
    // refuse the work.
    expect(parseLatLon('To be found')).toBeNull();
    expect(parseLatLon('-')).toBeNull();
    expect(parseLatLon('')).toBeNull();
    expect(parseLatLon('48.8566')).toBeNull();
  });

  it('reports how precisely the cell was written', () => {
    expect(parseLatLon('48.85, 2.35').decimals).toBe(2);
    expect(parseLatLon('48.8566, 2.3').decimals).toBe(1);
    expect(precisionMetres(2)).toBe(1113); // about a kilometre
    expect(precisionMetres(5)).toBe(1);
  });

  it('reports a transposed pair rather than refusing it', () => {
    // Latitude 151 is a finding about the file, not a parse failure.
    expect(parseLatLon('151.21, 33.87').outOfBounds).toBe(true);
    expect(parseLatLon('48.85, 2.35').outOfBounds).toBe(false);
  });

  it('writes a point back as one canonical form', () => {
    expect(formatLatLon(parseLatLon(`48°51'24"N 2°21'08"E`))).toBe('48.85667, 2.35222');
    expect(formatLatLon(null)).toBe('');
  });

  it('measures the ground between two points', () => {
    // A hundred metres north, near the equator.
    expect(distanceMetres({ lat: 0, lon: 0 }, { lat: 0.0008993, lon: 0 })).toBe(100);
    expect(distanceMetres({ lat: 48.8566, lon: 2.3522 }, { lat: 48.8566, lon: 2.3522 })).toBe(0);
  });
});

describe('reading a moment', () => {
  it('reads the European slash date the binders use', () => {
    expect(parseWhen('03/01/2026').text).toBe('2026-01-03');
    expect(parseWhen('3/1/26').text).toBe('2026-01-03');
  });

  it('reads a month-first column when the column says so', () => {
    expect(parseWhen('03/01/2026', { dayFirst: false }).text).toBe('2026-03-01');
  });

  it('reads a four-digit lead as a year whatever the convention', () => {
    expect(parseWhen('2026-01-03', { dayFirst: true }).text).toBe('2026-01-03');
  });

  it('keeps a bare clock as a time of day rather than inventing a date', () => {
    // The binder's `Local time` holds `01:57` for an event whose date is in the sheet's
    // title. Pinning it to a date would be inventing evidence.
    const read = parseWhen('01:57');
    expect(read.shape).toBe('time');
    expect(read.key).toBe(1 * 3600 + 57 * 60);
    expect(read.text).toBe('01:57');
  });

  it('reads the full form an email header carries', () => {
    expect(parseWhen('Sat, 03 Jan 2026 06:42:02 GMT').text).toBe('2026-01-03T06:42');
  });

  it('reads a date with a time appended', () => {
    expect(parseWhen('03/01/2026 06:42').text).toBe('2026-01-03T06:42');
  });

  it('refuses what the binders write when they do not know', () => {
    expect(parseWhen('AFTER')).toBeNull();
    expect(parseWhen('?')).toBeNull();
    expect(parseWhen('between 2:00 and 2:10')).toBeNull();
    expect(parseWhen('32/01/2026')).toBeNull();
    expect(parseWhen('03/13/2026')).toBeNull();
    expect(parseWhen('25:00')).toBeNull();
  });

  it('refuses an hour that would roll over into the next day', () => {
    // `Date.UTC` takes 12:30:75 and keeps the day, and it takes 99:00 and moves it — so
    // both used to pass here while the server refused them, and the analyst read a message
    // about a value they never typed.
    expect(parseWhen('12:30:75')).toBeNull();
    expect(parseWhen('03/01/2026 12:30:75')).toBeNull();
    expect(parseWhen('03/01/2026 99:00')).toBeNull();
    expect(parseWhen('Sat, 03 Jan 2026 06:42:99 GMT')).toBeNull();
    expect(parseWhen('23:59:59').text).toBe('23:59');
  });
});

describe('the same cell, read by both readers', () => {
  // The parity gate the role vocabularies had and the readings did not. The other half is
  // `tests/test_sheets.py::test_both_readers_answer_the_same_thing_about_a_shared_list_of_cells`,
  // over this same file: one list of cells, one expected answer, two readers held to it.
  it('answers what the shared fixture says, cell by cell', () => {
    expect(shared.when.length && shared.point.length).toBeTruthy();
    for (const entry of shared.when) {
      const read = parseWhen(entry.cell, entry.role ?? {});
      if (entry.reads === null) {
        expect(read, entry.cell).toBeNull();
        continue;
      }
      expect(read, entry.cell).not.toBeNull();
      expect(read.shape, entry.cell).toBe(entry.reads.shape);
      expect(read.text, entry.cell).toBe(entry.reads.text);
    }
    for (const entry of shared.point) {
      const point = parseLatLon(entry.cell);
      if (entry.reads === null) {
        expect(point, entry.cell).toBeNull();
        continue;
      }
      expect(point, entry.cell).not.toBeNull();
      expect(point.lat).toBeCloseTo(entry.reads.lat, 6);
      expect(point.lon).toBeCloseTo(entry.reads.lon, 6);
      expect(point.decimals, entry.cell).toBe(entry.reads.decimals);
    }
  });
});

describe('a moment chosen from a picker', () => {
  it('reads which way round the column already writes them', () => {
    // Read from the column and not declared: a picker that wrote `2026-01-31` into a
    // column of `31/01/2026` would restyle the file from a click.
    expect(dateSpelling(['31/01/2026', '14/02/2026'])).toBe('slash');
    expect(dateSpelling(['2026-01-31', '2026-02-14'])).toBe('iso');
    expect(dateSpelling(['AFTER', '?'])).toBe('slash', 'ties go to what the binders use');
  });

  it('reads which of the three shapes the column holds', () => {
    // The role is called "a date or a time" because the binders write all three. Offering
    // a calendar on a column of bare clocks would offer to put a date where the analyst
    // deliberately did not.
    expect(whenShape(['31/01/2026', '14/02/2026'])).toBe('date');
    expect(whenShape(['01:57', '02:10'])).toBe('time');
    expect(whenShape(['03/01/2026 06:42', '04/01/2026 07:15'])).toBe('datetime');
    expect(whenShape(['AFTER', '?'])).toBe('date');
  });

  it('picks each shape with the input made for it', () => {
    expect(pickerType('date')).toBe('date');
    expect(pickerType('time')).toBe('time');
    expect(pickerType('datetime')).toBe('datetime-local');
  });

  it('spells the picked moment the way the column does', () => {
    expect(spellWhen('2026-03-04', { spelling: 'slash' })).toBe('04/03/2026');
    expect(spellWhen('2026-03-04', { spelling: 'iso' })).toBe('2026-03-04');
    expect(spellWhen('', {})).toBe('');
  });

  it('spells a time on its own, and a moment with its hour', () => {
    expect(spellWhen('01:57', { shape: 'time' })).toBe('01:57');
    expect(spellWhen('2026-03-04T06:42', { shape: 'datetime', spelling: 'slash' }))
      .toBe('04/03/2026 06:42');
  });

  it('keeps an hour the cell already established on a date-only column', () => {
    // `03/01/2026 06:42` is a moment somebody worked out; a date picker has no business
    // dropping the hour from it.
    expect(spellWhen('2026-03-04', { spelling: 'slash', keep: '03/01/2026 06:42' }))
      .toBe('04/03/2026 06:42');
    expect(spellWhen('2026-03-04', { spelling: 'slash', keep: '03/01/2026' })).toBe('04/03/2026');
  });
});

describe('a cell holding several values', () => {
  const role = normalizeRole({ kind: 'choice', multi: DEFAULT_SEPARATOR, values: ['Buk-M2E'] });

  it('splits on the separator the column declares, and only then', () => {
    expect(splitValues('Buk-M2E, ZU23-2', role)).toEqual(['Buk-M2E', 'ZU23-2']);
    expect(splitValues('Buk-M2E, ZU23-2', normalizeRole({ kind: 'choice' }))).toEqual([
      'Buk-M2E, ZU23-2',
    ]);
  });

  it('reads a list as its values and nothing else', () => {
    // A quantity used to be read out of `2x S-125` here. It is gone: a count kept in a
    // column of values is a count nothing can total, and the answer is a number column
    // beside a column naming what is counted.
    const list = normalizeRole({ kind: 'choice', multi: ', ' });
    expect(cellChips('Buk-M2E, 2x S-125', list)).toEqual([
      { value: 'Buk-M2E', known: false, colour: null, raw: 'Buk-M2E' },
      { value: '2x S-125', known: false, colour: null, raw: '2x S-125' },
    ]);
  });

  it('marks a value the vocabulary does not know without hiding it', () => {
    const chips = cellChips('Buk-M2E, Mi-17V-5', role);
    expect(chips.map((chip) => chip.known)).toEqual([true, false]);
  });

  it('totals by value, one row counted once however often it says it', () => {
    const list = normalizeRole({ kind: 'choice', multi: ', ' });
    const table = {
      columns: ['id', 'Equipments'],
      rows: [
        ['r1', 'S-125, S-125'],
        ['r2', 'S-125, Buk-M2E'],
      ],
    };
    // How many rows hold it, which is what the filter hands back.
    expect(valueTotals(table, 1, list)).toEqual([
      { value: 'S-125', rows: 2 },
      { value: 'Buk-M2E', rows: 1 },
    ]);
  });
});

describe('sorting by what the column knows', () => {
  it('orders a state column by its vocabulary, not its alphabet', () => {
    const role = normalizeRole({ kind: 'state' });
    // 'in progress' before 'ruled out' by rank; alphabetically it would be the reverse
    // of nothing useful at all.
    expect(compareByRole(role, 'in progress', 'ruled out')).toBe(-1);
    expect(compareByRole(role, 'done', 'to do')).toBe(1);
    expect(compareByRole(role, 'done', 'done')).toBeNull();
  });

  it('puts a word outside the vocabulary after the ones inside it', () => {
    const role = normalizeRole({ kind: 'state' });
    expect(compareByRole(role, 'OK en cours', 'ruled out')).toBe(1);
  });

  it('orders a date column by the date, which is the whole point of the role', () => {
    // Without the role this is text: `01/02/2026` sorts before `31/01/2026`.
    const role = normalizeRole({ kind: 'when' });
    expect(compareByRole(role, '31/01/2026', '01/02/2026')).toBe(-1);
  });

  it('sends the cells a date column cannot read to the end', () => {
    const role = normalizeRole({ kind: 'when' });
    expect(compareByRole(role, '31/01/2026', 'AFTER')).toBe(-1);
    expect(compareByRole(role, 'AFTER', '31/01/2026')).toBe(1);
    expect(compareByRole(role, 'AFTER', '?')).toBeNull();
  });

  it('keeps dates and bare clocks apart, because they are different scales', () => {
    const role = normalizeRole({ kind: 'when' });
    expect(compareByRole(role, '03/01/2026', '01:57')).toBe(-1);
    expect(compareByRole(role, '01:57', '02:10')).toBe(-1);
  });

  it('orders points north to south, so one area reads together', () => {
    const role = normalizeRole({ kind: 'latlon' });
    expect(compareByRole(role, '50.1, 3.0', '48.8, 2.3')).toBe(-1);
    expect(compareByRole(role, '48.8, 2.3', '48.8, 4.0')).toBe(-1);
  });

  it('says nothing about a column of values, which sorts as the words it holds', () => {
    expect(compareByRole(normalizeRole({ kind: 'choice', multi: ', ' }), 'A, B', 'C')).toBeNull();
  });

  it('says nothing when it has nothing to say, so the caller falls back to words', () => {
    expect(compareByRole(null, 'a', 'b')).toBeNull();
    expect(compareByRole({ kind: 'stamped' }, 'a', 'b')).toBeNull();
    expect(compareByRole(normalizeRole({ kind: 'choice' }), 'a', 'b')).toBeNull();
  });
});

describe('how much is left', () => {
  // The 468-row geolocation index: a date, a title, a country, coordinates, a link.
  // No status column anywhere, and its question is how many are left to geolocate.
  const index = () => ({
    columns: ['id', 'Title', 'Coordinates'],
    rows: [
      ['r1', 'Quai sud', '48.85, 2.35'],
      ['r2', 'Pont nord', ''],
      ['r3', 'Gare est', '   '],
      ['r4', 'Dépôt', '50.10, 3.00'],
    ],
  });

  it('reads a fill rate off any column, with no role at all', () => {
    expect(columnProgress(index(), 2, null)).toEqual({
      kind: 'fill',
      total: 4,
      filled: 2,
      empty: 2,
    });
  });

  it('counts whitespace as empty, the way the analyst reads it', () => {
    expect(columnProgress(index(), 2, null).empty).toBe(2);
  });

  it('reads a state column as its buckets, in vocabulary order', () => {
    const table = {
      columns: ['id', 'Status'],
      rows: [['r1', 'done'], ['r2', 'done'], ['r3', 'to do'], ['r4', ''], ['r5', 'pass']],
    };
    expect(columnProgress(table, 1, normalizeRole({ kind: 'state' }))).toEqual({
      kind: 'state',
      total: 5,
      empty: 1,
      other: 1,
      buckets: [
        { value: 'to do', count: 1 },
        { value: 'in progress', count: 0 },
        { value: 'done', count: 2 },
        { value: 'ruled out', count: 0 },
      ],
    });
  });

  it('suggests the declared status column when there is one', () => {
    const table = { columns: ['id', 'Status', 'Notes'], rows: [['r1', '', '']] };
    expect(suggestProgressColumn(table, { Status: { kind: 'state' } }, 'id')).toBe('Status');
  });

  it('otherwise suggests the emptiest column, which is the one being worked through', () => {
    expect(suggestProgressColumn(index(), {}, 'id')).toBe('Coordinates');
  });

  it('suggests nothing when there is nothing left to fill', () => {
    const full = { columns: ['id', 'Title'], rows: [['r1', 'Quai sud']] };
    expect(suggestProgressColumn(full, {}, 'id')).toBeNull();
  });

  it('never suggests the row handle', () => {
    const table = { columns: ['id', 'Title'], rows: [['', ''], ['', '']] };
    expect(suggestProgressColumn(table, {}, 'id')).toBe('Title');
  });
});

describe('what a column says twice', () => {
  const table = () => ({
    columns: ['id', 'Plate'],
    rows: [['r1', 'AB-123'], ['r2', 'ab-123'], ['r3', ''], ['r4', 'CD-456'], ['r5', 'AB-123']],
  });

  it('groups the repeats and leaves the singles out', () => {
    const groups = duplicateGroups(table(), 1, null);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toEqual([0, 1, 4]);
  });

  it('reads a difference of case as the same value', () => {
    expect(duplicateGroups(table(), 1, null)[0].value).toBe('AB-123');
  });

  it('does not call four hundred empty cells a duplicate', () => {
    const empty = { columns: ['id', 'Coordinates'], rows: [['r1', ''], ['r2', ''], ['r3', '']] };
    expect(duplicateGroups(empty, 1, null)).toEqual([]);
  });

  it('finds a value repeated inside a multi-value column', () => {
    const role = normalizeRole({ kind: 'choice', multi: ', ' });
    const lists = {
      columns: ['id', 'Equipments'],
      rows: [['r1', 'Buk-M2E, ZU23-2'], ['r2', 'S-125, Buk-M2E']],
    };
    expect(duplicateGroups(lists, 1, role)[0]).toMatchObject({ value: 'Buk-M2E', rows: [0, 1] });
  });
});

describe('points that sit too close to be two places', () => {
  it('finds the pair and says how far apart it is', () => {
    const table = {
      columns: ['id', 'Coordinates'],
      rows: [
        ['r1', '48.85660, 2.35220'],
        ['r2', '48.85670, 2.35230'],
        ['r3', '50.10000, 3.00000'],
      ],
    };
    const { pairs, capped } = nearbyPairs(table, 1, 200);
    expect(capped).toBe(false);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].rows).toEqual([0, 1]);
    expect(pairs[0].metres).toBeLessThan(20);
  });

  it('finds a pair that straddles a bucket edge', () => {
    // The reason the sweep looks at the eight neighbouring cells: two points ten metres
    // apart can fall either side of a boundary, and a single-cell sweep would miss them.
    const table = {
      columns: ['id', 'Coordinates'],
      rows: [['r1', '48.8500000, 2.3500000'], ['r2', '48.8500899, 2.3500000']],
    };
    expect(nearbyPairs(table, 1, 20).pairs).toHaveLength(1);
  });

  it('ignores what it cannot read and what cannot be true', () => {
    const table = {
      columns: ['id', 'Coordinates'],
      rows: [['r1', 'To be found'], ['r2', '151.2, 33.8'], ['r3', '48.85, 2.35']],
    };
    expect(nearbyPairs(table, 1, 500).pairs).toEqual([]);
  });

  it('stays linear on a sheet at the row bound instead of freezing the tab', () => {
    // Twenty thousand rows compared pair by pair is two hundred million comparisons.
    // Bucketed, this is one pass, and the assertion is that it returns at all.
    const rows = Array.from({ length: 20_000 }, (_, index) => [
      `r${index}`,
      `${(index % 900) / 10 + 1}, ${(index % 700) / 10 + 1}`,
    ]);
    const { pairs, capped } = nearbyPairs({ columns: ['id', 'Coordinates'], rows }, 1, 50);
    expect(capped).toBe(true);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it('says when the list was cut rather than reading as complete', () => {
    const rows = Array.from({ length: 60 }, (_, index) => [`r${index}`, '48.85000, 2.35000']);
    const { pairs, capped } = nearbyPairs({ columns: ['id', 'Coordinates'], rows }, 1, 100, {
      cap: 10,
    });
    expect(pairs).toHaveLength(10);
    expect(capped).toBe(true);
  });
});

describe('a column vocabulary the analyst edits', () => {
  const role = normalizeRole({
    kind: 'state',
    values: ['to do', 'in progress', 'done'],
    colours: { done: 'green' },
  });

  it('moves a value, because the order is the ranking the sort reads', () => {
    const moved = editVocabulary(role, { value: 'done', at: 2, to: 0 });
    expect(moved.values).toEqual(['done', 'to do', 'in progress']);
    expect(moved.colours).toEqual({ done: 'green' });
  });

  it('adds a value it has never heard of, and refuses one it has', () => {
    expect(editVocabulary(role, { value: 'ruled out' }).values).toContain('ruled out');
    expect(editVocabulary(role, { value: 'done' }).values).toHaveLength(3);
  });

  it('carries a colour through a rename, because the colour belongs to the answer', () => {
    const renamed = editVocabulary(role, { value: 'settled', at: 2 });
    expect(renamed.values).toEqual(['to do', 'in progress', 'settled']);
    expect(renamed.colours).toEqual({ settled: 'green' });
  });

  it('drops a value and the colour hanging on it', () => {
    const dropped = editVocabulary(role, { value: 'done', at: 2, to: -1 });
    expect(dropped.values).toEqual(['to do', 'in progress']);
    expect(dropped.colours).toEqual({});
  });

  it('paints and unpaints one value, refusing a colour off the palette', () => {
    expect(editVocabulary(role, { value: 'to do', at: 0, colour: 'red' }).colours['to do']).toBe('red');
    expect(editVocabulary(role, { value: 'done', at: 2, colour: null }).colours).toEqual({});
    expect(editVocabulary(role, { value: 'to do', at: 0, colour: 'chartreuse' }).colours['to do'])
      .toBeUndefined();
  });

  it('sorts only when asked, in both directions', () => {
    // Never on its own: `to do → in progress → done` is the order of the work, and an
    // editor that alphabetised it would have put `done` first.
    expect(sortVocabulary(role).values).toEqual(['done', 'in progress', 'to do']);
    expect(sortVocabulary(role, { desc: true }).values).toEqual(['to do', 'in progress', 'done']);
  });

  it('says which values are used, which are not, and which words sit outside', () => {
    const table = {
      columns: ['id', 'Status'],
      rows: [['r1', 'done'], ['r2', 'done'], ['r3', 'OK en cours'], ['r4', '']],
    };
    const use = vocabularyUse(table, 1, role);
    expect(use.counts).toEqual({ 'to do': 0, 'in progress': 0, done: 2 });
    expect(use.unused).toEqual(['to do', 'in progress']);
    expect(use.outside.map((entry) => entry.value)).toEqual(['OK en cours']);
  });
});

describe('the cells a lens cannot read', () => {
  it('reads an empty cell, because blank is unknown rather than wrong', () => {
    expect(readsCell({ kind: 'number' }, '')).toBe(true);
    expect(readsCell({ kind: 'number' }, '   ')).toBe(true);
  });

  it('answers per kind, and calls a point off the globe unreadable', () => {
    expect(readsCell({ kind: 'number' }, '1 200')).toBe(true);
    expect(readsCell({ kind: 'number' }, 'about 12')).toBe(false);
    expect(readsCell({ kind: 'latlon' }, '48.85, 2.35')).toBe(true);
    expect(readsCell({ kind: 'latlon' }, '148.85, 2.35')).toBe(false);
    expect(readsCell({ kind: 'when', dayFirst: true }, '31/01/2026')).toBe(true);
    expect(readsCell({ kind: 'when', dayFirst: true }, 'AFTER')).toBe(false);
  });

  it('calls a value outside a vocabulary unreadable, which is what "to check" means', () => {
    const role = normalizeRole({ kind: 'choice', multi: ', ', values: ['a', 'b'] });
    expect(readsCell(role, 'a, b')).toBe(true);
    expect(readsCell(role, 'a, zzz')).toBe(false);
  });

  it('counts what a column reads against what it holds', () => {
    const table = {
      columns: ['id', 'Count'],
      rows: [['r1', '3'], ['r2', 'about 12'], ['r3', '']],
    };
    expect(readable(table, 1, { kind: 'number' })).toEqual({ total: 2, read: 1, unreadable: 1 });
  });
});

describe('a number column that says how it is written', () => {
  it('keeps a unit, where it is written and which answer the footer gives', () => {
    const role = normalizeRole({ kind: 'number', unit: ' % ', summary: 'mean', unitInCells: 1 });
    expect(role).toEqual({ kind: 'number', unit: '%', unitInCells: true, summary: 'mean' });
  });

  it('leaves the unit to the heading unless the column asked for it in the cells', () => {
    expect(normalizeRole({ kind: 'number', unit: 'km' }).unitInCells).toBe(false);
  });

  it('falls back to a total, which is what a column of counts wants', () => {
    expect(normalizeRole({ kind: 'number' }).summary).toBe('sum');
    expect(normalizeRole({ kind: 'number', summary: 'invented' }).summary).toBe('sum');
  });
});


describe('what a cell is worth to a sort, read once', () => {
  it('says nothing for a role that does not order anything', () => {
    expect(sortsByRole(normalizeRole({ kind: 'choice', multi: ', ' }))).toBe(false);
    expect(sortsByRole(null)).toBe(false);
    expect(sortsByRole(normalizeRole({ kind: 'when' }))).toBe(true);
    expect(sortsByRole(normalizeRole({ kind: 'state', values: ['a'] }))).toBe(true);
  });

  it('orders by the key alone, the way the comparator then does', () => {
    const role = normalizeRole({ kind: 'when' });
    const keys = ['31/01/2026', '01/02/2026', 'AFTER'].map((cell) => sortKey(role, cell));

    expect(compareSortKeys(keys[0], keys[1])).toBe(-1);
    // A cell the role cannot read sorts after the ones it can.
    expect(compareSortKeys(keys[0], keys[2])).toBe(-1);
    expect(compareSortKeys(keys[2], keys[0])).toBe(1);
    // Two it cannot read do not settle it, so the caller compares the words.
    expect(compareSortKeys(keys[2], sortKey(role, '?'))).toBeNull();
  });

  it('reads a cell once where the comparator read it on every comparison', () => {
    // The point of the whole shape: n reads rather than 2·n·log n of them.
    const role = normalizeRole({ kind: 'when' });
    let reads = 0;
    const cells = Array.from({ length: 64 }, (_, at) => `0${(at % 9) + 1}/01/2026`);
    const keys = cells.map((cell) => {
      reads += 1;
      return sortKey(role, cell);
    });
    const order = keys.map((_, at) => at).sort((a, b) => compareSortKeys(keys[a], keys[b]) ?? a - b);

    expect(reads).toBe(cells.length);
    expect(order.length).toBe(cells.length);
  });
});
