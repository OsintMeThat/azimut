<script>
  /**
   * A plate's page on the screen: the paper, its live maps, everything else drawn
   * over them on one canvas (`lib/plate/draw.js`), and the hand on top of it all.
   *
   * The page is laid out at its true size (`PX_PER_MM`) and scaled to the window,
   * so what the screen shows is what the export draws.
   *
   * - The wheel zooms the page round the pointer, and a drag on the paper's empty
   *   ground or round the page (or a middle-button drag anywhere) moves it. **Fit**
   *   brings it back to the window.
   * - A press picks an element; Shift adds it to the picked ones, and elements put
   *   in one group are picked together. A drag moves what is picked once the
   *   pointer has really moved, and catches on the page's lines and the other
   *   boxes (Alt lets go of them). A locked element stays where it is.
   * - A drag on a map moves its frame, as any element's; its ground stays put until a
   *   double click (or the bar's button) goes into it: pan, zoom, and turn by a
   *   middle-drag, a Shift-drag or a double click held, as the app's other maps.
   * - A detail's square on the map it is drawn from is dragged there: it moves what
   *   the detail shows.
   * - What stands on the ground (a label's point, an arrow, a zone, a line, rings, a
   *   cone, a distance) is dragged there, by its handles or by its body. A text on the
   *   map, a label without a leader, takes its point along when it is moved.
   * - On a played plate, a day or a step frames a map its own way only once it lets
   *   go of the previous framing; until then the map holds still there.
   * - A step's videos stand under the writing, on their first frame, and run while
   *   the plate plays that step.
   */
  import PlateMap from './PlateMap.svelte';
  import PlateMapBar from './PlateMapBar.svelte';
  import PlateVideo from './PlateVideo.svelte';
  import { drawPage } from '../../lib/plate/draw.js';
  import { GRAIN_MM, grainStrength, grainUrl } from '../../lib/plate/grain.js';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { BOXED_ON_THE_GROUND, ON_THE_GROUND, decorDensity, facesOf, fitPage, insetView, PX_PER_MM, pageSize, shownOn, standsOver, zoomPageAt } from '../../lib/plate/page.js';
  import { bearingTo, circle, corners, distance, project as flatProject, sameView, sector, travel, unproject as flatUnproject } from '../../lib/plate/geo.js';

  let {
    spec,
    /** The picked elements, by id; the last is the one the inspector sets. */
    selection = $bindable([]),
    framing = $bindable(''),
    /** What the next press on a map places, `{ kind, ... }`, or null. */
    placing = null,
    onplace = null,
    caseId = '',
    rows = [],
    providers = [],
    relief = null,
    /** The time the maps are drawn at: the plate's, or an export's day. */
    time,
    /** The step of the day shown (`placeOf`), null for the day itself. */
    stepPlace = null,
    /** The plate is playing: the shown step's clips run, at `speed`. */
    playing = false,
    speed = 1,
    /** `{ id: { view, frame } }`, reported by each map. */
    views = $bindable({}),
    /** What the page's drawing reads beside the plate (`drawPage`'s context). */
    decor = {},
    /** The elements whose words run past their box, as the last drawing found. */
    overflow = $bindable(new Map()),
    /** `(id, handle)` as each map comes up, for the export. */
    onmap = null,
    /** `(map, text, at, page)`: a name of the ground made a label standing at `at`, `page` its point on the page in millimetres. */
    onnamelabel = null,
    /** `(id, { x, y })`: a right-click on an element, or on the paper with `id` null. */
    oncontext = null,
    /** `[id, label]` of the grounds a plate's maps can be drawn on. */
    grounds = [],
    /** Draw the annotations of the plate's other days, faintly. */
    ghosts = false,
    /** How a map is framed on the day or step shown: `{ view, own, first }` (`page.framingOf`). */
    framingFor = (map) => ({ view: map.view, own: false, first: true }),
    /** `(map, view)`: the map framed by the hand, written where the day or step shown keeps it. */
    onmapview = (map, view) => { map.view = view; },
    /** `(map, keep)`: the day or step shown keeps the framing before it, or frames the map its own way. */
    onkeep = null,
    /** The day or step shown, as its framing is kept (`page.beatKey`). */
    beat = '',
    /** Milliseconds a map takes to reach the next framing while the plate plays. */
    glide = 0,
    /** Pixels kept clear over the page when it fits, for a bar floating there. */
    top = 0,
    /** The plate as written (`JSON.stringify(spec)`), when the editor has it already: the drawing follows it. */
    written = '',
  } = $props();

  const size = $derived(pageSize(spec.page));
  const width = $derived(size.width * PX_PER_MM);
  const height = $derived(size.height * PX_PER_MM);
  let viewportWidth = $state(800);
  let viewportHeight = $state(600);
  /** Where the page stands in the window, `{ scale, x, y }`: null while it fits the window. */
  let camera = $state(null);
  const shown = $derived(camera ?? fitPage({ width, height }, { width: viewportWidth, height: viewportHeight }, 24, top));
  const scale = $derived(shown.scale);
  let viewportEl = $state();
  let panning = $state(false);
  // another paper: the page fits the window again (an undo keeps where it was)
  $effect(() => { void width; void height; camera = null; });
  let pageEl = $state();
  let canvas = $state();
  /** The paper's grain as a picture, made the first time a page asks for it. */
  const grain = $derived(grainStrength(spec.page?.grain) > 0 ? grainUrl() : '');
  let guides = $state([]);
  let fontsReady = $state(0);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
  /** Canvas pixels a page pixel holds: it follows the zoom once the wheel rests, so small words stay sharp. */
  let density = $state(dpr);
  $effect(() => {
    const next = decorDensity({ width, height }, scale, dpr);
    if (next === density) return;
    const timer = setTimeout(() => { density = next; }, 150);
    return () => clearTimeout(timer);
  });
  const at = $derived(time?.at ?? null);
  const selected = $derived(selection.at(-1) ?? '');

  // a globe inset is drawn on the page itself, not as a live map
  const maps = $derived(spec.elements.filter((element) => element.kind === 'map' || (element.kind === 'inset' && !element.globe)));

  /** The view a map is drawn at: as the day or step shown frames it, or an inset's, over its map's centre. */
  function viewOf(element) {
    if (element.kind === 'map') return framingFor(element).view;
    const of = spec.elements.find((item) => item.id === element.of);
    const live = of ? views[of.id]?.view ?? framingFor(of).view : null;
    if (!live) return { lat: 0, lon: 0, zoom: 2, bearing: 0 };
    return insetView(element, live);
  }

  /**
   * A map moved: the plate keeps its view, and what stands beside it by hand (a
   * label's words, a picture pointing at the ground) moves with the point it names,
   * so a reframed map never leaves its labels behind.
   */
  /**
   * The plate and the day or step the last report came from: an undo, a new paper, or
   * another day framed otherwise hands over a map that moved without the hand, whose
   * labels are already where they belong.
   */
  const reportedFor = new Map();
  function reported(element, view, frame, placer = null) {
    const before = views[element.id];
    views = { ...views, [element.id]: { view, frame, ...(placer ?? {}) } };
    if (element.kind !== 'map') return;
    const same = reportedFor.get(element.id)?.spec === spec && reportedFor.get(element.id)?.beat === beat;
    reportedFor.set(element.id, { spec, beat });
    // a played plate shows its framings without keeping one; a day holding the one before keeps none of its own
    const framed = framingFor(element);
    if (playing || (!framed.own && !framed.first)) return;
    const kept = { lat: round(view.lat, 6), lon: round(view.lon, 6), zoom: round(view.zoom, 3), bearing: round(view.bearing, 1),
      ...((view.pitch ?? 0) > 0.05 ? { pitch: round(view.pitch, 1) } : {}) };
    if (!sameView(kept, framed.view)) onmapview(element, kept);
    if (!same || !before || sameView(before.view, view)) return;
    for (const item of spec.elements) {
      if (item.of !== element.id || !item.at || !['label', 'image', 'video'].includes(item.kind)) continue;
      const [ox, oy] = flatProject(before.view, before.frame, item.at);
      const [nx, ny] = flatProject(view, frame, item.at);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
      item.box = [round(item.box[0] + (nx - ox) / PX_PER_MM, 1), round(item.box[1] + (ny - oy) / PX_PER_MM, 1), item.box[2], item.box[3]];
    }
  }
  const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

  // The faces the page writes in, asked for by name, since a canvas never asks: the page
  // is drawn again once they are in, and again when any face arrives later (an Arabic name).
  const faces = $derived(facesOf(spec).join('|'));
  $effect(() => {
    if (!document.fonts?.load) return;
    let gone = false;
    Promise.all(faces.split('|').map((face) => document.fonts.load(face).catch(() => [])))
      .then(() => { if (!gone) fontsReady += 1; });
    return () => { gone = true; };
  });
  $effect(() => {
    const set = document.fonts;
    if (!set?.addEventListener) return;
    const redraw = () => { fontsReady += 1; };
    set.addEventListener('loadingdone', redraw);
    return () => set.removeEventListener('loadingdone', redraw);
  });

  // Everything that is not a map, drawn again whenever anything it reads moves.
  $effect(() => {
    if (!canvas) return;
    void (written || JSON.stringify(spec)); void fontsReady; void decor; void ghosts; void views;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ran = drawPage(ctx, spec, { ...decor, scale: PX_PER_MM * density, views, at, editing: true, ghosts });
    const before = [...overflow].join();
    if ([...ran].join() !== before) overflow = ran;
  });

  /** The paper as the page shows it under the maps: a colour, a gradient, a picture. */
  const paperStyle = $derived.by(() => {
    const background = spec.page?.background ?? {};
    if (background.kind === 'gradient') return `linear-gradient(${background.angle ?? 90}deg, ${spec.theme.paper}, ${background.colour || spec.theme.paper})`;
    if (background.kind === 'image' && background.data) return `${spec.theme.paper} url("${background.data}") center / cover no-repeat`;
    if (spec.page?.transparent) return `repeating-conic-gradient(#d9d9d9 0 25%, #ffffff 0 50%) 0 0 / 16px 16px`;
    return spec.theme.paper;
  });

  // -- the hand ---------------------------------------------------------------------

  /** The page point under the pointer, in millimetres. */
  function toMm(event) {
    const rect = pageEl.getBoundingClientRect();
    return [(event.clientX - rect.left) / scale / PX_PER_MM, (event.clientY - rect.top) / scale / PX_PER_MM];
  }

  /** A map's frame point to the ground and back: through its own camera when it is in 3D. */
  const project = (live, point) => (live.project ? live.project(point) : flatProject(live.view, live.frame, point));
  const unproject = (live, at) => (live.unproject ? live.unproject(at) : flatUnproject(live.view, live.frame, at));

  /** The ground under a page point, on the map whose frame holds it, or null. */
  function groundAt(element, [mx, my]) {
    const live = views[element.id];
    if (!live) return null;
    const [x, y] = element.box;
    return unproject(live, [(mx - x) * PX_PER_MM, (my - y) * PX_PER_MM]);
  }

  /** Where a point of the ground stands on the page, in millimetres, through a map. */
  function onMap(map, point) {
    const live = map && views[map.id];
    if (!live || !point) return null;
    const [px, py] = project(live, point);
    return [map.box[0] + px / PX_PER_MM, map.box[1] + py / PX_PER_MM];
  }
  const mapOf = (element) => spec.elements.find((item) => item.id === element.of);
  const onPage = (element, point) => onMap(mapOf(element), point);
  /** Where an element shows on the page: a text on the map over its point, anything else in its box. */
  function shownBox(element) {
    const point = standsOver(element) ? onPage(element, element.at) : null;
    return point ? [point[0] - element.box[2] / 2, point[1] - element.box[3] / 2, element.box[2], element.box[3]] : element.box;
  }
  /** Whether a text on the map has its point outside its map's frame on the day or step shown, so it is not there to pick. */
  function offMap(element) {
    const map = standsOver(element) ? mapOf(element) : null;
    const point = map && onPage(element, element.at);
    return !!point && (point[0] < map.box[0] || point[1] < map.box[1] || point[0] > map.box[0] + map.box[2] || point[1] > map.box[1] + map.box[3]);
  }

  const CATCH = 1.4;
  /** The lines a moving box can catch on: the page's edges and middle, and every other box's. */
  function lines(except) {
    const xs = [0, size.width / 2, size.width];
    const ys = [0, size.height / 2, size.height];
    for (const element of spec.elements) {
      if (except.has(element.id) || ON_THE_GROUND.includes(element.kind) || element.hidden) continue;
      const [x, y, w, h] = element.box;
      xs.push(x, x + w / 2, x + w); ys.push(y, y + h / 2, y + h);
    }
    return { xs, ys };
  }

  function caught(values, targets) {
    let best = null;
    for (const [index, value] of values.entries()) {
      for (const target of targets) {
        const gap = target - value;
        if (Math.abs(gap) <= CATCH && (!best || Math.abs(gap) < Math.abs(best.gap))) best = { gap, at: target, index };
      }
    }
    return best;
  }

  /** The ids a press on `element` picks: its group's, added to the others with Shift. */
  function pick(element, add) {
    const ids = element.group ? spec.elements.filter((item) => item.group === element.group).map((item) => item.id) : [element.id];
    if (add) {
      const all = selection.includes(element.id);
      selection = all ? selection.filter((id) => !ids.includes(id)) : [...selection.filter((id) => !ids.includes(id)), ...ids.filter((id) => id !== element.id), element.id];
    } else if (!selection.includes(element.id)) selection = [...ids.filter((id) => id !== element.id), element.id];
    else selection = [...selection.filter((id) => id !== element.id), element.id];
  }

  /**
   * A right-click: the menu of the element under the pointer (a handle is its element's,
   * a detail's square the detail's), or of the page. A framed map keeps the button for itself.
   */
  function context(event) {
    if (!oncontext || placing || event.target.closest?.('.plate-map.live, .bar')) return;
    const hit = event.target.closest?.('[data-element], [data-footprint]');
    const id = hit?.dataset.element ?? hit?.dataset.footprint ?? (event.target.closest?.('.handle, .ground') ? selected : '');
    event.preventDefault();
    oncontext(id || null, { x: event.clientX, y: event.clientY });
  }

  /** The press moves only after the pointer has gone this far, in screen pixels: a click picks, it never nudges. */
  const DRAG_PIXELS = 4;

  function grab(event, element, handle = 'move') {
    if (event.button !== 0 || framing === element.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (handle === 'move') pick(element, event.shiftKey);
    if (framing && framing !== element.id) framing = '';
    if (event.shiftKey && handle === 'move') return;
    // a text on the map is moved from where it shows, over its point
    if (standsOver(element) && !element.locked) element.box = shownBox(element).map((value) => Math.round(value * 10) / 10);
    const moving = handle === 'move'
      // a label's words are placed on the page by the hand, its point stays on the ground
      ? spec.elements.filter((item) => selection.includes(item.id) && !item.locked && (!ON_THE_GROUND.includes(item.kind) || BOXED_ON_THE_GROUND.includes(item.kind)))
      : element.locked ? [] : [element];
    if (!moving.length) return;
    const start = toMm(event);
    const screen = [event.clientX, event.clientY];
    const boxes = new Map(moving.map((item) => [item.id, [...item.box]]));
    const box = boxes.get(element.id) ?? [...element.box];
    const { xs, ys } = lines(new Set(moving.map((item) => item.id)));
    let started = false;
    const move = (next) => {
      if (!started && Math.hypot(next.clientX - screen[0], next.clientY - screen[1]) < DRAG_PIXELS) return;
      started = true;
      const [mx, my] = toMm(next);
      let [x, y, w, h] = box;
      const dx = mx - start[0];
      const dy = my - start[1];
      if (handle === 'move') { x += dx; y += dy; }
      if (handle.includes('w')) { x = Math.min(box[0] + box[2] - 3, box[0] + dx); w = box[2] - (x - box[0]); }
      if (handle.includes('e')) w = Math.max(3, box[2] + dx);
      if (handle.includes('n')) { y = Math.min(box[1] + box[3] - 3, box[1] + dy); h = box[3] - (y - box[1]); }
      if (handle.includes('s')) h = Math.max(3, box[3] + dy);
      if (next.shiftKey && handle !== 'move' && handle.length === 2) {
        // a corner with Shift keeps the box's proportions
        const ratio = box[2] / box[3];
        if (w / h > ratio) w = h * ratio; else h = w / ratio;
        if (handle.includes('w')) x = box[0] + box[2] - w;
        if (handle.includes('n')) y = box[1] + box[3] - h;
      }
      const found = [];
      if (!next.altKey) {
        const cx = handle === 'move' ? caught([x, x + w / 2, x + w], xs) : caught(handle.includes('w') ? [x] : handle.includes('e') ? [x + w] : [], xs);
        if (cx) { if (handle === 'move') x += cx.gap; else if (handle.includes('w')) { x += cx.gap; w -= cx.gap; } else w += cx.gap; found.push({ axis: 'x', at: cx.at }); }
        const cy = handle === 'move' ? caught([y, y + h / 2, y + h], ys) : caught(handle.includes('n') ? [y] : handle.includes('s') ? [y + h] : [], ys);
        if (cy) { if (handle === 'move') y += cy.gap; else if (handle.includes('n')) { y += cy.gap; h -= cy.gap; } else h += cy.gap; found.push({ axis: 'y', at: cy.at }); }
      }
      guides = found;
      if (handle === 'move') {
        const ddx = x - box[0];
        const ddy = y - box[1];
        for (const item of moving) {
          const from = boxes.get(item.id);
          item.box = [from[0] + ddx, from[1] + ddy, from[2], from[3]].map((value) => Math.round(value * 10) / 10);
        }
      } else element.box = [x, y, w, h].map((value) => Math.round(value * 10) / 10);
    };
    const up = () => {
      guides = [];
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // a text or a symbol on the map stands where its point is: moved, it takes its point along; a symbol sized stays square
      if (started) for (const item of moving) if (standsOver(item)) { if (item.kind === 'symbol' && handle !== 'move') squared(item); else carryPoint(item); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** The ground under the middle of a label's box becomes its point. */
  function carryPoint(item) {
    const map = mapOf(item);
    const point = map && groundAt(map, [item.box[0] + item.box[2] / 2, item.box[1] + item.box[3] / 2]);
    if (point) item.at = [round(point[0], 6), Math.max(-85, Math.min(85, round(point[1], 6)))];
  }
  /** A symbol sized by a handle: as wide as it was pulled, square, still over its point. */
  function squared(item) {
    const side = round(Math.max(2, item.box[2], item.box[3]), 1);
    item.box = [item.box[0], item.box[1], side, side];
  }

  /** A name of the ground clicked in a framed map, while its menu is open: `{ element, text, at, point, client }`. */
  let nameMenu = $state(null);
  function hideName({ element, text }) {
    const hidden = element.plain?.hidden_names ?? [];
    element.plain = { ...(element.plain ?? {}), hidden_names: hidden.includes(text) ? hidden : [...hidden, text] };
  }

  /** Says, a moment, why the map did not move: the day or step shown holds the framing before it. */
  let held = $state('');
  let heldTimer = null;
  function sayHeld() {
    held = 'This map keeps the framing before it here. Untick “Keep the previous framing” to move it.';
    clearTimeout(heldTimer);
    heldTimer = setTimeout(() => { held = ''; }, 3200);
  }
  const lockedMap = (element) => element.kind === 'map' && !framingFor(element).own && !framingFor(element).first;

  /**
   * Drag one of an element's ground points over its map: `at`, `to`, a zone's corner
   * (`points.N`), a ring's reach (`radius`), a cone's tip (`tip`), or the whole of it
   * (`body`), which moves every point it stands on by the same ground.
   */
  function grabGround(event, element, field) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (field === 'body') pick(element, event.shiftKey);
    else if (!selection.includes(element.id)) pick(element, false);
    if (element.locked) return;
    const map = mapOf(element);
    if (!map) return;
    const screen = [event.clientX, event.clientY];
    const startGround = groundAt(map, toMm(event));
    const before = JSON.parse(JSON.stringify({ at: element.at, to: element.to, points: element.points }));
    let started = false;
    const move = (next) => {
      if (!started && Math.hypot(next.clientX - screen[0], next.clientY - screen[1]) < DRAG_PIXELS) return;
      started = true;
      const point = groundAt(map, toMm(next));
      if (!point) return;
      const fixed = [round(point[0], 6), Math.max(-85, Math.min(85, round(point[1], 6)))];
      if (field === 'body' && startGround) {
        const shift = (p) => (p ? [round(p[0] + point[0] - startGround[0], 6), round(p[1] + point[1] - startGround[1], 6)] : p);
        if (before.at) element.at = shift(before.at);
        if (before.to) element.to = shift(before.to);
        if (before.points?.length) element.points = before.points.map(shift);
        return;
      }
      if (field.startsWith('points.')) {
        const index = Number(field.slice(7));
        element.points = element.points.map((p, i) => (i === index ? fixed : p));
      } else if (field === 'radius') {
        const km = Math.max(0.01, distance(element.at, fixed) / 1000);
        const first = element.radii?.[0] ?? km;
        element.radii = (element.radii?.length ? element.radii : [km]).map((value) => round((value / first) * km, 3));
      } else if (field === 'tip') {
        element.bearing = round(bearingTo(element.at, fixed), 1);
        element.reach = Math.max(0.01, round(distance(element.at, fixed) / 1000, 3));
      } else {
        const was = element[field];
        element[field] = fixed;
        // a label's words follow its point when Shift is held
        if (field === 'at' && element.kind === 'label' && next.shiftKey && was) {
          const a = onPage(element, was);
          const b = onPage(element, fixed);
          if (a && b) element.box = [element.box[0] + b[0] - a[0], element.box[1] + b[1] - a[1], element.box[2], element.box[3]];
        }
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /**
   * The ground each detail shows, outlined on the map it is drawn from, as page points:
   * what a press there picks, and a drag moves.
   */
  const footprints = $derived(spec.elements.filter((item) => item.kind === 'map' && item.of && visible(item) && views[item.id]).flatMap((detail) => {
    const parent = mapOf(detail);
    const live = views[detail.id];
    if (!parent || !visible(parent) || framing === parent.id) return [];
    const ring = corners(live.view, live.frame).map((point) => onMap(parent, point));
    return ring.every(Boolean) ? [{ detail, parent, ring }] : [];
  }));

  /**
   * A drag on a detail's square moves what the detail shows: its middle follows the
   * pointer over the map it is drawn from. A press without a drag picks the detail.
   */
  function grabFootprint(event, detail, parent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pick(detail, event.shiftKey);
    if (detail.locked || event.shiftKey) return;
    const screen = [event.clientX, event.clientY];
    const start = toMm(event);
    const from = { ...framingFor(detail).view };
    const middle = onMap(parent, [from.lon, from.lat]);
    if (!middle) return;
    let started = false;
    const move = (next) => {
      if (!started && Math.hypot(next.clientX - screen[0], next.clientY - screen[1]) < DRAG_PIXELS) return;
      if (!started && lockedMap(detail)) { sayHeld(); up(); return; }
      started = true;
      panning = true;
      const [mx, my] = toMm(next);
      const ground = groundAt(parent, [middle[0] + mx - start[0], middle[1] + my - start[1]]);
      if (ground) onmapview(detail, { ...from, lat: Math.max(-85, Math.min(85, round(ground[1], 6))), lon: round(ground[0], 6) });
    };
    const up = () => {
      panning = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  let draft = $state(null);
  /** A zone being drawn: its corners on the ground, on its map. */
  /** A zone or a line being drawn, point by point: its kind, its map, its points on the ground. */
  let zoneDraft = $state(null);
  $effect(() => { if (placing?.kind !== 'zone' && placing?.kind !== 'line') zoneDraft = null; });
  /** The fewest points a drawn shape closes on. */
  const fewest = (kind) => (kind === 'line' ? 2 : 3);

  /**
   * A press on a map while placing: a label or a picture's point where it is pressed,
   * an arrow or a distance from there to where it is let go, rings round there to
   * where it is let go, a cone from there toward it, a zone corner by corner.
   */
  function place(event, map) {
    if (!placing || event.button !== 0 || map.kind !== 'map') return;
    event.preventDefault();
    event.stopPropagation();
    const start = toMm(event);
    const from = groundAt(map, start);
    if (!from) return;
    const kind = placing.kind;
    if (kind === 'label' || kind === 'callout' || kind === 'symbol' || kind === 'focus') { onplace?.({ map, at: from, page: start }); return; }
    if (kind === 'zone' || kind === 'line') {
      const points = [...(zoneDraft?.map === map.id ? zoneDraft.points : []), from];
      zoneDraft = { kind, map: map.id, points };
      if (event.detail >= 2 && points.length >= fewest(kind)) finishZone();
      return;
    }
    let to = from;
    const move = (next) => {
      to = groundAt(map, toMm(next)) ?? to;
      draft = { kind, map: map.id, from, to };
    };
    const up = () => {
      draft = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (to[0] === from[0] && to[1] === from[1]) return;
      onplace?.({ map, at: from, to, page: start });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function finishZone() {
    if (!zoneDraft || zoneDraft.points.length < fewest(zoneDraft.kind)) return;
    const map = spec.elements.find((item) => item.id === zoneDraft.map);
    const points = zoneDraft.points;
    zoneDraft = null;
    onplace?.({ map, points });
  }

  /** The ground points of a drawn element, on the page in millimetres, for its handles and its hit shape. */
  function shape(element) {
    const map = mapOf(element);
    if (!map) return null;
    const at = (point) => onMap(map, point);
    if (element.kind === 'zone') return { ring: element.points.map(at), handles: element.points.map((p, i) => [`points.${i}`, at(p)]) };
    if (element.kind === 'line') return { path: element.points.map(at), handles: element.points.map((p, i) => [`points.${i}`, at(p)]) };
    if (element.kind === 'ring') {
      const reach = (element.radii?.[0] ?? 1) * 1000;
      const outer = Math.max(...(element.radii?.length ? element.radii : [1])) * 1000;
      return { ring: circle(element.at, outer, 48).map(at), handles: [['at', at(element.at)], ['radius', at(travel(element.at, 90, reach))]] };
    }
    if (element.kind === 'cone') {
      const tip = travel(element.at, element.bearing ?? 0, (element.reach ?? 1) * 1000);
      return { ring: sector(element.at, element.bearing ?? 0, element.spread ?? 60, (element.reach ?? 1) * 1000, 16).map(at),
        handles: [['at', at(element.at)], ['tip', at(tip)]] };
    }
    if (element.kind === 'arrow' || element.kind === 'measure') {
      return { line: [at(element.at), at(element.to)], handles: [['at', at(element.at)], ['to', at(element.to)]] };
    }
    if (element.kind === 'label' || (element.kind === 'image' && element.at)) return { handles: [['at', at(element.at)]] };
    return null;
  }

  // -- the page in the window ---------------------------------------------------------

  /** The wheel zooms the page round the pointer; over a framed map, the map has it. */
  function wheel(event) {
    if (event.target.closest?.('.plate-map.live')) return;
    event.preventDefault();
    const rect = viewportEl.getBoundingClientRect();
    const step = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY;
    camera = zoomPageAt(shown, Math.exp(-Math.max(-300, Math.min(300, step)) * 0.0015), [event.clientX - rect.left, event.clientY - rect.top]);
  }
  // registered by hand: a wheel listener has to be able to stop the page scrolling
  $effect(() => {
    const el = viewportEl;
    if (!el) return;
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  /** The zoom buttons step round the window's middle. */
  function zoomBy(factor) {
    camera = zoomPageAt(shown, factor, [viewportWidth / 2, viewportHeight / 2]);
  }

  /**
   * A press that no element took: a drag moves the page, a plain press lets the
   * picked elements and the framed map go. The middle button drags over anything.
   */
  function pressViewport(event) {
    // the framed map has the left and the middle button: it pans and turns
    if (event.button <= 1 && event.target.closest?.('.plate-map.live, .zoom')) return;
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    const start = [event.clientX, event.clientY];
    const from = { ...shown };
    let moved = false;
    const move = (next) => {
      const dx = next.clientX - start[0];
      const dy = next.clientY - start[1];
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      panning = true;
      camera = { scale: from.scale, x: from.x + dx, y: from.y + dy };
    };
    const up = () => {
      panning = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved && event.button === 0 && !placing) { selection = []; framing = ''; }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function keydown(event) {
    if (event.key === 'Escape' && framing) { framing = ''; event.stopPropagation(); }
    if (zoneDraft && event.key === 'Enter') { event.preventDefault(); finishZone(); }
    if (zoneDraft && event.key === 'Backspace') { event.preventDefault(); zoneDraft = { ...zoneDraft, points: zoneDraft.points.slice(0, -1) }; }
  }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const px = (mm) => `${mm * PX_PER_MM}px`;
  const visible = (element) => !element.hidden && (ghosts || shownOn(element, at, stepPlace));
  const polygon = (points) => points.filter(Boolean).map(([x, y]) => `${x},${y}`).join(' ');
  /** The draft of what is being placed, as page points. */
  const draftShape = $derived.by(() => {
    if (!draft) return null;
    const map = spec.elements.find((item) => item.id === draft.map);
    const a = onMap(map, draft.from);
    const b = onMap(map, draft.to);
    if (!a || !b) return null;
    if (draft.kind === 'ring') return { ring: circle(draft.from, distance(draft.from, draft.to), 48).map((p) => onMap(map, p)) };
    if (draft.kind === 'cone') return { ring: sector(draft.from, bearingTo(draft.from, draft.to), 60, distance(draft.from, draft.to), 16).map((p) => onMap(map, p)) };
    return { line: [a, b] };
  });
  const zonePoints = $derived(zoneDraft ? zoneDraft.points.map((p) => onMap(spec.elements.find((item) => item.id === zoneDraft.map), p)) : []);
  const HINTS = {
    label: 'Press the map where the label points.',
    callout: 'Press the map where the picture points.',
    symbol: 'Press the map where each symbol goes.',
    arrow: 'Drag on the map from where the arrow starts to where it points.',
    measure: 'Drag on the map from one end of the distance to the other.',
    ring: 'Press the centre, drag out to the first ring.',
    cone: 'Press where the view is from, drag toward what it sees.',
    zone: 'Click each corner. Double-click or Enter closes the zone, Backspace takes a corner back.',
    line: 'Click each point of the line. Double-click or Enter ends it, Backspace takes a point back.',
    focus: 'Press the country to light.',
  };
</script>

<svelte:window onkeydown={keydown} />

<div class="viewport" data-guide="plate.page" class:panning bind:this={viewportEl} bind:clientWidth={viewportWidth} bind:clientHeight={viewportHeight}
  onpointerdown={pressViewport} onmousedown={(event) => { if (event.button === 1) event.preventDefault(); }} oncontextmenu={context} role="presentation">
  <div class="page" bind:this={pageEl} style:width="{width}px" style:height="{height}px"
    style:transform="translate({shown.x}px, {shown.y}px) scale({scale})"
    style:background={paperStyle} role="presentation">
    <!-- a map is built once: another ground, a date or an overlay is laid on it -->
    {#each maps as element (element.id)}
      <PlateMap {element} view={viewOf(element)} {time} {caseId} {rows} {providers} {relief} font={spec.theme.font}
        interactive={framing === element.id} away={!shownOn(element, at, stepPlace)} glide={playing ? glide : 0}
        onview={(view, frame, placer) => reported(element, view, frame, placer)}
        onname={(hit) => (nameMenu = { element, ...hit })}
        onready={(handle) => onmap?.(element.id, handle)} />
    {/each}
    {#each spec.elements.filter((item) => item.kind === 'video' && !item.hidden && shownOn(item, at, stepPlace)) as element (element.id)}
      <PlateVideo {element} {caseId} running={playing} {speed} />
    {/each}
    <canvas class="decor" bind:this={canvas} width={Math.round(width * density)} height={Math.round(height * density)}
      style:width="{width}px" style:height="{height}px"></canvas>
    {#if grainStrength(spec.page?.grain) > 0 && grain}
      <div class="grain" style:background-image="url({grain})" style:background-size="{GRAIN_MM * PX_PER_MM}px"
        style:opacity={grainStrength(spec.page.grain)}></div>
    {/if}

    <div class="hand" class:placing={!!placing} class:framing={!!framing}>
      {#each spec.elements as element (element.id)}
        {#if visible(element) && framing !== element.id && !ON_THE_GROUND.includes(element.kind)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="hit" class:selected={selection.includes(element.id)} class:map={element.kind === 'map'} class:locked={element.locked}
            class:placing={!!placing && element.kind === 'map'} class:ghost={!shownOn(element, at, stepPlace)}
            style:left={px(element.box[0])} style:top={px(element.box[1])} style:width={px(element.box[2])} style:height={px(element.box[3])}
            data-element={element.id}
            onpointerdown={(event) => placing && element.kind === 'map' ? place(event, element)
              : grab(event, element)}
            ondblclick={() => { if (element.kind !== 'map') return; if (lockedMap(element)) sayHeld(); else framing = element.id; }}></div>
        {/if}
      {/each}

      <!-- what stands on the ground is picked by its own drawing, never by a box round it -->
      <svg class="ground-hits" viewBox="0 0 {size.width} {size.height}" preserveAspectRatio="none">
        <!-- a detail's square, under what stands on the ground: dragged, it moves what the detail shows -->
        {#each footprints as { detail, parent, ring } (detail.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <polygon class="hit-area footprint" class:selected={selection.includes(detail.id)} class:locked={detail.locked} data-footprint={detail.id}
            points={polygon(ring)} stroke-width={Math.max(1.5, 8 / scale / PX_PER_MM)}
            onpointerdown={(event) => grabFootprint(event, detail, parent)}><title>{detail.locked ? `${detail.name || 'Detail'} is locked` : `Drag to move what ${detail.name || 'the detail'} shows`}</title></polygon>
        {/each}
        <!-- a map being framed takes every press on it, its zones' and arrows' included -->
        {#each spec.elements.filter((item) => ON_THE_GROUND.includes(item.kind) && !BOXED_ON_THE_GROUND.includes(item.kind) && visible(item) && framing !== item.of) as element (element.id)}
          {@const drawn = shape(element)}
          {#if drawn?.path}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <polyline class="hit-line" class:selected={selection.includes(element.id)} data-element={element.id} points={polygon(drawn.path)}
              stroke-width={Math.max(2, 9 / scale / PX_PER_MM)} onpointerdown={(event) => grabGround(event, element, 'body')}></polyline>
          {:else if drawn?.line}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <line class="hit-line" class:selected={selection.includes(element.id)} data-element={element.id} x1={drawn.line[0]?.[0]} y1={drawn.line[0]?.[1]}
              x2={drawn.line[1]?.[0]} y2={drawn.line[1]?.[1]} stroke-width={Math.max(2, 9 / scale / PX_PER_MM)}
              onpointerdown={(event) => grabGround(event, element, 'body')}></line>
          {:else if drawn?.ring}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <polygon class="hit-area" class:selected={selection.includes(element.id)} class:outline={element.kind === 'ring'} data-element={element.id}
              points={polygon(drawn.ring)} stroke-width={Math.max(1.5, 8 / scale / PX_PER_MM)}
              onpointerdown={(event) => grabGround(event, element, 'body')}></polygon>
          {/if}
        {/each}
        {#if draftShape?.line}
          <line class="draft" x1={draftShape.line[0][0]} y1={draftShape.line[0][1]} x2={draftShape.line[1][0]} y2={draftShape.line[1][1]}></line>
        {:else if draftShape?.ring}
          <polygon class="draft" points={polygon(draftShape.ring)}></polygon>
        {/if}
        {#if zonePoints.length}
          <polyline class="draft" points={polygon(zonePoints)}></polyline>
          {#each zonePoints.filter(Boolean) as [x, y], index (index)}<circle class="draft-dot" cx={x} cy={y} r={1 / scale}></circle>{/each}
        {/if}
      </svg>

      {#each spec.elements.filter((item) => BOXED_ON_THE_GROUND.includes(item.kind) && visible(item) && !offMap(item)) as element (element.id)}
        {#if framing !== element.of}
          {@const box = shownBox(element)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="hit" class:selected={selection.includes(element.id)} class:locked={element.locked} class:ghost={!shownOn(element, at, stepPlace)}
            style:left={px(box[0])} style:top={px(box[1])} style:width={px(box[2])} style:height={px(box[3])}
            data-element={element.id} onpointerdown={(event) => grab(event, element)}></div>
        {/if}
      {/each}

      {#if selection.length === 1}
        {#each spec.elements.filter((item) => item.id === selected && framing !== item.id) as element (element.id)}
          {#if !ON_THE_GROUND.includes(element.kind) || BOXED_ON_THE_GROUND.includes(element.kind)}
            {#if !element.locked}
              {@const box = shownBox(element)}
              {#each HANDLES as handle (handle)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="handle {handle}" style:left={px(box[0] + (handle.includes('w') ? 0 : handle.includes('e') ? box[2] : box[2] / 2))}
                  style:top={px(box[1] + (handle.includes('n') ? 0 : handle.includes('s') ? box[3] : box[3] / 2))}
                  style:transform="translate(-50%, -50%) scale({1 / scale})"
                  onpointerdown={(event) => grab(event, element, handle)}></div>
              {/each}
            {/if}
          {/if}
        {/each}
      {/if}
      {#each spec.elements.filter((item) => selection.includes(item.id) && !item.locked) as element (element.id)}
        {#each shape(element)?.handles ?? [] as [field, point] (field)}
          {#if point}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="ground" class:corner={field.startsWith('points.')} title="Drag to move it on the ground"
              style:left={px(point[0])} style:top={px(point[1])}
              style:transform="translate(-50%, -50%) scale({1 / scale})"
              onpointerdown={(event) => grabGround(event, element, field)}></div>
          {/if}
        {/each}
      {/each}

      {#each spec.elements.filter((item) => (item.id === selected || item.id === framing) && (item.kind === 'map' || item.kind === 'inset')) as element (element.id)}
        <!-- the picked map's own bar, at the size of the window rather than of the page -->
        {@const framed = element.kind === 'map' ? framingFor(element) : null}
        <div class="bar" style:left={px(element.box[0])} style:top={px(element.box[1])} style:transform="scale({1 / scale}) translate(6px, 6px)">
          <PlateMapBar {element} {grounds} framing={framing === element.id} view={framed?.view ?? element.view}
            keep={framed && !framed.first ? !framed.own : null} onview={(next) => onmapview(element, next)}
            onkeep={(keep) => onkeep?.(element, keep)}
            onframe={() => { if (lockedMap(element)) { sayHeld(); return; } framing = framing === element.id ? '' : element.id; selection = [element.id]; }} />
        </div>
      {/each}

      <!-- what runs past its box says so where it is, not only in the inspector -->
      {#each spec.elements.filter((item) => overflow.has(item.id) && visible(item) && !ON_THE_GROUND.includes(item.kind)) as element (element.id)}
        <button type="button" class="past" style:left={px(element.box[0] + element.box[2])} style:top={px(element.box[1])}
          style:transform="translate(-100%, 0) scale({1 / scale})" style:transform-origin="100% 0"
          title={['legend', 'table', 'key'].includes(element.kind) ? 'Its rows run past the box. Pick it to fit the box' : 'Its words run past the box. Pick it to fit the box'}
          aria-label="Runs past its box" onpointerdown={(event) => { event.stopPropagation(); pick(element, false); }}>!</button>
      {/each}

      {#each guides as guide, index (index)}
        <div class="guide {guide.axis}" style:left={guide.axis === 'x' ? px(guide.at) : 0} style:top={guide.axis === 'y' ? px(guide.at) : 0}></div>
      {/each}
    </div>
  </div>
  <div class="zoom" role="group" aria-label="Page zoom">
    <button type="button" aria-label="Zoom out" title="Zoom out" onclick={() => zoomBy(1 / 1.25)}><Icon name="minus" size={12} /></button>
    <span class="zoom-value">{Math.round(scale * 100)}%</span>
    <button type="button" aria-label="Zoom in" title="Zoom in" onclick={() => zoomBy(1.25)}><Icon name="plus" size={12} /></button>
    <button type="button" class="fit" disabled={!camera} title="Fit the page to the window" onclick={() => (camera = null)}>Fit</button>
  </div>
  {#if held}<p class="tip" role="status">{held}</p>
  {:else if framing}<p class="tip">Drag and scroll to frame the map, Shift-drag or double-click and hold to turn it. Esc when done.</p>
  {:else if placing}<p class="tip">{HINTS[placing.kind] ?? ''} Esc to stop.</p>{/if}
</div>

{#if nameMenu}
  <FloatingMenu at={nameMenu.client} width={240} label="Name of the ground" onclose={() => (nameMenu = null)}>
    <div class="fm-head">{nameMenu.text}</div>
    <button type="button" class="fm-item" onclick={() => { const hit = nameMenu; nameMenu = null; hideName(hit); }}>
      <Icon name="eyeOff" size={14} /><span class="fm-grow">Hide it on this map</span></button>
    {#if onnamelabel}
      <button type="button" class="fm-item" title="Hides this name on the ground and makes it a plate label you can move and restyle"
        onclick={() => { const hit = nameMenu; nameMenu = null; hideName(hit);
          onnamelabel(hit.element, hit.text, hit.at, [hit.element.box[0] + hit.point[0] / PX_PER_MM, hit.element.box[1] + hit.point[1] / PX_PER_MM]); }}>
        <Icon name="text" size={14} /><span class="fm-grow">Make it a label to move</span></button>
    {/if}
  </FloatingMenu>
{/if}

<style>
  .viewport { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-0, #0d0f12); }
  .viewport.panning, .viewport.panning * { cursor: grabbing !important; }
  .page { position: absolute; left: 0; top: 0; transform-origin: 0 0; box-shadow: 0 6px 30px rgba(0, 0, 0, .45); overflow: hidden; }
  .decor { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 2; }
  .hand { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
  .hit { position: absolute; pointer-events: auto; cursor: move; border-radius: 1px; }
  .grain { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: multiply; background-repeat: repeat; }
  .hit:hover { outline: 1px dashed rgba(64, 132, 255, .7); }
  .hit.selected { outline: 1.5px solid #3b82f6; }
  .hit.ghost { outline: 1px dotted rgba(64, 132, 255, .45); }
  .hit.map { box-shadow: inset 0 0 0 10px transparent; }
  .hit.map:hover { box-shadow: inset 0 0 0 3px rgba(64, 132, 255, .25); }
  .hit.locked { cursor: default; }
  .hit.placing { cursor: crosshair; }
  /* while something is being placed, a press goes through what stands over a map to the map */
  .hand.placing .hit:not(.map), .hand.placing .hit-line, .hand.placing .hit-area, .hand.placing .handle, .hand.placing .ground { pointer-events: none; }
  /* a map in the hand takes every press on it, a map under it included; a press beside it lets it go */
  .hand.framing .hit, .hand.framing .hit-line, .hand.framing .hit-area { pointer-events: none; }
  .ground-hits { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .hit-line { fill: none; stroke: transparent; pointer-events: stroke; cursor: move; }
  .hit-line.selected { stroke: rgba(59, 130, 246, .35); }
  .hit-area { fill: transparent; stroke: transparent; pointer-events: visiblePainted; cursor: move; }
  .hit-area.outline { fill: none; pointer-events: stroke; }
  .hit-area.selected { stroke: rgba(59, 130, 246, .6); stroke-dasharray: 2 1; }
  .hit-area.footprint:hover { fill: rgba(59, 130, 246, .08); stroke: rgba(59, 130, 246, .7); }
  .hit-area.footprint.locked { cursor: default; }
  .draft { fill: rgba(245, 158, 11, .12); stroke: #f59e0b; stroke-width: .6; stroke-dasharray: 2 1.2; }
  line.draft, polyline.draft { fill: none; }
  .draft-dot { fill: #f59e0b; }
  .handle { position: absolute; width: 9px; height: 9px; border: 1.5px solid #3b82f6; background: #fff; border-radius: 2px;
    pointer-events: auto; z-index: 2; }
  .handle.nw, .handle.se { cursor: nwse-resize; }
  .handle.ne, .handle.sw { cursor: nesw-resize; }
  .handle.n, .handle.s { cursor: ns-resize; }
  .handle.e, .handle.w { cursor: ew-resize; }
  .ground { position: absolute; width: 12px; height: 12px; border: 2px solid #fff; background: #f59e0b; border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); pointer-events: auto; cursor: grab; z-index: 3; }
  .ground.corner { width: 10px; height: 10px; background: #3b82f6; }
  .bar { position: absolute; z-index: 5; transform-origin: 0 0; pointer-events: auto; }
  .guide { position: absolute; background: #ec4899; pointer-events: none; }
  .past { position: absolute; z-index: 4; display: grid; place-items: center; width: 16px; height: 16px; margin: 0; padding: 0; border: 0;
    border-radius: 0 0 0 4px; background: #d97706; color: #fff; font-size: 11px; font-weight: 800; line-height: 1; pointer-events: auto; cursor: pointer; }
  .guide.x { top: 0; bottom: 0; width: 1px; }
  .guide.y { left: 0; right: 0; height: 1px; }
  .zoom { position: absolute; right: 12px; bottom: 12px; z-index: 6; display: flex; align-items: center; gap: 2px; padding: 2px;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); }
  .zoom button { display: grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border: 0; border-radius: var(--r-sm);
    background: none; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .zoom button:hover:not(:disabled) { background: var(--bg-2); color: var(--text-1); }
  .zoom button:disabled { opacity: .45; cursor: default; }
  .zoom-value { min-width: 40px; text-align: center; color: var(--text-2); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
  /* the pill saying what a press does now; not `.framing`, which the hand layer takes while a map is framed */
  .tip { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); margin: 0; padding: 4px 12px; border-radius: 999px;
    background: rgba(0, 0, 0, .72); color: #fff; font-size: 12px; pointer-events: none; max-width: 80%; text-align: center; }
</style>
