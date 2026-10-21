/**
 * The frames a played plate's video goes through from one beat to the next, when its
 * transitions are on. They are drawn here, in the browser, as the pages are, and the
 * video plays them before the next beat holds still (`engine/mapplates.sequence_mp4`).
 *
 * Three moves, each switched on its own (`page.TRANSITIONS`):
 * - the page fades into the next one;
 * - a map framed otherwise on the next beat flies there, blurred as it goes fastest or
 *   sharp. Each frame of the way is the map drawn again by the engine where the camera
 *   has got (`flight`), so its marks keep their size and no edge is left bare. An
 *   inset showing that map follows it;
 * - what is new on the next beat fades in, or is drawn along its lines.
 *
 * A step whose transition is "none" cuts straight in.
 */
import { drawBackground, drawPage } from './draw.js';
import { fromWorld, project, sameView, toWorld, unproject } from './geo.js';
import { MAP_KINDS, PX_PER_MM, insetView, pageSize, shownOn } from './page.js';

/** The frames a second a transition plays at, the video's own (`engine/mapplates.TWEEN_FPS`). */
export const TWEEN_FPS = 30;
/** The share of a transition the page or the maps take, when what is new appears after them. */
const MOVE_SHARE = 0.7;
/** How much the camera rises over a long way, as the engine's own flights do. */
const CURVE = 1.42;
/** The widest blur of a map in flight, as a share of its frame's width. */
const MOST_BLUR = 0.006;
/** The fastest a map's ground goes, in pixels a frame, for its flight to blur in full. */
const BLUR_FROM = 40;

/** Slow at both ends, fast in the middle. */
export const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** 0 before `a`, 1 after `b`, smoothly between. */
const step = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** The turn from `a` to `b` degrees the shorter way round. */
const turn = (a, b) => ((((b ?? 0) - (a ?? 0)) % 360) + 540) % 360 - 180;

/**
 * The way a map's camera flies from the view `a` to the view `b` in a frame `frame`:
 * `(k) => view`, `k` from 0 to 1. Over a long way it rises and comes down where it
 * lands, so the ground crosses the screen at one speed and where it goes stays in sight
 * (van Wijk and Nuij's smooth zoom and pan, which the engine's `flyTo` follows).
 */
