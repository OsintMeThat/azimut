import { describe, it, expect } from 'vitest';
import { UPLOAD_PAGES, normalizeReverseTarget } from './reverseSearch.js';

describe('UPLOAD_PAGES', () => {
  const byId = Object.fromEntries(UPLOAD_PAGES.map((p) => [p.id, p]));

  it('covers the four key-less engines', () => {
    expect(Object.keys(byId).sort()).toEqual(['bing', 'google', 'tineye', 'yandex']);
  });

  it('gives every engine a label and an https search page', () => {
    for (const { label, url } of UPLOAD_PAGES) {
      expect(label).toBeTruthy();
      expect(url.startsWith('https://')).toBe(true);
    }
  });

  it("opens Bing's upload view, not the page that redirects to marketing", () => {
    // /visualsearch answers with explore.microsoft.com, which has nothing to
    // drop a file on and no uploader to hand one to.
    expect(byId.bing.url).toContain('iss=sbiupload');
    expect(byId.bing.url).not.toContain('visualsearch');
  });

  it('lets the extension reach every one of them', () => {
    // Each is declared in the manifest and answered for in extension/reverse.js;
    // an engine flagged here that neither knows would open and do nothing.
    expect(UPLOAD_PAGES.every((e) => e.fill)).toBe(true);
  });

  it('flags Google Lens as the only paste engine; the rest are drag-only', () => {
    expect(byId.google.paste).toBe(true);
    expect(byId.yandex.paste).toBe(false);
    expect(byId.bing.paste).toBe(false);
    expect(byId.tineye.paste).toBe(false);
  });
});

describe('normalizeReverseTarget', () => {
  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  it('takes a case image by its path, and names it after the file when nothing else does', () => {
    expect(normalizeReverseTarget({ path: 'media/quai.jpg', kind: 'image' })).toEqual({
      path: 'media/quai.jpg',
      blob: null,
      kind: 'image',
      label: 'quai.jpg',
      time: null,
    });
  });

  it('keeps the moment a video should open on, and only for a video', () => {
    expect(normalizeReverseTarget({ path: 'media/clip.mp4', kind: 'video', time: 12.5 }).time).toBe(12.5);
    expect(normalizeReverseTarget({ path: 'media/clip.mp4', kind: 'video', time: 0 }).time).toBe(0);
    expect(normalizeReverseTarget({ path: 'media/clip.mp4', kind: 'video' }).time).toBeNull();
    expect(normalizeReverseTarget({ path: 'media/clip.mp4', kind: 'video', time: -3 }).time).toBeNull();
    expect(normalizeReverseTarget({ path: 'media/clip.mp4', kind: 'video', time: 'soon' }).time).toBeNull();
    expect(normalizeReverseTarget({ path: 'media/quai.jpg', kind: 'image', time: 4 }).time).toBeNull();
  });

  it('refuses what an engine cannot be handed: a document, an audio file, no kind at all', () => {
    expect(normalizeReverseTarget({ path: 'media/report.pdf', kind: 'file' })).toBeNull();
    expect(normalizeReverseTarget({ path: 'media/call.mp3', kind: 'audio' })).toBeNull();
    expect(normalizeReverseTarget({ path: 'media/quai.jpg' })).toBeNull();
  });

  it('refuses a path that leaves the case, on either separator', () => {
    for (const path of ['/etc/passwd', '../other/a.jpg', 'media/../../a.jpg', 'media\\..\\a.jpg', 'C:/a.jpg', '']) {
      expect(normalizeReverseTarget({ path, kind: 'image' }), path).toBeNull();
    }
  });

  it('carries a picture held only in memory as the image itself', () => {
    const blob = png();
    const picture = normalizeReverseTarget({ blob, label: 'clip.mp4 · 00:12', path: 'ignored.jpg', kind: 'video' });
    expect(picture).toEqual({ path: null, blob, kind: 'image', label: 'clip.mp4 · 00:12', time: null });
  });

  it('refuses a blob that is empty or not an image', () => {
    expect(normalizeReverseTarget({ blob: new Blob([], { type: 'image/png' }) })).toBeNull();
    expect(normalizeReverseTarget({ blob: new Blob(['x'], { type: 'text/html' }) })).toBeNull();
  });

  it('answers null for nothing at all', () => {
    expect(normalizeReverseTarget(null)).toBeNull();
    expect(normalizeReverseTarget('media/quai.jpg')).toBeNull();
  });
});
