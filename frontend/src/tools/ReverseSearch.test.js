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

  it('decides the road before it awaits, since the button is a real link', () => {
    // A preventDefault that comes back after a promise comes back too late: the
    // tab would already be opening, and the extension would open a second one.
    expect(source).toContain('function pressEngine(event, engine)');
    expect(source).toContain('if (!filled.includes(engine))');
    expect(source).toContain('event.preventDefault();');
    expect(source).toContain('fillEngine(engine);');
  });

  it('hands the image over only with the extension there and the switch on', () => {
    expect(source).toContain(
      "const filled = $derived(prefs.reversePrefill && extInstalled ? UPLOAD_PAGES.filter((e) => e.fill) : []);"
    );
    expect(source).toContain('const extInstalled = extensionVersion();');
    // An engine the extension cannot fill keeps its old group, so a heading
    // never promises more than the buttons under it do.
    expect(source).toContain('const pasteLeft = $derived(PASTE.filter((e) => !filled.includes(e)));');
    expect(source).toContain('const dragLeft = $derived(DRAG.filter((e) => !filled.includes(e)));');
  });

  it('falls back to the two gestures whenever the hand-off is refused', () => {
    // Absent, switched off, silent, or an image too big to carry: one answer,
    // one fallback, and it is the road that always worked.
    expect(source).toContain('blob.size <= MAX_HANDOFF_BYTES');
    expect(source).toContain("window.open(engine.url, '_blank', 'noopener,noreferrer');");
    expect(source).toContain('if (engine.paste) toast(`Opened ${engine.label}. Paste the ${frameLabel} with Ctrl+V`');
    expect(source).toContain('else savePng(blob, `Opened ${engine.label}. Drag the saved ${frameLabel} in`);');
  });

  it('copies the image once, while this tab still has the focus to do it', () => {
    // The extension's own notice says the image is on the clipboard, so it has
    // to be — and the encode is shared with the hand-off rather than run twice.
    expect(source).toContain('const pending = pngBlob();\n    copyPng(pending);');
    expect(source).toContain('blob = await pending;');
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
