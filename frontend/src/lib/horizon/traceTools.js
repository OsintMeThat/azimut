/**
 * The tools a trace is edited with, shared by the photo's band over the view
 * (tools/horizon/OverlayBar.svelte) and Find's photo (FindPhoto.svelte), so
 * both say and do the same. One tool is out at a time; pressing the one out
 * puts it away.
 *
 *   sky     the pen along the skyline, where the land meets the sky
 *   ridge   the pen along an inner edge, a ridge seen against farther land
 *   behind  a click on the stroke in front, then on the one behind it
 *   cut     a click lays a cut across a collage where its frames meet
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
  if (id === "sky" || id === "ridge")
    return Boolean(overlay.tracing) && overlay.pen === id;
  if (id === "behind") return Boolean(overlay.linking);
  if (id === "cut") return Boolean(overlay.cutting);
  if (id === "erase") return Boolean(overlay.erasing);
  return false;
}

/** Whether any tool that edits the trace is out. */
export function editing(overlay) {
  return Boolean(
    overlay.tracing || overlay.erasing || overlay.linking || overlay.cutting,
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
  if (terrain) items.push({ id: "terrain", label: "Terrain skyline" });
  if (ridgeLines) items.push({ id: "ridge-lines", label: "Terrain ridges" });
  if (level) items.push({ id: "level", label: "Eye level" });
  if (detailsShown(overlay)) {
    if (terrain) items.push({ id: "margin", label: "Terrain may be off" });
    if (marks?.cuts?.length) items.push({ id: "cut", label: "Cut" });
    if (marks?.pairs?.length)
      items.push({ id: "pair", label: "In front, behind" });
  }
  return items;
}

/** Why a tool cannot come out now, or '' when it can. */
export function toolBlocked(overlay, id) {
  if (id === "behind" && overlay.strokes.length < 2)
    return "Draw two lines first";
  if (id === "erase" && !overlay.strokes.length)
    return "Nothing to rub out yet";
  return "";
}

/** Bring a tool out, or put it away when it is out already. */
export function pressTool(overlay, id) {
  const on = toolOn(overlay, id);
  if (id === "sky" || id === "ridge") {
    if (on) overlay.setTracing(false);
    else overlay.setPen(id);
  } else if (id === "behind") overlay.setLinking(!on);
  else if (id === "cut") overlay.setCutting(!on);
  else if (id === "erase") overlay.setErasing(!on);
}

/** Every editing tool put away. */
export function putAway(overlay) {
  overlay.setTracing(false);
  overlay.setErasing(false);
  overlay.setLinking(false);
  overlay.setCutting(false);
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
  if (overlay.tracing) {
    const what =
      overlay.pen === "ridge"
        ? "Draw along a ridge seen against farther land"
        : "Draw along the skyline";
    return `${what} · ${overlay.magnet ? "it snaps to the edge · Alt draws freely" : "drawn as is · Alt snaps it"} · a click on a line makes it this kind`;
  }
  return "";
}
