// @vitest-environment happy-dom
/**
 * Tests for the script that hands an image to a reverse-image engine
 * (extension/reverse.js).
 *
 * Like the composer's next door, what is pinned here is not the markup — that
 * will change — but the rules around it: the file goes to the engine's **own**
 * input and to the one the engine names, nothing is ever pressed (on these
 * pages the upload button *is* the file dialog), a page that never builds an
 * uploader is dropped on or reported, and nothing throws into the page.
 *
 * The source is evaluated with stubs rather than run in a second npm project
 * inside extension/. It runs in the page's world, so there is no extension API
 * to stub: the image goes in on a global and the report is the return value.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../../extension/reverse.js'), 'utf8');

class FakeDataTransfer {
  constructor() {
    this.files = [];
    this.items = { add: (file) => this.files.push(file) };
  }
}

class FakeDragEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.dataTransfer = init.dataTransfer;
  }
}

/** Chromium's: the paste carries the object it was built with. */
class FakeClipboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.clipboardData = init.clipboardData;
  }
}

/** Gecko's, which builds its own out of text and so can carry no file. */
class GeckoClipboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.clipboardData = new FakeDataTransfer();
  }
}

class FakeFile {
  constructor(parts, name, opts) {
    this.parts = parts;
    this.name = name;
    this.type = opts?.type;
  }
}

// PNG magic, the way it travels: base64, decoded on the other side.
const IMAGE = { name: 'reverse-bridge.png', type: 'image/png', data: btoa('\x89PNG') };

// Each engine's uploader as the fetched page draws it.
// Google's page: the two inputs the search box carries for its own "add files",
// both marked with a `jsname` and neither belonging to Lens, and the one Lens
// appends to the body afterwards — inline, in no dialog, named `encoded_image`.
const GOOGLE_BOX =
  '<input jsname="vhfHxd" accept="*/*" hidden type="file" />' +
  '<input jsname="wcaWdc" accept="image/avif,image/png" hidden type="file" />';
const LENS =
  `${GOOGLE_BOX}<input type="file" name="encoded_image" accept="image/png,image/webp" style="display:none" />`;
const BING =
  '<button class="sb_sbi">Browse</button>' +
  '<input id="sb_fileinput" class="fileinput" type="file" accept="image/gif, image/png" multiple />';
// Yandex's home page: the camera, and the picker it presses. Both are there
// from the first paint, which is why nothing has to be pressed.
const YANDEX =
  '<button aria-label="Image search" class="image-search__button"></button>' +
  '<input type="file" id="image-search" class="image-search__picker" />';

/**
 * Run reverse.js against a page, and resolve with what it reported plus what it
 * did: the inputs it wrote to, the buttons it pressed, and anything dropped.
 */
function run({ hostname, html, image = IMAGE, onReady }) {
  document.body.innerHTML = html;
  const inputs = [];
  const clicked = [];
  const dropped = [];
  for (const input of document.querySelectorAll('input[type="file"]')) {
    input.addEventListener('change', () =>
      inputs.push({
        input: input.getAttribute('name') ?? input.getAttribute('jsname') ?? input.className ?? '',
        files: input.files,
      })
    );
  }
  document.body.addEventListener('click', (e) => {
    const node = e.target.closest('button, [role="button"]');
    if (node) clicked.push(node.getAttribute('aria-label') ?? node.className);
  });
  document.body.addEventListener('drop', (e) => dropped.push(e.dataTransfer.files), true);
  onReady?.(document);
  if (image) window.__AZIMUT_REVERSE__ = { image };
  // Time is stubbed, and both halves of it: the script polls for what a page has
  // not drawn yet, and a page that never draws it is exactly what the last tests
  // here are about. `Date` walks forward a poll at a time so those waits run out
  // at once, and `setTimeout` stops them costing the wall clock. Both are plain
  // globals shadowed as parameters — nothing in the file knows it is in a test.
  let clock = 0;
  const FastDate = { now: () => (clock += 250) };
  const fastTimeout = (fn) => globalThis.setTimeout(fn, 0);
  // No `fetch` in scope on purpose — see the CSP test at the bottom.
  return new Function(
    'location',
    'DataTransfer',
    'DragEvent',
    'File',
    'Date',
    'setTimeout',
    // assigned rather than returned: the file opens with a doc comment, and a
    // `return` with a line break after it returns nothing at all
    `const report = ${source}\n; return report;`
  )({ hostname }, FakeDataTransfer, FakeDragEvent, FakeFile, FastDate, fastTimeout).then((report) => ({
    ...report,
    inputs,
    clicked,
    dropped,
    left: window.__AZIMUT_REVERSE__,
  }));
}

