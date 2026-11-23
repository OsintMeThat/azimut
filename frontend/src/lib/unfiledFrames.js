/**
 * The frames Inspect cut from a video that the case does not hold yet, drawn from the
 * video for a list that shows them: Geo Proof's Make the proof chooser and New proof
 * (`tools/ProofComposer.svelte`), and the Geolocating pill's list
 * (`components/GatheredPanel.svelte`). Each is drawn, and filed, through the edits
 * Inspect keeps for it (crop, turn, sliders), so it comes out as Inspect would save it.
 */
import { api } from './api.js';
import { buildFrameOps, sliderFilters } from './inspect.js';

// Inspect's sliders, read once for every list.
let sliders = null;

/** The recipe a frame's edits (`sourceOps`, `rotation`, `adjust`, `crop`) render it through. */
export async function frameOps(edits) {
  if (!edits || !Object.keys(edits).length) return [];
  sliders ??= sliderFilters((await api.get('/api/inspect/ops')).filters);
  return buildFrameOps(sliders, edits);
}

/**
 * What one list drew. `draw` renders its frames with no picture yet (`url`), one after
 * the other and at most `limit`, each taking its picture as it comes in the list shown
 * now (`held()`, null once it closed). The first that cannot be drawn ends the run, the
 * rest keeping the list's own fallback. `drop` lets every picture go once nothing shows
 * them, and stops the ones still on their way.
 */
export function frameDrawer() {
  let urls = [];
  const asking = new Set();
  let line = Promise.resolve();
  let era = 0;

  async function drawRun(caseId, video, frames, held, limit, mine) {
    for (const frame of frames.filter((f) => !f.url).slice(0, limit)) {
      if (mine !== era || !held()) return;
      const ask = new AbortController();
      asking.add(ask);
      try {
        const res = await fetch(`/api/cases/${caseId}/inspect/render-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: video, time: frame.time, ops: await frameOps(frame.edits), format: 'jpeg' }),
          signal: ask.signal,
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (mine !== era || !held()) return;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const one = held()?.find((f) => f.id === frame.id);
        if (one) one.url = url;
      } catch {
        return;
      } finally {
        asking.delete(ask);
      }
    }
  }

  return {
    draw(caseId, video, frames, held, { limit = 24 } = {}) {
      const mine = era;
      const run = line.then(() => drawRun(caseId, video, frames, held, limit, mine));
      line = run;
      return run;
    },
    drop() {
      era += 1;
      for (const ask of asking) ask.abort();
      asking.clear();
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    },
  };
}
