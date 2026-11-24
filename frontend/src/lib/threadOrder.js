/**
 * The order a video thread posts in: its posts top to bottom, as a list of blocks.
 *
 * - `recap`: the places on a map or the proofs sheet, with `#scenes`;
 * - `video`: the video, or its link;
 * - `first`: the first place on its own;
 * - `places`: a post per place, the ones after the first when `first` is in the list.
 *
 * A thread always holds the video and the places; the recap and the first place are
 * the analyst's to add or leave out, and every block goes anywhere in the list. All in
 * one is the one post that holds everything, `['all']`, and stands alone.
 *
 * The four orders Post has always offered are ready lists (`ORDER_PRESETS`), and the
 * first 0.3.4 builds stored one by its name (`'recap'`), which still reads as its list.
 * This module imports nothing, so `lib/post.js` and `lib/videoThread.js` both read it.
 * The server checks the same rule (`api/templates.py` `ThreadBlock`).
 */

/** The blocks a thread is made of, as the editor offers them. */
export const THREAD_BLOCKS = Object.freeze(['recap', 'video', 'first', 'places']);
/** The blocks a thread can leave out. */
export const OPTIONAL_BLOCKS = Object.freeze(['recap', 'first']);

/** The four ready orders, the default first: one template start each. */
export const ORDER_PRESETS = Object.freeze({
  recap: Object.freeze(['recap', 'video', 'places']),
  video: Object.freeze(['video', 'places']),
  proof: Object.freeze(['first', 'video', 'places']),
  all: Object.freeze(['all']),
});
export const ORDERS = Object.freeze(Object.keys(ORDER_PRESETS));
export const DEFAULT_ORDER = 'recap';

/** What each ready order is called where one is picked. */
export const ORDER_NAMES = Object.freeze({
  recap: 'Recap first',
  video: 'Video first',
  proof: 'Proof first',
  all: 'All in one',
});
/** What each ready order puts where, in a line under its name. */
export const ORDER_WORDS = Object.freeze({
  recap: 'The places on a map or the proofs sheet, then the video, then a post per place',
  video: 'The video, then a post per place',
  proof: 'The first place, then the video, then the other places',
  all: 'One post with the places and their pictures',
});
/** What an order of the analyst's own is called beside the four. */
export const OWN_ORDER_NAME = 'Your order';

/**
 * An order as a fresh list, from a list or a ready order's name, or null when it is
 * none: a block unknown or said twice, the video or the places missing, All in one
 * with anything else.
 */
export function orderBlocks(value) {
  if (typeof value === 'string') return ORDER_PRESETS[value] ? [...ORDER_PRESETS[value]] : null;
  if (!Array.isArray(value) || !value.length) return null;
  const list = [...value];
  if (list.length === 1 && list[0] === 'all') return list;
  if (list.some((block) => !THREAD_BLOCKS.includes(block))) return null;
  if (new Set(list).size !== list.length) return null;
  if (!list.includes('video') || !list.includes('places')) return null;
  return list;
}

/** An order as a draft or a template holds it, Recap first's when it says none. */
export const threadOrder = (value) => orderBlocks(value) ?? [...ORDER_PRESETS[DEFAULT_ORDER]];

/** One spelling of an order, to compare two or to key what each one keeps. */
export const orderKey = (value) => (orderBlocks(value) ?? []).join(' ');

/** The ready order a list is, by name, or null for one of the analyst's own. */
export function presetOf(value) {
  const key = orderKey(value);
  return ORDERS.find((name) => ORDER_PRESETS[name].join(' ') === key) ?? null;
}

export const isAllInOne = (value) => orderKey(value) === 'all';
export const hasRecap = (value) => (orderBlocks(value) ?? []).includes('recap');

/** What a block is called in the editor's list: `places` follows whether the first place has its own post. */
export function blockName(block, order = []) {
  if (block === 'recap') return 'Recap';
  if (block === 'video') return 'Video';
  if (block === 'first') return 'First place';
  if (block === 'all') return 'All in one';
  return order.includes('first') ? 'Other places' : 'Each place';
}

/** What a block's post carries, in a line under its name. */
export function blockWords(block, order = []) {
  if (block === 'recap') return 'The places on a map or the proofs sheet';
  if (block === 'video') return 'The video, or its link';
  if (block === 'first') return 'Your first place on its own';
  if (block === 'all') return 'One post with the places and their pictures';
  return order.includes('first') ? 'A post for each of the others' : 'A post per place, with its proof’s picture';
}

const PHRASES = {
  recap: 'the recap',
  video: 'the video',
  first: 'the first place',
};

/** An order said in a line: a ready order's own words, an order of the analyst's spelled out. */
export function orderWords(value) {
  const preset = presetOf(value);
  if (preset) return ORDER_WORDS[preset];
  const list = orderBlocks(value) ?? [];
  const said = list.map((block) => PHRASES[block] ?? (list.includes('first') ? 'the other places' : 'a post per place'));
  const line = said.join(', then ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The order with the block at `from` moved to `to`. */
export function moveBlock(order, from, to) {
  const list = [...order];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const [block] = list.splice(from, 1);
  list.splice(to, 0, block);
  return list;
}

/** The order with an optional block put back, at the top, where a thread opens. */
export function withBlock(order, block) {
  if (!OPTIONAL_BLOCKS.includes(block) || order.includes(block) || isAllInOne(order)) return [...order];
  return [block, ...order];
}

/** The order without an optional block. The video and the places always stay. */
export function withoutBlock(order, block) {
  if (!OPTIONAL_BLOCKS.includes(block)) return [...order];
  return order.filter((one) => one !== block);
}
