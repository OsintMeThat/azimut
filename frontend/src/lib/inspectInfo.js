/**
 * What Inspect's Info tab says about the open file, as rows.
 *
 * Two readings feed it: the media's sidecar (`/media/item`: size, hash, where it
 * came from, and what enrichment read off the file at import, EXIF or ffprobe's
 * dump) and the probe the player opened the file with (`/inspect/probe`: the stream
 * the browser is about to decode). A row only appears when there is something to
 * say, so a stripped file reads short rather than full of dashes.
 */
import { cropAspect } from './inspect.js';
import { preciseClock, frameIndex } from './inspectPlayer.js';

export function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  if (bytes >= 1 << 10) return `${Math.round(bytes / (1 << 10))} KB`;
  return `${bytes} B`;
}

export function bitRate(bits) {
  if (!Number.isFinite(bits) || bits <= 0) return '';
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mb/s`;
  return `${Math.round(bits / 1e3)} kb/s`;
}

/** A downloader's `20240612` as 2024-06-12; anything else as it came. */
export function plainDate(value) {
  const text = String(value ?? '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : text;
}

const fps = (rate) => (Number.isFinite(rate) && rate > 0 ? `${Number(rate.toFixed(3))} fps` : '');

/** The software a file says it went through: an editor or a re-encode leaves this behind. */
export function encoderOf(item, probe) {
  const exif = item?.exif ?? {};
  return String(probe?.encoder || exif.Software || exif.ProcessingSoftware || '').trim();
}

/** The full metadata dump enrichment kept for this file, as [key, value] pairs. */
export function metadataRows(item) {
  const dump = item?.kind === 'video' ? item?.video_metadata : item?.exif;
  return Object.entries(dump ?? {});
}

/**
 * The tab's sections, in reading order. A row is `{ k, v, kind? }`: `kind` is
 * `hash`, `link` or `gps` for the three rows that carry an action.
 */
export function infoSections({ item, probe, frame = null, fileKind }) {
  const out = [];
  const video = fileKind === 'video';
  const add = (title, rows) => {
    const kept = rows.filter((r) => r && r.v !== '' && r.v != null);
    if (kept.length) out.push({ title, rows: kept });
  };

  // An image's own frame is the picture itself; only a cut or a crop is something else.
  if (frame && (frame.time != null || frame.crop)) {
    const w = frame.crop ? Math.round(frame.crop.w * (frame.w || 0)) : frame.w;
    const h = frame.crop ? Math.round(frame.crop.h * (frame.h || 0)) : frame.h;
    add('This frame', [
      frame.time != null && { k: 'Cut at', v: preciseClock(frame.time) },
      frame.time != null && probe?.fps && { k: 'Frame', v: `${frameIndex(frame.time, probe.fps) + 1}` },
      w && h && { k: 'Size', v: `${w} × ${h}${frame.crop ? ' (cropped)' : ''}` },
      frame.crop && cropAspect(frame.crop, frame.w, frame.h) && { k: 'Aspect', v: cropAspect(frame.crop, frame.w, frame.h).toFixed(2) },
    ]);
  }

  const width = probe?.width;
  const height = probe?.height;
  add(video ? 'Video' : 'Picture', [
    width && height && { k: 'Resolution', v: `${width} × ${height}` },
    video && probe?.duration && { k: 'Duration', v: preciseClock(probe.duration) },
    video && { k: 'Frame rate', v: `${fps(probe?.fps)}${probe?.vfr ? ' (variable)' : ''}`.trim() },
    video && Number.isFinite(probe?.frames) && { k: 'Frames', v: String(probe.frames) },
    { k: 'Codec', v: probe?.codec || (video ? '' : probe?.format || '') },
    video && { k: 'Bit rate', v: bitRate(probe?.bit_rate) },
    video && probe && { k: 'Sound', v: probe.audio ? probe.audio_codec || 'yes' : 'none' },
    video && probe?.rotation && { k: 'Turned', v: `${probe.rotation}° in the file` },
    { k: 'Software', v: encoderOf(item, probe) },
  ]);

  add('Taken', [
    item?.taken_at && { k: 'Captured', v: String(item.taken_at) },
    item?.gps && Number.isFinite(item.gps.lat) && Number.isFinite(item.gps.lon) && { k: 'GPS', v: item.gps, kind: 'gps' },
  ]);

  const source = item?.source ?? {};
  const url = source.webpage_url ?? source.url;
  add('File', [
    { k: 'Size', v: fileSize(item?.size ?? probe?.size) },
    item?.sha256 && { k: 'SHA-256', v: item.sha256, kind: 'hash' },
    item?.added_at && { k: 'Added', v: String(item.added_at).slice(0, 10) },
    url && { k: 'Source', v: url, kind: 'link' },
    source.uploader && { k: 'Uploader', v: source.uploader },
    source.upload_date && { k: 'Published', v: plainDate(source.upload_date) },
  ]);
  return out;
}
