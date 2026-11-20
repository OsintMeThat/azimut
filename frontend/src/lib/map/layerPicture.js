/**
 * A personal feature's picture: a file, a capture or a proof of the case its card
 * shows while the marker keeps its own point (`picture`, `engine/layerlinks.py`).
 *
 * Linking sixty vehicles to their sixty crops is the case this is made for, so the
 * picker offers first the pictures named like the feature: a feature named "#7" or
 * "T-72 7" is offered the pictures whose name holds the number 7 on its own (07, #7,
 * "vehicle 7"), never 17, 70 or the 7 of 31.7, those saying "#7" first, then those
 * whose first number it is. A name with no number is looked for whole. Nothing is
 * linked until the analyst presses one.
 */
import { buildCatalogQuery } from '../catalog.js';
import { fileUrl } from '../fileUrl.js';

/** What a card can show: as the server's `layerlinks.PICTURE_TYPES` and `PICTURE_KINDS`. */
export const PICTURE_TYPES = ['media', 'capture', 'proof'];
const PICTURE_KINDS = ['image', 'video'];

/** Whether a record of the case can be a card's picture. */
export function showable(entity) {
  if (!entity || !PICTURE_TYPES.includes(entity.type)) return false;
  return entity.type !== 'media' || PICTURE_KINDS.includes(entity.attrs?.kind);
}

/** The number a feature's name holds, without its leading zeros; '' for none. */
export function nameNumber(name) {
  const found = String(name ?? '').match(/\d+/);
  return found ? found[0].replace(/^0+(?=\d)/, '') : '';
}

/**
 * What to look for to suggest a feature's picture: `{ query, keeps(label), rank(label),
 * said }`, or null for a name too short to say anything. `rank` orders what is kept,
 * lowest first; `said` names the rule over the list.
 */
export function suggestion(name) {
  const number = nameNumber(name);
  if (number) {
    // on its own: no digit against it, and not either half of a decimal
    const alone = new RegExp(`(?<!\\d|\\d[.,])0*${number}(?!\\d|[.,]\\d)`);
    const tagged = new RegExp(`#0*${number}(?!\\d)`);
    const rank = (label) => {
      const text = String(label ?? '');
      if (tagged.test(text)) return 0;
      return nameNumber(text) === number ? 1 : 2;
    };
    return { query: number, keeps: (label) => alone.test(String(label ?? '')), rank, said: `With ${number} in the name` };
  }
  const words = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (words.length < 2) return null;
  return { query: words, keeps: () => true, rank: () => 0, said: `Named like “${words}”` };
}

/** The catalog request for the pictures matching `query`, newest first when there is none. */
export function picturesQuery(caseId, query = '', limit = 40) {
  return buildCatalogQuery(caseId, {
    types: PICTURE_TYPES, query: query || undefined, limit, previews: true, order: query ? 'relevance' : '-created',
  });
}

/** What a row says under its name. */
export function pictureKind(entity) {
  if (entity?.type === 'proof') return 'Proof';
  if (entity?.type === 'capture') return 'Capture';
  return entity?.attrs?.kind === 'video' ? 'Video' : 'Picture';
}

/**
 * What a personal feature's card shows (`layerCard`'s `pictures`), each opened by
 * `open(id)` on a press: the picture it names for its card, whole and alone; else
 * what it follows, the footage first, then the proof geolocating it, or the file.
 */
export function cardPictures(properties, caseId, open) {
  if (properties.picture && properties.picture_path) {
    return [{ src: fileUrl(caseId, properties.picture_path), caption: '', whole: true,
      title: `Open “${properties.picture_label || 'Untitled'}”`, open: () => open(properties.picture) }];
  }
  if (!properties.entity_id) return [];
  const proof = properties.entity_type === 'proof';
  const label = properties.entity_label || 'Untitled';
  return [
    properties.source_picture && { src: fileUrl(caseId, properties.source_picture), caption: 'Source',
      title: `Open the footage “${properties.source_label || 'Untitled'}”`, open: () => open(properties.source_id) },
    properties.entity_picture && { src: fileUrl(caseId, properties.entity_picture), caption: proof ? 'Proof' : 'Source',
      title: proof ? `Open the proof “${label}”` : `Open “${label}”`, open: () => open(properties.entity_id) },
  ].filter(Boolean);
}
