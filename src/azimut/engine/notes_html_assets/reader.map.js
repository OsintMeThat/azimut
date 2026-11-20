/*
 * Azimut reader, its maps: spliced into reader.js where it says `az:map`, only in a page
 * that holds a map (engine/notes_html.py), so every other page keeps the reader it had.
 * It reads the helpers reader.js holds (make, all, go, motion, reduced) in its scope.
 */
  /* a map: the ground and the drawing over it zoom and pan together, a feature opens its card,
     the days go by on a timeline, and its steps fly it where they look. The page holds it whole
     without this: the drawing as on its last day. The figure's data (`script.az-map-data`) is
     what every reader of the map shares; `figure.azMap` is how the story drives it */
  const MARKER_PX = 26;
  const MARKER_UNITS = 64;
  const LABEL_PX = 12.5;
  const mercX = (lon) => (lon + 180) / 360;
  const mercY = (lat) => {
    const sine = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
    return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
  };
  const longDay = (day, month = 'long') => {
    const at = new Date(`${day}T00:00:00Z`);
    return Number.isNaN(at.getTime()) ? day : at.toLocaleDateString('en-GB', { day: 'numeric', month, year: 'numeric', timeZone: 'UTC' });
  };
  const ease = (t) => 1 - (1 - t) ** 3;
  /* marks that would cover one another are spread round the place they share, a ring for a few,
     a sunflower for more, the nearest to the middle (`arrange` in engine/notes_maps.py) */
  const NEAR_PX = 19;
  const SPREAD_PX = 27;
  function slots(count) {
    if (count <= 6) {
      const radius = count > 1 ? SPREAD_PX / (2 * Math.sin(Math.PI / count)) : 0;
      const start = count !== 2 ? -Math.PI / 2 : Math.PI;
      return Array.from({ length: count }, (_, slot) => [radius * Math.cos(start + (2 * Math.PI * slot) / count), radius * Math.sin(start + (2 * Math.PI * slot) / count)]);
    }
    const golden = Math.PI * (3 - Math.sqrt(5));
    const step = (SPREAD_PX / Math.sqrt(Math.PI)) * 1.05;
    return Array.from({ length: count }, (_, slot) => [step * Math.sqrt(slot + 0.5) * Math.cos(slot * golden), step * Math.sqrt(slot + 0.5) * Math.sin(slot * golden)]);
  }
  /** A crowd larger than this is a count to press while the map can still move in on it. */
  const BUBBLE_FROM = 12;
  /** The app's full-screen icon (`maximize`, `minimize` in components/Icon.svelte): corners out to take the screen, in to give it back. */
  const CORNERS = {
    out: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3',
    in: 'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3',
  };
  /**
   * Where each of `points` (`{id, x, y}` in pixels) stands once spread; a mark alone is not in it.
   * With `bubbles`, a crowd past `from` (`BUBBLE_FROM`, or the map's own `crowds`) is left out and
   * answered in `crowds` instead.
   */
  function arrange(points, { bubbles = false, from = BUBBLE_FROM } = {}) {
    const grid = new Map();
    const cellOf = (p) => `${Math.floor(p.x / NEAR_PX)},${Math.floor(p.y / NEAR_PX)}`;
    points.forEach((p, i) => { const key = cellOf(p); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i); });
    const crowd = points.map((p, i) => {
      const gx = Math.floor(p.x / NEAR_PX);
      const gy = Math.floor(p.y / NEAR_PX);
      const found = [];
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) if (j !== i && Math.hypot(points[j].x - p.x, points[j].y - p.y) < NEAR_PX) found.push(j);
      }
      return found;
    });
    const byId = (a, b) => (points[a].id < points[b].id ? -1 : points[a].id > points[b].id ? 1 : 0);
    const order = points.map((_, i) => i).sort((a, b) => crowd[b].length - crowd[a].length || points[a].y - points[b].y || points[a].x - points[b].x);
    const taken = new Set();
    const out = new Map();
    const crowds = [];
    for (const i of order) {
      if (taken.has(i)) continue;
      const group = [i, ...crowd[i].filter((j) => !taken.has(j))];
      for (const j of group) taken.add(j);
      if (group.length === 1) continue;
      const cx = group.reduce((sum, j) => sum + points[j].x, 0) / group.length;
      const cy = group.reduce((sum, j) => sum + points[j].y, 0) / group.length;
      if (bubbles && group.length > from) {
        crowds.push({ ids: group.map((j) => points[j].id), x: cx, y: cy });
        continue;
      }
      const sorted = group.slice().sort(group.length <= 6
        ? (a, b) => Math.atan2(points[a].y - cy, points[a].x - cx) - Math.atan2(points[b].y - cy, points[b].x - cx) || byId(a, b)
        : (a, b) => Math.hypot(points[a].x - cx, points[a].y - cy) - Math.hypot(points[b].x - cx, points[b].y - cy) || byId(a, b));
      slots(group.length).forEach(([x, y], n) => out.set(points[sorted[n]].id, [cx + x, cy + y]));
    }
    out.crowds = crowds;
    return out;
  }

  function mapOf(figure, data) {
    const stage = figure.querySelector('.az-map-stage');
    const svg = stage?.querySelector('svg.az-map-svg');
    if (!stage || !svg) return null;
    const ground = stage.querySelector('.az-map-ground');
    const world = stage.querySelector('.az-map-world');
    const details = all('.az-map-detail', stage);
    const [, , W = 1600, H = 1000] = String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const [west, south, east, north] = data.bounds || [0, 0, 1, 1];
    const x0 = mercX(west);
    const y0 = mercY(north);
    const spanX = Math.max(1e-12, mercX(east) - x0);
    const spanY = Math.max(1e-12, mercY(south) - y0);
    const project = (lon, lat) => [((mercX(lon) - x0) / spanX) * W, ((mercY(lat) - y0) / spanY) * H];
    const byId = new Map((data.features || []).map((feature) => [feature.id, feature]));
    const shapes = all('.az-f', svg);
    const nodeOf = new Map(shapes.map((node) => [node.dataset.id, node]));
    const points = shapes.filter((node) => node.classList.contains('az-point'));
    const labels = all('.az-label', svg);
    const leaders = svg.querySelector('.az-leaders');
    const bubbles = svg.ownerDocument.createElementNS(svg.namespaceURI, 'g');
    bubbles.setAttribute('class', 'az-bubbles');
    svg.append(bubbles);
    /** A crowd too large to spread: its count, in a ring of its marks' colours; a press moves in on it. */
    function bubble(crowd, unit) {
      const node = svg.ownerDocument.createElementNS(svg.namespaceURI, 'g');
      node.setAttribute('class', 'az-bubble');
      node.setAttribute('transform', `translate(${(crowd.x * unit).toFixed(2)} ${(crowd.y * unit).toFixed(2)}) scale(${unit.toFixed(5)})`);
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', `${crowd.ids.length} marks here. Press to move in`);
      node.azIds = crowd.ids;
      const radius = 15 + Math.min(9, crowd.ids.length / 5);
      const back = svg.ownerDocument.createElementNS(svg.namespaceURI, 'circle');
      back.setAttribute('r', String(radius));
      back.setAttribute('class', 'az-bubble-back');
      node.append(back);
      const colours = new Map();
      for (const id of crowd.ids) {
        const colour = nodeOf.get(id)?.dataset.colour || '#ffffff';
        colours.set(colour, (colours.get(colour) || 0) + 1);
      }
      let turn = -Math.PI / 2;
      for (const [colour, count] of colours) {
        const sweep = (count / crowd.ids.length) * Math.PI * 2;
        const arc = svg.ownerDocument.createElementNS(svg.namespaceURI, 'path');
        const r = radius - 2.5;
        const end = turn + Math.max(0.001, sweep - (colours.size > 1 ? 0.08 : 0.0001));
        arc.setAttribute('d', `M${(r * Math.cos(turn)).toFixed(2)} ${(r * Math.sin(turn)).toFixed(2)}A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${(r * Math.cos(end)).toFixed(2)} ${(r * Math.sin(end)).toFixed(2)}`);
        arc.setAttribute('class', 'az-bubble-arc');
        arc.setAttribute('stroke', colour);
        node.append(arc);
        turn += sweep;
      }
      const count = svg.ownerDocument.createElementNS(svg.namespaceURI, 'text');
      count.setAttribute('class', 'az-bubble-count');
      count.setAttribute('y', '4.6');
      count.textContent = String(crowd.ids.length);
      node.append(count);
      return node;
    }
    /** Move in on a crowd until its marks stand apart, or as far as the ground stays sharp. */
    function into(ids) {
      const nodes = ids.map((id) => nodeOf.get(id)).filter(Boolean);
      if (!nodes.length) return;
      const xs = nodes.map((node) => Number(node.dataset.x));
      const ys = nodes.map((node) => Number(node.dataset.y));
      const { w, h } = size();
      const f = fit();
      const spanW = Math.max(1, Math.max(...xs) - Math.min(...xs)) * f;
      const spanH = Math.max(1, Math.max(...ys) - Math.min(...ys)) * f;
      const k = Math.min(most, Math.max(view.k * 2, Math.min((w * 0.55) / spanW, (h * 0.55) / spanH)));
      const cx = ((Math.max(...xs) + Math.min(...xs)) / 2) * f;
      const cy = ((Math.max(...ys) + Math.min(...ys)) / 2) * f;
      fly({ k, x: w / 2 - cx * k, y: h / 2 - cy * k }, 900);
    }
    const labelOf = new Map(labels.map((label) => [label.dataset.for, label]));
    const days = data.days || [];
    /** How many marks make a crowd to press: the map's own `crowds`, none for 0. */
    const crowdFrom = data.crowds === 0 ? Infinity : Number(data.crowds) || BUBBLE_FROM;
    const view = { k: 1, x: 0, y: 0 };
    let most = 24;
    let picked = null;
    let opener = null;
    let currentDay = data.day || days[days.length - 1] || '';
    let clashTimer = 0;
    /** A live map that has taken the drawing over (reader.live.js), which then moves and draws it. */
    let engine = null;
    /** Whether the figure holds the whole screen (`screen`), where the stage takes the screen's shape. */
    let full = false;

    stage.tabIndex = 0;
    stage.setAttribute('aria-label', `${stage.getAttribute('aria-label') || 'Map'}. Plus and minus zoom, the arrows move it`);
    for (const node of shapes) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
    }

    const size = () => ({ w: stage.clientWidth || 1, h: stage.clientHeight || 1 });
    /**
     * The ground's pixels a CSS pixel shows at the whole map, read off the picture it holds. The stage
     * is the map's shape, but on the whole screen it is the screen's, the map held whole in its middle.
     */
    const fit = () => (full ? Math.min(size().w / W, size().h / H) : size().w / W);
    /** The world's size on the stage at the whole map: the stage itself, but on the whole screen. */
    const span = () => (full ? { w: W * fit(), h: H * fit() } : size());
    /** The point of the map at the stage's middle as the view was last laid: a stage sized again keeps it there. */
    let laid = null;
    /** The view of the whole map: the world in the stage's middle. */
    const whole = () => ({ k: 1, x: (size().w - span().w) / 2, y: (size().h - span().h) / 2 });
    /** The view the map opens on: the part of it its block opens on (`data.opens`), held whole, else all of it. */
    function opening() {
      if (!Array.isArray(data.opens) || data.opens.length !== 4) return whole();
      const [x0, y0] = project(data.opens[0], data.opens[3]);
      const [x1, y1] = project(data.opens[2], data.opens[1]);
      const { w, h } = size();
      const f = fit();
      const k = Math.max(1, Math.min(w / Math.max(1e-9, (x1 - x0) * f), h / Math.max(1e-9, (y1 - y0) * f)));
      return { k, x: w / 2 - ((x0 + x1) / 2) * f * k, y: h / 2 - ((y0 + y1) / 2) * f * k };
    }

    /**
     * The world never leaves the stage: its top left stays above and left of the stage's. Narrower
     * than the stage, as on the whole screen, it stands in the stage's middle that way.
     */
    function paint() {
      const { w, h } = size();
      view.k = Math.min(most, Math.max(1, view.k));
      const ww = span().w * view.k;
      const wh = span().h * view.k;
      view.x = ww < w ? (w - ww) / 2 : Math.min(0, Math.max(w - ww, view.x));
      view.y = wh < h ? (h - wh) / 2 : Math.min(0, Math.max(h - wh, view.y));
      laid = { x: (w / 2 - view.x) / (fit() * view.k), y: (h / 2 - view.y) / (fit() * view.k) };
      if (world) {
        world.style.width = full ? `${span().w.toFixed(2)}px` : '';
        world.style.height = full ? `${span().h.toFixed(2)}px` : '';
        world.style.transform = `translate(${view.x.toFixed(2)}px, ${view.y.toFixed(2)}px) scale(${view.k.toFixed(5)})`;
      }
      // a closer picture shows once the ground under it would blur
      const sharp = (ground?.naturalWidth || W) / ((Number.parseFloat(ground?.style.width || '') / 100 || 1) * span().w);
      for (const detail of details) detail.classList.toggle('az-on', view.k > sharp * 0.9);
      const unit = 1 / (fit() * view.k);
      const [shownW, shownH] = full ? [w * unit, h * unit] : [W / view.k, H / view.k];
      svg.setAttribute('viewBox', `${(-view.x * unit).toFixed(3)} ${(-view.y * unit).toFixed(3)} ${shownW.toFixed(3)} ${shownH.toFixed(3)}`);
      // on the whole screen the drawing shows what the page frames and nothing round it (the world clips its own
      // ground), its tools, north arrow, scale and card on its corners: how far each edge of the map is from the stage's
      for (const [edge, room] of [['t', view.y], ['r', w - view.x - ww], ['b', h - view.y - wh], ['l', view.x]]) {
        stage.parentNode.style.setProperty(`--az-${edge}`, full ? `${Math.max(0, room).toFixed(1)}px` : '');
      }
      // where each mark stands at this zoom: its own place, or spread round one it shares
      const px = 1 / unit;
      const spread = arrange(points.filter((node) => !node.classList.contains('az-off'))
        .map((node) => ({ id: node.dataset.id, x: Number(node.dataset.x) * px, y: Number(node.dataset.y) * px })),
      { bubbles: view.k < most * 0.95, from: crowdFrom });
      const grouped = new Set(spread.crowds.flatMap((one) => one.ids));
      for (const node of points) node.classList.toggle('az-grouped', grouped.has(node.dataset.id));
      bubbles.replaceChildren(...spread.crowds.map((one) => bubble(one, unit)));
      const drawn = [];
      for (const node of points) {
        const scale = (MARKER_PX * (Number(node.dataset.s) || 1) * unit) / MARKER_UNITS;
        const moved = spread.get(node.dataset.id);
        const x = moved ? moved[0] * unit : Number(node.dataset.x);
        const y = moved ? moved[1] * unit : Number(node.dataset.y);
        node.azAt = [x, y];
        node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})`);
        if (!moved || grouped.has(node.dataset.id)) continue;
        const leader = svg.ownerDocument.createElementNS(svg.namespaceURI, 'g');
        leader.setAttribute('class', 'az-leader');
        leader.dataset.for = node.dataset.id;
        const line = svg.ownerDocument.createElementNS(svg.namespaceURI, 'line');
        for (const [name, value] of [['x1', node.dataset.x], ['y1', node.dataset.y], ['x2', x.toFixed(2)], ['y2', y.toFixed(2)]]) line.setAttribute(name, value);
        const dot = svg.ownerDocument.createElementNS(svg.namespaceURI, 'circle');
        for (const [name, value] of [['cx', node.dataset.x], ['cy', node.dataset.y], ['r', (2.6 * unit).toFixed(3)]]) dot.setAttribute(name, value);
        dot.setAttribute('fill', node.dataset.colour || '#fff');
        leader.append(line, dot);
        drawn.push(leader);
      }
      leaders?.replaceChildren(...drawn);
      for (const label of labels) {
        const anchor = nodeOf.get(label.dataset.for);
        // a line's or an area's name stays on its middle, at the size of the others
        if (label.dataset.x) {
          label.setAttribute('y', (Number(label.dataset.y) + LABEL_PX * 0.35 * unit).toFixed(2));
          label.setAttribute('font-size', (LABEL_PX * unit).toFixed(3));
          label.style.strokeWidth = `${(3.2 * unit).toFixed(3)}px`;
          continue;
        }
        if (!anchor?.azAt) continue;
        label.setAttribute('x', (anchor.azAt[0] + 15 * unit).toFixed(2));
        label.setAttribute('y', (anchor.azAt[1] + LABEL_PX * 0.35 * unit).toFixed(2));
        label.setAttribute('font-size', (LABEL_PX * unit).toFixed(3));
        label.style.strokeWidth = `${(3.2 * unit).toFixed(3)}px`;
      }
      scale();
      tools?.querySelector('[data-act="out"]')?.toggleAttribute('disabled', view.k <= 1.001);
      tools?.querySelector('[data-act="in"]')?.toggleAttribute('disabled', view.k >= most - 0.01);
      clearTimeout(clashTimer);
      clashTimer = setTimeout(clashes, 90);
    }

    /** Names written beside their marks, each kept off those already written, top first. */
    function clashes() {
      const taken = [];
      const shown = labels.filter((label) => {
        const of = nodeOf.get(label.dataset.for);
        const on = of && !of.classList.contains('az-off') && !of.classList.contains('az-grouped');
        label.classList.toggle('az-off', !on);
        return on;
      });
      shown.sort((a, b) => Number(a.getAttribute('y')) - Number(b.getAttribute('y')));
      for (const label of shown) {
        label.classList.remove('az-clash');
        const at = label.getBoundingClientRect();
        if (!at.width) continue;
        const hit = taken.some((one) => at.left < one.right && one.left < at.right && at.top < one.bottom && one.top < at.bottom);
        label.classList.toggle('az-clash', hit);
        if (!hit) taken.push(at);
      }
    }

    /* the scale: a round distance about a hundred pixels long, at the map's middle, unless the map takes it away */
    const ruler = data.scale === 'off' ? null : make('div', { class: 'az-map-scale', 'aria-hidden': 'true' });
    if (ruler) stage.append(ruler);
    function scale() {
      if (!ruler) return;
      const { w, h } = size();
      const unit = 1 / (fit() * view.k);
      const mid = [(-view.x + w / 2) * unit, (-view.y + h / 2) * unit];
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * (y0 + (mid[1] / H) * spanY)))) * 180) / Math.PI;
      const metres = 40075016.7 * Math.cos((lat * Math.PI) / 180) * (spanX / W) * unit;
      let length = 1;
      for (const step of [1, 2, 5]) for (let power = 0; power < 8; power += 1) {
        const value = step * 10 ** power;
        if (value / metres <= 110 && value > length) length = value;
      }
      ruler.style.width = `${Math.round(length / metres)}px`;
      ruler.textContent = length >= 1000 ? `${length / 1000} km` : `${length} m`;
    }

    /** Zoom by `factor` about a point of the stage, its middle by default. */
    function zoom(factor, at, smooth = true) {
      const { w, h } = size();
      const to = Math.min(most, Math.max(1, view.k * factor));
      const p = at || { x: w / 2, y: h / 2 };
      const target = { k: to, x: p.x - ((p.x - view.x) * to) / view.k, y: p.y - ((p.y - view.y) * to) / view.k };
      if (smooth) fly(target, 260); else { Object.assign(view, target); paint(); }
    }
    let flight = 0;
    /** Move to `{k, x, y}` over `ms`, the zoom eased in its own scale. */
    function fly(target, ms = 900) {
      cancelAnimationFrame(flight);
      const from = { ...view };
      if (reduced.matches || ms <= 0) { Object.assign(view, target); paint(); return; }
      stage.classList.add('az-moving');
      const start = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - start) / ms);
        const e = ease(t);
        const k = from.k * (target.k / from.k) ** e;
        // the point under the middle travels in a straight line while the zoom changes
        const { w, h } = size();
        const fromMid = { x: (w / 2 - from.x) / from.k, y: (h / 2 - from.y) / from.k };
        const toMid = { x: (w / 2 - target.x) / target.k, y: (h / 2 - target.y) / target.k };
        const mid = { x: fromMid.x + (toMid.x - fromMid.x) * e, y: fromMid.y + (toMid.y - fromMid.y) * e };
        Object.assign(view, { k, x: w / 2 - mid.x * k, y: h / 2 - mid.y * k });
        paint();
        if (t < 1) flight = requestAnimationFrame(frame);
        else stage.classList.remove('az-moving');
      };
      flight = requestAnimationFrame(frame);
    }
    /** Where a view of the map engine's (`{center, zoom}`) puts the stage. */
    function placed(target) {
      const { w, h } = size();
      const z0 = Math.log2(span().w / (512 * spanX));
      const k = Math.min(most, Math.max(1, 2 ** ((Number(target?.zoom) || z0) - z0)));
      const [cx, cy] = target?.center ? project(target.center[0], target.center[1]) : [W / 2, H / 2];
      const f = fit();
      return { k, x: w / 2 - cx * f * k, y: h / 2 - cy * f * k };
    }

    /* the tools: the zoom, and apart under it the whole screen */
    const tools = make('div', { class: 'az-map-tools' });
    const tool = (act, text, label) => make('button', { type: 'button', 'data-act': act, title: label, 'aria-label': label }, text);
    const zooms = make('div', { class: 'az-map-zoom' });
    zooms.append(tool('in', '+', 'Zoom in'), tool('out', '−', 'Zoom out'), tool('fit', '⤢', 'The whole map'));
    const screenButton = tool('full', '', '');
    const icon = doc.createElementNS(svg.namespaceURI, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.append(doc.createElementNS(svg.namespaceURI, 'path'));
    screenButton.append(icon);
    const screens = make('div', { class: 'az-map-screen' });
    screens.append(screenButton);
    tools.append(zooms, screens);
    stage.append(tools);
    tools.addEventListener('click', (event) => {
      const act = event.target.closest('button')?.dataset.act;
      if (act === 'in') zoom(2);
      else if (act === 'out') zoom(0.5);
      else if (act === 'fit') fly(whole(), 600);
      else if (act === 'full') screen();
      event.stopPropagation();
    });
    const hint = make('div', { class: 'az-map-hint', 'aria-hidden': 'true' }, `${/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'} + scroll to zoom the map`);
    stage.append(hint);
    let hinted = 0;
    stage.addEventListener('wheel', (event) => {
      // on the whole screen there is no page to scroll: the wheel zooms
      if (!(event.ctrlKey || event.metaKey || full)) {
        clearTimeout(hinted);
        hint.classList.add('az-on');
        hinted = setTimeout(() => hint.classList.remove('az-on'), 1300);
        return;
      }
      event.preventDefault();
      const at = stage.getBoundingClientRect();
      zoom(event.deltaY < 0 ? 1.25 : 0.8, { x: event.clientX - at.left, y: event.clientY - at.top }, false);
    }, { passive: false });
    stage.addEventListener('dblclick', (event) => {
      if (event.target.closest('.az-map-tools')) return;
      const at = stage.getBoundingClientRect();
      zoom(event.shiftKey ? 0.5 : 2, { x: event.clientX - at.left, y: event.clientY - at.top });
    });

    /* a drag moves the map, two fingers zoom it; a press that did not move picks what is under it */
    const held = new Map();
    let pinch = null;
    let moved = 0;
    stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.az-map-tools, .az-map-card')) return;
      held.set(event.pointerId, { x: event.clientX, y: event.clientY });
      moved = 0;
      if (held.size === 2) {
        const [a, b] = [...held.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      }
    });
    stage.addEventListener('pointermove', (event) => {
      const last = held.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      held.set(event.pointerId, { x: event.clientX, y: event.clientY });
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4 && !stage.hasPointerCapture?.(event.pointerId)) stage.setPointerCapture?.(event.pointerId);
      if (held.size === 2 && pinch) {
        const [a, b] = [...held.values()];
        const at = stage.getBoundingClientRect();
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoom((pinch.k * (d / pinch.d)) / view.k, { x: (a.x + b.x) / 2 - at.left, y: (a.y + b.y) / 2 - at.top }, false);
        return;
      }
      if (view.k <= 1.001) return;
      stage.classList.add('az-held');
      view.x += dx;
      view.y += dy;
      paint();
      event.preventDefault();
    });
    const release = (event) => {
      held.delete(event.pointerId);
      if (held.size < 2) pinch = null;
      if (!held.size) stage.classList.remove('az-held');
    };
    stage.addEventListener('pointerup', (event) => {
      const tap = held.has(event.pointerId) && moved <= 4 && held.size === 1;
      release(event);
      if (!tap) return;
      const crowd = event.target.closest?.('.az-bubble');
      const shape = event.target.closest?.('.az-f');
      if (crowd) into(crowd.azIds || []);
      else if (shape && !shape.classList.contains('az-off')) open(shape.dataset.id, shape);
      else if (!event.target.closest('.az-map-card')) close();
    });
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('keydown', (event) => {
      const shape = event.target.closest?.('.az-f');
      const crowd = event.target.closest?.('.az-bubble');
      if ((shape || crowd) && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        if (crowd) into(crowd.azIds || []); else open(shape.dataset.id, shape);
        return;
      }
      if (event.target !== stage && !shape && !crowd) return;
      const moves = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      const factors = { '+': 2, '=': 2, '-': 0.5, 0: 0 };
      if (Object.hasOwn(factors, event.key)) {
        if (factors[event.key]) zoom(factors[event.key]); else fly(whole(), 500);
      } else if (moves[event.key] && view.k > 1.001) {
        fly({ k: view.k, x: view.x + moves[event.key][0], y: view.y + moves[event.key][1] }, 220);
      } else if (event.key === 'Escape' && picked) close();
      else return;
      event.preventDefault();
    });

    /* a feature's card */
    const card = make('div', { class: 'az-map-card', role: 'dialog', hidden: '' });
    stage.parentNode.append(card);
    card.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
    function link(label, href, extra = {}) {
      const anchor = make('a', { href, ...extra }, label);
      if (!href.startsWith('#')) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
      return make('li', {}).appendChild(anchor).parentNode;
    }
    function open(id, from) {
      const feature = byId.get(id);
      if (!feature) return;
      const said = feature.card || {};
      picked?.classList.remove('az-picked');
      picked = nodeOf.get(id) || null;
      picked?.classList.add('az-picked');
      engine?.pick(id);
      opener = from || (engine ? null : picked);
      card.replaceChildren();
      card.setAttribute('aria-label', said.title || feature.label || 'Feature');
      const shut = make('button', { type: 'button', class: 'az-map-card-close', 'aria-label': 'Close' }, '×');
      shut.addEventListener('click', () => close());
      card.append(shut);
      const media = said.media;
      if (media?.src) {
        const holder = make('figure', { class: 'az-map-card-media' });
        const picture = make('img', { src: media.src, alt: media.alt || said.title || '', decoding: 'async' });
        if (media.type === 'video' && said.source?.url) {
          const watch = make('a', { class: 'az-watch', href: said.source.url, target: '_blank', rel: 'noopener noreferrer' });
          watch.append(picture, make('span', { class: 'az-watch-words' }, 'Watch'));
          holder.append(watch);
        } else holder.append(picture);
        card.append(holder);
      }
      const body = make('div', { class: 'az-map-card-body' });
      const kicker = make('p', { class: 'az-map-card-kicker' });
      const dot = make('i', { 'aria-hidden': 'true' });
      dot.style.background = feature.style?.color || 'var(--az-accent)';
      kicker.append(dot, document.createTextNode(said.kicker || feature.layer || ''));
      body.append(kicker, make('p', { class: 'az-map-card-title', dir: 'auto' }, said.title || feature.label || 'Feature'));
      if (said.day) body.append(make('p', { class: 'az-map-card-day' }, said.day));
      if (said.text) {
        const text = make('p', { class: 'az-map-card-text', dir: 'auto' }, said.text);
        body.append(text);
        if (said.text.length > 320) {
          text.classList.add('az-long');
          const more = make('button', { type: 'button', class: 'az-map-card-more' }, 'Read all');
          more.addEventListener('click', () => { text.classList.remove('az-long'); more.remove(); });
          body.append(more);
        }
      }
      const links = make('ul', { class: 'az-map-card-links' });
      if (said.proof?.figure) {
        const item = link(`See ${said.proof.name || 'the proof'} ↓`, said.proof.figure, { class: 'az-map-card-proof' });
        // the proof is in the page: the screen is given back first
        item.firstChild.addEventListener('click', (event) => { event.preventDefault(); screen(false).then(() => requestAnimationFrame(() => go(said.proof.figure))); });
        links.append(item);
      } else if (said.proof?.posted) links.append(link('Posted proof ↗', said.proof.posted, { class: 'az-map-card-proof' }));
      if (said.source?.url) links.append(link(`Source: ${said.source.label || 'web'} ↗`, said.source.url));
      for (const more of said.links || []) links.append(link(`${more.label} ↗`, more.url));
      for (const check of said.verify || []) links.append(link(`${check.label} ↗`, check.url));
      if (links.children.length) body.append(links);
      if (said.credit) body.append(make('p', { class: 'az-map-card-credit' }, said.credit));
      card.append(body);
      card.hidden = false;
      card.scrollTop = 0;
      shut.focus({ preventScroll: true });
    }
    function close() {
      if (card.hidden) return;
      card.hidden = true;
      picked?.classList.remove('az-picked');
      picked = null;
      engine?.pick(null);
      if (opener?.isConnected && opener.focus && !opener.classList.contains('az-off')) opener.focus({ preventScroll: true });
      opener = null;
    }

    /* the days */
    function setDay(day, { quiet = false } = {}) {
      currentDay = day;
      const latest = new Map();
      for (const node of shapes) {
        const on = (!node.dataset.from || node.dataset.from <= day) && (!node.dataset.until || day <= node.dataset.until);
        const was = !node.classList.contains('az-off');
        node.classList.toggle('az-off', !on);
        node.classList.remove('az-past');
        if (on && !was && !quiet && !reduced.matches) {
          node.classList.remove('az-new');
          void node.getBBox?.();
          node.classList.add('az-new');
          setTimeout(() => node.classList.remove('az-new'), 1500);
        }
        if (!on && node.dataset.until && node.dataset.until < day && node.dataset.of && !node.classList.contains('az-point')) {
          const before = latest.get(node.dataset.of);
          if (!before || before.dataset.until < node.dataset.until) latest.set(node.dataset.of, node);
        }
      }
      // where a line or an area last stood, faint: under where it stands now, or alone once it is gone
      for (const node of latest.values()) node.classList.add('az-past');
      // a name goes with its mark at once; which names clash is read once the map settles
      for (const label of labels) label.classList.toggle('az-off', nodeOf.get(label.dataset.for)?.classList.contains('az-off') ?? true);
      if (picked?.classList.contains('az-off')) close();
      if (slider) {
        const index = Math.max(0, days.indexOf(day));
        slider.value = String(index);
        slider.setAttribute('aria-valuetext', longDay(day));
        slider.style.setProperty('--at', `${days.length > 1 ? (index / (days.length - 1)) * 100 : 100}%`);
        nowDay.textContent = longDay(day, 'short');
        nowCount.textContent = `Day ${index + 1} of ${days.length}`;
      }
      if (engine) engine.day(day, { quiet });
      else paint();
    }
    let slider = null;
    /**
     * The ticks that name a day or a month: each says it only where it has room after the last one
     * that does, and one at an end of the track is set inside it rather than across its edge.
     */
    let named = [];
    function months() {
      const across = named[0]?.parentNode.clientWidth;
      if (!across) return;
      let end = -Infinity;
      for (const tick of named) {
        const middle = (Number.parseFloat(tick.style.left) / 100) * across;
        const half = tick.dataset.month.length * 3.4;
        const first = middle - half < -8;
        const last = !first && middle + half > across + 8;
        const left = first ? middle : last ? middle - 2 * half : middle - half;
        tick.classList.toggle('az-start', first);
        tick.classList.toggle('az-end', last);
        tick.classList.toggle('az-unnamed', left < end + 6);
        if (left >= end + 6) end = left + 2 * half;
      }
    }
    let nowDay = null;
    let nowCount = null;
    let playing = 0;
    const after = figure.querySelector('.az-map-day') || stage.parentNode;
    if (days.length > 1 && data.timeline !== false) {
      const time = make('div', { class: 'az-map-time' });
      const play = make('button', { type: 'button', class: 'az-map-play', 'aria-label': 'Play the days' }, '▶');
      const now = make('div', { class: 'az-map-now', 'aria-live': 'polite' });
      nowDay = make('span', { class: 'az-map-now-day' });
      nowCount = make('span', { class: 'az-map-now-count' });
      now.append(nowDay, nowCount);
      const track = make('div', { class: 'az-map-track' });
      slider = make('input', { type: 'range', min: '0', max: String(days.length - 1), step: '1', 'aria-label': 'Day shown on the map' });
      const ticks = make('ol', { class: 'az-map-ticks', 'aria-hidden': 'true' });
      // a few days are each named; more, each month where it starts
      const few = days.length <= 8;
      let month = '';
      let lastLabel = -100;
      days.forEach((day, index) => {
        const at = (index / (days.length - 1)) * 100;
        const tick = make('li');
        tick.style.left = `${at}%`;
        const named = day.slice(0, 7);
        if (few || (named !== month && at - lastLabel > 9)) {
          tick.dataset.month = few ? longDay(day, 'short').replace(/ \d{4}$/, '') : longDay(day, 'short').replace(/^\d+ /, '');
          lastLabel = at;
        }
        month = named;
        if (days.length <= 120 || tick.dataset.month) ticks.append(tick);
      });
      track.append(slider, ticks);
      named = all('li[data-month]', ticks);
      time.append(play, now, track);
      after.after(time);
      slider.addEventListener('input', () => { stop(); setDay(days[Number(slider.value)] || currentDay); });
      const stop = () => {
        clearInterval(playing);
        playing = 0;
        play.textContent = '▶';
        play.setAttribute('aria-label', 'Play the days');
      };
      play.addEventListener('click', () => {
        if (playing) { stop(); return; }
        let index = days.indexOf(currentDay);
        if (index >= days.length - 1) index = -1;
        play.textContent = '❚❚';
        play.setAttribute('aria-label', 'Pause');
        const next = () => {
          index += 1;
          setDay(days[index]);
          if (index >= days.length - 1) stop();
        };
        next();
        playing = setInterval(next, Number(data.speed) || 1100);
      });
    }

    /* a map's own steps: where it looks and on which day */
    const steps = data.steps || [];
    let stepButtons = [];
    let stepRow = null;
    function step(index, { smooth = true, card: show = false } = {}) {
      const chosen = steps[index];
      if (!chosen) return;
      if (chosen.day && days.includes(chosen.day)) setDay(chosen.day);
      else if (chosen.day && days.length) setDay(days.filter((day) => day <= chosen.day).pop() || days[0]);
      if (engine) engine.look(chosen.view, { smooth, focus: chosen.focus || [] });
      else fly(placed(chosen.view), smooth ? 1300 : 0);
      stepButtons.forEach((button, i) => (i === index ? button.setAttribute('aria-current', 'step') : button.removeAttribute('aria-current')));
      const current = stepButtons[index];
      if (current && stepRow && stepRow.scrollWidth > stepRow.clientWidth) {
        stepRow.scrollTo?.({ left: current.offsetLeft - stepRow.clientWidth / 2 + current.offsetWidth / 2, behavior: motion() });
      }
      for (const id of chosen.focus || []) {
        const node = nodeOf.get(id);
        node?.classList.add('az-new');
        setTimeout(() => node?.classList.remove('az-new'), 1500);
      }
      // a step about one feature says what it is: its card opens
      if (show && chosen.focus?.length) open(chosen.focus[0]);
      else if (show) close();
    }
    if (steps.length) {
      stepRow = make('ol', { class: 'az-map-steps', 'aria-label': 'Where the map looks' });
      stepButtons = steps.map((one, index) => {
        const said = one.label || (one.day ? longDay(one.day, 'short').replace(/ \d{4}$/, '') : `Step ${index + 1}`);
        const button = make('button', { type: 'button', title: one.text || one.label || said });
        button.append(make('b', {}, String(index + 1)), make('span', {}, said));
        button.addEventListener('click', () => step(index, { card: true }));
        const item = make('li');
        item.append(button);
        stepRow.append(item);
        return button;
      });
      const row = make('div', { class: 'az-map-steps-row' });
      row.append(stepRow);
      (figure.querySelector('.az-map-time') || after).after(row);
      // a row longer than the map fades at the edge it goes on past
      const edges = () => {
        const more = stepRow.scrollWidth - stepRow.clientWidth;
        row.classList.toggle('az-fade-start', more > 1 && stepRow.scrollLeft > 2);
        row.classList.toggle('az-fade-end', more > 1 && stepRow.scrollLeft < more - 2);
      };
      stepRow.addEventListener('scroll', edges, { passive: true });
      window.addEventListener('resize', edges);
      requestAnimationFrame(edges);
    }

    const settle = () => {
      // as deep as the ground stays sharp: each of its pixels drawn at most two and a half wide; a ground
      // laid on part of a map framed otherwise is as wide as the share of the stage it covers
      const groundShare = Number.parseFloat(ground?.style.width || '') / 100 || 1;
      most = Math.max(3, Math.min(24, ((ground?.naturalWidth || W * 2) / (groundShare * span().w)) * 2.5));
      for (const detail of details) {
        const share = Number.parseFloat(detail.style.width) / 100;
        if (share > 0 && detail.naturalWidth) most = Math.max(most, Math.min(48, (detail.naturalWidth / (share * span().w)) * 2.5));
      }
      paint();
    };
    /** The stage sized again: the world grows with it, the point at its middle kept there. */
    function refit() {
      if (laid) {
        const { w, h } = size();
        const f = fit() * view.k;
        view.x = w / 2 - laid.x * f;
        view.y = h / 2 - laid.y * f;
      }
      settle();
      months();
    }
    window.addEventListener('resize', refit);

    /* the whole screen: the figure takes it, its timeline, steps, legend and cards with it. Where the
       browser gives none to a part of the page (Safari on an iPhone, a frame that may not), the figure
       covers the window instead, the page held still under it and found where it was after */
    /** Where the page was when the figure took the screen, found there again after. */
    let wasAt = null;
    /** While the figure covers the window itself: each box round it, lifted over the rest of the page. */
    let covered = null;
    const escaped = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      screen(false);
    };
    /** Take the whole screen, give it back (`on` false), or the other of the two; settles once it has. */
    function screen(on = !full) {
      if (on === full) return Promise.resolve();
      if (!on) {
        if (covered) uncover();
        return doc.fullscreenElement === figure ? doc.exitFullscreen().catch(() => {}) : Promise.resolve();
      }
      wasAt = { x: window.scrollX, y: window.scrollY };
      if (figure.requestFullscreen && doc.fullscreenEnabled !== false) return figure.requestFullscreen().catch(cover);
      cover();
      return Promise.resolve();
    }
    function cover() {
      if (full) return;
      covered = { lifted: [] };
      for (let node = figure.parentElement; node && node !== doc.body; node = node.parentElement) {
        covered.lifted.push([node, node.style.zIndex]);
        node.style.zIndex = '2147483000';
      }
      root.classList.add('az-locked');
      figure.classList.add('az-overlay');
      changed(true);
    }
    function uncover() {
      const { lifted } = covered;
      covered = null;
      for (const [node, value] of lifted) node.style.zIndex = value;
      root.classList.remove('az-locked');
      figure.classList.remove('az-overlay');
      changed(false);
    }
    /** What the screen buttons say: the drawing's, and the live map's copy of it. */
    function labelled(button) {
      button.setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
      button.title = full ? 'Back to the page (Esc)' : 'The map on the whole screen';
      button.querySelector('path')?.setAttribute('d', full ? CORNERS.in : CORNERS.out);
    }
    /** On the whole screen, what goes with the map in one panel beside it (under it on a phone), in the page's order. */
    let side = null;
    function changed(on) {
      full = on;
      if (on) {
        side = make('div', { class: 'az-map-side' });
        side.append(...[...figure.children].filter((node) => !node.matches('.az-map-frame, script')));
        figure.append(side);
      } else if (side) {
        stage.parentNode.after(...side.children);
        side.remove();
        side = null;
      }
      figure.classList.toggle('az-full', on);
      for (const button of all('[data-act="full"]', figure)) labelled(button);
      window[on ? 'addEventListener' : 'removeEventListener']('keydown', escaped, true);
      refit();
      engine?.screen?.(on);
      // the page under the figure moved while it was away from it: it is found where it was
      if (!on && wasAt) window.scrollTo(wasAt.x, wasAt.y);
      if (!on) wasAt = null;
    }
    labelled(screenButton);
    // a map much wider than tall holds the screen's width, what goes with it under it
    figure.classList.toggle('az-map-wide', W / H >= 2);
    doc.addEventListener('fullscreenchange', () => {
      const on = doc.fullscreenElement === figure;
      if (on !== full && !covered) changed(on);
    });
    if (ground && !ground.complete) ground.addEventListener('load', settle, { once: true });
    for (const detail of details) if (!detail.complete) detail.addEventListener('load', settle, { once: true });
    window.addEventListener('beforeprint', () => { screen(false); close(); Object.assign(view, whole()); paint(); });
    if (data.opens) Object.assign(view, opening());
    settle();
    months();
    if (currentDay) setDay(currentDay, { quiet: true });

    /** What the stage shows, as `[west, south, east, north]`. */
    function seen() {
      const { w, h } = size();
      const at = (x, y) => {
        const mx = x0 + ((x - view.x) / (fit() * view.k) / W) * spanX;
        const my = y0 + ((y - view.y) / (fit() * view.k) / H) * spanY;
        return [mx * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI];
      };
      const [west, north] = at(0, 0);
      const [east, south] = at(w, h);
      return [west, south, east, north];
    }

    return {
      fly: (target, ms) => (engine ? engine.look(target, { smooth: ms !== 0 }) : fly(placed(target), ms)),
      day: (day) => setDay(day),
      step,
      open,
      close,
      seen,
      screen,
      /** A story's card: its own step, or the whole map as on its last day for the card of words. */
      story: (index) => {
        if (index == null || index === '') {
          if (days.length) setDay(data.day || days[days.length - 1]);
          if (engine) engine.whole(); else fly(whole(), 1100);
        } else step(Number(index));
      },
      /**
       * Hand the map to a live one (`{day, look, whole, pick, screen}`, reader.live.js), which from
       * then on draws it and is moved by the timeline, the steps, the story and the whole screen;
       * `null` takes it back. The drawing stays under it, out of reach. Answers what the live map
       * starts from and what it shares with the drawing: the day, the card open, whether the figure
       * holds the whole screen, how marks are spread and a crowd drawn.
       */
      attach(live) {
        engine = live || null;
        stage.inert = Boolean(engine);
        if (engine) stage.setAttribute('aria-hidden', 'true');
        else { stage.removeAttribute('aria-hidden'); paint(); }
        return { day: currentDay, picked: picked?.dataset.id || null, full, arrange, bubble, crowdFrom };
      },
    };
  }

  function maps() {
    for (const figure of all('figure.az-map')) {
      let data = null;
      try { data = JSON.parse(figure.querySelector('script.az-map-data')?.textContent || 'null'); } catch { data = null; }
      if (data?.features) figure.azMap = mapOf(figure, data);
    }
    online();
  }

  /* a web folder's maps go live once its page is read over the web: its reader loads reader.live.js,
     and MapLibre beside it, from the folder (`script#az-gl` names them); each map takes over from its
     drawing once ready, which stays when it cannot be. A file opened from the disk keeps its drawings */
  function online() {
    let said = null;
    try { said = JSON.parse(doc.getElementById('az-gl')?.textContent || 'null'); } catch { said = null; }
    const figures = all('figure.az-map').filter((figure) => figure.azMap);
    if (!said?.module || !figures.length || !/^https?:$/.test(window.location.protocol)) return;
    quietly(import(new URL(said.module, doc.baseURI).href).then((live) => live.start(figures, said)));
  }
