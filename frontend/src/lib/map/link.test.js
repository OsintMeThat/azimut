// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CHANNEL, createViewLink, readable, sameView } from './link.js';

const VIEW = { lat: 48.8566, lon: 2.3522, zoom: 17, bearing: 0 };

describe('one camera worth sending', () => {
  it('takes a real view', () => {
    expect(readable(VIEW)).toBe(true);
  });

  it('refuses anything that would move a peer to nowhere', () => {
    for (const bad of [
      null,
      {},
      { ...VIEW, lat: NaN },
      { ...VIEW, lon: Infinity },
      { ...VIEW, zoom: undefined },
      { ...VIEW, lat: 120 },
      { ...VIEW, lon: -400 },
    ]) {
      expect(readable(bad)).toBe(false);
    }
  });
});

describe('the same camera, after a round trip', () => {
  it('is the same within a metre', () => {
    expect(sameView(VIEW, { ...VIEW, lat: VIEW.lat + 0.0000001 })).toBe(true);
  });

  it('is not the same once it has actually moved', () => {
    expect(sameView(VIEW, { ...VIEW, lat: 48.86 })).toBe(false);
    expect(sameView(VIEW, { ...VIEW, zoom: 16 })).toBe(false);
    expect(sameView(VIEW, { ...VIEW, bearing: 90 })).toBe(false);
  });

  it('reads a missing bearing as north, which is what the map means by it', () => {
    expect(sameView({ lat: 1, lon: 2, zoom: 5 }, { lat: 1, lon: 2, zoom: 5, bearing: 0 })).toBe(
      true
    );
  });

  it('is nothing at all when there is nothing to compare', () => {
    expect(sameView(VIEW, null)).toBe(false);
    expect(sameView(null, null)).toBe(false);
  });
});

describe('the link between two tabs', () => {
  let channels;

  beforeEach(() => {
    channels = [];
    // A stand-in for the browser's own: it delivers to every *other* channel on
    // the same name, which is the behaviour the echo rule is written against.
    globalThis.BroadcastChannel = vi.fn(function (name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      this.postMessage = (data) => {
        for (const peer of channels) {
          if (peer !== this && peer.name === name && !peer.closed) peer.onmessage?.({ data });
        }
      };
      this.close = () => (this.closed = true);
      channels.push(this);
    });
  });

  afterEach(() => {
    delete globalThis.BroadcastChannel;
  });

  it('carries one tab\'s camera to the others', () => {
    const heard = vi.fn();
    createViewLink(heard);
    const other = createViewLink(() => {});
    other.send(VIEW);
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ lat: 48.8566, zoom: 17 }));
  });

  it('speaks on the one channel every map tab listens to', () => {
    createViewLink(() => {});
    expect(channels[0].name).toBe(CHANNEL);
  });

  it('never hands a view straight back to the tab it came from', () => {
    // the echo rule: a tab that applies a view settles, and a settle is what
    // makes it send — two linked tabs would otherwise push one camera for ever
    const a = createViewLink(() => {});
    const b = createViewLink(() => {});
    a.send(VIEW);
    expect(b.send(VIEW)).toBe(false);
    expect(b.send({ ...VIEW, lat: VIEW.lat + 0.0000001 })).toBe(false);
  });

  it('sends again as soon as that tab moves on its own', () => {
    const a = createViewLink(() => {});
    const b = createViewLink(() => {});
    a.send(VIEW);
    expect(b.send(VIEW)).toBe(false); // the landing
    expect(b.send({ ...VIEW, zoom: 12 })).toBe(true);
    // …and having moved, it is no longer echoing anything
    expect(b.send(VIEW)).toBe(true);
  });

  it('lands short of a view without pulling the tab it follows back out', () => {
    // this tab's imagery stops at 19 and the leader is at 21: the settle at 19 is
    // where it was sent, and sending it would move the leader out to 19
    const a = createViewLink(() => {});
    const b = createViewLink(() => {});
    a.send({ ...VIEW, zoom: 21 });
    expect(b.send({ ...VIEW, zoom: 19 })).toBe(false);
    // the analyst zooming that tab afterwards is theirs, and is sent
    expect(b.send({ ...VIEW, zoom: 17 })).toBe(true);
  });

  it('takes only a settle on the same spot as the landing', () => {
    const a = createViewLink(() => {});
    const b = createViewLink(() => {});
    a.send(VIEW);
    expect(b.send({ ...VIEW, lat: 48.9 })).toBe(true);
  });

  it('stops taking a same-spot zoom as the landing once the map has had time to land', () => {
    vi.useFakeTimers();
    try {
      const a = createViewLink(() => {});
      const b = createViewLink(() => {});
      a.send({ ...VIEW, zoom: 21 });
      vi.advanceTimersByTime(2500);
      expect(b.send({ ...VIEW, zoom: 19 })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a camera a peer could not have meant', () => {
    const heard = vi.fn();
    createViewLink(heard);
    channels[0].onmessage({ data: { lat: 'somewhere', lon: 2, zoom: 4 } });
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops listening when the tab lets it go', () => {
    const heard = vi.fn();
    const mine = createViewLink(heard);
    const other = createViewLink(() => {});
    mine.close();
    other.send(VIEW);
    expect(heard).not.toHaveBeenCalled();
  });

  it('is a button that links nothing where the browser has no channel', () => {
    delete globalThis.BroadcastChannel;
    const link = createViewLink(() => {});
    expect(link.alive).toBe(false);
    expect(() => {
      link.send(VIEW);
      link.close();
    }).not.toThrow();
  });
});

