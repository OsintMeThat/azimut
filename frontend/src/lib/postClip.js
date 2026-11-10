/**
 * Cut for the post: a passage of a proof's ★ video cut into a case file of its own,
 * kept on the proof's scene as its `clip` (`engine/postclips.py`).
 *
 * The cut runs as a job; `cutClip` polls it and hands each percent on. A passage the
 * case already holds a clip of answers at once with that clip, never a second copy.
 * A clip reads `{ path, start, end, size, title }` while its file is in the case.
 */
import { api } from './api.js';
import { fileSize } from './inspectInfo.js';
import { isStretch, shortClock, spanLabel } from './scenes.js';

/** The longest clip, ten minutes, and the shortest, half a second (`postclips.MAX_SECONDS`). */
export const CLIP_MAX_SECONDS = 600;
export const CLIP_MIN_SECONDS = 0.5;
/** The rates a clip is capped at, in kb/s (`postclips.MAXRATE`, `AUDIO_RATE`). */
export const CLIP_VIDEO_KBPS = 3500;
export const CLIP_AUDIO_KBPS = 128;
/** How often a running cut is asked how far it got. */
export const POLL_MS = 500;

/** Whether a passage can be cut: a stretch, half a second to ten minutes long. An instant has nothing to cut. */
export function cuttable(moment) {
  if (!isStretch(moment)) return false;
  const length = moment.end - moment.start;
  return length >= CLIP_MIN_SECONDS - 1e-3 && length <= CLIP_MAX_SECONDS + 1e-3;
}

/** A clip's length: whole seconds under a minute, `15 s`, a clock past it, `2:05`. */
export function clipLength(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return seconds < 59.5 ? `${Math.max(1, Math.round(seconds))} s` : shortClock(seconds);
}

/**
 * A clip in a few words: its passage, its length and its size, `0:30–0:45 · 15 s · 2.1 MB`.
 * `passage: false` leaves the passage out where it goes without saying, `15 s · 2.1 MB`.
 */
export function clipWords(clip, { passage = true } = {}) {
  if (!clip) return '';
  const parts = [...(passage ? [spanLabel(clip.start, clip.end)] : []), clipLength(clip.end - clip.start)];
  const size = fileSize(clip.size);
  if (size) parts.push(size);
  return parts.join(' · ');
}

const base = (caseId, name) => `/api/cases/${encodeURIComponent(caseId)}/proofs/${encodeURIComponent(name)}/clip`;

/** The clip a saved proof's scene holds, or null: `{ video, clip }`. */
export async function readClip(caseId, name, { get = api.get } = {}) {
  const answer = await get(base(caseId, name));
  return { video: answer?.video ?? null, clip: answer?.clip ?? null };
}

/**
 * Cut `passage` of the proof's ★ video and answer the clip. `onprogress(percent)` hears
 * each step of a cut that runs; a clip the case already holds comes back at once.
 * `isStale()` stops the polling quietly, answering null, when the caller moved on.
 */
export async function cutClip(
  caseId,
  name,
  passage,
  { post = api.post, get = api.get, onprogress = () => {}, isStale = () => false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  const answer = await post(base(caseId, name), { start: passage.start, end: passage.end });
  if (answer?.clip) return answer.clip;
  if (!answer?.job_id) throw new Error('the cut did not start');
  for (;;) {
    if (isStale()) return null;
    const job = await get(`/api/jobs/${encodeURIComponent(answer.job_id)}`);
    if (job.status === 'done') return job.result?.clip ?? null;
    if (job.status === 'error') throw new Error(job.error || 'the cut failed');
    onprogress(Number.isFinite(job.progress?.percent) ? job.progress.percent : 0);
    await sleep(POLL_MS);
  }
}
