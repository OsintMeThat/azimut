/**
 * "Saved work" grouping for the case sidebar: every filed entity, bucketed by
 * the tool that produced it — except filed images/videos, which are media
 * first and belong under Media Library no matter which tool produced them
 * (e.g. a frame saved from Inspect, or a satellite capture).
 */

export const TOOL_GROUPS = [
  ['media-library', 'Media Library', 'image'],
  ['inspect', 'Inspect', 'inspect'],
  ['satellite', 'Satellite', 'satellite'],
  ['proof-composer', 'Proof Composer', 'proof'],
  ['post-composer', 'Post Composer', 'post'],
  ['user', 'Notes & manual', 'note'],
];

export const KNOWN_TOOLS = new Set(TOOL_GROUPS.map(([k]) => k).filter((k) => k !== 'user'));

// Entity types that are filed images/videos living in media/, whatever tool
// produced them: plain uploads/derivatives ('media') and satellite captures
// ('capture', which additionally carry lat/lon/zoom).
const MEDIA_ENTITY_TYPES = new Set(['media', 'capture']);

export function groupKey(entity) {
  if (MEDIA_ENTITY_TYPES.has(entity.type)) return 'media-library';
  const by = entity.provenance?.by;
  return KNOWN_TOOLS.has(by) ? by : 'user';
}
