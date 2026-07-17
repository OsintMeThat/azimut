/** Options: store the backend URL + pairing token, and prove them with one
 * /api/ingest/ping — the same call the popup will make, so "test passed"
 * means the real flow works. */

const api = typeof browser !== "undefined" ? browser : chrome;
const $ = (id) => document.getElementById(id);

function status(text, kind = "info") {
  const el = $("status");
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function init() {
  const stored = await api.storage.local.get({ backendUrl: "http://127.0.0.1:8477", token: "" });
  $("backendUrl").value = stored.backendUrl;
  $("token").value = stored.token;

  $("save").addEventListener("click", async () => {
    const backendUrl = $("backendUrl").value.trim().replace(/\/+$/, "") || "http://127.0.0.1:8477";
    const token = $("token").value.trim();
    await api.storage.local.set({ backendUrl, token });
    status("Testing…");
    try {
      const r = await fetch(`${backendUrl}/api/ingest/ping`, {
        headers: { "X-Azimut-Token": token },
      });
      if (r.status === 401) {
        status("Azimut answered but rejected the token — copy it again from Settings.", "error");
        return;
      }
      const body = await r.json();
      status(`Paired with Azimut ${body.version} — you're set.`, "ok");
    } catch {
      status(`No Azimut at ${backendUrl} — is the app running?`, "error");
    }
  });
}

init().catch((e) => status(e.message, "error"));
