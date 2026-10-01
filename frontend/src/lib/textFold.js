/**
 * How a search compares text: without case, and without the marks a reader skips.
 *
 * The browser half of `engine/textfold.py`. A case small enough for one page is
 * searched here, a larger one on the server, and a term must answer the same on
 * either side of that line; `tests/fixtures/fold_cases.json` holds both to one list.
 *
 * Marks go on a Latin, Greek or Cyrillic letter, Arabic harakat and the tatweel go,
 * Hebrew points go. A Devanagari sign or a dakuten is part of its letter and stays,
 * and punctuation is never touched.
 */

const MARK = /\p{Mn}/u;

/** Case differences `toLowerCase` leaves that a reader does not see. */
const SAME_LETTER = /[ßς]/g;
const LETTER = { ß: 'ss', ς: 'σ' };

const skippedOn = (base) => base <= 0x052f || (base >= 0x1e00 && base <= 0x1fff);
const skipped = (mark) => (mark >= 0x064b && mark <= 0x065f) || mark === 0x0670
  || (mark >= 0x0591 && mark <= 0x05c7);

/** `text` as a search compares it. */
export function foldText(text) {
  const lowered = String(text ?? '').toLowerCase().replace(SAME_LETTER, (letter) => LETTER[letter]);
  let out = '';
  let base = 0;
  for (const char of lowered.normalize('NFD')) {
    const code = char.codePointAt(0);
    if (MARK.test(char)) {
      if (!(skippedOn(base) || skipped(code))) out += char;
      continue;
    }
    if (code === 0x0640) continue; // the tatweel, which only stretches a word
    base = code;
    out += char;
  }
  return out.normalize('NFC');
}

/** The words of a search box, folded, blanks dropped. */
export function foldTerms(query) {
  return foldText(String(query ?? '').trim()).split(/\s+/).filter(Boolean);
}
