/**
 * The map tools panel: the surface everything else hangs off.
 *
 * Injected into whatever map the analyst is already on. It holds three things
 * that have to agree with each other:
 *
 * 1. **A panel**, in a shadow root so the host page's CSS cannot reach it, and
 *    remembered per site — analysts do not want to re-place it every visit. It
 *    is painted in the app's own tokens and drawn with the app's own icons
 *    (`maptheme.js`), because switching between the app's map and a browser tab
 *    should not feel like switching tools.
 * 2. **The view engine.** Where the camera is and how big the map is drawn,
 *    from the app's parse of the URL, carried between two URLs by the gesture
 *    in flight. A gesture moves the drawing and never re-measures it. This is
 *    what turns geometry on and off, and it says why in words when it does.
 * 3. **The tools**, which are `maptools.js` and know nothing about any of the
 *    above — plus the reference windows, which `mapref.js` paints: case
 *    images and videos held over the map, chrome rather than drawing, and the
 *    one tool here that keeps working on a view no geometry can be done on.
 *
 * The map is not taken to be the whole window. A site with a side panel draws
 * its centre somewhere else — Yandex 210 px to the right of the window's, Bing
 * 40 px below it — and drawn on the window's centre instead, everything lands
 * that far off the ground, at every zoom, for ever. There was a calibration
 * frame here for that once, dragged by hand per site; it went, because it asked
 * the analyst a question they should not have to answer and got it wrong more
 * often than the offset it was correcting. It is back, measured: a zoom holds
 * one pixel still while the centre moves under it, which is enough to solve for
 * the pixel the centre is drawn at (`mapmath.js`, `centreFromZoom`). Measured
 * once per site, remembered, and re-measured on every zoom after.
 *
 * Nothing here reaches the network directly. A content script's fetch carries
 * the *page's* origin, which the app's own guard refuses — correctly, since
 * that origin is google.com. Every call goes through the worker's `map-api`
 * relay, which speaks as the extension over the routes it is allowed.
 *
 * Injected after mapmath.js, maptheme.js, maptools.js, mapdraw.js, mapref.js and
 * maplink.js. Injecting it a second time closes the panel, which is what the
 * toolbar button does.
 */

