/**
 * The template picker (`components/FigureTemplatePicker.svelte`) opened from a card drawn
 * outside Svelte: a chart's settings and a map's, in the note or in the infographic
 * builder. One stands open at a time; opening another, or its own close, takes it down.
 */
import { mount, unmount } from 'svelte';
import FigureTemplatePicker from '../../components/FigureTemplatePicker.svelte';

let shown = null;

/** Take the open picker down, if one is. */
export function closeFigurePicker() {
  const was = shown;
  shown = null;
  if (!was) return;
  was.anchor?.setAttribute?.('aria-expanded', 'false');
  unmount(was.component);
  was.holder.remove();
}

/**
 * The picker under `anchor`: `figure` (`chart` or `map`), `data` what it meets (`{ table,
 * origin, name }`), `onapply(answer, record)` the server's answer. Answers its close; a
 * second press on the same opener closes it instead.
 */
export function openFigurePicker(anchor, { figure, data = null, maps = [], onapply, onclose = null }) {
  // a second press on its opener closes it
  if (shown && shown.anchor === anchor) {
    closeFigurePicker();
    return () => {};
  }
  closeFigurePicker();
  const holder = document.createElement('div');
  document.body.append(holder);
  let component = null;
  // its own close: one opened since is left standing
  const close = () => {
    if (!shown || shown.component !== component) return;
    closeFigurePicker();
    onclose?.();
  };
  component = mount(FigureTemplatePicker, {
    target: holder,
    props: { anchor, figure, data, maps, onapply: (answer, record) => onapply?.(answer, record), onclose: () => queueMicrotask(close) },
  });
  anchor?.setAttribute?.('aria-expanded', 'true');
  shown = { component, holder, anchor };
  return close;
}
