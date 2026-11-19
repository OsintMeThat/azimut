/**
 * The map on its card, drawn on: its ground and the drawing the page shows over it (the
 * engine's own SVG, `POST /notes/maps/describe`), and over both the shapes the card asks
 * for. Nothing here is fetched: the ground is the picture filed in the case.
 *
 * One tool at a time is armed: a rectangle dragged (the map's frame, a step's), a point
 * pressed, a line or an area put down corner by corner (a double press, Enter or the
 * first corner again ends it, Backspace takes the last corner back, Escape gives up).
 * Each answers in longitude and latitude, as the block and the layer keep them.
 */
import { FRAME, mercX, mercY, unmercX, unmercY } from './mapText.js';

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
  point: 'Press where the point goes. Esc cancels.',
  line: 'Press each corner of the line, then press the last one again or Enter. Backspace takes a corner back.',
  area: 'Press each corner of the area, then the first one again or Enter. Backspace takes a corner back.',
  highlight: 'Press each corner round the area to highlight, then the first one again or Enter.',
};

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

/**
 * The map drawn in `stage` from `described` (the card's answer: its bounds, frame, ground
 * and SVG), with `groundUrl` the ground's address. Answers `{ arm(tool, done), disarm, show
 * (shapes), armed, project }`: `done(answer)` gets the rectangle `[w, s, e, n]`, the point
 * `[lon, lat]` or the corners `[[lon, lat], …]`; `show` lays shapes over it, each `{ kind:
 * 'box' | 'area' | 'line' | 'point', coords, colour, dashed, label }`.
 */
export function mapSurface(stage, described, { groundUrl = '', onarmed = () => {} } = {}) {
  stage.replaceChildren();
  const size = described.frame ?? [FRAME, FRAME * 0.62];
  const project = projection(described.bounds, size);
  stage.style.setProperty('--r', String(size[0] / size[1]));
  const world = document.createElement('div');
  world.className = 'cm-map-world';
  stage.dataset.base = described.base || 'satellite';
  if (described.ground && groundUrl) {
    const picture = document.createElement('img');
    picture.className = 'cm-map-ground';
    picture.alt = '';
    picture.decoding = 'async';
    picture.draggable = false;
    picture.src = groundUrl;
    const [west, south, east, north] = described.ground.bounds;
    const [left, top] = project.to([west, north]);
    const [right, bottom] = project.to([east, south]);
    Object.assign(picture.style, {
      left: `${(left / size[0]) * 100}%`, top: `${(top / size[1]) * 100}%`,
      width: `${((right - left) / size[0]) * 100}%`, height: `${((bottom - top) / size[1]) * 100}%`,
    });
    world.append(picture);
  } else stage.classList.add('cm-map-plain-stage');
  stage.append(world);
  const drawing = document.createElement('div');
  drawing.className = 'cm-map-drawing';
  // the engine's own drawing, its words escaped there
  drawing.innerHTML = described.svg ?? '';
  stage.append(drawing);
  const over = svgNode('svg', { class: 'cm-map-over', viewBox: `0 0 ${size[0]} ${size[1]}`, preserveAspectRatio: 'none' });
  const shown = svgNode('g', { class: 'cm-map-shown' });
  const working = svgNode('g', { class: 'cm-map-working' });
  over.append(shown, working);
  stage.append(over);
  const unit = size[0] / 900;

  let tool = null;
  let done = null;
  let corners = [];
  let start = null;
  let pointer = null;

  const at = (event) => {
    const box = over.getBoundingClientRect();
    const x = ((event.clientX - box.left) / Math.max(box.width, 1)) * size[0];
    const y = ((event.clientY - box.top) / Math.max(box.height, 1)) * size[1];
    return [Math.max(0, Math.min(size[0], x)), Math.max(0, Math.min(size[1], y))];
  };

  function paintWorking() {
    working.replaceChildren();
    if (!tool) return;
    if ((tool === 'frame' || tool === 'step') && start && pointer) {
      const [x0, y0, x1, y1] = boxOf(start, pointer);
      working.append(svgNode('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'cm-map-box cm-map-box-new', 'stroke-width': 2 * unit }));
      return;
    }
    if (!corners.length) return;
    const points = [...corners, ...(pointer ? [pointer] : [])].map((point) => point.join(',')).join(' ');
    const closed = tool === 'area' || tool === 'highlight';
    working.append(svgNode(closed && corners.length > 1 ? 'polygon' : 'polyline', { points, class: `cm-map-path${closed ? ' cm-map-path-area' : ''}`, 'stroke-width': 2.4 * unit }));
    corners.forEach((point, index) => working.append(svgNode('circle', { cx: point[0], cy: point[1], r: (index === 0 && closed ? 6 : 4) * unit, class: 'cm-map-corner' })));
  }

  function finish() {
    const answer = corners.map((point) => project.from(point));
    const kept = done;
    const was = tool;
    disarm();
    if (was === 'line' && answer.length >= 2) kept?.(answer);
    else if ((was === 'area' || was === 'highlight') && answer.length >= 3) kept?.(answer);
  }

  over.addEventListener('pointerdown', (event) => {
    if (!tool || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = at(event);
    if (tool === 'frame' || tool === 'step') {
      start = point;
      pointer = point;
      over.setPointerCapture?.(event.pointerId);
      paintWorking();
      return;
    }
    if (tool === 'point') {
      const kept = done;
      disarm();
      kept?.(project.from(point));
      return;
    }
    const closed = tool === 'area' || tool === 'highlight';
    const near = (other) => other && Math.hypot(other[0] - point[0], other[1] - point[1]) < 10 * unit;
    // the first corner again closes an area, the last again ends a line
    if ((closed && corners.length >= 3 && near(corners[0])) || (!closed && corners.length >= 2 && near(corners.at(-1)))) {
      finish();
      return;
    }
    corners.push(point);
    paintWorking();
  });
  over.addEventListener('pointermove', (event) => {
    if (!tool) return;
    pointer = at(event);
    paintWorking();
  });
  over.addEventListener('pointerup', (event) => {
    if (!(tool === 'frame' || tool === 'step') || !start) return;
    const end = at(event);
    const [x0, y0, x1, y1] = boxOf(start, end);
    start = null;
    if (x1 - x0 < 8 * unit || y1 - y0 < 8 * unit) {
      paintWorking();
      return;
    }
    const [west, north] = project.from([x0, y0]);
    const [east, south] = project.from([x1, y1]);
    const kept = done;
    disarm();
    kept?.([west, south, east, north]);
  });
  over.addEventListener('dblclick', (event) => {
    if (!tool || tool === 'frame' || tool === 'step' || tool === 'point') return;
    event.preventDefault();
    event.stopPropagation();
    // the double press put its corner down twice
    if (corners.length > 1 && Math.hypot(corners.at(-1)[0] - corners.at(-2)[0], corners.at(-1)[1] - corners.at(-2)[1]) < 2 * unit) corners.pop();
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

  return {
    project,
    get armed() {
      return tool;
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
