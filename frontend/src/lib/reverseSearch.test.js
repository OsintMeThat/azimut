import { describe, it, expect } from 'vitest';
import { UPLOAD_PAGES } from './reverseSearch.js';

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
