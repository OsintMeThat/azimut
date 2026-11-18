/**
 * A diagram: a closed ```mermaid fence, drawn by Mermaid in this tab. Open, its lines
 * are code.
 */
import { renderMermaidSvg } from '../../mermaid.js';
import { registerBlock } from './blocks.js';
import { blockWidget } from './widgets.js';

const diagrams = new Map();

/** A diagram drawn once per source and kept, so typing elsewhere does not redraw it. */
function drawDiagram(box, fence) {
  const source = fence.replace(/^\s*(```|~~~)[^\n]*\n/, '').replace(/\n\s*(```|~~~)\s*$/, '');
  const known = diagrams.get(source);
  const show = (result) => {
    // the drawing replaces what the box held, but not the button that opens its source
    const edit = box.querySelector('[data-edit-source]');
    if (result.svg) box.innerHTML = result.svg;
    else {
      box.classList.add('cm-block-failed');
      box.textContent = `Diagram not drawn: ${result.error}`;
    }
    if (edit) box.append(edit);
  };
  if (known && !(known instanceof Promise)) {
    show(known);
    return;
  }
  box.textContent = 'Drawing the diagram…';
  const pending = known ?? renderMermaidSvg(source)
    .then(({ svg }) => ({ svg }))
    .catch((error) => ({ error: String(error?.message ?? error).split('\n')[0] }))
    .then((result) => {
      diagrams.set(source, result);
      if (diagrams.size > 60) diagrams.delete(diagrams.keys().next().value);
      return result;
    });
  diagrams.set(source, pending);
  pending.then(show);
}

registerBlock({
  name: 'diagram',
  // a closed ```mermaid fence; open, its lines are code
  node: 'FencedCode',
  read: (node, { state }) => {
    const opening = state.doc.sliceString(node.from, Math.min(node.to, state.doc.lineAt(node.from).to));
    const closed = /^(```|~~~)$/.test(state.doc.lineAt(node.to).text.trim());
    return /^\s*(```|~~~)\s*mermaid\b/.test(opening) && closed ? { from: node.from, to: node.to } : null;
  },
  widget: blockWidget,
  draw: (box, widget) => drawDiagram(box, widget.source),
  atomic: true,
  height: 220,
});
