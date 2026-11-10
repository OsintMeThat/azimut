/**
 * A Map plate going To Post: what its export files in the case for the post to carry,
 * and what the post is told of it (`tools/post/start.js` `startPost`).
 *
 * A post carries a picture or a video, so the page goes as a PNG, its days as an
 * evolution sheet, a GIF or an MP4, and a PDF stays an export to print. The file names
 * its plate, the day and step a page shows and the credits on its face, as a figure for
 * a note does (`POST /map-plates/export` with `into=case`).
 */

/** The formats a post can carry, of those the export dialog offers. */
export const POST_FORMATS = Object.freeze(['png', 'sheet', 'gif', 'mp4']);

/** What `postExport` sends to file the export in the case: `filed`. */
export function plateFiled({ name, format, day = '', step = '', credits = '' }) {
  const still = format === 'png';
  return {
    plate: name,
    ...(format === 'sheet' ? { kind: 'sheet' } : still ? { kind: 'page' } : {}),
    ...(still && day ? { day } : {}),
    ...(still && step ? { step } : {}),
    ...(credits ? { attribution: String(credits).slice(0, 2000) } : {}),
  };
}

/**
 * Whether a plate's title is the analyst's own words: a new plate is named after its
 * case (`Kherson map`) or `Map plate`, and those say nothing worth posting.
 */
export function namedPlate(title, caseName = '') {
  const value = String(title ?? '').trim();
  if (!value) return false;
  const given = [`${String(caseName ?? '').trim()} map`, 'Map plate'].map((name) => name.trim().toLowerCase());
  return !given.some((name) => name && new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\d+)?$`).test(value.toLowerCase()));
}

/**
 * What the post is told of the plate: its title, which also opens the post's text when
 * the analyst named it, the day a page shows or the first and the last of the days
 * played, and the credits its face carries.
 */
export function platePostAbout({ title = '', caseName = '', format, at = '', days = [], credits = '' }) {
  const played = format !== 'png';
  const shown = played ? [days?.[0], days?.at?.(-1)] : [at];
  return {
    title: String(title ?? '').trim(),
    description: namedPlate(title, caseName) ? String(title).trim() : '',
    dates: shown.filter((day) => typeof day === 'string' && day),
    credits: String(credits ?? '').trim(),
  };
}
