/**
 * The videos a plate plays, and the order it plays its days and steps in.
 *
 * Every beat holds its own seconds: a day its own or the plate's, a step its own,
 * never shorter than its longest clip (a step held longer keeps the clip's last
 * frame). A video only stands on a step. Played, a plate goes through each day,
 * then each step of that day, then the next day: the MP4 is made of those beats,
 * each the page as it stands then, with the step's clips running in their boxes.
 */
import { PAGE, STEP_SECONDS, dayOf, longDay, shownOn, stepsOf } from './page.js';

/** How long a day holds when neither it nor the plate says, in seconds. */
export const DAY_SECONDS = 1;
/** The bounds a beat's own seconds are held in. */
export const LEAST_SECONDS = 0.2;
export const MOST_SECONDS = 120;

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

/** The longest clip a step runs: the least it can hold, 0 without one. */
export const leastSeconds = (step, elements) => Math.max(0, ...clipsOf(elements, step).map(clipSeconds));

/** How long a step holds: its own seconds, never shorter than its longest clip. */
export function stepSeconds(step, elements) {
  const own = Number(step.duration) > 0 ? Number(step.duration) : STEP_SECONDS;
  return Math.max(own, leastSeconds(step, elements));
}

/** How long every day holds that says nothing of its own: the plate's seconds. */
export const plateSeconds = (spec) => (Number(spec?.time?.hold) > 0 ? Number(spec.time.hold) : DAY_SECONDS);
/** How long a day holds (a moment, or null for the page of a plate with no day): its own seconds, else the plate's. */
export function daySeconds(spec, day) {
  const own = Number(spec?.holds?.[dayOf(day)]);
  return own > 0 ? own : plateSeconds(spec);
}
/** A beat's seconds as typed, held in bounds and to the tenth; null when it is not a number. */
export function boundSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return round(Math.min(MOST_SECONDS, Math.max(LEAST_SECONDS, seconds)));
}

/**
 * The beats a played plate goes through: each of `days` (a moment, or null for the
 * page of a plate with no day), then each of its steps, `{ day, step, seconds }` with
 * `step` null for the day itself, each held its own seconds.
 */
export function beats(spec, days) {
  const out = [];
  for (const day of days) {
    out.push({ day, step: null, seconds: daySeconds(spec, day) });
    for (const step of stepsOf(spec, day)) out.push({ day, step: step.id, seconds: stepSeconds(step, spec.elements) });
  }
  return out;
}

/**
 * The days a played plate goes through, in order: the moments its layers change at,
 * every day that holds steps of its own, a change or not, today among them, and the
 * days the plate was told to play.
 */
export function playDays(spec, moments) {
  const stepped = Object.entries(spec?.steps ?? {}).filter(([day, list]) => day !== PAGE && list?.length).map(([day]) => day);
  const picked = (spec?.days ?? []).filter((day) => day !== PAGE);
  return [...new Set([...moments, ...stepped, ...picked])].sort();
}

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

/** Whether a clip's file is a GIF: it plays as a video does, looping for as long as its clip runs. */
export const isGif = (src) => /\.gif$/i.test(String(src ?? ''));

/** The first picture of a GIF, as a canvas; null when the browser cannot read it. */
export function gifPoster(url) {
  return new Promise((resolve) => {
    const picture = new Image();
    picture.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = picture.naturalWidth || 1;
      canvas.height = picture.naturalHeight || 1;
      try {
        canvas.getContext('2d')?.drawImage(picture, 0, 0);
        resolve(canvas);
      } catch { resolve(null); }
    };
    picture.onerror = () => resolve(null);
    picture.src = url;
  });
}

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
