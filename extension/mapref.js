/**
 * The reference windows: the case's own images and videos, over the map.
 *
 * The app's Satellite tab can hold the shot being geolocated against the
 * imagery, in a small pane that moves and zooms independently of the map
 * (`tools/RefViewer.svelte`, `lib/refViewers.js`). This is that, over someone
 * else's map. It is the pane that makes the rest of the panel worth opening:
 * measuring a courtyard means nothing until it is the courtyard in the image.
 *
 * Two things about it are not obvious:
 *
 * - **An image is painted, never linked.** A map site's content policy is free
 *   to refuse a `data:` or `blob:` image, and several do. So the bytes arrive as
 *   bytes, are decoded with `createImageBitmap` and drawn on a canvas, which
 *   asks no policy anything. A **video cannot be painted** — the element wants a
 *   URL — so it gets a `blob:` one, and it is the single thing here a site is in
 *   a position to refuse. When one does, the window says so rather than sitting
 *   there black.
 * - **It reaches nothing itself.** `file()` and `search()` are handed in by
 *   `mapoverlay.js`, which stays the only file that knows an extension API
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
  function drag(move) {
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
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
        color: ${t.text1}; background: ${t.bg1};
        border: 1px solid ${t.border}; border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0,0,0,.5);
        pointer-events: auto; user-select: none;
      }
      .rw.folded { height: auto !important; }
      .rw header { padding: 5px 6px 5px 8px; cursor: grab; }
      .rw header:active { cursor: grabbing; }
      .rw .rw-title {
        flex: 1; min-width: 0; font-size: 11.5px; font-weight: 600; color: ${t.text1};
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .rw-body {
        flex: 1; min-height: 0; position: relative; overflow: hidden; background: ${t.bg0};
      }
      .rw-body.pannable { cursor: grab; }
      .rw-body.pannable:active { cursor: grabbing; }
      .rw-body canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .rw-body video { position: absolute; inset: 0; width: 100%; height: 100%; background: #000; }
      .rw-wait {
        position: absolute; inset: 0; display: grid; place-items: center;
        padding: 0 12px; text-align: center; font-size: 11.5px; color: ${t.text3};
      }
      .rw-foot {
        display: flex; align-items: center; justify-content: flex-end; gap: 4px;
        padding: 3px 5px; border-top: 1px solid ${t.border};
      }
      .rw-zoom {
        min-width: 44px; padding: 3px 4px; font-size: 11px; color: ${t.text2};
        background: none; border-color: transparent;
      }
      .rw-zoom:hover:not([disabled]) { color: ${t.accent}; background: ${t.bg3}; }
      .rw-resize {
        position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
        cursor: nwse-resize;
        background: linear-gradient(135deg, transparent 55%, ${t.borderStrong} 55%,
          ${t.borderStrong} 65%, transparent 65%, transparent 77%, ${t.borderStrong} 77%,
          ${t.borderStrong} 87%, transparent 87%);
      }
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

  /**
   * The windows and their picker.
   *
   * @param {object} deps
   * @param {ShadowRoot} deps.root where the panel already lives
   * @param {object} deps.refs the tool holding which windows are open (maptools)
   * @param {(path: string) => Promise<Blob>} deps.file one case file's bytes
   * @param {(params: object) => Promise<object>} deps.search what the case offers
   * @param {() => void} deps.onchange the open list moved; the panel re-reads it
   * @param {(message: string) => void} deps.onnote something to say in the panel
   */
  function create({ root, refs, file, search, onchange, onnote }) {
    const style = document.createElement("style");
    style.textContent = styles();
    root.appendChild(style);

    const panes = new Map(); // viewer id -> { el, body, viewer, bitmap | video, ... }
    const thumbs = new Map(); // media path -> ImageBitmap | null (null = none to show)
    let picker = null;
    let typing = 0;
    let searching = 0; // the search whose answer is still the current one

    // --- one window ----------------------------------------------------------

    function mount(viewer) {
      const moving = viewer.kind === "video";
      const el = document.createElement("div");
      el.className = "rw";
      el.innerHTML = `
        <header>
          ${icon("grip", 13)}
          <span class="rw-title" title="${esc(viewer.title)}">${esc(viewer.title || "Reference")}</span>
          <button class="icon" data-rw="fold" title="Fold">${icon("chevronUp", 13)}</button>
          <button class="icon" data-rw="close" title="Close">${icon("x", 13)}</button>
        </header>
        <div class="rw-body">
          ${moving ? "" : "<canvas></canvas>"}
          <div class="rw-wait">Loading…</div>
        </div>
        ${moving ? "" : `
          <div class="rw-foot">
            <button class="icon" data-rw="out" title="Zoom out">${icon("minimize", 12)}</button>
            <button class="rw-zoom" data-rw="reset" title="Fit the image">100%</button>
            <button class="icon" data-rw="in" title="Zoom in">${icon("plus", 13)}</button>
          </div>`}
        <div class="rw-resize" title="Resize"></div>`;
      root.appendChild(el);

      const pane = {
        el,
        viewer,
        moving, // a video, which shows itself rather than being painted
        folded: false, // what the fold button is currently drawn as
        bitmap: null,
        url: null, // the object URL a video is playing from, to be revoked
        head: el.querySelector("header"),
        body: el.querySelector(".rw-body"),
        canvas: el.querySelector("canvas"),
        wait: el.querySelector(".rw-wait"),
        zoom: el.querySelector(".rw-zoom"),
      };
      wire(pane);

      file(viewer.path).then(
        (blob) => (moving ? play(pane, blob) : show(pane, blob)),
        (e) => refuse(pane, e.message)
      );
      return pane;
    }

    /** An image: decoded once, then painted at whatever zoom the window holds. */
    async function show(pane, blob) {
      try {
        pane.bitmap = await createImageBitmap(blob);
      } catch {
        return refuse(pane, "that file is not an image this browser can read");
      }
      pane.wait.remove();
      paint(pane);
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
      video.controls = true;
      video.preload = "metadata";
      video.addEventListener("loadeddata", () => pane.wait.remove());
      video.addEventListener("error", () =>
        refuse(pane, "this site will not play a video. Open it in Azimut")
      );
      video.src = pane.url;
      pane.body.appendChild(video);
      pane.video = video;
    }

    /** The window stays, saying why it is empty. A pane that vanished would look
     *  like a misclick rather than a file the app could not hand over. */
    function refuse(pane, message) {
      if (!pane.wait.isConnected) pane.body.appendChild(pane.wait);
      pane.wait.textContent = message;
      pane.video?.remove();
      onnote(message);
    }

    function wire(pane) {
      const { el, head, body } = pane;

      el.addEventListener("pointerdown", () => {
        refs.focus(pane.viewer.id);
        for (const other of panes.values()) place(other);
      }, true);

      el.addEventListener("click", (event) => {
        const act = event.target.closest("[data-rw]")?.dataset.rw;
        if (!act) return;
        const viewer = pane.viewer;
        if (act === "close") {
          refs.close(viewer.id);
          sync();
          onchange();
          return;
        }
        if (act === "fold") {
          viewer.collapsed = !viewer.collapsed;
          place(pane);
          onchange();
          return;
        }
        if (act === "reset") {
          viewer.scale = 1;
          viewer.ox = 0;
          viewer.oy = 0;
        } else {
          const size = { w: body.clientWidth, h: body.clientHeight };
          const at = { x: size.w / 2, y: size.h / 2 };
          Object.assign(viewer, T.zoomAt(viewer, act === "in" ? 1.25 : 1 / 1.25, at, size));
        }
        paint(pane);
      });

      // Double-clicking a title bar folds it: the affordance every window has,
      // and the map must not take the second click as a zoom.
      head.addEventListener("dblclick", (event) => {
        if (event.target.closest("button")) return;
        mine(event);
        refs.fold(pane.viewer.id);
        place(pane);
        onchange();
      });

      head.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        mine(event);
        const start = { x: event.clientX, y: event.clientY };
        const from = { x: pane.viewer.x, y: pane.viewer.y };
        drag((move) => {
          const viewer = pane.viewer;
          const height = viewer.collapsed ? pane.head.offsetHeight : viewer.h;
          const at = T.clampWindow(
            from.x + move.clientX - start.x,
            from.y + move.clientY - start.y,
            viewer.w,
            height,
            bounds()
          );
          viewer.x = at.x;
          viewer.y = at.y;
          place(pane);
        });
      });

      el.querySelector(".rw-resize").addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        mine(event);
        const start = { x: event.clientX, y: event.clientY };
        const from = { w: pane.viewer.w, h: pane.viewer.h };
        drag((move) => {
          const viewer = pane.viewer;
          const size = T.clampSize(
            from.w + move.clientX - start.x,
            from.h + move.clientY - start.y,
            viewer.x,
            viewer.y,
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
        // A video's own controls take the pointer: cancelling the default here
        // would kill the scrub bar. Stopping it is enough to keep the map still.
        if (pane.moving) return event.stopPropagation();
        if (event.button !== 0 || pane.viewer.scale <= 1) return;
        mine(event);
        const start = { x: event.clientX, y: event.clientY };
        const from = { ox: pane.viewer.ox, oy: pane.viewer.oy };
        drag((move) => {
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
        });
      });

      body.addEventListener(
        "wheel",
        (event) => {
          // Not passive: a wheel over the image zooms the image, and the map
          // underneath must not zoom with it. Over a video it does neither.
          mine(event);
          if (pane.moving) return;
          const rect = body.getBoundingClientRect();
          const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          const size = { w: rect.width, h: rect.height };
          Object.assign(pane.viewer, T.zoomAt(pane.viewer, event.deltaY < 0 ? 1.15 : 1 / 1.15, at, size));
          paint(pane);
        },
        { passive: false }
      );
    }

    /** Where the window is, how big, and how high in the stack. */
    function place(pane) {
      const { el, viewer } = pane;
      el.style.left = `${viewer.x}px`;
      el.style.top = `${viewer.y}px`;
      el.style.width = `${viewer.w}px`;
      el.style.height = `${viewer.h}px`;
      // above the drawing layer (1), below the panel — restacking is what keeps
      // that true however many windows have been opened
      el.style.zIndex = String(1 + viewer.z);
      el.classList.toggle("folded", viewer.collapsed);
      for (const part of [pane.body, el.querySelector(".rw-foot"), el.querySelector(".rw-resize")]) {
        if (part) part.style.display = viewer.collapsed ? "none" : "";
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
      if (!viewer.collapsed) paint(pane);
    }

    /**
     * The image, at the zoom and offset the window holds.
     *
     * The app fits its `<img>` with `object-fit: contain` and then applies the
     * zoom as a transform from the pane's own top-left. Same two steps here, in
     * the same order, so a window opened in either place shows the same thing.
     */
    function paint(pane) {
      const { canvas, bitmap, viewer, body } = pane;
      if (pane.moving) return; // a video draws itself
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
      pane.zoom.textContent = `${Math.round(viewer.scale * 100)}%`;
      body.classList.toggle("pannable", viewer.scale > 1);
      if (!bitmap) return;
      const fit = Math.min(w / bitmap.width, h / bitmap.height);
      const fw = bitmap.width * fit;
      const fh = bitmap.height * fit;
      ctx.translate(viewer.ox, viewer.oy);
      ctx.scale(viewer.scale, viewer.scale);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, (w - fw) / 2, (h - fh) / 2, fw, fh);
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
    }

    /** One window, off the screen and out of memory: a decoded image and a
     *  video's object URL both outlive the node that showed them. */
    function drop(pane) {
      pane.bitmap?.close?.();
      if (pane.url) URL.revokeObjectURL(pane.url);
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
          ? `${picker.items.length} of ${total} — search to narrow it down`
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
        style.remove();
      },
    };
  }

  window.AzimutMapRefs = { create };
})();
