// @vitest-environment happy-dom
/**
 * Tests for the script that fills a composer (extension/handoff.js).
 *
 * It is the one file that knows another site's DOM, so what is pinned here is
 * not the markup — that will change — but the two roads in and the rule around
 * them: a post is typed (`insertText`, the browser's own editing command) or
 * pasted, whichever road that site answers to, and the box is **read back and
 * counted** either way — an editor takes a post without saying so, refuses one
 * without saying so, and X's puts it in six times. A file is handed to the
 * composer's **own file input**. Nothing is ever submitted, and every way the
 * page can disappoint ends in a report of how far it got rather than a throw.
 *
 * Like the worker's suite next door, the source is evaluated with stubs instead
 * of a second npm project inside extension/. It runs in the page's world, so
 * there is no extension API to stub: the thread goes in on a global and the
 * report is the script's own return value.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../../extension/handoff.js'), 'utf8');

class FakeDataTransfer {
  constructor() {
    this.text = null;
    this.files = [];
    this.items = { add: (file) => this.files.push(file) };
  }
  setData(type, value) {
    if (type === 'text/plain') this.text = value;
  }
  getData(type) {
    return (type === 'text/plain' ? this.text : null) ?? '';
  }
}

class FakeClipboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.clipboardData = init.clipboardData;
  }
}

/**
 * Gecko's, which reads a different member.
 *
 * Its `ClipboardEventInit` has no `clipboardData`: it builds a clipboard of its
 * own out of `data`, which is text and nothing else. Not assumed — run against
 * both engines before it was written down here.
 */
class GeckoClipboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.clipboardData = new FakeDataTransfer();
    if (init.dataType === 'text/plain') this.clipboardData.setData('text/plain', init.data);
  }
}

class FakeDragEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.dataTransfer = init.dataTransfer;
  }
}

class FakeFile {
  constructor(parts, name, opts) {
    this.parts = parts;
    this.name = name;
    this.type = opts?.type;
  }
}

const BOX = (i) => `<div data-testid="tweetTextarea_${i}" contenteditable="true" tabindex="0"></div>`;
// X draws an empty post's placeholder as a sibling carrying the same test id
// with `_label` on the end — a match for the selector that is not a box.
const PLACEHOLDER = (i) => `<div data-testid="tweetTextarea_${i}_label">What is happening?!</div>`;
const FILE_INPUT = (i) => `<input type="file" data-testid="fileInput" data-post="${i}" />`;
const PNG = { name: 'proof.png', type: 'image/png', data: btoa('\x89PNG') };

/**
 * Run handoff.js against a page, and resolve with what it reported plus what it
 * did: where each post **landed** whichever road took it there, the two roads
 * separately for the tests that are about which one a site takes, and the files
 * it handed over.
 *
 * The stubbed composer takes both a keystroke and a paste, because the real ones
 * do — `takesPaste: false` and `canType: false` are how a test closes a road.
 */
function run({
  hostname = 'x.com', pathname = '/', posts, html, reply = false, thread = {},
  canType = true, takesPaste = true, gecko = false,
  onPaste, onAttach, onType, onReady,
}) {
  document.body.innerHTML = html;
  const landed = [];
  const typed = [];
  const pastes = [];
  const attached = [];
  const dropped = [];
  const idOf = (el) => el.dataset.testid ?? el.className;
  // The stub writes where the **selection** is, like the browser's own command,
  // which is the whole point of placing the caret: focus alone left every post's
  // text going into the first box. It answers `selectAll`/`delete` too, the pair
  // an editor implements itself and the only way this script empties a box.
  //
  // It writes and then reports **refused**, which is what a real editor handling
  // the keystroke itself does — it cancels the browser's default. Trusting that
  // verdict put the post in a second time.
  const selectedAll = new Set();
  document.execCommand = vi.fn((command, _ui, value) => {
    const anchor = window.getSelection()?.anchorNode;
    const node = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
    const box = node?.closest?.('[contenteditable="true"]');
    if (!box) return false;
    if (command === 'selectAll') return !!selectedAll.add(box);
    if (command === 'delete') {
      if (selectedAll.delete(box)) box.textContent = '';
      return true;
    }
    if (command !== 'insertText' || !canType) return false;
    typed.push({ box: idOf(box), text: value });
    landed.push({ box: idOf(box), text: value });
    box.textContent += value;
    onType?.(box, value);
    return false;
  });
  for (const box of document.querySelectorAll('[contenteditable="true"]')) {
    box.addEventListener('paste', (e) => {
      const text = e.clipboardData.text;
      pastes.push({ box: idOf(box), text, files: e.clipboardData.files });
      if (takesPaste && text) {
        landed.push({ box: idOf(box), text });
        box.textContent += text;
      }
      onPaste?.(box, e);
    });
  }
  for (const input of document.querySelectorAll('input[type="file"]')) {
    input.addEventListener('change', () => {
      attached.push({ input: input.dataset.testid, files: input.files });
      onAttach?.(input);
    });
  }
  document.body.addEventListener('drop', (e) => dropped.push(e.dataTransfer.files));
  onReady?.(document);
  window.__AZIMUT_HANDOFF__ = { ...(reply ? { posts, reply } : { posts }), ...thread };
  // No `fetch` in scope on purpose — see the CSP test at the bottom.
  return new Function(
    'location',
    'DataTransfer',
    'ClipboardEvent',
    'DragEvent',
    'File',
    // assigned rather than returned: the file opens with a doc comment, and a
    // `return` with a line break after it returns nothing at all
    `const report = ${source}\n; return report;`
  )(
    { hostname, pathname },
    FakeDataTransfer,
    gecko ? GeckoClipboardEvent : FakeClipboardEvent,
    FakeDragEvent,
    FakeFile
  ).then((report) => ({
    ...report,
    landed,
    typed,
    pastes,
    attached,
    dropped,
  }));
}

