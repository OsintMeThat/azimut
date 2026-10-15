/**
 * The videos a plate plays, and the order it plays its days and steps in.
 *
 * A step holds still for its own seconds, or as long as its longest clip runs; a
 * video only stands on a step. Played, a plate goes through each day, then each
 * step of that day, then the next day: the MP4 is made of those beats, each the page
 * as it stands then, with the step's clips running in their boxes.
 */
import { STEP_SECONDS, longDay, shownOn, stepsOf } from './page.js';

/** A clip runs at most this long, in seconds. */
export const MAX_CLIP_SECONDS = 600;
/** What a new clip takes of its video, unless the analyst sets it. */
export const FIRST_SECONDS = 10;

/** A clip's start and end, in seconds, set in order and bounded by the video's length when known. */
export function clipRange(element, duration = null) {
  const [rawStart, rawEnd] = element?.clip ?? [0, FIRST_SECONDS];
  const length = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const start = Math.max(0, Math.min(Number(rawStart) || 0, length));
  let end = Math.min(Number(rawEnd) || 0, length, start + MAX_CLIP_SECONDS);
  if (!(end > start)) end = Math.min(length, start + FIRST_SECONDS);
  return [round(start), round(end)];
}

/** How long a clip runs, in seconds. */
export const clipSeconds = (element) => {
  const [start, end] = clipRange(element);
  return Math.max(0, end - start);
};

/** The videos a step plays: its own, shown and set on a file. */
export const clipsOf = (elements, step) => elements.filter((element) => element.kind === 'video' && element.step === step.id && element.src && !element.hidden);

/** How long a step holds: its longest clip, else its own seconds. */
export function stepSeconds(step, elements) {
  const clips = clipsOf(elements, step);
  if (clips.length) return Math.max(...clips.map(clipSeconds));
  return Number(step.duration) > 0 ? Number(step.duration) : STEP_SECONDS;
}

/**
 * The beats a played plate goes through: each of `days` (a moment, or null for the
 * plate as it stands), then each of its steps, `{ day, step, seconds }` with `step`
 * null for the day itself, held `dayMs` milliseconds.
 */
export function beats(spec, days, dayMs) {
  const out = [];
  for (const day of days) {
    out.push({ day, step: null, seconds: dayMs / 1000 });
    for (const step of stepsOf(spec, day)) out.push({ day, step: step.id, seconds: stepSeconds(step, spec.elements) });
  }
  return out;
}

/** The days a played plate goes through: the moments asked, then now when steps stand on it. */
export const playDays = (spec, moments) => [...moments, ...(spec?.steps?.now?.length ? [null] : [])];

/** The whole of a sequence, in seconds. */
export const totalSeconds = (list) => list.reduce((sum, beat) => sum + beat.seconds, 0);

/** The clips a beat runs, with where each one stands, for the export. */
export function beatClips(spec, beat) {
  if (!beat.step) return [];
  const step = stepsOf(spec, beat.day).find((item) => item.id === beat.step);
  if (!step) return [];
  const place = { steps: stepsOf(spec, beat.day).map((item) => item.id), index: stepsOf(spec, beat.day).indexOf(step) };
  return clipsOf(spec.elements, step).filter((element) => shownOn(element, beat.day, place));
}

/** `75.5` as `1:15.5`; whole seconds without their tenths. */
export function timecode(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = round(value - minutes * 60);
  const said = Number.isInteger(rest) ? String(rest) : rest.toFixed(1);
  return `${minutes}:${rest < 10 ? `0${said}` : said}`;
}

/** `1:15.5`, `75.5` or `1:02:03` read back as seconds; null when it is not a time. */
export function readTimecode(text) {
  const parts = String(text ?? '').trim().split(':');
  if (!parts[0] || parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  return round(parts.reduce((sum, part) => sum * 60 + Number(part), 0));
}

/**
 * The line a clip says its source with, from the file's record: who posted it,
 * where, and when, as far as the record knows; else the file's title.
 */
export function captionOf(item) {
  const source = item?.source ?? {};
  const parts = [];
  if (source.uploader) parts.push(String(source.uploader));
  const link = source.webpage_url || source.url || item?.source_url;
  if (link) {
    try { parts.push(new URL(link).hostname.replace(/^www\./, '')); } catch { /* an address the line does without */ }
  }
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(String(source.upload_date ?? ''));
  if (day) parts.push(longDay(`${day[1]}-${day[2]}-${day[3]}`));
  return parts.length ? parts.join(' · ') : String(item?.title ?? '');
}

/** The key a video's still frame is kept under in the page's pictures. */
export const posterKey = (element) => `video:${element.src}@${clipRange(element)[0]}`;

/** The picture of a video at `seconds`, drawn once its frame is in; null when the browser cannot. */
export function posterOf(url, seconds) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 15000);
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.onloadedmetadata = () => { video.currentTime = Math.min(seconds, Math.max(0, (video.duration || seconds) - 0.05)); };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1;
      canvas.height = video.videoHeight || 1;
      try {
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas);
      } catch { finish(null); }
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

function round(value) {
  return Math.round(value * 10) / 10;
}
