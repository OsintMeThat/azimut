/**
 * Figures: the same ground on one day, through several layers.
 *
 * The layout and the wording belong to the backend (`engine/figures.py`), which
 * writes the Geo Proof. What the browser needs is the shape of the request, so
 * the dialog can stop a figure the route would refuse rather than render four
 * panels and then fail.
 *
 * These two numbers mirror the engine's. `tests/test_figures.py` reads this
 * file and fails if they drift.
 */

/** Panels a figure may hold. Past this it is a contact sheet, not a figure. */
export const MAX_PANELS = 8;

/** Panels per row, which is what the published figures this was built for use. */
export const DEFAULT_PER_ROW = 2;
