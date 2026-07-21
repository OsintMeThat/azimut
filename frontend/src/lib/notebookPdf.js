function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mediaNote(document, message) {
  const note = document.createElement('p');
  note.className = 'pdf-media-note';
  note.textContent = message;
  return note;
}

/** Keep PDF export local: local images print, while remote media never loads. */
export function prepareNotebookPdfContent(content, origin, document = globalThis.document) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = content;

  for (const source of wrapper.querySelectorAll('source')) source.remove();
  for (const element of wrapper.querySelectorAll('[srcset]')) element.removeAttribute('srcset');
  for (const element of wrapper.querySelectorAll('[style]')) {
    if (/url\s*\(/i.test(element.getAttribute('style'))) element.removeAttribute('style');
  }

  for (const video of wrapper.querySelectorAll('video, audio')) {
    video.replaceWith(mediaNote(document, 'Video not included in PDF.'));
  }

  for (const image of wrapper.querySelectorAll('img')) {
    const source = image.getAttribute('src');
    let isLocal = false;
    try {
      isLocal = new URL(source, origin).origin === origin;
    } catch {
      // An invalid source cannot be part of the export.
    }
    if (!isLocal) image.replaceWith(mediaNote(document, 'External image not included in PDF.'));
  }

  return wrapper.innerHTML;
}

export function notebookPdfHtml({ title, content, origin, document = globalThis.document }) {
  const safeTitle = escapeHtml(title || 'Case Notes');
  const body = prepareNotebookPdfContent(content, origin, document);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <base href="${escapeHtml(origin)}/">
    <title>${safeTitle}</title>
    <style>
      @page { size: A4; margin: 18mm 16mm 20mm; }
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #202124; background: #fff; font: 10.5pt/1.6 Georgia, 'Times New Roman', serif; }
      .document-header { margin-bottom: 11mm; padding-bottom: 5mm; border-bottom: 1.5pt solid #bd7a25; }
      .document-kicker { margin: 0 0 2mm; color: #8a5a1a; font: 600 8pt/1.2 Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 0; color: #181818; font: 700 25pt/1.12 Arial, sans-serif; letter-spacing: -.025em; }
      h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
      h2 { margin: 9mm 0 3mm; color: #202124; font: 700 16pt/1.2 Arial, sans-serif; }
      h3 { margin: 7mm 0 2mm; font: 700 12pt/1.25 Arial, sans-serif; }
      h4, h5, h6 { margin: 5mm 0 2mm; font: 700 10.5pt/1.3 Arial, sans-serif; }
      p, ul, ol, blockquote, pre, table { margin: 0 0 4mm; }
      ul, ol { padding-left: 6mm; }
      li + li { margin-top: 1mm; }
      a { color: #6d4515; text-decoration-color: #bd7a25; }
      blockquote { padding: 1mm 0 1mm 4mm; border-left: 2pt solid #bd7a25; color: #555; }
      code { padding: .15em .35em; border-radius: 2pt; background: #f4f1ed; font: 8.8pt/1.45 'SFMono-Regular', Consolas, monospace; }
      pre { overflow: hidden; padding: 3mm; border: .5pt solid #ddd6cc; border-radius: 2pt; background: #f8f6f3; white-space: pre-wrap; }
      pre code { padding: 0; background: transparent; }
      table { width: 100%; border-collapse: collapse; font-size: 9pt; break-inside: avoid; page-break-inside: avoid; }
      th, td { padding: 2mm 2.5mm; border: .5pt solid #d8d1c8; text-align: left; vertical-align: top; }
      th { background: #f1ece5; font-family: Arial, sans-serif; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      img { display: block; max-width: 100%; height: auto; margin: 0 0 4mm; border-radius: 2pt; break-inside: avoid; page-break-inside: avoid; }
      .markdown-image.align-center { margin-right: auto; margin-left: auto; }
      .markdown-image.align-right { margin-right: 0; margin-left: auto; }
      .markdown-align.align-center { text-align: center; }
      .markdown-align.align-right { text-align: right; }
      .entity-ref { color: #6d4515; font-weight: 700; }
      .broken-ref, .pdf-media-note { color: #777; font-style: italic; }
      .pdf-media-note { padding: 2mm 3mm; border-left: 2pt solid #d8d1c8; background: #faf8f5; }
      .document-footer { position: fixed; right: 0; bottom: -13mm; left: 0; color: #777; font: 8pt Arial, sans-serif; }
      @media print { a { color: inherit; } }
    </style>
  </head>
  <body>
    <header class="document-header"><p class="document-kicker">Azimut notes</p><h1>${safeTitle}</h1></header>
    <main>${body}</main>
    <footer class="document-footer">Generated locally from case notes</footer>
  </body>
</html>`;
}

/** Open the browser's Save-as-PDF flow from a user gesture. */
export function downloadNotebookPdf({ title, content }) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  const origin = window.location.origin;
  printWindow.document.open();
  printWindow.addEventListener('load', () => {
    const images = Array.from(printWindow.document.images ?? []);
    Promise.all(images.map((image) => image.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      })))
      .then(() => {
        printWindow.focus();
        printWindow.print();
      });
  }, { once: true });
  printWindow.document.write(notebookPdfHtml({ title, content, origin, document: printWindow.document }));
  printWindow.document.close();
  return true;
}
