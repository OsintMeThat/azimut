import { describe, it, expect, vi } from 'vitest';
import { followFullscreen, leaveFullscreen, overlayHost, portal, toggleFullscreen } from './fullscreen.js';

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
