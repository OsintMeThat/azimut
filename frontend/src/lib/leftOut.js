/**
 * Why auto-stitch left a piece where it was, in the words the canvas and the message
 * say it. The server says which (engine/stitch.py): `no-overlap`, its detail matched
 * no other piece; `no-detail`, it had too little to match, being blank or painted
 * out; `off-canvas`, it matched and its projection broke. Planar is the projection a
 * wide pan breaks, so there the words point to Cylindrical.
 */

/** A piece left out: what its chip says, `say`, and the clause after it, `more`. */
export function leftOutWords(why, mode = 'planar') {
  if (why === 'no-detail') return { say: 'Nothing to match', more: 'blank or painted out' };
  if (why === 'off-canvas') return { say: 'Fell off the canvas', more: mode === 'planar' ? 'try Cylindrical' : '' };
  return { say: 'No overlap', more: '' };
}

/** The whole line, as a title reads it. */
export function leftOutLine(why, mode) {
  const { say, more } = leftOutWords(why, mode);
  return more ? `${say}: ${more}` : say;
}

/** How many of the pieces left out were each, in a phrase: "2 with no overlap, 1 off the canvas". */
function tally(reasons) {
  const counts = new Map();
  for (const why of reasons) counts.set(why, (counts.get(why) ?? 0) + 1);
  const said = { 'no-overlap': 'with no overlap', 'no-detail': 'with nothing to match', 'off-canvas': 'off the canvas' };
  return [...counts].map(([why, n]) => `${n} ${said[why] ?? said['no-overlap']}`).join(', ');
}

/**
 * What the message says of a stitch: how many pieces it placed, and why it left the
 * outlined ones where they were. `reasons` holds one word per piece left out.
 */
export function stitchedWords(placed, reasons, mode = 'planar') {
  const left = reasons.length;
  if (!left) return `Stitched ${placed} pieces`;
  const one = new Set(reasons).size === 1 ? reasons[0] : null;
  const words = one ? leftOutWords(one, mode) : null;
  const why = words ? `${words.say.toLowerCase()}${words.more ? `, ${words.more}` : ''}` : tally(reasons);
  if (!placed) return one === 'no-overlap' ? 'No overlap found between the pieces, so none moved' : `None of the pieces moved: ${why}`;
  if (one === 'no-overlap') {
    const which = left === 1 ? 'the outlined piece' : `the ${left} outlined pieces`;
    return `Stitched ${placed}. No overlap found for ${which}, left where ${left === 1 ? 'it was' : 'they were'}`;
  }
  const which = left === 1 ? 'The outlined piece stays where it was' : `The ${left} outlined pieces stay where they were`;
  return `Stitched ${placed}. ${which}: ${why}`;
}
