/**
 * PDF.js, loaded the first time a page is shown and never before: the Page pane
 * and the template pictures are its only readers, and most visits to the app
 * open neither.
 *
 * One worker serves every document, so a page drawn again as the note is typed
 * does not start a new one each time. The PDFs come from this app's own server,
 * and are read with scripting off all the same.
 */
let loading = null;

function loadPdfjs() {
  // `?worker&url` has our build bundle the worker as a module of its own, with a `.js`
  // name every server types as a script (as `lib/map/engine.js` does for the map's)
  loading ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?worker&url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return { pdfjs, worker: new pdfjs.PDFWorker({ name: 'azimut-pages' }) };
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** A PDF's bytes, opened to draw its pages. The bytes are handed over, not copied. */
export async function openPdf(bytes) {
  const { pdfjs, worker } = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    worker,
    isEvalSupported: false,
    enableXfa: false,
  });
  return task.promise;
}

/** The pixels per CSS pixel a page is drawn at: the screen's, never past two. */
export function pageScale(ratio = globalThis.devicePixelRatio) {
  return Math.min(2, Math.max(1, Number(ratio) || 1));
}

/**
 * Draw one page of an open PDF on a canvas `cssWidth` wide, at the screen's
 * sharpness. Resolves with the canvas, or rejects when `signal` cancels it.
 */
export async function drawPage(doc, index, cssWidth, { canvas = document.createElement('canvas'), signal } = {}) {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const ratio = pageScale();
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.round(viewport.height / ratio)}px`;
  const task = page.render({ canvas, viewport });
  const stop = () => task.cancel();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', stop);
  }
  return canvas;
}

/** A canvas given up: its pixels are let go now rather than when it is collected. */
export function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}
