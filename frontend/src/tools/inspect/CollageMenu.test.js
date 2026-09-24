import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CollageMenu.svelte', import.meta.url), 'utf8');

describe('CollageMenu scope', () => {
  it('acts on the collage it is handed, and no longer switches between several', () => {
    expect(source).toContain('let { collage: active, selectedIds = $bindable([]), requestCrop, renderPiece } = $props();');
    expect(source).not.toContain('session.');
    expect(source).not.toContain('addCollage');
  });
});

describe('CollageMenu canvas', () => {
  it('holds a typed side inside the bounds compose accepts, in the field too', () => {
    expect(source).toContain(`    const next = clampCollageDim(event.currentTarget.value, active[axis]);
    active[axis] = next;
    event.currentTarget.value = next;`);
    expect(source).toContain('min={COLLAGE_MIN_DIM}');
    expect(source).toContain('max={COLLAGE_MAX_DIM}');
  });

  it('names both fields for a screen reader, which has no × to read', () => {
    expect(source).toContain('aria-label="Canvas width in pixels"');
    expect(source).toContain('aria-label="Canvas height in pixels"');
  });

  it('resizes the canvas to what the solver asked for', () => {
    expect(source).toContain('applyCanvas(res.canvas, new Set(res.nodes.map((n) => n.index)));');
  });

  it('carries the pieces the solver could not place into the new canvas', () => {
    expect(source).toContain(`      active.nodes.forEach((n, i) => {
        if (!placed.has(i)) n.quad = n.quad.map(([x, y]) => [x * scale, y * scale]);
      });`);
  });

  it('leaves the canvas alone when the answer matches what is there', () => {
    expect(source).toContain('if (width === active.width && height === active.height) return;');
  });

  it('brings the canvas back with the undo, not just the pieces', () => {
    expect(source).toContain(
      'const before = { nodes: nodes.map(snapshot), width: active.width, height: active.height };'
    );
    expect(source).toContain(`    active.width = undoSnap.width;
    active.height = undoSnap.height;`);
  });
});
