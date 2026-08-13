/**
 * Reading a tally row out loud (`engine/tally.py`).
 *
 * The server does the arithmetic and this does the sentence, which is where the
 * honesty of the number actually lands: a total that prints "5" beside three
 * statements, one of which carried no number and one of which was ruled out, is a
 * true sum and a false impression. So nothing here ever prints a bare figure — the
 * count lines say what was added, and the notes say what was left out and why.
 *
 * Pure, and it takes its words from the registry rather than spelling the vocabulary
 * a second time: the condition labels come from the served `claim` field, so a
 * condition added there reads correctly here with no edit.
 */

/** The unstated bucket, as the server groups it. */
const UNSTATED = '';

/**
 * What the row's statements come to, one line per condition, in registry order.
 *
 * A bucket with no number contributes no line: two statements saying *destroyed*
 * without a count add nothing to the sum, and a line reading "0 destroyed" would say
 * the case checked and found none.
 *
 * @param {{conditions?: Array<{value: string, total: number}>}} row
 * @param {(value: string) => string} label  How the registry reads that condition.
 */
export function countLines(row, label = (value) => value) {
  return (row?.conditions ?? [])
    .filter((bucket) => bucket.total > 0)
    .map((bucket) => ({
      value: bucket.value,
      text:
        bucket.value === UNSTATED
          ? `${bucket.total} unstated`
          : `${bucket.total} ${String(label(bucket.value)).toLocaleLowerCase()}`,
    }));
}

/**
 * What the sum leaves out, in the row's own words.
 *
 * Two things can be left out and they are different: a statement that says *seen*
 * without a number, and one the analyst ruled out. Neither is a gap in the data —
 * "seen, not counted" is an answer, and eliminating a candidate is work the case
 * keeps — so both are stated rather than quietly missing.
 */
export function noteLines(row) {
  const notes = [];
  const seen = (row?.statements ?? 0) - (row?.counted ?? 0);
  if (seen > 0) notes.push(`${seen} without a number`);
  if ((row?.refuted ?? 0) > 0) notes.push(`${row.refuted} ruled out`);
  return notes;
}

/** How sure the row's statements are, worded for one line. Ruled-out ones are not
 *  here: they are in the notes, being the one level that leaves every sum. */
export function confidenceLine(row, label = (value) => value) {
  return (row?.confidence ?? [])
    .map((level) =>
      level.value
        ? `${level.statements} ${String(label(level.value)).toLocaleLowerCase()}`
        : `${level.statements} not assessed`
    )
    .join(' · ');
}

/**
 * What the whole reading stands on, and what it could not put in a row.
 *
 * The cut comes first because it changes what every number below it means: a total
 * over two thousand of three thousand statements looks whole and is not.
 */
export function readingNotes(body) {
  const notes = [];
  if (body?.truncated) {
    notes.push(`Added up ${body.read} of ${body.matched} statements`);
  }
  const loose = body?.unattributed ?? 0;
  if (loose > 0) {
    notes.push(`${loose} ${loose === 1 ? 'statement says' : 'statements say'} nothing about what it concerns`);
  }
  return notes;
}

/** Whether the reading has anything to draw at all. */
export function isEmpty(body) {
  return !(body?.rows?.length || body?.unattributed);
}
