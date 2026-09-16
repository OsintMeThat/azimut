/** Runs `detectChange` off the main thread, so a pan never waits on a heatmap. */
import { detectChange } from './changeDetect.js';

self.onmessage = (event) => {
  const { id, input } = event.data;
  try {
    const result = detectChange(input);
    self.postMessage({ id, result }, [result.pixels.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? String(error) });
  }
};
