/**
 * Compare's frame tool armed for a note rather than for an export. One put waits at a
 * time and is answered with the frame drawn. Escape, a click, the put's Cancel or
 * another put call it off with an AbortError, which the note says nothing about. The
 * frame never becomes the export's own.
 *
 * `arm()` shows the frame tool, `disarm()` puts it away.
 */

const calledOff = (words) => Object.assign(new Error(words), { name: 'AbortError' });

export function createNoteFrame({ arm, disarm }) {
  let pending = $state.raw(null); // { resolve, reject } while a put waits for its area

  /** Call the waiting put off. The caller puts the frame tool away. */
  function drop(words = 'No area was drawn') {
    const was = pending;
    pending = null;
    was?.reject(calledOff(words));
  }

  return {
    /** Whether a put waits for its area, which the frame tool then says. */
    get waiting() {
      return pending !== null;
    },

    /** Arm the frame tool for a put, answering the frame drawn. */
    ask({ signal } = {}) {
      drop('Another area was asked for');
      if (signal?.aborted) return Promise.reject(calledOff('No area was drawn'));
      return new Promise((resolve, reject) => {
        const mine = { resolve, reject };
        pending = mine;
        arm();
        signal?.addEventListener('abort', () => {
          if (pending !== mine) return;
          pending = null;
          disarm();
          reject(calledOff('No area was drawn'));
        }, { once: true });
      });
    },

    /** Hand the frame drawn to the waiting put: true, or false when no put waits. */
    take(frame) {
      const was = pending;
      if (!was) return false;
      pending = null;
      disarm();
      was.resolve(frame);
      return true;
    },

    drop,
  };
}
