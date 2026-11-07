/** Options: store the backend URL + pairing token, and prove them with the
 * check the pairing popup makes too (`pairing.js`). The pairing popup is the
 * first road; this page is where an address or a token is changed afterwards,
 * and where the notes panel's page permission is taken back. */

const api = typeof browser !== "undefined" ? browser : chrome;
const $ = (id) => document.getElementById(id);

function status(text, kind = "info") {
  const el = $("status");
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
}

/** The one permission the notes panel's Add asks for at run time. */
const EVERY_PAGE = { origins: ["<all_urls>"] };

/** Say whether the notes panel may read the page it adds from, with a way to take it back. */
async function showPages() {
  let granted = false;
  try {
    granted = Boolean(await api.permissions.contains(EVERY_PAGE));
  } catch {
    granted = false;
  }
  $("pages").hidden = !granted;
  $("pages-said").textContent =
    "The notes panel may read the page in front when you add from it: its address, title and the words selected, " +
    "or a capture of a map. Taken back, Add asks again, and right-click or Alt+Shift+S still work.";
}

async function init() {
  await showPages();
  $("pages-revoke").addEventListener("click", async () => {
    try {
      await api.permissions.remove(EVERY_PAGE);
    } catch (e) {
      status(e.message, "error");
    }
    await showPages();
  });
  api.permissions?.onRemoved?.addListener?.(() => showPages());
  api.permissions?.onAdded?.addListener?.(() => showPages());
  const stored = await api.storage.local.get({ backendUrl: AzimutPairing.DEFAULT_URL, token: "" });
  $("backendUrl").value = stored.backendUrl;
  $("token").value = stored.token;

  $("save").addEventListener("click", async () => {
    const backendUrl = AzimutPairing.address($("backendUrl").value);
    const token = $("token").value.trim();
    await api.storage.local.set({ backendUrl, token });
    status("Testing…");
    const said = await AzimutPairing.check(backendUrl, token, api.runtime.getManifest().version, fetch);
    status(said.text, said.kind);
  });
}

init().catch((e) => status(e.message, "error"));
