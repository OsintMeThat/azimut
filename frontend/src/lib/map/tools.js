/**
 * The map's tools, declared once.
 *
 * A map tool used to be three edits in three places: a button in a cluster, a
 * panel floated somewhere beside it, and a line in whichever `toggle…` function
 * happened to know about it. Twelve more tools are on the roadmap for this
 * surface (3D, resection, compare, wayback, event layers, viewshed, tracks,
 * boards), so the third one to arrive would have been the third rewrite of the
 * same four-button cluster.
 *
 * So a tool declares itself here and the chrome is built from the declaration:
 * the rail renders the entries, the surface takes its cursor from whichever is
 * armed, and the panel slot shows that one's settings. Adding a tool is a
 * descriptor plus its panel — no edit to the host.
 *
 * **Nothing in this file touches a store, a component or the DOM.** The
 * descriptors are data and the three functions below are arithmetic over a
 * handler map the host supplies, which is what lets the exclusion rule — the
 * part that was previously spread over four `toggle…` functions calling each
 * other — be tested without a browser (`tools.test.js`).
 */

/**
 * The pointer modes, in rail order.
 *
 * `group` breaks the rail into sections: the separator between two groups is
 * the whole of the rail's grammar, and keeping it in the data means a new tool
 * files itself under an existing heading instead of growing a flat list of
 * fifteen icons.
 *
 * `cursor` is the name the surface puts on itself while this mode is armed
 * (`MapSurface`'s `armed`), which is what turns the pointer into a crosshair. A
 * mode with no cursor changes what a click *means* without changing how the map
 * is pointed at.
 *
 * `rail: false` declares a mode that is armed from somewhere else — the capture
 * marquee is armed from the Capture button, because arming it is half of
 * pressing Capture and nobody would look for it in a toolbox. It is still
 * declared, because the exclusion rule has to know it exists.
 */
export const MAP_MODES = [
  {
    id: 'measure',
    label: 'Measure tools',
    icon: 'ruler',
    group: 'work',
    cursor: 'measuring',
    panel: true,
  },
  {
    id: 'grid',
    label: 'Grid Search',
    icon: 'grid',
    group: 'work',
    cursor: 'grid-drawing',
    panel: true,
  },
  {
    id: 'sky',
    label: 'Sun and moon',
    icon: 'sun',
    group: 'read',
    panel: true,
  },
  {
    id: 'capture',
    label: 'Select area',
    icon: 'crop',
    group: 'capture',
    cursor: 'selecting',
    panel: false,
    rail: false,
  },
  {
    // Armed from a saved place's own card, for the same reason the marquee is
    // armed from Capture: a footprint is *this* place's shape, and a rail seat
    // would offer to trace one for nobody.
    id: 'footprint',
    label: 'Trace footprint',
    icon: 'polygon',
    group: 'work',
    cursor: 'tracing',
    panel: true,
    rail: false,
  },
];

/**
 * The rail's one-shot entries: they do something and arm nothing.
 *
 * Reference windows are the only one today. It sits in the rail rather than
 * among the layers because opening one is an act — a picker, a choice, a window
 * — while the layers panel lists things that are simply on or off.
 */
export const MAP_ACTIONS = [
  {
    id: 'reference',
    label: 'Add reference',
    icon: 'image',
    group: 'read',
    hint: 'Add a reference image or video over the map',
  },
];

/** The rail's entries, in order, with the one-shot actions filed in their group. */
export function railEntries(modes = MAP_MODES, actions = MAP_ACTIONS) {
  return [
    ...modes.filter((mode) => mode.rail !== false).map((mode) => ({ ...mode, kind: 'mode' })),
    ...actions.map((action) => ({ ...action, kind: 'action' })),
  ];
}

/**
 * Those entries cut into the sections the rail draws a hairline between.
 *
 * Group order follows first appearance rather than a second list to keep in
 * step: moving a tool between groups is one edit to its descriptor.
 */
export function railSections(entries = railEntries()) {
  const sections = [];
  for (const entry of entries) {
    const last = sections[sections.length - 1];
    if (last && last.group === entry.group) last.entries.push(entry);
    else sections.push({ group: entry.group, entries: [entry] });
  }
  return sections;
}

/**
 * Which mode is armed, from the handler map the host supplies.
 *
 * A handler is `{ isOn, open, close }` closing over that tool's own store, so
 * this file never learns that Grid Search keeps a boolean and the measure tools
 * keep a sub-mode string.
 */
export function armedId(handlers) {
  for (const [id, handler] of Object.entries(handlers)) {
    if (handler?.isOn()) return id;
  }
  return null;
}

/**
 * Arm one mode and only that one, or disarm it if it was already armed.
 *
 * This is the rule that used to live as pairwise calls between four `toggle…`
 * functions — where "sun turns off capture, measure and grid" and "grid turns
 * off capture and measure" were two separate pieces of knowledge, and a fifth
 * tool would have had to be added to every one of them. Here, arming anything
 * closes everything else by construction.
 *
 * @returns {string|null} what is armed afterwards.
 */
export function arm(handlers, id) {
  const target = handlers[id];
  if (!target) return armedId(handlers);
  if (target.isOn()) {
    target.close();
    return armedId(handlers);
  }
  closeOthers(handlers, id);
  target.open();
  return armedId(handlers);
}

/**
 * Everything except one mode, closed.
 *
 * What a mode armed from outside the rail owes the others: the capture marquee
 * arms itself from the Capture button, and reports in here so that pressing it
 * while Grid Search is drawing does not leave two modes waiting for the same
 * left drag.
 */
export function closeOthers(handlers, id) {
  for (const [key, handler] of Object.entries(handlers)) {
    if (key !== id && handler?.isOn()) handler.close();
  }
}

/** Close whatever is armed. What Escape does when no tool claimed the key first. */
export function disarm(handlers) {
  for (const handler of Object.values(handlers)) {
    if (handler?.isOn()) handler.close();
  }
}

/**
 * The cursor name the surface wears for what is armed.
 *
 * Returned as null rather than an empty string when nothing is armed, because
 * that is what `MapSurface` reads as "the map is just a map".
 */
export function cursorOf(id, modes = MAP_MODES) {
  return modes.find((mode) => mode.id === id)?.cursor ?? null;
}

/** Whether the armed mode brings a panel with it, so the slot knows to open. */
export function hasPanel(id, modes = MAP_MODES) {
  return Boolean(modes.find((mode) => mode.id === id)?.panel);
}
