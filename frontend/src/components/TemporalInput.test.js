import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./TemporalInput.svelte', import.meta.url), 'utf8');

describe('temporal input', () => {
  it('labels the guided fields and shows a readable preview', () => {
    expect(source).toContain('<span>Precision</span>');
    expect(source).toContain('<span>Date</span>');
    expect(source).toContain('<span>Certainty</span>');
    expect(source).toContain('class="temporal-preview"');
    expect(source).toContain('reading.label');
  });

  it('reports invalid input before save', () => {
    expect(source).toContain('onvaliditychange?.(formatTemporalValue(sent))');
    expect(source).toContain('aria-invalid={!reading.valid}');
    expect(source).toContain('reading.error');
  });

  it('keeps the full syntax reference out of the form flow', () => {
    expect(source).toContain('<summary>Syntax guide</summary>');
    expect(source).toContain('position: absolute');
    expect(source).toContain('max-height: min(360px, 55vh)');
  });
});

describe('temporal input in a narrow column', () => {
  it('sizes its own controls, since a caller cannot style into a component', () => {
    expect(source).toContain('.input-sm { padding: 4px 7px; font-size: var(--fs-xs); }');
  });

  it('pairs the parts and hides the captions rather than stacking four rows', () => {
    expect(source).toContain('class:compact');
    expect(source).toContain('.compact .date-parts { grid-template-columns: auto minmax(0, 1fr); }');
    expect(source).toContain('clip-path: inset(50%)');
  });

  it('keeps the labels in the markup, where a screen reader still reads them', () => {
    // The compact rule hides them visually. Removing them would take the
    // accessible name of every wrapping label with it.
    expect(source).toContain('<span>Precision</span>');
    expect(source).toContain('<span>Certainty</span>');
  });

  it('holds the syntax guide to the column it opens in', () => {
    expect(source).toContain('.compact .advanced-guide { width: 100%; }');
  });
});
