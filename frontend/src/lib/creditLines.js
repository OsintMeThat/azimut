/**
 * A credit line cut to fit a width, as every picture the app writes out prints it.
 *
 * A credit is owed whole, so it is never squeezed sideways nor cut short: it goes
 * on over more lines and the footer grows to hold them. It breaks between credits
 * first (` · `, and the `|` between a comparison's two sides), so each one reads
 * whole, and between words only inside a credit wider than the line on its own.
 * The backend cuts its burned credits the same way (`engine/tiles.py`
 * `attribution_lines`).
 *
 * @param {string} text
 * @param {number} room the width one line may take
 * @param {(line: string) => number} measure a line's width, in the unit of `room`
 * @returns {string[]} at least one line
 */
export function creditLines(text, room, measure) {
  // pieces at even places, the separator that joined each to the one before at odd ones
  const parts = String(text ?? '').trim().split(/(\s+·\s+|\s+\|\s+)/);
  const fits = (line) => measure(line) <= room;
  const lines = [];
  let line = '';
  for (let at = 0; at < parts.length; at += 2) {
    const piece = parts[at].trim();
    if (!piece) continue;
    const joined = line ? `${line}${parts[at - 1]}${piece}` : piece;
    if (fits(joined)) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const word of piece.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && !fits(next)) {
        lines.push(line);
        line = word;
      } else line = next;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
