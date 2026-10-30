/**
 * The analyst's own icons as the browser draws them: where each picture is read
 * from, and the pictures already read, so a palette of a hundred icons and the
 * maps wearing them ask for each one once.
 *
 * A library icon is read from the library. A layer reads the copy it keeps
 * (`layerediting.adopt_icon`), which is what draws when the library has lost it
 * or the case came from another machine.
 */
import { inkBox } from './markerGlyphs.js';

export const libraryIconUrl = (key) => `/api/icons/${key}.png`;
/**
 * A layer's copy of an icon. `version` is `iconVersion(row)`: a refresh can
 * draw another picture under the same key, as a My Maps renumbers its
 * `images/icon-N.png`, and a new address is what lets the browser and the map
 * drop the old one. Without it the server asks the browser to check again.
 */
export const layerIconUrl = (caseId, layer, key, version = '') =>
  `/api/cases/${caseId}/map-layers/${encodeURIComponent(layer)}/icons/${key}${version ? `?v=${encodeURIComponent(version)}` : ''}`;

/**
 * The version a row's icons are read at: the hash of a source's snapshot, which
 * moves exactly when its bytes do. A personal layer never refreshes, so its
 * icons keep one address wherever they are read.
 */
export const iconVersion = (row) => (row?.editable ? '' : String(row?.sha256 ?? '').slice(0, 16));

/** How many decoded pictures are kept; the oldest goes first. */
const KEEP = 400;
const pending = new Map();
const ready = new Map();

/** A picture and the box it paints in, `{ image, box }`, or null when it cannot be read. */
export function loadPicture(url, load = loadImage) {
  if (!url) return Promise.resolve(null);
  let asked = pending.get(url);
  if (!asked) {
    asked = load(url).then((image) => {
      if (!image) { pending.delete(url); return null; }
      const picture = { image, box: inkBox(image) };
      ready.set(url, picture);
      return picture;
    }, () => { pending.delete(url); return null; });
    pending.set(url, asked);
    if (pending.size > KEEP) {
      const [oldest] = pending.keys();
      pending.delete(oldest);
      ready.delete(oldest);
    }
  }
  return asked;
}

/** The picture once it is read, else null: what a drawing made in one pass can use. */
export function readyPicture(url) {
  return ready.get(url) ?? null;
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (typeof Image !== 'function') { resolve(null); return; }
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
