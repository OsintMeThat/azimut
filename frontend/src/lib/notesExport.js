/**
 * Exporting notes as PDF.
 *
 * The document itself is built by the backend (`engine/notes_pdf.py`), which
 * reads each note's Markdown from disk rather than this preview: no print
 * dialog, no popup to allow, and a whole selection of notes in one request.
 *
 * What is left here is the one thing a server cannot do. Mermaid is JavaScript,
 * so the export asks which fences the selection holds, draws each one in this
 * tab, and posts the pictures back under the keys it was given.
 */

import { api } from './api.js';
import { renderMermaidSvg } from './mermaid.js';

/** Rasterised at twice the page size, so a diagram is not soft in print. */
const DIAGRAM_SCALE = 2;
const MAX_DIAGRAM_EDGE = 2400;

/**
 * Draw an SVG onto a canvas and hand back the PNG, base64 without its header.
 *
 * Diagrams are rendered with HTML labels off (see lib/mermaid.js), because a
 * `<foreignObject>` is HTML inside the picture and browsers refuse to rasterise
 * one out of an image element — the diagram would come back with empty boxes.
 *
 * `scale` and `maxEdge` are the diagram's own numbers by default. An analysis plate
 * (lib/plateExport.js) is a whole page rather than a figure on one, so it raises the
 * ceiling; the pair stays here because there is one way to turn an SVG into pixels.
 */
/**
 * The scale a rasterisation will actually use: what was asked for, or what the edge cap
 * leaves of it. Exported so a caller can say the real number before offering the image
 * rather than promising a factor the canvas will not give.
 */
export function rasterScale({ width, height, scale = DIAGRAM_SCALE, maxEdge = MAX_DIAGRAM_EDGE }) {
  return Math.min(scale, maxEdge / Math.max(width, height, 1));
}

export function rasterise(svg, { width, height, scale: wanted = DIAGRAM_SCALE, maxEdge = MAX_DIAGRAM_EDGE }) {
  return new Promise((resolve, reject) => {
    const scale = rasterScale({ width, height, scale: wanted, maxEdge });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const image = new Image();
    image.addEventListener('load', () => {
      const context = canvas.getContext('2d');
      // The page is white and an SVG is transparent; without this the diagram
      // prints on a black rectangle wherever the canvas started empty.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png').split(',')[1] ?? '');
    }, { once: true });
    image.addEventListener(
      'error',
      () => reject(new Error('diagram could not be drawn')),
      { once: true },
    );
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * Draw every pending fence, as `{ key: base64 png }`.
 *
 * A diagram that fails to draw is left out rather than failing the export: the
 * backend prints the fence's own source in its place, which beats losing the
 * note over one bad diagram.
 */
export async function drawDiagrams(pending, { draw = renderMermaidSvg, toPng = rasterise } = {}) {
  const diagrams = {};
  for (const { key, source } of pending) {
    try {
      const drawn = await draw(source);
      diagrams[key] = await toPng(drawn.svg, drawn);
    } catch {
      // Left to the backend, which keeps the diagram's source visible.
    }
  }
  return diagrams;
}

/**
 * Write one PDF per note into the case's exports folder.
 *
 * `noteIds` holds note entity ids, and `case` for the case's own scratchpad.
 * Nothing unsaved travels: the backend reads each note from disk, which is why
 * the caller flushes a pending edit before calling this.
 */
export async function exportNotes(caseId, noteIds, options = {}) {
  const { diagrams: pending } = await api.post(`/api/cases/${caseId}/notes/pdf/diagrams`, {
    notes: noteIds,
  });
  const diagrams = pending.length ? await drawDiagrams(pending, options) : {};
  return api.post(`/api/cases/${caseId}/notes/pdf`, { notes: noteIds, diagrams });
}

export function revealExports(caseId) {
  return api.post(`/api/cases/${caseId}/notes/pdf/reveal`);
}
