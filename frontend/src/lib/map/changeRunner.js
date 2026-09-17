/**
 * Hand a change detection to the worker, or run it here where there is none.
 *
 * One worker, started on first use and kept: Difference reruns on every
 * settled camera, and a worker's start-up would cost more than the work. A
 * newer request does not cancel an older one in the worker (a computation
 * cannot be interrupted), so callers compare their own request number.
 */
import { detectChange } from './changeDetect.js';

let worker = null;
let serial = 0;
const pending = new Map();

function startWorker() {
  if (worker || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./changeWorker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
    return null;
  }
  worker.onmessage = (event) => {
    const { id, result, error } = event.data;
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    if (error) waiting.reject(new Error(error));
    else waiting.resolve(result);
  };
  worker.onerror = (event) => {
    const failure = new Error(event.message || 'the change worker stopped');
    for (const waiting of pending.values()) waiting.reject(failure);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** @param {Parameters<typeof detectChange>[0]} input */
export function runChangeDetection(input) {
  const running = startWorker();
  if (!running) {
    return new Promise((resolve, reject) => {
      try {
        resolve(detectChange(input));
      } catch (error) {
        reject(error);
      }
    });
  }
  const id = ++serial;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    running.postMessage({ id, input });
  });
}
