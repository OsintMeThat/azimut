/**
 * A map: a `::: map` block of `key: value` lines (`engine/notes_maps.py`), drawn as a
 * card. Open, its two fence lines are greyed.
 */
import { markdownHtml } from '../../markdown.js';
import { MAP_BLOCK } from '../syntax.js';
import { registerBlock } from './blocks.js';
import { blockWidget } from './widgets.js';

/** A map's block, read: its title, what it shows and its ground (`engine/notes_maps.py`). */
export function mapBlock(source) {
  const read = { title: '', layers: [], plate: '', proofs: '', ground: '', details: 0 };
  for (const line of String(source ?? '').split('\n').slice(1)) {
    const found = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (!found) continue;
    const [, key, value] = found;
    const name = key.toLowerCase();
    if ((name === 'layer' || name === 'layers') && value) read.layers.push(value);
    else if (name === 'detail' && value) read.details += 1;
    else if (name in read && typeof read[name] === 'string' && !read[name]) read[name] = value;
  }
  return read;
}

/**
 * A map, drawn small as what it shows: its title, its layers or plate and its proofs,
 * over its ground. The HTML page moves it and plays its days; the PDF prints its picture.
 */
function drawMap(box, source, info) {
  const map = mapBlock(source);
  const head = document.createElement('div');
  head.className = 'cm-played-head';
  head.textContent = 'Map · interactive in HTML, a picture in the PDF';
  const frame = document.createElement('div');
  frame.className = 'cm-map-frame';
  if (map.ground) {
    frame.innerHTML = markdownHtml(`[[media:${map.ground}|Ground]]`, info);
    if (!frame.querySelector('img')) frame.replaceChildren();
  }
  if (!frame.childNodes.length) frame.classList.add('cm-map-plain');
  const said = document.createElement('div');
  said.className = 'cm-map-said';
  const title = document.createElement('strong');
  title.textContent = map.title || 'Map';
  said.append(title);
  const parts = [
    map.plate ? `Plate: ${map.plate}` : '',
    map.layers.length ? `${map.layers.length === 1 ? 'Layer' : 'Layers'}: ${map.layers.join(', ')}` : '',
    map.proofs ? `Proofs: ${map.proofs === 'all' ? 'all' : map.proofs.replace('..', ' to ')}` : '',
    map.ground ? '' : 'No ground: drawn on a plain background',
  ].filter(Boolean);
  for (const part of parts) {
    const line = document.createElement('span');
    line.textContent = part;
    said.append(line);
  }
  frame.append(said);
  box.append(head, frame);
}

registerBlock({
  name: 'map',
  fence: MAP_BLOCK,
  widget: blockWidget,
  draw: (box, widget) => drawMap(box, widget.source, widget.info),
  atomic: true,
});
