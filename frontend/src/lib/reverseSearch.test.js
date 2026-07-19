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

  it('flags Google Lens as the only paste engine; the rest are drag-only', () => {
    expect(byId.google.paste).toBe(true);
    expect(byId.yandex.paste).toBe(false);
    expect(byId.bing.paste).toBe(false);
    expect(byId.tineye.paste).toBe(false);
  });
});
