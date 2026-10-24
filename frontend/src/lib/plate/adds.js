/**
 * What can be added to a plate, grouped by where it goes on the page, and found by
 * a word: its name, the group it is in, or a word it is often called by (a title
 * is a text, a photo a picture).
 */

/** `[kind, label, icon, words]`, by group. */
export const ADDS = [
  { title: 'Maps', items: [['map', 'Map', 'satellite', 'ground 3d relief terrain tilt heights'], ['detail', 'Detail', 'zoomInset', 'zoom magnifier closer'],
    ['inset', 'Inset map', 'mapArea', 'locator overview']] },
  { title: 'On the map', note: 'Press the map to place it', items: [['label', 'Label', 'pin', 'callout name'],
    ['note', 'Map text', 'text', 'words title'], ['symbol', 'Symbol', 'star', 'icon marker pictogram badge tank vehicle drone'], ['number', 'Number', 'hash', 'count numbered'], ['arrow', 'Arrow', 'arrowRight', 'direction advance movement'],
    ['line', 'Line', 'curve', 'route path road front'], ['measure', 'Distance', 'line', 'length ruler measure'],
    ['ring', 'Rings', 'rings', 'range radius circle'], ['cone', 'View cone', 'viewCone', 'field sight camera'],
    ['zone', 'Zone', 'polygon', 'area hatch'], ['spotlight', 'Spotlight', 'crosshair', 'highlight dim focus']] },
  { title: 'Round the map', items: [['legend', 'Legend', 'list', 'key symbols'], ['scale', 'Scale bar', 'ruler', 'distance'],
    ['north', 'North arrow', 'compass', 'orientation'], ['credits', 'Credits', 'info', 'sources attribution'], ['timeline', 'Date strip', 'clock', 'days time']] },
  { title: 'Writing', items: [['text', 'Text', 'text', 'title words heading caption'], ['banner', 'Banner', 'columns', 'band strip'],
    ['stamp', 'Stamp', 'tag', 'unconfirmed seal'], ['key', 'Numbered list', 'numbered', 'key numbers'],
    ['table', 'Table', 'table', 'chronology sources'], ['qr', 'QR code', 'qr', 'link address']] },
  { title: 'Signing', items: [['signature', 'Signature', 'edit', 'handle author'], ['brand', 'Made with Azimut', 'brand', 'mark logo']] },
  { title: 'Pictures and shapes', items: [['image', 'Picture', 'image', 'photo proof'], ['logo', 'Logo', 'shield', 'badge signature'],
    ['rect', 'Box', 'square', 'rectangle frame'], ['ellipse', 'Ellipse', 'circle', 'oval'], ['rule', 'Rule', 'lineSolid', 'separator divider']] },
  { title: 'Playing', note: 'Played after the day', items: [['step', 'Step', 'stack', 'sequence beat'], ['video', 'Video', 'video', 'clip footage film']] },
];

const plain = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** The groups holding what answers every word of `query`, each with only those items; all of them for no query. */
export function findAdds(query = '') {
  const terms = plain(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return ADDS;
  return ADDS.map((group) => ({ ...group, items: group.items.filter(([kind, label, , words]) => {
    const said = plain(`${label} ${words} ${group.title} ${kind}`);
    return terms.every((term) => said.split(/\s+/).some((word) => word.startsWith(term)) || plain(label).includes(term));
  }) })).filter((group) => group.items.length);
}
