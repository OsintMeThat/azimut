import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MediaLibrary.svelte', import.meta.url), 'utf8');

function cssBlock(selector) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('\n  }', start);
  return end < 0 ? '' : source.slice(start, end);
}

describe('Media Library thumbnail layout', () => {
  it('keeps every thumbnail in a fixed frame regardless of source dimensions', () => {
    const thumb = cssBlock('.thumb');

    expect(thumb).toContain('width: 100%;');
    expect(thumb).toContain('aspect-ratio: 16 / 10;');
    expect(thumb).toContain('min-height: 0;');
    expect(thumb).toContain('overflow: hidden;');
    expect(thumb).toContain('flex: 0 0 auto;');
  });

  it('prevents the thumbnail image from contributing intrinsic dimensions', () => {
    const image = cssBlock('.thumb img');

    expect(image).toContain('position: absolute;');
    expect(image).toContain('inset: 0;');
    expect(image).toContain('display: block;');
    expect(image).toContain('min-width: 0;');
    expect(image).toContain('min-height: 0;');
    expect(image).toContain('object-fit: cover;');
  });
});

describe('Media Library thumbnail states', () => {
  it('shows the image only when its thumbnail is ready and not broken', () => {
    // the ready branch is gated on thumb_state and the broken-thumb fallback set
    expect(source).toContain("item.thumb_state === 'ready' && !brokenThumbs.has(item.path)");
    // a broken <img> reports once into brokenThumbs rather than retrying
    expect(source).toContain('onerror={() => (brokenThumbs = new Set(brokenThumbs).add(item.path))}');
    // lazy + async decode per the doc's UI failure behaviour
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('decoding="async"');
  });

  it('renders a generating placeholder and a retry affordance for failures', () => {
    expect(source).toContain("item.thumb_state === 'queued' || item.thumb_state === 'running'");
    expect(source).toContain('Generating…');
    expect(source).toContain("item.thumb_state === 'failed'");
    expect(source).toContain('regenerateThumbs(item.path)');
  });

  it('polls while thumbnails are pending and only while the tool is visible', () => {
    expect(source).toContain("i.thumb_state === 'queued' || i.thumb_state === 'running'");
    expect(source).toContain("if (!thumbsPending || uiState.tool !== 'media' || !caseState.current) return;");
    expect(source).toContain('/media/thumbnails/regenerate');
  });
});
