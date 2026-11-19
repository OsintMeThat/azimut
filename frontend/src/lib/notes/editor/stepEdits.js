/**
 * What the step strip of a block of steps or a story writes (`editor/playedBlock.js`),
 * read and written on the block's own lines: a step added from the case or dropped in,
 * moved, removed, its words or caption written, a story's zoom framed. Each answers
 * the block's new text, the lines an expert would type, and `stepChange` turns it into
 * the one change a gesture dispatches, so one Undo takes it back.
 *
 * A step is a line holding a picture and the lines after it, up to the next picture
 * or the block's end: its words. Words before the first picture are the block's lead.
 */
import { HINT_LINE } from '../look.js';
import { pictureReference, picturesIn, sizedLine, storyZoom } from '../pictureSize.js';

/**
 * The steps of a block's text (its fence lines included), each `{ at, end, last, ref,
 * line, words, zoom, caption }`: `at` the index of its picture line, `end` its last
 * line of words (`at` without any), `last` its last line before the next step, blank
 * lines included. `lead` is `[first, end]` of the lines before the first step.
 */
export function blockSteps(source) {
  const lines = String(source ?? '').split('\n');
  const close = lines.length - 1;
  const steps = [];
  for (let index = 1; index < close; index += 1) {
    const [picture] = picturesIn(lines[index]);
    if (picture) steps.push({ at: index, ref: picture.ref, caption: picture.caption, zoom: storyZoom(picture.rest), line: lines[index] });
  }
  steps.forEach((step, number) => {
    step.last = (steps[number + 1]?.at ?? close) - 1;
    let end = step.last;
    while (end > step.at && !lines[end].trim()) end -= 1;
    step.end = end;
    step.words = lines.slice(step.at + 1, end + 1).join('\n').trim();
  });
  return { lines, steps, lead: [1, (steps[0]?.at ?? close) - 1] };
}

/** Whether the lines between `first` and `end` hold nothing but blank lines and guidance. */
function onlyGuidance(lines, first, end) {
  for (let index = first; index <= end; index += 1) if (lines[index].trim() && !HINT_LINE.test(lines[index])) return false;
  return true;
}

/**
 * The block with `entities` added as steps before step `index` (at its end when it is
 * past the last), each a picture line of its own. A block holding nothing but its
 * guidance has it taken, as typing replaces guidance (`template` keeps it). A blank
 * line goes after a step that has words, so its words stay a paragraph of their own.
 */
export function addSteps(source, entities, index = Infinity, { template = false } = {}) {
  const added = (entities ?? []).filter((entity) => entity?.id).map(pictureReference);
  if (!added.length) return null;
  const { lines, steps } = blockSteps(source);
  const close = lines.length - 1;
  if (!steps.length && !template && onlyGuidance(lines, 1, close - 1)) {
    return [lines[0], ...added, lines[close]].join('\n');
  }
  const before = steps[index] ?? null;
  const at = before ? before.at : (steps.length ? steps.at(-1).last + 1 : close);
  const above = before ? steps[steps.indexOf(before) - 1] : steps.at(-1);
  // the lines after a step with words start a new paragraph
  const blank = above && above.end > above.at && at === above.end + 1 ? [''] : [];
  return [...lines.slice(0, at), ...blank, ...added, ...lines.slice(at)].join('\n');
}

/** A step's own lines: its picture and its words, without the blank lines after them. */
function ownLines(lines, step) {
  return lines.slice(step.at, step.end + 1);
}

/**
 * The steps' stretch written again in `order` (indexes of the steps as they are now):
 * each step's lines as they were, a blank line after a step that has words.
 */
function rewritten(lines, steps, order) {
  const first = steps[0].at;
  const end = steps.at(-1).end;
  const out = [];
  order.forEach((index, place) => {
    const step = steps[index];
    out.push(...ownLines(lines, step));
    if (place < order.length - 1 && step.end > step.at) out.push('');
  });
  return [...lines.slice(0, first), ...out, ...lines.slice(end + 1)].join('\n');
}

/** The block with step `from` moved to stand at `to` (both counted among the steps as they are now), or null when it stays. */
export function moveStep(source, from, to) {
  const { lines, steps } = blockSteps(source);
  if (!steps[from] || to < 0 || to >= steps.length || from === to) return null;
  const order = steps.map((_step, index) => index);
  order.splice(from, 1);
  order.splice(to, 0, from);
  return rewritten(lines, steps, order);
}

/** The block without step `index`, its picture and its words, and the blank line that set it apart. */
export function removeStep(source, index) {
  const { lines, steps } = blockSteps(source);
  const step = steps[index];
  if (!step) return null;
  let first = step.at;
  let last = step.last;
  // the last step takes the blank lines that set it apart from the one before
  if (index === steps.length - 1 && index > 0) first = steps[index - 1].end + 1;
  if (index === steps.length - 1) last = lines.length - 2;
  return [...lines.slice(0, first), ...lines.slice(last + 1)].join('\n');
}

/**
 * The block with step `index`'s words written as `words` (lines of Markdown, trimmed),
 * in place of the ones it had; none takes them out. Null when nothing changes.
 */
export function setStepWords(source, index, words) {
  const { lines, steps } = blockSteps(source);
  const step = steps[index];
  if (!step) return null;
  const said = String(words ?? '').replace(/\r\n?/g, '\n').trim();
  if (said === step.words) return null;
  const now = said ? said.split('\n') : [];
  const next = steps[index + 1];
  // words put under a step that had none stand apart from the next step's picture
  const apart = now.length && step.end === step.at && next && next.at === step.at + 1 ? [''] : [];
  return [...lines.slice(0, step.at + 1), ...now, ...apart, ...lines.slice(step.end + 1)].join('\n');
}

/** The block with step `index`'s picture line given `changes` (`{ caption }`, `{ zoom }`), or null when nothing changes. */
export function setStepPicture(source, index, changes) {
  const { lines, steps } = blockSteps(source);
  const step = steps[index];
  if (!step) return null;
  const line = sizedLine(lines[step.at], step.ref, changes);
  if (line === null || line === lines[step.at]) return null;
  return [...lines.slice(0, step.at), line, ...lines.slice(step.at + 1)].join('\n');
}

/**
 * The one change that turns the block at `from`, now `before`, into `after`: only the
 * stretch that differs, so the lines around it and a cursor there stay put.
 */
export function stepChange(from, before, after) {
  if (after === null || after === before) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < before.length - start && end < after.length - start
    && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  return { from: from + start, to: from + before.length - end, insert: after.slice(start, after.length - end) };
}
