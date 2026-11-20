import { describe, it, expect, vi } from 'vitest';
import { followFullscreen, holdScreen, leaveFullscreen, overlayHost, portal, toggleFullscreen } from './fullscreen.js';

// Minimal DOM stand-ins: the action only ever appends and removes, so a couple
// of objects tracking parentage are enough (no jsdom in this suite).
function makeNode() {
  const node = {
    parent: null,
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    },
  };
  return node;
}

function makeHost(name) {
  return {
    name,
    children: [],
    appendChild(node) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    },
  };
}

function makeDoc(body) {
  return {
    body,
    fullscreenElement: null,
    listeners: [],
    addEventListener(type, fn) {
      if (type === 'fullscreenchange') this.listeners.push(fn);
    },
    removeEventListener(type, fn) {
      this.listeners = this.listeners.filter((l) => l !== fn);
    },
    fire() {
      for (const l of [...this.listeners]) l();
    },
  };
}

describe('overlayHost', () => {
  it('is the body when nothing is fullscreen', () => {
    const body = makeHost('body');
    expect(overlayHost(makeDoc(body))).toBe(body);
  });

  it('is the fullscreen element while a tool owns the screen', () => {
    const body = makeHost('body');
    const tool = makeHost('tool');
    const doc = makeDoc(body);
    doc.fullscreenElement = tool;
    expect(overlayHost(doc)).toBe(tool);
  });
});

describe('portal', () => {
  it('parks the overlay on the body outside fullscreen', () => {
    const body = makeHost('body');
    const doc = makeDoc(body);
    const node = makeNode();

    portal(node, doc);

    expect(node.parent).toBe(body);
  });

  it('moves the overlay into the fullscreen element on entering', () => {
    const body = makeHost('body');
    const tool = makeHost('tool');
    const doc = makeDoc(body);
    const node = makeNode();

    portal(node, doc);
    doc.fullscreenElement = tool;
    doc.fire();

    // this is the bug: an overlay left on <body> is never painted in fullscreen
    expect(node.parent).toBe(tool);
    expect(body.children).toEqual([]);
  });

  it('moves the overlay back to the body on exiting', () => {
    const body = makeHost('body');
    const tool = makeHost('tool');
    const doc = makeDoc(body);
    const node = makeNode();

    doc.fullscreenElement = tool;
    portal(node, doc);
    doc.fullscreenElement = null;
    doc.fire();

    expect(node.parent).toBe(body);
    expect(tool.children).toEqual([]);
  });

  it('opens directly inside the fullscreen element when already fullscreen', () => {
    const body = makeHost('body');
    const tool = makeHost('tool');
    const doc = makeDoc(body);
    doc.fullscreenElement = tool;
    const node = makeNode();

    portal(node, doc);

    expect(node.parent).toBe(tool);
  });

  it('does not re-append when the host is unchanged', () => {
    const body = makeHost('body');
    const doc = makeDoc(body);
    const node = makeNode();

    portal(node, doc);
    doc.fire();
    doc.fire();

    expect(body.children).toEqual([node]);
  });

  it('unhooks and detaches on destroy', () => {
    const body = makeHost('body');
    const doc = makeDoc(body);
    const node = makeNode();

    portal(node, doc).destroy();

    expect(doc.listeners).toEqual([]);
    expect(body.children).toEqual([]);
    expect(node.parent).toBe(null);
  });
});

// A document whose browser grants the screen and gives it back, as a real one
// would: the element changes, then `fullscreenchange` fires.
function makeScreenDoc() {
  const doc = makeDoc(makeHost('body'));
  doc.exitFullscreen = vi.fn(async () => {
    doc.fullscreenElement = null;
    doc.fire();
  });
  return doc;
}
function makeTool(doc, { refuse = false } = {}) {
  const tool = makeHost('tool');
  tool.requestFullscreen = vi.fn(async () => {
    if (refuse) throw new TypeError('Permissions check failed');
    doc.fullscreenElement = tool;
    doc.fire();
  });
  return tool;
}

describe('toggleFullscreen', () => {
  it('hands the tool the screen, then gives it back', async () => {
    const doc = makeScreenDoc();
    const tool = makeTool(doc);

    await toggleFullscreen(tool, doc);
    expect(doc.fullscreenElement).toBe(tool);

    await toggleFullscreen(tool, doc);
    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    expect(doc.fullscreenElement).toBe(null);
  });

  it('rejects when the browser refuses, so the tool can say so', async () => {
    const doc = makeScreenDoc();
    await expect(toggleFullscreen(makeTool(doc, { refuse: true }), doc)).rejects.toThrow('Permissions');
    expect(doc.fullscreenElement).toBe(null);
  });
});

