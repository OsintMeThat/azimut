import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ReverseSearch.svelte', import.meta.url), 'utf8');

describe('Reverse Search case picker', () => {
  it('picks from the same file list as Inspect, not a copy of it', () => {
    expect(source).toContain("import SourcePicker from '../components/SourcePicker.svelte'");
    expect(source).toContain("m.kind === 'image' || m.kind === 'video'");
    expect(source).not.toContain('FolderBrowser');
    expect(source).not.toContain('SearchInput');
  });

  it("presses its engines through the one hand-off Inspect's zone search uses", () => {
    // The roads, the extension's fill and every fallback live in lib/reverseHandoff.js,
    // tested there; this tool only says what its picture is.
    expect(source).toContain("import { filledEngines, pressEngine } from '../lib/reverseHandoff.js';");
    expect(source).toContain('const filled = $derived(filledEngines(prefs.reversePrefill, extInstalled));');
    expect(source).toContain('const extInstalled = extensionVersion();');
    expect(source).toContain("const picture = () => ({ png: pngBlob, name: downloadName(), what: frameLabel });");
    expect(source.match(/onclick=\{\(event\) => pressEngine\(event, e, picture\(\), filled\)\}/g)).toHaveLength(3);
    expect(source).not.toContain('handOffReverse');
    expect(source).not.toContain('navigator.clipboard');
  });

  it('keeps an engine the extension cannot fill under its old heading', () => {
    expect(source).toContain('const pasteLeft = $derived(PASTE.filter((e) => !filled.includes(e)));');
    expect(source).toContain('const dragLeft = $derived(DRAG.filter((e) => !filled.includes(e)));');
  });
});
