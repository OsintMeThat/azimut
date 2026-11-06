import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./state.svelte.js', () => ({ toast: vi.fn(), dismissToast: vi.fn(), uiState: { toasts: [] } }));

const { OFFER_QUIET, OFFER_SHOWN, OFFER_UNUSED, createSceneOffer } = await import('./sceneOffer.js');

/** A toast list of its own, the way `lib/state.svelte.js` keeps one. */
function harness() {
  const toasts = [];
  let seq = 0;
  const show = vi.fn((message, kind, timeout, action) => {
    toasts.push({ id: ++seq, message, kind, timeout, action });
    return seq;
  });
  const dismiss = vi.fn((id) => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i !== -1) toasts.splice(i, 1);
  });
  const offer = createSceneOffer({ show, dismiss, shown: () => toasts, now: () => Date.now() });
  /** Press a choice, as the toast does: run it, then take the toast down. */
  const press = (index = 0) => {
    const [t] = toasts;
    t.action[index].onClick();
    toasts.splice(toasts.indexOf(t), 1);
  };
  return { toasts, show, offer, press };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

describe('the choices', () => {
  it('puts every choice on the one toast, each running its own pick', () => {
    const { toasts, offer, press } = harness();
    const picked = [];
    offer.offer('Frame captured at 0:02 · Add a scene', [
      { label: 'Whole video', pick: () => picked.push('whole') },
      { label: 'This moment', pick: () => picked.push('moment') },
    ]);
    expect(toasts[0].action.map((a) => a.label)).toEqual(['Whole video', 'This moment']);
    press(1);
    expect(picked).toEqual(['moment']);
  });
});

describe('the offer of a scene on a captured frame', () => {
  it('stays one toast, rewritten by each capture and pointing at the latest', () => {
    const { toasts, show, offer, press } = harness();
    const picked = [];
    offer.offer('Frame captured at 0:02', [{ label: 'This moment', pick: () => picked.push(2) }]);
    vi.advanceTimersByTime(OFFER_SHOWN - 100);
    offer.offer('Frame captured at 0:05', [{ label: 'This moment', pick: () => picked.push(5) }]);

    expect(show).toHaveBeenCalledTimes(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: 'Frame captured at 0:05', kind: 'info', timeout: 0 });
    // the latest capture holds it up a while longer
    vi.advanceTimersByTime(OFFER_SHOWN - 100);
    expect(toasts).toHaveLength(1);
    press();
    expect(picked).toEqual([5]);
  });

  it('goes by on its own, then keeps quiet a while', () => {
    const { toasts, offer } = harness();
    offer.offer('Frame captured at 0:02', [{ label: 'This moment', pick: () => {} }]);
    vi.advanceTimersByTime(OFFER_SHOWN);
    expect(toasts).toHaveLength(0);

    expect(offer.offer('Frame captured at 0:05', [{ label: 'This moment', pick: () => {} }])).toBe(false);
    vi.advanceTimersByTime(OFFER_QUIET);
    expect(offer.offer('Frame captured at 0:09', [{ label: 'This moment', pick: () => {} }])).toBe(true);
  });

  it('keeps quiet a while once a scene is kept, from it or any other way', () => {
    const { toasts, offer, press } = harness();
    offer.offer('Frame captured at 0:02', [{ label: 'This moment', pick: () => {} }]);
    press();
    expect(offer.offer('Frame captured at 0:05', [{ label: 'This moment', pick: () => {} }])).toBe(false);
    vi.advanceTimersByTime(OFFER_QUIET);

    offer.offer('Frame captured at 0:09', [{ label: 'This moment', pick: () => {} }]);
    offer.quiet(); // S pressed
    expect(toasts).toHaveLength(0);
    expect(offer.offer('Frame captured at 0:11', [{ label: 'This moment', pick: () => {} }])).toBe(false);
  });

  it('stops offering on a file where it went by unused three times, until another opens', () => {
    const { offer } = harness();
    for (let i = 0; i < OFFER_UNUSED; i += 1) {
      expect(offer.offer('Frame captured', [{ label: 'This moment', pick: () => {} }])).toBe(true);
      vi.advanceTimersByTime(OFFER_SHOWN + OFFER_QUIET);
    }
    expect(offer.offer('Frame captured', [{ label: 'This moment', pick: () => {} }])).toBe(false);
    offer.reset();
    expect(offer.offer('Frame captured', [{ label: 'This moment', pick: () => {} }])).toBe(true);
  });

  it('is taken down with the tool, without counting as unused', () => {
    const { toasts, offer } = harness();
    offer.offer('Frame captured at 0:02', [{ label: 'This moment', pick: () => {} }]);
    offer.withdraw();
    expect(toasts).toHaveLength(0);
    expect(offer.offer('Frame captured at 0:05', [{ label: 'This moment', pick: () => {} }])).toBe(true);
  });
});
