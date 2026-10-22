import { describe, expect, it, vi } from 'vitest';
import { GLOBE_CALLS, createDualEngine } from './dualEngine.js';

/** A façade that records what it is asked, with events a test can fire. */
function fakeEngine(name) {
  const handlers = new Map();
  const engine = {
    name,
    impl: { name },
    on: vi.fn((event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event).delete(handler);
    }),
    fire: (event, payload) => {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
    listening: (event) => handlers.get(event)?.size ?? 0,
  };
  for (const call of GLOBE_CALLS) engine[call] = vi.fn(() => name);
  engine.claimClicks = vi.fn(() => name);
  return engine;
}

describe('one façade over the flat map and the globe', () => {
  it('answers from the flat map until a globe is attached, and from it after', () => {
    const flat = fakeEngine('flat');
    const globe = fakeEngine('globe');
    const engine = createDualEngine(flat);
    expect(engine.camera()).toBe('flat');
    engine.attachGlobe(globe);
    expect(engine.camera()).toBe('globe');
    expect(engine.setPitch(40)).toBe('globe');
    expect(globe.setPitch).toHaveBeenCalledWith(40);
    engine.detachGlobe();
    expect(engine.camera()).toBe('flat');
  });

  it('tells the globe a tool reads the clicks, a globe attached later too', () => {
    const flat = fakeEngine('flat');
    const engine = createDualEngine(flat);
    engine.readClicks(true);
    const globe = { ...fakeEngine('globe'), readClicks: vi.fn() };
    engine.attachGlobe(globe);
    expect(globe.readClicks).toHaveBeenLastCalledWith(true);
    engine.readClicks(false);
    expect(globe.readClicks).toHaveBeenLastCalledWith(false);
    // and the flat map alone takes it without a globe to tell
    engine.detachGlobe();
    expect(() => engine.readClicks(true)).not.toThrow();
  });

  it('keeps the layers, the markers and the engine itself on the flat map', () => {
    const flat = fakeEngine('flat');
    const engine = createDualEngine(flat);
    engine.attachGlobe(fakeEngine('globe'));
    expect(engine.claimClicks()).toBe('flat');
    expect(engine.impl).toBe(flat.impl);
    expect(engine.flat).toBe(flat);
  });

  it('lets a listener hear only the engine that draws, attached before or after the globe', () => {
    const flat = fakeEngine('flat');
    const globe = fakeEngine('globe');
    const engine = createDualEngine(flat);
    const early = vi.fn();
    engine.on('view-settled', early);
    engine.attachGlobe(globe);
    const late = vi.fn();
    engine.on('rotate', late);
    flat.fire('view-settled', 'from flat');
    globe.fire('view-settled', 'from globe');
    globe.fire('rotate', 'turned');
    expect(early.mock.calls).toEqual([['from globe']]);
    expect(late.mock.calls).toEqual([['turned']]);
    engine.detachGlobe();
    expect(globe.listening('view-settled')).toBe(0);
    flat.fire('view-settled', 'flat again');
    expect(early).toHaveBeenLastCalledWith('flat again');
  });

  it('stops a listener on both engines when it is let go', () => {
    const flat = fakeEngine('flat');
    const globe = fakeEngine('globe');
    const engine = createDualEngine(flat);
    engine.attachGlobe(globe);
    const heard = vi.fn();
    const off = engine.on('view-move', heard);
    off();
    flat.fire('view-move', 1);
    globe.fire('view-move', 2);
    expect(heard).not.toHaveBeenCalled();
  });

  it('hears the pointer from the flat map, which the globe hands its presses to', () => {
    const flat = fakeEngine('flat');
    const globe = fakeEngine('globe');
    const engine = createDualEngine(flat);
    engine.attachGlobe(globe);
    const clicked = vi.fn();
    const off = engine.on('click', clicked);
    globe.fire('click', 'from the globe');
    flat.fire('click', 'handed on');
    expect(clicked.mock.calls).toEqual([['handed on']]);
    expect(globe.listening('click')).toBe(0);
    off();
    flat.fire('click', 'gone');
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('reads the ground the view spans off the globe while it draws', () => {
    const flat = fakeEngine('flat');
    const globe = fakeEngine('globe');
    const engine = createDualEngine(flat);
    engine.attachGlobe(globe);
    expect(engine.viewBounds()).toBe('globe');
    expect(engine.viewSpanMeters()).toBe('globe');
  });
});
