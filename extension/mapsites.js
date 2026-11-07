/**
 * Which pages are maps, for one decision: what the toolbar button opens.
 *
 * Pressed on a map, it puts the tools over the map; pressed anywhere else, it
 * opens the case's note beside the page. The note is a side panel, and both
 * browsers open one only inside the press itself: Firefox stops counting it as
 * a press at the first thing awaited (MDN, "User actions"). So the decision
 * cannot wait for the app to read the address, and these hosts are the app's
 * own table (`engine/mapsites.py`, `SITES`) copied here, hosts and path gates
 * only. Everything else about a map's address is still the app's to read.
 *
 * `tests/fixtures/map-site-hosts.json` holds the same addresses for both sides
 * (`tests/test_mapsites.py` and `frontend/src/lib/extensionMapSites.test.js`),
 * so a site added on one side and not the other fails a test.
 *
 * A classic script: the worker loads it with `importScripts` on Chrome, and
 * Firefox's event page lists it before `background.js`.
 */

(() => {
  /** In the app's order: the first host that matches and whose gate passes wins. */
  const SITES = [
    { id: "google-earth", host: /^earth\.google\.com$/ },
    {
      id: "google-maps",
      host: /(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$/,
      gate: (u) => u.hostname === "maps.app.goo.gl" || u.pathname.startsWith("/maps"),
    },
    { id: "bing-maps", host: /(^|\.)bing\.com$/, gate: (u) => u.pathname.startsWith("/maps") },
    { id: "yandex-maps", host: /(^|\.)yandex\.[a-z.]+$/, gate: (u) => u.pathname.startsWith("/maps") },
    { id: "openstreetmap", host: /(^|\.)openstreetmap\.org$/ },
    { id: "apple-maps", host: /^maps\.apple\.com$/ },
    { id: "zoom-earth", host: /(^|\.)zoom\.earth$/ },
    { id: "satellites-pro", host: /(^|\.)satellites\.pro$/ },
    { id: "copernicus-browser", host: /^browser\.dataspace\.copernicus\.eu$/ },
  ];

  /** The site an address belongs to, or null when it is not a map Azimut reads. */
  function siteOf(url) {
    let u;
    try {
      u = new URL(String(url || ""));
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    for (const site of SITES) {
      if (!site.host.test(host)) continue;
      if (site.gate && !site.gate(u)) continue;
      return site.id;
    }
    return null;
  }

  globalThis.AzimutMapSites = { SITES, siteOf };
})();
