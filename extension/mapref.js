/**
 * The reference windows: the case's own images and videos, over the map.
 *
 * The app's Satellite tab can hold the shot being geolocated against the
 * imagery, in a small pane that moves and zooms independently of the map
 * (`tools/RefViewer.svelte`, `lib/refViewers.js`). This is that, over someone
 * else's map. It is the pane that makes the rest of the panel worth opening:
 * measuring a courtyard means nothing until it is the courtyard in the image.
 *
 * A window fades so the site's map shows and moves under it, unfolds what the
 * case knows about the file (dates, source, notes), plays a clip in a slim
 * player of its own (frame steps, slow motion, a frame kept as a picture), and
 * is put in one of six places from the pin in its header: a column on either
 * side of the screen, or a corner, clear of the panel. Dragged into a corner,
 * it stays there too. Its controls lie over the bottom of the picture and come
 * up on a hover. The site's map cannot be narrowed from here, so a docked
 * column covers that edge of it rather than sitting beside it as the app's does.
 *
 * Two things about it are not obvious:
 *
 * - **An image is painted, never linked.** A map site's content policy is free
 *   to refuse a `data:` or `blob:` image, and several do. So the bytes arrive as
 *   bytes, are decoded with `createImageBitmap` and drawn on a canvas, which
 *   asks no policy anything. A **video cannot be painted** — the element wants a
 *   URL — so it gets a `blob:` one, and it is the single thing here a site is in
 *   a position to refuse. When one does, the window says so rather than sitting
 *   there black. A frame kept from a clip is decoded straight off the element,
 *   so it is painted like any picture.
 * - **It reaches nothing itself.** `file()`, `search()` and `probe()` are handed
 *   in by `mapoverlay.js`, which stays the only file that knows an extension API
 *   exists.
 *
 * Where a pane sits and how far into an image it is zoomed is `maptools.js`,
 * checked against the app's own arithmetic. This is the pointer and DOM glue,
 * and the picker that chooses what to open.
 *
 * Loaded after `maptheme.js` and `maptools.js`, left on `window.AzimutMapRefs`.
 */

