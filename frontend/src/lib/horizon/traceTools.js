/**
 * The tools a trace is edited with, shared by the photo's band over the view
 * (tools/horizon/OverlayBar.svelte) and Find's photo (FindPhoto.svelte), so
 * both say and do the same. One tool is out at a time; pressing the one out
 * puts it away.
 *
 *   sky     the pen along the skyline, where the land meets the sky
 *   ridge   the pen along an inner edge, a ridge seen against farther land
 *   sea     the pen along the sea's horizon, where the sky meets open sea
 *   behind  a click on the stroke in front, then on the one behind it
 *   cut     a click lays a cut across a collage where its frames meet
 *   far     the distances picked, then a click on a line says it stands that far
 *   clear   a click on a skyline line says only sky stands above it
 *   key     a click on a skyline line says it matters most
 *   bent    a brush over a part of the picture that may be bent
 *   hazy    a brush over a part where far land may be hidden, by haze or the night
 *   erase   the rubber
 *
 * The magnet beside them snaps what the pens draw onto the photo's edges;
 * Alt held while drawing does the other.
 */

export const TRACE_TOOLS = Object.freeze([
  {
    id: "sky",
    icon: "freehand",
    label: "Skyline",
    name: "Trace skyline",
    key: "T",
    title: "Draw the skyline, where the land meets the sky (T)",
  },
  {
    id: "ridge",
    icon: "ridge",
    label: "Ridge",
    name: "Trace a ridge",
    key: "R",
    title: "Draw a ridge seen against farther land, not the sky (R)",
  },
  {
    id: "sea",
    icon: "horizon",
    label: "Sea line",
    name: "Trace the sea's horizon",
    key: "S",
    title: "Draw the sea's horizon, where the sky meets open sea (S)",
  },
  {
    id: "behind",
    icon: "layers",
    label: "Behind",
    name: "Pair a line in front with one behind",
    key: "P",
    title: "Pair two lines: click the one in front, then the one behind it (P)",
  },
  {
    id: "cut",
    icon: "scissors",
    label: "Cut",
    name: "Cut the collage",
    key: "X",
    title:
      "Cut a collage where its frames meet: each piece is fitted a little on its own (X)",
  },
  {
    id: "far",
    icon: "ruler",
    label: "Distance",
    name: "Say how far a line stands",
    key: "K",
    title: "Say how far a line stands: pick the distances, then click the line (K)",
  },
  {
    id: "clear",
    icon: "skyClear",
    label: "Sky only",
    name: "Say only sky stands above a line",
    key: "O",
    title: "Click a skyline line you are sure has only sky above it (O)",
  },
  {
    id: "key",
    icon: "star",
    label: "Key line",
    name: "Mark a key line",
    key: "I",
    title: "Click the skyline lines that matter most, a peak or a notch you would know anywhere: three at most (I)",
  },
  {
    id: "bent",
    icon: "brush",
    label: "May be bent",
    name: "Brush where the picture may be bent",
    key: "G",
    title: "Brush over a part of the picture that may be bent, a wide lens's edge or a stretched piece: its lines count less (G)",
  },
  {
    id: "hazy",
    icon: "haze",
    label: "Far land hidden",
    name: "Brush where far land may be hidden",
    key: "F",
    title: "Brush over a part where haze or the night may hide far land: its skyline is read as a ridge in front of it (F)",
  },
  {
    id: "erase",
    icon: "eraser",
    label: "Rub out",
    name: "Rub out part of the trace",
    key: "E",
    title: "Rub out part of the trace (E)",
  },
]);

/** The magnet's title as it stands. */
export const magnetTitle = (on) =>
  on
    ? "Snap to edges is on: a line drawn moves onto the nearest edge (M, Alt for once)"
    : "Snap to edges is off: lines stay as drawn (M, Alt for once)";

/** The tool a key brings out or puts away, or null. */
export function toolForKey(key) {
  const upper = String(key ?? "").toUpperCase();
  return TRACE_TOOLS.find((tool) => tool.key === upper)?.id ?? null;
}

/** Whether a tool is out. */
export function toolOn(overlay, id) {
  if (id === "sky" || id === "ridge" || id === "sea")
    return Boolean(overlay.tracing) && overlay.pen === id;
  if (id === "behind") return Boolean(overlay.linking);
  if (id === "cut") return Boolean(overlay.cutting);
  if (id === "far") return Boolean(overlay.distancing);
  if (id === "clear") return Boolean(overlay.clearing);
  if (id === "key") return Boolean(overlay.keying);
  if (id === "bent" || id === "hazy") return Boolean(overlay.bending) && (overlay.brushKind ?? "bent") === id;
  if (id === "erase") return Boolean(overlay.erasing);
  return false;
}

/** Whether any tool that edits the trace is out. */
export function editing(overlay) {
  return Boolean(
    overlay.tracing ||
      overlay.erasing ||
      overlay.linking ||
      overlay.cutting ||
      overlay.distancing ||
      overlay.clearing ||
      overlay.keying ||
      overlay.bending,
  );
}

/** Whether the trace's details show: the terrain's margin, the cuts, the pairs' letters. Asked for, or a tool is out. */
export function detailsShown(overlay) {
  return Boolean(overlay.details) || editing(overlay);
}

/** The details switch's title as it stands. */
export const detailsTitle = (on) =>
  on
    ? "Hide how far the terrain may be off, the cuts and the pairs (D)"
    : "Show how far the terrain may be off, the cuts and the pairs (D)";

/**
 * What the view's legend names, in order, as `{ id, label }`: the trace's
 * colours once it is read against the terrain (`coloured`), the ridges, the
 * terrain's skyline (`terrain`), the terrain's own ridge lines and the eye's
 * level when the view draws them (`ridgeLines`, `level`), and while the
 * details show, the margin, the cuts and the pairs there are.
 */
