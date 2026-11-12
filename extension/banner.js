/**
 * Azimut's banner on the composer tab, while the hand-off fills a post.
 *
 * Opening the composer, typing each post and attaching its pictures takes a few
 * seconds, and a minute for a long video, and the page showed nothing of Azimut in
 * that time: the analyst watched a composer that seemed to do nothing and thought
 * it broken. So a small card stands in the top right corner and says what the
 * hand-off is doing, in the words the hand-off already uses (`background.js`,
 * `handoff.js`): the step under way, Ready once it is done, or where it stopped.
 *
 * **It takes no press but its own close.** Everything else is `pointer-events:
 * none`, so the composer under it answers as if it were not there, and it presses
 * nothing on the page. It lives in its own shadow root, so the site's styles and
 * its own stay apart, and it brings its own colours, which read the same over a
 * light or a dark page. Once the analyst types in the composer it shrinks to a dot.
 *
 * **Runs in the page's own world**, where the filler runs, so the filler can say
 * each step as it takes it. The worker hands what to say on
 * `window.__AZIMUT_BANNER__`, taken off the window on the way in; the filler says
 * it through the banner's own element (`azimutSay`). Its styles go in through a
 * constructed sheet, which a site's policy on inline styles does not refuse.
 *
 * What it is told:
 *  - `{ kind: "busy", text }`: a step under way, beside a spinner;
 *  - `{ kind: "ready", text, note }`: done; it fades by itself after six seconds,
 *    unless a note says more;
 *  - `{ kind: "wait", text, note }`: the analyst's press comes next;
 *  - `{ kind: "stopped", text, note }`: where it stopped; it stays until closed;
 *  - `{ end: true }`: the hand-off is over. A step goes with it; Ready and a stop
 *    end on their own.
 */

