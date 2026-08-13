/**
 * URLs for the case-file route (`/files/<case>/<relative path>`).
 *
 * A media file's name is whatever it was called wherever it came from, and a
 * TikTok download really lands as `#3deenero2025.mp4`. Interpolated raw, that
 * `#` opens a fragment: the browser asks for `media/` and drops the rest, so
 * the video plays nowhere while its hash-named thumbnail still shows. `?` and
 * `%` break the same way. Every reader of a case file builds its URL here.
 *
 * Slashes stay slashes — the route takes a whole relative path — so encoding
 * runs per segment.
 */

export function encodeRelPath(relPath) {
  return String(relPath ?? '').split('/').map(encodeURIComponent).join('/');
}

export function fileUrl(caseId, relPath) {
  return `/files/${encodeURIComponent(caseId ?? '')}/${encodeRelPath(relPath)}`;
}

/** The case-relative path a `/files/` URL points at, or null if it points
 * elsewhere. The inverse of `fileUrl`, for the note markdown that stores these
 * URLs as text: a path read back out has to match the one on the entity again.
 * Notes written before the encoding still decode to themselves, and a lone `%`
 * (which `decodeURIComponent` refuses) is returned as it was rather than
 * throwing on someone's old note. */
export function fileRelPath(url, caseId) {
  const prefix = fileUrl(caseId, '');
  if (!caseId || !String(url ?? '').startsWith(prefix)) return null;
  const encoded = String(url).slice(prefix.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
