/**
 * Detect going To Post: the evidence pictures pinned candidates filed in the case, on a
 * free post (`tools/post/start.js` `startPost`).
 *
 * Only a pin files a picture. A candidate kept in its run has none, and nothing is drawn
 * for it here: the run's To Post carries its pins, and a run with none says how to get one.
 */
import { MAX_POST_MEDIA } from '../../lib/post.js';

/** What a run with nothing pinned says where its To Post would be. */
export const NO_PIN = 'Pin a candidate to post it';

/** The pins a run's post carries, in the order given, as many as one post holds. */
export function postablePins(rows) {
  return (rows ?? []).filter((row) => row?.review === 'kept' && row.entity_id).slice(0, MAX_POST_MEDIA);
}

/** What the run's To Post says it carries, on its hover, once a pin is there to post. */
export function pinsPostHint(pinned, all = pinned) {
  const more = all > pinned ? `, the first ${pinned} of ${all}` : '';
  return `A free post with ${pinned === 1 ? 'the pinned picture' : `the ${pinned} pinned pictures`}${more}`;
}

/** A pass's day, or nothing for a pass that names a release rather than a day. */
const day = (source) => String(source?.date ?? '').slice(0, 10);

/**
 * What the post is told of its pins: the pin's name (the run's for several), the pin's
 * own description when there is one, and the days of the passes they were read on, as
 * before and after: a pin's two passes, or for several the earliest before and the
 * latest after. A pass that names a release rather than a day is a side with no known
 * date (null). A method that reads one pass has no before, so its pins say the days of
 * the passes they were seen on.
 */
export function pinPostAbout({ title = '', description = '', pairs = [], single = false } = {}) {
  const days = (side) => pairs.map((pair) => day(pair?.[side])).filter(Boolean).sort();
  const before = days('a');
  const after = days('b');
  return {
    title: String(title ?? '').trim(),
    description: String(description ?? '').trim(),
    ...(single ? { dates: after } : { span: { before: before[0] ?? null, after: after.at(-1) ?? null } }),
  };
}
