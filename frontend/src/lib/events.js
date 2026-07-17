/**
 * App side of the server's SSE nudge channel (/api/events, api/events.py).
 *
 * The capture extension files screenshots while the app tab just sits there —
 * this subscription is how a capture shows up without a reload. Same-origin
 * only (the app's own backend), so the local-first rule holds: nothing here
 * ever leaves the machine.
 *
 * Events are nudges, not data: a handler reacts by re-fetching through the
 * normal API. EventSource reconnects by itself, and a missed nudge costs a
 * manual refresh, never correctness.
 */

const handlers = new Map(); // event type -> Set<callback>
let source = null;

/** Route one event object to its type's subscribers. Exported for tests. */
export function dispatch(event) {
  if (!event || typeof event.type !== 'string') return;
  for (const cb of handlers.get(event.type) ?? []) {
    try {
      cb(event);
    } catch {
      /* one broken handler must not starve the others */
    }
  }
}

/** Open the stream once per page life. No-op where EventSource is missing
 * (tests) or when already started. */
export function startEvents(EventSourceImpl = globalThis.EventSource) {
  if (source || !EventSourceImpl) return;
  source = new EventSourceImpl('/api/events');
  source.onmessage = (e) => {
    try {
      dispatch(JSON.parse(e.data));
    } catch {
      /* not our JSON — ignore */
    }
  };
}

/** Subscribe to one event type. Returns the unsubscribe function. */
export function onEvent(type, cb) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(cb);
  return () => handlers.get(type)?.delete(cb);
}
