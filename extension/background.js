/**
 * Background worker: the only place pixels are grabbed.
 *
 * Chrome runs this as an MV3 service worker, Firefox as an event page (the
 * manifest declares both) — so it is a classic script with no imports, no DOM,
 * and no in-memory state that matters: anything that must survive a worker
 * restart lives in storage.session.
 *
 * Every capture is one captureVisibleTab behind one explicit user action
 * (repo legal rails): the popup's buttons, or the Azimut app's own Capture
 * button relayed by bridge.js. Nothing here is schedulable or repeatable
 * without a fresh user gesture.
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const APP_ORIGINS = ["http://127.0.0.1", "http://localhost"];
const isAppUrl = (url) => APP_ORIGINS.some((o) => url === o || url?.startsWith(o + ":") || url?.startsWith(o + "/"));

function settings() {
  return api.storage.local
    .get({ backendUrl: "http://127.0.0.1:8477", token: "", lastCaseId: "" })
    .then((s) => ({ ...s, backendUrl: s.backendUrl.replace(/\/+$/, "") }));
}

function captureActiveTab(windowId) {
  // promise-form works on both browsers in MV3
  return api.tabs.captureVisibleTab(windowId, { format: "png" });
}

/** Crop a captured frame (dataURL) to a viewport-CSS-px rect. The scale is
 * measured (image width / viewport width), not assumed from devicePixelRatio,
 * so browser zoom can't silently shift the crop — same rule as the app. */
async function cropDataUrl(dataUrl, rect, viewportW) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = bmp.width / viewportW;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(bmp.width - sx, Math.round(rect.w * scale));
  const sh = Math.min(bmp.height - sy, Math.round(rect.h * scale));
  if (sw < 8 || sh < 8) throw new Error("selection too small");
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.convertToBlob({ type: "image/png" });
}

/** File one screenshot with the backend (POST /api/ingest/screenshot). */
async function ingest(blob, meta) {
  const { backendUrl, token } = await settings();
  if (!token) throw new Error("not paired — open the extension options and paste the token from Azimut Settings");
  // Thin on purpose: image + URL is a complete capture — the app parses the
  // URL itself (site, coordinates, title, imagery date). Everything else here
  // is either the user's popup corrections or plain context.
  const form = new FormData();
  form.append("image", blob, "screenshot.png");
  form.append("url", meta.url);
  form.append("case_id", meta.caseId || "");
  if (meta.title) form.append("title", meta.title);
  for (const k of ["lat", "lon", "zoom", "bearing"]) {
    if (meta[k] !== null && meta[k] !== undefined && meta[k] !== "") form.append(k, String(meta[k]));
  }
  form.append("captured_at", new Date().toISOString());
  form.append("extension", api.runtime.getManifest().version);
  let r;
  try {
    r = await fetch(`${backendUrl}/api/ingest/screenshot`, {
      method: "POST",
      headers: { "X-Azimut-Token": token },
      body: form,
    });
  } catch {
    throw new Error(`Azimut is not reachable at ${backendUrl} — is the app running?`);
  }
  if (r.status === 401) throw new Error("pairing token rejected — re-pair in the extension options");
  if (!r.ok) throw new Error(`Azimut refused the capture (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const body = await r.json();
  if (meta.caseId) api.storage.local.set({ lastCaseId: meta.caseId });
  return body;
}

function notify(title, message) {
  // fire-and-forget: a failed toast must never fail a filed capture
  try {
    api.notifications.create({
      type: "basic",
      iconUrl: api.runtime.getURL("icons/icon128.png"),
      title,
      message: String(message).slice(0, 300),
    });
  } catch {
    /* notifications are best-effort */
  }
}

// --- message routes ------------------------------------------------------------

async function handle(msg, sender) {
  // The Azimut app's own Capture button (bridge.js relay): return the raw
  // frame — the app does its own registration, cropping and filing. Only the
  // app's localhost origin may ask for it.
  if (msg.type === "capture-tab") {
    if (!sender.tab || !isAppUrl(sender.tab.url)) return { ok: false, error: "not the Azimut app" };
    try {
      return { ok: true, dataUrl: await captureActiveTab(sender.tab.windowId) };
    } catch (e) {
      // captureVisibleTab needs activeTab (or <all_urls>, which this extension
      // deliberately never asks for) — a page-initiated capture is refused
      // until the user has invoked the extension once on this tab. Tell the
      // app which case this is, so it can explain the one-time step.
      const needsActivation = /activeTab|all_urls|permission/i.test(e.message || "");
      return { ok: false, needsActivation, error: e.message };
    }
  }

  // Popup: arm an area selection on the page. The popup closes right after,
  // so the meta waits in storage.session for the overlay's rect.
  if (msg.type === "start-area-select") {
    try {
      await api.storage.session.set({ [`pending:${msg.tabId}`]: msg.meta });
      await api.scripting.executeScript({ target: { tabId: msg.tabId }, files: ["overlay.js"] });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Overlay: the user finished (or cancelled) the drag.
  if (msg.type === "area-selected" || msg.type === "area-cancelled") {
    const key = `pending:${sender.tab.id}`;
    const meta = (await api.storage.session.get(key))[key];
    await api.storage.session.remove(key);
    if (msg.type === "area-cancelled" || !meta) return { ok: true };
    try {
      const dataUrl = await captureActiveTab(sender.tab.windowId);
      const blob = await cropDataUrl(dataUrl, msg.rect, msg.viewportW);
      const body = await ingest(blob, meta);
      notify("Capture filed into Azimut", body.title);
      return { ok: true };
    } catch (e) {
      notify("Azimut capture failed", e.message);
      return { ok: false, error: e.message };
    }
  }

  return { ok: false, error: `unknown message '${msg.type}'` };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true; // async response
});
