/**
 * A Konva stand-in for tests that draw a page under happy-dom, where there is no
 * canvas to measure or paint with. Each node keeps its attributes and its
 * children, so a test reads what was drawn by type, id and attribute. A text is
 * measured at half its size per character, which is enough for layout to place
 * it and never what any assertion leans on.
 *
 *     vi.mock('konva', async () => ({ default: (await import('../lib/konva.fixture.js')).FakeKonva }));
 */
class Node {
  constructor(attrs = {}) {
    this.attrs = { ...attrs };
    this.children = [];
    this.handlers = {};
    this.parent = null;
    this.className = this.constructor.name;
  }
  getClassName() { return this.className; }
  setAttrs(attrs) { Object.assign(this.attrs, attrs); return this; }
  add(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }
  destroyChildren() { this.children = []; return this; }
  destroy() { this.children = []; this.destroyed = true; }
  on(name, fn) {
    for (const one of name.split(' ')) (this.handlers[one] ??= []).push(fn);
    return this;
  }
  fire(name, event = {}) { for (const fn of this.handlers[name] ?? []) fn(event); }
  id() { return this.attrs.id ?? ''; }
  name() { return this.attrs.name ?? ''; }
  x() { return this.attrs.x ?? 0; }
  y() { return this.attrs.y ?? 0; }
  width(value) {
    if (value !== undefined) { this.attrs.width = value; return this; }
    return this.attrs.width ?? 0;
  }
  height() { return this.attrs.height ?? 0; }
  scaleX() { return this.attrs.scaleX ?? 1; }
  position(value) {
    if (value) { Object.assign(this.attrs, value); return this; }
    return { x: this.x(), y: this.y() };
  }
  size(value) { Object.assign(this.attrs, value); return this; }
  scale(value) { this.attrs.scaleX = value.x; this.attrs.scaleY = value.y; return this; }
  draggable(value) { if (value !== undefined) this.attrs.draggable = value; return this.attrs.draggable ?? false; }
  isDragging() { return false; }
  draw() { return this; }
  batchDraw() { return this; }
  /** Every node under this one, depth first. */
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  find(test) {
    const match = typeof test === 'function' ? test : (node) => node.className === test;
    return this.all().filter(match);
  }
  findOne(selector) {
    const test = selector.startsWith('#')
      ? (node) => node.id() === selector.slice(1)
      : (node) => node.className === selector;
    return this.all().find(test);
  }
}

class Text extends Node {
  width(value) {
    if (value !== undefined) { this.attrs.width = value; return this; }
    if (this.attrs.width !== undefined) return this.attrs.width;
    const lines = String(this.attrs.text ?? '').split('\n');
    return Math.max(...lines.map((line) => line.length)) * (this.attrs.fontSize ?? 12) * 0.5;
  }
  height() {
    return this.attrs.height ?? String(this.attrs.text ?? '').split('\n').length * (this.attrs.fontSize ?? 12);
  }
  text(value) {
    if (value !== undefined) { this.attrs.text = value; return this; }
    return this.attrs.text ?? '';
  }
}

class Stage extends Node {
  toDataURL() { return 'data:image/png;base64,AAAA'; }
}

class Transformer extends Node {
  nodes(list) { this.held = list; return this; }
  isTransforming() { return false; }
  stopTransform() {}
}

const named = (name, Base = Node) => ({ [name]: class extends Base {} })[name];

export const FakeKonva = {
  Stage,
  Layer: named('Layer'),
  Group: named('Group'),
  Rect: named('Rect'),
  Circle: named('Circle'),
  Ellipse: named('Ellipse'),
  Arrow: named('Arrow'),
  Image: named('Image'),
  Shape: named('Shape'),
  Text,
  Transformer,
  isDragging: () => false,
  stages: [],
};
