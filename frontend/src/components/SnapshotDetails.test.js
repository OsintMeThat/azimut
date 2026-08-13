import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SnapshotDetails.svelte', import.meta.url), 'utf8');

describe('snapshot details', () => {
  it('states the read-only boundary and shows every captured layer', () => {
    expect(source).toContain('Captured data. Nothing here edits the case.');
    expect(source).toContain('Captured photos');
    expect(source).toContain('Object.entries(entity.attrs ?? {})');
    expect(source).toContain('Provenance');
    expect(source).toContain('Captured relations');
  });

  it('renders embedded previews instead of reaching back into live case files', () => {
    expect(source).toContain('<img src={image.data}');
    expect(source).not.toContain('fileUrl');
  });
});
