/**
 * Save-as-you-go for a document a tool holds in memory.
 *
 * Call `schedule()` after every change; the write runs once the changes have
 * stopped for `delay` ms, so a slider drag is one save rather than sixty. Only one
 * write is ever in flight: a change made during it is written right after, never
 * alongside, because two racing writes can land in either order.
 *
 * `write` reads the document when it runs rather than when it was scheduled, so a
 * burst of edits is saved as it ended. It may resolve without writing anything
 * when nothing changed since the last save.
 *
 * `flush()` writes whatever is pending and waits for it. A tool calls it before it
 * lets go of the document: switching file, closing the case, leaving the tool.
 */
export function createAutosave({ write, delay = 800 }) {
  const state = $state({ status: 'idle', error: '' });
  let timer = null;
  let running = null;
  let again = false;

  async function run() {
    clearTimeout(timer);
    timer = null;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      state.status = 'saving';
      try {
        await write();
        state.status = 'saved';
        state.error = '';
      } catch (e) {
        state.status = 'error';
        state.error = e?.message || 'save failed';
      }
    })();
    try {
      await running;
    } finally {
      running = null;
    }
    if (again) {
      again = false;
      await run();
    }
  }

  return {
    state,
    schedule() {
      state.status = 'pending';
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    },
    async flush() {
      if (timer || again) return run();
      if (running) await running;
    },
    /** Forget a pending write, for a document that is being thrown away. */
    cancel() {
      clearTimeout(timer);
      timer = null;
      again = false;
      state.status = 'idle';
      state.error = '';
    },
    /** Whether a write is scheduled or running, so a page closing can send it. */
    get pending() {
      return timer !== null || running !== null;
    },
  };
}
