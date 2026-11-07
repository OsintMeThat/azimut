/**
 * Pairing with the app: the one check the pairing popup and the options page both
 * make, so "paired" means the same thing in each.
 *
 * It is a single `/api/ingest/ping` with the token, the call every flow makes
 * first, so a pass means the real flow works. The answer also names a case only
 * the signed Firefox add-on can reach. Everywhere else the extension comes out of
 * the app and so can never lead it, but Firefox updates a signed add-on from
 * Azimut's release manifest without knowing which Azimut is installed, so an old
 * app can end up paired with a newer add-on. Nothing can stop that from the
 * browser's side; what it can do is say so where both numbers are known.
 *
 * A classic script, loaded before the page's own.
 */

(() => {
  const DEFAULT_URL = "http://127.0.0.1:8477";

  /** Is version `a` above version `b`? Numeric per part, so 0.10.0 beats 0.9.0.
   *  Mirrors lib/extBridge.js and engine/updates.py, which answer the same
   *  question on the app's side. */
  function above(a, b) {
    const parts = (v) =>
      String(v || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  }

  /** The address as typed, without its trailing slashes, or the default one. */
  function address(typed) {
    return String(typed || "").trim().replace(/\/+$/, "") || DEFAULT_URL;
  }

  /**
   * Ask the app whether it takes this token.
   *
   * `{ paired, kind, text }`: `paired` is whether the token was taken, `kind` the
   * status line's colour (`ok`, `warn` or `error`) and `text` its sentence.
   */
  async function check(backendUrl, token, mine, fetchImpl = fetch) {
    let r;
    try {
      r = await fetchImpl(`${backendUrl}/api/ingest/ping`, { headers: { "X-Azimut-Token": token } });
    } catch {
      return { paired: false, kind: "error", text: `No Azimut at ${backendUrl}. Is the app running?` };
    }
    if (r.status === 401) {
      return { paired: false, kind: "error", text: "Azimut answered but rejected the token. Copy it again from Settings." };
    }
    if (r.status >= 400) {
      return { paired: false, kind: "error", text: `Azimut at ${backendUrl} answered with an error (${r.status}).` };
    }
    let body = {};
    try {
      body = await r.json();
    } catch {
      return { paired: false, kind: "error", text: `No Azimut at ${backendUrl}. Is the app running?` };
    }
    if (above(mine, body.version)) {
      return {
        paired: true,
        kind: "warn",
        text:
          `Paired with Azimut ${body.version}, older than this add-on (${mine}). ` +
          "Update Azimut, or newer features will report that they could not run.",
      };
    }
    return { paired: true, kind: "ok", text: `Paired with Azimut ${body.version}.` };
  }

  globalThis.AzimutPairing = { DEFAULT_URL, above, address, check };
})();
