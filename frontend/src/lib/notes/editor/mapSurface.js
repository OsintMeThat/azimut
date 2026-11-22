/**
 * The map on its card, drawn on: its ground and the drawing the page shows over it (the
 * engine's own SVG, `POST /notes/maps/describe`), and over both the shapes the card asks
 * for. Nothing here is fetched: the ground is the picture filed in the case.
 *
 * One tool at a time is armed: a rectangle dragged (the map's frame, a step's), a point
 * pressed, a line or an area put down corner by corner (a double press, Enter or the
 * first corner again ends it, Backspace takes the last corner back, Escape gives up).
 * Each answers in longitude and latitude, as the block and the layer keep them.
 *
 * While the card's Draw tab is open the map moves (`navigate(true)`, its maths in
 * `editor/mapView.js`): the wheel, a pinch, + and − zoom it about the pointer, a drag moves
 * it, 0 or *Whole map* shows its frame again. It is drawn on the ground and the close-ups the
 * block files (`detail:`), each from its own pixels, a close-up showing once the ground under
 * it would blur, and plain where the case holds no picture: still nothing is fetched. The
 * marks and their names keep their size as it zooms, and what lies outside the frame the page
 * shows is dimmed. With a tool armed a press still puts a corner down, and Space+drag or the
 * middle button moves the map. Leaving Draw shows the block's own view again; moving it never
 * writes a line.
 */
import { button } from './gridMenu.js';
import { FRAME, mercX, mercY, unmercX, unmercY } from './mapText.js';
import {
  DEEPEST, LEAST, MOST, between, clampView, fitScale, isWhole, panBy, rulerOf, toFrame, wheelFactor, wholeView, windowOf, zoomAbout,
} from './mapView.js';

const SVG = 'http://www.w3.org/2000/svg';

function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** What each tool asks of the analyst, said under the map while it is armed. */
export const TOOL_HINTS = {
  frame: 'Drag a rectangle over the map: it shows that part. Esc cancels.',
  step: 'Drag a rectangle over what this step shows. Esc cancels.',
  within: 'Drag a rectangle over the area whose marks make the steps. Esc cancels.',
  point: 'Press where the point goes. Esc cancels.',
  line: 'Press each corner of the line, then press the last one again or Enter. Backspace takes a corner back.',
  area: 'Press each corner of the area, then the first one again or Enter. Backspace takes a corner back.',
  highlight: 'Press each corner round the area to highlight, then the first one again or Enter.',
};
/** The tools that drag a rectangle: the map's frame, a step's, the area a layer's steps come from. */
const RECTANGLES = new Set(['frame', 'step', 'within']);
/** What the map says under it while Draw is open and no tool is in hand. */
export const NAV_HINT = 'Scroll or pinch to zoom, drag to move the map, 0 for the whole map.';
/** What a tool's words add while the map can move. */
export const NAV_TOOL_HINT = 'Space+drag or the middle button moves the map.';

/** Longitude and latitude to the map's units, and back, for `bounds` drawn `size` units across. */
export function projection(bounds, size) {
  const [west, south, east, north] = bounds;
  const [width, height] = size;
  const x0 = mercX(west);
  const y0 = mercY(north);
  const spanX = Math.max(mercX(east) - x0, 1e-12);
  const spanY = Math.max(mercY(south) - y0, 1e-12);
  return {
    width,
    height,
    to: ([lon, lat]) => [((mercX(lon) - x0) / spanX) * width, ((mercY(lat) - y0) / spanY) * height],
    from: ([x, y]) => [unmercX(x0 + (x / width) * spanX), unmercY(y0 + (y / height) * spanY)],
  };
}

/** A rectangle's two corners as `[west, south, east, north]`. */
export function boxOf(a, b) {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** Whether `inner` (`[w, s, e, n]`) lies inside `outer`. */
const inside = (inner, outer) => inner[0] >= outer[0] - 1e-9 && inner[1] >= outer[1] - 1e-9 && inner[2] <= outer[2] + 1e-9 && inner[3] <= outer[3] + 1e-9;

/** A press that writes, or a field: where Space and the zoom keys stay the analyst's. */
const typing = (target) => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));

