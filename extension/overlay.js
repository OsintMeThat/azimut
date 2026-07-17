/**
 * Area-select overlay — injected on demand (never declared for map sites),
 * draws one marquee, reports one rect, removes itself.
 *
 * The overlay dims the page while the user drags, so it removes itself and
 * waits two frames BEFORE asking the background to capture — otherwise its
 * own dimming would be burned into the capture. Esc cancels.
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
  const hint = document.createElement("div");
  hint.textContent = "Drag to select the area to capture — Esc to cancel";
  hint.style.cssText =
    "position:fixed;top:14px;left:50%;transform:translateX(-50%);padding:6px 12px;" +
    "background:#141414;color:#e6e6e6;font:13px system-ui,sans-serif;border-radius:6px;" +
    "border:1px solid #333;pointer-events:none";
  host.append(box, hint);
  document.documentElement.appendChild(host);

  let start = null;

  function teardown() {
    host.remove();
    window.removeEventListener("keydown", onKey, true);
    window.__azimutOverlayActive = false;
  }

  function finish(rect) {
    teardown();
    // let the dimming actually leave the composited page before the grab
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        api.runtime.sendMessage(
          rect
            ? { type: "area-selected", rect, viewportW: window.innerWidth }
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

  host.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
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
