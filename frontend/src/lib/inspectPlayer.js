/**
 * The Inspect player's arithmetic: which frame is on screen, where a step lands,
 * how fast the clip plays, what loops, and where on the bar a moment sits.
 *
 * A browser shows the frame whose interval holds the current time, while ffmpeg
 * cuts the first frame at or after the time it is handed
 * (`engine/inspect.extract_frame`). So a frame is named by its own timestamp, the
 * one a capture sends, and the player seeks into the middle of a frame to show it:
 * a seek onto the exact timestamp can round to the frame before.
 */

/** What a clip with no frame rate on record is stepped at. */
export const DEFAULT_FPS = 30;

/** The speeds J and L walk through, slowest first. */
export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];

// Far below any frame's length, far above a double's noise on a timestamp.
const NOISE = 1e-6;

export function frameDuration(fps) {
  return 1 / (fps > 0 ? fps : DEFAULT_FPS);
}

/** The index of the frame showing at `time`, counted from the first. */
export function frameIndex(time, fps) {
  const t = Math.max(0, Number(time) || 0);
  return Math.floor(t / frameDuration(fps) + NOISE);
}

/**
 * Whether `presented`, what the browser said it last drew
 * (`requestVideoFrameCallback`'s `mediaTime`), is a frame's own timestamp. Chrome
 * gives the frame's; Firefox, paused after a seek, echoes the playback time back,
 * which says nothing about where the frame starts.
 */
function isFrameStamp(presented, time) {
  return Number.isFinite(presented) && Math.abs(presented - time) > NOISE;
}

/**
 * The timestamp of the frame on screen, for the clock and the frame steps: the
 * browser's, when it gave one, else worked out from the time and the clip's rate.
 */
export function shownFrameTime(time, fps, presented = null) {
  if (isFrameStamp(presented, time)) return presented;
  return frameIndex(time, fps) * frameDuration(fps);
}

/**
 * The moment a capture asks the server for. The server names the frame a player
 * shows at it (`snap`, `engine/inspect.frame_time_at`), from the file's own
 * timestamps, which holds on a variable frame rate where the rate cannot.
 */
export function captureMoment(time, presented = null) {
  return isFrameStamp(presented, time) ? presented : Math.max(0, Number(time) || 0);
}

/** Where to seek to show the frame starting at `frameTime`: half a frame in. */
export function seekInto(frameTime, fps, duration = 0) {
  return clampTime(frameTime + frameDuration(fps) / 2, fps, duration);
}

/**
 * Where a step of `seconds` from the frame starting at `from` lands, half a frame
 * into the frame it reaches. A step of one frame is `±frameDuration(fps)`.
 */
export function stepTarget(from, seconds, fps, duration = 0) {
  return seekInto(from + seconds, fps, duration);
}

/** A time kept inside the clip, short of its very end where there is no frame to show. */
export function clampTime(time, fps, duration = 0) {
  const end = duration > 0 ? Math.max(0, duration - frameDuration(fps) / 4) : Infinity;
  return Math.min(Math.max(0, Number(time) || 0), end);
}

/** A time as a player reads it to the millisecond: 0:12.400, or 1:02:03.400 past an hour. */
export function preciseClock(seconds) {
  const t = Math.max(0, Number(seconds) || 0);
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = `${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** A speed as the button reads it: 0.25×, 1×. */
export function speedLabel(rate) {
  return `${rate}×`;
}

/** The next speed down, or the slowest. */
export function slower(rate) {
  const below = SPEEDS.filter((s) => s < rate - NOISE);
  return below.length ? below[below.length - 1] : SPEEDS[0];
}

/** The next speed up, or the fastest. */
export function faster(rate) {
  return SPEEDS.find((s) => s > rate + NOISE) ?? SPEEDS[SPEEDS.length - 1];
}

// -- A–B loop -------------------------------------------------------------------

/**
 * Set one end of the loop at `time`. Setting B before A starts the loop at the
 * beginning; an end set past the other one drops the other, since a loop has to
 * run forward.
 */
export function setLoopEnd(loop, end, time) {
  const t = Math.max(0, time);
  if (end === 'a') return { a: t, b: loop.b != null && loop.b > t ? loop.b : null };
  const a = loop.a ?? 0;
  return t > a ? { a, b: t } : { a: loop.a, b: null };
}

export const loopIsSet = (loop) => loop?.a != null && loop?.b != null && loop.b > loop.a;

/** Where playback jumps back to once it reaches B, or null while it is inside the loop. */
export function loopRestart(time, loop) {
  return loopIsSet(loop) && time >= loop.b ? loop.a : null;
}

// -- the bar --------------------------------------------------------------------

/** How far along the bar a time sits, 0 to 1. */
export function barFraction(time, duration) {
  if (!(duration > 0)) return 0;
  return Math.min(1, Math.max(0, time / duration));
}

/**
 * The hover picture for a time: which tile of the strip the server drew
 * (`engine/inspect.video_overview`), as its column and row.
 */
export function tileAt(time, tiles) {
  if (!tiles?.count || !(tiles.interval > 0)) return null;
  const index = Math.min(tiles.count - 1, Math.max(0, Math.floor(time / tiles.interval)));
  return { index, col: index % tiles.columns, row: Math.floor(index / tiles.columns) };
}

/** CSS that shows one tile of the strip in a box of the tile's own size. */
export function tileStyle(tile, tiles, url) {
  if (!tile || !url) return '';
  return [
    `background-image:url("${url}")`,
    `background-position:-${tile.col * tiles.width}px -${tile.row * tiles.height}px`,
    `width:${tiles.width}px`,
    `height:${tiles.height}px`,
  ].join(';');
}

/**
 * The waveform scaled to its own loudest moment, so a quiet clip still shows its
 * shape. Silence stays flat.
 */
export function waveformBars(peaks) {
  if (!Array.isArray(peaks) || !peaks.length) return [];
  const top = Math.max(...peaks);
  return top > 0 ? peaks.map((p) => p / top) : peaks.map(() => 0);
}

// -- the histogram ------------------------------------------------------------------

/**
 * Red, green, blue and luminance counts of RGBA pixels, 256 bins each. Fully
 * transparent pixels are left out.
 */
export function histogram(pixels) {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const l = new Array(256).fill(0);
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    r[red] += 1;
    g[green] += 1;
    b[blue] += 1;
    l[Math.min(255, Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue))] += 1;
  }
  return { r, g, b, l };
}

// -- marks --------------------------------------------------------------------------

export const MARK_LABEL_MAX = 200;

/** The marks of a clip in playback order. */
export function sortedMarks(marks) {
  return [...(marks ?? [])].sort((x, y) => x.time - y.time);
}
