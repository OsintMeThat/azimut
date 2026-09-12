/**
 * Hand one prepared image to a reverse-image engine, and stop there.
 *
 * Injected into the engine's tab by the background worker, once, after the app's
 * Reverse Search button asked for it. It gives the picture to the page's own
 * file input, the way its Browse button does, and then it is the site's picture:
 * these engines search as soon as they hold one. That is the whole point of the
 * button the analyst pressed, and it is the one thing this file does that
 * `handoff.js` next door refuses to — a composer is left for the analyst to
 * send, an engine is asked a question.
 *
 * **Runs in the page's own world**, for the reason that file spells out: the
 * `DataTransfer` an extension builds belongs to the other side of that boundary
 * and a page is free to ignore it, where here the file is the page's own object.
 * The price is the same too — no extension API on this side, so the image
 * arrives on `window.__AZIMUT_REVERSE__` and the report is this script's return
 * value.
 *
 * **It knows four other sites' markup, and it will age.** So it is written to
 * fail shallow: every step reports how far it got, nothing throws into the page,
 * and the image the app copied to the clipboard is the answer to all of it.
 */

(() => {
  // Per engine: where a file goes, and where a paste or a drop lands. Several
  // selectors per role, oldest last — a renamed class costs the run, a spare
  // that still matches saves it.
  //
  // **Nothing is ever pressed.** On every one of these pages the visible upload
  // button *is* the file dialog: it calls `click()` on the hidden input, and a
  // native picker opened over the analyst's work is worse than doing nothing.
  // So each engine is reached by the uploader it already carries.
  const SITES = [
    {
      // Lens, which is not where it says it is: `lens.google.com` answers with a
      // redirect to `www.google.com/?olud`, and the uploader is on *that* page.
      // Both hostnames, since the redirect is the site's to change.
      //
      // **Named, not merely image-typed, and not in a dialog.** Lens draws its
      // uploader inline on the home page — no `role="dialog"` anywhere near it,
      // which is what an earlier reading of this page got wrong — and it is one
      // hidden input appended straight to `body`, late, carrying the name
      // search-by-image has always used: `encoded_image`. The name is the whole
      // entry. The same document also serves the search box's own "add files"
      // inputs, which accept pictures too and are marked with a `jsname`;
      // handing one of those the picture played an upload animation and
      // searched nothing at all, so the fallback steps around them.
      match: /(^|\.)(lens\.)?google\.com$/,
      inputs: [
        'input[type="file"][name="encoded_image"]',
        'input[type="file"][accept*="image/"]:not([jsname])',
      ],
      // Nothing finer than the document for either: the drop zone's own classes
      // are generated, and Lens listens for both up at the page.
      paste: ['body'],
      drop: ['body'],
    },
    {
      // Yandex's home page, not its image search: the camera on `/images/` opens
      // nothing at all — for a real click as much as for ours — while the home
      // page keeps its picker in the document from the first paint, named. So
      // there is nothing to press here, which is just as well: pressing that
      // camera is what opens the file dialog.
      match: /(^|\.)yandex\.(com|ru|by|kz|com\.tr|eu)$/,
      inputs: ['#image-search', 'input[type="file"].image-search__picker', 'input[type="file"]'],
    },
    {
      // Bing's search-by-image view keeps one named input in the page, hidden
      // behind its Browse button.
      match: /(^|\.)bing\.com$/,
      inputs: ['#sb_fileinput', 'input[type="file"][accept*="image"]', 'input[type="file"]'],
    },
    {
      // TinEye draws its own picker at run time, so the input can arrive a
      // moment after the document does — and it has no panel to open, only the
      // button that is the file dialog itself. Dropping is the road left.
      match: /(^|\.)tineye\.com$/,
      inputs: ['input[type="file"][name="image"]', 'input[type="file"]'],
      drop: ['[class*="drop" i]', 'main', 'body'],
    },
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  /** An input the page is offering, rather than one it is holding back. */
  const usable = (node) => node.disabled !== true && node.getAttribute?.("aria-disabled") !== "true";

  /** Poll for what the page has not drawn yet. An engine is an app inside an
   *  app: "load finished" says nothing about the uploader existing. */
  async function waitFor(predicate, timeoutMs) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const hit = predicate();
      if (hit) return hit;
      if (Date.now() > until) return null;
      await sleep(200);
    }
  }

  /**
   * Rebuild the handed-over image on this side.
   *
   * Base64 rather than a `data:` URL because this runs in the page's world,
   * where a read over the network answers to the page's own CSP — and these are
   * exactly the sites that allow none. `atob` asks the network for nothing.
   */
  function toFile(image) {
    const binary = atob(image.data ?? "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], image.name || "image.png", { type: image.type || "image/png" });
  }

  /**
   * Give the file to the page's own input, the way its picker does.
   *
   * Assignment first, then `change`: the site's validation, its thumbnail, its
   * search. Read back **before** the site is told and never after — an uploader
   * empties the input as soon as it has read it, so a later reading calls the
   * one road that worked a refusal.
   */
  function hand(input, transfer) {
    input.files = transfer.files;
    if (!input.files?.length) return false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /**
   * Whether a paste made here carries the `DataTransfer` it was built with.
   *
   * A file only travels on the object itself, and Gecko does not take the
   * object: it builds its own out of text. So there is no pasting a picture in
   * on Firefox, and the drop below is that browser's road. Asked of a throwaway
   * event rather than of a browser name — the same question `handoff.js` asks.
   */
  const CARRIES_FILES = (() => {
    try {
      const probe = new DataTransfer();
      return new ClipboardEvent("paste", { clipboardData: probe }).clipboardData === probe;
    } catch {
      return false;
    }
  })();

  /** Paste the file in, the way Ctrl+V in an open dialog does. */
  function pasteInto(target, transfer) {
    target.focus?.();
    target.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer })
    );
    return true;
  }

  /** The other road: drop the file on the page, the way dragging it in does. */
  function drop(target, transfer) {
    for (const kind of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(
        new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
    }
    return true;
  }

  async function run() {
    const site = SITES.find((one) => one.match.test(location.hostname));
    if (!site) return { handed: false, error: "Azimut does not know this engine." };

    const image = window.__AZIMUT_REVERSE__?.image;
    delete window.__AZIMUT_REVERSE__; // the page keeps nothing of the case
    if (!image?.data) return { handed: false };

    const transfer = new DataTransfer();
    transfer.items.add(toFile(image));

    /**
     * The ways in, in the order a person would try them, and **every one of them
     * is tried**: nothing here can tell whether the engine took the picture.
     *
     * That sounds wasteful and is not, because of what an engine does when it
     * takes one — it searches, which means it leaves. This script goes with the
     * document, so a road that worked is the last road that runs. What follows a
     * road that did nothing is the next road, on a page still sitting there.
     */
    const roads = [
      async () => {
        // The patience goes where the reason for it is: an uploader is drawn
        // after the document, and Lens's arrives seconds late, appended to the
        // body once the page has decided what it is.
        const input = await waitFor(() => found(site.inputs, usable)[0], 8000);
        return Boolean(input) && hand(input, transfer);
      },
      async () => {
        if (!site.paste || !CARRIES_FILES) return false;
        const target = found(site.paste)[0];
        return Boolean(target) && pasteInto(target, transfer);
      },
      async () => {
        if (!site.drop) return false;
        const zone = found(site.drop)[0];
        return Boolean(zone) && drop(zone, transfer);
      },
    ];

    let offered = false;
    for (const road of roads) {
      if (!(await road())) continue;
      offered = true;
      // Long enough for a page that took it to start leaving with it.
      await sleep(1500);
    }
    // Offered is all that is claimed. Whether the engine liked the picture is its
    // own state, drawn its own way, and it is on screen in front of the analyst —
    // every reading of it from here would be a guess.
    return offered ? { handed: true } : { handed: false, error: "Could not give the image to this engine." };
  }

  // The value the injection hands back to the worker, which is what says whether
  // the analyst needs telling anything.
  return run().catch((e) => ({
    handed: false,
    error: e?.message || "The engine refused the image.",
  }));
})();
