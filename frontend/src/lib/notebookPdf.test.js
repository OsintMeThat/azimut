import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadNotebookPdf, notebookPdfHtml, prepareNotebookPdfContent } from './notebookPdf.js';

const origin = 'http://127.0.0.1:8477';

afterEach(() => vi.unstubAllGlobals());

describe('notebook PDF export', () => {
  it('keeps local case images and omits remote media', () => {
    const document = new Window().document;
    const content = prepareNotebookPdfContent(
      '<img src="/files/case-1/media/map.png" srcset="https://example.test/map@2x.png 2x"><img src="https://example.test/map.png"><video src="/files/case-1/media/clip.mp4"></video>',
      origin,
      document,
    );

    expect(content).toContain('/files/case-1/media/map.png');
    expect(content).not.toContain('srcset=');
    expect(content).not.toContain('https://example.test/map.png');
    expect(content).toContain('External image not included in PDF.');
    expect(content).toContain('Video not included in PDF.');
  });

  it('builds a print-ready A4 document with the note title', () => {
    const document = new Window().document;
    const html = notebookPdfHtml({
      title: 'Field Notes',
      content: '<h2>Finding</h2><p>Confirmed.</p>',
      origin,
      document,
    });

    expect(html).toContain('@page { size: A4;');
    expect(html).toContain('<title>Field Notes</title>');
    expect(html).toContain('<h1>Field Notes</h1>');
    expect(html).toContain('<h2>Finding</h2>');
  });

  it('opens a print window from the download action', async () => {
    const document = new Window().document;
    let onLoad;
    const printWindow = {
      document,
      addEventListener: (_type, callback) => { onLoad = callback; },
      focus: vi.fn(),
      print: vi.fn(),
    };
    const open = vi.fn(() => printWindow);
    vi.stubGlobal('window', { location: { origin }, open });

    expect(downloadNotebookPdf({ title: 'Case Notes', content: '<p>Ready.</p>' })).toBe(true);
    expect(open).toHaveBeenCalledWith('', '_blank');

    onLoad();
    await Promise.resolve();
    expect(printWindow.focus).toHaveBeenCalledOnce();
    expect(printWindow.print).toHaveBeenCalledOnce();
  });
});
