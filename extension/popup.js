/**
 * The pairing popup: what the toolbar button opens while the extension holds no
 * token, and nothing else.
 *
 * Once paired, the button opens no popup at all (`background.js`, "the toolbar
 * button"): the tools over a map, the case's note beside any other page. The token
 * is typed here, in a page of the extension's own, never into a panel drawn over
 * somebody else's site, whose scripts hear every key.
 *
 * Once the app takes the token, the popup offers what the press would have opened,
 * so the first press still ends where the page was going. Opening it is a press on
 * the button too, so on Azimut's own tab it is what lets the app capture that tab,
 * paired or not.
 */

const api = typeof browser !== "undefined" ? browser : chrome;
const $ = (id) => document.getElementById(id);

const status = (text, kind = "info") => {
  const el = $("status");
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
};

/** Azimut's own tab, by address: any port on this machine, paired or not. */
const isApp = (url) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(String(url || ""));

/** Firefox's sidebar, or Chrome's side panel for this window. Called inside a press. */
function openNote(windowId) {
  try {
    if (api.sidebarAction?.open) return Promise.resolve(api.sidebarAction.open());
    if (api.sidePanel?.open) return Promise.resolve(api.sidePanel.open({ windowId }));
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.reject(new Error("this browser has no side panel for extensions"));
}

/** What a press on this page opens once paired, or null on Azimut's own tab. */
function nextStep(tab) {
  const url = tab?.url || "";
  if (!tab || isApp(url)) return null;
  if (globalThis.AzimutMapSites?.siteOf(url)) {
    return {
      label: "Open the tools on this map",
      run: async () => {
        const answer = await api.runtime.sendMessage({ type: "map-tools", tabId: tab.id });
        if (!answer?.ok) throw new Error(answer?.error || "the tools could not open");
      },
    };
  }
  return { label: "Open the note", run: () => openNote(tab.windowId) };
}

/** The pairing taken: say so, and offer the step the press was for. */
function paired(said, tab) {
  $("pairing").hidden = true;
  $("paired").hidden = false;
  status(said.text, said.kind);
  const next = nextStep(tab);
  const button = $("next");
  if (!next) return;
  button.textContent = next.label;
  button.hidden = false;
  // the side panel opens only inside the press: nothing is awaited before `run`
  button.addEventListener("click", () => {
    next.run().then(
      () => window.close(),
      (e) => status(`Could not open it: ${e?.message || e}`, "error")
    );
  });
}

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const stored = await api.storage.local.get({ backendUrl: AzimutPairing.DEFAULT_URL, token: "" });

  if (tab && isApp(tab.url)) {
    $("granted").hidden = false;
    // this press granted activeTab for the tab: the app's Capture can go on (bridge.js)
    Promise.resolve(api.tabs.sendMessage(tab.id, { type: "app-activated" })).catch(() => {});
    const open = $("open-settings");
    open.hidden = false;
    open.addEventListener("click", () => {
      Promise.resolve(api.tabs.sendMessage(tab.id, { type: "app-pairing" })).catch(() => {});
    });
  }

  // Paired already: the browser kept a popup it should have dropped. Dropped now,
  // and the step offered as it would be after pairing.
  if (stored.token) {
    const toolbar = api.action ?? api.browserAction;
    Promise.resolve(toolbar?.setPopup?.({ popup: "" })).catch(() => {});
    paired({ text: "Paired with Azimut.", kind: "ok" }, tab);
    return;
  }

  $("pairing").hidden = false;
  $("backendUrl").value = stored.backendUrl;
  $("elsewhere").open = AzimutPairing.address(stored.backendUrl) !== AzimutPairing.DEFAULT_URL;
  $("token").focus();

  const pair = async () => {
    const backendUrl = AzimutPairing.address($("backendUrl").value);
    const token = $("token").value.trim();
    if (!token) {
      status("Paste the pairing token first.", "error");
      return;
    }
    $("pair").disabled = true;
    status("Checking…");
    const said = await AzimutPairing.check(backendUrl, token, api.runtime.getManifest().version, fetch);
    $("pair").disabled = false;
    if (!said.paired) {
      status(said.text, "error");
      return;
    }
    // stored only once the app took it: a wrong token never leaves the button pairing
    await api.storage.local.set({ backendUrl, token });
    paired(said, tab);
  };
  $("pair").addEventListener("click", pair);
  $("token").addEventListener("keydown", (event) => {
    if (event.key === "Enter") pair();
  });
}

init().catch((e) => status(e.message, "error"));
