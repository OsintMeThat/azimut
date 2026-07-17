/**
 * Popup: the user-facing side of a capture on an external map site.
 *
 * Opening it (toolbar click or Alt+Shift+A) is the user gesture that grants
 * activeTab — every capture descends from that gesture.
 *
 * Deliberately thin (owner decision): the extension knows NOTHING about map
 * sites. The page URL goes to the app (GET /api/ingest/parse), which answers
 * with site, coordinates, place name — every rule that could rot when a site
 * changes its URL format lives in the app, where an update is one pip install
 * instead of a manual extension reinstall on every machine.
 */

const api = typeof browser !== "undefined" ? browser : chrome;
const $ = (id) => document.getElementById(id);

const status = (text, kind = "info") => {
  const el = $("status");
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
};

const numOrNull = (id) => {
  const raw = $(id).value.trim();
  if (!raw) return null;
  const v = parseFloat(raw.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

async function loadCases(select, stored) {
  const { backendUrl, token } = stored;
  let cases;
  try {
    const r = await fetch(`${backendUrl}/api/ingest/cases`, {
      headers: { "X-Azimut-Token": token },
    });
    if (r.status === 401) throw new Error("unpaired");
    cases = await r.json();
  } catch (e) {
    select.replaceChildren(new Option("Azimut unreachable — check options", ""));
    status(
      e.message === "unpaired"
        ? "Not paired: open the extension options and paste the token from Azimut Settings."
        : `Cannot reach Azimut at ${backendUrl} — is the app running?`,
      "error"
    );
    return false;
  }
  const options = cases.map(
    (c) => new Option(c.scratch ? `(scratch) ${c.name}` : c.name, c.id)
  );
  options.push(new Option("New scratch session", ""));
  select.replaceChildren(...options);
  select.value = cases.some((c) => c.id === stored.lastCaseId) ? stored.lastCaseId : options[0].value;
  return true;
}

async function init() {
  $("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    api.runtime.openOptionsPage();
  });

  const stored = await api.storage.local.get({
    backendUrl: "http://127.0.0.1:8477",
    token: "",
    lastCaseId: "",
  });
  stored.backendUrl = stored.backendUrl.replace(/\/+$/, "");

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    $("state-nomap").hidden = false;
    return;
  }

  // The app's own tab is recognized locally, by origin — it must work even
  // unpaired, because opening this popup is what grants the app capture access
  const tabOrigin = origin(tab.url);
  const isLocalhost = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(tabOrigin || "");
  if (tabOrigin && (tabOrigin === origin(stored.backendUrl) || isLocalhost)) {
    $("site").textContent = "Azimut";
    $("state-azimut").hidden = false;
    // this click just granted activeTab for the tab — tell the app through
    // the bridge so its Capture button knows it can proceed
    api.tabs.sendMessage(tab.id, { type: "app-activated" }).catch(() => {});
    return;
  }

  // everything about the URL is the app's judgment, not ours
  let parsed;
  try {
    const r = await fetch(
      `${stored.backendUrl}/api/ingest/parse?url=${encodeURIComponent(tab.url)}`,
      { headers: { "X-Azimut-Token": stored.token } }
    );
    if (r.status === 401) {
      status("Not paired: open the extension options and paste the token from Azimut Settings.", "error");
      return;
    }
    parsed = await r.json();
  } catch {
    status(`Cannot reach Azimut at ${stored.backendUrl} — is the app running?`, "error");
    return;
  }

  if (!parsed.site) {
    $("state-nomap").hidden = false;
    return;
  }

  $("site").textContent = parsed.label;
  $("state-map").hidden = false;
  for (const k of ["lat", "lon", "zoom", "bearing"]) {
    if (parsed[k] !== null && parsed[k] !== undefined) $(k).value = String(parsed[k]);
  }
  // the URL's place name becomes the suggested title; with coordinates but no
  // name, the placeholder shows the fallback Azimut will use (the coordinates)
  if (parsed.title) $("title").value = parsed.title;
  else if (parsed.lat !== null) $("title").placeholder = `${parsed.lat}, ${parsed.lon}`;
  $("coords-note").hidden = parsed.lat !== null;

  const paired = await loadCases($("case"), stored);

  $("capture-area").addEventListener("click", async () => {
    if (!paired) return;
    // half a coordinate would 422 server-side; catch it where it's fixable
    if ((numOrNull("lat") === null) !== (numOrNull("lon") === null)) {
      status("Latitude and longitude go together — fill both or neither.", "error");
      return;
    }
    const r = await api.runtime.sendMessage({
      type: "start-area-select",
      tabId: tab.id,
      meta: {
        url: tab.url,
        caseId: $("case").value,
        title: $("title").value.trim(),
        lat: numOrNull("lat"),
        lon: numOrNull("lon"),
        zoom: numOrNull("zoom"),
        bearing: numOrNull("bearing"),
      },
    });
    if (r?.ok) window.close(); // the overlay takes over; a notification reports the result
    else status(r?.error || "could not start the selection", "error");
  });
}

init().catch((e) => status(e.message, "error"));
