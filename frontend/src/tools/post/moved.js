/**
 * What a rename made elsewhere moved under the post open.
 *
 * A proof renamed in Geo Proof or from Details, a picture or a video renamed in Media:
 * the server rewrites every draft naming it (`engine/renames.py`), a video thread's
 * place keys (`place:<proof>`) included, while the composer still holds the old names,
 * and its next save would write them back over the rewrite. Read off the draft as the
 * composer last wrote it and as it stands on disk now, field by field.
 */

/** Each name a rename rewrites in a draft, with where it stands. */
function* names(state) {
  if (!state || typeof state !== 'object') return;
  for (const key of ['proofPng', 'video', 'clip', 'sheet', 'map', 'first']) yield [key, state[key]];
  for (const key of ['firstMedia', 'mediaPaths']) {
    for (const [at, path] of (Array.isArray(state[key]) ? state[key] : []).entries()) yield [`${key}.${at}`, path];
  }
  for (const [at, post] of (Array.isArray(state.extraTweets) ? state.extraTweets : []).entries()) {
    yield [`post.${at}.key`, post?.key];
    for (const [i, path] of (Array.isArray(post?.mediaPaths) ? post.mediaPaths : []).entries()) yield [`post.${at}.${i}`, path];
  }
}

/**
 * Old name → new, from the draft as the composer last wrote it and as it is on disk: a
 * name changed in its place, gone from the draft on disk and new to it, as a rename
 * leaves it. A change the composer made itself meanwhile (a picture swapped, two
 * reordered) is no rename. Empty when nothing moved.
 */
export function movedNames(written, onDisk) {
  const before = new Map(names(written));
  const after = new Map(names(onDisk));
  const was = new Set(before.values());
  const now = new Set(after.values());
  const moved = new Map();
  for (const [where, old] of before) {
    const name = after.get(where);
    if (typeof old !== 'string' || typeof name !== 'string' || !old || !name || old === name) continue;
    if (now.has(old) || was.has(name)) continue;
    moved.set(old, name);
  }
  return moved;
}
