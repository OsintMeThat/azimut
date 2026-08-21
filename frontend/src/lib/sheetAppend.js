/**
 * Adding a batch of rows to the sheet that is already open.
 *
 * Import filed a **new sheet**, always. That is right the first time and wrong every time
 * after it: the daily batch of links, the second export from the same tool, the forty rows
 * a colleague sent — all of them belong in the worklist that already carries the statuses,
 * the roles and the colours. The only ways out were to paste into a selection, which needs
 * the columns to already line up, or to keep twelve sheets nobody compares.
 *
 * So an incoming table is **mapped** onto this sheet's columns and appended. The mapping is
 * proposed by name and then the analyst's; a column left unmapped is dropped, and it says
 * how many. Nothing here parses CSV — `POST /sheets/parse` does, because there is one CSV
 * parser in this app and it is in Python.
 *
 * Pure: tables in, a table out. The append is an ordinary structural edit, so it undoes
 * like anything else and the ordinary save writes it.
 */

import { ID_COLUMN, keyIndex, newKey } from './sheet.js';

function fold(name) {
  return String(name ?? '').trim().toLowerCase();
}

/**
 * A first mapping of incoming columns onto the ones this sheet has.
 *
 * Exact name first, then the same name in another casing — `Source` and `source` are the
 * same column in every export anybody actually sends. Nothing is guessed beyond that: a
 * `Place` mapped onto `City` because both look geographic is a silent mistake in a column
 * of evidence.
 *
 * The key column is never a target: rows arriving from elsewhere are keyed here, and
 * writing somebody else's identifier into it would hang this sheet's colours on a stranger.
 */
export function guessMapping(incoming, columns) {
  const byFold = new Map(
    (columns ?? [])
      .filter((name) => fold(name) !== ID_COLUMN)
      .map((name) => [fold(name), name]),
  );
  const mapping = {};
  for (const name of incoming ?? []) {
    if (fold(name) === ID_COLUMN) continue;
    mapping[name] = byFold.get(fold(name)) ?? '';
  }
  return mapping;
}

/** How much of the incoming table the mapping actually carries. What the dialog says
 *  before the press, because "40 rows added" over silently dropped columns is the kind of
 *  import an analyst finds out about a week later. */
export function mappingSummary(incoming, mapping) {
  const taken = (incoming ?? []).filter((name) => mapping?.[name]);
  return {
    taken: taken.length,
    dropped: (incoming ?? []).filter((name) => fold(name) !== ID_COLUMN && !mapping?.[name]),
  };
}

/**
 * The sheet with the incoming rows appended, each keyed anew.
 *
 * A row that arrives blank in every mapped column is left out: an export's trailing empty
 * line should not become a row somebody has to notice and delete.
 */
export function appendRows(table, incoming, mapping) {
  const columns = table?.columns ?? [];
  const at = keyIndex(columns);
  // Where each incoming column lands, resolved once: an import of four hundred rows must
  // not look its columns up four hundred times.
  const lands = (incoming?.columns ?? [])
    .map((name, from) => ({ from, to: columns.indexOf(mapping?.[name] ?? '') }))
    .filter((pair) => pair.to !== -1 && pair.to !== at);
  if (!lands.length) return { table, added: 0 };

  const made = [];
  for (const row of incoming?.rows ?? []) {
    const cells = columns.map(() => '');
    let anything = false;
    for (const pair of lands) {
      const value = String(row?.[pair.from] ?? '');
      cells[pair.to] = value;
      if (value.trim()) anything = true;
    }
    if (!anything) continue;
    cells[at] = newKey();
    made.push(cells);
  }
  if (!made.length) return { table, added: 0 };
  return { table: { ...table, rows: [...(table.rows ?? []), ...made] }, added: made.length };
}
