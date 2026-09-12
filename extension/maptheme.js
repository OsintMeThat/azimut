/**
 * The app's own look, over someone else's map.
 *
 * Every value here is a copy of one the app already states — the design tokens
 * in `frontend/src/app.css`, the icon set in `components/Icon.svelte`, the cell
 * and ray styles the map tools paint with. The extension cannot import any of
 * them (flat classic scripts, no build step), so they are written a second time
 * and `frontend/src/lib/extensionMapTheme.test.js` reads both sides and fails on
 * the first one that drifts.
 *
 * That is the whole point of the file: an analyst switching between the app's
 * map and a browser tab should not be able to tell which one they are looking
 * at, and "looks about right" is exactly the kind of thing that rots quietly.
 */

(() => {
  /** Palette — `app.css`, the dark theme, which is the one the panel is. */
  const TOKENS = {
    bg0: "#151515",
    bg1: "#1c1c1c",
    bg2: "#252525",
    bg3: "#2f2f2f",
    border: "rgba(255, 255, 255, 0.09)",
    borderStrong: "rgba(255, 255, 255, 0.18)",
    text1: "#e3e3e3",
    text2: "#9f9f9f",
    text3: "#6c6c6c",
    accent: "#e8a33d",
    accentHover: "#f4b558",
    accentText: "#141414",
    ok: "#66b578",
    warn: "#d9a53f",
    danger: "#d97070",
    info: "#6f9fd8",
    skySun: "#bd8721",
    skyMoon: "#4a93cc",
  };

  /**
   * Status → cell paint, from `state/grid.svelte.js`.
   *
   * Unchecked is a bright thin outline so the lattice reads over dark imagery;
   * cleared greys the cell out; flagged fills yellow, chosen over red so it
   * reads for colour-blind analysts too.
   */
  const CELL_STYLE = {
    unchecked: { stroke: "#ffffff", strokeWidth: 1, strokeOpacity: 0.7, fill: "#fff", fillOpacity: 0 },
    cleared: { stroke: "#ffffff", strokeWidth: 1, strokeOpacity: 0.55, fill: "#2b3040", fillOpacity: 0.62 },
    flagged: { stroke: "#ffcf33", strokeWidth: 1.5, strokeOpacity: 1, fill: "#ffdb4d", fillOpacity: 0.6 },
  };

  /** The area of interest, and the one being dragged out. */
  const AOI_STYLE = { stroke: "#f5a623", strokeWidth: 1.5, strokeOpacity: 0.9, dash: [5, 4] };
  const DRAFT_STYLE = { stroke: "#f5a623", strokeWidth: 1.5, strokeOpacity: 0.95, dash: [5, 4] };

  /** Measure, from `state/measure.svelte.js`. */
  const MEASURE_STROKE = { stroke: "#f5a623", strokeWidth: 2.5, strokeOpacity: 0.95 };
  const MEASURE_FILL = { fill: "#f5a623", fillOpacity: 0.15 };
  const MEASURE_DOT = { radius: 4, stroke: "#fff", strokeWidth: 2, fill: "#f5a623", fillOpacity: 1 };

  /** The 24x24 stroke icons of `components/Icon.svelte`, the ones this panel
   *  draws. Same paths, same viewBox, same stroke rules. */
  const ICONS = {
    ruler: "M4 15.5 15.5 4l4.5 4.5L8.5 20 4 15.5Zm3.5-.5 1.5 1.5m1-4.5 1.5 1.5m1-4.5L14 11",
    pin: "M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
    moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
    grid: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
    polygon: "M12 3.5 20 9.5l-3 9.5H7L4 9.5l8-6Z",
    square: "M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
    x: "M6 6l12 12M18 6 6 18",
    chevronDown: "m6 9 6 6 6-6",
    chevronUp: "m6 15 6-6 6 6",
    eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5-3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
    eyeOff: "M9.9 9.9a3 3 0 1 0 4.2 4.2M10.7 5.7A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.8 17.8 0 0 1-2.2 3M6.6 6.6C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1.1M3 3l18 18",
    save: "M5 3h11l3 3v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 0v5h7V3M7 21v-7h10v7",
    trash: "M4 7h16m-2 0-1 13H7L6 7m3 0V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-6 4v6m4-6v6",
    undo: "M8 5 4 9l4 4M4 9h10a6 6 0 0 1 0 12h-4",
    check: "m4.5 12.5 5 5 10-11",
    plus: "M12 5v14m-7-7h14",
    minus: "M5 12h14",
    crosshair: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0-1v4m0 12v4M2 12h4m12 0h4",
    satellite: "M9 4.2 3.6 6.4a1 1 0 0 0-.6.9v11.2a1 1 0 0 0 1.4.9L9 17.4l6 2.4 5.4-2.2a1 1 0 0 0 .6-.9V5.5a1 1 0 0 0-1.4-.9L15 6.6 9 4.2Zm0 0v13.2M15 6.6v13.2",
    proof: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm11.5 0v7m-3.5-3.5h7",
    screen: "M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm5 15h6m-3-4v4",
    alert: "M12 3 2.5 19.5h19L12 3Zm0 7v4m0 3.5h.01",
    folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
    image: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 12 4-4a1 1 0 0 1 1.4 0l4.6 4M9 9.5h.01",
    video: "M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm12 4 5-3v10l-5-3",
    grip: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
    minimize: "M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3",
  };

  /** One icon as an inline SVG string, for the panel's own markup. */
  function icon(name, size = 16) {
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"` +
      ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="${ICONS[name] ?? ICONS.alert}"/></svg>`
    );
  }

  /** Which glyph a saved row is drawn with — `SavedOverlay.svelte`'s own map.
   *  A stack holding more than one kind falls back to the place glyph. */
  const SAVED_GLYPH = { place: "pin", capture: "satellite", screenshot: "screen", proof: "proof" };

  window.AzimutMapTheme = {
    TOKENS,
    CELL_STYLE,
    AOI_STYLE,
    DRAFT_STYLE,
    MEASURE_STROKE,
    MEASURE_FILL,
    MEASURE_DOT,
    ICONS,
    SAVED_GLYPH,
    icon,
  };
})();
