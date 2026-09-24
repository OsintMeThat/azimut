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
});
