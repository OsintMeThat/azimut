/**
 * The first page of a template, drawn small for the Notebook's gallery and for
 * Settings: the real PDF the server prints for it (`templates/note/preview`,
 * which needs no case), its page 1 drawn by PDF.js and kept as a picture.
 *
 * Drawn one at a time, only when a tile is seen, and kept in memory for the
 * tab's life by what the template holds, so an edited template is drawn again
 * and an unchanged one never is.
 */
import { normaliseLook, templateLook } from './look.js';
import { fetchPreview } from './preview.js';
import { drawPage, openPdf, releaseCanvas } from './pdfjs.js';
import { filledBody } from './ready.js';

const THUMB_WIDTH = 180;
const KEPT = 40;

const kept = new Map();
let line = Promise.resolve();

export function thumbKey({ name = '', body = '', look = null } = {}) {
  return JSON.stringify([String(name), String(body), normaliseLook(look)]);
}

/** For tests: forget the pictures drawn so far. */
export function forgetThumbs() {
  kept.clear();
  line = Promise.resolve();
}

function canvasUrl(canvas) {
  return canvas.toDataURL('image/png');
}

/**
 * A picture of page 1 of `template` (`{ name, body, look }`), as a data URL.
 * The same template asks once; one that failed is tried again next time.
 */
export function templateThumb(template, { fetch = fetchPreview, open = openPdf, draw = drawPage, toUrl = canvasUrl } = {}) {
  const key = thumbKey(template);
  const known = kept.get(key);
  if (known) return known;
  const made = line.catch(() => {}).then(async () => {
    const answer = await fetch({
      title: String(template.name ?? ''),
      text: filledBody(template.body ?? ''),
      look: templateLook(template.look),
    });
    const doc = await open(answer.data);
    let canvas = null;
    try {
      canvas = await draw(doc, 0, THUMB_WIDTH);
      return toUrl(canvas);
    } finally {
      releaseCanvas(canvas);
      void doc.destroy?.();
    }
  });
  line = made;
  kept.set(key, made);
  while (kept.size > KEPT) kept.delete(kept.keys().next().value);
  made.catch(() => { if (kept.get(key) === made) kept.delete(key); });
  return made;
}
