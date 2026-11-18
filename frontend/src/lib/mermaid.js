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

/**
 * A chart's series (`xychart-beta`), in order: the blue ramp the reference
 * infographics draw grades in, darkest first, then grey. Mermaid's own first colour
 * is cream, which a bar on a white page all but loses.
 */
export const CHART_PALETTE = ['#184f95', '#3987e5', '#86b6ef', '#a9a79f'];

/**
 * The type a chart is set in: the sans a note's headings print in (Noto Sans in the
 * PDF), then each system's own. A chart is drawn into a picture for the PDF, where
 * only the fonts on the machine can be read. Mermaid takes a diagram's own font in
 * letters, digits, spaces and quotes only, so the list names families and ends on
 * Arial rather than `sans-serif`.
 */
export const CHART_FACE = '"Noto Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial';

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
    // a chart only: its series in the palette, its axes in soft greys, its words in ink
    xyChart: {
      plotColorPalette: CHART_PALETTE.join(', '),
      titleColor: '#202124',
      legendTextColor: '#202124',
      xAxisLabelColor: '#52514e',
      xAxisTitleColor: '#52514e',
      xAxisTickColor: '#c3c2b7',
      xAxisLineColor: '#c3c2b7',
      yAxisLabelColor: '#52514e',
      yAxisTitleColor: '#52514e',
      yAxisTickColor: '#c3c2b7',
      yAxisLineColor: '#c3c2b7',
    },
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
const PLAIN_LABELS = '"htmlLabels": false, "journey": {"textPlacement": "tspan"}';

/**
 * A chart sets its words in the chart face. Mermaid has no setting for one kind of
 * diagram's type, so a chart's own init says it; a note's init after it still wins.
 */
const CHART_TYPE = `"themeVariables": {"fontFamily": ${JSON.stringify(CHART_FACE)}}`;

/** A note's own config block, which Mermaid reads only at the very top of a diagram. */
const FRONT_MATTER = /^\s*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;

/** Whether `source` draws a chart (`xychart-beta`): its first line past its config, its inits and its comments. */
function isChart(source) {
  const body = String(source ?? '').slice(FRONT_MATTER.exec(source)?.[0].length ?? 0);
  const first = body.split('\n').find((line) => line.trim() && !line.trim().startsWith('%%')) ?? '';
  return /^\s*xychart(?:-beta)?\b/.test(first);
}

function withPlainLabels(source) {
  const at = FRONT_MATTER.exec(source)?.[0].length ?? 0;
  const init = isChart(source) ? `${PLAIN_LABELS}, ${CHART_TYPE}` : PLAIN_LABELS;
  return `${source.slice(0, at)}%%{init: {${init}} }%%\n${source.slice(at)}`;
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
