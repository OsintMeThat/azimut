/**
 * Area-select overlay — injected on demand (never declared for map sites),
 * draws one marquee, reports one rect, removes itself.
 *
 * The overlay dims the page while the user drags, so it removes itself and
 * waits two frames BEFORE asking the background to capture — otherwise its
 * own dimming would be burned into the capture. Esc cancels, on the page or in
 * the notes panel, whose Capture button leaves the keyboard in the panel.
 *
 * When the worker hands over options (`window.__azimutAreaOptions`, set just
 * before this runs), the hint is a bar that also holds the scale bar and north
 * arrow tick and the bearing the arrow needs: they are about this capture, so
 * they are asked while it is drawn. The bar sits in a closed shadow root, out of
 * reach of the page's CSS and scripts, and is gone before the grab like the rest.
 */

(() => {
  if (window.__azimutOverlayActive) return;
  window.__azimutOverlayActive = true;

  const api = typeof browser !== "undefined" ? browser : chrome;

  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(10,10,10,0.35)";
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;display:none;border:1.5px dashed #e8a33d;background:rgba(232,163,61,0.10);" +
    "box-shadow:0 0 0 100vmax rgba(10,10,10,0.35);pointer-events:none";
  // what the worker handed over for this selection, read once
  const options = window.__azimutAreaOptions || null;
  delete window.__azimutAreaOptions;

  const hint = document.createElement("div");
  hint.style.cssText =
    "position:fixed;top:14px;left:50%;transform:translateX(-50%);" +
    (options ? "pointer-events:auto;cursor:default" : "pointer-events:none");
  const bar = options ? optionsBar(hint, options) : null;
  if (!bar) {
    hint.textContent = "Drag to select the capture area. Press Esc to cancel";
    hint.style.cssText +=
      ";padding:6px 12px;background:#141414;color:#e6e6e6;font:13px system-ui,sans-serif;" +
      "border-radius:6px;border:1px solid #333";
  }
  host.append(box, hint);
  document.documentElement.appendChild(host);

  let start = null;

  /**
   * The hint with the capture's marks in it: the tick as it was last left, and the
   * bearing the address gave, editable. The tick is remembered the moment it moves.
   */
  function optionsBar(where, { marks, bearing }) {
    const root = where.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .bar {
          display: flex; align-items: center; gap: 12px; padding: 6px 12px;
          background: #141414; color: #e6e6e6; font: 13px/1.3 system-ui, sans-serif;
          border: 1px solid #333; border-radius: 6px; white-space: nowrap;
          box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
        }
        .sep { width: 1px; align-self: stretch; background: #333; }
        label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
        input[type=checkbox] { margin: 0; accent-color: #e8a33d; }
        .bearing[hidden] { display: none; }
        .bearing input {
          width: 52px; padding: 3px 6px; font: inherit; color: #e6e6e6;
          background: #1f1f1f; border: 1px solid #333; border-radius: 5px;
        }
        .bearing input:focus { outline: 1px solid #e8a33d; }
        .bearing input.wrong { border-color: #e5484d; }
      </style>
      <div class="bar">
        <span>Drag over the map to capture it. Esc cancels.</span>
        <span class="sep"></span>
        <label data-guide="ext.marks" title="Drawn on the capture from the zoom"><input class="marks" type="checkbox" /> Scale bar &amp; north arrow</label>
        <label class="bearing" data-guide="ext.bearing" title="Where the map is turned to, for the arrow; left empty, only the scale bar is drawn">Bearing
          <input class="deg" type="text" inputmode="decimal" placeholder="—" />°</label>
      </div>`;
    const tick = root.querySelector(".marks");
    const field = root.querySelector(".bearing");
    const deg = root.querySelector(".deg");
    tick.checked = Boolean(marks);
    field.hidden = !tick.checked;
    if (Number.isFinite(bearing)) deg.value = String(bearing);
    tick.addEventListener("change", () => {
      field.hidden = !tick.checked;
      try {
        Promise.resolve(api.storage?.local?.set?.({ captureMarks: tick.checked })).catch(() => {});
      } catch {
        // remembered next time, or not: the capture is what matters
      }
    });
    // the map page hears none of what is typed here, Escape aside (caught above it)
    deg.addEventListener("keydown", (e) => e.stopPropagation());
    deg.addEventListener("input", () => deg.classList.toggle("wrong", deg.value.trim() !== "" && read() === null));
    /** The bearing typed, in degrees, or null when empty or not a bearing. */
    function read() {
      const raw = deg.value.trim().replace(",", ".");
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 && value < 360 ? value : null;
    }
    return { marks: () => tick.checked, bearing: read };
  }

  function teardown() {
    host.remove();
    window.removeEventListener("keydown", onKey, true);
    api.runtime.onMessage.removeListener(onCancel);
    window.__azimutOverlayActive = false;
  }

  /**
   * The map's own credit line as the page shows it: the short texts with a © near
   * the foot of the window, where every map site keeps them. A selection rarely
   * holds that strip, and the providers it names (Airbus, Maxar…) must still go
   * under the picture, so they are read here and sent with the rectangle.
   */
  function screenCredit() {
    const foot = window.innerHeight - 120;
    const seen = new Set();
    const parts = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const words = (value) => String(value || "").replace(/\s+/g, " ").trim();
    for (let node = walker.nextNode(); node && parts.length < 8; node = walker.nextNode()) {
      const own = words(node.nodeValue);
      // Google Earth names its providers without a ©: "Image Landsat / Copernicus", "Data SIO, NOAA…"
      const credit = own.includes("\u00a9") || /^(Image|Images|Imagery|Imagerie|Data|Donn\u00e9es)\b/u.test(own);
      if (!credit || own.length > 200) continue;
      const box = node.parentElement?.getBoundingClientRect?.();
      if (!box || !box.width || box.bottom < foot || box.top > window.innerHeight) continue;
      // a © alone is the start of a line whose name is a link beside it ("© OpenStreetMap
      // contributors"): the line it stands in is read, when that line is short
      const line = /\p{L}/u.test(own.replace("\u00a9", "")) ? own : words(node.parentElement?.textContent);
      const text = line.length <= 200 ? line : own;
      if (seen.has(text)) continue;
      seen.add(text);
      parts.push(text);
    }
    return parts.join(" \u00b7 ").slice(0, 400);
  }

  function finish(rect) {
    const credit = rect ? screenCredit() : "";
    // read before the bar goes with the rest
    const told = bar ? { marks: bar.marks(), bearing: bar.bearing() } : {};
    teardown();
    // let the dimming actually leave the composited page before the grab
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        api.runtime.sendMessage(
          rect
            ? { type: "area-selected", rect, viewportW: window.innerWidth, credit, ...told }
            : { type: "area-cancelled" }
        );
      })
    );
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    }
  }
  window.addEventListener("keydown", onKey, true);

  // Only the extension's own pages can send this; a web page cannot reach it.
  function onCancel(msg, sender, sendResponse) {
    if (msg?.type !== "area-cancel") return;
    finish(null);
    sendResponse({ ok: true });
  }
  api.runtime.onMessage.addListener(onCancel);

  host.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    // a press on the bar is a press on its controls, never the start of a rectangle
    if (bar && e.composedPath().includes(hint)) return;
    e.preventDefault();
    start = { x: e.clientX, y: e.clientY };
    host.style.background = "transparent"; // the box's own shadow dims from now on
    box.style.display = "block";
  });

  host.addEventListener("mousemove", (e) => {
    if (!start) return;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${Math.abs(e.clientX - start.x)}px`;
    box.style.height = `${Math.abs(e.clientY - start.y)}px`;
  });

  host.addEventListener("mouseup", (e) => {
    if (!start || e.button !== 0) return;
    const rect = {
      x: Math.min(start.x, e.clientX),
      y: Math.min(start.y, e.clientY),
      w: Math.abs(e.clientX - start.x),
      h: Math.abs(e.clientY - start.y),
    };
    finish(rect.w < 8 || rect.h < 8 ? null : rect); // a stray click is a cancel
  });
})();
