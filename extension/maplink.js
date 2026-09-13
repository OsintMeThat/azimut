/**
 * One camera, written into someone else's address bar.
 *
 * The app links two of its own map tabs by handing a camera over a channel
 * (`frontend/src/lib/map/link.js`) and calling `setView` with it. A site's map
 * has no `setView` this extension may call. What it has is an address the site
 * reads when it loads and, on a few of them, whenever its hash changes — so a
 * view is followed by writing it there, and the site does the moving.
 *
 * Three rules come out of driving the sites in a browser (`docs/MAP_SITES.md`,
 * "Following a linked view"):
 *
 * - **Only the camera is rewritten.** The layer, Copernicus's acquisition date,
 *   Zoom Earth's day, Earth's 2D or 3D mode and whatever place Google was
 *   showing all live in the same address, and a view that followed a peer by
 *   dropping them would be a different map at the same spot.
 * - **The address has to be true the moment it lands**, because the tools read
 *   their scale from it. Google opens a `16.5z` (or the same view as metres) at
 *   level 16 and goes on saying 16.5 until the map is touched, so it is given
 *   whole levels; so is every site not measured taking a fraction. Bing takes one
 *   decimal, Apple's span and Earth's distance are read back as they land.
 * - **Each map follows as close as it goes, and nothing asks the others to
 *   stop there.** Zoom Earth stops at 11 and Bing at 22, and both rewrite their
 *   address to say so. Google (21), OpenStreetMap (19) and Copernicus (18) keep
 *   a level they are not drawing until the map is touched, so what is *written*
 *   there is held to what they draw (`WRITE_CEILING`). The camera being followed
 *   is never touched.
 *
 * Classic script, no build step, like the rest of the panel. The camera
 * comparison is `link.js`'s, copied; `extensionMapLink.test.js` runs both.
 */
