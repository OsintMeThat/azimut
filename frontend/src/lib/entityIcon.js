/** Icon name for a case entity, shared by the sidebar rows and result list. */

export const ENTITY_ICONS = {
  person: 'user',
  organization: 'layers',
  alias: 'user',
  account: 'globe',
  email: 'note',
  phone: 'hash',
  place: 'pin',
  capture: 'satellite',
  event: 'clock',
  media: 'image',
  proof: 'proof',
  post: 'post',
  domain: 'globe',
  ip: 'hash',
  vehicle: 'grip',
  note: 'note',
  'inspect-session': 'inspect',
};

const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);

/** Media entities normally carry the same `kind` the Media Library uses to tell
 *  video from image; fall back to the file extension for entities filed before
 *  that attr existed. */
export function isVideoEntity(e) {
  if (e.attrs?.kind) return e.attrs.kind === 'video';
  const ext = e.attrs?.path?.split('.').pop()?.toLowerCase();
  return !!ext && VIDEO_EXTS.has(ext);
}

export const entityIcon = (e) =>
  e.type === 'media' && isVideoEntity(e) ? 'video' : ENTITY_ICONS[e.type] ?? 'note';
