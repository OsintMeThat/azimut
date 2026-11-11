/**
 * Compare going To Post: what a Compare post is told of the image the comparison kept
 * in the case (`tools/post/start.js` `startPost`).
 *
 * A post holds four pictures or one video, and X takes a GIF as its video, so each To
 * Post carries one file: the comparison's PNG, its Blink or Slide GIF, the evolution's
 * GIF or its sheet. What travels with it is the comparison's name, the date of each
 * picture as before and after (an evolution's first and last day) and the credits the
 * image prints under it.
 */

/** The credit lines the image prints, each once, as one line. */
export function postCredits(...lines) {
  return [...new Set(lines.flat().map((line) => String(line ?? '').trim()).filter(Boolean))].join(' · ');
}

/**
 * What the post is told: `pair` the two pictures' dates (`imageryWhen` of each side), or
 * `days` the evolution's days in order, and the credits printed under the image. The
 * dates go as `span`: the left picture's before, the right one's after, a picture with
 * no single date (a mosaic like World Imagery) as null, for the analyst to complete.
 */
export function comparePostAbout({ title = '', pair = null, days = [], credits = '' } = {}) {
  const [before, after] = days?.length ? [days[0], days.at(-1)] : [pair?.a?.imageryWhen, pair?.b?.imageryWhen];
  const side = (value) => (typeof value === 'string' && value ? value : null);
  return {
    title: String(title ?? '').trim(),
    description: '',
    span: { before: side(before), after: side(after) },
    credits: String(credits ?? '').trim(),
  };
}