(() => {
  /** Metres of ground per pixel at the equator, zoom 0, on 256-pixel tiles. */
  const EQUATOR_M_PER_PX = (2 * Math.PI * 6378137) / 256;
  const MAX_LAT = 85.05112877980659;

  /**
   * The deepest level worth writing into a site that will not correct the
   * address itself, measured over Paris.
   *
   * Opened past these, each one draws the level below and goes on quoting the
   * one it was given until the map is moved: Google `23z` draws 21,
   * OpenStreetMap `#map=20` draws 19, Copernicus `zoom=23` draws 18 (its wheel
   * goes further, a link does not). The sites left out rewrite a level they
   * cannot draw (Bing, Zoom Earth) or state a size the parser reads instead
   * (Apple's span, Earth's distance). Yandex and Satellites.pro refuse a
   * headless browser and are unmeasured.
   */
  const WRITE_CEILING = { "google-maps": 21, openstreetmap: 19, "copernicus-browser": 18 };

  /**
   * How near a pole a site will open a view, in degrees of latitude.
   *
   * Apple moves any address past ±70.4956° back to it on load, `?ll=` and
   * `/frame` alike, at every zoom (measured over Svalbard and the Ross Sea).
   * Dragged, its map goes on north and its address with it, so this is a limit
   * on following and never on the drawing.
   */
  const OPEN_LAT_LIMIT = { "apple-maps": 70.495574 };

  /** The closest Earth's camera comes to the ground, in metres. A nearer one
   *  is not a camera Earth placed (`engine/mapsites.py`, `EARTH_CLOSEST_M`). */
  const EARTH_CLOSEST_M = 25;

  /** Under a tenth of this and two cameras are pointed at the same thing
   *  (`link.js`, copied). */
  const PLACES = 5;
  const BEARING_EPSILON = 0.5;

  /** How much shallower than asked a map may land and still count as there:
   *  a site given whole levels is up to half of one out by rounding alone. */
  const SHORT_BY = 0.5;
  /** How close to the view it was sent to a map has to be to count as having
   *  arrived: a few hundred metres, well inside any rounding a site does. */
  const NEAR_DEG = 0.005;

  function sameCamera(a, b) {
    if (!a || !b) return false;
    return (
      a.lat.toFixed(PLACES) === b.lat.toFixed(PLACES) &&
      a.lon.toFixed(PLACES) === b.lon.toFixed(PLACES) &&
      Math.round(a.zoom) === Math.round(b.zoom) &&
      Math.abs((a.bearing ?? 0) - (b.bearing ?? 0)) < BEARING_EPSILON
    );
  }

  /** A camera worth sending or following: anything else moves a map to nowhere. */
  function readable(view) {
    return Boolean(
      view &&
        Number.isFinite(view.lat) &&
        Number.isFinite(view.lon) &&
        Number.isFinite(view.zoom) &&
        Math.abs(view.lat) <= 90 &&
        Math.abs(view.lon) <= 180
    );
  }

  /**
   * Whether this view can lead or follow at all.
   *
   * The same test the tools use for geometry: a flat map, looked at straight
   * down, whose address states a scale. Street View, a pitched camera and a
   * globe have no tile level to hand over, and moving one to a peer's level
   * would throw away the view the analyst chose to be on.
   */
  function followable(parsed) {
    return Boolean(
      parsed?.site &&
        parsed.view_kind === "map" &&
        parsed.geometry &&
        parsed.scale_source &&
        readable({ lat: parsed.lat, lon: parsed.lon, zoom: parsed.zoom })
    );
  }

  const fixed = (n, digits) => String(Number(n.toFixed(digits)));

  /** Metres of ground one CSS pixel covers at this level and latitude. */
  function metresPerPx(zoom, lat) {
    return (EQUATOR_M_PER_PX * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  }

  /** The level actually worth writing into this site. */
  function writableZoom(site, zoom) {
    const ceiling = WRITE_CEILING[site];
    return ceiling == null ? zoom : Math.min(zoom, ceiling);
  }

  /** The latitude this site will open, whatever it is handed. */
  function openLat(site, lat) {
    const limit = OPEN_LAT_LIMIT[site];
    return limit == null ? lat : Math.max(-limit, Math.min(limit, lat));
  }

  /**
   * The view this site really opens when it is sent this one.
   *
   * A site is written the camera it will honour rather than the one it was asked
   * for, and the difference is not cosmetic. An address stating a view the site
   * then moves away from is the address the tools take their ground from, so the
   * drawing lands where the map is not until the site rewrites it — Apple past
   * ±70.4956° did exactly that. And it is what a map already at its limit is
   * compared against, so the next gesture on the map it follows does not reload
   * it to put it back where it already was, on top of a drag the panel had just
   * asked the analyst for.
   */
  function reachable(site, view) {
    if (!readable(view)) return view;
    return { ...view, lat: openLat(site, view.lat), zoom: writableZoom(site, view.zoom) };
  }

  /** The URL with one query parameter set, the rest left as the site wrote it. */
  function withParams(url, params) {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  // --- one writer per site, each the inverse of its parser --------------------

  const WRITERS = {
    /**
     * `@lat,lon,17z`, over the `,17z` or the satellite view's `,3231m` alike.
     * Google turns a level into its own metres on arrival and keeps the layer,
     * which lives after the camera block, so everything there stays.
     */
    "google-maps"(url, view) {
      const camera = /@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,\d+(?:\.\d+)?[zm](?=\/|$)/;
      if (!camera.test(url.pathname)) return null;
      url.pathname = url.pathname.replace(
        camera,
        `@${fixed(view.lat, 7)},${fixed(view.lon, 7)},${Math.round(view.zoom)}z`
      );
      return url.toString();
    },

    /**
     * `@lat,lon,Na,Nd,Ny,Nh,Nt,Nr`. The distance is worked out from the height
     * the window covers, through the field of view the address already carries.
     * Earth puts the camera `a + d` above sea level, and the ground under the new
     * centre is not in any address, so `a` is left as it was: the scale is out by
     * how far the ground rose or fell between the two places, over the distance,
     * until Earth writes the real one in on the first gesture.
     */
    "google-earth"(url, view, height) {
      const camera = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([^/]*)/;
      const found = url.pathname.match(camera);
      if (!found || !(height > 0)) return null;
      const fields = found[3].split(",");
      const fov = Number((fields.find((f) => /y$/.test(f)) ?? "").slice(0, -1));
      if (!(fov > 0 && fov < 180)) return null;
      const tall = metresPerPx(view.zoom, view.lat) * height;
      const distance = Math.max(EARTH_CLOSEST_M, tall / (2 * Math.tan((fov * Math.PI) / 360)));
      // A view Earth never placed (`0a`, a typed link) stays one: a whole `d` next
      // to it is what the parser reads as "not placed yet", and the panel asks
      // for a gesture rather than drawing at a scale out by the ground's height.
      const ground = Number((fields.find((f) => /a$/.test(f)) ?? "").slice(0, -1));
      const size = ground === 0 ? String(Math.round(distance)) : fixed(distance, 2);
      const rewritten = fields.map((f) => (/^-?\d+(?:\.\d+)?d$/.test(f) ? `${size}d` : f));
      url.pathname = url.pathname.replace(
        camera,
        `@${fixed(view.lat, 8)},${fixed(view.lon, 8)},${rewritten.join(",")}`
      );
      return url.toString();
    },

    /** `?cp=lat~lon&lvl=17`, one decimal as Bing writes it. */
    "bing-maps"(url, view) {
      return withParams(url, { cp: `${fixed(view.lat, 6)}~${fixed(view.lon, 6)}`, lvl: fixed(view.zoom, 1) });
    },

    /** `?ll=lon,lat&z=17` — longitude first, and a whole level until a fraction
     *  is measured landing true. */
    "yandex-maps"(url, view) {
      return withParams(url, { ll: `${fixed(view.lon, 6)},${fixed(view.lat, 6)}`, z: String(Math.round(view.zoom)) });
    },

    /** `#map=17/lat/lon`. A whole level: the site's map snaps to one. */
    openstreetmap(url, view) {
      const hash = url.hash.replace(/^#/, "");
      const camera = `map=${Math.round(view.zoom)}/${fixed(view.lat, 5)}/${fixed(view.lon, 5)}`;
      url.hash = /map=[^&]*/.test(hash) ? hash.replace(/map=[^&]*/, camera) : camera;
      return url.toString();
    },

    /**
     * `/frame?center=lat,lon&z=17`, the form Apple redirects a link to. Its `z`
     * is read when the page opens and never again, and a span in the same
     * address outranks it, so only the layer is carried over. A page still on
     * the link form (`?ll=`) is written in that form and redirected by Apple
     * itself; a place card (`/place?…&coordinate=`) is closed by the move.
     */
    "apple-maps"(url, view) {
      const linkForm = url.pathname === "/";
      const next = new URL(linkForm ? "/" : "/frame", url);
      for (const key of ["map", "t"]) {
        if (url.searchParams.has(key)) next.searchParams.set(key, url.searchParams.get(key));
      }
      next.searchParams.set(linkForm ? "ll" : "center", `${fixed(view.lat, 6)},${fixed(view.lon, 6)}`);
      next.searchParams.set("z", fixed(view.zoom, 2));
      return next.toString();
    },

    /** `#view=lat,lon,11z`, whatever follows it (the day, the layer) kept. */
    "zoom-earth"(url, view) {
      const camera = `view=${fixed(view.lat, 6)},${fixed(view.lon, 6)},${Math.round(view.zoom)}z`;
      const hash = url.hash.replace(/^#/, "");
      if (!/view=[^/]*/.test(hash)) return null;
      url.hash = hash.replace(/view=[^/]*/, camera);
      return url.toString();
    },

    /** `#lat,lon,17`. */
    "satellites-pro"(url, view) {
      url.hash = `${fixed(view.lat, 6)},${fixed(view.lon, 6)},${Math.round(view.zoom)}`;
      return url.toString();
    },

    /** `?zoom=17&lat=…&lng=…`, the acquisition and the layer left alone. */
    "copernicus-browser"(url, view) {
      return withParams(url, {
        zoom: String(Math.round(view.zoom)),
        lat: fixed(view.lat, 5),
        lng: fixed(view.lon, 5),
      });
    },
  };

  /**
   * The address that puts this site's map on `view`, or null where it cannot.
   *
   * `parsed` is the app's reading of the page as it is now. `height` is the
   * map's height in CSS pixels, the number that reading was made against,
   * because Earth's camera distance only means a level next to one.
   */
  function writeView(parsed, href, view, height) {
    const writer = WRITERS[parsed?.site];
    if (!writer || !readable(view) || Math.abs(view.lat) > MAX_LAT) return null;
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    const written = writer(url, reachable(parsed.site, view), height);
    return written && written !== href ? written : null;
  }

  /**
   * The level this map stopped short at, or null when it went where it was sent.
   *
   * Said out loud in the panel rather than corrected, because nothing is wrong:
   * the map is as close as it goes, and the one being followed is exactly where
   * the analyst left it.
   */
  function shortOf(asked, view) {
    if (!readable(asked) || !readable(view)) return null;
    // Somewhere else is not short, it is still on its way: Earth flies in from
    // space on every load, quoting a far camera over the Gulf of Guinea first.
    const there = Math.abs(view.lat - asked.lat) < NEAR_DEG && Math.abs(view.lon - asked.lon) < NEAR_DEG;
    return there && view.zoom < asked.zoom - SHORT_BY ? view.zoom : null;
  }

  /**
   * Why a site's address carries no view right now, when the site says so.
   *
   * Apple swaps its address for `/place?…&coordinate=` while a place card is
   * open — a click on a label, or a long press, which a drag held still before
   * letting go also is — and the camera is not in it at all until the card is
   * closed. Moving the map does not bring it back, so the panel says what does.
   */
  function hiddenBy(href) {
    try {
      const url = new URL(href);
      if (url.hostname === "maps.apple.com" && url.pathname.startsWith("/place")) {
        return "Apple hides the view while a place card is open. Close the card to go on";
      }
    } catch {
      /* not an address */
    }
    return null;
  }

  /** The latitude this site stopped at, when the view it was sent to is nearer a
   *  pole than it will open one. */
  function poleLimit(site, asked, view) {
    const limit = OPEN_LAT_LIMIT[site];
    if (limit == null || !readable(asked) || !readable(view)) return null;
    const stopped = Math.abs(asked.lat) > limit && Math.abs(Math.abs(view.lat) - limit) < NEAR_DEG;
    return stopped ? limit : null;
  }

  window.AzimutMapLink = {
    WRITE_CEILING,
    EARTH_CLOSEST_M,
    followable,
    hiddenBy,
    poleLimit,
    reachable,
    readable,
    sameCamera,
    shortOf,
    writeView,
  };
})();