/**
 * The map drawn in `stage` from `described` (the card's answer: its bounds, frame, ground, its
 * close-ups and SVG), with `groundUrl` the ground's address and `pictureUrl(path)` a close-up's.
 * Answers `{ arm(tool, done), disarm, show(shapes), armed, project, navigate(on), navigating,
 * view, whole, seen(), refit(), destroy }`: `done(answer)` gets the rectangle `[w, s, e, n]`, the point
 * `[lon, lat]` or the corners `[[lon, lat], …]`; `show` lays shapes over it, each `{ kind:
 * 'box' | 'area' | 'line' | 'point', coords, colour, dashed, label }`. `navigable` starts it
 * moving, on `view` (one `onview(view, { whole })` handed out before), and `onview` hears it
 * each time it settles.
 */
export function mapSurface(stage, described, {
  groundUrl = '', pictureUrl = () => '', onarmed = () => {}, navigable = false, view: kept = null, onview = () => {},
} = {}) {
  stage.replaceChildren();
  stage.classList.remove('cm-map-nav', 'cm-map-panning', 'cm-map-space');
  const size = described.frame ?? [FRAME, FRAME * 0.62];
  const project = projection(described.bounds, size);
  stage.style.setProperty('--r', String(size[0] / size[1]));
  const world = document.createElement('div');
  world.className = 'cm-map-world';
  stage.dataset.base = described.base || 'satellite';

  /** Each picture laid on the map, where it stands in the map's units: the ground, then its close-ups. */
  const pictures = [];
  /** Lay a picture where it stands in `window_` (`[x, y, width, height]` of the map's units the stage shows). */
  function place(one, [vx, vy, vw, vh]) {
    const [left, top, right, bottom] = one.box;
    Object.assign(one.node.style, {
      left: `${((left - vx) / vw) * 100}%`, top: `${((top - vy) / vh) * 100}%`,
      width: `${((right - left) / vw) * 100}%`, height: `${((bottom - top) / vh) * 100}%`,
    });
  }
  function lay(url, bounds, className) {
    const node = document.createElement('img');
    node.className = className;
    node.alt = '';
    node.decoding = 'async';
    node.draggable = false;
    node.src = url;
    const [west, south, east, north] = bounds;
    const [left, top] = project.to([west, north]);
    const [right, bottom] = project.to([east, south]);
    const one = { node, bounds, box: [left, top, right, bottom] };
    place(one, [0, 0, size[0], size[1]]);
    world.append(node);
    pictures.push(one);
    return one;
  }
  const ground = described.ground && groundUrl ? lay(groundUrl, described.ground.bounds, 'cm-map-ground') : null;
  if (!ground) stage.classList.add('cm-map-plain-stage');
  stage.append(world);
  const drawing = document.createElement('div');
  drawing.className = 'cm-map-drawing';
  // the engine's own drawing, its words escaped there
  drawing.innerHTML = described.svg ?? '';
  stage.append(drawing);
  const art = drawing.querySelector('svg');
  const drawnBox = art?.getAttribute('viewBox') ?? null;
  const over = svgNode('svg', { class: 'cm-map-over', viewBox: `0 0 ${size[0]} ${size[1]}`, preserveAspectRatio: 'none' });
  const edge = svgNode('g', { class: 'cm-map-edge' });
  const shown = svgNode('g', { class: 'cm-map-shown' });
  const working = svgNode('g', { class: 'cm-map-working' });
  over.append(edge, shown, working);
  stage.append(over);
  const unit = size[0] / 900;

  let tool = null;
  let done = null;
  let corners = [];
  let start = null;
  let pointer = null;
  /** Whether the map moves, where it looks, and how much larger in its units a mark is drawn to keep its size. */
  let navigating = false;
  let view = wholeView(size);
  let ink = 1;
  let most = MOST;
  const limits = () => ({ least: LEAST, most });

  /** The stage's size in pixels, read off the layer that takes the presses. */
  function stageSize() {
    const box = over.getBoundingClientRect();
    return [box.width || stage.clientWidth || size[0], box.height || stage.clientHeight || size[1]];
  }
  /** The part of the map's units the stage shows. */
  const shownWindow = () => (navigating ? windowOf(view, size, stageSize()) : [0, 0, size[0], size[1]]);

  const at = (event) => {
    const box = over.getBoundingClientRect();
    if (navigating) {
      const [width, height] = stageSize();
      return toFrame(view, size, [width, height], [event.clientX - box.left, event.clientY - box.top]);
    }
    const x = ((event.clientX - box.left) / Math.max(box.width, 1)) * size[0];
    const y = ((event.clientY - box.top) / Math.max(box.height, 1)) * size[1];
    return [Math.max(0, Math.min(size[0], x)), Math.max(0, Math.min(size[1], y))];
  };

  function paintWorking() {
    working.replaceChildren();
    if (!tool) return;
    if (RECTANGLES.has(tool) && start && pointer) {
      const [x0, y0, x1, y1] = boxOf(start, pointer);
      working.append(svgNode('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'cm-map-box cm-map-box-new', 'stroke-width': 2 * unit }));
      return;
    }
    if (!corners.length) return;
    const points = [...corners, ...(pointer ? [pointer] : [])].map((point) => point.join(',')).join(' ');
    const closed = tool === 'area' || tool === 'highlight';
    working.append(svgNode(closed && corners.length > 1 ? 'polygon' : 'polyline', { points, class: `cm-map-path${closed ? ' cm-map-path-area' : ''}`, 'stroke-width': 2.4 * unit * ink }));
    corners.forEach((point, index) => working.append(svgNode('circle', { cx: point[0], cy: point[1], r: (index === 0 && closed ? 6 : 4) * unit * ink, class: 'cm-map-corner' })));
  }

  function finish() {
    const answer = corners.map((point) => project.from(point));
    const kept_ = done;
    const was = tool;
    disarm();
    if (was === 'line' && answer.length >= 2) kept_?.(answer);
    else if ((was === 'area' || was === 'highlight') && answer.length >= 3) kept_?.(answer);
  }

  // -- moving the map --

  /** The engine's marks, their names and leaders as it placed them, read once, so a zoom sizes them again from there. */
  let marks = null;
  function marksOf() {
    if (marks || !art) return marks;
    const number = (node, name) => Number(node?.getAttribute(name));
    const placed = [...art.querySelectorAll('.az-points > [transform]')].map((node) => {
      const found = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)\s*scale\(\s*([-\d.e]+)\s*\)/.exec(node.getAttribute('transform') ?? '');
      if (!found) return null;
      const spot = [Number(node.dataset.x ?? found[1]), Number(node.dataset.y ?? found[2])];
      return { node, transform: node.getAttribute('transform'), at: [Number(found[1]), Number(found[2])], spot, scale: Number(found[3]) };
    }).filter(Boolean);
    const byId = new Map(placed.map((one) => [one.node.dataset.id, one]));
    const labels = [...art.querySelectorAll('.az-labels text')].map((node) => ({
      node, x: number(node, 'x'), y: number(node, 'y'), font: node.getAttribute('font-size'), size: number(node, 'font-size'),
      centred: node.hasAttribute('data-y'), from: number(node, 'data-y'), mark: byId.get(node.dataset.for),
    }));
    const leaders = [...art.querySelectorAll('.az-leader')].map((node) => {
      const line = node.querySelector('line');
      const dot = node.querySelector('circle');
      return { line, dot, x2: line?.getAttribute('x2'), y2: line?.getAttribute('y2'), r: number(dot, 'r'), mark: byId.get(node.dataset.for) };
    });
    const patterns = [...art.querySelectorAll('pattern')].map((node) => ({ node, turn: node.getAttribute('patternTransform') ?? '' }));
    marks = { placed, labels, leaders, patterns };
    return marks;
  }

  /** The marks drawn `scale` times as large in the map's units: as large on the stage as the page draws them. */
  function sizeMarks(scale) {
    const read = marksOf();
    if (!read) return;
    const plain = scale === 1;
    const moved = new Map();
    for (const one of read.placed) {
      // a mark spread round a place it shares stays as far from it on the stage
      const x = one.spot[0] + (one.at[0] - one.spot[0]) * scale;
      const y = one.spot[1] + (one.at[1] - one.spot[1]) * scale;
      moved.set(one, [x, y]);
      one.node.setAttribute('transform', plain ? one.transform : `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(one.scale * scale).toFixed(5)})`);
    }
    for (const label of read.labels) {
      const { node } = label;
      node.setAttribute('font-size', plain ? label.font : (label.size * scale).toFixed(3));
      node.style.strokeWidth = plain ? '' : `${(4 * scale).toFixed(3)}px`;
      if (label.centred) {
        node.setAttribute('y', plain ? String(label.y) : (label.from + (label.y - label.from) * scale).toFixed(2));
        continue;
      }
      const mark = label.mark && moved.get(label.mark);
      if (!mark) continue;
      node.setAttribute('x', plain ? String(label.x) : (mark[0] + (label.x - label.mark.at[0]) * scale).toFixed(2));
      node.setAttribute('y', plain ? String(label.y) : (mark[1] + (label.y - label.mark.at[1]) * scale).toFixed(2));
    }
    for (const leader of read.leaders) {
      const mark = leader.mark && moved.get(leader.mark);
      if (leader.line && mark) {
        leader.line.setAttribute('x2', plain ? leader.x2 : mark[0].toFixed(2));
        leader.line.setAttribute('y2', plain ? leader.y2 : mark[1].toFixed(2));
      }
      if (leader.dot && leader.r) leader.dot.setAttribute('r', (leader.r * scale).toFixed(3));
    }
    for (const pattern of read.patterns) {
      if (plain) pattern.node.setAttribute('patternTransform', pattern.turn);
      else pattern.node.setAttribute('patternTransform', `${pattern.turn} scale(${scale.toFixed(4)})`.trim());
    }
  }

  /** The close-ups the block files, laid once the map first moves: the widest first, the sharpest on top. */
  let closeUps = null;
  function layCloseUps() {
    if (closeUps) return;
    const area = (bounds) => (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
    closeUps = (described.details ?? []).filter((one) => one?.path && one.bounds?.length === 4)
      .sort((a, b) => area(b.bounds) - area(a.bounds))
      .map((one) => {
        const laid = lay(pictureUrl(one.path), one.bounds, 'cm-map-detail');
        laid.beyond = !described.ground?.bounds || !inside(one.bounds, described.ground.bounds);
        laid.node.addEventListener('load', () => navigating && paint(), { once: true });
        return laid;
      });
    ground?.node.addEventListener('load', () => navigating && paint(), { once: true });
  }

  /**
   * Each close-up over the ground where the ground would blur and the close-up is sharper; one
   * that reaches past the ground lies under it the rest of the time, so it fills only where the
   * ground does not reach and the whole map shows no patchwork.
   */
  function sharpen([width], [, , across]) {
    if (!closeUps?.length) return;
    const crisp = (one) => (one.node.naturalWidth || 0) / Math.max(one.box[2] - one.box[0], 1e-9);
    const groundCrisp = ground ? crisp(ground) : 0;
    // the ground's own pixels to each of the screen's: below about one it blurs
    const groundShown = ground ? (ground.node.naturalWidth || 0) / (((ground.box[2] - ground.box[0]) / across) * width * (globalThis.devicePixelRatio || 1)) : 0;
    const blurred = !ground || groundShown < 1.1;
    for (const one of closeUps) {
      const over = navigating && blurred && (!one.node.naturalWidth || crisp(one) > groundCrisp * 1.05);
      one.node.classList.toggle('cm-map-detail-on', over || (navigating && one.beyond));
      one.node.classList.toggle('cm-map-detail-over', over);
    }
  }

  /** As deep as the sharpest picture stays worth looking at, three of the screen's pixels to each of its own. */
  function deepest(stageNow) {
    const scale = fitScale(size, stageNow);
    let sharpest = 0;
    for (const one of pictures) {
      const across = (one.box[2] - one.box[0]) * scale;
      if (one.node.naturalWidth && across > 0) sharpest = Math.max(sharpest, one.node.naturalWidth / across);
    }
    const deep = Math.min(DEEPEST, Math.max(MOST, sharpest * 3));
    // a picture still on its way may go deeper: the view kept through a redraw stays as close till it is read
    return pictures.some((one) => !one.node.complete) ? Math.max(deep, Math.min(DEEPEST, view.k)) : deep;
  }

  /** What lies outside the frame the page shows, dimmed, and the frame's edge, while the map shows past it. */
  function edges([vx, vy, vw, vh]) {
    const past = navigating && (vx < -1e-6 || vy < -1e-6 || vx + vw > size[0] + 1e-6 || vy + vh > size[1] + 1e-6);
    if (!past) {
      edge.replaceChildren();
      return;
    }
    edge.replaceChildren(
      svgNode('path', { class: 'cm-map-outside', 'fill-rule': 'evenodd', d: `M${vx} ${vy}h${vw}v${vh}h${-vw}Z M0 0V${size[1]}H${size[0]}V0Z` }),
      svgNode('rect', { class: 'cm-map-rim', x: 0, y: 0, width: size[0], height: size[1] }),
    );
  }

  /** The scale, a round distance about a hundred pixels long at the map's middle. */
  function measureRuler(stageNow) {
    if (!controls) return;
    const [west, , east] = described.bounds;
    const lat = project.from([view.cx, view.cy])[1];
    const metres = (40075016.7 * Math.cos((lat * Math.PI) / 180) * (mercX(east) - mercX(west))) / size[0];
    const ruler = rulerOf(metres / (fitScale(size, stageNow) * view.k));
    controls.ruler.hidden = !ruler;
    if (ruler) {
      controls.ruler.style.width = `${ruler.px}px`;
      controls.ruler.textContent = ruler.words;
    }
  }

  function paint() {
    const stageNow = stageSize();
    if (navigating) {
      most = deepest(stageNow);
      view = clampView(view, size, limits());
    }
    const window_ = shownWindow();
    const box = window_.map((value) => Number(value.toFixed(3))).join(' ');
    if (art) art.setAttribute('viewBox', navigating ? box : drawnBox ?? box);
    over.setAttribute('viewBox', navigating ? box : `0 0 ${size[0]} ${size[1]}`);
    for (const one of pictures) place(one, window_);
    ink = navigating ? stageNow[0] / size[0] / (fitScale(size, stageNow) * view.k) : 1;
    if (marks || navigating) sizeMarks(ink);
    sharpen(stageNow, window_);
    edges(window_);
    if (controls) {
      measureRuler(stageNow);
      controls.zoomIn.disabled = view.k >= most - 1e-3;
      controls.zoomOut.disabled = view.k <= LEAST + 1e-3;
      controls.whole.disabled = isWhole(view, size);
    }
    stage.dataset.zoom = navigating ? String(Math.round(view.k * 100) / 100) : '';
    paintWorking();
  }

  let flight = 0;
  /** Where a flight under way lands, so a second press of + goes on from there. */
  let heading = null;
  /** Stop a flight where it is. */
  function land() {
    globalThis.cancelAnimationFrame?.(flight);
    heading = null;
  }
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const told = () => onview(view, { whole: isWhole(view, size) });
  /** Move to `target`, eased over `ms` (none when the system asks for less motion), and say where it settled. */
  function moveTo(target, ms = 0) {
    if (!navigating) return;
    land();
    const to = clampView(target, size, limits());
    if (!ms || reduced() || typeof requestAnimationFrame !== 'function') {
      view = to;
      paint();
      told();
      return;
    }
    const from = view;
    const began = performance.now();
    heading = to;
    const frame = (now) => {
      const t = Math.min(1, (now - began) / ms);
      view = between(from, to, 1 - (1 - t) ** 3);
      paint();
      if (t < 1) flight = requestAnimationFrame(frame);
      else {
        heading = null;
        told();
      }
    };
    flight = requestAnimationFrame(frame);
  }
  const zoomBy = (factor, point = null, ms = 220) => moveTo(zoomAbout(heading ?? view, factor, size, stageSize(), point, limits()), ms);
  const toWhole = (ms = 260) => moveTo(wholeView(size), ms);

  /** The zoom buttons and the scale on the map, while it moves. */
  let controls = null;
  function makeControls() {
    const bar = document.createElement('div');
    bar.className = 'cm-map-zoom cm-map-ui';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Move the map');
    const press = (className, options, act) => {
      const node = button(`cm-map-zoom-btn ${className}`, options);
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        act();
      });
      bar.append(node);
      return node;
    };
    const zoomIn = press('cm-map-zoom-in', { label: 'Zoom in', iconName: 'plus', alone: true, title: 'Zoom in (+)' }, () => zoomBy(2));
    const zoomOut = press('cm-map-zoom-out', { label: 'Zoom out', iconName: 'minus', alone: true, title: 'Zoom out (−)' }, () => zoomBy(0.5));
    // the corners mean the whole screen (`MapEditing`'s button); the map's own frame again is a reset
    const whole = press('cm-map-whole', { label: 'Whole map', iconName: 'reset', title: 'The map’s own frame again (0)' }, () => toWhole());
    // the wheel over the buttons zooms the map as it does over the map, rather than scroll the note
    bar.addEventListener('wheel', turned, { passive: false });
    const ruler = document.createElement('div');
    ruler.className = 'cm-map-ruler';
    ruler.setAttribute('aria-hidden', 'true');
    return { bar, ruler, zoomIn, zoomOut, whole };
  }

  // -- the presses --

  const held = new Map();
  let pinch = null;
  let space = false;
  let hovered = false;
  over.addEventListener('pointerenter', () => { hovered = true; });
  over.addEventListener('pointerleave', () => { hovered = false; });

  function grab(event) {
    event.preventDefault();
    event.stopPropagation();
    land();
    if (!stage.contains(document.activeElement)) stage.focus({ preventScroll: true });
    held.set(event.pointerId, [event.clientX, event.clientY]);
    over.setPointerCapture?.(event.pointerId);
    stage.classList.add('cm-map-panning');
    if (held.size === 2) {
      const [a, b] = [...held.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, k: view.k };
    }
  }
  function letGo(event) {
    if (!held.delete(event.pointerId)) return false;
    if (held.size < 2) pinch = null;
    if (!held.size) {
      stage.classList.remove('cm-map-panning');
      told();
    }
    return true;
  }

  over.addEventListener('pointerdown', (event) => {
    // the map moves under a drag with nothing in hand, Space held, the middle button, or a second finger
    if (navigating && (event.button === 1 || (event.button === 0 && (!tool || space || held.size)))) {
      grab(event);
      return;
    }
    if (!tool || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = at(event);
    if (RECTANGLES.has(tool)) {
      start = point;
      pointer = point;
      over.setPointerCapture?.(event.pointerId);
      paintWorking();
      return;
    }
    if (tool === 'point') {
      const kept_ = done;
      disarm();
      kept_?.(project.from(point));
      return;
    }
    const closed = tool === 'area' || tool === 'highlight';
    const near = (other) => other && Math.hypot(other[0] - point[0], other[1] - point[1]) < 10 * unit * ink;
    // the first corner again closes an area, the last again ends a line
    if ((closed && corners.length >= 3 && near(corners[0])) || (!closed && corners.length >= 2 && near(corners.at(-1)))) {
      finish();
      return;
    }
    corners.push(point);
    paintWorking();
  });
  over.addEventListener('pointermove', (event) => {
    const last = held.get(event.pointerId);
    if (last) {
      held.set(event.pointerId, [event.clientX, event.clientY]);
      const stageNow = stageSize();
      if (held.size === 2 && pinch) {
        const [a, b] = [...held.values()];
        const box = over.getBoundingClientRect();
        const factor = (pinch.k * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)) / view.k;
        view = zoomAbout(view, factor, size, stageNow, [(a[0] + b[0]) / 2 - box.left, (a[1] + b[1]) / 2 - box.top], limits());
      } else view = panBy(view, event.clientX - last[0], event.clientY - last[1], size, stageNow, limits());
      if (tool) pointer = at(event);
      paint();
      event.preventDefault();
      return;
    }
    if (!tool) return;
    pointer = at(event);
    paintWorking();
  });
  over.addEventListener('pointerup', (event) => {
    if (letGo(event)) return;
    if (!RECTANGLES.has(tool) || !start) return;
    const end = at(event);
    const [x0, y0, x1, y1] = boxOf(start, end);
    start = null;
    if (x1 - x0 < 8 * unit || y1 - y0 < 8 * unit) {
      paintWorking();
      return;
    }
    const [west, north] = project.from([x0, y0]);
    const [east, south] = project.from([x1, y1]);
    const kept_ = done;
    disarm();
    kept_?.([west, south, east, north]);
  });
  over.addEventListener('pointercancel', letGo);
  over.addEventListener('lostpointercapture', letGo);
  // the middle button moves the map and pastes nothing
  for (const type of ['mousedown', 'auxclick']) over.addEventListener(type, (event) => { if (navigating && event.button === 1) event.preventDefault(); });
  function turned(event) {
    if (!navigating) return;
    event.preventDefault();
    const box = over.getBoundingClientRect();
    moveTo(zoomAbout(view, wheelFactor(event), size, stageSize(), [event.clientX - box.left, event.clientY - box.top], limits()));
  }
  over.addEventListener('wheel', turned, { passive: false });
  over.addEventListener('dblclick', (event) => {
    if (navigating && !tool) {
      event.preventDefault();
      event.stopPropagation();
      const box = over.getBoundingClientRect();
      zoomBy(event.shiftKey ? 0.5 : 2, [event.clientX - box.left, event.clientY - box.top]);
      return;
    }
    if (!tool || RECTANGLES.has(tool) || tool === 'point') return;
    event.preventDefault();
    event.stopPropagation();
    // the double press put its corner down twice
    if (corners.length > 1 && Math.hypot(corners.at(-1)[0] - corners.at(-2)[0], corners.at(-1)[1] - corners.at(-2)[1]) < 2 * unit * ink) corners.pop();
    finish();
  });

  function key(event) {
    if (!tool) return false;
    if (event.key === 'Escape') { disarm(); return true; }
    if (event.key === 'Enter' && corners.length) { finish(); return true; }
    if (event.key === 'Backspace' && corners.length) { corners.pop(); paintWorking(); return true; }
    return false;
  }
  // while a tool is armed its keys are the map's wherever the keyboard is: a press on the map
  // may have given it to the note, whose Enter would otherwise write a line
  const keys = (event) => {
    if (!stage.isConnected) return;
    if (key(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /** The keys that move the map, its own while it holds the keyboard; Space while the pointer is on it too. */
  const MOVES = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
  function moveKeys(event) {
    if (!stage.isConnected || !navigating || event.ctrlKey || event.metaKey || event.altKey) return;
    const ours = stage.contains(event.target);
    const writing = typing(event.target) && !ours;
    if (event.key === ' ' && !writing && (ours || hovered)) {
      if (!space) {
        space = true;
        stage.classList.add('cm-map-space');
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!ours) return;
    if (event.key === '+' || event.key === '=') zoomBy(2);
    else if (event.key === '-' || event.key === '_') zoomBy(0.5);
    else if (event.key === '0') toWhole();
    else if (MOVES[event.key]) moveTo(panBy(view, ...MOVES[event.key], size, stageSize(), limits()), 160);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
  function spaceUp(event) {
    if (event.key !== ' ' || !space) return;
    space = false;
    stage.classList.remove('cm-map-space');
  }
  const forget = () => spaceUp({ key: ' ' });

  let watching = null;
  function listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    document[method]('keydown', moveKeys, true);
    document[method]('keyup', spaceUp, true);
    globalThis[method]?.('blur', forget);
    if (on && !watching && typeof ResizeObserver === 'function') {
      watching = new ResizeObserver(() => navigating && paint());
      watching.observe(stage);
    } else if (!on) {
      watching?.disconnect();
      watching = null;
    }
  }

  /** Let the map move, or show the block's own view again and hold it still. */
  function navigate(on) {
    const wanted = Boolean(on);
    if (wanted === navigating) return;
    navigating = wanted;
    stage.classList.toggle('cm-map-nav', wanted);
    if (wanted) {
      layCloseUps();
      controls ??= makeControls();
      stage.append(controls.bar, controls.ruler);
      listen(true);
    } else {
      land();
      view = wholeView(size);
      controls?.bar.remove();
      controls?.ruler.remove();
      listen(false);
      held.clear();
      pinch = null;
      forget();
      stage.classList.remove('cm-map-panning');
    }
    paint();
    told();
  }

  function disarm() {
    document.removeEventListener('keydown', keys, true);
    tool = null;
    done = null;
    corners = [];
    start = null;
    pointer = null;
    stage.classList.remove('cm-map-armed');
    delete stage.dataset.tool;
    paintWorking();
    onarmed(null);
  }

  if (navigable) {
    if (kept) view = clampView(kept, size, { least: LEAST, most: DEEPEST });
    navigating = true;
    stage.classList.add('cm-map-nav');
    layCloseUps();
    controls = makeControls();
    stage.append(controls.bar, controls.ruler);
    listen(true);
    paint();
  }

  return {
    project,
    get armed() {
      return tool;
    },
    get navigating() {
      return navigating;
    },
    get view() {
      return view;
    },
    get whole() {
      return isWhole(view, size);
    },
    /** Arm `name` (`TOOL_HINTS`), `onDone` getting what it drew. */
    arm(name, onDone) {
      disarm();
      tool = name;
      done = onDone;
      document.addEventListener('keydown', keys, true);
      stage.classList.add('cm-map-armed');
      stage.dataset.tool = name;
      onarmed(name);
    },
    disarm,
    navigate,
    zoomBy,
    toWhole,
    /**
     * Lay the map again on the stage's size now (the card took the whole screen or gave it back):
     * the view keeps its middle and how much closer than the whole map it looks, so the same part
     * shows larger or smaller, and a corner in progress stays where it was put.
     */
    refit() {
      land();
      paint();
    },
    /** What the stage shows now, as `[west, south, east, north]`. */
    seen() {
      const [vx, vy, vw, vh] = shownWindow();
      const [west, north] = project.from([vx, vy]);
      const [east, south] = project.from([vx + vw, vy + vh]);
      return [Math.max(-180, west), Math.max(-85, south), Math.min(180, east), Math.min(85, north)];
    },
    /** Put it down: its tool, its keys and its watch on the stage's size, the view it had kept by whoever heard it. */
    destroy() {
      disarm();
      land();
      listen(false);
    },
    /** Lay `shapes` over the map: frames, highlighted areas and steps the card points at. */
    show(shapes = []) {
      shown.replaceChildren(...shapes.flatMap((shape) => {
        const colour = shape.colour || '#ffffff';
        if (shape.kind === 'box') {
          const [west, south, east, north] = shape.coords;
          const [x0, y0] = project.to([west, north]);
          const [x1, y1] = project.to([east, south]);
          const node = svgNode('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'cm-map-box', 'stroke-width': 2 * unit });
          node.style.stroke = colour;
          if (shape.dashed) node.setAttribute('stroke-dasharray', `${8 * unit} ${6 * unit}`);
          const nodes = [node];
          if (shape.label) {
            const text = svgNode('text', { x: x0 + 6 * unit, y: y0 + 16 * unit, class: 'cm-map-box-label', 'font-size': 13 * unit });
            text.textContent = shape.label;
            nodes.push(text);
          }
          return nodes;
        }
        return [];
      }));
    },
  };
}
