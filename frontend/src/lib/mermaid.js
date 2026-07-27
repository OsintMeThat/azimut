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