(() => {
  const THEME = window.AzimutMapTheme;
  const T = window.AzimutMapTools;
  const icon = THEME.icon;
  const t = THEME.TOKENS;

  /** How long after the last keystroke the case is searched. */
  const TYPING_MS = 220;

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const bounds = () => ({ w: window.innerWidth, h: window.innerHeight });

  /** Every gesture in here is one pointer down, some moves and a release. */
  function drag(move, done) {
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      done?.();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  }

  /**
   * A pointer gesture that belongs to this pane and not to the map under it.
   *
   * The panel's own engine already ignores anything inside the shadow root, but
   * the *site* does not: dragging a window by its header would drag the map with
   * it. Cancelling the default on `pointerdown` is what stops that — no
   * compatibility mouse event follows, and a map that never sees a mousedown
   * never starts panning.
   */
  function mine(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  /** A slim slider, filled up to `--fill`. */
  const slider = (name) => `
      .${name} {
        flex: none; height: 14px; margin: 0; padding: 0; border: none;
        background: transparent; appearance: none; cursor: pointer;
      }
      .${name}::-webkit-slider-runnable-track {
        height: 3px; border-radius: 2px;
        background: linear-gradient(to right, ${t.accent} var(--fill), rgba(255,255,255,.22) var(--fill));
      }
      .${name}::-moz-range-track {
        height: 3px; border-radius: 2px;
        background: linear-gradient(to right, ${t.accent} var(--fill), rgba(255,255,255,.22) var(--fill));
      }
      .${name}::-webkit-slider-thumb {
        appearance: none; width: 10px; height: 10px; margin-top: -3.5px;
        border: none; border-radius: 50%; background: ${t.text1};
      }
      .${name}::-moz-range-thumb { width: 10px; height: 10px; border: none; border-radius: 50%; background: ${t.text1}; }`;

  /**
   * The style sheet for the windows and the picker.
   *
   * It goes in the panel's own shadow root, after the panel's, so the base rules
   * there (`button`, `header`, `.icon`, `.hint`) are the ones these build on —
   * one look, stated once.
   */
  function styles() {
    return `
      .rw {
        position: fixed; display: flex; flex-direction: column; overflow: hidden;
        /* stated here rather than inherited: the host resets everything, so a
           window that names no font is drawn in the browser's default serif */
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        color: ${t.text1}; background: transparent;
        border: 1px solid ${t.border}; border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0,0,0,.5);
        pointer-events: auto; user-select: none; outline: none;
      }
      /* the bars carry the window's background, so a faded picture shows the
         map rather than a grey sheet */
      .rw header, .rw-facts { background: ${t.bg1}; }
      .rw.folded { height: auto !important; }
      .rw header { padding: 4px 5px 4px 8px; cursor: grab; }
      .rw header:active { cursor: grabbing; }
      .rw.docked { border-radius: 0; box-shadow: none; }
      .rw.docked header, .rw.docked header:active { cursor: default; }
      .rw.docked .rw-grip { display: none; }
      /* faded, only the bars take the pointer: the picture is the map's to pan */
      .rw.see-through, .rw.see-through .rw-stage, .rw.see-through .rw-body { pointer-events: none; }
      .rw.see-through > :not(.rw-stage), .rw.see-through .rw-foot { pointer-events: auto; }
      .rw .icon.lit { color: ${t.accent}; }
      .rw-grip { display: grid; color: ${t.text3}; }
      .rw .rw-title {
        flex: 1; min-width: 0; font-size: 11.5px; font-weight: 600; color: ${t.text1};
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .rw-facts {
        display: flex; flex-direction: column; gap: 2px; max-height: 96px; overflow: auto;
        padding: 2px 9px 7px; border-bottom: 1px solid ${t.border};
        font-size: 11px; color: ${t.text2}; user-select: text;
      }
      .rw-facts p { margin: 0; }
      .rw-facts a {
        display: inline-flex; align-items: center; gap: 4px; align-self: flex-start;
        max-width: 100%; color: ${t.text2}; text-decoration: none;
      }
      .rw-facts a span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rw-facts a svg { flex: none; }
      .rw-facts a:hover { color: ${t.accent}; }
      .rw-notes { color: ${t.text1}; white-space: pre-line; }
      /* the picture, and over its bottom edge the bar that comes up on a hover */
      .rw-stage { position: relative; flex: 1; min-height: 0; }
      .rw-body {
        position: absolute; inset: 0; overflow: hidden; background: ${t.bg0};
        transition: opacity .12s;
      }
      .rw-body.clip { background: #000; cursor: pointer; }
      .rw-body.pannable { cursor: grab; }
      .rw-body.pannable:active { cursor: grabbing; }
      .rw-body canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .rw-body video {
        position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
        transform-origin: 0 0; pointer-events: none;
      }
      .rw-wait {
        position: absolute; inset: 0; display: grid; place-items: center;
        padding: 0 12px; text-align: center; font-size: 11.5px; color: ${t.text3};
      }
      .rw-foot {
        position: absolute; left: 0; right: 0; bottom: 0;
        display: flex; align-items: center; gap: 2px; padding: 10px 16px 3px 6px;
        color: ${t.text2};
        background: linear-gradient(to top, rgba(12,12,12,.88) 55%, rgba(12,12,12,0));
        opacity: 0; transform: translateY(3px); pointer-events: none;
        transition: opacity .14s, transform .14s;
      }
      .rw-foot.clip { display: block; padding-top: 14px; }
      .rw.docked .rw-foot { padding-right: 6px; }
      .rw:hover .rw-foot, .rw:focus-visible .rw-foot, .rw:has(:focus-visible) .rw-foot,
      .rw.see-through .rw-foot { opacity: 1; transform: none; pointer-events: auto; }
      /* a clip at rest still says how far it has played */
      .rw-line {
        position: absolute; left: 0; bottom: 0; height: 2px; width: 0;
        background: ${t.accent}; opacity: .85; pointer-events: none; transition: opacity .14s;
      }
      .rw:hover .rw-line, .rw.see-through .rw-line { opacity: 0; }
      .rw-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; min-height: 24px; }
      .rw-gap { flex: 1; }
      .rw-foot .icon { width: 22px; }
      .rw-foot .icon:hover:not([disabled]) { background: rgba(255,255,255,.08); }
      .rw-zoom, .rw-rate {
        min-width: 40px; padding: 3px 4px; font-size: 11px; color: ${t.text2};
        background: none; border-color: transparent;
      }
      .rw-rate { min-width: 32px; font-variant-numeric: tabular-nums; }
      .rw-rate.lit { color: ${t.accent}; }
      .rw-zoom:hover:not([disabled]), .rw-rate:hover:not([disabled]) {
        color: ${t.accent}; background: rgba(255,255,255,.08);
      }
      .rw-fade { display: flex; align-items: center; gap: 2px; }
      ${slider("rw-range")}
      .rw-range { width: 0; opacity: 0; transition: width .15s, opacity .15s; }
      .rw-fade:hover .rw-range, .rw-fade:focus-within .rw-range, .rw-fade.on .rw-range { width: 52px; opacity: 1; }
      ${slider("rw-scrub")}
      .rw-scrub { flex: 1; min-width: 60px; margin: 0 4px; }
      .rw-scrub:disabled { opacity: .5; cursor: default; }
      .rw-time {
        flex: none; min-width: 58px; padding: 0 2px 0 6px; text-align: right;
        font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: ${t.text2};
      }
      .rw-resize {
        position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
        cursor: nwse-resize; opacity: 0; transition: opacity .14s;
        background: linear-gradient(135deg, transparent 55%, ${t.borderStrong} 55%,
          ${t.borderStrong} 65%, transparent 65%, transparent 77%, ${t.borderStrong} 77%,
          ${t.borderStrong} 87%, transparent 87%);
      }
      .rw:hover .rw-resize { opacity: 1; }
      .rw-places { flex: 1; min-width: 0; display: flex; align-items: center; gap: 1px; }
      .rw-places .icon { width: 22px; }
      .rw-places [data-rw-place="tl"] { margin-left: 6px; }
      .rw.placing .rw-title, .rw.placing [data-rw="info"], .rw.placing [data-rw="fold"],
      .rw.placing [data-rw="close"] { display: none; }
      /* pinned, the handle sits on the corner facing the middle of the screen */
      .rw-resize.from-tr, .rw-resize.from-bl { cursor: nesw-resize; }
      .rw-resize.from-tr { left: 0; right: auto; transform: scaleX(-1); }
      .rw-resize.from-bl { top: 0; bottom: auto; transform: scaleY(-1); }
      .rw-resize.from-br { top: 0; left: 0; right: auto; bottom: auto; transform: scale(-1, -1); }
      .rw-dock-edge {
        position: fixed; top: 0; width: 5px; height: 100%; cursor: col-resize;
        pointer-events: auto; transition: background .12s;
      }
      .rw-dock-edge:hover, .rw-dock-edge.moving { background: ${t.accent}; }
      .pick {
        position: fixed; top: 64px; left: 50%; transform: translateX(-50%);
        width: min(470px, 92vw); max-height: 68vh; display: flex; flex-direction: column;
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: ${t.text1};
        background: ${t.bg1}; border: 1px solid ${t.borderStrong}; border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0,0,0,.6); pointer-events: auto; overflow: hidden;
        z-index: 1001; /* the one thing that goes over the panel, while it is up */
      }
      .pick header { cursor: default; }
      .pick .body { padding: 10px; gap: 8px; overflow: auto; }
      .pick-filters { display: flex; gap: 6px; }
      .pick-filters select { flex: 1; }
      .pick-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px;
      }
      .pick-item {
        flex-direction: column; align-items: stretch; gap: 4px; padding: 0;
        background: none; border-color: transparent; text-align: left;
      }
      .pick-item:hover:not([disabled]) { background: none; border-color: transparent; }
      .pick-thumb {
        position: relative; aspect-ratio: 4 / 3; display: grid; place-items: center;
        background: ${t.bg2}; border: 1px solid ${t.border}; border-radius: 7px;
        overflow: hidden; color: ${t.text3};
      }
      .pick-thumb canvas { width: 100%; height: 100%; display: block; }
      .pick-kind {
        position: absolute; right: 4px; bottom: 4px; display: grid; place-items: center;
        padding: 2px; border-radius: 5px; color: #fff; background: rgba(16,16,16,.75);
      }
      .pick-item:hover .pick-thumb { border-color: ${t.accent}; }
      .pick-name {
        font-size: 11px; color: ${t.text2};
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .pick-item:hover .pick-name { color: ${t.accent}; }
    `;
  }

  /** The fade: a glyph at rest, its slider opening beside it on a hover. */
  const fadeControl = () => `
    <span class="rw-fade">
      <button class="icon" data-rw="fade" title="See the map through it">${icon("fade", 13)}</button>
      <input class="rw-range" data-rw-input="opacity" type="range" min="${T.MIN_OPACITY}" max="1"
        step="0.05" value="1" aria-label="Opacity" style="--fill: 100%">
    </span>`;

  /** The picture's zoom, under an image. */
  const imageBar = () => `
    ${fadeControl()}
    <span class="rw-gap"></span>
    <button class="icon" data-rw="out" title="Zoom out">${icon("minimize", 12)}</button>
    <button class="rw-zoom" data-rw="reset" title="Fit the image">100%</button>
    <button class="icon" data-rw="in" title="Zoom in">${icon("plus", 13)}</button>`;

  /** The slim player under a clip: its own controls, since the native ones
   *  would zoom with it. */
  const clipBar = () => `
    <div class="rw-row">
      <button class="icon" data-rw="play" title="Play">${icon("play", 13)}</button>
      <input class="rw-scrub" data-rw-input="seek" type="range" min="0" max="1" step="any"
        value="0" aria-label="Position" style="--fill: 0%" disabled>
      <span class="rw-time" title="Time of the frame on screen">0:00.000</span>
    </div>
    <div class="rw-row">
      ${fadeControl()}
      <span class="rw-gap"></span>
      <button class="rw-zoom" data-rw="reset" title="Fit the clip">100%</button>
      <button class="icon" data-rw="back" title="Back one frame">${icon("chevronLeft", 13)}</button>
      <button class="icon" data-rw="forward" title="Forward one frame">${icon("chevronRight", 13)}</button>
      <button class="rw-rate" data-rw="rate" title="Slower">1×</button>
      <button class="icon" data-rw="mute" title="Mute">${icon("volume", 13)}</button>
      <button class="icon" data-rw="keep" title="Keep this frame as a picture">${icon("camera", 13)}</button>
    </div>`;

  /** What the case knows about the file, folded under the title to start. */
  function factsStrip(facts) {
    const when = [facts.captured && `Captured ${facts.captured}`, facts.published && `Published ${facts.published}`]
      .filter(Boolean)
      .join(" · ");
    const source = facts.source
      ? `<a href="${esc(facts.source.url)}" target="_blank" rel="noopener noreferrer" title="${esc(facts.source.url)}">
          <span>${esc(facts.source.label)}</span>${icon("external", 10)}</a>`
      : "";
    return `
      <div class="rw-facts">
        ${when ? `<p>${esc(when)}</p>` : ""}
        ${source}
        ${facts.notes ? `<p class="rw-notes">${esc(facts.notes)}</p>` : ""}
      </div>`;
  }

  /**
   * The windows and their picker.
   *
   * @param {object} deps
   * @param {ShadowRoot} deps.root where the panel already lives
   * @param {object} deps.refs the tool holding which windows are open (maptools)
   * @param {(path: string, onprogress?: (done: number, total: number) => void)
   *   => Promise<Blob>} deps.file one case file's bytes, reported as they land
   * @param {(params: object) => Promise<object>} deps.search what the case offers
   * @param {(path: string) => Promise<object>} [deps.probe] a clip's frame rate
   * @param {() => void} deps.onchange the open list moved; the panel re-reads it
   * @param {(message: string) => void} deps.onnote something to say in the panel
   */
  function create({ root, refs, file, search, probe, onchange, onnote }) {
    const style = document.createElement("style");
    style.textContent = styles();
    root.appendChild(style);

    const panes = new Map(); // viewer id -> { el, body, viewer, bitmap | video, ... }
    const thumbs = new Map(); // media path -> ImageBitmap | null (null = none to show)
    let picker = null;
    let typing = 0;
    let searching = 0; // the search whose answer is still the current one

    // Each docked column's inner edge, which widens or narrows it.
    const edges = {};
    for (const side of ["left", "right"]) {
      const edge = document.createElement("div");
      edge.className = "rw-dock-edge";
      edge.dataset.side = side;
      edge.title = "Drag to resize · double-click to reset";
      edge.style.display = "none";
      root.appendChild(edge);
      edges[side] = edge;
    }

    // --- one window ----------------------------------------------------------

    function mount(viewer) {
      const moving = viewer.kind === "video";
      const facts = T.hasFacts(viewer.facts) ? viewer.facts : null;
      const el = document.createElement("div");
      el.className = "rw";
      el.tabIndex = 0;
      el.innerHTML = `
        <header>
          <span class="rw-grip">${icon("grip", 13)}</span>
          <span class="rw-title" title="${esc(viewer.title)}">${esc(viewer.title || "Reference")}</span>
          <span class="rw-places" role="group" aria-label="Places" style="display: none">
            ${T.PLACES.map(
              (option) =>
                `<button class="icon" data-rw-place="${option.id}" title="${option.label}" aria-label="${option.label}">${icon(option.icon, 13)}</button>`
            ).join("")}
          </span>
          ${facts ? `<button class="icon" data-rw="info" title="Dates, source and notes">${icon("info", 13)}</button>` : ""}
          <button class="icon" data-rw="place" title="Pin it beside or over the map">${icon("pushpin", 13)}</button>
          <button class="icon" data-rw="fold" title="Fold">${icon("chevronUp", 13)}</button>
          <button class="icon" data-rw="close" title="Close">${icon("x", 13)}</button>
        </header>
        ${facts ? factsStrip(facts) : ""}
        <div class="rw-stage">
          <div class="rw-body${moving ? " clip" : ""}">
            ${moving ? "" : "<canvas></canvas>"}
            <div class="rw-wait">Loading…</div>
          </div>
          ${moving ? '<div class="rw-line"></div>' : ""}
          <div class="rw-foot${moving ? " clip" : ""}">${moving ? clipBar() : imageBar()}</div>
        </div>
        <div class="rw-resize" title="Resize"></div>`;
      root.appendChild(el);

      const q = (selector) => el.querySelector(selector);
      const pane = {
        el,
        viewer,
        moving, // a video, which shows itself rather than being painted
        folded: false, // what the fold button is currently drawn as
        paused: true, // what the play button is currently drawn as
        presented: null, // the frame the browser last drew, when it says
        bitmap: null,
        url: null, // the object URL a video is playing from, to be revoked
        head: q("header"),
        facts: q(".rw-facts"),
        stage: q(".rw-stage"),
        body: q(".rw-body"),
        foot: q(".rw-foot"),
        resize: q(".rw-resize"),
        places: q(".rw-places"),
        placing: false, // the header showing the six places
        canvas: q("canvas"),
        wait: q(".rw-wait"),
        zoom: q(".rw-zoom"),
        fade: q(".rw-fade"),
        range: q(".rw-range"),
      };
      wire(pane);

      if (viewer.still) {
        // a frame kept from a clip, decoded already
        pane.bitmap = viewer.still;
        measured(pane, pane.bitmap.width, pane.bitmap.height);
        pane.wait.remove();
      } else {
        file(viewer.path, (done, total) => waiting(pane, done, total)).then(
          (blob) => (moving ? play(pane, blob) : show(pane, blob)),
          (e) => refuse(pane, e.message)
        );
      }
      if (moving) {
        probe?.(viewer.path).then(
          (info) => {
            if (info?.fps > 0) viewer.fps = info.fps;
          },
          () => {} // stepped at the default rate, as the app does without a probe
        );
      }
      return pane;
    }

    /**
     * How far along the file is, while it is still coming.
     *
     * Only ever seen on a file worth waiting for: one that arrives in a single
     * piece reports `done === total` and is left alone, so a photo never
     * flickers a percentage on its way in. A long video otherwise sits on
     * "Loading…" for a minute with nothing to say whether it is moving.
     */
    function waiting(pane, done, total) {
      if (!pane.wait.isConnected || !total || done >= total) return;
      pane.wait.textContent = `Loading… ${Math.floor((done / total) * 100)}%`;
    }

    /** An image: decoded once, then painted at whatever zoom the window holds. */
    async function show(pane, blob) {
      try {
        pane.bitmap = await createImageBitmap(blob);
      } catch {
        return refuse(pane, "that file is not an image this browser can read");
      }
      pane.wait.remove();
      measured(pane, pane.bitmap.width, pane.bitmap.height);
      paint(pane);
    }

    /** The picture's own shape, which a docked window takes its height from. */
    function measured(pane, w, h) {
      if (!w || !h) return;
      pane.viewer.aspect = w / h;
      if (pane.viewer.docked) layoutDock();
    }

    /**
     * A video, handed to the element through an object URL.
     *
     * The one thing in this panel a map site can veto: the URL is `blob:`, and a
     * page whose policy narrows `media-src` will refuse it. The refusal arrives
     * as an `error` on the element, which is why it is listened for — an empty
     * black box that never says anything is the worst version of this.
     */
    function play(pane, blob) {
      const video = document.createElement("video");
      pane.url = URL.createObjectURL(blob);
      video.preload = "metadata";
      video.playsInline = true;
      video.muted = pane.viewer.muted;
      video.addEventListener("loadeddata", () => pane.wait.remove());
      video.addEventListener("loadedmetadata", () => measured(pane, video.videoWidth, video.videoHeight));
      video.addEventListener("error", () =>
        refuse(pane, "this site will not play a video. Open it in Azimut")
      );
      for (const name of ["play", "pause", "timeupdate", "durationchange", "seeked", "loadedmetadata"]) {
        video.addEventListener(name, () => clock(pane));
      }
      // The frame the browser actually drew, so the clock and a step name the
      // very frame on screen.
      if (video.requestVideoFrameCallback) {
        const tick = (_now, meta) => {
          pane.presented = meta.mediaTime;
          clock(pane);
          if (pane.video === video) video.requestVideoFrameCallback(tick);
        };
        video.requestVideoFrameCallback(tick);
      }
      video.src = pane.url;
      pane.body.appendChild(video);
      pane.video = video;
      paint(pane);
    }

    /** The window stays, saying why it is empty. A pane that vanished would look
     *  like a misclick rather than a file the app could not hand over. */
    function refuse(pane, message) {
      if (!pane.wait.isConnected) pane.body.appendChild(pane.wait);
      pane.wait.textContent = message;
      pane.video?.remove();
      pane.video = null;
      onnote(message);
    }

    // --- a clip --------------------------------------------------------------

    const shownOf = (pane) =>
      T.shownFrameTime(pane.video?.currentTime ?? 0, pane.viewer.fps, pane.presented);

    /** The player's readings: the play glyph, the bar and the frame's time. */
    function clock(pane) {
      const video = pane.video;
      if (!video) return;
      const paused = video.paused;
      // Only when it turns over: rewriting the glyph between a press and its
      // release takes the node away and the click never lands.
      if (pane.paused !== paused) {
        pane.paused = paused;
        const button = pane.el.querySelector('[data-rw="play"]');
        button.innerHTML = icon(paused ? "play" : "pause", 13);
        button.title = paused ? "Play" : "Pause";
      }
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const shown = shownOf(pane);
      const scrub = pane.el.querySelector(".rw-scrub");
      scrub.disabled = !duration;
      scrub.max = String(duration || 1);
      scrub.value = String(shown);
      const fill = duration ? `${Math.min(100, (shown / duration) * 100)}%` : "0%";
      scrub.style.setProperty("--fill", fill);
      pane.el.querySelector(".rw-line").style.width = fill;
      pane.el.querySelector(".rw-time").textContent = T.preciseClock(shown);
    }

    function seek(pane, to) {
      if (!pane.video) return;
      pane.presented = null; // until the new frame is drawn, it is worked out
      pane.video.currentTime = to;
      clock(pane);
    }

    function togglePlay(pane) {
      const video = pane.video;
      if (!video) return;
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }

    function step(pane, frames) {
      const video = pane.video;
      if (!video) return;
      video.pause();
      const { fps } = pane.viewer;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      seek(pane, T.stepTarget(shownOf(pane), frames * T.frameDuration(fps), fps, duration));
    }

    /** The frame on screen, decoded off the element and opened as a picture. */
    async function keep(pane) {
      const video = pane.video;
      if (!video?.videoWidth) return;
      video.pause();
      const at = shownOf(pane);
      let still;
      try {
        still = await createImageBitmap(video);
      } catch {
        return onnote("this frame could not be kept");
      }
      refs.keepFrame(pane.viewer.id, still, at);
      sync();
      onchange();
    }

    // --- the gestures --------------------------------------------------------

    function wire(pane) {
      const { el, head, body } = pane;

      el.addEventListener("pointerdown", () => {
        refs.focus(pane.viewer.id);
        for (const other of panes.values()) place(other);
      }, true);

      el.addEventListener("click", (event) => {
        const where = event.target.closest("[data-rw-place]")?.dataset.rwPlace;
        if (where) {
          pane.placing = false;
          refs.place(pane.viewer.id, where);
          sync();
          onchange();
          return;
        }
        const act = event.target.closest("[data-rw]")?.dataset.rw;
        if (!act) return;
        const viewer = pane.viewer;
        if (act === "place") {
          pane.placing = !pane.placing;
          place(pane);
          return;
        }
        if (act === "close") {
          refs.close(viewer.id);
          sync();
          onchange();
          return;
        }
        if (act === "fold") {
          viewer.collapsed = !viewer.collapsed;
          sync();
          onchange();
          return;
        }
        if (act === "info") viewer.info = !viewer.info;
        else if (act === "fade") Object.assign(viewer, T.flipFade(viewer));
        else if (act === "play") togglePlay(pane);
        else if (act === "back" || act === "forward") step(pane, act === "back" ? -1 : 1);
        else if (act === "rate") {
          viewer.rate = T.nextSlowRate(viewer.rate);
          if (pane.video) pane.video.playbackRate = viewer.rate;
        } else if (act === "mute") {
          viewer.muted = !viewer.muted;
          if (pane.video) pane.video.muted = viewer.muted;
        } else if (act === "keep") keep(pane);
        else if (act === "reset") {
          viewer.scale = 1;
          viewer.ox = 0;
          viewer.oy = 0;
        } else if (act === "in" || act === "out") {
          const size = { w: body.clientWidth, h: body.clientHeight };
          const at = { x: size.w / 2, y: size.h / 2 };
          Object.assign(viewer, T.zoomAt(viewer, act === "in" ? 1.25 : 1 / 1.25, at, size));
        }
        place(pane);
      });

      el.addEventListener("input", (event) => {
        const which = event.target.dataset.rwInput;
        if (which === "opacity") {
          pane.viewer.opacity = T.clampOpacity(event.target.value);
          if (pane.viewer.opacity < 1) pane.viewer.fadeTo = pane.viewer.opacity;
          place(pane);
        } else if (which === "seek") seek(pane, Number(event.target.value));
      });

      // A clip's keys, while the window has the focus: Space plays, the arrows
      // step one frame. Stopped here, so the site's map does not pan with them.
      el.addEventListener("keydown", (event) => {
        if (pane.placing && event.key === "Escape") {
          pane.placing = false;
          place(pane);
          return mine(event);
        }
        if (!pane.moving || !pane.video) return;
        const tag = event.target.tagName;
        if (tag === "INPUT" || (tag === "BUTTON" && (event.key === " " || event.key === "Enter"))) return;
        if (event.key === " ") togglePlay(pane);
        else if (event.key === "ArrowLeft") step(pane, -1);
        else if (event.key === "ArrowRight") step(pane, 1);
        else return;
        mine(event);
      });

      // Double-clicking a title bar folds it: the affordance every window has,
      // and the map must not take the second click as a zoom.
      head.addEventListener("dblclick", (event) => {
        if (event.target.closest("button")) return;
        mine(event);
        refs.fold(pane.viewer.id);
        sync();
        onchange();
      });

      head.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        mine(event);
        el.focus({ preventScroll: true });
        if (pane.viewer.docked) return; // the column holds it where it is
        const start = { x: event.clientX, y: event.clientY };
        const from = { x: pane.viewer.x, y: pane.viewer.y };
        const height = () => (pane.viewer.collapsed ? pane.head.offsetHeight : pane.viewer.h);
        let moved = false;
        drag(
          (move) => {
            // a press on the title that never moves leaves a pinned window pinned
            if (!moved && Math.abs(move.clientX - start.x) + Math.abs(move.clientY - start.y) <= 3) return;
            moved = true;
            const viewer = pane.viewer;
            viewer.corner = false;
            const at = T.snapWindow(
              from.x + move.clientX - start.x,
              from.y + move.clientY - start.y,
              viewer.w,
              height(),
              bounds()
            );
            viewer.x = at.x;
            viewer.y = at.y;
            place(pane);
          },
          () => {
            // let go against two edges at once, it stays in that corner
            const viewer = pane.viewer;
            const corner = moved && T.settledCorner(viewer.x, viewer.y, viewer.w, height(), bounds());
            if (!corner) return;
            refs.place(viewer.id, corner);
            place(pane);
            onchange();
          }
        );
      });

      pane.resize.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        mine(event);
        const start = { x: event.clientX, y: event.clientY };
        const from = { w: pane.viewer.w, h: pane.viewer.h };
        // a pinned window grows away from its corner, toward the handle
        const corner = pane.viewer.corner || "";
        const across = corner.endsWith("r") ? -1 : 1;
        const down = corner.startsWith("b") ? -1 : 1;
        drag((move) => {
          const viewer = pane.viewer;
          const size = T.clampSize(
            from.w + across * (move.clientX - start.x),
            from.h + down * (move.clientY - start.y),
            viewer.corner ? 0 : viewer.x,
            viewer.corner ? 0 : viewer.y,
            bounds()
          );
          viewer.w = size.w;
          viewer.h = size.h;
          // the pane got bigger under an image that was panned to an edge
          Object.assign(viewer, T.clampPan(viewer.ox, viewer.oy, viewer.scale, body.clientWidth, body.clientHeight));
          place(pane);
        });
      });

      body.addEventListener("pointerdown", (event) => {
        // at fit scale an image has nothing to pan; a clip still takes the
        // press, since a click on it plays or pauses
        const zoomed = pane.viewer.scale > 1;
        if (event.button !== 0 || (!zoomed && !pane.moving)) return;
        mine(event);
        el.focus({ preventScroll: true });
        const start = { x: event.clientX, y: event.clientY };
        const from = { ox: pane.viewer.ox, oy: pane.viewer.oy };
        let moved = false;
        drag(
          (move) => {
            if (Math.abs(move.clientX - start.x) + Math.abs(move.clientY - start.y) > 3) moved = true;
            if (!zoomed) return;
            Object.assign(
              pane.viewer,
              T.clampPan(
                from.ox + move.clientX - start.x,
                from.oy + move.clientY - start.y,
                pane.viewer.scale,
                body.clientWidth,
                body.clientHeight
              )
            );
            paint(pane);
          },
          () => {
            if (!moved && pane.moving) togglePlay(pane);
          }
        );
      });

      body.addEventListener(
        "wheel",
        (event) => {
          // Not passive: a wheel over the picture zooms the picture, and the map
          // underneath must not zoom with it.
          mine(event);
          const rect = body.getBoundingClientRect();
          const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          const size = { w: rect.width, h: rect.height };
          Object.assign(pane.viewer, T.zoomAt(pane.viewer, event.deltaY < 0 ? 1.15 : 1 / 1.15, at, size));
          paint(pane);
        },
        { passive: false }
      );
    }

    // --- drawing -------------------------------------------------------------

    /** What a pinned window keeps clear of: the panel, when it is on screen. */
    function obstacles() {
      const panel = root.querySelector(".panel")?.getBoundingClientRect();
      return panel?.width ? [{ x: panel.left, y: panel.top, w: panel.width, h: panel.height }] : [];
    }

    /** Where the window is, how big, how high in the stack, and how it reads. */
    function place(pane) {
      const { el, viewer } = pane;
      if (viewer.corner) {
        const height = viewer.collapsed ? pane.head.offsetHeight || 32 : viewer.h;
        Object.assign(viewer, T.cornerSpot(viewer.corner, viewer.w, height, bounds(), obstacles()));
      }
      if (!viewer.docked) {
        el.style.left = `${viewer.x}px`;
        el.style.top = `${viewer.y}px`;
        el.style.width = `${viewer.w}px`;
        el.style.height = `${viewer.h}px`;
      }
      // above the drawing layer (1), below the panel — restacking is what keeps
      // that true however many windows have been opened
      el.style.zIndex = String(1 + viewer.z);
      const seeThrough = !viewer.docked && viewer.opacity < 1;
      el.classList.toggle("folded", viewer.collapsed);
      el.classList.toggle("docked", viewer.docked);
      el.classList.toggle("see-through", seeThrough);
      const open = !viewer.collapsed;
      pane.stage.style.display = open ? "" : "none";
      if (pane.facts) pane.facts.style.display = open && viewer.info ? "" : "none";
      pane.resize.style.display = open && !viewer.docked ? "" : "none";
      pane.body.style.opacity = viewer.docked ? "" : String(viewer.opacity);
      // nothing is under a docked window to see through to
      pane.fade.style.display = viewer.docked ? "none" : "";
      pane.fade.classList.toggle("on", viewer.opacity < 1);
      const fadeButton = pane.fade.querySelector("button");
      fadeButton.classList.toggle("lit", viewer.opacity < 1);
      fadeButton.title = viewer.opacity < 1 ? "Solid again" : "See the map through it";
      pane.range.value = String(viewer.opacity);
      pane.range.title = `Opacity ${Math.round(viewer.opacity * 100)}%`;
      pane.range.style.setProperty("--fill", `${((viewer.opacity - T.MIN_OPACITY) / (1 - T.MIN_OPACITY)) * 100}%`);
      // The pin wears the place the window is in. Only when that changes: the
      // pin is pressed to open the places, and a glyph rewritten between a press
      // and its release swallows the click.
      const where = T.placeOf(viewer);
      const pin = el.querySelector('[data-rw="place"]');
      pin.classList.toggle("lit", Boolean(where) || pane.placing);
      pin.title = pane.placing
        ? "Put the places away"
        : where
          ? `${where.label}: move or free it`
          : "Pin it beside or over the map";
      if (pin.dataset.place !== (where?.id ?? "")) {
        pin.dataset.place = where?.id ?? "";
        pin.innerHTML = icon(where?.icon ?? "pushpin", 13);
      }
      el.classList.toggle("placing", pane.placing);
      pane.places.style.display = pane.placing ? "" : "none";
      for (const option of pane.places.querySelectorAll("[data-rw-place]")) {
        const here = option.dataset.rwPlace === where?.id;
        option.classList.toggle("lit", here);
        option.title = here ? "Free it" : T.PLACES.find((p) => p.id === option.dataset.rwPlace).label;
      }
      pane.resize.className = `rw-resize${viewer.corner ? ` from-${viewer.corner}` : ""}`;
      el.querySelector('[data-rw="info"]')?.classList.toggle("lit", viewer.info);
      if (pane.moving) {
        const rate = el.querySelector('[data-rw="rate"]');
        rate.textContent = `${viewer.rate}×`;
        rate.title = T.nextSlowRate(viewer.rate) === 1 ? "Normal speed" : "Slower";
        rate.classList.toggle("lit", viewer.rate !== 1);
        const mute = el.querySelector('[data-rw="mute"]');
        if (mute.dataset.muted !== String(viewer.muted)) {
          mute.dataset.muted = String(viewer.muted);
          mute.innerHTML = icon(viewer.muted ? "volumeOff" : "volume", 13);
          mute.title = viewer.muted ? "Sound on" : "Mute";
        }
      }
      // Only when it actually turns over. `place` runs on every pointer down in
      // the window (focus restacks them all), and rewriting this button's glyph
      // took the node out of the DOM between the press and the release — which
      // is a chevron that swallows its own click and never folds anything.
      if (pane.folded !== viewer.collapsed) {
        pane.folded = viewer.collapsed;
        const fold = el.querySelector('[data-rw="fold"]');
        fold.innerHTML = icon(viewer.collapsed ? "chevronDown" : "chevronUp", 13);
        fold.title = viewer.collapsed ? "Unfold" : "Fold";
      }
      if (open) paint(pane);
    }

    /**
     * The picture, at the zoom and offset the window holds.
     *
     * The app fits its `<img>` with `object-fit: contain` and then applies the
     * zoom as a transform from the pane's own top-left. Same two steps here, in
     * the same order, so a window opened in either place shows the same thing.
     * A clip is the element itself, fitted the same way and moved by a transform.
     */
    function paint(pane) {
      const { canvas, bitmap, viewer, body } = pane;
      pane.zoom.textContent = `${Math.round(viewer.scale * 100)}%`;
      body.classList.toggle("pannable", viewer.scale > 1);
      if (pane.moving) {
        // the readout says how to get back to the fit, so it shows only once zoomed
        pane.zoom.style.display = viewer.scale > 1 ? "" : "none";
        if (pane.video) {
          pane.video.style.transform = `translate(${viewer.ox}px, ${viewer.oy}px) scale(${viewer.scale})`;
        }
        return;
      }
      const w = body.clientWidth;
      const h = body.clientHeight;
      if (!w || !h) return;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!bitmap) return;
      const fit = Math.min(w / bitmap.width, h / bitmap.height);
      const fw = bitmap.width * fit;
      const fh = bitmap.height * fit;
      ctx.translate(viewer.ox, viewer.oy);
      ctx.scale(viewer.scale, viewer.scale);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, (w - fw) / 2, (h - fh) / 2, fw, fh);
    }

    // --- the dock ------------------------------------------------------------

    /**
     * The docked windows: a column on each side that holds any, in the order
     * they were opened, the stack centred on the height of the screen. Each is
     * as tall as its picture (a folded one is its header), and all of them are
     * squeezed alike when they would run past the screen's height.
     */
    function layoutDock() {
      for (const side of ["left", "right"]) {
        const edge = edges[side];
        const rows = refs
          .dockedOn(side)
          .map((viewer) => panes.get(viewer.id))
          .filter(Boolean);
        if (!rows.length) {
          edge.style.display = "none";
          continue;
        }
        const width = T.clampDock(refs.dockWidth(side), window.innerWidth);
        const x = side === "left" ? 0 : window.innerWidth - width;
        const sizes = rows.map((pane) => {
          const head = pane.head.offsetHeight || 32;
          if (pane.viewer.collapsed) return { pane, chrome: head, picture: 0 };
          const facts = pane.viewer.info && pane.facts ? pane.facts.offsetHeight : 0;
          return { pane, chrome: head + facts, picture: width / (pane.viewer.aspect || 4 / 3) };
        });
        const chrome = sizes.reduce((sum, row) => sum + row.chrome, 0);
        const pictures = sizes.reduce((sum, row) => sum + row.picture, 0);
        const squeeze = pictures ? Math.min(1, Math.max(0, window.innerHeight - chrome) / pictures) : 1;
        // the stack sits in the middle of its side, however many it holds
        const total = sizes.reduce((sum, row) => sum + Math.round(row.chrome + row.picture * squeeze), 0);
        let y = Math.max(0, Math.round((window.innerHeight - total) / 2));
        for (const { pane, chrome: top, picture } of sizes) {
          const height = Math.round(top + picture * squeeze);
          Object.assign(pane.el.style, {
            left: `${x}px`,
            top: `${y}px`,
            width: `${width}px`,
            height: `${height}px`,
          });
          y += height;
          if (!pane.viewer.collapsed) paint(pane);
        }
        Object.assign(edge.style, {
          display: "",
          left: `${side === "left" ? width - 3 : x - 2}px`,
          zIndex: String(2 + refs.open.length),
        });
      }
    }

    for (const edge of Object.values(edges)) {
      const side = edge.dataset.side;
      edge.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        mine(event);
        const start = event.clientX;
        const from = T.clampDock(refs.dockWidth(side), window.innerWidth);
        const toward = side === "left" ? 1 : -1; // toward the middle widens it
        edge.classList.add("moving");
        drag(
          (move) => {
            refs.setDockWidth(side, from + toward * (move.clientX - start), window.innerWidth);
            layoutDock();
          },
          () => edge.classList.remove("moving")
        );
      });
      edge.addEventListener("dblclick", (event) => {
        mine(event);
        refs.setDockWidth(side, T.DOCK_W, window.innerWidth);
        layoutDock();
      });
    }

    /** The windows on screen, matched to the windows the tool holds. */
    function sync() {
      const open = refs.open;
      const live = new Set(open.map((viewer) => viewer.id));
      for (const [id, pane] of panes) {
        if (live.has(id)) continue;
        drop(pane);
        panes.delete(id);
      }
      for (const viewer of open) {
        let pane = panes.get(viewer.id);
        if (!pane) {
          pane = mount(viewer);
          panes.set(viewer.id, pane);
        }
        pane.viewer = viewer;
        place(pane);
      }
      layoutDock();
    }

    /** One window, off the screen and out of memory: a decoded image and a
     *  video's object URL both outlive the node that showed them. */
    function drop(pane) {
      pane.bitmap?.close?.();
      if (pane.url) URL.revokeObjectURL(pane.url);
      pane.video = null;
      pane.el.remove();
    }

    // --- the picker ----------------------------------------------------------

    /** The two narrowings the picker offers, and what they are called. The case
     *  is searched, filtered and ordered by the app — a browser tab holds one
     *  page of a case, never the case. */
    const KINDS = [["", "Images and videos"], ["image", "Images"], ["video", "Videos"]];
    const SORTS = [["newest", "Newest first"], ["oldest", "Oldest first"], ["name", "By name"]];

    function openPicker() {
      if (picker) return;
      const el = document.createElement("div");
      el.className = "pick";
      const options = (pairs, chosen) =>
        pairs
          .map(([value, label]) => `<option value="${value}"${value === chosen ? " selected" : ""}>${label}</option>`)
          .join("");
      const chosen = { q: "", kind: "", sort: "newest" };
      el.innerHTML = `
        <header>
          <span class="name">Add reference</span>
          <button class="icon" data-pick="close" title="Close">${icon("x", 13)}</button>
        </header>
        <div class="body">
          <input data-pick="q" placeholder="Search media…" autocomplete="off">
          <div class="pick-filters">
            <select data-pick="kind">${options(KINDS, chosen.kind)}</select>
            <select data-pick="sort">${options(SORTS, chosen.sort)}</select>
          </div>
          <div class="pick-grid"></div>
          <div class="hint">Loading…</div>
        </div>`;
      root.appendChild(el);
      picker = {
        el,
        grid: el.querySelector(".pick-grid"),
        hint: el.querySelector(".hint"),
        items: [],
        ...chosen,
      };

      el.addEventListener("click", (event) => {
        if (event.target.closest('[data-pick="close"]')) return closePicker();
        const index = event.target.closest("[data-index]")?.dataset.index;
        if (index == null) return;
        const item = picker.items[Number(index)];
        if (!item) return;
        refs.add(item);
        closePicker();
        sync();
        onchange();
      });
      el.addEventListener("input", (event) => {
        if (event.target.dataset.pick !== "q") return;
        clearTimeout(typing);
        picker.q = event.target.value;
        typing = setTimeout(fill, TYPING_MS);
      });
      el.addEventListener("change", (event) => {
        const which = event.target.dataset.pick;
        if (which !== "kind" && which !== "sort") return;
        picker[which] = event.target.value;
        fill();
      });
      // A pointer down inside the picker is not a gesture on the map
      el.addEventListener("pointerdown", (event) => event.stopPropagation());
      window.addEventListener("keydown", onKey, true);
      el.querySelector("input").focus();
      fill();
    }

    function closePicker() {
      if (!picker) return;
      clearTimeout(typing);
      window.removeEventListener("keydown", onKey, true);
      picker.el.remove();
      picker = null;
      onchange();
    }

    function onKey(event) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closePicker();
    }

    /** Read the case and draw the choice. An answer that is no longer the
     *  current search is dropped: typing one letter more must not be undone by
     *  the answer to the word before it. */
    async function fill() {
      if (!picker) return;
      const mine = (searching += 1);
      const { q, kind, sort } = picker;
      let answer;
      try {
        answer = await search({ q, kind, sort });
      } catch (e) {
        if (!picker || mine !== searching) return;
        picker.grid.innerHTML = "";
        picker.hint.textContent = e.message;
        return;
      }
      if (!picker || mine !== searching) return;
      picker.items = answer.items || [];
      if (!picker.items.length) {
        picker.grid.innerHTML = "";
        picker.hint.textContent = q
          ? "No media matches this search."
          : "No images or videos in this case yet. Import one in the Media Library first.";
        return;
      }
      picker.grid.innerHTML = picker.items
        .map(
          (item, index) => `
            <button class="pick-item" data-index="${index}" title="${esc(item.title || item.filename)}">
              <span class="pick-thumb" data-thumb="${index}" data-key="${esc(item.thumbnail)}">
                ${icon(item.kind === "video" ? "video" : "image", 22)}
                ${item.kind === "video" ? `<span class="pick-kind">${icon("video", 11)}</span>` : ""}
              </span>
              <span class="pick-name">${esc(item.title || item.filename)}</span>
            </button>`
        )
        .join("");
      const total = answer.total ?? picker.items.length;
      picker.hint.textContent =
        total > picker.items.length
          ? `${picker.items.length} of ${total}. Search to narrow it down`
          : `${total} file${total === 1 ? "" : "s"}`;
      paintThumbs();
    }

    /** Thumbnails, one request each, drawn as they land. The file itself is
     *  fetched only when one is picked: a case of two hundred images must not
     *  cross the message boundary to fill a grid. */
    function paintThumbs() {
      const open = picker;
      for (const [index, item] of open.items.entries()) {
        if (!item.thumbnail) continue;
        const slot = open.grid.querySelector(`[data-thumb="${index}"]`);
        if (!slot) continue;
        const seen = thumbs.get(item.thumbnail);
        if (seen) {
          drawThumb(slot, seen);
          continue;
        }
        if (seen === null) continue; // asked once, and it was not there
        thumbnail(item.thumbnail).then(
          (bitmap) => {
            thumbs.set(item.thumbnail, bitmap);
            if (picker !== open) return;
            // the grid may have been rebuilt by a later search: the tile is only
            // this image's if it still says so
            const tile = open.grid.querySelector(`[data-thumb="${index}"]`);
            if (tile?.dataset.key === item.thumbnail) drawThumb(tile, bitmap);
          },
          () => thumbs.set(item.thumbnail, null)
        );
      }
    }

    /** The app draws a thumbnail for a video too, so the tile for one is a frame
     *  of it rather than a placeholder. */
    const thumbnail = (path) => file(path).then(createImageBitmap);

    /** One thumbnail, cropped to fill its tile the way the app's grid does. */
    function drawThumb(slot, bitmap) {
      if (!slot || slot.querySelector("canvas")) return;
      const badge = slot.querySelector(".pick-kind");
      const canvas = document.createElement("canvas");
      const rect = slot.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const cover = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const w = bitmap.width * cover;
      const h = bitmap.height * cover;
      canvas
        .getContext("2d")
        .drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      slot.innerHTML = "";
      slot.appendChild(canvas);
      if (badge) slot.appendChild(badge); // the video mark rides over the frame
    }

    // --- lifecycle -----------------------------------------------------------

    /** A window remembered on a wide screen must not sit off a narrow one. */
    function onResize() {
      for (const pane of panes.values()) {
        const viewer = pane.viewer;
        const size = T.clampSize(viewer.w, viewer.h, 0, 0, bounds());
        viewer.w = size.w;
        viewer.h = size.h;
        Object.assign(viewer, T.clampWindow(viewer.x, viewer.y, viewer.w, viewer.h, bounds()));
        place(pane);
      }
      layoutDock(); // the column is the screen's height, and at most half its width
    }
    window.addEventListener("resize", onResize);

    return {
      sync,
      openPicker,
      closePicker,
      get picking() {
        return !!picker;
      },
      destroy() {
        closePicker();
        window.removeEventListener("resize", onResize);
        for (const pane of panes.values()) drop(pane);
        panes.clear();
        for (const bitmap of thumbs.values()) bitmap?.close?.();
        thumbs.clear();
        for (const edge of Object.values(edges)) edge.remove();
        style.remove();
      },
    };
  }

  window.AzimutMapRefs = { create };
})();