describe('followFullscreen', () => {
  it('reads the state back from the browser, Esc included', async () => {
    const doc = makeScreenDoc();
    const tool = makeTool(doc);
    const seen = [];
    followFullscreen(tool, (on) => seen.push(on), doc);

    await toggleFullscreen(tool, doc);
    // Esc: the browser leaves on its own and only tells the page afterwards
    doc.fullscreenElement = null;
    doc.fire();

    expect(seen).toEqual([true, false]);
  });

  it('says false while another element holds the screen', () => {
    const doc = makeScreenDoc();
    const seen = [];
    followFullscreen(makeTool(doc), (on) => seen.push(on), doc);

    doc.fullscreenElement = makeHost('video');
    doc.fire();

    expect(seen).toEqual([false]);
  });

  it('unhooks when its effect is torn down', () => {
    const doc = makeScreenDoc();
    followFullscreen(makeTool(doc), () => {}, doc)();
    expect(doc.listeners).toEqual([]);
  });
});

describe('leaveFullscreen', () => {
  it('gives the screen back when something holds it', async () => {
    const doc = makeScreenDoc();
    const tool = makeTool(doc);
    await toggleFullscreen(tool, doc);

    leaveFullscreen(doc);

    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    expect(doc.fullscreenElement).toBe(null);
  });

  it('asks nothing of the browser when nothing does', () => {
    const doc = makeScreenDoc();
    leaveFullscreen(doc);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });
});

describe('holdScreen', () => {
  /** A page's window: where it is scrolled, and its keys, heard while capturing as a browser's are. */
  function makeWindow() {
    const win = new EventTarget();
    win.scrollX = 0;
    win.scrollY = 640;
    win.scrollTo = vi.fn();
    return win;
  }
  /** A part of the page, wearing classes. */
  function makePart(doc) {
    const part = makeTool(doc);
    part.classes = new Set();
    part.classList = { add: (name) => part.classes.add(name), remove: (name) => part.classes.delete(name) };
    return part;
  }
  const escape = (win) => win.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));

  it('hands a part of the page the screen and takes it back on a press, Esc or the browser’s own exit', async () => {
    const doc = makeScreenDoc();
    doc.defaultView = makeWindow();
    const part = makePart(doc);
    const heard = [];
    const held = holdScreen(part, (on) => heard.push(on), { doc });
    await held.toggle();
    expect([doc.fullscreenElement, held.full]).toEqual([part, true]);
    await held.toggle();
    expect([doc.fullscreenElement, held.full]).toEqual([null, false]);
    await held.toggle(true);
    escape(doc.defaultView);
    await Promise.resolve();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(2);
    await held.toggle(true);
    doc.fullscreenElement = null;
    doc.fire();
    expect(heard).toEqual([true, false, true, false, true, false]);
    // Esc is its own only while it holds the screen
    escape(doc.defaultView);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(2);
    held.destroy();
  });

  it('covers the window itself where the browser has no full screen for it, or refuses it, the page found where it was', async () => {
    const doc = makeScreenDoc();
    doc.defaultView = makeWindow();
    const part = makePart(doc);
    delete part.requestFullscreen;
    const heard = [];
    const held = holdScreen(part, (on) => heard.push(on), { doc, covered: 'is-on-top' });
    await held.toggle();
    expect([...part.classes, held.full]).toEqual(['is-on-top', true]);
    escape(doc.defaultView);
    expect([part.classes.size, held.full]).toEqual([0, false]);
    expect(doc.defaultView.scrollTo).toHaveBeenCalledWith(0, 640);
    const refused = makePart(doc);
    refused.requestFullscreen = vi.fn(async () => { throw new TypeError('Permissions check failed'); });
    const other = holdScreen(refused, (on) => heard.push(on), { doc, covered: 'is-on-top' });
    await other.toggle();
    expect([...refused.classes]).toEqual(['is-on-top']);
    other.destroy();
    expect(refused.classes.size).toBe(0);
    expect(heard).toEqual([true, false, true, false]);
  });
});
