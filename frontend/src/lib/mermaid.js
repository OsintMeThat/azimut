/**
 * Mermaid diagrams in the notebook preview.
 *
 * The Markdown renderer leaves a ```mermaid fence as escaped text inside a
 * `.mermaid-diagram` wrapper, because the sanitizer would strip the `<svg>` a
 * drawn diagram produces. So the drawing happens here instead, against the
 * live preview DOM once the sanitized HTML is already in place.
 *
 * Mermaid is about a megabyte, so it is imported the first time a note
 * actually holds a diagram, never on mount. It runs entirely offline.
 *
 * Diagrams are always drawn light, whatever the app theme: they print that way
 * in the PDF export, and a dark diagram on a white page is unreadable.
 */

import { MERMAID_CLASS } from './markdown.js';

export const MERMAID_SELECTOR = `.${MERMAID_CLASS}:not([data-processed])`;

const CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  // Mermaid 12 turned both of these into something else by default, which would
  // redraw every diagram already in a case. A note can still ask for them. A mindmap
  // takes this layout too, so it reads as a tree rather than a star.
  layout: 'dagre',
  look: 'classic',
  // a journey's plain labels (below) would otherwise take their box's own fill
  themeCSS: 'text.journey-section, text.task { fill: #202124; }',
  themeVariables: {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '14px',
    background: '#ffffff',
    primaryColor: '#fdf3e6',
    primaryBorderColor: '#bd7a25',
    primaryTextColor: '#202124',
    lineColor: '#8a5a1a',
    secondaryColor: '#f1ece5',
    tertiaryColor: '#f8f6f3',
  },
};

/**
 * Per-diagram config for the PDF export, prepended to the source rather than
 * initialised globally so the preview keeps its own settings. HTML labels are a
 * `<foreignObject>` — HTML nested inside the picture — and a browser will not
 * rasterise one out of an image element, so a diagram exported that way comes
 * back with empty boxes where its text should be. It is the root-level setting
 * that counts: it wins over the per-diagram ones, which Mermaid has deprecated.
 * A journey ignores it and answers to its own text placement. Chromium still draws
 * those, Firefox leaves the boxes empty.
 */
const PLAIN_LABELS = '%%{init: {"htmlLabels": false, "journey": {"textPlacement": "tspan"}} }%%\n';

/** A note's own config block, which Mermaid reads only at the very top of a diagram. */
const FRONT_MATTER = /^\s*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;

function withPlainLabels(source) {
  const at = FRONT_MATTER.exec(source)?.[0].length ?? 0;
  return `${source.slice(0, at)}${PLAIN_LABELS}${source.slice(at)}`;
}

let loading = null;
let sequence = 0;

/** Load and configure Mermaid once, then reuse it for every later preview. */
function loadMermaid() {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize(CONFIG);
    return mermaid;
  });
  return loading;
}

/**
 * One diagram drawn to a standalone SVG, with the size it wants to be.
 *
 * Mermaid sizes its output through a `max-width` style and a viewBox, neither of
 * which a canvas reads, so the intrinsic size is put back on the element before
 * the caller rasterises it.
 */
export async function renderMermaidSvg(source, { load = loadMermaid } = {}) {
  const mermaid = await load();
  const id = `azimut-mermaid-export-${(sequence += 1)}`;
  const { svg } = await mermaid.render(id, withPlainLabels(source));
  const element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const [, , boxWidth, boxHeight] = (element.getAttribute('viewBox') ?? '0 0 800 600')
    .split(/[\s,]+/)
    .map(Number);
  const width = boxWidth || 800;
  const height = boxHeight || 600;
  element.setAttribute('width', String(width));
  element.setAttribute('height', String(height));
  element.removeAttribute('style');
  return { svg: new XMLSerializer().serializeToString(element), width, height };
}

function failed(node, message) {
  node.classList.add('mermaid-failed');
  const note = node.ownerDocument.createElement('p');
  note.className = 'mermaid-error';
  note.textContent = `Diagram not drawn: ${message}`;
  node.prepend(note);
}

/**
 * Draw every diagram in `root` that has not been drawn yet.
 * Returns how many wrappers were handled, drawn or failed.
 */
export async function drawMermaidDiagrams(root, { load = loadMermaid } = {}) {
  const nodes = [...(root?.querySelectorAll(MERMAID_SELECTOR) ?? [])];
  if (!nodes.length) return 0;
  // Claim the wrappers before the first await, so a redraw triggered while this
  // one is still loading Mermaid does not draw the same diagram twice.
  const pending = nodes.map((node) => {
    node.dataset.processed = 'true';
    return { node, source: node.textContent ?? '' };
  });

  let mermaid;
  try {
    mermaid = await load();
  } catch {
    for (const { node } of pending) failed(node, 'diagram support could not be loaded');
    return pending.length;
  }

  for (const { node, source } of pending) {
    const id = `azimut-mermaid-${(sequence += 1)}`;
    try {
      const { svg } = await mermaid.render(id, source);
      node.innerHTML = svg;
    } catch (error) {
      // A failed render can leave Mermaid's scratch element behind.
      node.ownerDocument.getElementById(`d${id}`)?.remove();
      failed(node, error?.message?.split('\n')[0] || 'check the diagram syntax');
    }
  }
  return pending.length;
}
