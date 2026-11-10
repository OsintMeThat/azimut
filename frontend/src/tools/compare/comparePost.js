/**
 * Compare going To Post: what a free post is told of the image the comparison kept in
 * the case (`tools/post/start.js` `startPost`).
 *
 * A post holds four pictures or one video, and X takes a GIF as its video, so each To
 * Post carries one file: the comparison's PNG, its Blink or Slide GIF, the evolution's
 * GIF or its sheet. What travels with it is the comparison's name, the date of each
 * picture (an evolution's first and last day) and the credits the image prints under it.
 */

/** The credit lines the image prints, each once, as one line. */
export function postCredits(...lines) {
  return [...new Set(lines.flat().map((line) => String(line ?? '').trim()).filter(Boolean))].join(' · ');
}

/**
 * What the post is told: `pair` the two pictures' dates (`imageryWhen` of each side), or
 * `days` the evolution's days in order, and the credits printed under the image.
 */
export function comparePostAbout({ title = '', pair = null, days = [], credits = '' } = {}) {
  const shown = days?.length ? [days[0], days.at(-1)] : [pair?.a?.imageryWhen, pair?.b?.imageryWhen];
  return {
    title: String(title ?? '').trim(),
    description: '',
    dates: shown.filter((value) => typeof value === 'string' && value),
    credits: String(credits ?? '').trim(),
  };
}