export function flight(a, b, frame) {
  const [ax, ay] = toWorld([a.lon, a.lat], a.zoom);
  let [bx, by] = toWorld([b.lon, b.lat], a.zoom);
  // the shorter way round the world
  const size = 512 * 2 ** a.zoom;
  if (bx - ax > size / 2) bx -= size;
  if (ax - bx > size / 2) bx += size;
  const w0 = Math.max(frame.width, frame.height);
  const w1 = w0 / 2 ** (b.zoom - a.zoom);
  const u1 = Math.hypot(bx - ax, by - ay);
  const rho2 = CURVE * CURVE;
  const rise = (down) => {
    const value = (w1 * w1 - w0 * w0 + (down ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (down ? w1 : w0) * rho2 * u1);
    return Math.log(Math.sqrt(value * value + 1) - value);
  };
  const r0 = rise(false);
  let width = (s) => Math.cosh(r0) / Math.cosh(r0 + CURVE * s);
  let along = (s) => (w0 * ((Math.cosh(r0) * Math.tanh(r0 + CURVE * s) - Math.sinh(r0)) / rho2)) / u1;
  let length = (rise(true) - r0) / CURVE;
  if (u1 < 1e-6 || !Number.isFinite(length)) {
    // no way to go: a zoom in or out on the spot, or nothing but a turn
    const sign = w1 < w0 ? -1 : 1;
    length = Math.abs(Math.log(w1 / w0)) / CURVE;
    along = () => 0;
    width = (s) => Math.exp(sign * CURVE * s);
  }
  const bearing = turn(a.bearing, b.bearing);
  return (k) => {
    if (k >= 1) return { ...b, bearing: b.bearing ?? 0, pitch: b.pitch ?? 0 };
    const s = k * length;
    const u = along(s);
    const [lon, lat] = fromWorld([ax + (bx - ax) * u, ay + (by - ay) * u], a.zoom);
    return { lat, lon: ((lon + 540) % 360) - 180, zoom: a.zoom - Math.log2(width(s)), bearing: (a.bearing ?? 0) + bearing * k,
      pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * k };
  };
}

/**
 * How far the ground at the frame's edge goes from the view `from` to the view `to`, in
 * the frame's pixels: what a blur as the map moves follows.
 */
export function motion(from, to, frame) {
  const [x, y] = project({ ...to, pitch: 0 }, frame, [from.lon, from.lat]);
  const reach = Math.max(frame.width, frame.height) / 2;
  return Math.max(Math.hypot(x - frame.width / 2, y - frame.height / 2), Math.abs(to.zoom - from.zoom) * Math.LN2 * reach,
    Math.abs(turn(from.bearing, to.bearing)) * (Math.PI / 180) * reach, Math.abs((to.pitch ?? 0) - (from.pitch ?? 0)) * (Math.PI / 180) * reach);
}

/**
 * Where a picture of a map's frame taken at the view `from` lands in the same frame at
 * the view `to`: the canvas transform `[a, b, c, d, e, f]` of a turn, a scale and a shift.
 */
export function pictureTransform(from, to, frame) {
  const flatFrom = { ...from, pitch: 0 };
  const flatTo = { ...to, pitch: 0 };
  const [x0, y0] = [frame.width / 2, frame.height / 2];
  const [cx, cy] = project(flatTo, frame, unproject(flatFrom, frame, [x0, y0]));
  const [sx, sy] = project(flatTo, frame, unproject(flatFrom, frame, [x0 + 100, y0]));
  const ux = (sx - cx) / 100;
  const uy = (sy - cy) / 100;
  return [ux, uy, -uy, ux, cx - ux * x0 + uy * y0, cy - uy * x0 - ux * y0];
}

/**
 * What a transition between two beats does, or null when it does nothing: `{ move, blur,
 * fade, appear, frames, first }`, `first` the frames the page or the maps take before
 * what is new appears over the rest. `moved` are the maps framed otherwise on the next
 * beat, `fresh` the elements it shows that the one before did not.
 */
export function transitionPlan(settings, { moved = [], fresh = [] } = {}, { cut = false } = {}) {
  if (!settings?.on || cut) return null;
  const move = !!settings.move && moved.length > 0;
  const appear = settings.appear && settings.appear !== 'none' && fresh.length > 0 ? settings.appear : 'none';
  const fade = !!settings.fade;
  if (!move && !fade && appear === 'none') return null;
  const frames = Math.max(2, Math.round((settings.seconds ?? 0.8) * TWEEN_FPS));
  const first = appear === 'none' ? frames : move || fade ? Math.round(frames * MOVE_SHARE) : 0;
  return { move, blur: move && settings.blur !== false, fade, appear, frames, first };
}

/** The maps framed otherwise on `after` than on `before`, and the elements `after` shows that `before` did not. */
export function changes(spec, before, after) {
  const moved = spec.elements.filter((element) => element.kind === 'map' && before.context.views?.[element.id] && after.context.views?.[element.id]
    && !sameView(before.context.views[element.id].view, after.context.views[element.id].view)).map((element) => element.id);
  const fresh = spec.elements.filter((element) => !MAP_KINDS.includes(element.kind) && !element.hidden
    && shownOn(element, after.context.at ?? null, after.context.place) && !shownOn(element, before.context.at ?? null, before.context.place))
    .map((element) => element.id);
  return { moved, fresh };
}

/**
 * The ways the maps of a move go, by id: `{ from, to, frame, at(k) }`. A moved map
 * flies; an inset over it follows, at the view it takes over the map's.
 */
function flights(spec, before, after, moved) {
  const out = {};
  for (const id of moved) {
    const a = before.context.views[id];
    const b = after.context.views[id];
    out[id] = { from: a.view, to: b.view, frame: b.frame, at: flight(a.view, b.view, b.frame) };
  }
  for (const inset of spec.elements) {
    const of = inset.kind === 'inset' ? out[inset.of] : null;
    const b = after.context.views?.[inset.id];
    if (!of || !b) continue;
    out[inset.id] = { from: insetView(inset, of.from), to: insetView(inset, of.to), frame: b.frame, at: (k) => insetView(inset, of.at(k)) };
  }
  return out;
}

/** A side of a transition's map, carried to the view `view`: its picture turned, scaled and shifted there. */
function carried(ctx, picture, from, view, frame) {
  if (!picture) return;
  ctx.save();
  ctx.transform(...pictureTransform(from, view, frame));
  ctx.drawImage(picture, 0, 0, frame.width, frame.height);
  ctx.restore();
}

/**
 * A canvas made blank again, its state as a new one's. `reset` keeps the pixels' memory
 * for the next frame; a browser without it is given its size again, which also wipes all.
 */
function blank(canvas) {
  const ctx = canvas.getContext('2d');
  if (typeof ctx.reset === 'function') ctx.reset();
  // the same width set again wipes the canvas
  else canvas.width = canvas.width;
}

/**
 * The canvases one transition draws on, one by part of the frame, kept from a frame to
 * the next. A 1080p frame is 10 MB a canvas and a frame of a move takes five: made anew
 * at every frame, they piled up faster than the garbage collector took them, and a
 * short video filled the memory. `take(part, width, height)` hands the part's canvas
 * blank, `end()` lets them all go.
 */
function easel(makeCanvas) {
  const kept = new Map();
  return {
    take(part, width, height) {
      let canvas = kept.get(part);
      if (!canvas) { canvas = makeCanvas(); kept.set(part, canvas); }
      if (canvas.width !== width || canvas.height !== height) {
        // a new size makes it blank
        canvas.width = width;
        canvas.height = height;
      } else blank(canvas);
      return canvas;
    },
    end() {
      for (const canvas of kept.values()) { canvas.width = 0; canvas.height = 0; }
      kept.clear();
    },
  };
}

/** A layer of the page, drawn on the see-through canvas of its `part`. */
function layer(spec, scale, take, part, draw) {
  const { width, height } = pageSize(spec.page);
  const canvas = take(part, Math.round(width * scale), Math.round(height * scale));
  draw(canvas.getContext('2d'));
  return canvas;
}

/** Two pictures of the same size mixed, `share` of the second: what is the same in both stays as it is. */
function mixed(spec, scale, take, part, first, second, share) {
  return layer(spec, scale, take, part, (ctx) => {
    ctx.globalAlpha = 1 - share;
    ctx.drawImage(first, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = share;
    ctx.drawImage(second, 0, 0);
  });
}

const madeCanvas = () => document.createElement('canvas');

/**
 * The frames of one transition, all on one canvas: read each before asking for the
 * next, which is drawn over it. `before` and `after` are the two beats as they were
 * drawn, `{ context }`: the context `draw.drawPage` drew them with, their maps'
 * pictures under `context.maps`. `plan` is `transitionPlan`'s.
 *
 * `sitting(id)` lends the live map of that id for the move: `{ at(view), end() }`,
 * `at` resolving to the map drawn again at that view. Without it, or for a map it
 * cannot lend, the two beats' pictures of the map are carried along the way instead.
 */
export async function* tweenFrames(spec, scale, before, after, plan, { moved = [], fresh = [] } = {}, { makeCanvas = madeCanvas, sitting = null } = {}) {
  const canvases = easel(makeCanvas);
  try {
    yield* framesOf(spec, scale, before, after, plan, { moved, fresh }, { take: canvases.take, sitting });
  } finally {
    canvases.end();
  }
}

async function* framesOf(spec, scale, before, after, plan, { moved, fresh }, { take, sitting }) {
  const reveal = plan.appear !== 'none' ? { ids: new Set(fresh), t: 0, mode: plan.appear } : null;
  const page = (context, part = 'frame') => layer(spec, scale, take, part, (ctx) => drawPage(ctx, spec, { ...context, scale, paper: true, editing: false }));
  if (plan.move) {
    const ways = flights(spec, before, after, moved);
    const lent = {};
    try {
      for (const id of Object.keys(ways)) lent[id] = (await sitting?.(id)) ?? null;
      // where each map stands at each frame, and how fast its ground goes there
      const at = (k) => Object.fromEntries(Object.entries(ways).map(([id, way]) => [id, way.at(k)]));
      const stands = [at(0)];
      for (let index = 1; index <= plan.first; index += 1) stands.push(at(ease(index / plan.first)));
      const speeds = stands.map((views, index) => (index ? Math.max(0, ...moved.map((id) => motion(stands[index - 1][id], views[id], ways[id].frame))) : 0));
      const fastest = Math.max(...speeds);
      for (let index = 1; index <= plan.first; index += 1) {
        const views = stands[index];
        const drawn = {};
        const placers = {};
        for (const [id, map] of Object.entries(lent)) {
          if (!map) continue;
          const { picture, placer } = await map.at(views[id]);
          drawn[id] = picture;
          if (placer) placers[id] = placer;
        }
        // the blur follows the speed, widest where the way is fastest, none for a move of a few pixels
        const blurred = fastest > 0 ? (speeds[index] / fastest) * Math.min(1, fastest / BLUR_FROM) : 0;
        yield movingFrame(spec, scale, before, after, { ways, views, drawn, placers, t: index / plan.first, blurred }, reveal, plan, take);
      }
    } finally {
      for (const map of Object.values(lent)) map?.end();
    }
  } else {
    const next = page({ ...after.context, reveal }, 'next');
    const last = page(before.context, 'last');
    for (let index = 1; index <= plan.first; index += 1) yield mixed(spec, scale, take, 'frame', last, next, ease(index / plan.first));
  }
  const rest = plan.frames - plan.first;
  for (let index = 1; index <= rest; index += 1) {
    yield page({ ...after.context, reveal: { ...reveal, t: ease(index / rest) } });
  }
}

/**
 * A frame of the maps moving: the paper, each map where the way has got (drawn again
 * there, or the two beats' pictures carried there), blurred as fast as it goes, and the
 * writing of both beats mixed over it, placed through the maps as they stand.
 */
function movingFrame(spec, scale, before, after, { ways, views, drawn, placers = {}, t, blurred }, reveal, plan, take) {
  // the writing changes over the middle of the way, the maps' old marks go early
  const share = plan.fade ? step(0.3, 0.7, t) : t < 0.5 ? 0 : 1;
  const gone = plan.fade ? step(0, 0.3, t) : 1;
  const ratio = scale / PX_PER_MM;
  const placed = (side) => {
    const out = { ...side.context.views };
    // a map in 3D places what is written over it through its camera as it stands at this frame
    for (const [id, way] of Object.entries(ways)) out[id] = { view: views[id], frame: way.frame, ...(placers[id] ?? {}) };
    return out;
  };
  return layer(spec, scale, take, 'frame', (ctx) => {
    drawBackground(ctx, spec, { ...after.context, scale });
    for (const element of spec.elements) {
      if (!MAP_KINDS.includes(element.kind) || element.hidden) continue;
      const a = before.context.views?.[element.id];
      const b = after.context.views?.[element.id];
      const was = before.context.maps?.[element.id];
      const is = after.context.maps?.[element.id];
      if ((!was && !is) || !b) continue;
      const way = ways[element.id];
      const view = way ? views[element.id] : b.view;
      const art = take(`map ${element.id}`, Math.round(b.frame.width * ratio), Math.round(b.frame.height * ratio));
      const actx = art.getContext('2d');
      actx.scale(ratio, ratio);
      if (drawn[element.id]) {
        // the map drawn again where the camera has got, the last beat's marks going over it
        actx.drawImage(drawn[element.id], 0, 0, b.frame.width, b.frame.height);
        if (gone < 1) { actx.globalAlpha = 1 - gone; carried(actx, was, way.from, view, b.frame); }
      } else {
        // each picture covers what the other leaves bare, and they mix where both stand
        carried(actx, was, way?.from ?? a?.view ?? b.view, view, b.frame);
        carried(actx, is, way?.to ?? b.view, view, b.frame);
        actx.globalAlpha = 1 - (way ? gone : share);
        carried(actx, was, way?.from ?? a?.view ?? b.view, view, b.frame);
      }
      // a blur as wide as the move is fast, laid over the sharp picture so the frame's edges stay full
      const blur = way && plan.blur ? b.frame.width * MOST_BLUR * blurred * ratio : 0;
      if (blur > 0.4) {
        actx.setTransform(1, 0, 0, 1, 0, 0);
        actx.globalAlpha = 1;
        actx.filter = `blur(${blur.toFixed(1)}px)`;
        actx.drawImage(art, 0, 0);
        actx.filter = 'none';
      }
      const box = element.box.map((value) => value * scale);
      ctx.save();
      ctx.beginPath(); ctx.rect(box[0], box[1], box[2], box[3]); ctx.clip();
      ctx.globalAlpha = element.opacity ?? 1;
      ctx.drawImage(art, box[0], box[1], box[2], box[3]);
      ctx.restore();
    }
    const writing = (side, part, extra = {}) => layer(spec, scale, take, part, (lctx) => drawPage(lctx, spec, { ...side.context, ...extra, scale,
      views: placed(side), maps: undefined, paper: false, editing: false }));
    ctx.drawImage(mixed(spec, scale, take, 'mix', writing(before, 'before'), writing(after, 'after', { reveal }), share), 0, 0);
  });
}
