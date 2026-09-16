/**
 * The Saved panel's media viewer, as data: which files a press opens, how the
 * arrows walk them, and why each one stands where it does.
 *
 * A file holds no coordinates of its own, so the row carries the roads that put
 * it on the map (GET /satellite/media) and this turns them into the one line the
 * viewer prints under the title.
 */
import { groupSavedMarkers } from './savedMarkers.js';

/** The index one step away, wrapping at both ends of the stack. */
export function step(index, delta, length) {
  if (!length) return 0;
  return (((index + delta) % length) + length) % length;
}

/**
 * The files standing on the same metre as `row`, and where `row` sits among them.
 *
 * A row pressed in the tree opens the same stack its mark opens at street zoom,
 * so the arrows walk what the map draws there rather than the one file.
 */
export function stackOf(rows, row) {
  const key = row.key ?? row.id;
  const mark = groupSavedMarkers(rows, 5).find((one) =>
    one.items.some((item) => (item.key ?? item.id) === key)
  );
  const items = mark?.items ?? [row];
  return { items, index: Math.max(0, items.findIndex((item) => (item.key ?? item.id) === key)) };
}

/** Why a file stands here, in the words the viewer prints. */
export function roadWords(row) {
  const words = [];
  for (const road of row?.roads ?? []) {
    let said = '';
    if (road.type === 'located-at') said = 'Recorded here';
    else if (road.type === 'depicts') said = 'Shows this place';
    else if (road.title) said = `Via ${road.title}`;
    else if (road.type) said = `Via a ${road.type}`;
    if (said && !words.includes(said)) words.push(said);
  }
  return words.join(' · ');
}
