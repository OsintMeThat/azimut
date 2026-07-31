import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ReverseSearch.svelte', import.meta.url), 'utf8');

describe('Reverse Search case picker', () => {
  it('starts from a searchable image/video media list', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain("m.kind === 'image' || m.kind === 'video'");
    expect(source).toContain('bind:value={mediaQuery}');
    expect(source).toContain('filteredPickerMedia.filter((m) => matchesMediaName(m, mediaQuery))');
    expect(source).toContain('{#each pickableMedia as item (item.path)}');
    expect(source).toContain('placeholder="Search names…"');
    expect(source).toContain('function matchesMediaName(item, query)');
    expect(source).toContain("matchesTerms(item.title || item.filename || '', query)");
    expect(source).not.toContain("item.filename !== item.title");
  });

  it('separates reverse-search sources by media type and provenance', () => {
    expect(source).toContain("{ id: 'all', label: 'All' }");
    expect(source).toContain("{ id: 'capture', label: 'Captures' }");
    expect(source).toContain("{ id: 'frame', label: 'Frames' }");
    expect(source).toContain("{ id: 'collage', label: 'Collages' }");
    expect(source).toContain("source.type === 'satellite' || source.type === 'screenshot'");
    expect(source).toContain("source.op === 'frame' || source.op === 'adjust'");
    expect(source).toContain("source.op === 'collage'");
  });

  it('offers the same read-only folder browser as Inspect', () => {
    expect(source).toContain("import FolderBrowser from '../components/FolderBrowser.svelte'");
    expect(source).toContain('title="Browse folders"');
    expect(source).toContain('onconfirm={(m) => selectPickerBrowser(m, true)}');
    expect(source).toContain('disabled={!pickerBrowseSelection} onclick={confirmPickerBrowser}');
    expect(source).toContain('function togglePickerBrowser()');
    expect(source).toContain('Use selected');
  });

});
