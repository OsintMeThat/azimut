/**
 * Getting a plate out of the tab: to a file, or onto the clipboard.
 *
 * The document itself is written by the surfaces (`lib/graphPlate.js`,
 * `lib/timelinePlate.js`); what is left here is where it goes. The file is posted back
 * for the backend to write, the way the notes PDF is: an export lands in the folder the
 * analyst chose for this kind of work, and the browser has no way to write there.
 *
 * The clipboard gets a PNG, never the SVG. Nothing pastes an SVG — not a document, not
 * a chat — so a "Copy image" that copied the vector would copy nothing anybody could
 * use. The pixels come from the same page the file holds, rasterised here.
 */

import { api } from './api.js';
import { rasterScale, rasterise } from './notesExport.js';

/** Twice the page, so a raster of a vector plate is not soft, and capped where a
 *  browser canvas stops being dependable. */
export const PLATE_SCALE = 2;
export const PLATE_MAX_EDGE = 4000;

/**
 * What the raster of this plate will really be, as a factor of the page.
 *
 * The cap bites well before the largest plate: a page wider than 2000 units comes back
 * under 2×, and the widest one comes back smaller than itself. The dialog asks for this
 * number rather than promising a factor the canvas will not give.
 */
export const plateScale = ({ width, height }) =>
  rasterScale({ width, height, scale: PLATE_SCALE, maxEdge: PLATE_MAX_EDGE });

export function plateToPng(svg, { width, height }) {
  return rasterise(svg, { width, height, scale: PLATE_SCALE, maxEdge: PLATE_MAX_EDGE });
}

/** Write the plate into the destination saved for analysis views. */
export async function writePlate(caseId, plate, { format = 'svg', toPng = plateToPng } = {}) {
  const { svg, width, height, filename } = plate;
  const body = format === 'png'
    ? { filename, format, png: await toPng(svg, { width, height }) }
    : { filename, format, svg };
  return api.post(`/api/cases/${caseId}/plates`, body);
}

export const revealPlates = (caseId) => api.post(`/api/cases/${caseId}/plates/reveal`);

export function pngBlob(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: 'image/png' });
}

/**
 * Put the plate on the clipboard as an image.
 *
 * A browser that cannot write an image says so rather than reporting a copy that did
 * not happen: the analyst would paste the last thing they copied and never know.
 */
export async function copyPlateImage(plate, { toPng = plateToPng, clipboard } = {}) {
  const target = clipboard ?? (typeof navigator === 'undefined' ? null : navigator.clipboard);
  if (!target?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('this browser cannot copy an image');
  }
  const base64 = await toPng(plate.svg, { width: plate.width, height: plate.height });
  await target.write([new ClipboardItem({ 'image/png': pngBlob(base64) })]);
}