describe('handing an image to an engine', () => {
  it('gives Lens the input it names, not the search box\'s add-files', async () => {
    // On the hostname Lens redirects to: `lens.google.com` answers with
    // `www.google.com/?olud`, and the uploader is drawn on that page — inline,
    // in no dialog. Handing the picture to either `jsname` input above it plays
    // an upload animation and searches nothing at all.
    const report = await run({ hostname: 'www.google.com', html: LENS });

    expect(report.inputs).toEqual([
      {
        input: 'encoded_image',
        files: [expect.objectContaining({ name: 'reverse-bridge.png', type: 'image/png' })],
      },
    ]);
    expect(report).toMatchObject({ handed: true });
    expect(report.error).toBeUndefined();
  });

  it('still steps around those add-files inputs when Lens renames its own', async () => {
    // The fallback, which is the whole reason it carries `:not([jsname])`.
    const report = await run({
      hostname: 'www.google.com',
      html: `${GOOGLE_BOX}<input type="file" class="late" accept="image/png" />`,
    });

    expect(report.inputs).toEqual([{ input: 'late', files: [expect.anything()] }]);
  });

  it('answers to both of Lens\'s hostnames, since the redirect is the site\'s to change', async () => {
    for (const hostname of ['lens.google.com', 'www.google.com']) {
      const report = await run({ hostname, html: LENS });
      expect(report).toMatchObject({ handed: true });
    }
  });

  it('finds the input Bing hides behind its Browse button, and leaves the button alone', async () => {
    const report = await run({ hostname: 'www.bing.com', html: BING });

    expect(report.inputs).toEqual([{ input: 'fileinput', files: [expect.anything()] }]);
    // Pressing Browse is opening a native file dialog over the analyst's work.
    expect(report.clicked).toEqual([]);
  });

  it('takes the picker Yandex keeps in the page, and leaves its camera alone', async () => {
    // Pressing that camera is what opens the native file dialog, which is the
    // one thing worse here than doing nothing.
    const report = await run({ hostname: 'yandex.com', html: YANDEX });

    expect(report.inputs).toEqual([{ input: 'image-search__picker', files: [expect.anything()] }]);
    expect(report.clicked).toEqual([]);
  });

  it('drops the image on a page that never builds an uploader', async () => {
    const report = await run({ hostname: 'tineye.com', html: '<main><div class="dropzone"></div></main>' });

    expect(report.dropped).toEqual([[expect.objectContaining({ name: 'reverse-bridge.png' })]]);
    expect(report.inputs).toEqual([]);
  });

  it('says so rather than guessing when there is neither an input nor a drop road', async () => {
    // Bing, whose entry declares no drop: an upload view that drew no uploader
    // leaves nothing to try, and that is reported rather than dressed up.
    const report = await run({ hostname: 'www.bing.com', html: '<div></div>' });

    expect(report).toMatchObject({ handed: false, error: expect.stringMatching(/Could not give the image/) });
    expect(report.inputs).toEqual([]);
  });

  it('refuses an engine it does not know, since its markup was never read', async () => {
    const report = await run({ hostname: 'example.com', html: '<input type="file" />' });

    expect(report).toMatchObject({ handed: false, error: expect.stringMatching(/does not know this engine/) });
    expect(report.inputs).toEqual([]);
  });

  it('keeps nothing of the case in the page', async () => {
    const report = await run({ hostname: 'lens.google.com', html: LENS });

    expect(report.left).toBeUndefined();
  });

  it('does nothing at all when the worker handed over no image', async () => {
    const report = await run({ hostname: 'lens.google.com', html: LENS, image: null });

    expect(report).toMatchObject({ handed: false });
    expect(report.inputs).toEqual([]);
    expect(report.error).toBeUndefined();
  });

  it('skips an input the page is holding back', async () => {
    const report = await run({
      hostname: 'www.bing.com',
      html: '<input type="file" accept="image/*" disabled /><input type="file" accept="image/*" class="live" />',
    });

    expect(report.inputs).toEqual([{ input: 'live', files: [expect.anything()] }]);
  });

  it('builds the file from base64, because a fetch here answers to the engine', async () => {
    // It runs in the page's world, so `fetch('data:…')` is a connection the site
    // decides on, and these are exactly the sites that allow none.
    expect(source).not.toMatch(/\bfetch\s*\(/);

    const report = await run({ hostname: 'lens.google.com', html: LENS });

    expect([...report.inputs[0].files[0].parts[0]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('reports a page that blows up instead of throwing into it', async () => {
    const report = await run({
      hostname: 'lens.google.com',
      html: LENS,
      onReady: (doc) => {
        Object.defineProperty(doc.querySelector('input[name="encoded_image"]'), 'files', {
          set() {
            throw new Error('the uploader is gone');
          },
        });
      },
    });

    expect(report).toMatchObject({ handed: false, error: 'the uploader is gone' });
  });
});