(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;

  // A second injection is the button being pressed again.
  if (window.__AZIMUT_MAP_TOOLS__) {
    window.__AZIMUT_MAP_TOOLS__.close();
    return;
  }

  const M = window.AzimutMapMath;
  const T = window.AzimutMapTools;
  const D = window.AzimutMapDraw;
  const R = window.AzimutMapRefs;
  const K = window.AzimutMapLink;
  const THEME = window.AzimutMapTheme;
  if (!M || !T || !D || !R || !K || !THEME) {
    // The files before this one are injected in the same call and share a scope
    // on both browsers. If that ever stops being true the panel would simply
    // never appear, which is the hardest kind of bug to be told about.
    console.warn("[Azimut] map tools: the panel's own scripts did not load together");
    return;
  }

  const HOST_ID = "azimut-map-tools";
  const storeKey = `mapTools:${location.host}`;
  /** How often the address bar is re-read. These maps rewrite it themselves
   *  without a navigation event, so there is nothing to subscribe to. */
  const URL_POLL_MS = 300;
  /** How long after a gesture the address bar is given to catch up, and how
   *  often it is re-read while waiting. */
  const SETTLE_MS = 200;
  const SETTLE_POLL_MS = 120;
  /** Waiting is not forever: a site that never rewrites its URL would leave the
   *  drawing dimmed for good. */
  const SETTLE_GIVE_UP_MS = 2500;
  /** How long the address bar has to stay the same before the map counts as
   *  landed. Earth writes its URL several times during one zoom, and ending the
   *  wait on the first of them drew the marks at a scale the map was only
   *  passing through. */
  const SETTLE_QUIET_MS = 400;
  /**
   * How often the open sweep is re-read from the case, when nothing has said to.
   *
   * The app says so: a mark made anywhere arrives here as a nudge, over the
   * worker (`background.js`, the map-sync port). This is what covers the one
   * thing a push cannot — a worker the browser evicted mid-sweep, which is
   * noticed when its port dies and healed on the next connect, but not
   * instantly. So it stays, and stays slow: nothing waits on it.
   */
  const GRID_POLL_MS = 30000;
  /** How long before a port that died — an evicted worker, an extension that
   *  reloaded — is opened again. */
  const SYNC_RETRY_MS = 2000;
  /** How often the panel speaks on that port. It carries nothing; what it does
   *  is keep the worker from being evicted while a sweep is open, and give it
   *  the moment to notice a stream of its own that dropped. */
  const WATCH_MS = 20000;
  /** The nudges that mean the case's points moved, whoever moved them. */
  const SAVED_EVENTS = new Set(["place", "capture", "saved"]);
  const icon = THEME.icon;

  // --- talking to the app ----------------------------------------------------

  async function call(method, path, { query, body, form } = {}) {
    const answer = await api.runtime.sendMessage({ type: "map-api", method, path, query, body, form });
    if (!answer?.ok) throw new Error(answer?.error || "the app did not answer");
    return answer.data;
  }

  /**
   * One of the case's files, as bytes.
   *
   * A separate errand from `call` because this is not JSON: it crosses the
   * worker boundary as base64, since a message carries strings and never a
   * blob, and is rebuilt into one here. What `mapref.js` then does with it —
   * decode an image, or hand a video an object URL — is its business.
   */
  async function fetchFile(path) {
    const answer = await api.runtime.sendMessage({ type: "map-file", caseId: state.caseId, path });
    if (!answer?.ok) throw new Error(answer?.error || "the app did not answer");
    const binary = atob(answer.file.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: answer.file.type });
  }

  // --- the state the whole panel reads ---------------------------------------

  const state = {
    parsed: null, // the app's reading of the current URL
    view: null, // { lat, lon, zoom, bearing, projection }; zoom is null until the URL states a scale
    // Where this site draws the coordinate the address bar names, as an offset
    // from the middle of the window. Measured off a zoom, remembered per site,
    // and (0, 0) until one has been made.
    frame: { x: 0, y: 0 },
    framed: false, // whether that offset was measured or is still the default
    caseId: "",
    cases: [],
    tool: null, // which tool the panel is showing, or none
    // `{ field, cursor }` while a date field has its calendar open. One at a
    // time, and never remembered: it is a gesture, not a setting.
    cal: null,
    units: "metric",
    note: "", // the last thing that went wrong, shown in the panel
    pinTitle: "",
    gridTitle: "",
    grids: null,
    collapsed: false,
    // Following the other maps' camera (`linking` below). `asked` is the view
    // this map was last sent to, kept to say how close it came.
    link: { on: false, peers: 0, asked: null },
  };

  const tools = {
    measure: T.createMeasure(),
    pins: T.createPins(),
    sky: T.createSky(),
    grid: T.createGridTool(),
    refs: T.createRefs(),
    fires: T.createFires(),
  };
  const ORDER = ["measure", "pins", "sky", "grid", "refs", "fires"];
  const current = () => (state.tool ? tools[state.tool] : null);

  /**
   * The map rectangle in page pixels: the window, moved by the site's own
   * frame so that its middle falls where the site draws its centre.
   *
   * The size is the window's, which is what the drawing needs it for — nothing
   * here claims to know where a site's map stops and its chrome starts, only
   * where the middle of the camera is.
   */
  function area() {
    return {
      x: state.frame.x,
      y: state.frame.y,
      w: window.innerWidth,
      h: window.innerHeight,
    };
  }

  /** Whether geometry is sound right now, and if not, why (maptools.js). */
  const verdict = () => T.verdict(state.parsed);

  // --- where a coordinate lands, and what a pixel is -------------------------

  /**
   * The shape from the site table, the size from the address bar, and nothing
   * from the gesture.
   *
   * *Which* flattening a site draws in is a fact about the site, and the app's
   * table (`engine/mapsites.py`) knows it. *How big* it is drawn is a number
   * the site itself writes — a tile level, a viewport height in metres, a span
   * in degrees, Earth's camera distance (`scale_source`) — and every one was
   * checked against a browser before being believed.
   *
   * This used to fall back on a scale measured by panning where the URL said
   * none. A drag loses a few pixels to the site's own threshold and gains some
   * to its glide, the first reading was taken on trust, and every later one
   * that disagreed was thrown away as a fling: on Earth that drew the marks
   * four times too close together, for good. A view whose URL states no scale
   * now draws nothing and says so.
   */
  function toScreen(point) {
    return M.toScreen(point, state.view, area());
  }

  /**
   * A page pixel back to a coordinate.
   *
   * The gesture in flight is undone first. While the canvas is carrying a pan
   * the drawing and the screen are two frames apart, and on a site whose
   * address bar lags — Copernicus rewrites its URL on a zoom but not on a pan —
   * they can stay that way. Undoing it is exact, because a pan is a
   * translation: the pixel that was clicked was at `(x − dx) / k` before the
   * map moved, and that is the frame `state.view` still describes.
   */
  function toLatLon(at) {
    const point = gesture
      ? { x: (at.x - gesture.dx) / gesture.k, y: (at.y - gesture.dy) / gesture.k }
      : at;
    return M.toLatLon(point, state.view, area());
  }

  /** Metres across the shorter side of the window — what the sky arc is drawn
   *  to, so it stays inside the view on any screen. */
  function spanMetres() {
    const a = area();
    const mid = a.h / 2;
    const midX = a.w / 2;
    try {
      const across = M.haversine(toLatLon({ x: 0, y: mid }), toLatLon({ x: a.w, y: mid }));
      const down = M.haversine(toLatLon({ x: midX, y: 0 }), toLatLon({ x: midX, y: a.h }));
      return Math.min(across, down);
    } catch {
      return 400;
    }
  }

  // --- the drawing -----------------------------------------------------------

  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    pointerEvents: "none",
  });
  const root = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);
  // Ground first, so it is under the drawing: FIRMS is a picture of what was
  // burning, and a measured path over it has to stay legible.
  const ground = document.createElement("div");
  Object.assign(ground.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "0" });
  const groundImg = document.createElement("img");
  Object.assign(groundImg.style, { position: "absolute", display: "none" });
  ground.appendChild(groundImg);
  root.appendChild(ground);
  const layer = D.createDrawLayer(root);

  let frame = 0;
  /**
   * What the map has done since the drawing was last projected.
   *
   * A pan moves the map by exactly the pixels the pointer travelled, and a
   * wheel notch scales it about the pointer. Both are rigid transforms of what
   * is already on screen, so the canvas is *moved* rather than redrawn: nothing
   * is re-projected, so no error in the scale model can show up as the drawing
   * sliding against the ground under it. It is cleared the moment the address
   * bar says where the map actually landed, and everything is projected again
   * from there.
   */
  let gesture = null; // { dx, dy, k }

  /**
   * The canvas, brought up to date — at most once a frame.
   *
   * A pan fires pointermove far faster than the screen refreshes, and drawing
   * a lattice on every one of them is what makes a map feel like it is dragging
   * something heavy behind it.
   */
  function redraw() {
    if (gesture) return; // the canvas is being moved, not redrawn
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  /**
   * Nothing is drawn on a view whose geometry was refused — not even the marks,
   * which are otherwise the tool that needs no geometry at all. Placing one
   * still works there, because a point can be filed at the coordinate the URL
   * names without anything being projected; what cannot be done honestly is
   * saying *where on this screen* that point is.
   */
  /** Move the canvas the way the map moved. Scaling is about the page origin,
   *  which is where the canvas's own pixels are measured from. */
  function applyGesture() {
    const moved = gesture
      ? `translate(${gesture.dx}px, ${gesture.dy}px) scale(${gesture.k})`
      : "";
    layer.canvas.style.transform = moved;
    layer.canvas.style.transformOrigin = "0 0";
    // The fire picture is ground, so it rides the same transform: it was drawn
    // for a rectangle of the world, and that rectangle moved with everything
    // else. Re-asking on every frame of a pan would be a request per frame.
    ground.style.transform = moved;
    ground.style.transformOrigin = "0 0";
  }

  function clearGesture() {
    if (!gesture) return;
    gesture = null;
    applyGesture();
  }

  /**
   * The map is still moving, and the drawing no longer knows where it is.
   *
   * These maps glide on after the finger leaves and ease into a zoom over a few
   * hundred milliseconds. A drag can be followed exactly, because the map goes
   * where the pointer goes — the glide afterwards and the zoom cannot.
   *
   * So the drawing is dimmed from the moment a gesture ends until the address
   * bar has said where the map landed and then stayed put for
   * `SETTLE_QUIET_MS`. Each reading in between is drawn, dimmed, as it comes:
   * Earth rewrites its URL several times in one zoom, and the first of those
   * is a scale the map is only passing through.
   */
  function beginSettle() {
    lead();
    settling = true;
    settleMoved = 0;
    layer.canvas.style.opacity = "0.25";
    clearTimeout(settle);
    clearTimeout(giveUp);
    settle = setTimeout(function poll() {
      readUrl();
      if (settleMoved && Date.now() - settleMoved >= SETTLE_QUIET_MS) {
        endSettle();
        return;
      }
      if (settling) settle = setTimeout(poll, SETTLE_POLL_MS);
    }, SETTLE_MS);
    giveUp = setTimeout(endSettle, SETTLE_GIVE_UP_MS);
  }

  function endSettle() {
    if (!settling) return;
    settling = false;
    clearTimeout(settle);
    clearTimeout(giveUp);
    layer.canvas.style.opacity = confidence();
    leadOn();
  }

  /**
   * How sure the drawing is allowed to look.
   *
   * Far out the site draws a globe and this draws Mercator: right in the
   * middle, drifting at the edges. That is the one case that dims.
   *
   * Not being placed yet is *not*. It was, briefly, on the grounds that an
   * unmeasured offset is a guess — but a wheel notch is a third of a level on
   * some of these sites, so "until the next zoom" can be several gestures long,
   * and a drawing that is translucent for all of them reads as a broken tool
   * rather than as a careful one. The status line says "zoom once to place it"
   * and its tooltip carries the offset; that is where the doubt belongs.
   */
  function confidence() {
    // …and neither is a tool whose answer does not drift with distance: the sky
    // arc is read at its anchor, and `maptools.js` says so where it declares it.
    const dims = current()?.dimsWhenFar ?? true;
    return verdict().far && dims ? "0.55" : "";
  }

  function paint() {
    const tool = current();
    const say = verdict();
    // The fire layer is not a tool being held: it stays on while something else
    // is being measured over it, which is the whole reason to have it here.
    placeFires();
    refreshFires();
    if (!tool || !state.view || !say.ok) {
      layer.clear();
      return;
    }
    // A drawing that is only roughly placed must not look like one that is
    // placed — `confidence` says what counts as roughly.
    if (!settling) layer.canvas.style.opacity = confidence();
    // Only the tool that is open draws. Everything a tool has been told stays
    // in it — a measured path, a planted point, an open sweep all come back
    // when it is picked up again — but the map goes back to being a map, which
    // is what putting a tool down has to mean.
    const shapes = [...tool.shapes()];
    if (box) shapes.push(boxShape());
    layer.render(shapes, toScreen);
  }

  // --- the fire layer --------------------------------------------------------
  //
  // Not a drawing: FIRMS answers with a picture of the ground, so what is held
  // is the rectangle of world that picture covers and where that rectangle is
  // on screen now. One request per settled view — the panel has no tile grid to
  // hang tiles on, and the FIRMS allowance is counted in requests.

  /** The picture on screen: `{ src, bounds }`, or null when there is none. */
  let fireImage = null;
  let fireAsked = ""; // the view + question it was asked for, so a still map re-asks nothing
  let fireTimer = 0;
  let fireSeq = 0;
  /** How long a settled view is given before the picture is asked for. Panning
   *  through three towns should not ask about all three. */
  const FIRE_SETTLE_MS = 400;
  /** The picture is asked for at the window's size, capped where the app caps
   *  it: past this it is a bigger bill for NASA rather than a sharper answer. */
  const FIRE_MAX_PX = 2560;

  /** The ground the window can see, as a rectangle of degrees. */
  function visibleBounds() {
    const a = area();
    const corners = [
      toLatLon({ x: 0, y: 0 }),
      toLatLon({ x: a.w, y: 0 }),
      toLatLon({ x: 0, y: a.h }),
      toLatLon({ x: a.w, y: a.h }),
    ];
    const lats = corners.map((c) => c.lat);
    const lons = corners.map((c) => c.lon);
    // A view straddling the antimeridian would come back as a rectangle around
    // the wrong side of the world. It is a degenerate case for a fire layer and
    // is skipped rather than drawn wrong.
    if (Math.max(...lons) - Math.min(...lons) > 180) return null;
    return {
      south: Math.max(-85, Math.min(...lats)),
      north: Math.min(85, Math.max(...lats)),
      west: Math.min(...lons),
      east: Math.max(...lons),
    };
  }

  /** Put the picture back where its own ground is now. */
  function placeFires() {
    if (!fireImage || !state.view || !verdict().ok) {
      groundImg.style.display = "none";
      return;
    }
    const { south, west, north, east } = fireImage.bounds;
    const nw = toScreen({ lat: north, lon: west });
    const ne = toScreen({ lat: north, lon: east });
    const sw = toScreen({ lat: south, lon: west });
    const se = toScreen({ lat: south, lon: east });
    const wide = Math.hypot(ne.x - nw.x, ne.y - nw.y);
    const tall = Math.hypot(sw.x - nw.x, sw.y - nw.y);
    // The middle of the picture is the middle of its own corners, and never the
    // coordinate halfway between its edges: Mercator stretches northwards, so
    // the mean of two latitudes sits south of the point halfway down the
    // screen between them. Placed there, the picture rode low — by nothing over
    // a town and by a tenth of the window over a continent, which is why this
    // only showed up zoomed out. A diagonal's midpoint survives a turned
    // compass, which the edges' would not.
    const middle = { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 };
    if (!(wide > 0) || !(tall > 0)) {
      groundImg.style.display = "none";
      return;
    }
    // Out where the site draws a globe, the picture is the thing that drifts
    // most: it is a flat rectangle of ground laid over a curve, and it covers
    // the whole window rather than a mark near the middle. So it dims with the
    // drawing beside it — same 0.55, same sentence in the status line.
    ground.style.opacity = verdict().far ? "0.55" : "";
    Object.assign(groundImg.style, {
      display: "block",
      left: `${middle.x}px`,
      top: `${middle.y}px`,
      width: `${wide}px`,
      height: `${tall}px`,
      // The picture is north-up ground; the map may not be. Same sign as the
      // drawing's own turn: a map with east up points north to the left.
      transform: `translate(-50%, -50%) rotate(${-(state.view?.bearing || 0)}deg)`,
    });
  }

  /** Whether this view is deeper than a detection mark still means anything at. */
  function firesTooDeep() {
    const zoom = state.view?.zoom;
    return zoom != null && zoom > T.FIRE_MAX_ZOOM;
  }

  /** Ask for the picture this view needs, once it has stopped moving. */
  function refreshFires() {
    const asking = tools.fires.query();
    if (!asking || !state.view || !verdict().ok || gesture) {
      if (!asking) {
        fireImage = null;
        fireAsked = "";
        placeFires();
      }
      return;
    }
    // Past the ceiling the app's own map caps its tiles at, the last picture is
    // kept and re-placed on its own ground — which is what the app does with a
    // z14 tile at z18. Asking again would buy a bigger smear of the same marks.
    if (firesTooDeep()) return;
    const bounds = visibleBounds();
    if (!bounds) return;
    // Round the rectangle before it becomes an identity: a map that settles one
    // metre from where it was is the same picture.
    const key = JSON.stringify([
      asking,
      Object.values(bounds).map((n) => n.toFixed(3)),
    ]);
    if (key === fireAsked) return;
    fireAsked = key;
    clearTimeout(fireTimer);
    fireTimer = setTimeout(() => void askFires(bounds, asking), FIRE_SETTLE_MS);
  }

  /**
   * What the fire layer can be asked, and whether a key makes it askable.
   *
   * The app answers from a catalogue and its own settings file, so this is not
   * a call to NASA — nothing reaches FIRMS until the layer is on. Asked again
   * whenever FIRMS refuses, because the app files that refusal against the key
   * and this is how the seat hears about it.
   */
  async function reofferFires() {
    try {
      tools.fires.offer(await call("GET", "/api/ingest/firms/sensors"));
    } catch {
      // an older app has no such route; the seat then says it needs a key
    }
  }

  async function askFires(bounds, asking) {
    const mine = ++fireSeq;
    const a = area();
    const answer = await api.runtime.sendMessage({
      type: "map-image",
      path: "/api/ingest/firms",
      query: {
        ...bounds,
        ...asking,
        width: Math.min(Math.round(a.w), FIRE_MAX_PX),
        height: Math.min(Math.round(a.h), FIRE_MAX_PX),
      },
    });
    if (mine !== fireSeq) return; // the map moved on while this was in flight
    if (!answer?.ok) {
      fireImage = null;
      fireAsked = ""; // it failed, so the next settle is worth another try
      state.note = answer?.error || "the app did not answer";
      placeFires();
      // FIRMS answers a key it will not take with a *picture* saying so, which
      // the app recognises and files against the key. So the panel asks again
      // who it is: a seat that keeps offering a layer the service has already
      // refused is a seat that asks for the same refusal every time the map
      // stops moving.
      await reofferFires();
      return render();
    }
    fireImage = { src: answer.src, bounds };
    groundImg.src = answer.src;
    placeFires();
    if (state.note) {
      state.note = "";
      render();
    }
  }

  /** The rectangle being dragged out, in the app's draft style. */
  function boxShape() {
    const a = toLatLon(box.from);
    const b = toLatLon(box.to);
    return {
      kind: "box",
      bounds: { south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat), west: Math.min(a.lon, b.lon), east: Math.max(a.lon, b.lon) },
      ...THEME.DRAFT_STYLE,
    };
  }

  // --- the view engine -------------------------------------------------------
  //
  // Two inputs, in order of authority. The address bar is the truth, and the
  // app parses it: where the camera is and how far out. A gesture in flight
  // carries the drawing between two truths; it is replaced, never merged, the
  // moment the URL settles. What a finished gesture may still say is where the
  // site draws its centre, from a zoom about a held pixel — never how big the
  // map is.

  /**
   * Whether `state.view.zoom` is the level the map is really at.
   *
   * A whole level is exact by definition: every one of these sites writes those
   * without rounding. A fraction written as a level may not be — Bing's wheel
   * moves a third of a level and it writes one decimal — and a zoom worked out
   * from an anchor (`mapmath.js`) is exact again. A zoom the app worked out from
   * a size (a height in metres, a span, Earth's distance) is exact at any
   * fraction, because the number it came from was written to the metre or
   * finer. Nothing is measured off a view that is not exact, because an error
   * there would come out the other side unchanged.
   */
  let zoomExact = false;
  //. What the address bar last said the zoom was, before any correction — the
  //. only way to tell a pan at this level from a zoom to another one.
  let lastStated = null;
  const wholeLevel = (zoom) => zoom != null && Math.abs(zoom - Math.round(zoom)) < 0.01;
  const exactLevel = (parsed, zoom) =>
    zoom != null && (parsed?.scale_source !== "zoom" || wholeLevel(zoom));
  const middleOf = (a) => ({ x: a.x + a.w / 2, y: a.y + a.h / 2 });

  let lastUrl = "";
  let drag = null; // the gesture in flight
  //. The view a zoom about to happen started from, and the pixel it will hold
  //. still — what `centreFromZoom` solves the site's centre from.
  let zoomAnchor = null;
  //. A zoom too small to solve the frame from, kept in case the next one lands
  //. on the same pixel: notches about one point are one zoom in instalments.
  let frameChain = null;
  let settle = 0;
  let giveUp = 0;
  let settling = false; // a gesture has ended and the map has not settled
  let settleMoved = 0; // when the address bar last changed while settling

  /**
   * How tall the map itself is drawn, in CSS pixels — which is not the window
   * on a site that keeps a header above it.
   *
   * Three views state their scale as a size rather than as a level (Apple's
   * span, Google satellite's metres, Earth's camera distance), and a size is
   * only a scale next to the number of pixels it was drawn in. Hand over the
   * window's height where the site drew the map in less of it and every
   * distance is out by the ratio — Bing's header is eight percent of a 1000 px
   * window.
   *
   * Nothing is looked up to know it. A map centred in what its chrome leaves is
   * centred by exactly half of what the chrome took, so the offset the panel is
   * drawing from is the measurement of the header, whether it was solved here
   * (`measureFrame`) or started from the app's table (`seedFrame`). A scrollbar
   * along the bottom falls out of the same arithmetic. It is read in whole
   * pixels and only past a couple of them: a site that draws dead centre solves
   * to a hair either side of zero, and restating the window as 999.35 px would
   * re-read the scale after every zoom to no purpose.
   */
  const MIN_CHROME_PX = 4;

  function mapHeight() {
    const chrome = 2 * Math.abs(state.frame.y);
    if (chrome < MIN_CHROME_PX) return window.innerHeight;
    return Math.max(1, Math.round(window.innerHeight - chrome));
  }

  //. What the last parse was told the map's height was. A view whose scale came
  //. from a size has to be read again when that number moves, and the URL is not
  //. what moved — resizing the window does it, and so does the first zoom that
  //. measures a header.
  let lastHeight = 0;

  async function readUrl(force = false) {
    // A URL read mid-gesture would replace the drawing the pointer is carrying
    // with a coordinate the site wrote a moment ago, which reads as the overlay
    // stuttering against the map.
    if (drag) return;
    const height = mapHeight();
    if (location.href === lastUrl && height === lastHeight && !force) return;
    if (settling && location.href !== lastUrl) settleMoved = Date.now();
    lastUrl = location.href;
    lastHeight = height;
    let parsed;
    try {
      // The height goes with the URL because it is the one fact the app cannot
      // have and the parse needs: Apple states a span, Google's satellite view a
      // height in metres and Earth a camera distance, and each is a scale only
      // next to the number of pixels it was drawn in (`engine/mapsites.py`).
      parsed = await call("GET", "/api/ingest/parse", {
        query: { url: lastUrl, height },
      });
    } catch (e) {
      state.note = e.message;
      render();
      return;
    }
    adopt(parsed);
    takeWaitingView();
  }

  /** Take the app's reading as the new truth, and learn from the zoom that led
   *  to it where this site draws its centre. */
  function adopt(parsed) {
    const before = state.view;
    state.parsed = parsed;
    landedFollow();
    if (!parsed?.site || parsed.lat == null || parsed.lon == null) {
      state.view = null;
      frameChain = null;
      zoomAnchor = null;
      dropHold();
      clearGesture();
      endSettle();
      releaseGeometryTools();
      render();
      return;
    }
    seedFrame(parsed);
    const view = {
      lat: parsed.lat,
      lon: parsed.lon,
      // null until the address bar states a scale, and nothing is drawn until then
      zoom: parsed.zoom ?? null,
      bearing: parsed.bearing || 0,
      projection: parsed.projection || "webmercator",
    };
    // A zoom worked out from an anchor outlives the pans that follow it: the
    // address bar goes on quoting the same rounded number, and re-reading it
    // would throw the correction away on the first drag.
    if (zoomExact && before && parsed.zoom != null && parsed.zoom === lastStated) {
      view.zoom = before.zoom;
    }
    lastStated = parsed.zoom;
    // A threshold, because a zoom worked out from a size moves a little when
    // nothing has zoomed: a height in metres depends on the latitude it was
    // quoted at, and Earth's distance on the ground under the new centre. The
    // smallest real step any of these sites takes is a fifth of a level.
    const turned = before && before.bearing !== view.bearing;
    const zoomed =
      before?.zoom != null && view.zoom != null && Math.abs(before.zoom - view.zoom) > 0.02;

    // A zoom is the one gesture that can say where this site draws its centre,
    // and the same gesture says what the address bar rounded off the zoom it
    // landed on. Which of the two depends on what is already known, and the
    // order keeps them out of each other's way: a frame is only ever measured
    // from two zooms that are exact, and a zoom is only ever corrected once a
    // frame is known. Neither is ever read out of the other's answer.
    const near = !parsed.far && !zoomAnchor?.far && !zoomAnchor?.adrift;
    if (zoomAnchor && zoomed && near) {
      const exact = exactLevel(parsed, view.zoom);
      let solved = false;
      if (zoomAnchor.exact && exact) {
        solved = measureFrame(zoomAnchor, view);
      } else if (zoomAnchor.exact && state.framed && parsed.scale_source === "zoom") {
        const corrected = M.zoomFromAnchor(zoomAnchor.view, view, zoomAnchor, middleOf(area()));
        if (corrected != null) {
          view.zoom = corrected;
          solved = true;
        }
      }
      zoomExact = exact || solved;
      // A wheel notch is a third of a level on Bing and less on others, which
      // is too little to divide by. Notches about the same pixel are one zoom
      // arriving in instalments, so the view from the start of the run is kept
      // and the solve tried again from there.
      frameChain = solved
        ? null
        : {
            x: zoomAnchor.x,
            y: zoomAnchor.y,
            view: zoomAnchor.view,
            exact: zoomAnchor.exact,
            far: zoomAnchor.far,
          };
    } else if (frameHold && !frameHold.touched && !turned) {
      // the rest of the zoom that is being held: solved again from its anchor
      if (zoomed) zoomExact = exactLevel(parsed, view.zoom);
      reframe(view);
    } else if (zoomed || before?.zoom == null) {
      zoomExact = exactLevel(parsed, view.zoom);
      if (!near) frameChain = null;
    }
    zoomAnchor = null;
    state.view = view;
    // a site still writing down where the analyst took it, after the wait gave up
    if (leading) {
      clearTimeout(leadQuiet);
      leadQuiet = setTimeout(leadOn, SETTLE_QUIET_MS);
    }
    // the map has said where it is, so the canvas goes back to being untouched
    // and everything is projected from there; the dimming lifts once the
    // address bar stops moving (`beginSettle`)
    clearGesture();
    if (tools.sky.anchor && verdict().ok) tools.sky.fit(spanMetres());
    // marks merge by how close together they are on screen, which needs a scale
    if (view.zoom != null) tools.pins.atZoom(view.zoom);
    releaseGeometryTools();
    render();
  }

  /**
   * Where this site draws its centre, read off the zoom that just happened.
   *
   * The arithmetic is `mapmath.js`; what belongs here is what to do with an
   * answer. A camera centre outside the window is not a side panel, it is a bad
   * sample — a zoom the map eased rather than stepped, a gesture the site read
   * as something else — and it is dropped rather than allowed to move the
   * drawing off the screen. Anything inside is adopted whole and remembered:
   * the offset is a fact about this site's layout, not about this visit, and it
   * is worth having before the first gesture of the next one.
   */
  /** How far a fresh reading may sit from the ones before it and still be the
   *  same layout. Past this, a panel has opened or closed and the readings
   *  before it describe a window that no longer exists. */
  const FRAME_JUMP_PX = 25;
  /**
   * How long the address bar has to hold still before a zoom counts as landed.
   *
   * These sites ease into a zoom over a few hundred milliseconds and rewrite
   * the URL while they are doing it: the new level arrives at the start of the
   * ease and the centre catches up at the end. Solved from the first of those
   * readings, the site's centre comes out hundreds of pixels from where it is.
   *
   * Nothing afterwards catches that. The reading that corrects the centre has
   * the same zoom in it, so it reads as a pan, and a pan cannot see the frame —
   * it slides with the map and cancels. The wrong offset was therefore adopted
   * whole, saved for the next visit, and drawn with the same confidence as a
   * good one. So the answer is held for this long instead, re-solved from every
   * reading that arrives in the meantime, and only the one the address bar
   * stops on is kept.
   */
  const FRAME_QUIET_MS = 400;
  /** How much a window may differ and still be the window an offset was
   *  measured in. A scrollbar coming and going is a few pixels; a panel folding
   *  away is hundreds. */
  const WINDOW_SAME_PX = 8;
  let windowSize = { w: window.innerWidth, h: window.innerHeight };

  /**
   * The offsets measured on this site, one per window shape, most recent first.
   *
   * These sites fold a results panel away below a width and open it again above
   * one, so the same site draws its centre in two or three different places
   * depending on how wide the window is. Remembering only the last of them
   * means every change of shape costs a zoom before anything can be placed —
   * and, before this, meant the last one was quietly reused in a window it was
   * never measured in.
   */
  const FRAMES_KEPT = 4;
  let frames = [];
  /** Which way the offsets in storage were solved. Before 2, Earth's came out
   *  of a scale measured off a drag, and a stale one a few pixels out survived
   *  the zooms after it by being averaged in; they are dropped once, and each
   *  site measures its centre again on its first zoom. */
  const FRAMES_VERSION = 2;

  const sameWindow = (a, b) =>
    Math.abs(a.w - b.w) <= WINDOW_SAME_PX && Math.abs(a.h - b.h) <= WINDOW_SAME_PX;

  /** The offset measured in a window this shape, if one was. */
  const frameFor = (size) => frames.find((f) => sameWindow(f, size)) ?? null;

  /** An offset a window this size could actually have: a side panel takes a
   *  part of the width, never more than the window itself. */
  const framePlausible = (f) =>
    Number.isFinite(f?.x) &&
    Number.isFinite(f?.y) &&
    Math.abs(f.x) <= window.innerWidth / 2 &&
    Math.abs(f.y) <= window.innerHeight / 2;
  /** How many readings are averaged. Most of these sites state their zoom
   *  exactly and two zooms agree to a tenth of a pixel, so this is for the one
   *  that does not: Bing writes a single decimal of zoom, and the rounding
   *  lands a few pixels out. Independent roundings average down; a panel that
   *  actually moved does not, which is what the jump above is for. */
  const FRAME_SAMPLES = 6;
  let frameSamples = [];
  /** Whether the offset being drawn from came from the app's site table rather
   *  than from a zoom on this machine — which is what the tooltip says. */
  let seeded = false;
  /** A solved offset waiting for the address bar to stop moving, and the zoom
   *  it came from — kept so every reading in between re-solves it. */
  let frameHold = null; // { anchor, value, touched }
  let frameQuiet = 0;

  /** Where this zoom says the site's centre is, or null if the answer is not
   *  one a side panel could explain. */
  function solveFrame(anchor, view) {
    const found = M.centreFromZoom(anchor.view, view, anchor);
    if (!found) return null;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const next = { x: found.x - w / 2, y: found.y - h / 2 };
    if (Math.abs(next.x) > w / 2 || Math.abs(next.y) > h / 2) return null;
    return next;
  }

  function measureFrame(anchor, view) {
    const next = solveFrame(anchor, view);
    if (!next) return false;
    frameHold = { anchor, value: next, touched: false, site: state.parsed?.site };
    clearTimeout(frameQuiet);
    frameQuiet = setTimeout(commitFrame, FRAME_QUIET_MS);
    return true;
  }

  /**
   * Another reading arrived while an answer was being held.
   *
   * A moved centre, or a zoom that went on further, and nobody's hand on the
   * map: that is the rest of the ease, not a new gesture, and the anchor still
   * describes the map it started from. Earth writes a zoom several times over,
   * Google writes the level first and the centre after. So the answer is solved
   * again from the newer reading and the wait restarts.
   */
  function reframe(view) {
    if (!frameHold || frameHold.touched) return;
    if (frameHold.site !== state.parsed?.site) return dropHold();
    const next = solveFrame(frameHold.anchor, view);
    if (!next) return;
    frameHold.value = next;
    clearTimeout(frameQuiet);
    frameQuiet = setTimeout(commitFrame, FRAME_QUIET_MS);
  }

  /** Let go of an answer that has stopped being about anything: the tab has
   *  left this map, so there is no reading coming that could finish it. */
  function dropHold() {
    frameHold = null;
    clearTimeout(frameQuiet);
  }

  function commitFrame() {
    const held = frameHold;
    frameHold = null;
    if (!held) return;
    takeFrame(held.value);
    render();
  }

  function takeFrame(next) {
    const far = Math.hypot(next.x - state.frame.x, next.y - state.frame.y) > FRAME_JUMP_PX;
    frameSamples = far || !state.framed ? [next] : [...frameSamples, next].slice(-FRAME_SAMPLES);
    const mean = {
      x: frameSamples.reduce((sum, s) => sum + s.x, 0) / frameSamples.length,
      y: frameSamples.reduce((sum, s) => sum + s.y, 0) / frameSamples.length,
    };
    const moved = Math.abs(mean.x - state.frame.x) >= 0.5 || Math.abs(mean.y - state.frame.y) >= 0.5;
    const first = !state.framed;
    state.framed = true;
    seeded = false;
    if (moved) state.frame = mean;
    // A site that draws dead centre measures to the offset it already had, and
    // the answer is still worth keeping: without this the panel would ask for
    // another zoom on every visit to it.
    if (moved || first) save();
  }

  /**
   * Where this site draws its centre before anything here has measured it.
   *
   * The middle of the window was never a neutral starting point — it is a
   * table entry like any other, and the wrong one on four of these sites. A
   * results panel or a header takes part of the window and the map is centred
   * in what is left, which puts Yandex's camera 210 px right of the middle and
   * Bing's 40 px down: at level 3 that is hundreds of kilometres of ground,
   * with nothing on screen saying so. Every install started there and stayed
   * there until the analyst happened to zoom.
   *
   * So the app's table hands over what its own calibration run measured
   * (`engine/mapsites.py`, `_CAMERA_CENTRE`) and the panel starts from that. It
   * is a starting offset and claims nothing more: it does not count as
   * measured, the status line still asks for the zoom that would settle it, and
   * the first solved answer replaces it. A site this machine has already
   * measured keeps its own answer — a measurement here beats a measurement
   * somewhere else, always.
   */
  function seedFrame(parsed) {
    if (state.framed || frames.length || !parsed?.centre_hint) return;
    // A sideways offset is a side panel, and a side panel is the thing that
    // folds away when the window gets narrow. The table says the narrowest
    // window each one was measured in; under that this site is centred
    // horizontally and measured like any other. A header takes height, and a
    // header is the same height in any window.
    const wide = window.innerWidth >= (parsed.centre_hint.min_w || 0);
    const hint = { x: wide ? parsed.centre_hint.x : 0, y: parsed.centre_hint.y };
    if (!framePlausible(hint)) return;
    if (hint.x === state.frame.x && hint.y === state.frame.y) return;
    state.frame = hint;
    seeded = true;
  }

  /** File the measurement under the window it was taken in. */
  function rememberFrame() {
    if (!state.framed) return;
    const entry = { ...windowSize, x: state.frame.x, y: state.frame.y };
    frames = [entry, ...frames.filter((f) => !sameWindow(f, entry))].slice(0, FRAMES_KEPT);
  }

  /**
   * Let go of the click when the view stops being one the tools can answer for.
   *
   * A tool armed on a 2D map stays armed through a pan, which is what makes a
   * measure usable. It must not stay armed through a step into Street View or
   * onto a page that is not a map at all: the canvas would go on taking the
   * clicks with nothing able to answer them, and the map underneath would stop
   * responding for no reason the analyst can see.
   */
  function releaseGeometryTools() {
    if (!verdict().ok) {
      for (const id of ORDER) if (tools[id].needsGeometry) tools[id].disarm();
    }
    syncArmed();
  }

  /**
   * The map moved under a finger. While it is moving the URL says nothing, so
   * the drawing is carried by the pixels the pointer travelled, and nothing is
   * learned from them.
   */
  function onPointerDown(event) {
    // From here the map moves for a reason the ease cannot account for, so the
    // answer being held stands or falls on the readings it already has.
    if (frameHold) frameHold.touched = true;
    if (armed() || !state.view || event.button !== 0) return;
    if (event.composedPath().includes(host)) return;
    // whatever the canvas was already offset by carries into this drag: a pan
    // right after a wheel notch starts from where the zoom left it
    drag = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      base: gesture ?? { dx: 0, dy: 0, k: 1 },
    };
  }

  function onPointerMove(event) {
    if (!drag) {
      hover(event);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    drag.moved = true;
    // the map goes exactly where the pointer goes, so the canvas does too
    gesture = { dx: drag.base.dx + dx, dy: drag.base.dy + dy, k: drag.base.k };
    applyGesture();
  }

  function onPointerUp() {
    if (!drag) return;
    frameChain = null; // the map has moved: a run of notches is over
    const moved = drag.moved;
    drag = null;
    // the map glides on from here, and the drawing cannot follow that. A click
    // that never moved is not a gesture and dims nothing.
    if (moved) beginSettle();
  }

  /**
   * A zoom, waited out rather than guessed at.
   *
   * A pan can be followed because the map moves exactly with the pointer. A
   * zoom cannot: the site picks its own step and eases into it over a few
   * hundred milliseconds. Scaling the canvas by what a wheel notch *usually*
   * means was worse than doing nothing — the drawing arrived at the new size
   * before the map did, then corrected itself. So the drawing dims and waits,
   * and comes back at the scale the address bar states.
   *
   * What the zoom does leave behind is where this site draws its centre: every
   * one of these maps zooms about a point it keeps still, the cursor for a
   * wheel notch and the click for a double-click (`mapmath.js`,
   * `centreFromZoom`).
   */
  function beginZoom(at) {
    // whatever a pan left the canvas offset by is kept rather than undone: it is
    // no more right than it was a moment ago, and undoing it is one more jump
    zoomAnchor = null;
    if (at && state.view) {
      // The view is kept whole, not just the coordinate under the pointer:
      // solving for the site's centre needs where the camera was.
      const sameSpot =
        frameChain && Math.abs(frameChain.x - at.x) <= 6 && Math.abs(frameChain.y - at.y) <= 6;
      zoomAnchor = {
        x: at.x,
        y: at.y,
        view: sameSpot ? frameChain.view : state.view,
        exact: sameSpot ? frameChain.exact : zoomExact,
        // Far out the site is drawing a globe and this arithmetic is Mercator,
        // so a zoom taken out there says nothing true about where the centre
        // is. Kept with the anchor because the zoom that ends the run may be
        // the one that came back in close.
        far: sameSpot ? frameChain.far : !!verdict().far,
        // A pan the address bar never reported leaves the map somewhere
        // `state.view` does not describe, with the canvas carrying the
        // difference. The pixel this zoom turns about is on the screen; the
        // view it would be solved against is the one from before that pan.
        // Read together they put the site's centre out by the whole pan, so
        // this zoom is allowed to move the drawing and not to measure it.
        adrift: !!gesture,
      };
    }
    beginSettle();
  }

  function onWheel(event) {
    if (!state.view || event.composedPath().includes(host)) return;
    if (!event.deltaY) return;
    beginZoom({ x: event.clientX, y: event.clientY });
  }

  /** Double-click is a zoom step on every one of these maps. */
  function onDoubleClick(event) {
    if (armed() || !state.view || event.composedPath().includes(host)) return;
    beginZoom({ x: event.clientX, y: event.clientY });
  }

  // --- what a click means ----------------------------------------------------

  /** Whether a tool is waiting for a click. While one is, the canvas takes
   *  pointer events and the map underneath never sees them; the rest of the
   *  time it is transparent to them and the map pans normally. */
  function armed() {
    return ORDER.some((id) => tools[id].armed);
  }

  function syncArmed() {
    const on = armed();
    layer.canvas.style.pointerEvents = on ? "auto" : "none";
    layer.canvas.style.cursor = on ? "crosshair" : "";
  }

  let box = null; // the rectangle being dragged out

  function canvasDown(event) {
    event.preventDefault();
    event.stopPropagation();
    // Dimmed means the drawing does not know where it is, and a click taken now
    // would be filed against a projection the map has already left. A point in
    // the wrong place is worse than a click that did nothing.
    if (settling) {
      state.note = "The map is still moving";
      render();
      return;
    }
    const at = { x: event.clientX, y: event.clientY };
    if (tools.grid.drawing === "rect") {
      box = { from: at, to: at };
      return;
    }
    handleClick(at);
  }

  function canvasMove(event) {
    if (!box) return;
    box.to = { x: event.clientX, y: event.clientY };
    redraw();
  }

  function canvasUp() {
    if (!box) return;
    const dragged = box;
    const width = Math.abs(dragged.to.x - dragged.from.x);
    const height = Math.abs(dragged.to.y - dragged.from.y);
    box = null;
    if (width < 12 || height < 12) {
      // a stray click, not an area — the app draws the same line at 12 px
      redraw();
      return;
    }
    const a = toLatLon(dragged.from);
    const b = toLatLon(dragged.to);
    const answer = tools.grid.finishBox({ south: a.lat, north: b.lat, west: a.lon, east: b.lon });
    state.note = answer?.error || "";
    syncArmed();
    render();
  }

  /**
   * One click, handed to whichever tool asked for it.
   *
   * The pins tool is the only one that gets a click on a view without geometry,
   * and it gets `null` for the coordinate rather than a guess — see its own
   * note in `maptools.js` for why that distinction is the whole feature.
   */
  function handleClick(at) {
    const sound = verdict().ok && state.view;
    const point = sound ? toLatLon(at) : null;

    if (tools.pins.dropping) {
      const anchor = state.parsed && state.parsed.lat != null
        ? { lat: state.parsed.lat, lon: state.parsed.lon }
        : null;
      if (!point && !anchor) {
        state.note = "Nothing to file: this page has no position in it";
        render();
        return;
      }
      tools.pins.click(point, anchor);
      render();
      return;
    }
    if (!point) return;
    if (tools.sky.placing) {
      tools.sky.click(point);
      tools.sky.fit(spanMetres());
      loadSky();
      syncArmed();
      render();
      return;
    }
    if (tools.measure.mode) {
      tools.measure.click(point);
      render();
      return;
    }
    if (tools.grid.drawing === "polygon") {
      tools.grid.addVertex(point);
      render();
      return;
    }
    if (tools.grid.marking) {
      if (tools.grid.click(point)) {
        pushMarks();
        render();
      }
    }
  }

  /**
   * Pointing at a mark names it; clicking one keeps the name open.
   *
   * Read off plain window events rather than by arming the canvas, because a
   * map with the analyst's own saved work on it still has to be a map: taking
   * the pointer to hover a pin would take it from the site's own controls too.
   */
  let lastHover = { x: -99, y: -99 };

  /**
   * Where a mark's body is drawn, which is not where its point is.
   *
   * The tip is on the coordinate and the body stands above it (`mapdraw.js`),
   * so a pointer is over the mark a whole diagonal north of what the mark is
   * about. Hit-testing against the coordinate would have the analyst chasing a
   * mark that answers below itself.
   */
  function markBody(point) {
    const at = toScreen(point);
    return at && { x: at.x, y: at.y - D.MARK_TIP };
  }

  function hover(event) {
    if (state.tool !== "pins" || !state.view || !verdict().ok || gesture) return;
    if (event.composedPath().includes(host)) return;
    // every mark is projected to answer this, so it is not answered for every
    // pixel the pointer travels
    const at = { x: event.clientX, y: event.clientY };
    if (Math.abs(at.x - lastHover.x) < 4 && Math.abs(at.y - lastHover.y) < 4) return;
    lastHover = at;
    if (tools.pins.hover(tools.pins.markAt(at, markBody)?.key ?? null)) redraw();
  }

  function onClick(event) {
    if (state.tool !== "pins" || armed() || !state.view || !verdict().ok || gesture) return;
    if (event.composedPath().includes(host)) return;
    const mark = tools.pins.markAt({ x: event.clientX, y: event.clientY }, markBody);
    tools.pins.hold(mark?.key ?? null);
    if (mark?.key === "draft") state.tool = "pins";
    render();
  }

  // --- the tools' errands ----------------------------------------------------

  async function loadCases() {
    try {
      state.cases = await call("GET", "/api/ingest/cases");
      const stored = await api.storage.local.get({ lastCaseId: "" });
      const wanted = state.cases.find((c) => c.id === stored.lastCaseId) || state.cases[0];
      if (wanted) state.caseId = wanted.id;
      render();
      loadPins();
    } catch (e) {
      state.note = e.message;
      render();
    }
  }

  async function loadPins() {
    if (!state.caseId) return;
    try {
      tools.pins.load(await call("GET", "/api/ingest/saved", { query: { case_id: state.caseId } }));
      tools.pins.atZoom(state.view?.zoom);
      render();
    } catch (e) {
      state.note = e.message;
      render();
    }
  }

  /** File the draft point as a place, the same route the popup files one with —
   *  so a point dropped here lands in the Saved panel like any other. */
  async function placePin() {
    const draft = tools.pins.draft;
    if (!draft || !state.caseId) return;
    try {
      await call("POST", "/api/ingest/place", {
        form: true,
        body: {
          url: location.href,
          case_id: state.caseId,
          lat: draft.lat,
          lon: draft.lon,
          zoom: state.view?.zoom,
          bearing: state.view?.bearing,
          title: state.pinTitle.trim(),
        },
      });
      tools.pins.clearDraft();
      state.pinTitle = "";
      state.note = "";
      await loadPins();
    } catch (e) {
      state.note = e.message;
    }
    syncArmed();
    render();
  }

  /** What the case has to offer a reference window. Searched, filtered and
   *  ordered by the app, so a case of two thousand files never crosses the
   *  boundary to fill one grid. */
  async function loadRefMedia({ q, kind, sort } = {}) {
    if (!state.caseId) return { items: [], total: 0 };
    return call("GET", "/api/ingest/media", {
      query: { case_id: state.caseId, q, kind, sort },
    });
  }

  async function loadSky() {
    const anchor = tools.sky.anchor;
    if (!anchor) return;
    try {
      tools.sky.accept(
        await call("GET", "/api/ingest/sky", {
          query: { lat: anchor.lat, lon: anchor.lon, date: tools.sky.date },
        })
      );
    } catch (e) {
      state.note = e.message;
    }
    render();
  }

  async function loadGrids() {
    if (!state.caseId) return [];
    try {
      return await call("GET", "/api/ingest/grids", { query: { case_id: state.caseId } });
    } catch (e) {
      state.note = e.message;
      return [];
    }
  }

  /** Refresh the picker, but only for a panel that has ever opened it: a grid
   *  created elsewhere must appear in the list, and a panel that never went near
   *  the tool has no list to keep current. */
  async function relistGrids() {
    if (!state.grids) return;
    state.grids = await loadGrids();
    render();
  }

  /**
   * The newest revision of the open sweep this panel knows of — read, written,
   * or heard about.
   *
   * What it settles is which nudges are news. A panel that marks a cell hears
   * its own mark come back as an event, and re-reading the file for it would be
   * a request per click; a mark made in the app arrives with a revision this
   * panel has never seen, and that one is worth a read.
   */
  let gridRevision = 0;

  const noteRevision = (value) => {
    const revision = Number(value);
    if (Number.isFinite(revision)) gridRevision = Math.max(gridRevision, revision);
  };

  /**
   * Re-read the open sweep, keeping anything this panel has not sent yet.
   *
   * `poll` marks the errand that nobody asked for: the slow safety net, which
   * stays out of the way of a tab that is not being looked at and of a tool that
   * is not open. A nudge is the opposite — something changed, and the panel is
   * holding a copy that no longer matches — so it is read whatever tab is on top.
   */
  async function refreshGrid({ poll = false } = {}) {
    if (!tools.grid.name || !state.caseId) return;
    // marks that are still on their way are the only copy of themselves: the
    // push that carries them re-reads the file itself once they have landed
    if (tools.grid.dirty) return;
    if (poll && (document.hidden || state.tool !== "grid")) return;
    try {
      const spec = await call("GET", "/api/ingest/grid", {
        query: { case_id: state.caseId, name: tools.grid.name },
      });
      noteRevision(spec?.revision);
      if (tools.grid.sync(spec)) render();
    } catch {
      // the case may have been closed or the grid deleted; the next press says so
    }
  }

  async function openGrid(name) {
    try {
      const spec = await call("GET", "/api/ingest/grid", { query: { case_id: state.caseId, name } });
      gridRevision = 0;
      noteRevision(spec?.revision);
      tools.grid.open(spec, name);
      state.note = "";
    } catch (e) {
      state.note = e.message;
    }
    render();
  }

  /**
   * Save a grid drawn here as a new one in the case.
   *
   * Named in the panel rather than through the browser's own prompt: a modal
   * belongs to the page underneath, and a page is free to be in a state where
   * it never appears.
   */
  async function saveGrid() {
    if (!tools.grid.grid || !state.caseId) return;
    const title = state.gridTitle.trim();
    if (!title) {
      state.note = "Name the grid first";
      render();
      return;
    }
    try {
      const saved = await call("POST", "/api/ingest/grid", {
        body: { case_id: state.caseId, title, spec: tools.grid.grid },
      });
      gridRevision = 0;
      noteRevision(saved.revision);
      tools.grid.saved(saved.name);
      state.gridTitle = "";
      state.note = "";
      state.grids = await loadGrids();
    } catch (e) {
      state.note = e.message;
    }
    render();
  }

  /**
   * Send the marks, not the grid.
   *
   * A sweep can be worked from the app and from here at the same time, over one
   * file. Putting back a whole spec would put back the copy this tab loaded,
   * silently undoing whatever the other one marked in between; a patch of the
   * cells that were actually touched cannot do that (`api/satellite.py`,
   * `apply_grid_marks`).
   */
  async function pushMarks() {
    if (!tools.grid.grid || !tools.grid.name || !state.caseId) return;
    const marks = tools.grid.takeMarks();
    if (!Object.keys(marks).length) return;
    try {
      const answer = await call("POST", "/api/ingest/grid/marks", {
        body: { case_id: state.caseId, name: tools.grid.name, marks },
      });
      noteRevision(answer?.revision);
      state.note = "";
      // the answer settles what is on disk, so read it back rather than waiting
      // out the poll: whatever the app marked in the meantime appears now
      refreshGrid();
    } catch (e) {
      // put them back: an unsent mark that has been forgotten is a cell the
      // analyst believes is swept and nothing recorded
      tools.grid.restoreMarks(marks);
      state.note = e.message;
    }
    render();
  }

  // --- hearing about the case from elsewhere ---------------------------------
  //
  // This panel is one of several windows onto one case: the app's own map, this
  // one, another map in the next tab. Everything below is about the other
  // direction of what the tools already do — not what this panel writes, but
  // what it is told.
  //
  // The nudges are the app's own (`api/events.py`), read by the worker and
  // handed over a port (`background.js`). They say what changed and never carry
  // it, so every one of them ends in a read through the routes the panel already
  // uses. A port that dies takes nothing with it: the grid poll above is what
  // covers the gap, and the port is opened again a moment later.

  let sync = null; // the port to the worker, while it is up
  let syncRetry = 0;
  let watch = 0;

  /**
   * One nudge, applied to what this panel is holding.
   *
   * Only for the case that is open here — a mark on another case's sweep is
   * true and none of this panel's business — and only where it is news. A panel
   * that just wrote something hears it back, and re-reading a file to be told
   * what it has just said is the request this exists to avoid.
   */
  function applyEvent(event) {
    if (!event || event.case_id !== state.caseId) return;
    if (SAVED_EVENTS.has(event.type)) {
      loadPins();
      return;
    }
    if (event.type === "grid-removed") {
      if (tools.grid.name === event.name) {
        tools.grid.close();
        state.note = "This sweep was discarded elsewhere";
        syncArmed();
        render();
      }
      relistGrids();
      return;
    }
    if (event.type !== "grid" && event.type !== "grid-marks") return;
    // a grid written anywhere is a picker entry, open or not
    if (event.type === "grid") relistGrids();
    if (tools.grid.name !== event.name) return;
    if (Number(event.revision) <= gridRevision) return;
    refreshGrid();
  }

  function listen() {
    clearTimeout(syncRetry);
    // A browser that hands out no ports is one where nothing is listening; the
    // poll is the whole answer there, and the panel works as it did before.
    if (!api.runtime?.connect) return;
    try {
      sync = api.runtime.connect({ name: "map-sync" });
    } catch {
      sync = null;
      syncRetry = setTimeout(listen, SYNC_RETRY_MS);
      return;
    }
    sync.onMessage.addListener((msg) => {
      if (msg?.type === "app-event") applyEvent(msg.event);
    });
    // The worker is a service worker: the browser is free to evict it, and the
    // port goes with it. Opening another one is what brings it back.
    sync.onDisconnect.addListener(() => {
      sync = null;
      syncRetry = setTimeout(listen, SYNC_RETRY_MS);
    });
  }

  function keepWatching() {
    if (!sync) return;
    try {
      sync.postMessage({ type: "watch" });
    } catch {
      // it disconnected between the check and the send; the listener re-opens it
    }
  }

  // --- linking ---------------------------------------------------------------
  //
  // This map and the others on one camera: other panels, and the app's own map
  // tabs. The worker is the hub (`background.js`, "linked views") and holds
  // which tabs are linked, because following a view reloads most of these sites
  // and takes this panel with it.
  //
  // A view is followed by writing it into the address bar (`maplink.js`), and a
  // view is only ever *sent* after the analyst moved this map (`endSettle`). So a
  // map that arrived somewhere because it was sent there is silent about it, and a
  // map that stops short of a view — Zoom Earth at 11, Google at 21 — says so in
  // its own panel instead of asking everything else to come back out to it.
  //
  // A map in a background tab is not moved where it stands: it keeps the last view
  // and takes it when the analyst comes back to the tab. Writing the address bar
  // reloads most of these sites, and a reload nobody is watching is a reload the
  // analyst pays for twice — once per gesture on the map being led, and again in
  // every race it opens: a page still loading has no panel to hand the next view
  // to, and a browser that granted the tools for one page can refuse them on the
  // next. One tab, one reload, at the moment its map is looked at.

  let link = null; // the port to the hub, while it is up
  let linkRetry = 0;
  /** The view this map was just sent to, until the address bar shows it. Only a
   *  site that takes the view in its hash is still here to see that. */
  let following = null;
  let followedFrom = "";
  /** A view that arrived while this map could not take it: before the address was
   *  first read, or with the tab in the background. Only the last one is kept —
   *  the analyst wants where the other map ended up, not the way it went. */
  let waitingView = null;

  /**
   * How long after a gesture the address bar is still the analyst's motion.
   *
   * The settle gives up after a couple of seconds so the drawing is never left
   * dimmed, but Earth writes a drag or a zoom down seconds after the pointer let
   * go, in more than one go, and without a GPU up to twenty seconds later. A lead
   * that ended with the settle sent nothing from Earth, or the first of its
   * readings and never the one it stopped on.
   */
  const LEAD_WAIT_MS = 20000;
  /** `{ until, sent }` while a gesture is leading: the last view handed over,
   *  or the one the gesture started from. */
  let leading = null;
  let leadQuiet = 0;

  /** A gesture began: what the address bar says from here is the analyst's. */
  function lead() {
    leading = { until: Date.now() + LEAD_WAIT_MS, sent: leading ? leading.sent : state.view };
  }

  /**
   * Hand the view over if the analyst's gesture moved it.
   *
   * Only a gesture leads. A view this map was sent to never gets here, which is
   * what keeps two linked maps from pushing one camera back and forth, and a map
   * that stopped short of one from dragging the rest back out to where it stopped.
   */
  function leadOn() {
    clearTimeout(leadQuiet);
    if (!leading || following || settling) return;
    if (Date.now() > leading.until) {
      leading = null;
      return;
    }
    if (!state.view || K.sameCamera(state.view, leading.sent)) return;
    leading.sent = state.view;
    shareView();
  }

  function linkSend(message) {
    try {
      link?.postMessage(message);
    } catch {
      // the port died with the worker; `joinLink` is already opening another
    }
  }

  function joinLink() {
    clearTimeout(linkRetry);
    if (!api.runtime?.connect) return;
    try {
      link = api.runtime.connect({ name: "map-link" });
    } catch {
      link = null;
      linkRetry = setTimeout(joinLink, SYNC_RETRY_MS);
      return;
    }
    link.onMessage.addListener(onLinkMessage);
    link.onDisconnect.addListener(() => {
      link = null;
      linkRetry = setTimeout(joinLink, SYNC_RETRY_MS);
    });
    // a worker that was evicted forgot nothing it wrote down, but a panel that
    // switched the link while it was gone has to say so again
    if (state.link.on) linkSend({ type: "link", on: true });
  }

  function onLinkMessage(msg) {
    if (msg?.type === "link-state") {
      state.link.on = !!msg.linked;
      if (msg.asked) state.link.asked = msg.asked;
      return render();
    }
    if (msg?.type === "link-peers") {
      if (state.link.peers === msg.count) return;
      state.link.peers = msg.count;
      return render();
    }
    if (msg?.type === "link-note") {
      state.note = msg.note;
      return render();
    }
    if (msg?.type === "view") followView(msg.view);
  }

  /** This map's camera, to the others. Pressing the button sends it too: the
   *  tab that switches the link on is the one the others come to. */
  function shareView() {
    if (!state.link.on || !K.followable(state.parsed) || !state.view) return;
    const view = {
      lat: state.view.lat,
      lon: state.view.lon,
      zoom: state.view.zoom,
      bearing: state.view.bearing || 0,
    };
    if (!K.readable(view)) return;
    linkSend({ type: "view", view });
    if (state.link.asked) {
      state.link.asked = null; // this map leads now, and is wherever the analyst put it
      render();
    }
  }

  /**
   * Go where another map went.
   *
   * Not while the analyst is moving this one: the gesture in hand is the view
   * that is about to lead, and yanking the map out from under it would read as
   * the map fighting back. Not on a view that is not a flat map either — Street
   * View, a pitched camera — because leaving it is the analyst's call, and the
   * panel says it stayed.
   */
  function followView(view) {
    if (!state.link.on || !K.readable(view) || drag || settling) return;
    // A panel just put back after a reload hears the view it missed before it
    // has read its own address, and a tab in the background would reload behind
    // the analyst: either way the view waits.
    if (!state.parsed || document.hidden) {
      waitingView = view;
      return;
    }
    // an Apple place card hides the camera, and the move closes the card
    const hidden = K.hiddenBy(location.href);
    if (!K.followable(state.parsed) && !hidden) {
      state.note = "Linked view not followed: this is not a flat map";
      return render();
    }
    // Against the view this site will really open, not the one it was asked for:
    // a map held at a ceiling or at Apple's pole limit is already where the ask
    // puts it, and reloading it to land it back there would undo the drag the
    // panel just told the analyst to make.
    if (K.sameCamera(K.reachable(state.parsed.site, view), state.view)) return;
    const href = K.writeView(state.parsed, location.href, view, mapHeight());
    if (!href) return;
    // whatever this map was still writing down, another one leads now
    leading = null;
    clearTimeout(leadQuiet);
    following = view;
    followedFrom = location.href;
    state.link.asked = view;
    linkSend({ type: "follow", view });
    location.assign(href);
  }

  /** Take up the view held while this map could not follow it. Dropped if the
   *  map cannot take it now either — the analyst is on this one, and where they
   *  put it is the view the others come to. */
  function takeWaitingView() {
    if (!waitingView) return;
    const view = waitingView;
    waitingView = null;
    followView(view);
  }

  /**
   * The analyst came back to this tab: catch the map up.
   *
   * Visibility, not the active tab, is what holds a view back — a tab that is the
   * front one of a window the analyst is not typing in is still visible, and two
   * maps side by side on two screens go on following each other the way they read
   * as doing.
   */
  function onShown() {
    if (!document.hidden) takeWaitingView();
  }

  /** A follow the site took without reloading has landed: nothing is on its way
   *  back to this tab any more. */
  function landedFollow() {
    if (!following || lastUrl === followedFrom) return;
    following = null;
    linkSend({ type: "landed" });
  }

  function toggleLink() {
    if (!state.link.on && !state.link.peers) return;
    state.link.on = !state.link.on;
    linkSend({ type: "link", on: state.link.on });
    if (state.link.on) shareView();
    else state.link.asked = null;
    render();
  }

  /** What the link button says, which is also why it may be greyed. */
  function linkTitle() {
    if (state.link.on) return "Stop following the other maps";
    if (!state.link.peers) return "Open another map, here or in Azimut, to link the views";
    return "Pan and zoom with the other maps";
  }

  /** The level this map stopped at, when a linked view asked for more. */
  function linkShort() {
    if (!state.link.on || !state.view) return "";
    const pole = K.poleLimit(state.parsed.site, state.link.asked, state.view);
    if (pole != null) return ` · this map opens no nearer the pole than ${pole.toFixed(1)}°, drag the rest of the way`;
    const short = K.shortOf(state.link.asked, state.view);
    return short == null ? "" : ` · as close as this map goes (linked view z${state.link.asked.zoom.toFixed(1)})`;
  }

  // --- the panel -------------------------------------------------------------

  const panel = document.createElement("div");
  panel.className = "panel";
  root.appendChild(panel);

  const t = THEME.TOKENS;
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .panel {
      position: fixed; top: 76px; right: 16px; width: 284px; box-sizing: border-box;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: ${t.text1}; background: ${t.bg1};
      border: 1px solid ${t.border}; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0,0,0,.5);
      pointer-events: auto; overflow: hidden;
      /* Over the drawing (1) and over every reference window, which are
         numbered from 2 and restacked so they stay small: the panel is how a
         window is closed, and one that could be buried under a reference
         would be unreachable. */
      z-index: 1000;
    }
    .panel.collapsed .body { display: none; }
    header {
      display: flex; align-items: center; gap: 6px; padding: 7px 8px 7px 11px;
      background: ${t.bg2}; border-bottom: 1px solid ${t.border};
      cursor: move; user-select: none;
    }
    header .name {
      flex: 1; font-size: 11px; font-weight: 600;
      letter-spacing: .08em; text-transform: uppercase; color: ${t.text2};
    }
    /* Everything the panel holds has to fit the panel, and one thing in it is
       a name the case chose: a forty-word video title used to size this grid,
       push the tab strip and the buttons out past the panel's own width, and
       lose whatever it clipped. So every box down to the name itself is told it
       may shrink: a minmax floor of zero and a zero flex basis, rather than the
       auto minimums a grid track and a flex item take by default, which are the
       content's own width and no smaller. */
    .beta {
      margin-left: 6px; padding: 1px 6px; border-radius: 999px;
      font-size: 9.5px; letter-spacing: .06em; vertical-align: 1px;
      color: ${t.warn}; border: 1px solid ${t.warn};
    }
    .body { padding: 9px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; }
    .status { display: flex; gap: 6px; align-items: flex-start; font-size: 11.5px; color: ${t.text2}; }
    .status svg { flex: none; margin-top: 1px; }
    .status.off { color: ${t.warn}; }
    button, select, input {
      font: inherit; color: ${t.text1}; background: ${t.bg2};
      border: 1px solid ${t.border}; border-radius: 7px;
      padding: 5px 8px; cursor: pointer;
    }
    button {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      line-height: 1.2;
    }
    button:hover:not([disabled]) { background: ${t.bg3}; border-color: ${t.borderStrong}; }
    button[data-on="1"] {
      background: ${t.accent}; border-color: ${t.accent}; color: ${t.accentText};
    }
    button[disabled] { opacity: .4; cursor: default; }
    .tabs { display: grid; grid-template-columns: repeat(${ORDER.length}, minmax(0, 1fr)); gap: 4px; }
    .tabs button { flex-direction: column; gap: 3px; padding: 6px 2px; font-size: 10px; }
    .icon { flex: none; width: 26px; padding: 4px 0; background: none; border-color: transparent; color: ${t.text2}; }
    .icon:hover:not([disabled]) { color: ${t.text1}; }
    input { cursor: text; width: 100%; box-sizing: border-box; }
    input[type=range] { padding: 0; accent-color: ${t.accent}; }
    select { width: 100%; }
    .row { display: flex; gap: 5px; }
    .row > * { flex: 1 1 0; min-width: 0; }
    .readout {
      font-size: 15px; font-variant-numeric: tabular-nums; color: ${t.text1};
      padding: 6px 8px; background: ${t.bg0}; border-radius: 7px;
      border: 1px solid ${t.border};
    }
    .readout.small { font-size: 12.5px; }
    /* the calendar: in flow, so the rows under it move down and no edge of this
       panel — or of the window it floats in — can cut it */
    .cal-row { display: flex; align-items: center; gap: 8px; }
    .cal-label { flex: none; width: 34px; font-size: 11px; color: ${t.text3}; }
    .cal-field {
      flex: 1; min-width: 0; justify-content: space-between; padding: 4px 7px;
      font-size: 12px; font-variant-numeric: tabular-nums;
    }
    .cal-field.empty { color: ${t.text3}; }
    .cal {
      display: flex; flex-direction: column; gap: 3px; padding: 6px;
      background: ${t.bg2}; border: 1px solid ${t.border}; border-radius: 7px;
    }
    .cal-head { display: flex; align-items: center; justify-content: space-between; }
    .cal-month { font-size: 11px; font-weight: 600; color: ${t.text1}; }
    .cal-step { padding: 2px; width: 22px; background: none; border-color: transparent; color: ${t.text2}; }
    .cal-week, .cal-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
    .cal-week span { text-align: center; font-size: 9.5px; color: ${t.text3}; }
    .cal-day {
      padding: 3px 0; font-size: 11px; font-variant-numeric: tabular-nums;
      background: none; border-color: transparent; color: ${t.text2};
    }
    .cal-day.out { color: ${t.text3}; opacity: .55; }
    .cal-day.today { border-color: ${t.borderStrong}; }
    .cal-day.on { border-color: ${t.accent}; color: ${t.accent}; }
    .cal-acts { display: flex; justify-content: flex-end; gap: 4px; }
    .cal-act { padding: 3px 8px; font-size: 11px; }
    /* a name, a note or a coordinate can arrive as one unbroken run of
       characters, and a word that cannot be broken is a box that cannot shrink */
    .readout, .note, .hint { overflow-wrap: anywhere; }
    .note { font-size: 11px; color: ${t.danger}; }
    .ref-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .ref-row .ref-name {
      flex: 1 1 0; min-width: 0; gap: 5px; padding: 4px 6px; font-size: 11.5px;
      justify-content: flex-start; background: none; border-color: transparent;
      color: ${t.text2}; overflow: hidden; white-space: nowrap;
    }
    .ref-row .ref-name svg { flex: none; }
    .ref-row .ref-name > span {
      display: block; flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis;
    }
    .ref-row .ref-name:hover:not([disabled]) { color: ${t.text1}; background: ${t.bg2}; }
    .hint { font-size: 11px; color: ${t.text3}; }
  `;
  root.appendChild(style);

  /**
   * The reference windows, painted by `mapref.js`.
   *
   * Created after the panel's own stylesheet so the look it states is the one
   * the windows build on. It is handed two errands and told nothing else: read
   * what the case has to offer, and fetch one file's bytes. The file that talks
   * to the app stays this one.
   */
  const refLayer = R.create({
    root,
    refs: tools.refs,
    file: fetchFile,
    search: loadRefMedia,
    onchange: () => render(),
    onnote: (message) => {
      state.note = message;
      render();
    },
  });

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const button = (act, name, label, on, extra = "") =>
    `<button data-act="${act}"${on ? ' data-on="1"' : ""}${extra}>${name ? icon(name) : ""}${label ? `<span>${esc(label)}</span>` : ""}</button>`;

  /**
   * One seat in the tab row.
   *
   * A tool with nothing behind it is greyed where it sits, wearing its own
   * reason: the app's Layers panel does the same with the fire layer it has no
   * key for, and a seat that opens on a paragraph about a missing key is a
   * click spent learning there was nothing to click.
   */
  function tab(id) {
    const tool = tools[id];
    const usable = tool.offerable !== false;
    const why = usable ? "" : ` disabled title="${esc(tool.readout(state.units) ?? "")}"`;
    return button("tab", tool.icon, tool.label, state.tool === id, ` data-tab="${id}"${why}`);
  }

  /** Today, in the form every date in here is written in. */
  const todayIso = () => new Date().toISOString().slice(0, 10);

  /**
   * One date, and the calendar it opens — drawn in the panel, never over it.
   *
   * `<input type="date">` came with a calendar of its own, and that calendar is
   * the browser's: it opens at the size the browser wants, in the browser's
   * locale, and over the page. On a panel floating at the edge of somebody
   * else's map it was half outside the window, and read `12/09/2026` where
   * everything else in here reads `2026-09-12`. So the month is ours, in flow,
   * pushing the rows under it down.
   */
  function dayField(field, label, value, empty, min, max) {
    const open = state.cal?.field === field;
    const head = `
      <button data-act="cal-open" data-field="${field}" class="cal-field${value ? "" : " empty"}"${open ? ' data-on="1"' : ""} aria-expanded="${open}">
        <span>${esc(value || empty)}</span>${icon(open ? "chevronUp" : "chevronDown", 11)}
      </button>`;
    if (!open) return `<div class="cal-row"><span class="cal-label">${esc(label)}</span>${head}</div>`;

    const cursor = state.cal.cursor || T.calMonthOf(value);
    const back = !T.calMonthOutOfRange(T.calShiftMonth(cursor, -1), min, max);
    const on = !T.calMonthOutOfRange(T.calShiftMonth(cursor, 1), min, max);
    const today = todayIso();
    const cells = T.calMonthDays(cursor)
      .map((cell) => {
        const refused = T.calOutOfRange(cell.iso, min, max);
        const mark = [cell.inMonth ? "" : "out", cell.iso === value ? "on" : "", cell.iso === today ? "today" : ""]
          .filter(Boolean)
          .join(" ");
        return `<button data-act="cal-day" data-day="${cell.iso}" class="cal-day ${mark}" title="${cell.iso}"${refused ? " disabled" : ""}>${cell.day}</button>`;
      })
      .join("");
    return `
      <div class="cal-row"><span class="cal-label">${esc(label)}</span>${head}</div>
      <div class="cal">
        <div class="cal-head">
          <button data-act="cal-step" data-by="-1" class="cal-step" title="Previous month"${back ? "" : " disabled"}>${icon("chevronLeft", 12)}</button>
          <span class="cal-month">${esc(T.calMonthLabel(cursor))}</span>
          <button data-act="cal-step" data-by="1" class="cal-step" title="Next month"${on ? "" : " disabled"}>${icon("chevronRight", 12)}</button>
        </div>
        <div class="cal-week">${T.CAL_WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="cal-days">${cells}</div>
        <div class="cal-acts">
          <button data-act="cal-day" data-day="${today}" class="cal-act"${T.calOutOfRange(today, min, max) ? " disabled" : ""}>Today</button>
          ${field === "last" ? `<button data-act="cal-day" data-day="" class="cal-act"${value ? "" : " disabled"}>Clear</button>` : ""}
        </div>
      </div>`;
  }

  function toolBody() {
    const tool = current();
    if (!tool) return `<div class="hint">Pick a tool. The map stays yours until you do.</div>`;
    const readout = tool.readout(state.units) ?? "";
    // A tool that computes cannot be armed on a view that refuses geometry.
    // Disabled rather than restated: the status line above has already given
    // the reason, and saying it twice in one panel is one reason too many.
    const off = tool.needsGeometry && !verdict().ok ? " disabled" : "";

    if (state.tool === "measure") {
      return `
        <div class="row">
          ${button("measure-distance", "ruler", "Distance", tool.mode === "distance", off)}
          ${button("measure-area", "polygon", "Area", tool.mode === "area", off)}
        </div>
        <div class="readout">${esc(readout)}</div>
        <div class="row">
          ${button("measure-undo", "undo", "Undo")}
          ${button("measure-clear", "x", "Clear")}
        </div>`;
    }

    if (state.tool === "pins") {
      const draft = tool.draft;
      return `
        ${button("pin-drop", "pin", tool.dropping ? "Click the map" : "Place a point", tool.dropping)}
        <div class="readout small">${esc(readout)}</div>
        ${draft ? `
          <input data-act="pin-title" placeholder="Name this point" value="${esc(state.pinTitle)}">
          <div class="hint">${draft.lat.toFixed(5)}, ${draft.lon.toFixed(5)}</div>
          <div class="row">
            ${button("pin-save", "check", "File it")}
            ${button("pin-cancel", "trash", "Discard")}
          </div>` : `<div class="hint">Point at a mark to name it, click to keep it open.</div>`}`;
    }

    if (state.tool === "sky") {
      const clock = tool.day?.curve?.clock || [];
      return `
        ${button("sky-place", "crosshair", tool.anchor ? "Move the point" : "Plant the point", tool.placing, off)}
        ${tool.anchor ? `<input type="date" data-act="sky-date" value="${esc(tool.date ?? "")}">` : ""}
        <div class="readout">${esc(readout)}</div>
        ${clock.length ? `
          <input type="range" data-act="sky-scrub" min="0" max="${clock.length - 1}" value="${tool.index}">
          <div class="hint">${esc(skyLine(tool))}</div>` : ""}
        ${tool.anchor ? button("sky-clear", "x", "Clear") : ""}`;
    }

    if (state.tool === "refs") {
      return `
        ${button("ref-add", "image", "Add reference")}
        <div class="readout small">${esc(readout)}</div>
        ${tool.open.length
          ? tool.open
              .map((viewer) => `
                <div class="ref-row">
                  ${button("ref-focus", viewer.kind === "video" ? "video" : "image", viewer.title || "Reference", false, ` class="ref-name" data-ref="${esc(viewer.id)}" title="${esc(viewer.title || "Reference")}"`)}
                  ${button("ref-fold", viewer.collapsed ? "chevronDown" : "chevronUp", "", false, ` class="icon" data-ref="${esc(viewer.id)}" title="${viewer.collapsed ? "Unfold" : "Fold"}"`)}
                  ${button("ref-close", "x", "", false, ` class="icon" data-ref="${esc(viewer.id)}" title="Close"`)}
                </div>`)
              .join("")
          : `<div class="hint">Hold a case image or video over the map while you pan. Nothing is filed or captured.</div>`}`;
    }

    if (state.tool === "fires") {
      const fire = tool.state;
      const dated = fire.window === T.FIRE_DATED;
      if (!fire.keyed) {
        return `<div class="hint">NASA FIRMS needs a key. Add one in Azimut Settings → Imagery, then reopen this panel.</div>`;
      }
      return `
        ${button("fires-toggle", fire.on ? "eye" : "eyeOff", fire.on ? "Drawn" : "Draw fires", fire.on, off)}
        <div class="readout small">${esc(readout)}</div>
        ${fire.on ? `
          <div class="row wrap">
            ${fire.sensors
              .map((entry) =>
                button(
                  "fires-sensor",
                  "",
                  entry.label.replace(/\s*\(.*\)\s*$/, ""),
                  fire.sensor === entry.id,
                  ` data-sensor="${esc(entry.id)}" title="${esc(entry.label)}"`
                )
              )
              .join("")}
          </div>
          <div class="row wrap">
            ${T.FIRE_WINDOWS.map((entry) =>
              button("fires-window", "", entry.label, fire.window === entry.id, ` data-window="${esc(entry.id)}" title="Detections from the last ${esc(entry.label.toLowerCase())}"`)
            ).join("")}
            ${button("fires-window", "", "Dates", dated, ` data-window="${T.FIRE_DATED}" title="Detections from a past day or range"`)}
          </div>
          ${dated ? `
            ${dayField("first", "From", fire.first, "Pick a day", "", todayIso())}
            ${dayField("last", "To", fire.last, "That day alone", fire.first, T.fireLastDay(fire.first))}
            <div class="hint">Up to ${T.FIRE_MAX_RANGE_DAYS} days; blank draws the first day alone.</div>` : ""}
          ${firesTooDeep() ? `<div class="hint">${fireImage ? `Past z${T.FIRE_MAX_ZOOM} the picture is held rather than asked again.` : `Zoom out to z${T.FIRE_MAX_ZOOM} to ask for detections.`}</div>` : ""}
        ` : `<div class="hint">Thermal detections from NASA FIRMS, laid over this map.</div>`}`;
    }

    const cover = tool.coverage;
    return `
      ${tool.grid ? "" : `
        <div class="row">
          ${button("grid-rect", "square", "Box", tool.drawing === "rect", off)}
          ${button("grid-poly", "polygon", "Shape", tool.drawing === "polygon", off)}
        </div>
        ${tool.drawing === "polygon" ? `<div class="row">
          ${button("grid-close-shape", "check", "Close shape")}
          ${button("grid-undo-vertex", "undo", "Undo")}
        </div>` : ""}
        <label class="hint">Cell size, metres
          <input data-act="grid-cell" type="number" min="10" step="10" value="${tool.cellM}">
        </label>`}
      <div class="readout small">${esc(readout)}</div>
      ${tool.grid ? `
        <div class="row">
          ${button("grid-mark", "check", "Mark cells", tool.marking, off)}
          ${button("grid-hide", tool.hidden ? "eyeOff" : "eye", tool.hidden ? "Show" : "Hide", tool.hidden)}
        </div>
        ${tool.name ? `
          <div class="hint">Saved as ${esc(tool.name)}${tool.dirty ? " · sending marks" : ""}</div>
          ${button("grid-close", "x", "Close")}
        ` : `
          <input data-act="grid-title" placeholder="Name this grid" value="${esc(state.gridTitle)}">
          <div class="row">
            ${button("grid-save", "save", "Save to case")}
            ${button("grid-close", "trash", "Discard")}
          </div>`}
        ${cover ? `<div class="hint">${cover.total} cells at ${tool.grid.cell_m} m</div>` : ""}
      ` : `
        <select data-act="grid-open">
          <option value="">Open a saved grid…</option>
          ${(state.grids || []).map((g) => `<option value="${esc(g.name)}">${esc(g.title)}</option>`).join("")}
        </select>`}`;
  }

  /** The one line under the sky slider: what is up, and how high. */
  function skyLine(tool) {
    const curve = tool.day?.curve;
    if (!curve) return "";
    const parts = [];
    for (const key of ["sun", "moon"]) {
      const alt = curve[`${key}_altitude`]?.[tool.index];
      const az = curve[`${key}_azimuth`]?.[tool.index];
      if (!Number.isFinite(alt)) continue;
      const lit = key === "moon" ? curve.moon_illuminated?.[tool.index] : null;
      parts.push(
        `${key} ${Math.round(alt)}°, az ${Math.round(az)}°` +
          (lit != null ? `, ${Math.round(lit * 100)}% lit` : "")
      );
    }
    return parts.join(" · ");
  }

  function render() {
    const seen = verdict();
    panel.innerHTML = `
      <header>
        <span class="name">Azimut${betaBadge()}</span>
        ${button("link", "link", "", state.link.on, ` class="icon" title="${linkTitle()}"${state.link.on || state.link.peers ? "" : " disabled"}`)}
        ${button("collapse", state.collapsed ? "chevronDown" : "chevronUp", "", false, ' class="icon" title="Fold"')}
        ${button("close", "x", "", false, ' class="icon" title="Close"')}
      </header>
      <div class="body">
        <div class="status ${seen.ok ? "" : "off"}">
          ${icon(seen.ok ? "satellite" : "alert", 14)}<span${frameTitle()}>${esc(seen.ok ? sound() : K.hiddenBy(location.href) ?? seen.why)}</span>
        </div>
        <select data-act="case">
          ${state.cases.map((c) => `<option value="${esc(c.id)}"${c.id === state.caseId ? " selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select>
        <div class="tabs">
          ${ORDER.map((id) => tab(id)).join("")}
        </div>
        ${toolBody()}
        ${state.note ? `<div class="note">${esc(state.note)}</div>` : ""}
      </div>`;
    panel.classList.toggle("collapsed", state.collapsed);
    paint();
  }

  /** Google Earth is the site the tools keep up with worst: its camera and its
   *  3D globe drift from what the URL says, so the panel owns up to it. */
  function betaBadge() {
    if (state.parsed?.site !== "google-earth") return "";
    return ` <span class="beta" title="Drawings drift more on Google Earth than on other maps">Beta</span>`;
  }

  /** The status line when geometry is on: where, what it is drawing in, and
   *  whether it knows yet which pixel this site's centre is under. */
  function sound() {
    const { zoom } = state.view;
    const framed = state.framed ? "" : " · zoom once to place it";
    const far = verdict().far ? " · drifts at the edges out here" : "";
    return `${state.parsed.site} · z${zoom.toFixed(2)} · ${state.parsed.projection} (${state.parsed.scale_source} from the URL)${framed}${far}${linkShort()}`;
  }

  /** The offset itself, on the line that talks about it. It is the number to
   *  read out when a drawing lands somewhere the ground is not, and there is
   *  nowhere else in the panel it appears. */
  function frameTitle() {
    const { x, y } = state.frame;
    const at = `centre at ${x.toFixed(0)}, ${y.toFixed(0)}`;
    if (state.framed) {
      return ` title="${at} from the middle of a ${windowSize.w}×${windowSize.h} window"`;
    }
    return seeded ? ` title="${at}, from the site table until a zoom measures it"` : "";
  }

  // --- what the panel's controls do ------------------------------------------

  panel.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const act = target.dataset.act;
    state.note = "";

    if (act === "close") return close();
    if (act === "link") return toggleLink();
    if (act === "collapse") {
      state.collapsed = !state.collapsed;
      save();
      return render();
    }
    if (act === "tab") {
      // Pressing the open tool puts it down. Every mode in this panel toggles,
      // and a tool you cannot put down is one that keeps taking your clicks.
      const wanted = target.dataset.tab;
      state.cal = null; // an open calendar belongs to the panel it was opened in
      // Leaving a tool puts it down too. An armed tool that is no longer on
      // screen still takes every click on the map, with nothing drawn to
      // explain why the map has stopped answering.
      for (const id of ORDER) if (id !== wanted || state.tool === wanted) tools[id].disarm();
      // The picker belongs to the tab; the windows do not, and putting the tool
      // down leaves them where they are — a reference is for looking at while
      // measuring, not instead of it.
      if (wanted !== "refs") refLayer.closePicker();
      if (state.tool === wanted) {
        state.tool = null;
      } else {
        state.tool = wanted;
        if (wanted === "grid" && !state.grids) state.grids = await loadGrids();
      }
      syncArmed();
      save();
      return render();
    }

    if (act === "measure-distance" || act === "measure-area") {
      tools.measure.setMode(act === "measure-distance" ? "distance" : "area");
      syncArmed();
      return render();
    }
    if (act === "measure-undo") {
      tools.measure.undo();
      return render();
    }
    if (act === "measure-clear") {
      tools.measure.clear();
      return render();
    }

    if (act === "pin-drop") {
      tools.pins.toggleDrop();
      syncArmed();
      return render();
    }
    if (act === "pin-save") return placePin();
    if (act === "pin-cancel") {
      tools.pins.clearDraft();
      state.pinTitle = "";
      syncArmed();
      return render();
    }

    if (act === "sky-place") {
      tools.sky.togglePlacing();
      syncArmed();
      return render();
    }
    if (act === "sky-clear") {
      tools.sky.clear();
      syncArmed();
      return render();
    }

    if (act === "fires-toggle") {
      tools.fires.toggle();
      redraw(); // the layer goes on or off without anything being clicked on the map
      return render();
    }
    if (act === "cal-open") {
      const field = target.dataset.field;
      state.cal =
        state.cal?.field === field
          ? null
          : { field, cursor: T.calMonthOf(tools.fires.state[field]) };
      return render();
    }
    if (act === "cal-step" && state.cal) {
      state.cal = { ...state.cal, cursor: T.calShiftMonth(state.cal.cursor, Number(target.dataset.by)) };
      return render();
    }
    if (act === "cal-day" && state.cal) {
      tools.fires.set(state.cal.field, target.dataset.day);
      // A first day moved past the end of its own range takes the end with it,
      // rather than leaving a question the service would refuse.
      if (state.cal.field === "first" && T.calOutOfRange(tools.fires.state.last, target.dataset.day, T.fireLastDay(target.dataset.day))) {
        tools.fires.set("last", "");
      }
      state.cal = null;
      redraw();
      return render();
    }
    if (act === "fires-sensor" || act === "fires-window") {
      const field = act === "fires-sensor" ? "sensor" : "window";
      tools.fires.set(field, target.dataset[field]);
      if (field === "window") state.cal = null; // the fields it belonged to are gone
      // Switching to Dates with nothing in them would draw nothing and say so;
      // today is the day being asked about most of the time.
      if (field === "window" && target.dataset.window === T.FIRE_DATED && !tools.fires.state.first) {
        tools.fires.set("first", new Date().toISOString().slice(0, 10));
      }
      redraw();
      return render();
    }

    if (act === "ref-add") {
      refLayer.openPicker();
      return render();
    }
    if (act === "ref-focus") {
      tools.refs.focus(target.dataset.ref);
      return refLayer.sync();
    }
    if (act === "ref-fold") {
      tools.refs.fold(target.dataset.ref);
      refLayer.sync();
      return render();
    }
    if (act === "ref-close") {
      tools.refs.close(target.dataset.ref);
      refLayer.sync();
      return render();
    }

    if (act === "grid-rect" || act === "grid-poly") {
      tools.grid.draw(act === "grid-rect" ? "rect" : "polygon");
      syncArmed();
      return render();
    }
    if (act === "grid-close-shape") {
      const answer = tools.grid.finishPolygon();
      state.note = answer?.error || "";
      syncArmed();
      return render();
    }
    if (act === "grid-undo-vertex") {
      tools.grid.undoVertex();
      return render();
    }
    if (act === "grid-mark") {
      tools.grid.toggleMark();
      syncArmed();
      return render();
    }
    if (act === "grid-hide") {
      tools.grid.toggleHidden();
      return render();
    }
    if (act === "grid-save") return saveGrid();
    if (act === "grid-close") {
      await pushMarks();
      tools.grid.close();
      state.gridTitle = "";
      state.grids = await loadGrids();
      syncArmed();
      return render();
    }
  });

  panel.addEventListener("change", async (event) => {
    const act = event.target.dataset.act;
    if (act === "case") {
      state.caseId = event.target.value;
      api.storage.local.set({ lastCaseId: state.caseId });
      // whatever was half-placed belonged to the case that was open when it was
      // clicked, and filing it into this one would be filing it somewhere else
      tools.pins.disarm();
      state.pinTitle = "";
      tools.grid.close();
      // the windows were holding the other case's media
      refLayer.closePicker();
      tools.refs.clear();
      refLayer.sync();
      state.grids = await loadGrids();
      await loadPins();
      syncArmed();
      return render();
    }
    if (act === "sky-date") {
      tools.sky.onDay(event.target.value || null);
      return loadSky();
    }
    if (act === "grid-open" && event.target.value) return openGrid(event.target.value);
    if (act === "grid-cell") {
      const metres = Number(event.target.value);
      if (metres >= 10) tools.grid.cellM = metres;
    }
  });

  panel.addEventListener("input", (event) => {
    const act = event.target.dataset.act;
    if (act === "pin-title") state.pinTitle = event.target.value;
    if (act === "grid-title") state.gridTitle = event.target.value;
    if (act === "sky-scrub") {
      tools.sky.index = Number(event.target.value);
      // repainted without re-rendering: rebuilding the panel under a slider
      // being dragged takes the slider out from under the pointer
      const line = panel.querySelector(".hint");
      if (line) line.textContent = skyLine(tools.sky);
      const readout = panel.querySelector(".readout");
      if (readout) readout.textContent = tools.sky.readout() ?? "";
      redraw();
    }
  });

  // Dragging the panel by its header. Remembered per site, because a panel that
  // covers the sidebar on one map covers the map itself on another.
  panel.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("header") || event.target.closest("[data-act]")) return;
    const start = { x: event.clientX, y: event.clientY };
    const rect = panel.getBoundingClientRect();
    const move = (e) => {
      panel.style.left = `${rect.left + e.clientX - start.x}px`;
      panel.style.top = `${rect.top + e.clientY - start.y}px`;
      panel.style.right = "auto";
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      save();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });

  // --- what is remembered, per site ------------------------------------------

  function save() {
    rememberFrame();
    const rect = panel.getBoundingClientRect();
    api.storage.local.set({
      [storeKey]: {
        panel: { top: rect.top, left: rect.left },
        collapsed: state.collapsed,
        tool: state.tool,
        // where this site draws its centre, so the next visit starts placed —
        // each with the window it was measured in, because that is what makes
        // it an answer rather than a number
        frames,
        framesVersion: FRAMES_VERSION,
      },
    });
  }

  async function restore() {
    const stored = (await api.storage.local.get({ [storeKey]: null }))[storeKey];
    if (!stored) return;
    state.collapsed = !!stored.collapsed;
    if (stored.tool && tools[stored.tool]) state.tool = stored.tool;
    if (Array.isArray(stored.frames) && stored.framesVersion === FRAMES_VERSION) {
      // Anything that could not fit inside this window describes a layout that
      // is gone, and is dropped outright.
      frames = stored.frames.filter(framePlausible).slice(0, FRAMES_KEPT);
      // One of them was measured in a window this shape, or none was. Failing
      // a match the most recent is still the best guess there is, so it is
      // drawn from — but it does not count as measured, and the panel asks for
      // the zoom that would settle it rather than standing behind a number from
      // a window that no longer exists.
      const here = frameFor(windowSize);
      const best = here ?? frames[0];
      if (best) {
        state.frame = { x: best.x, y: best.y };
        state.framed = !!here;
        seeded = false; // measured here once, which beats the app's table
        frameSamples = here ? [state.frame] : [];
      }
    }
    if (stored.panel) {
      // clamped back inside the window: a panel remembered on a wide screen
      // must not open off the edge of a narrow one
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 60, stored.panel.top))}px`;
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, stored.panel.left))}px`;
      panel.style.right = "auto";
    }
  }

  // --- out of the frame ------------------------------------------------------

  /**
   * The panel and its windows, taken out of the shot.
   *
   * `captureVisibleTab` photographs the page as it is composited, and this panel
   * is on it — so a capture filed from a tab with the tools open used to carry
   * them. A reference image floating over the map would be worse than
   * untidy: it would look like part of the ground.
   *
   * The worker asks before it grabs and again after (`background.js`). Two
   * frames are waited out before answering, because a `display: none` set this
   * frame is still in the one the compositor is holding — `overlay.js` waits the
   * same two, for the same reason.
   */
  function onCaptureFrame(msg, sender, sendResponse) {
    if (msg?.type !== "map-chrome") return false;
    host.style.display = msg.hide ? "none" : "";
    requestAnimationFrame(() => requestAnimationFrame(() => sendResponse({ ok: true })));
    return true;
  }
  api.runtime.onMessage.addListener(onCaptureFrame);

  /**
   * The window changed size, so what was measured about this site's layout may
   * not hold any more.
   *
   * A fixed side panel keeps its pixel offset when the window is resized and a
   * panel measured in percentages does not, and nothing in the address bar says
   * which this one is. The offset is kept — it is still the best answer there
   * is — but it stops counting as measured, so the panel asks for the zoom that
   * would settle it rather than quietly standing behind a number from a window
   * that no longer exists.
   *
   * The scale is re-read rather than kept, and that is not the same decision. On
   * the two views that state a size instead of a level, the zoom was worked out
   * against the height the map was drawn in, so a window that changed height
   * quietly changed the scale. `readUrl` notices on the next poll, because the
   * height it was last told is part of what makes a reading current.
   */
  function onResize() {
    const moved =
      Math.abs(window.innerWidth - windowSize.w) > WINDOW_SAME_PX ||
      Math.abs(window.innerHeight - windowSize.h) > WINDOW_SAME_PX;
    rememberFrame(); // file what was measured under the window it was measured in
    windowSize = { w: window.innerWidth, h: window.innerHeight };
    if (moved) {
      // A window that changed width can have changed which half of the table's
      // answer applies: a header is a header at any width and a side panel is
      // not. Nothing measured here is touched — `seedFrame` stands aside for
      // that, and `rememberFrame` has just filed it.
      seedFrame(state.parsed);
      // A window dragged back to a shape this site was already measured in is
      // placed again without asking for another zoom, which is what keeping
      // more than one of them is for.
      const known = frameFor(windowSize);
      if (known) {
        state.frame = { x: known.x, y: known.y };
        state.framed = true;
        frameSamples = [state.frame];
        render();
        return;
      }
      if (state.framed && (state.frame.x || state.frame.y)) {
        state.framed = false;
        render();
        return;
      }
    }
    redraw();
  }

  // --- lifecycle -------------------------------------------------------------

  const listeners = [
    [window, "pointerdown", onPointerDown, true],
    [window, "pointermove", onPointerMove, true],
    [window, "pointerup", onPointerUp, true],
    [window, "click", onClick, true],
    [window, "dblclick", onDoubleClick, true],
    [window, "wheel", onWheel, { capture: true, passive: true }],
    [window, "resize", onResize, false],
    [document, "visibilitychange", onShown, false],
    [layer.canvas, "pointerdown", canvasDown, false],
    [layer.canvas, "pointermove", canvasMove, false],
    [layer.canvas, "pointerup", canvasUp, false],
  ];
  for (const [node, type, fn, opts] of listeners) node.addEventListener(type, fn, opts);
  const poll = setInterval(() => readUrl(), URL_POLL_MS);
  const gridPoll = setInterval(() => refreshGrid({ poll: true }), GRID_POLL_MS);
  watch = setInterval(keepWatching, WATCH_MS);
  listen();
  joinLink();

  function close() {
    clearInterval(poll);
    clearInterval(gridPoll);
    clearInterval(watch);
    clearTimeout(syncRetry);
    try {
      sync?.disconnect();
    } catch {
      /* already gone */
    }
    sync = null;
    clearTimeout(linkRetry);
    clearTimeout(leadQuiet);
    // closing the tools is leaving the link; a reload that follows a view is not
    // a close, and never gets here
    if (state.link.on) linkSend({ type: "link", on: false });
    try {
      link?.disconnect();
    } catch {
      /* already gone */
    }
    link = null;
    clearTimeout(giveUp);
    clearTimeout(settle);
    clearTimeout(frameQuiet);
    if (frame) cancelAnimationFrame(frame);
    for (const [node, type, fn, opts] of listeners) node.removeEventListener(type, fn, opts);
    api.runtime.onMessage.removeListener(onCaptureFrame);
    refLayer.destroy();
    layer.destroy();
    host.remove();
    delete window.__AZIMUT_MAP_TOOLS__;
  }

  window.__AZIMUT_MAP_TOOLS__ = { close, state, tools };

  (async () => {
    await restore();
    render();
    try {
      state.units = (await call("GET", "/api/ingest/ping")).units || "metric";
    } catch (e) {
      state.note = e.message;
    }
    await loadCases();
    await reofferFires();
    await readUrl(true);
  })();
})();