describe('knowing whether there is anybody to link to', () => {
  let channels;

  beforeEach(() => {
    channels = [];
    globalThis.BroadcastChannel = vi.fn(function (name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      this.postMessage = (data) => {
        for (const peer of channels) {
          if (peer !== this && peer.name === name && !peer.closed) peer.onmessage?.({ data });
        }
      };
      this.close = () => (this.closed = true);
      channels.push(this);
    });
  });

  afterEach(() => {
    delete globalThis.BroadcastChannel;
  });

  it('counts nobody while a map tab is on its own', () => {
    const alone = createViewLink(() => {});
    expect(alone.peers).toBe(0);
  });

  it('tells the tab that was already open that a second one arrived', () => {
    const first = createViewLink(() => {});
    const heard = vi.fn();
    createViewLink(() => {}, { onPeers: heard });
    expect(first.peers).toBe(1);
    expect(heard).toHaveBeenCalledWith(1); // …and the newcomer was answered
  });

  it('lets the newcomer count a tab that has said nothing since it opened', () => {
    createViewLink(() => {});
    const late = createViewLink(() => {});
    expect(late.peers).toBe(1);
  });

  it('takes a tab off the count when it goes', () => {
    const staying = createViewLink(() => {});
    const leaving = createViewLink(() => {});
    expect(staying.peers).toBe(1);
    leaving.close();
    expect(staying.peers).toBe(0);
  });

  it('says goodbye when the tab is closed rather than unmounted', () => {
    const staying = createViewLink(() => {});
    createViewLink(() => {});
    expect(staying.peers).toBe(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(staying.peers).toBe(0);
  });

  it('counts each tab once however much it says', () => {
    const heard = vi.fn();
    createViewLink(() => {}, { onPeers: heard });
    const other = createViewLink(() => {});
    other.send(VIEW);
    other.send({ ...VIEW, zoom: 12 });
    expect(heard.mock.calls).toEqual([[1]]);
  });

  it('counts nobody where the browser has no channel', () => {
    delete globalThis.BroadcastChannel;
    expect(createViewLink(() => {}).peers).toBe(0);
  });
});

describe('maps outside the app, through the extension', () => {
  /** A stand-in for `extBridge.js`'s relay: what the app hands it, and a way to
   *  speak as the extension's panels. */
  function fakeRelay() {
    const relay = {
      handlers: null,
      sent: [],
      closed: false,
      listen(handlers) {
        relay.handlers = handlers;
      },
      send(view) {
        relay.sent.push(view);
      },
      close() {
        relay.closed = true;
      },
    };
    return relay;
  }

  afterEach(() => {
    delete globalThis.BroadcastChannel;
  });

  it('counts the extension’s panels as peers', () => {
    const relay = fakeRelay();
    const heard = vi.fn();
    const link = createViewLink(() => {}, { relay, onPeers: heard });
    relay.handlers.peers(2);
    expect(link.peers).toBe(2);
    expect(heard).toHaveBeenLastCalledWith(2);
    relay.handlers.peers(0);
    expect(link.peers).toBe(0);
  });

  it('follows a panel’s camera, and does not hand it back', () => {
    const relay = fakeRelay();
    const heard = vi.fn();
    const link = createViewLink(heard, { relay });
    relay.handlers.view(VIEW);
    expect(heard).toHaveBeenCalledWith(VIEW);
    expect(link.send(VIEW)).toBe(false);
    expect(relay.sent).toEqual([]);
  });

  it('sends its own camera to the panels', () => {
    const relay = fakeRelay();
    const link = createViewLink(() => {}, { relay });
    expect(link.send({ ...VIEW, bearing: undefined })).toBe(true);
    expect(relay.sent).toEqual([{ ...VIEW, bearing: 0 }]);
  });

  it('works with the extension alone where the browser has no channel', () => {
    delete globalThis.BroadcastChannel;
    const relay = fakeRelay();
    const link = createViewLink(() => {}, { relay });
    expect(link.alive).toBe(true);
    link.close();
    expect(relay.closed).toBe(true);
  });

  it('ignores a count that is not one', () => {
    const relay = fakeRelay();
    const link = createViewLink(() => {}, { relay });
    relay.handlers.peers('lots');
    expect(link.peers).toBe(0);
  });
});
