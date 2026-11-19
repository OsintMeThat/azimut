/**
 * An icon of the app's set (`components/Icon.svelte`) as an SVG element, for what
 * the editor draws outside Svelte: a picture's bar, the selection bubble, the insert
 * menu.
 */
import { paths } from '../../../components/Icon.svelte';

/** The icon called `name`, `size` pixels square, drawn in the text's colour. */
export function iconSvg(name, size = 13) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] ?? '');
  svg.append(path);
  return svg;
}
