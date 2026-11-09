import { describe, it, expect } from 'vitest';
import {
  hasProofCanvasContent, isPublishedProof, publishedBoxes, publishedPage, surfaces, surfaceHitTest,
  surfaceFrame, toSpec, withInkOnPage, proofExportOptions,
} from './composer.js';

/**
 * A proof imported as published: its spec lists the pictures under `published` and holds
 * no panel. The page is the pictures, stacked as published, at their own size.
 */
const picture = (id, w, h, extra = {}) => ({ id, asset: `${id.padEnd(16, '0')}.png`, natural: [w, h], ...extra });

describe('a proof that is a published picture', () => {
  it('is told apart by its published list, and has something to draw', () => {
    expect(isPublishedProof({ panels: [], published: [picture('u1', 40, 30)] })).toBe(true);
    expect(isPublishedProof({ panels: [], published: [] })).toBe(false);
    expect(isPublishedProof({ panels: [] })).toBe(false);
    expect(hasProofCanvasContent({ panels: [], published: [picture('u1', 40, 30)] })).toBe(true);
    expect(hasProofCanvasContent({ panels: [] })).toBe(false);
  });

  it('stacks its pictures top to bottom, centred on the widest, with no margin', () => {
    const published = [picture('u1', 300, 200), picture('u2', 310, 100), picture('u3', 320, 50)];
    expect(publishedBoxes(published).map(({ x, y, w, h, scale }) => ({ x, y, w, h, scale }))).toEqual([
      { x: 10, y: 0, w: 300, h: 200, scale: 1 },
      { x: 5, y: 200, w: 310, h: 100, scale: 1 },
      { x: 0, y: 300, w: 320, h: 50, scale: 1 },
    ]);
    // the same page `engine/proofimport.published_page` writes
    expect(publishedPage(published)).toEqual({ width: 320, height: 350 });
    expect(publishedBoxes([picture('u1', 401, 10), picture('u2', 400, 10)])[1].x).toBe(0);
  });

  it('is one picture the size it was published, so the page is that picture', () => {
    expect(publishedPage([picture('u1', 1200, 675)])).toEqual({ width: 1200, height: 675 });
  });

  it('takes marks like any picture: a surface behind everything, hit where it is drawn', () => {
    const proof = { panels: [], pastes: [{ id: 'x1', asset: 'a.png', natural: [10, 10], x: 0, y: 0, scale: 1 }],
      published: [picture('u1', 200, 100)] };
    const list = surfaces(proof);
    expect(list.map((one) => [one.id, one.kind])).toEqual([['x1', 'paste'], ['u1', 'published']]);
    const hit = surfaceHitTest(list, { x: 150, y: 50 });
    expect(hit.id).toBe('u1');
    expect(hit.nx).toBeCloseTo(150);
    expect(surfaceFrame(list[1]).box).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('saves its pictures, and a proof that is not one saves exactly as before', () => {
    const base = { title: 'P', panels: [], pastes: [], shapes: [], notes: {} };
    const plain = toSpec(base);
    expect(plain).not.toHaveProperty('published');

    const spec = toSpec({
      ...base,
      published: [{ ...picture('u1', 40, 30, { url: 'https://x.com/a/1' }), sourceNatural: [40, 30], img: {} }],
    });
    expect(spec.published).toEqual([
      { id: 'u1', asset: 'u100000000000000.png', natural: [40, 30], url: 'https://x.com/a/1' },
    ]);
    expect(spec.panels).toEqual([]);
  });

  it('opens a spec from before page ink without moving its picture', () => {
    const spec = { panels: [], published: [picture('u1', 200, 100)],
      shapes: [{ id: 's', panel: 'u1', kind: 'rect', x: 1, y: 1, w: 5, h: 5, strokeWidth: 4 }] };
    const opened = withInkOnPage(spec);
    expect(opened.published).toEqual(spec.published);
    expect(opened.shapes[0].strokeWidth).toBe(4); // a published picture is at scale 1
  });

  it('exports at its own pixels, where a composition is drawn larger', () => {
    expect(proofExportOptions(1200, 675, { native: true })).toEqual({ pixelRatio: 1, outputWidth: 1200, outputHeight: 675 });
    expect(proofExportOptions(1200, 675).pixelRatio).toBe(1.5);
  });
});
