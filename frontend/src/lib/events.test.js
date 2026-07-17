import { describe, it, expect } from 'vitest';
import { dispatch, onEvent, startEvents } from './events.js';

// The nudge channel drives live refresh: what must hold is the routing —
// handlers get exactly their type, unsubscribe really stops them, and a
// malformed event or a throwing handler never breaks the others.

describe('event routing', () => {
  it('routes events to their type and nothing else', () => {
    const seen = [];
    const off = onEvent('capture', (e) => seen.push(e.case_id));
    dispatch({ type: 'capture', case_id: 'c1' });
    dispatch({ type: 'other', case_id: 'nope' });
    expect(seen).toEqual(['c1']);
    off();
  });

  it('unsubscribe stops delivery', () => {
    let calls = 0;
    const off = onEvent('capture', () => calls++);
    dispatch({ type: 'capture' });
    off();
    dispatch({ type: 'capture' });
    expect(calls).toBe(1);
  });

  it('a throwing handler does not starve the next one', () => {
    let reached = false;
    const off1 = onEvent('capture', () => {
      throw new Error('boom');
    });
    const off2 = onEvent('capture', () => (reached = true));
    dispatch({ type: 'capture' });
    expect(reached).toBe(true);
    off1();
    off2();
  });

  it('ignores malformed events', () => {
    expect(() => {
      dispatch(null);
      dispatch({});
      dispatch({ type: 42 });
    }).not.toThrow();
  });
});

describe('startEvents', () => {
  it('opens one stream and feeds dispatch from onmessage', () => {
    const instances = [];
    class FakeEventSource {
      constructor(url) {
        this.url = url;
        instances.push(this);
      }
    }
    startEvents(FakeEventSource);
    startEvents(FakeEventSource); // second call must not open a second stream
    expect(instances.length).toBe(1);
    expect(instances[0].url).toBe('/api/events');

    const seen = [];
    const off = onEvent('capture', (e) => seen.push(e.title));
    instances[0].onmessage({ data: JSON.stringify({ type: 'capture', title: 'Spot' }) });
    instances[0].onmessage({ data: 'not json' }); // must not throw
    expect(seen).toEqual(['Spot']);
    off();
  });
});
