import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./TimelineTrackEditor.svelte', import.meta.url), 'utf8');

describe('Timeline track editor', () => {
  it('uses the shared Search+ builder and registry vocabulary', () => {
    expect(source).toContain("import FilterBar from './FilterBar.svelte'");
    expect(source).toContain('types={typeOptions}');
    expect(source).toContain('typeName={entityLabel}');
    expect(source).toContain('toGraphQuery(filter, { types: wantedTypes })');
  });

  it('keeps category, connector and time role as separate filters', () => {
    expect(source).toContain('Timeline entries');
    expect(source).toContain('Match the Search+ question through');
    expect(source).toContain('<option value="source">Evidence</option>');
    expect(source).toContain('<legend>Time role</legend>');
  });

  it('offers the track a colour of its own, and the category colours as the default', () => {
    expect(source).toContain('<legend>Colour</legend>');
    expect(source).toContain('{#each TRACK_COLORS as option (option)}');
    expect(source).toContain('style:background={trackTint(option)}');
    expect(source).toContain('onclick={() => (color = \'\')}');
    expect(source).toContain('title="By category"');
    expect(source).toContain('color = track?.color ?? \'\'');
    expect(source).toContain('      color,');
  });

  it("offers the Media Library's working-files switch on a track that holds files", () => {
    expect(source).toContain("{#if categories.has('media')}");
    expect(source).toContain('Include working files');
    expect(source).toContain("collected_only: categories.has('media') && collectedOnly,");
    expect(source).toContain('collectedOnly = track?.query?.collected_only === true;');
  });

  it('keeps a file lane drawing its files through an edit', () => {
    expect(source).toContain('as_files: track?.query?.as_files,');
  });
});
