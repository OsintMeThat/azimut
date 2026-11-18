/**
 * A block of steps (`::: steps`) or a story (`::: story`), which an HTML page plays:
 * each line holding a picture opens a step, and the lines after it are its words.
 * Drawn small, the steps numbered in order. Open, its two fence lines are greyed.
 */
import { markdownHtml } from '../../markdown.js';
import { picturesIn } from '../pictureSize.js';
import { PLAYED_BLOCK } from '../syntax.js';
import { registerBlock } from './blocks.js';
import { drawHints, hintsMarked } from './inline.js';
import { blockWidget } from './widgets.js';

/** `zoom=x,y,w,h` in a picture's braces: the part of it a story moves in on, as fractions, or null. */
export function storyZoom(rest) {
  const match = /\bzoom\s*=\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(String(rest ?? ''));
  if (!match) return null;
  const [x, y, w, h] = match.slice(1).map(Number);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
}

/**
 * The steps of a `::: steps` or `::: story` block, from its source: each line holding
 * a picture opens a step, and the lines after it are that step's words. Words before
 * the first picture are the block's lead.
 */
export function playedSteps(source) {
  const lines = String(source ?? '').split('\n').slice(1, -1);
  const lead = [];
  const steps = [];
  for (const line of lines) {
    const [picture] = picturesIn(line);
    if (picture) steps.push({ picture: line, zoom: storyZoom(picture.rest), words: [] });
    else if (steps.length) steps.at(-1).words.push(line);
    else lead.push(line);
  }
  return { lead: lead.join('\n').trim(), steps: steps.map((step) => ({ ...step, words: step.words.join('\n').trim() })) };
}

/**
 * A block of steps or a story, drawn small the way the HTML page plays it: its steps
 * in order, numbered, each picture with its words; a story's beside it, and the part
 * a step moves in on outlined. The PDF prints them one after the other.
 */
function drawPlayed(box, kind, source, info) {
  const { text, hints } = hintsMarked(source);
  const { lead, steps } = playedSteps(text);
  const head = document.createElement('div');
  head.className = 'cm-played-head';
  const count = steps.length;
  head.textContent = kind === 'steps'
    ? `Steps · ${count} picture${count === 1 ? '' : 's'}, one at a time in HTML`
    : `Story · ${count} step${count === 1 ? '' : 's'}, the words scroll beside the pictures in HTML`;
  box.append(head);
  if (lead) {
    const words = document.createElement('div');
    words.className = 'cm-played-lead';
    words.innerHTML = markdownHtml(lead, info);
    box.append(words);
  }
  const list = document.createElement('ol');
  list.className = `cm-played-list cm-played-${kind}`;
  steps.forEach((step, index) => {
    const item = document.createElement('li');
    item.className = 'cm-played-step';
    const figure = document.createElement('div');
    figure.className = 'cm-played-figure';
    figure.dataset.step = String(index + 1);
    figure.innerHTML = markdownHtml(step.picture, info);
    const picture = figure.querySelector('img, video');
    if (picture && step.zoom && kind === 'story') {
      const frame = document.createElement('span');
      frame.className = 'cm-zoom-frame';
      picture.replaceWith(frame);
      frame.append(picture);
      const zoom = document.createElement('span');
      zoom.className = 'cm-zoom-box';
      zoom.title = 'The part this step moves in on';
      Object.assign(zoom.style, {
        left: `${step.zoom.x * 100}%`, top: `${step.zoom.y * 100}%`, width: `${step.zoom.w * 100}%`, height: `${step.zoom.h * 100}%`,
      });
      frame.append(zoom);
    }
    item.append(figure);
    if (step.words) {
      const words = document.createElement('div');
      words.className = 'cm-played-words';
      words.innerHTML = markdownHtml(step.words, info);
      item.append(words);
    }
    list.append(item);
  });
  box.append(list);
  drawHints(box, hints);
}

// `::: steps` and `::: story`, which an HTML page plays, drawn as their steps
for (const name of ['steps', 'story']) {
  registerBlock({
    name,
    fence: PLAYED_BLOCK,
    read: ({ match }) => (match[1] === name ? {} : null),
    widget: blockWidget,
    draw: (box, widget) => drawPlayed(box, widget.kind, widget.source, widget.info),
    atomic: true,
  });
}