export function traceLegend(
  overlay,
  { coloured = false, terrain = false, ridgeLines = false, level = false } = {},
) {
  const marks = overlay.marks;
  const items = coloured
    ? [
        { id: "on", label: "On the terrain" },
        { id: "near", label: "Near" },
        { id: "off", label: "Off" },
      ]
    : [{ id: "trace", label: "Your trace" }];
  if (marks?.inner?.length) items.push({ id: "ridge", label: "Ridge" });
  if (marks?.bent?.length) items.push({ id: "bent", label: "May be bent" });
  if (marks?.hazy?.length) items.push({ id: "hazy", label: "Far land hidden" });
  if (marks?.sea?.length) items.push({ id: "sea", label: "Sea line" });
  if (terrain) items.push({ id: "terrain", label: "Terrain skyline" });
  if (ridgeLines) items.push({ id: "ridge-lines", label: "Terrain ridges" });
  if (level) items.push({ id: "level", label: "Eye level" });
  if (detailsShown(overlay)) {
    if (terrain) items.push({ id: "margin", label: "Terrain may be off" });
    if (marks?.cuts?.length) items.push({ id: "cut", label: "Cut" });
    if (marks?.pairs?.length)
      items.push({ id: "pair", label: "In front, behind" });
    if (marks?.clear?.length) items.push({ id: "clear", label: "Only sky above" });
    if (marks?.key?.length) items.push({ id: "key", label: "Key line" });
  }
  return items;
}

/** Why a tool cannot come out now, or '' when it can. */
export function toolBlocked(overlay, id) {
  if (id === "behind" && overlay.strokes.length < 2)
    return "Draw two lines first";
  if (id === "erase" && !overlay.strokes.length)
    return "Nothing to rub out yet";
  if ((id === "far" || id === "clear" || id === "key") && !overlay.strokes.length) return "Draw a line first";
  return "";
}

/** Bring a tool out, or put it away when it is out already. */
export function pressTool(overlay, id) {
  const on = toolOn(overlay, id);
  if (id === "sky" || id === "ridge" || id === "sea") {
    if (on) overlay.setTracing(false);
    else overlay.setPen(id);
  } else if (id === "behind") overlay.setLinking(!on);
  else if (id === "cut") overlay.setCutting(!on);
  else if (id === "far") overlay.setDistancing(!on);
  else if (id === "clear") overlay.setClearing(!on);
  else if (id === "key") overlay.setKeying(!on);
  else if (id === "bent" || id === "hazy") overlay.setBending(!on, id);
  else if (id === "erase") overlay.setErasing(!on);
}

/** Every editing tool put away. */
export function putAway(overlay) {
  overlay.setTracing(false);
  overlay.setErasing(false);
  overlay.setLinking(false);
  overlay.setCutting(false);
  overlay.setDistancing(false);
  overlay.setClearing(false);
  overlay.setKeying(false);
  overlay.setBending(false);
}

/** What the trace holds besides the skyline, in a few words: '' when nothing. */
export function marksSummary(marks) {
  if (!marks) return "";
  const parts = [];
  const ridges = new Set(marks.inner).size;
  if (ridges) parts.push(ridges === 1 ? "1 ridge" : `${ridges} ridges`);
  if (marks.pairs.length)
    parts.push(
      marks.pairs.length === 1 ? "1 pair" : `${marks.pairs.length} pairs`,
    );
  if (marks.cuts.length)
    parts.push(
      marks.cuts.length === 1 ? "2 pieces" : `${marks.cuts.length + 1} pieces`,
    );
  if (marks.far?.length)
    parts.push(
      marks.far.length === 1 ? "1 distance" : `${marks.far.length} distances`,
    );
  if (marks.sea?.length)
    parts.push(marks.sea.length === 1 ? "1 sea line" : `${marks.sea.length} sea lines`);
  if (marks.clear?.length)
    parts.push(marks.clear.length === 1 ? "1 line with only sky above" : `${marks.clear.length} lines with only sky above`);
  if (marks.key?.length)
    parts.push(marks.key.length === 1 ? "1 key line" : `${marks.key.length} key lines`);
  if (marks.bent?.length) parts.push("a part that may be bent");
  if (marks.hazy?.length) parts.push("far land hidden in part");
  return parts.join(" · ");
}

/** What the tool out asks for, said under the view while it is out. */
export function toolHint(overlay) {
  if (overlay.linking) {
    return overlay.front === null
      ? "Click the line in front · then the line behind it · the same two again take the pair away"
      : "Now click the line behind it · Esc to stop";
  }
  if (overlay.cutting)
    return "Click where two frames of the collage meet · click a cut to take it away";
  if (overlay.distancing)
    return "Pick how far, then click a line · the same again takes it away";
  if (overlay.clearing)
    return "Click a skyline line with only sky above it, no land rising over it · the same again takes it back";
  if (overlay.keying)
    return "Click a skyline line that matters most, three at most · the same again takes it back";
  if (overlay.bending && overlay.brushKind === "hazy")
    return "Brush over the part where far land may be hidden · a click on a brushed part takes it away";
  if (overlay.bending)
    return "Brush over the part of the picture that may be bent · a click on a brushed part takes it away";
  if (overlay.tracing) {
    const what =
      overlay.pen === "ridge"
        ? "Draw along a ridge seen against farther land"
        : overlay.pen === "sea"
          ? "Draw along the sea's horizon"
          : "Draw along the skyline";
    return `${what} · ${overlay.magnet ? "it snaps to the edge · Alt draws freely" : "drawn as is · Alt snaps it"} · a click on a line makes it this kind`;
  }
  return "";
}
