/** Options: store the backend URL + pairing token, and prove them with one
 * /api/ingest/ping — the same call the popup will make, so "test passed"
 * means the real flow works.
 *
 * That ping also answers a question only the signed Firefox add-on can raise.
 * Everywhere else the extension comes out of the app and so can never lead it,
 * but Firefox updates a signed add-on from Azimut's release manifest without
 * knowing which Azimut is installed — so an old app can end up paired with a
 * newer add-on. Nothing can stop that from the browser's side; what it can do
 * is name it here, where both numbers are already on screen, instead of leaving
 * the analyst with features that report they could not run. */

const api = typeof browser !== "undefined" ? browser : chrome;
const $ = (id) => document.getElementById(id);

/** Is version `a` above version `b`? Numeric per part, so 0.10.0 beats 0.9.0.
 * Mirrors lib/extBridge.js and engine/updates.py, which answer the same question
 * on the app's side. */
function above(a, b) {
  const parts = (v) =>
    String(v || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

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
        status("Azimut answered but rejected the token. Copy it again from Settings.", "error");
        return;
      }
      const body = await r.json();
      const mine = api.runtime.getManifest().version;
      if (above(mine, body.version)) {
        status(
          `Paired with Azimut ${body.version}, older than this add-on (${mine}). ` +
            `Update Azimut, or newer features will report that they could not run.`,
          "warn",
        );
        return;
      }
      status(`Paired with Azimut ${body.version}.`, "ok");
    } catch {
      status(`No Azimut at ${backendUrl}. Is the app running?`, "error");
    }
  });
}

init().catch((e) => status(e.message, "error"));