describe('filling a thread', () => {
  it('puts each post into its own box and gives its files to that post\'s input', async () => {
    const report = await run({
      posts: [
        { text: 'Geolocated.', files: [PNG] },
        { text: 'Context.', files: [] },
      ],
      // the second box appears when the add button is pressed; the page here
      // already holds both, which is what the script sees after that click
      html: `${BOX(0)}${FILE_INPUT(0)}${BOX(1)}${FILE_INPUT(1)}<button data-testid="addButton"></button>`,
    });

    expect(report.filled).toBe(2);
    expect(report.error).toBeUndefined();
    expect(report.landed).toEqual([
      { box: 'tweetTextarea_0', text: 'Geolocated.' },
      { box: 'tweetTextarea_1', text: 'Context.' },
    ]);
    // the picture goes to the first post's own input, not to whichever one the
    // page drew first — a thread whose images all land on post 1 is worse than none
    expect(report.attached).toEqual([
      { input: 'fileInput', files: [expect.objectContaining({ name: 'proof.png' })] },
    ]);
  });

  it('takes the road the site answers to, and does not try the other one', async () => {
    // X's editor rebuilds itself around what `insertText` wrote and hands back
    // the post several times over. The loop below catches that and clears it, so
    // the thread came out right — but the analyst is watching the composer, and
    // what they saw was a post written six times and wiped. It is pasted into.
    const report = await run({
      posts: [{ text: 'Geolocated.', files: [] }],
      html: BOX(0),
    });

    expect(report.filled).toBe(1);
    expect(report.pastes).toEqual([{ box: 'tweetTextarea_0', text: 'Geolocated.', files: [] }]);
    expect(report.typed).toEqual([]); // nothing to clear, nothing to watch
  });

  it('falls back to a paste where the browser will not type for it', async () => {
    const report = await run({
      hostname: 'bsky.app', // this one is typed into first; the paste is behind it
      canType: false,
      posts: [{ text: 'Geolocated.', files: [] }],
      html: '<div role="dialog"><div class="ProseMirror" contenteditable="true"></div></div>',
    });

    expect(report.filled).toBe(1);
    expect(report.pastes).toEqual([{ box: 'ProseMirror', text: 'Geolocated.', files: [] }]);
  });

  it('says which post the composer refused instead of leaving it blank in silence', async () => {
    const report = await run({
      canType: false, // and a composer that takes neither road: nothing lands
      takesPaste: false,
      posts: [{ text: 'One.', files: [] }],
      html: BOX(0),
    });

    expect(report).toMatchObject({ filled: 0, error: 'Post 1 stayed empty.' });
  });

  it('is pasted into on the engine that spells a clipboard the other way', async () => {
    // What took X's thread apart on Firefox. The event was built the one way
    // Chromium reads, so Gecko's composer took an empty clipboard, the post went
    // in by keystroke instead, and **X never registered it**: the text sat in the
    // box, the site went on calling the post empty, and the "+" it draws over a
    // written post was not there. The thread stopped at the post after it, on a
    // composer that looked filled. It is spelled both ways now; this is the
    // other engine reading its own.
    const report = await run({
      gecko: true,
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: `<div role="dialog">${BOX(0)}${BOX(1)}<button data-testid="addButton"></button></div>`,
    });

    expect(report.filled).toBe(2);
    expect(report.error).toBeUndefined();
    expect(report.pastes).toEqual([
      { box: 'tweetTextarea_0', text: 'One.', files: [] },
      { box: 'tweetTextarea_1', text: 'Two.', files: [] },
    ]);
    expect(report.typed).toEqual([]); // the site's own road, on both engines
  });

  it('carries what went wrong into the stop, rather than reporting the stop alone', async () => {
    // The two belong together: an empty post is *why* the composer would not
    // open the next one, and the stop on its own reads like the markup moved.
    const report = await run({
      canType: false,
      takesPaste: false,
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: BOX(0),
    });

    expect(report).toMatchObject({
      filled: 0,
      error: 'Post 1 stayed empty. Could not add the next post to the thread.',
    });
  }, 15000); // three attempts at the post, then the wait the add button is owed

  it('falls back to a paste where the composer keeps no file input', async () => {
    const report = await run({
      posts: [{ text: '', files: [PNG] }],
      html: BOX(0),
    });

    expect(report.filled).toBe(1);
    expect(report.pastes).toEqual([
      { box: 'tweetTextarea_0', text: null, files: [expect.objectContaining({ name: 'proof.png' })] },
    ]);
  });

  it('drops that file on the page instead, where a paste cannot carry one', async () => {
    const report = await run({
      gecko: true,
      posts: [{ text: '', files: [PNG] }],
      html: BOX(0),
    });

    expect(report.filled).toBe(1);
    expect(report.pastes).toEqual([]);
    expect(report.dropped.flat()).toEqual([expect.objectContaining({ name: 'proof.png' })]);
  });

  it('leaves a box that already holds something, whatever it holds', async () => {
    // The first post arrives with its text in the URL and the composer's copy is
    // never character for character what was sent, so comparing the two typed the
    // whole post in again, halfway through the text already there.
    const page = document.createElement('div');
    page.innerHTML = BOX(0);
    page.firstChild.textContent = '\u2066Geolocated.\u2069'; // bidi-isolated, as X keeps it
    const report = await run({
      posts: [{ text: 'Geolocated.', files: [] }],
      html: page.innerHTML,
    });

    expect(report.filled).toBe(1);
    expect(report.landed).toEqual([]); // nothing written twice
    expect(report.pastes).toEqual([]);
  });

  it('stops at the post it could not open, and says so', async () => {
    // no add button: half a thread filled beats none, and the rest is one paste
    // away because the app copied it before opening anything
    const report = await run({
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: BOX(0),
    });

    expect(report.filled).toBe(1);
    expect(report.error).toMatch(/add the next post/);
  });

  it('reports a site it does not know rather than guessing at its markup', async () => {
    const report = await run({ hostname: 'threads.net', posts: [{ text: 'x' }], html: BOX(0) });

    expect(report).toMatchObject({ filled: 0, error: expect.stringContaining('does not know') });
  });

  it('writes past the placeholder X hangs on an empty post', async () => {
    // The placeholder carries the same test id with `_label` on the end, so it
    // matched the editor selector and, holding the words *What is happening?!*,
    // read as a post already written. Post 2 was skipped in silence. A composer
    // box is contenteditable; a placeholder never is.
    const report = await run({
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: `${BOX(0)}${PLACEHOLDER(1)}${BOX(1)}<button data-testid="addButton"></button>`,
    });

    expect(report.filled).toBe(2);
    expect(report.landed).toEqual([
      { box: 'tweetTextarea_0', text: 'One.' },
      { box: 'tweetTextarea_1', text: 'Two.' },
    ]);
  });

  it('fills the composer on screen, not the one the timeline keeps behind it', async () => {
    // Opening the composer by URL draws it over the timeline, which has a box of
    // its own — and that one comes first in the document.
    const report = await run({
      posts: [{ text: 'One.', files: [] }],
      html: `<div id="timeline">${BOX(0)}</div><div role="dialog">${BOX(9)}</div>`,
    });

    expect(report.filled).toBe(1);
    expect(report.landed).toEqual([{ box: 'tweetTextarea_9', text: 'One.' }]);
  });

  it('does not call an emptied input a refusal, nor stop the thread over one', async () => {
    // A composer empties its file input as soon as it has read it, so that
    // picking the same picture twice still fires a change. Reading it back after
    // that found nothing and reported "Post 1 would not take its files" about
    // the attachment sitting in the composer — and, being fatal, cost post 2.
    const report = await run({
      posts: [{ text: 'One.', files: [PNG] }, { text: 'Two.', files: [] }],
      html: `${BOX(0)}${FILE_INPUT(0)}${BOX(1)}<button data-testid="addButton"></button>`,
      onAttach: (input) => { input.files = []; }, // the site reads and clears
    });

    expect(report.filled).toBe(2);
    expect(report.error).toBeUndefined();
    expect(report.landed).toEqual([
      { box: 'tweetTextarea_0', text: 'One.' },
      { box: 'tweetTextarea_1', text: 'Two.' },
    ]);
  });

  it('does not write a post twice when the editor cancels the command it obeyed', async () => {
    // `insertText` reports refused whenever the editor handled the keystroke
    // itself and cancelled the browser's default — with the text already in.
    // Falling back on that verdict put post 2 in a second time. The paste road is
    // closed here, which is what puts this run on the typing one.
    const report = await run({
      takesPaste: false,
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: `${BOX(0)}${BOX(1)}<button data-testid="addButton"></button>`,
    });

    expect(report.typed).toEqual([
      { box: 'tweetTextarea_0', text: 'One.' },
      { box: 'tweetTextarea_1', text: 'Two.' },
    ]);
    expect(document.querySelector('[data-testid="tweetTextarea_1"]').textContent).toBe('Two.');
  });

  it('empties the box and tries again when the post goes in more than once', async () => {
    // An editor that rebuilds its own DOM around what the browser wrote comes
    // back holding the post several times over — post 2 on X came out six deep.
    // "Not empty" is not the same question as "filled", so what the box holds is
    // counted, and the next attempt starts from empty rather than adding to it.
    let echoed = 0;
    const echo = (box, text) => {
      if (box.dataset.testid === 'tweetTextarea_1' && echoed++ === 0) box.textContent += text;
    };
    const report = await run({
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: `${BOX(0)}${BOX(1)}<button data-testid="addButton"></button>`,
      onType: echo,
      onPaste: (box, e) => echo(box, e.clipboardData.text),
    });

    expect(report.filled).toBe(2);
    expect(report.error).toBeUndefined();
    expect(document.querySelector('[data-testid="tweetTextarea_1"]').textContent).toBe('Two.');
  });

  it('leaves the box empty rather than a post that says everything six times', async () => {
    // Nothing left in a composer beats a mangled thread: the analyst pastes it
    // in, which is what they did before any of this existed.
    const report = await run({
      posts: [{ text: 'One.', files: [] }],
      html: BOX(0),
      // an editor that echoes everything it is given, by either road
      onType: (box, text) => { box.textContent += text; },
      onPaste: (box, e) => { box.textContent += e.clipboardData.text; },
    });

    expect(report).toMatchObject({ filled: 0, error: 'Post 1 went in more than once.' });
    expect(document.querySelector('[data-testid="tweetTextarea_0"]').textContent).toBe('');
  });

  it('presses the composer\'s add button, not the one the timeline keeps', async () => {
    const pressed = [];
    const report = await run({
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: `<div id="timeline">${BOX(7)}<button data-testid="addButton" data-where="timeline"></button></div>`
        + `<div role="dialog">${BOX(0)}${BOX(1)}<button data-testid="addButton" data-where="dialog"></button></div>`,
      onReady: (doc) => {
        for (const add of doc.querySelectorAll('[data-testid="addButton"]')) {
          add.addEventListener('click', () => pressed.push(add.dataset.where));
        }
      },
    });

    expect(pressed).toEqual(['dialog']);
    expect(report.landed).toEqual([
      { box: 'tweetTextarea_0', text: 'One.' },
      { box: 'tweetTextarea_1', text: 'Two.' },
    ]);
  });

  it('waits out a "+" the composer holds back while it reads an attachment', async () => {
    // X takes the button away, or refuses it, until it has finished reading what
    // was just handed over — and a video is read for far longer than a picture.
    // Read the moment it was wanted, it was not there yet, and a thread carrying
    // a clip stopped at the post after it.
    let pressed = 0;
    const report = await run({
      posts: [{ text: 'One.', files: [PNG] }, { text: 'Two.', files: [] }],
      html: `<div role="dialog">${BOX(0)}${FILE_INPUT(0)}`
        + '<button data-testid="addButton" aria-disabled="true"></button></div>',
      onAttach: (input) => {
        const add = input.parentElement.querySelector('[data-testid="addButton"]');
        setTimeout(() => add.removeAttribute('aria-disabled'), 1500);
      },
      onReady: (doc) => {
        const add = doc.querySelector('[data-testid="addButton"]');
        add.addEventListener('click', () => {
          pressed += 1;
          if (add.getAttribute('aria-disabled') === 'true') return;
          const box = doc.createElement('div');
          box.dataset.testid = 'tweetTextarea_1';
          box.setAttribute('contenteditable', 'true');
          add.before(box);
        });
      },
    });

    expect(pressed).toBe(1); // the one it was refusing was never pressed
    expect(report.filled).toBe(2);
    expect(report.landed).toEqual([
      { box: 'tweetTextarea_0', text: 'One.' },
      { box: 'tweetTextarea_1', text: 'Two.' },
    ]);
  });

  it('presses a button that listens for the pointer rather than the click', async () => {
    // Bluesky's "+" is a React Native for Web pressable: it hangs its press on
    // the pointer sequence, and it is not a `button` element either. A lone
    // `click()` on a selector asking for the tag pressed nothing at all, so the
    // thread stopped at post 1 while the run reported it filled.
    let pressed = 0;
    const report = await run({
      hostname: 'bsky.app',
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: '<div role="dialog"><div class="ProseMirror" contenteditable="true"></div>'
        + '<div role="button" aria-label="Add another post to thread"></div></div>',
      onReady: (doc) => {
        const add = doc.querySelector('[role="button"]');
        add.addEventListener('pointerup', () => {
          pressed += 1;
          const box = doc.createElement('div');
          box.className = 'ProseMirror';
          box.setAttribute('contenteditable', 'true');
          add.after(box);
        }, { once: true });
      },
    });

    expect(pressed).toBe(1);
    expect(report.filled).toBe(2);
    expect([...document.querySelectorAll('.ProseMirror')].map((box) => box.textContent))
      .toEqual(['One.', 'Two.']);
  });

  it('opens a new box for the post after one that carries only a picture', async () => {
    // Two real things at once: a post with a picture and no text leaves its box
    // empty, and a composer that re-renders hands back a different element for
    // the same post — so the box just filled is not even in the document any
    // more. "The first empty box" then meant the picture's, and post 3's text
    // landed on post 2. The box the add button opened is the one at the end.
    let opened = 1;
    const report = await run({
      posts: [{ text: 'One.', files: [] }, { text: '', files: [PNG] }, { text: 'Three.', files: [] }],
      html: `<div role="dialog">${BOX(0)}${FILE_INPUT(0)}<button data-testid="addButton"></button></div>`,
      onReady: (doc) => {
        const add = doc.querySelector('[data-testid="addButton"]');
        add.addEventListener('click', () => {
          for (const box of doc.querySelectorAll('[contenteditable="true"]')) {
            box.replaceWith(box.cloneNode(true)); // the composer redraws what it holds
          }
          const box = doc.createElement('div');
          box.dataset.testid = `tweetTextarea_${opened++}`;
          box.setAttribute('contenteditable', 'true');
          add.before(box);
        });
      },
    });

    expect(report.filled).toBe(3);
    expect(report.landed).toEqual([
      { box: 'tweetTextarea_0', text: 'One.' },
      { box: 'tweetTextarea_2', text: 'Three.' },
    ]);
    expect([...document.querySelectorAll('[contenteditable="true"]')].map((box) => box.textContent))
      .toEqual(['One.', '', 'Three.']);
  });

  it('finds the "+" by its glyph, where the site translated the label', async () => {
    // Bluesky translates it: in French the label reads *Ajouter un autre post au
    // fil de discussion*, which holds none of the words the selector was asking
    // for — so the thread stopped at post 1 in every language but English.
    // Loosening the label is not the answer either: *Ajouter un média au post*
    // sits one seat along in the same footer, and it opens a file picker.
    const plus = '<svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 1 1v7h7a1 1 0 1 1 0 2h-7v7a1 1 0'
      + ' 1 1-2 0v-7H4a1 1 0 1 1 0-2h7V4a1 1 0 0 1 1-1Z"></path></svg>';
    const pressed = [];
    const report = await run({
      hostname: 'bsky.app',
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: '<div role="dialog"><div class="ProseMirror" contenteditable="true"></div>'
        + '<div role="button" aria-label="Ajouter un média au post">'
        + '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"></path></svg></div>'
        + `<div role="button" aria-label="Ajouter un autre post au fil de discussion">${plus}</div></div>`,
      onReady: (doc) => {
        for (const button of doc.querySelectorAll('[role="button"]')) {
          button.addEventListener('pointerup', () => {
            pressed.push(button.getAttribute('aria-label'));
            if (!button.querySelector('path[d^="M12 3"]')) return; // the picker opens nothing here
            const box = doc.createElement('div');
            box.className = 'ProseMirror';
            box.setAttribute('contenteditable', 'true');
            button.after(box);
          }, { once: true });
        }
      },
    });

    expect(pressed).toEqual(['Ajouter un autre post au fil de discussion']);
    expect(report.filled).toBe(2);
    expect([...document.querySelectorAll('.ProseMirror')].map((box) => box.textContent))
      .toEqual(['One.', 'Two.']);
  });

  it('adds under the last post, where a composer draws a button beneath each one', async () => {
    // Bluesky draws a footer under every post, so it draws an add button under
    // every post: only the one at the end appends, and the others open a post in
    // the middle of the thread that the run then never writes into.
    const pressed = [];
    const report = await run({
      hostname: 'bsky.app',
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: '<div role="dialog"><div class="ProseMirror" contenteditable="true">One.</div>'
        + '<div role="button" aria-label="Add another post to thread" data-under="1"></div>'
        + '<div role="button" aria-label="Add another post to thread" data-under="2"></div></div>',
      onReady: (doc) => {
        for (const add of doc.querySelectorAll('[role="button"]')) {
          add.addEventListener('pointerup', () => {
            pressed.push(add.dataset.under);
            const box = doc.createElement('div');
            box.className = 'ProseMirror';
            box.setAttribute('contenteditable', 'true');
            add.after(box);
          }, { once: true });
        }
      },
    });

    expect(pressed).toEqual(['2']);
    expect(report.filled).toBe(2);
    expect([...document.querySelectorAll('.ProseMirror')].map((box) => box.textContent))
      .toEqual(['One.', 'Two.']);
  });

  it('drops a picture on the body for a composer that keeps no file input', async () => {
    // Bluesky picks files through an input it makes, clicks and throws away, so
    // there is nothing to hand one to. What it does keep is a `drop` listener on
    // the body, feeding the same reader as its paste.
    const report = await run({
      hostname: 'bsky.app',
      posts: [{ text: 'Geolocated.', files: [PNG] }],
      html: '<div role="dialog"><div class="ProseMirror" contenteditable="true"></div></div>',
    });

    expect(report.filled).toBe(1);
    expect(report.typed).toEqual([{ box: 'ProseMirror', text: 'Geolocated.' }]);
    expect(report.dropped).toEqual([[expect.objectContaining({ name: 'proof.png' })]]);
    expect(report.pastes).toEqual([]);
  });

  it('builds one file from the byte-array slices the worker streamed in', async () => {
    const streamed = {
      name: 'clip.mp4',
      type: 'video/mp4',
      parts: [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
    };
    const report = await run({
      posts: [{ text: '', files: [streamed] }],
      html: `${BOX(0)}${FILE_INPUT(0)}`,
    });

    const file = report.attached[0].files[0];
    expect(file).toEqual(expect.objectContaining({ name: 'clip.mp4', type: 'video/mp4' }));
    expect(file.parts.map((part) => [...part])).toEqual([[1, 2], [3, 4]]);
    expect(streamed.parts).toEqual([]); // the descriptor no longer pins a second copy
  });

  it('keeps the base64 path for an older worker without fetching through the site', async () => {
    // It runs in the page's world, so `fetch('data:…')` is a connection the site
    // decides on — and X allows none to `data:`. The compatibility path decodes
    // the old payload directly instead.
    expect(source).not.toMatch(/\bfetch\s*\(/);

    const report = await run({
      posts: [{ text: '', files: [PNG] }],
      html: `${BOX(0)}${FILE_INPUT(0)}`,
    });

    expect(report.attached).toEqual([
      { input: 'fileInput', files: [expect.objectContaining({ name: 'proof.png' })] },
    ]);
    // decoded to bytes, not handed over as the string it travelled as
    expect([...report.attached[0].files[0].parts[0]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('never submits: the only button it presses is the one that threads', async () => {
    // Listener on the body, before the page is drawn, so every button click
    // inside it is counted whatever the script reaches for. (It also clicks the
    // boxes, which is how a composer knows which post is being typed into.)
    const clicked = [];
    document.body.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') clicked.push(e.target.dataset.testid);
    });

    const report = await run({
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: `${BOX(0)}${BOX(1)}<button data-testid="addButton"></button><button data-testid="tweetButton"></button>`,
    });

    expect(report.filled).toBe(2);
    expect(clicked).toEqual(['addButton']); // and never tweetButton
  });
});

describe('a reply under the source', () => {
  // X's status page: the post it answers above, the source post, and the box drawn
  // under it. Its reply opens the full composer as a dialog, which is what threads.
  const POST = (id, own) => `<article data-testid="tweet" tabindex="${own ? '-1' : '0'}">
    <a href="/someone/status/${id}"><time datetime="2026-11-01">Nov 1</time></a>
    <button data-testid="reply" data-post="${id}"></button></article>`;
  const PAGE = `${POST('100', false)}${POST('200', true)}${BOX('inline')}`;
  const opensDialog = (doc, pressed) => {
    for (const button of doc.querySelectorAll('[data-testid="reply"]')) {
      button.addEventListener('click', () => {
        pressed.push(button.dataset.post);
        const dialog = doc.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.innerHTML = `${BOX(0)}${FILE_INPUT(0)}`;
        doc.body.append(dialog);
        const box = dialog.querySelector('[contenteditable]');
        box.addEventListener('paste', (e) => { box.textContent += e.clipboardData.text; });
      });
    }
  };

  it('presses the source post\'s reply, never the one above it, and fills the box it opens', async () => {
    const pressed = [];
    const report = await run({
      pathname: '/someone/status/200', reply: true, html: PAGE,
      posts: [{ text: 'Geolocated.', files: [PNG] }],
      onReady: (doc) => opensDialog(doc, pressed),
    });
    expect(pressed).toEqual(['200']);
    expect(report.filled).toBe(1);
    expect(report.error).toBeUndefined();
    expect(document.querySelector('[role="dialog"] [contenteditable]').textContent).toBe('Geolocated.');
    // the box drawn under the post is left alone
    expect(document.querySelector('[data-testid="tweetTextarea_inline"]').textContent).toBe('');
  });

  it('says so, and fills nothing, when the reply box does not open', async () => {
    const report = await run({
      pathname: '/someone/status/200', reply: true, html: PAGE,
      posts: [{ text: 'Geolocated.', files: [] }],
    });
    expect(report.filled).toBe(0);
    expect(report.error).toBe('Could not open the reply box under the source post.');
    expect(document.querySelector('[data-testid="tweetTextarea_inline"]').textContent).toBe('');
  }, 20000);

  it('fills a thread without a reply where it always did, the reply buttons untouched', async () => {
    const pressed = [];
    const report = await run({
      html: `${BOX(0)}${POST('200', true)}`,
      posts: [{ text: 'Geolocated.', files: [] }],
      onReady: (doc) => opensDialog(doc, pressed),
    });
    expect(pressed).toEqual([]);
    expect(report.filled).toBe(1);
  });
});

describe('a reply the site lets out one post at a time', () => {
  // X's reply dialog as a logged-in French account draws it: the source quoted on
  // top, the box, a toolbar of icons, the counter and Répondre. No "+".
  const TOOLBAR = `<div data-testid="toolBar">${FILE_INPUT(0)}
    <button data-testid="gifSearchButton"></button><button data-testid="createPollButton"></button>
    <button aria-label="Emoji"></button><button data-testid="scheduleOption"></button>
    <button data-testid="geoButton"></button></div>
    <div role="progressbar" aria-valuenow="20"></div>
    <button data-testid="tweetButton"><span>Répondre</span></button>`;
  const SOURCE = `<article data-testid="tweet" tabindex="-1">
    <a href="/someone/status/200"><time datetime="2026-11-11">9:00</time></a>
    <button data-testid="reply"></button></article>`;
  const opens = (doc, { add = false } = {}) => {
    doc.querySelector('[data-testid="reply"]').addEventListener('click', () => {
      const dialog = doc.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = `<div data-testid="tweetText">The source post, quoted.</div>${BOX(0)}${TOOLBAR}`
        + (add ? '<button data-testid="addButton"></button>' : '');
      doc.body.append(dialog);
      const box = dialog.querySelector('[contenteditable]');
      box.addEventListener('paste', (e) => { box.textContent += e.clipboardData.text; });
    });
  };
  const sendsPressed = () => {
    const pressed = [];
    document.body.addEventListener('click', (e) => {
      const button = e.target.closest?.('button');
      if (button) pressed.push(button.dataset.testid ?? button.getAttribute('aria-label'));
    });
    return pressed;
  };

  it('fills the first post and says the dialog offers no next one, pressing nothing else', async () => {
    const pressed = sendsPressed();
    const report = await run({
      pathname: '/someone/status/200', reply: true, thread: { ask: true }, html: SOURCE,
      posts: [{ text: 'Geolocated.', files: [PNG] }],
      onReady: (doc) => opens(doc),
    });
    expect(report).toMatchObject({ filled: 1, add: false });
    expect(report.error).toBeUndefined();
    expect(document.querySelector('[role="dialog"] [contenteditable]').textContent).toBe('Geolocated.');
    expect(pressed).toEqual(['reply']); // and never Répondre
  }, 20000);

  it('says the dialog offers a next post when it draws a "+"', async () => {
    const pressed = sendsPressed();
    const report = await run({
      pathname: '/someone/status/200', reply: true, thread: { ask: true }, html: SOURCE,
      posts: [{ text: 'Geolocated.', files: [] }],
      onReady: (doc) => opens(doc, { add: true }),
    });
    expect(report).toMatchObject({ filled: 1, add: true });
    expect(pressed).toEqual(['reply']); // asked about, not pressed
  });

  it('adds the rest under the post already in the composer', async () => {
    const page = document.createElement('div');
    page.innerHTML = `<div role="dialog">${BOX(0)}${FILE_INPUT(0)}${FILE_INPUT(1)}`
      + '<button data-testid="addButton"></button></div>';
    page.querySelector('[contenteditable]').textContent = 'One.';
    const inputs = [];
    const report = await run({
      html: page.innerHTML,
      thread: { more: true, number: 2 },
      onAttach: (input) => inputs.push(input.dataset.post),
      posts: [{ text: 'Two.', files: [PNG] }, { text: 'Three.', files: [] }],
      onReady: (doc) => {
        const add = doc.querySelector('[data-testid="addButton"]');
        add.addEventListener('click', () => {
          const n = doc.querySelectorAll('[contenteditable]').length;
          const box = doc.createElement('div');
          box.dataset.testid = `tweetTextarea_${n}`;
          box.setAttribute('contenteditable', 'true');
          box.addEventListener('paste', (e) => { box.textContent += e.clipboardData.text; });
          add.before(box);
        });
      },
    });
    expect(report).toEqual(expect.objectContaining({ filled: 2 }));
    expect([...document.querySelectorAll('[contenteditable]')].map((box) => box.textContent))
      .toEqual(['One.', 'Two.', 'Three.']);
    // post 2's picture goes to post 2's own input, the second in the composer
    expect(report.attached.map((one) => one.files[0].name)).toEqual(['proof.png']);
    expect(inputs).toEqual(['1']);
  }, 20000);

  it('names a post by its place in the whole thread', async () => {
    const report = await run({
      html: BOX(0), canType: false, takesPaste: false, thread: { number: 3 },
      posts: [{ text: 'Three.', files: [] }],
    });
    expect(report).toMatchObject({ filled: 0, error: 'Post 3 stayed empty.', step: 'fill-3' });
  });

  it('carries the step it stopped on and what the page held there', async () => {
    const report = await run({
      posts: [{ text: 'One.', files: [] }, { text: 'Two.', files: [] }],
      html: `<div role="dialog">${BOX(0)}${TOOLBAR}</div>`,
    });
    expect(report).toMatchObject({ filled: 1, step: 'add-2', error: expect.stringMatching(/add the next post/) });
    expect(report.probe).toEqual({
      selectors: { editors: [1, 1], add: [0, 0], files: [1, 1, 1], reply: [0] },
      scope: 'dialog',
      buttons: ['fileInput', 'gifSearchButton', 'createPollButton', 'scheduleOption', 'geoButton', 'tweetButton'],
      unnamed: 0,
    });
  }, 20000);

  it('reads the page for a report and fills nothing, in counts and test ids only', async () => {
    const report = await run({
      html: `<main>${SOURCE}<div data-testid="UserAvatar-Container-desk" role="button"></div>`
        + '<div data-testid="tweetText">Words on the page.</div></main>',
      thread: { probe: true },
      posts: [{ text: 'Never typed.', files: [] }],
    });
    expect(report.filled).toBe(0);
    expect(report.landed).toEqual([]);
    expect(report.probe).toMatchObject({ scope: 'page', buttons: ['reply'], unnamed: 1 });
    expect(JSON.stringify(report.probe)).not.toMatch(/desk|someone|Words|status/);
  });

  it('asks Bluesky\'s reply composer for its "+" by the glyph', async () => {
    const report = await run({
      hostname: 'bsky.app', reply: true, thread: { ask: true },
      html: '<button data-testid="replyPromptBtn"></button>',
      posts: [{ text: 'Geolocated.', files: [] }],
      onReady: (doc) => {
        doc.querySelector('[data-testid="replyPromptBtn"]').addEventListener('click', () => {
          const dialog = doc.createElement('div');
          dialog.setAttribute('role', 'dialog');
          dialog.innerHTML = '<div class="ProseMirror" contenteditable="true"></div>'
            + '<div role="button" aria-label="Ajouter un autre post au fil de discussion">'
            + '<svg><path d="M12 3a1 1 0 0 1 1 1v7h7a1 1 0 1 1 0 2h-7v7a1 1 0 1 1-2 0v-7H4"></path></svg></div>';
          doc.body.append(dialog);
          const box = dialog.querySelector('[contenteditable]');
          box.addEventListener('paste', (e) => { box.textContent += e.clipboardData.text; });
        });
      },
    });
    expect(report).toMatchObject({ filled: 1, add: true });
  }, 20000);
});

/**
 * A picture's description, once the thread is in. The markup below is what tools that
 * read X's and Bluesky's composers describe, never the live page: X's thumbnail wears
 * an "Add description" link whose label carries a test id and opens a dialog holding
 * the description box and Save; Bluesky's wears an ALT button whose dialog keeps the
 * text as it closes. What is pinned is the rule: each text goes to its own picture,
 * nothing that sends is pressed, and a page that does not offer the control costs
 * that post its descriptions and nothing else.
 */
describe('describing the pictures', () => {
  const X_PICTURES = (n) => `<div data-testid="attachments">${Array.from({ length: n }, (_, i) =>
    `<div role="group"><div role="link" aria-label="Add description" data-picture="${i}">`
    + '<span data-testid="altTextLabel">Add description</span></div></div>').join('')}</div>`;
  const CELL = (i, pictures = 0) => `<div class="cell">${BOX(i)}${pictures ? X_PICTURES(pictures) : ''}</div>`;
  const SEND = '<button data-testid="tweetButton">Post</button>';

  /** X's media editor behind each "Add description": Save keeps the text, Escape drops it. */
  function xEditor(described, { save = true } = {}) {
    return (doc) => {
      for (const link of doc.querySelectorAll('[data-picture]')) {
        link.addEventListener('click', () => {
          const dialog = doc.createElement('div');
          dialog.setAttribute('role', 'dialog');
          dialog.innerHTML = '<textarea data-testid="altTextInput" maxlength="1000"></textarea>'
            + (save ? '<button data-testid="endEditingButton">Save</button>' : '');
          doc.body.append(dialog);
          dialog.querySelector('[data-testid="endEditingButton"]')?.addEventListener('click', () => {
            described.push({ picture: link.dataset.picture, text: dialog.querySelector('textarea').value });
            dialog.remove();
          });
          dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') dialog.remove(); });
        });
      }
      doc.querySelector('[data-testid="tweetButton"]')?.addEventListener('click', () => described.push('SENT'));
    };
  }

  it('gives each picture its own text once the thread is in, and presses nothing that sends', async () => {
    const described = [];
    const report = await run({
      posts: [
        { text: 'Geolocated.', files: [{ ...PNG, name: 'bridge.png', alt: 'A road bridge over a canal' }, { ...PNG, name: 'gate.png' }, { ...PNG, name: 'yard.png', alt: 'A container yard' }] },
        { text: 'Context.', files: [] },
      ],
      html: `${CELL(0, 3)}${FILE_INPUT(0)}${CELL(1)}${FILE_INPUT(1)}<button data-testid="addButton"></button>${SEND}`,
      onReady: xEditor(described),
    });
    expect(report.filled).toBe(2);
    expect(report.error).toBeUndefined();
    expect(report.missed).toBeUndefined();
    // the picture with no text was never opened
    expect(described).toEqual([
      { picture: '0', text: 'A road bridge over a canal' },
      { picture: '2', text: 'A container yard' },
    ]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }, 20000);

  it('names a post whose pictures offer no description, fills the rest, and stops nowhere', async () => {
    const described = [];
    const report = await run({
      posts: [
        { text: 'Geolocated.', files: [{ ...PNG, alt: 'A road bridge' }] },
        { text: 'Context.', files: [{ ...PNG, name: 'yard.png', alt: 'A container yard' }] },
      ],
      // post 1's thumbnail wears no control; post 2's does
      html: `${CELL(0)}${FILE_INPUT(0)}${CELL(1, 1)}${FILE_INPUT(1)}<button data-testid="addButton"></button>${SEND}`,
      onReady: xEditor(described),
    });
    expect(report).toMatchObject({ filled: 2, through: 2, missed: ['alt-1'] });
    expect(report.error).toBeUndefined();
    expect(report.landed.map((one) => one.text)).toEqual(['Geolocated.', 'Context.']);
    expect(described).toEqual([{ picture: '0', text: 'A container yard' }]);
    // what the page held, for the report beside it
    expect(report.probe.selectors.alt).toEqual([1, 0]);
  }, 20000);

  it('closes an editor it could not save from, and names the post', async () => {
    const described = [];
    const report = await run({
      posts: [{ text: 'Geolocated.', files: [{ ...PNG, alt: 'A road bridge' }] }],
      html: `${CELL(0, 1)}${FILE_INPUT(0)}${SEND}`,
      onReady: xEditor(described, { save: false }),
    });
    expect(report).toMatchObject({ filled: 1, missed: ['alt-1'] });
    expect(described).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }, 20000);

  it('describes a picture on Bluesky through its ALT button, its dialog keeping the text as it closes', async () => {
    const described = [];
    const report = await run({
      hostname: 'bsky.app',
      posts: [{ text: 'Geolocated.', files: [{ ...PNG, alt: 'A road bridge over a canal' }] }],
      html: '<div class="post"><div class="ProseMirror" contenteditable="true"></div>'
        + '<div><div role="button" data-testid="altTextButton" aria-label="Ajouter un texte alternatif">ALT</div></div></div>'
        + '<button aria-label="Publier">Publier</button>',
      onReady: (doc) => {
        doc.querySelector('[data-testid="altTextButton"]').addEventListener('click', () => {
          const dialog = doc.createElement('div');
          dialog.setAttribute('role', 'dialog');
          dialog.innerHTML = '<textarea aria-label="Texte alternatif"></textarea>';
          doc.body.append(dialog);
          const field = dialog.querySelector('textarea');
          field.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            described.push(field.value);
            dialog.remove();
          });
        });
        doc.querySelector('[aria-label="Publier"]').addEventListener('click', () => described.push('SENT'));
      },
    });
    expect(report.filled).toBe(1);
    expect(report.missed).toBeUndefined();
    expect(described).toEqual(['A road bridge over a canal']);
  }, 20000);

  it('leaves a thread without descriptions exactly as it always filled it', async () => {
    const report = await run({
      posts: [{ text: 'Geolocated.', files: [PNG] }],
      html: `${CELL(0, 1)}${FILE_INPUT(0)}`,
    });
    expect(Object.keys(report).filter((key) => !['landed', 'typed', 'pastes', 'attached', 'dropped'].includes(key)))
      .toEqual(['filled', 'through']);
  });
});
