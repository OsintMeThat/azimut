/**
 * What a note's picture asks Inspect or Collage to open on, held until the tool
 * has the file open: the instant a frame was cut at. A plain module so the
 * opener that writes it loads without the tool.
 */
const held = { path: null, time: null };

/** Inspect is to land on `time` once `path` is open. */
export function holdSeek(path, time) {
  held.path = path;
  held.time = Number.isFinite(Number(time)) ? Number(time) : null;
}

/** The instant asked for `path`, once, or null. */
export function takeSeek(path) {
  if (!path || held.path !== path) return null;
  const time = held.time;
  held.path = null;
  held.time = null;
  return time;
}