(() => {
  const TAG = "azimut-banner";
  const KINDS = new Set(["busy", "ready", "wait", "stopped"]);
  /** How long Ready stays, and how long it takes to fade. */
  const READY_MS = 6000;
  const FADE_MS = 400;
  // What counts as typing: a character, or a key that edits. Escape, a modifier or
  // an arrow is not, and nor is anything the page or the filler makes up.
  const EDIT_KEYS = new Set(["Backspace", "Delete", "Enter"]);

  const CSS = `
    :host {
      all: initial !important;
      position: fixed !important;
      top: 14px !important;
      right: 14px !important;
      z-index: 2147483647 !important;
      display: block !important;
      pointer-events: none !important;
    }
    .card {
      box-sizing: border-box;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: max-content;
      max-width: min(300px, calc(100vw - 28px));
      padding: 10px 8px 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      background: #17191c;
      color: #f1f1f1;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.38);
      font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: left;
      pointer-events: none;
      animation: azimut-in 0.18s ease-out;
      transition: opacity ${FADE_MS}ms ease;
    }
    .card.fading { opacity: 0; }
    .card.shrunk, .card.closed { display: none; }
    .mark {
      flex: none;
      display: grid;
      place-items: center;
      width: 16px;
      height: 16px;
      margin-top: 1px;
      border-radius: 50%;
      font: 700 11px/1 system-ui, sans-serif;
    }
    .busy .mark {
      box-sizing: border-box;
      border: 2px solid rgba(255, 255, 255, 0.22);
      border-top-color: #e8a33d;
      animation: azimut-spin 0.8s linear infinite;
    }
    .ready .mark { background: #3f9e6a; color: #ffffff; }
    .wait .mark::after { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #e8a33d; }
    .stopped .mark { background: #d4574a; color: #ffffff; }
    .words { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .brand { color: #e8a33d; font-weight: 700; }
    .note { margin-top: 3px; color: #b9bdc4; font-weight: 400; }
    .note:empty { display: none; }
    .close {
      flex: none;
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      margin: -1px 0 0;
      padding: 0;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: #b9bdc4;
      font: 400 16px/1 system-ui, sans-serif;
      cursor: pointer;
      pointer-events: auto;
    }
    .close:hover { background: rgba(255, 255, 255, 0.1); color: #ffffff; }
    .close:focus-visible { outline: 2px solid #e8a33d; outline-offset: 1px; }
    .dot {
      display: none;
      width: 14px;
      height: 14px;
      padding: 0;
      border: 2px solid #17191c;
      border-radius: 50%;
      background: #e8a33d;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35), 0 2px 8px rgba(0, 0, 0, 0.35);
      cursor: pointer;
      pointer-events: auto;
    }
    .dot.shown { display: block; }
    .dot.ready { background: #3f9e6a; }
    .dot.stopped { background: #d4574a; }
    @keyframes azimut-spin { to { transform: rotate(360deg); } }
    @keyframes azimut-in { from { opacity: 0; transform: translateY(-4px); } }
    @media (prefers-reduced-motion: reduce) {
      .card { animation: none; transition: none; }
      .busy .mark { animation: none; }
    }
  `;

  const given = window.__AZIMUT_BANNER__;
  delete window.__AZIMUT_BANNER__; // the page keeps nothing of the hand-off
  let host = document.querySelector(TAG);
  if (!host || typeof host.azimutSay !== "function") {
    if (!given || given.end) return false;
    host?.remove();
    host = build();
  }
  if (given) host.azimutSay(given);
  return true;

  function el(tag, className, words) {
    const node = document.createElement(tag);
    node.className = className;
    if (words) node.textContent = words;
    return node;
  }

  function style(root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // an engine without constructed sheets takes a style element instead
    }
    const tag = document.createElement("style");
    tag.textContent = CSS;
    root.append(tag);
  }

  /** The banner, its own element on the page with what it says on a shadow root. */
  function build() {
    const banner = document.createElement(TAG);
    const root = banner.attachShadow({ mode: "open" });
    style(root);
    const card = el("div", "card busy");
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    const mark = el("span", "mark");
    mark.setAttribute("aria-hidden", "true");
    const words = el("div", "words");
    const line = el("div", "line");
    const text = el("span", "text");
    line.append(el("span", "brand", "Azimut"), " · ", text);
    const note = el("div", "note");
    words.append(line, note);
    const close = el("button", "close", "×");
    close.type = "button";
    close.title = "Close";
    close.setAttribute("aria-label", "Close");
    card.append(mark, words, close);
    const dot = el("button", "dot");
    dot.type = "button";
    root.append(card, dot);

    let state = null; // { kind, text, note }
    let closed = false; // closed during the steps: how the hand-off ends shows again
    let shrunk = false; // a dot, once the analyst types
    let timers = [];

    const calm = () => {
      for (const timer of timers) clearTimeout(timer);
      timers = [];
    };
    const later = (ms, work) => timers.push(setTimeout(work, ms));

    function draw() {
      card.className = `card ${state.kind}`;
      if (closed) card.classList.add("closed");
      else if (shrunk) card.classList.add("shrunk");
      mark.textContent = { ready: "✓", stopped: "!" }[state.kind] ?? "";
      text.textContent = state.text;
      note.textContent = state.note;
      dot.className = `dot ${state.kind}${shrunk && !closed ? " shown" : ""}`;
      dot.title = `Azimut · ${state.text}`;
      dot.setAttribute("aria-label", dot.title);
    }

    function remove() {
      calm();
      document.removeEventListener("keydown", typed, true);
      banner.remove();
    }

    function fade() {
      card.classList.add("fading");
      later(FADE_MS, remove);
    }

    function say(next) {
      if (!next || typeof next !== "object") return;
      if (next.end) {
        // Ready fades by itself and a stop waits for its close: neither is cut short.
        if (state?.kind === "ready" || state?.kind === "stopped") return;
        remove();
        return;
      }
      calm();
      const kind = KINDS.has(next.kind) ? next.kind : "busy";
      state = { kind, text: String(next.text ?? ""), note: next.note ? String(next.note) : "" };
      // A step said while the banner is closed or a dot stays that way; how it ends is shown.
      if (kind !== "busy") {
        closed = false;
        shrunk = false;
      }
      draw();
      if (kind === "ready" && !state.note) later(READY_MS, fade);
    }

    /** The analyst typing in the composer: the banner makes way, as a dot. */
    function typed(event) {
      if (!state || shrunk || closed || event.isTrusted === false) return;
      if (!(event.key?.length === 1 || EDIT_KEYS.has(event.key))) return;
      const target = event.composedPath?.()[0] ?? event.target;
      const editable =
        target?.isContentEditable === true ||
        target?.getAttribute?.("contenteditable") === "true" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT";
      if (!editable) return;
      shrunk = true;
      draw();
    }

    close.addEventListener("click", () => {
      // closed on a step, it comes back to say how the hand-off ended
      if (state?.kind === "busy") {
        closed = true;
        draw();
      } else remove();
    });
    dot.addEventListener("click", () => {
      shrunk = false;
      draw();
    });
    document.addEventListener("keydown", typed, true);

    banner.azimutSay = say;
    document.documentElement.append(banner);
    return banner;
  }
})();
