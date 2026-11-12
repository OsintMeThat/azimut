/**
 * Fill a social composer with the thread Azimut prepared, and stop there.
 *
 * Injected into the composer tab by the background worker after the app's
 * Publish button asked for it: once for a thread, and once per post for a reply
 * the site lets out one post at a time (`background.js`, "a reply in several
 * posts"). It writes, attaches and describes the pictures it was given a text
 * for; it never submits. The button that publishes is the analyst's, exactly as it
 * is when they paste the thread by hand — which is still what happens whenever this
 * script gives up. Each step it takes is said on Azimut's banner on the page
 * (`banner.js`), which the worker puts up first.
 *
 * **Runs in the page's own world**, which is the only place this works. An
 * extension's scripts live in a separate world by default: the events they make
 * are untrusted and the `DataTransfer` they build belongs to the other side of
 * that boundary, so a composer is free to ignore both — and X did, in silence.
 * Here the caret, the events and the files are the page's own objects. The price
 * is that there is no extension API on this side: the thread arrives on
 * `window.__AZIMUT_HANDOFF__`, set by the injection before this one, and the
 * report is this script's own return value.
 *
 * **This is one of the two files in the repo that know another site's DOM** (the
 * other, `postlink.js`, reads the link of what was sent), and it will age: X and
 * Bluesky move their markup without notice. So it is written to fail shallow —
 * every step reports how far it got and what the page held there (`probe`),
 * nothing throws into the page, and the thread the app copied to the clipboard
 * is the answer to all of it.
 */

