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
