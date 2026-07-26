import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EntityDetails.svelte', import.meta.url), 'utf8');

describe('capture details', () => {
  it('shows the recorded external capture page as a link', () => {
    expect(source).toContain('{#if infoData?.source_url}');
    expect(source).toContain('<span class="info-k">Source page</span>');
    expect(source).toContain('href={infoData.source_url}');
    expect(source).toContain('target="_blank" rel="noreferrer"');
  });
});