(() => {

  /**
   * Bluesky's "+", by the only thing about it that is not translated or generated.
   *
   * It carries no test id, its class comes out of a stylesheet nobody wrote, and
   * its label goes through the site's translations: in French it reads *Ajouter
   * un autre post au fil de discussion*, which holds none of the words a
   * selector was asking for — so the thread stopped at post 1, in every language
   * but English. The label is also where this turns dangerous, and it is worth
   * saying why the obvious loosening is not here: *post* on its own is in the
   * button that publishes, and *add* plus *post* is also **Add media to post**,
   * one seat along in the same footer.
   *
   * What is left is the glyph. A plus is a plus in every language, and no button
   * that posts anything wears one. Both sizes of it, since the icon set draws
   * two, and either element the composer's button library renders as.
   */
  const PLUS =
    ':is(button, [role="button"]):has(' +
    'path[d^="M12 3a1 1 0 0 1 1 1v7h7"], path[d^="M12 6a1 1 0 0 1 1 1v4h4"])';

  // Per site: where the text goes, where a file goes, and what opens the next
  // post under it. Several selectors per role, oldest last: a renamed test id
  // costs the run, and a spare that still matches saves it.
  const SITES = [
    {
      match: /(^|\.)(x|twitter)\.com$/,
      // Scoped to the dialog first: opening the composer by URL draws it over
      // the timeline, and the timeline keeps a composer of its own — so the
      // first box in the document is not always the one on screen. The add
      // button answers to the same rule, for the same reason.
      editors: ['[role="dialog"] [data-testid^="tweetTextarea_"]', '[data-testid^="tweetTextarea_"]'],
      add: ['[role="dialog"] [data-testid="addButton"]', '[data-testid="addButton"]'],
      // Pasted first here, typed only if that is refused — the reverse of
      // everywhere else. This editor rebuilds itself around what `insertText`
      // wrote and comes back holding the post several times over, every time.
      // The loop below caught it and cleared it, and the thread did come out
      // right; what the analyst watched was a post being written six times and
      // wiped. Its paste handler takes the post once, first ask.
      roads: ["paste", "type"],
      files: [
        '[role="dialog"] input[data-testid="fileInput"]',
        'input[data-testid="fileInput"]',
        'input[type="file"]',
      ],
      // The source post's own reply button, for a reply under it. The page holds the
      // posts it answers above it and may quote another inside it, so the post is the
      // one whose time links to the address the tab was opened on.
      reply: () => {
        const id = /\/status\/(\d+)/.exec(location.pathname ?? "")?.[1];
        const posts = [...document.querySelectorAll('article[data-testid="tweet"]')];
        const source = (id && posts.find((post) => post.querySelector(`a[href$="/status/${id}"] time`)))
          || posts.find((post) => post.getAttribute("tabindex") === "-1");
        return source?.querySelector('[data-testid="reply"]') ?? null;
      },
      // A picture's description (`describe`): the "Add description" its thumbnail wears,
      // by the test id of its label and else by the media editor it links to, the
      // description box that opens, and the editor's Save. Read off X's web composer
      // as other tools describe it, never checked against the live page here.
      alt: {
        open: [
          '[data-testid="attachments"] [data-testid="altTextLabel"]',
          '[data-testid="attachments"] a[href$="/media"]',
        ],
        input: ['textarea[data-testid="altTextInput"]', '[role="dialog"] textarea', "textarea"],
        save: ['[data-testid="endEditingButton"]'],
      },
    },
    {
      match: /(^|\.)bsky\.app$/,
      // Its web composer is a rich-text editor with no test id of its own: the
      // class its library puts on the box, then plain contenteditable.
      editors: ['[role="dialog"] .ProseMirror', '.ProseMirror', 'div[contenteditable="true"]'],
      // The glyph first (see PLUS), then the English label as the spare — with
      // the media button next to it excluded by name, since "Add media to post"
      // answers to the same words. Neither asks for a `button` tag: this
      // composer is React Native for Web, where a button is whatever element
      // that library felt like rendering.
      add: [
        `[role="dialog"] ${PLUS}`,
        '[aria-label*="add" i][aria-label*="post" i]:not([aria-label*="media" i])',
        '[aria-label*="thread" i]',
      ],
      // No input to hand a file to: it picks files through one it creates,
      // clicks and throws away. See `drop` below for the door it does leave open.
      files: [],
      dropOnBody: true,
      // The post the page is about is scrolled to the top, the ones it answers above
      // it: its reply prompt when the page draws one, else the first reply in sight.
      reply: () =>
        document.querySelector('[data-testid="replyPromptBtn"]') ??
        [...document.querySelectorAll('[data-testid="replyBtn"]')].find(
          (button) => button.getBoundingClientRect().bottom > 0
        ) ??
        null,
      // Each picture's ALT button (its test id in the app's source), the dialog's text
      // box, and no Save to look for: the dialog keeps the text as it closes, so
      // Escape is the one language-free way out that saves.
      alt: {
        open: ['[data-testid="altTextButton"]'],
        input: ['[role="dialog"] textarea', "textarea"],
        save: [],
        closeSaves: true,
      },
    },
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Whether a paste made here carries the `DataTransfer` it was built with.
   *
   * Text can go over either spelling (see `paste`), but a file only travels on
   * the object itself — and Gecko does not take the object, it builds its own
   * out of text. So there is no such thing as pasting a picture in on Firefox,
   * and the door that site leaves open is the one below. Asked of a throwaway
   * event rather than of a browser name.
   */
  const CARRIES_FILES = (() => {
    try {
      const probe = new DataTransfer();
      return new ClipboardEvent("paste", { clipboardData: probe }).clipboardData === probe;
    } catch {
      return false;
    }
  })();

  const found = (selectors, keep = () => true) => {
    for (const selector of selectors) {
      let nodes = [];
      // A selector this browser cannot parse is one spare gone, not the run.
      try {
        nodes = [...document.querySelectorAll(selector)].filter(keep);
      } catch {
        continue;
      }
      if (nodes.length) return nodes;
    }
    return [];
  };

  /**
   * The boxes, in document order, and only the boxes.
   *
   * Matching the selector is not the same question as being the editor: X hangs
   * an empty post's placeholder on a sibling carrying the same test id with
   * `_label` on the end. It counted as a box, so post 2 was "already filled" by
   * the words *What is happening?!* and its text went nowhere. A composer box is
   * contenteditable; a placeholder never is.
   */
  const editable = (node) => {
    const attr = node.getAttribute?.("contenteditable");
    return attr === "" || attr === "true" || attr === "plaintext-only" || node.isContentEditable === true;
  };

  const boxes = (site) => found(site.editors, editable);

  /**
   * A control the composer is offering, rather than one it is holding back.
   *
   * X takes its "+" away — or refuses it — while it is still reading what was
   * just handed over, and a video is read for far longer than a picture ever
   * was. Pressing what is refused is how a thread carrying a clip stopped at
   * the post after it.
   */
  const pressable = (node) => node.disabled !== true && node.getAttribute?.("aria-disabled") !== "true";

  /** Poll for what the page has not drawn yet. A composer is an app inside an
   *  app: "load finished" says nothing about the box existing. */
  async function waitFor(predicate, timeoutMs = 15000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const hit = predicate();
      if (hit) return hit;
      if (Date.now() > until) return null;
      await sleep(200);
    }
  }

  /**
   * Make this post the one the composer is listening to.
   *
   * A composer with several boxes open takes a keystroke into the one it thinks
   * is active, and hands a picture to that one too — so every road below starts
   * here. A click and a focus, and nothing more: what a button needs (`press`)
   * is not what an editor needs, and the events an editor did not ask for are
   * the ones that get interpreted.
   */
  function focusBox(box) {
    box.click();
    box.focus();
  }

  /**
   * Press a control the way a mouse does.
   *
   * `click()` is one event, and it is not the one every composer listens for:
   * Bluesky's "+" is a React Native for Web pressable, which hangs its press on
   * the pointer sequence around the click. It sat there unpressed, so post 2 was
   * never opened and the thread stopped at one. The full sequence costs nothing
   * on a site that only ever wanted the click, and `click()` still ends it so
   * that a plain button gets its own activation.
   */
  function press(node) {
    node.focus?.();
    for (const kind of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const Kind = kind.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      node.dispatchEvent(new Kind(kind, { bubbles: true, cancelable: true, composed: true, button: 0 }));
    }
    node.click();
  }

  /**
   * A paste, for text or for files.
   *
   * The obvious way in, and the one that has to be checked afterwards: a paste
   * is an event the editor is free to ignore, and it did — dispatched from the
   * extension's own world it carried a `DataTransfer` built on the other side of
   * that boundary, and what came of it was a box that looked filled and was
   * empty. In the page's world it is the site's own kind of object, which is why
   * it is worth a second road rather than a last resort. Nothing here says
   * whether it landed; the box does, above.
   */
  function paste(target, transfer, text) {
    target.focus();
    return target.dispatchEvent(
      // Spelled both ways, because the two engines read different members and
      // each ignores the other's. Chromium takes the `DataTransfer` handed to
      // `clipboardData`; Gecko has no such member in its `ClipboardEventInit`
      // and builds its own out of `data`. Sent only one way, Firefox's composer
      // got an empty clipboard, fell to the typed road, and **never registered
      // the post**: the text was in the box, X still called it empty, and the
      // "+" it draws over a written post was not there — so the thread stopped
      // at the post after it, on a composer that looked filled.
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
        data: text,
        dataType: text === undefined ? undefined : "text/plain",
      })
    );
  }

  /**
   * Put the caret inside this box, at the end of what it holds. Collapsed, always.
   *
   * `insertText` writes wherever the *selection* is, not into whatever element
   * was asked to focus — and a composer holding three posts keeps one selection
   * between them, so without this the second post's text was inserted into the
   * first. What the range must never do is **span** the editor's own structure:
   * the contents of an "empty" X box are the block scaffolding DraftJS keeps in
   * there, and writing over that had it rebuild the post out of a DOM it no
   * longer recognised — six copies deep. Emptying a box is `clear`'s job, and it
   * asks the editor rather than the nodes.
   */
  function placeCaret(box) {
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // What a composer keeps is never character for character what was sent: X
  // wraps a post in bidi isolates, and an editor holding one post per block
  // hands them back with no line break between. So both sides are read with
  // every space and mark taken out — enough to tell empty from filled, and one
  // copy of the post from six.
  const NOISE = /[\u200b-\u200f\u061c\u2066-\u2069]/g;
  const squeeze = (value) => String(value ?? "").replace(NOISE, "").replace(/\s+/g, "");
  const holdsText = (box) => squeeze(box.textContent).length > 0;
  const occurrences = (holds, want) => (want ? holds.split(want).length - 1 : 0);

  /**
   * What the box holds once it has stopped changing.
   *
   * An editor does not write the keystroke, it *records* it: the text appears
   * when its own state has been through a render, which is not when the command
   * returns. Reading once, straight after, found post 2 empty and put it in a
   * second time — on top of the copy that arrived a moment later. Two readings
   * that agree is the earliest this can be answered.
   */
  async function settled(box, { emptyMs = 600, timeoutMs = 2000 } = {}) {
    let last = null;
    const start = Date.now();
    for (;;) {
      const holds = squeeze(box.textContent);
      if (holds && holds === last) return holds;
      last = holds;
      const waited = Date.now() - start;
      // A box still empty this long after the command is a box that took
      // nothing: waiting out the full patience owed to a slow render would only
      // spend it three times over on the attempts below.
      if (!holds && waited >= emptyMs) return "";
      if (waited >= timeoutMs) return holds;
      await sleep(100);
    }
  }

  /**
   * Empty the box, and say whether it is empty.
   *
   * Through the editor's own commands: `selectAll` in a focused editor is the
   * browser's idea of "everything in here", and `delete` is a keystroke every
   * editor implements — where a range built by hand spans nodes the editor put
   * there for itself. Asked before every attempt below, because an attempt that
   * starts on a box still holding the last one is how a post ends up doubled.
   */
  async function clear(box) {
    if (!holdsText(box)) return true;
    focusBox(box);
    placeCaret(box);
    document.execCommand?.("selectAll");
    document.execCommand?.("delete");
    const until = Date.now() + 1000;
    while (holdsText(box)) {
      if (Date.now() > until) return false;
      await sleep(100);
    }
    return true;
  }

  /**
   * Point this post's box out to the composer, and give it a moment to look.
   *
   * Both roads write wherever the editor believes the caret is, and the editors
   * that keep their own copy of the selection read it on their own schedule — so
   * arriving before they have looked puts the post in the one before it.
   */
  async function aim(box) {
    focusBox(box);
    placeCaret(box);
    await sleep(250);
  }

  /**
   * Type the post in, the way a keyboard does.
   *
   * `insertText` is executed by the browser on the current selection, so the
   * editor gets the same `beforeinput`/`input` sequence a keystroke produces and
   * updates its own state — where a paste asks it to trust an event it did not
   * see the user make. The first road on a site that has not said otherwise.
   */
  async function written(box, text) {
    await aim(box);
    document.execCommand?.("insertText", false, text);
    return settled(box);
  }

  /** The other road: hand the editor a paste, and let it read the text off. */
  async function pasted(box, text) {
    await aim(box);
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    paste(box, transfer, text);
    return settled(box);
  }

  /**
   * Put one post in one box, and answer for what is in there afterwards.
   *
   * Neither end of an attempt can be taken on trust, so the box is read at both
   * and what it holds is **counted**. `insertText` reports refused whenever the
   * editor handled the keystroke itself, with the text already in, so the
   * command's verdict is worth nothing; and an editor that rebuilds its own DOM
   * around what the browser wrote comes back holding the post several times
   * over, so "not empty" is not the same question as "filled".
   *
   * Three attempts, each starting on a box the editor has confirmed empty and
   * alternating the two roads in — the site's own road first, because the wrong
   * one is not only slower: the analyst is watching the composer, and an attempt
   * that has to be cleared is a post typed and wiped in front of them.
   *
   * **If none of them leaves the box holding the post, the box is emptied and
   * said so**: a post the analyst pastes in beats a post that says everything
   * six times, and the thread was on the clipboard before any of this was tried.
   */
  async function type(site, box, text) {
    const want = squeeze(text);
    const roads = site.roads ?? ["type", "paste"];
    let trouble = "stayed empty";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await clear(box))) return "would not empty";
      const road = roads[attempt % roads.length];
      const holds = road === "paste" ? await pasted(box, text) : await written(box, text);
      if (!holds) trouble = "stayed empty";
      else if (occurrences(holds, want) > 1) trouble = "went in more than once";
      // Not the same string is not wrong: an editor is free to normalise what it
      // keeps, and the script that argues with that is the one that types the
      // post in a second time. Once, or as near as can be told, is the answer.
      else return null;
    }
    await clear(box);
    return trouble;
  }

  /**
   * Hand a file to the composer's own file input, the way the picker does.
   *
   * Every one of these sites attaches through an `input[type=file]` it keeps
   * hidden behind the picture button. Assigning its `files` and firing `change`
   * is the site's own path — its validation, its thumbnail, its counter — and it
   * does not depend on the page trusting an event we made up.
   *
   * Whether it stuck is asked **before** the site is told, and never afterwards.
   * A composer empties the input as soon as it has read it, so that picking the
   * same picture twice still fires a change — so reading it back a moment later
   * finds nothing and calls the one path that worked a refusal.
   */
  function attach(site, box, transfer, input) {
    if (input) {
      input.files = transfer.files;
      if (input.files?.length) {
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    // A paste that cannot carry a file is not a fallback; dropping is the one
    // road left, and it is the road this browser gave Bluesky all along.
    return site.dropOnBody || !CARRIES_FILES ? drop(transfer) : paste(box, transfer);
  }

  /**
   * Drop the files on the page, the way dragging them onto the window does.
   *
   * Bluesky's route, and the reason it has one: it keeps no file input to hand
   * anything to, but it listens for `drop` on the body and passes what it carries
   * to the same reader its paste uses. It reads `image/*` and `video/*` straight
   * off the items, and it puts them on the post it currently calls active — the
   * one just pressed.
   */
  function drop(transfer) {
    for (const kind of ["dragenter", "dragover", "drop"]) {
      document.body.dispatchEvent(
        new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
    }
    return true;
  }

  /**
   * Rebuild a handed-over file on this side.
   *
   * A large file arrives as decoded byte-array parts, one bounded injection at
   * a time. `data` remains as the compatibility path for an older worker and
   * small test fixtures. Neither road fetches from the page: that would answer
   * to the site's own CSP, which is exactly what X refuses.
  */
  function toFile(file) {
    if (Array.isArray(file.parts)) {
      const parts = file.parts;
      file.parts = []; // the File owns the bytes now; do not retain a second reference
      return new File(parts, file.name, { type: file.type });
    }
    const binary = atob(file.data ?? "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], file.name, { type: file.type });
  }

  // The step the banner says now, so a step said twice is said once.
  let saying = null;

  /**
   * Tell Azimut's banner on this page the step under way (`banner.js`). The worker
   * puts the banner up; on a page without one, nothing is said and nothing changes.
   */
  function say(text) {
    if (text === saying) return;
    saying = text;
    try {
      document.querySelector("azimut-banner")?.azimutSay?.({ kind: "busy", text });
    } catch {
      // the banner is a courtesy: the thread goes in without it
    }
  }

  /** What these files are called on the banner: pictures, a video, or files when mixed. */
  function mediaNoun(files) {
    const kinds = new Set(files.map((file) => String(file?.type ?? "").split("/")[0]));
    if (kinds.size !== 1) return "file";
    return kinds.has("image") ? "picture" : kinds.has("video") ? "video" : "file";
  }

  /** The banner's words while a post's files go in: `at` of the thread's `files` handed so far. */
  function addingWords(at, files) {
    const noun = mediaNoun(files);
    return files.length === 1 ? `Adding the ${noun}…` : `Adding ${noun}s ${at} of ${files.length}…`;
  }

  /**
   * Fill one post. Returns null, or what to tell the analyst about this one.
   *
   * **A box that already holds something is left alone.** The first post arrives
   * with its text in the URL, and the composer's copy of it is never character
   * for character what was sent — bidi marks, trimming, its own normalisation —
   * so comparing the two said "different" and typed the whole post in again,
   * halfway through the text already there. What the analyst got was a thread
   * saying everything twice. Emptiness is the question that can be answered.
   */
  async function fill(site, box, post, index, adding = () => {}) {
    // Focused even when there is nothing to type into it: a composer hands a
    // picture to the post it calls active, and a post carrying an image and no
    // text is never typed into.
    focusBox(box);
    // Typing is the step that can fail without saying so: the editor keeps its
    // own state and a box that stayed empty means it ignored us.
    if (post.text && !holdsText(box)) {
      const trouble = await type(site, box, post.text);
      if (trouble) return `Post ${post.number ?? index + 1} ${trouble}.`;
    }
    if (!post.files?.length) return null;
    // One input per post where a site has them, so the pictures land under the
    // post they belong to rather than all under the first.
    const inputs = found(site.files);
    adding(post.files.length);
    const transfer = new DataTransfer();
    for (const file of post.files) transfer.items.add(toFile(file));
    attach(site, box, transfer, inputs[index] ?? inputs[0]);
    // The site reads the files and draws thumbnails; moving on mid-read drops it.
    await sleep(900);
    // And nothing is claimed about how that went. Whether a picture is attached
    // is the site's own state, drawn its own way, and every reading of it from
    // here was wrong: the input is empty because it was read, not because it was
    // refused. The composer is in front of the analyst; it can answer for itself.
    return null;
  }

  /**
   * The box the next post belongs in: the first empty one under the post just
   * filled.
   *
   * Counting from the top is what an index does, and the count is not ours to
   * keep — the composer owns it. X draws a box under the timeline behind the
   * dialog, a site is free to open the new post next to the active one rather
   * than at the end, and either way the Nth box stopped being the Nth post.
   *
   * The button pressed is the one at the end, so the box it opens is the one at
   * the end: that is the answer whenever it is empty and is not the post just
   * written. Otherwise the first empty box below that one, which is the same
   * answer in a composer that numbers its boxes the way we would.
   */
  function nextBox(site, previous) {
    const all = boxes(site);
    const last = all.at(-1);
    if (last && last !== previous && !holdsText(last)) return last;
    const after = all.slice(all.indexOf(previous) + 1);
    return after.find((one) => !holdsText(one)) ?? null;
  }

  /**
   * Whether the composer on screen offers a next post, asked once the first is in.
   *
   * X's reply dialog has no "+" at all: the box, the toolbar, the counter and the
   * button that sends. Waiting the full patience owed to a "+" held back over a
   * video would only make the analyst wait for a button that is never drawn, so
   * this asks for the button being there, refused or not.
   */
  async function offersNext(site) {
    return Boolean(await waitFor(() => found(site.add)[0] ?? null, 3000));
  }

  // A test id names a control in the site's code, not in its words. Anything else
  // about the page stays out of a report, and a test id that is not one plain
  // word (an avatar's carries its owner's handle) is only counted.
  const TEST_ID = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;

  /**
   * What the page held where this script looked: how many nodes each selector of
   * this site matched, and the test ids of the controls in the dialog (or the page,
   * when no dialog is open). Counts and test ids only, never a word of the page,
   * since it goes into the report the analyst may copy back.
   */
  function probe(site) {
    const count = (selector) => {
      try {
        return document.querySelectorAll(selector).length;
      } catch {
        return -1;
      }
    };
    const selectors = {};
    for (const role of ["editors", "add", "files"]) selectors[role] = (site[role] ?? []).map(count);
    // the descriptions' controls, counted only for a thread that gave a description
    if (site.alt && describing) selectors.alt = site.alt.open.map(count);
    let reply = 0;
    try {
      reply = site.reply?.() ? 1 : 0;
    } catch {
      reply = -1;
    }
    selectors.reply = [reply];
    const dialog = document.querySelector('[role="dialog"]');
    const scope = dialog ?? document.querySelector("main") ?? document.body;
    const buttons = [];
    let unnamed = 0;
    const controls = scope?.querySelectorAll(
      'button[data-testid], [role="button"][data-testid], input[data-testid], [data-testid="toolBar"] [data-testid]'
    );
    for (const node of controls ?? []) {
      const id = node.getAttribute("data-testid");
      if (!TEST_ID.test(id)) unnamed += 1;
      else if (!buttons.includes(id) && buttons.length < 40) buttons.push(id);
    }
    return { selectors, scope: dialog ? "dialog" : "page", buttons, unnamed };
  }

  /**
   * Open the reply box under the post this tab shows, and say whether it opened.
   *
   * A reply is handed over on the source post's own page. Its reply button opens the
   * site's full composer as a reply, over the page, and that dialog is the one that
   * threads: the box drawn under the post takes a single post. Nothing is pressed but
   * that button, and the dialog it opens is filled like any other.
   */
  async function openReply(site) {
    if (!site.reply) return false;
    const button = await waitFor(() => {
      try {
        return site.reply();
      } catch {
        return null;
      }
    });
    if (!button) return false;
    press(button);
    const inDialog = site.editors.filter((selector) => selector.startsWith('[role="dialog"]'));
    return Boolean(await waitFor(() => found(inDialog, editable)[0] ?? null, 8000));
  }

  /**
   * The part of the composer that is this post's: the box and what hangs under it (its
   * pictures), up to where another post's box begins, and never past the dialog.
   */
  function postScope(site, box) {
    const others = boxes(site).filter((one) => one !== box);
    let scope = box;
    for (let up = box.parentElement; up && up !== document.body; up = up.parentElement) {
      if (others.some((one) => up.contains(one))) break;
      scope = up;
      if (up.getAttribute?.("role") === "dialog") break;
    }
    return scope;
  }

  /** The nodes under `scope` the first selector that finds any finds, in document order. */
  const foundIn = (scope, selectors) => {
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = [...scope.querySelectorAll(selector)];
      } catch {
        continue;
      }
      if (nodes.length) return nodes;
    }
    return [];
  };

  /**
   * Write into a plain text box the way its framework hears it: the value through the
   * element's own setter, then the input event. Answers whether it holds the text.
   */
  function putText(field, text) {
    field.focus?.();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    if (setter) setter.call(field, text);
    else field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return field.value === text;
  }

  /** Escape, pressed on this node, the way a keyboard does. */
  function escape(node) {
    for (const kind of ["keydown", "keyup"]) {
      node.dispatchEvent(
        new KeyboardEvent(kind, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true })
      );
    }
  }

  /**
   * One picture's description: open its editor, write the text, save, and see it close.
   * A step that does not answer closes what it opened and says no, so the composer is
   * never left behind a dialog. Nothing here sends: the only button pressed is the one
   * that keeps the description.
   */
  async function describeOne(site, control, text) {
    const before = new Set(found(site.alt.input));
    press(control.closest?.('a, button, [role="button"], [role="link"]') ?? control);
    const field = await waitFor(() => found(site.alt.input).find((one) => !before.has(one)) ?? null, 5000);
    if (!field) return false;
    if (!putText(field, text)) {
      escape(field);
      return false;
    }
    await sleep(150);
    const save = site.alt.save.length ? await waitFor(() => found(site.alt.save, pressable).at(-1) ?? null, 3000) : null;
    if (save) press(save);
    else {
      escape(field);
      if (!site.alt.closeSaves) return false;
    }
    return Boolean(await waitFor(() => !field.isConnected, 3000));
  }

  /**
   * Give the pictures of one post their descriptions, once the thread is in. Each
   * picture is found by its place among the post's own: a post whose pictures do not
   * each offer one control is left as it is. Answers whether every text went in.
   */
  async function describe(site, box, files) {
    const scope = () => postScope(site, box);
    const controls =
      (await waitFor(() => {
        const nodes = foundIn(scope(), site.alt.open);
        return nodes.length >= files.length ? nodes : null;
      }, 3000)) ?? foundIn(scope(), site.alt.open);
    if (controls.length !== files.length) return false;
    for (let i = 0; i < files.length; i += 1) {
      if (!files[i].alt) continue;
      // read again each time: the composer may draw its thumbnails anew after a dialog
      const control = foundIn(scope(), site.alt.open)[i];
      if (!control || !(await describeOne(site, control, files[i].alt))) return false;
    }
    return true;
  }

  /**
   * The descriptions of every post filled here that carries one. A post the page would
   * not describe is named (`alt-2`) and the rest goes on: the descriptions are an extra
   * the composer can still be given by hand, never a reason to stop.
   */
  async function describeAll(site, written) {
    const missed = [];
    const pictures = written.flatMap(({ post }) => (post.files ?? []).filter((file) => file.alt));
    if (site.alt && pictures.length) say(pictures.length === 1 ? "Describing the picture…" : "Describing the pictures…");
    for (const { box, post, number } of written) {
      if (!site.alt || !(post.files ?? []).some((file) => file.alt)) continue;
      step = `alt-${number}`;
      let done = false;
      try {
        done = await describe(site, box, post.files);
      } catch {
        done = false;
      }
      if (!done) missed.push(`alt-${number}`);
    }
    return missed;
  }

  // Whether a picture of this thread carries a description, which `probe` then counts for.
  let describing = false;

  // The step this run is on, named the way the report names it: `open-reply`,
  // `open-composer`, `fill-2`, `add-3`. Kept out here so that a throw still says
  // where it happened.
  let step = "start";

  /**
   * Fill the posts handed over, and say how far it got.
   *
   * What arrives on the global, beyond the posts:
   *  - `reply`: open the reply box under the post this page shows, first;
   *  - `ask`: one post, the first of several: fill it, then say whether the
   *    composer offers a next post (`add`) instead of looking for one to press.
   *    Without one, the worker chains the rest one reply at a time;
   *  - `more`: these posts follow one already in the composer on screen, so the
   *    first of them is added like any other (`carried`: that post handed over a
   *    file, which is what a "+" is held back for);
   *  - `number`: the first of these posts' place in the whole thread, for what
   *    is said about them;
   *  - `total`: how many posts the whole thread holds, when it is more than these
   *    and the ones before them (a reply in several posts), for the banner;
   *  - `probe`: fill nothing, and say only what the page holds (see `probe`).
   *
   * What comes back says `filled`, the posts filled, and `through`, how many of
   * these posts went in one after the other from the first before anything went
   * wrong: the worker tells the app the post the rest starts from. A post whose
   * pictures carry a description (`alt` on a file) is described once every post is
   * in, and `missed` names the posts the page would not describe (`alt-2`).
   */
  async function run() {
    const site = SITES.find((one) => one.match.test(location.hostname));
    if (!site) return { filled: 0, through: 0, error: "Azimut does not know this composer." };

    const thread = window.__AZIMUT_HANDOFF__;
    const posts = thread?.posts;
    delete window.__AZIMUT_HANDOFF__; // the page keeps nothing of the case
    if (thread?.probe === true) return { filled: 0, probe: probe(site) };
    if (!posts?.length) return { filled: 0 };
    const number = Number.isInteger(thread.number) && thread.number > 0 ? thread.number : 1;
    const more = thread.more === true;
    // The banner's words: "Post 2 of 3…" in a thread, and the pictures as they go in.
    const total = Math.max(number - 1 + posts.length, Number.isInteger(thread.total) ? thread.total : 0);
    const postWords = (n) => (total > 1 ? `Post ${n} of ${total}…` : "Filling your post…");
    const media = posts.flatMap((post) => post.files ?? []);
    let added = 0;
    const adding = (count) => {
      added += count;
      say(addingWords(added, media));
    };
    describing = posts.some((post) => (post.files ?? []).some((file) => file?.alt));
    // Boxes already in the composer ahead of these posts, for the file input of each.
    const offset = more ? number - 1 : 0;

    let filled = 0;
    let through = 0;
    // What went wrong on one post does not stop the next: a thread missing its
    // third line still beats a composer holding nothing.
    const notes = [];
    let troubleStep = null;
    // The posts filled here, for their pictures' descriptions once the thread is in.
    const written = [];
    // What the descriptions missed, named only when something was.
    const described = async () => {
      const missed = await describeAll(site, written);
      return missed.length ? { missed } : {};
    };
    // Stopping is not a reason to drop what went wrong on the way here: a post
    // left empty is why a composer refuses to open the next one, and the stop
    // on its own reads like the markup moved.
    const stop = async (reason) => {
      const at = step;
      const missed = await described();
      return {
        filled,
        through,
        error: [...notes, reason].join(" "),
        step: at,
        probe: probe(site),
        ...missed,
      };
    };

    step = thread.reply === true ? "open-reply" : "open-composer";
    say(postWords(number));
    if (thread.reply === true && !(await openReply(site))) {
      return stop(
        number > 1
          ? "Could not open the reply box under your last reply."
          : "Could not open the reply box under the source post."
      );
    }

    step = "open-composer";
    const opened = await waitFor(() => {
      const nodes = boxes(site);
      return nodes.length ? nodes : null;
    });
    if (!opened) return stop("The composer did not open in time.");

    // After one already filled, the box to add under is the last that holds a post.
    let box = more ? (boxes(site).filter(holdsText).at(-1) ?? boxes(site).at(-1)) : boxes(site)[0];
    for (let i = 0; i < posts.length; i += 1) {
      if (i > 0 || more) {
        step = `add-${number + i}`;
        say(postWords(number + i));
        // The **last** one. A composer that draws a footer under every post
        // draws an add button under every post too, and only the one at the end
        // appends — the others insert a post in the middle of the thread.
        //
        // Waited for, not looked for once: this is the composer's own state, and
        // it is the last thing here that was read the moment it was wanted. The
        // patience goes where the reason for it is — a post that handed over a
        // file is one the composer is still busy with; a post that handed over
        // nothing owes no wait.
        //
        // No button, no thread: stop where we are and say so. Half a thread
        // filled beats none, and the rest is one paste away.
        const carried = i > 0 ? posts[i - 1].files?.length : thread.carried === true;
        const patience = carried ? 20000 : 3000;
        const add = await waitFor(() => found(site.add, pressable).at(-1), patience);
        if (!add) return stop("Could not add the next post to the thread.");
        press(add);
        const grown = await waitFor(() => nextBox(site, box), 5000);
        if (!grown) return stop("The next post did not open.");
        await sleep(250); // it is drawn; let it become the one the composer listens to
        box = nextBox(site, box) ?? grown;
      }
      step = `fill-${number + i}`;
      if (!box) return stop("Lost the composer while filling it.");
      const trouble = await fill(site, box, { ...posts[i], number: number + i }, offset + i, adding);
      written.push({ box, post: posts[i], number: number + i });
      if (trouble) {
        notes.push(trouble);
        troubleStep ??= step;
      } else {
        if (through === i) through += 1; // no post before this one went wrong
        filled += 1;
      }
    }
    const missed = await described();
    if (notes.length) return { filled, through, error: notes.join(" "), step: troubleStep, probe: probe(site), ...missed };
    // Whatever was missed, the page is described to the report beside it.
    const seen = missed.missed ? { probe: probe(site) } : {};
    // Nothing is pressed to find out more: the worker decides what follows.
    if (thread.ask === true) return { filled, through, add: await offersNext(site), ...missed, ...seen };
    return { filled, through, ...missed, ...seen };
  }

  // The value the injection hands back to the worker, which is what says whether
  // the analyst needs telling anything.
  return run().catch((e) => ({
    filled: 0,
    error: e?.message || "The composer refused the thread.",
    step,
  }));
})();
