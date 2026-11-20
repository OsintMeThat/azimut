/**
 * The citation card: a chip or a written link, hovered or with the cursor resting in
 * it, shows after a short rest what the case knows of what it cites. Its kind and
 * name, who posted it and when, the day the case saw it, its archived copy, a file's
 * SHA-256, how often this note cites it, and a picture's thumbnail. Then what to do
 * with it: open the item in its tool, open the page or its archived copy in a new
 * tab, copy the reference as the list of sources prints it, edit the link in the Link
 * field (`editor/linkField.js`), and bookmark a page the case lacks, so it has a day
 * it was seen.
 *
 * Nothing is fetched from the card. It reads the case through the editor's handlers:
 * `source(id)` for a chip (`/sources/item`), `lookup(url, words)` for a link, read by
 * the Link field's own adapter (`lookupAddress`). A page opens only on a press.
 *
 * Keyboard: the card shows once the cursor rests inside a link's text, or right next
 * to a chip, which the drawn page steps over whole (`caretCitation`); Tab then walks
 * into its actions, the arrows along them, and Escape closes it and gives the keys
 * back to the note. The raw Markdown shows the same card over
 * `[[entity:…|…]]` and `[words](https://…)`, Edit link aside, since the source is
 * already there to edit. In a drawn table or aligned block, hovering a chip or a link
 * shows it too.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Prec, StateEffect, StateField } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, showTooltip } from '@codemirror/view';

import { fileUrl } from '../../fileUrl.js';
import { findReferences } from '../syntax.js';
import { openLink, openLinkField } from './bubble.js';
import { drawn } from './decorations.js';
import { iconSvg } from './icon.js';
import { TYPE_ICONS, citedTimes, el, knownItem, lookupAddress, recordItem } from './linkField.js';
import { linkAt, shownWords } from './marks.js';
import { focused, noteCase, noteHandlers, resolve, setNoteCase } from './state.js';

/** How long the pointer rests on a citation before its card shows. */
export const HOVER_MS = 350;
/** How long the cursor rests in a citation before its card shows. */
export const CARET_MS = 600;
/** How long a hovered card waits for the pointer to reach it. */
export const LEAVE_MS = 300;

/** What a card's actions do to the note rather than lead somewhere. */
const OWN = new Set(['copy', 'edit']);

/** The blocks drawn whole whose chips and links a hover reads off the page: a table, an aligned passage. */
const READ_IN = new Set(['table', 'aligned']);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-11-17…` as it is said on the card: `17 November 2026`; "" for anything else. */
export function longDay(value) {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  const month = MONTHS[Number(day?.[2]) - 1];
  if (!day || !month || Number(day[3]) < 1 || Number(day[3]) > 31) return '';
  return `${Number(day[3])} ${month} ${day[1]}`;
}

/** `aljazeera.com` for an address. */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const WEB = /^https?:\/\//i;

/** `url` when it is a web address, else "". */
function webOnly(url) {
  return WEB.test(String(url ?? '')) ? url : '';
}

/** Whether `pos` is in code, where a reference or a link stays text. */
function inCode(state, pos) {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 50) ?? syntaxTree(state);
  for (let node = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
  }
  return false;
}

/**
 * The citation at `pos`: a chip, `{ kind: 'chip', from, to, id, label }`, or a written
 * link to a web page, `{ kind: 'link', from, to, url, words }`; null for anything else.
 * `inside` asks for the cursor strictly inside it, not at an edge, which is where
 * writing goes on past it.
 */
export function citationAt(state, pos, { inside = false } = {}) {
  if (pos < 0 || pos > state.doc.length) return null;
  const within = (from, to) => (inside ? pos > from && pos < to : pos >= from && pos <= to);
  const line = state.doc.lineAt(pos);
  const ref = findReferences(line.text, line.from).find((one) => one.kind === 'entity' && within(one.from, one.to));
  if (ref) return inCode(state, ref.from) ? null : { kind: 'chip', from: ref.from, to: ref.to, id: ref.id, label: ref.label };
  const link = linkAt(state, { from: pos, to: pos });
  if (!link || !WEB.test(link.url) || !within(link.from, link.to)) return null;
  return { kind: 'link', from: link.from, to: link.to, url: link.url, words: shownWords(link.words).trim() };
}

/**
 * The citation a resting cursor shows the card of: one it stands inside, or, on the drawn
 * page where a chip is one piece the cursor steps over, a chip right next to it: just
 * after it, or just before it when no citation ends there too.
 */
export function caretCitation(state, pos) {
  const inside = citationAt(state, pos, { inside: true });
  if (inside || !state.field(drawn, false)) return inside;
  const line = state.doc.lineAt(pos);
  const chips = findReferences(line.text, line.from).filter((one) => one.kind === 'entity' && (one.to === pos || one.from === pos));
  const chip = chips.find((one) => one.to === pos) ?? (citationAt(state, pos)?.kind === 'link' ? null : chips.find((one) => one.from === pos));
  if (!chip || inCode(state, chip.from)) return null;
  return { kind: 'chip', from: chip.from, to: chip.to, id: chip.id, label: chip.label };
}

/** Whether the cursor at `pos` still stands by `target`: inside a link, inside or at the edges of a chip. */
function standsBy(target, pos) {
  return target.kind === 'chip' ? pos >= target.from && pos <= target.to : pos > target.from && pos < target.to;
}

/** What stands for a citation, so two reads of the same one are known as one. */
function keyOf(target) {
  return target.kind === 'chip' ? `chip:${target.id}:${target.from}` : `link:${target.url}:${target.from}`;
}

/**
 * The citation the pointer is over in `event`, or null: a chip or a link the page
 * draws, one inside a drawn table or aligned passage (read off the page, `inBlock`),
 * or the source of one in the raw Markdown and on the line being written.
 */
function pointedAt(view, event) {
  const node = event.target instanceof Element ? event.target : null;
  if (!node || !view.contentDOM.contains(node)) return null;
  // a drawn block first: what it holds is said by its own elements, its position being the block's
  const block = node.closest('.cm-block');
  if (block) {
    if (!READ_IN.has(block.dataset.block)) return null;
    const from = view.posAtDOM(block);
    // a chip as the page draws it (a table's grid), or as its Markdown is drawn
    const ref = node.closest('[data-chip][data-entity-id], a[data-entity-id]');
    if (ref) {
      const label = (ref.matches('[data-chip]') ? ref.lastChild?.textContent : ref.textContent) ?? '';
      return { kind: 'chip', from, to: from, id: ref.dataset.entityId, label: label.trim(), inBlock: true, node: ref };
    }
    const link = node.closest('a[href]');
    const url = link?.getAttribute('href') ?? '';
    if (WEB.test(url)) return { kind: 'link', from, to: from, url, words: link.textContent.trim(), inBlock: true, node: link };
    return null;
  }
  const chip = node.closest('[data-chip]');
  if (chip) {
    const found = citationAt(view.state, view.posAtDOM(chip));
    return found && { ...found, node: chip };
  }
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return null;
  // only words under the pointer: not the end of a line it is past
  const box = view.coordsAtPos(pos);
  const slack = view.defaultCharacterWidth;
  if (!box || event.clientY < box.top || event.clientY > box.bottom || event.clientX < box.left - slack || event.clientX > box.right + slack) return null;
  const found = citationAt(view.state, pos);
  // the words hovered, which the card stands under: a link's start may sit at the end of the line above
  const words = node.closest('.cm-link, .cm-ref-source');
  return found && (words ? { ...found, node: words } : found);
}

// -- what the card says ------------------------------------------------------------

/** A written link's words and address. */
const WRITTEN = /(?<!!)\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/gi;

/**
 * The words of every written link to `url` in `text`, in the note's order: the list of
 * sources is named by the first and may take its title from another, so the card's
 * reference reads them all, as the list does.
 */
export function linkWords(text, url) {
  const found = [];
  for (const [, words, address] of String(text ?? '').matchAll(WRITTEN)) {
    // the words as they read: a chip as its label, no marks of bold, italic or code
    const said = shownWords(words).replace(/\*\*|~~|[*`]/g, '').trim();
    if (address === url && said && !found.includes(said)) found.push(said);
  }
  return found;
}

/**
 * Who posted it, as the academic list leads with it: the author the case records, with
 * the account its address names when that says more (`Yemeni Military Media (@MMY1444)`),
 * else that account alone, said to be read off the address.
 */
export function byLine(item) {
  const { author = '', account = '' } = item;
  if (author && account && !author.toLowerCase().includes(account.toLowerCase())) return { value: `${author} (${account})` };
  if (author) return { value: author };
  if (account) return { value: account, note: 'from its address' };
  return null;
}

/**
 * What the case knows of `target`, read through the editor's handlers, nothing
 * fetched: `{ target, entity, item, title, reference, cited }`, with `missing` for a
 * chip whose item is no longer in the case. `item` is null for a page the case lacks.
 */
export async function readCitation(view, target) {
  const { state } = view;
  const handlers = state.facet(noteHandlers);
  const info = state.field(noteCase, false);
  const text = state.doc.toString();
  if (target.kind === 'chip') {
    const entity = info ? resolve(info, target.id) : null;
    if (!entity) return { target, missing: true };
    let answer = null;
    if (handlers.source) {
      try {
        answer = await handlers.source(entity.id);
      } catch {
        answer = null;
      }
    }
    if (answer && !answer.known) return { target, missing: true };
    const item = answer?.known?.id ? knownItem(answer.known) : recordItem(entity);
    return { target, entity, item, title: '', reference: answer?.reference ?? '', cited: citedTimes(text, item, item.address) };
  }
  const lookup = handlers.lookup ?? null;
  const words = linkWords(text, target.url);
  const said = await lookupAddress(target.url, { lookup, entities: info?.entities ?? [], words: words.length ? words : [target.words] });
  const entity = said.item?.id && info ? resolve(info, said.item.id) : null;
  return { target, entity, item: said.item, title: said.title, reference: said.reference, cited: Math.max(1, citedTimes(text, said.item, target.url)) };
}

/** How the day an item came into the case is said, by how it came in. */
const ARRIVALS = { made: 'Made', captured: 'Captured' };

/** `e1e32f4f…46cee09b`: a fingerprint short enough to read, whole on hover. */
function shortHash(sha) {
  return sha.length > 20 ? `${sha.slice(0, 8)}…${sha.slice(-8)}` : sha;
}

/** The icon of what a card is about. */
function iconOf(item) {
  if (item.noun === 'Video') return 'video';
  if (item.type === 'media' || item.type === 'capture') return item.noun === 'Audio' ? 'audio' : 'image';
  return TYPE_ICONS[item.type] ?? 'tag';
}

/**
 * The card for `said` (`readCitation`'s answer) as plain data, tested without a page:
 * `{ state, icon, kicker, title, line, thumb, rows: [{ label, value, tone, note, href, full }],
 * actions: [{ id, label, title, icon, href, primary }] }`. `state` is `item`, `page`
 * (a page the case lacks) or `missing`. `canEdit` offers Edit link on a written link.
 */
export function cardModel(said, { canEdit = false, handlers = {} } = {}) {
  const { target } = said;
  if (said.missing) {
    return {
      state: 'missing', icon: 'unlink', kicker: 'Case item', title: target.label || target.id, line: 'No longer in the case.', thumb: '', rows: [], actions: [],
    };
  }
  // only a web address is ever a link: a record's own fields are what the analyst typed
  const item = said.item ? { ...said.item, address: webOnly(said.item.address), archive: webOnly(said.item.archive) } : null;
  const cited = said.cited === 1 ? 'Cited once' : `Cited ${said.cited} times`;
  const actions = [];
  const editLink = canEdit && target.kind === 'link' && !target.inBlock
    ? { id: 'edit', label: 'Edit link', title: 'Change the address or the words, or cite a case item instead', icon: 'edit' } : null;
  const copy = said.reference
    ? { id: 'copy', label: 'Copy reference', title: 'Copy it as the list of sources prints it', icon: 'copy' } : null;
  if (!item) {
    if (handlers.bookmark) {
      actions.push({ id: 'bookmark', label: 'Bookmark it', title: 'File the page as a bookmark of the case, seen today. The note stays as it is', icon: 'bookmark', primary: true });
    }
    actions.push({ id: 'page', label: 'Open page', title: target.url, icon: 'external', href: target.url });
    actions.push(copy, editLink);
    return {
      state: 'page',
      icon: 'link',
      kicker: ['Web page', hostOf(target.url)].filter(Boolean).join(' · '),
      title: target.words || said.title || target.url,
      line: '',
      thumb: '',
      rows: [
        { label: 'Seen', value: 'Not in the case', tone: 'warn' },
        { label: 'Archived', value: 'Not archived', tone: 'warn' },
        { label: 'In this note', value: cited },
      ],
      actions: actions.filter(Boolean),
    };
  }
  const web = Boolean(item.address || item.archive);
  const rows = [];
  // what only the server reads (a post's author and day) is said missing only when it was asked
  if (item.full && (web || item.published)) rows.push(item.published ? { label: 'Posted', value: longDay(item.published) } : { label: 'Posted', value: 'Not recorded', tone: 'muted' });
  const by = byLine(item);
  if (item.full && (web || by)) rows.push(by ? { label: 'By', ...by } : { label: 'By', value: 'Not recorded', tone: 'muted' });
  const arrived = ARRIVALS[item.arrival] ?? 'Seen';
  if (longDay(item.seen)) rows.push({ label: arrived, value: longDay(item.seen) });
  else if (web) rows.push({ label: 'Seen', value: 'Not recorded', tone: 'muted' });
  if (item.archive) {
    rows.push({ label: 'Archived', value: longDay(item.archivedAt) || 'Archived copy', note: hostOf(item.archive), tone: 'ok', href: item.archive });
  } else if (web) rows.push({ label: 'Archived', value: 'Not archived', tone: 'warn' });
  if (item.sha256) rows.push({ label: 'SHA-256', value: shortHash(item.sha256), full: item.sha256, tone: 'mono' });
  rows.push({ label: 'In this note', value: cited });
  // without the app around the note (the extension's panel) there is no case to open it in: Open page says where it lives
  if (said.entity && handlers.inCase !== false && (handlers.opener || handlers.open)) {
    const opener = handlers.opener?.(said.entity);
    actions.push({ id: 'open', label: opener?.label ?? 'Open', title: opener ? `${opener.label}, where it was made` : 'Open it in the case', icon: 'enter' });
  }
  if (item.address) actions.push({ id: 'page', label: 'Open page', title: item.address, icon: 'external', href: item.address });
  if (item.archive) actions.push({ id: 'archive', label: 'Archived copy', title: item.archive, icon: 'clock', href: item.archive });
  actions.push(copy, editLink);
  return {
    state: 'item',
    icon: iconOf(item),
    kicker: [item.noun, hostOf(item.address || item.archive)].filter(Boolean).join(' · '),
    title: item.label || target.words || target.label || '',
    line: '',
    thumb: item.thumb || '',
    rows,
    actions: actions.filter(Boolean),
  };
}

// -- the card on the page ------------------------------------------------------------

/** Show the card (`{ target, by, said }`, `by` being `hover` or `caret`), or take it away (null). */
export const setCard = StateEffect.define();

const cardState = StateField.define({
  create: () => null,
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setCard)) next = effect.value;
      // the Link field opens over the words: it is what edits them now
      if (effect.is(openLink) && effect.value) next = null;
    }
    if (!next) return null;
    if (next === value) {
      // typing, an Undo: the words it stood under moved
      if (transaction.docChanged) return null;
      if (value.by === 'caret' && transaction.selection) {
        const range = transaction.state.selection.main;
        if (!range.empty || !standsBy(value.target, range.head)) return null;
      }
      return value;
    }
    // the same citation shown again keeps its card, so nothing is drawn twice
    if (value && keyOf(value.target) === keyOf(next.target)) return { ...next, tooltip: value.tooltip };
    const shown = { ...next };
    shown.tooltip = { pos: next.target.from, above: false, create: (view) => new CardView(view, shown) };
    return shown;
  },
  provide: (field) => showTooltip.from(field, (value) => value?.tooltip ?? null),
});

/** The card shown now, `{ target, by, said }`, or null. */
export function shownCard(state) {
  const value = state.field(cardState, false);
  return value ? { target: value.target, by: value.by, said: value.said } : null;
}

function closeCard(view, { focus = false } = {}) {
  if (view.state.field(cardState, false)) view.dispatch({ effects: setCard.of(null) });
  if (focus) view.focus();
}

/** The actions of a card walked with the arrows, one Tab stop. */
function roving(bar) {
  const items = () => [...bar.querySelectorAll('button, a[href]')];
  const settle = (current) => items().forEach((item) => { item.tabIndex = item === current ? 0 : -1; });
  settle(items()[0]);
  bar.addEventListener('keydown', (event) => {
    const list = items();
    const at = list.indexOf(event.target.closest?.('button, a[href]'));
    if (at < 0) return;
    const next = { ArrowRight: list[(at + 1) % list.length], ArrowLeft: list[(at - 1 + list.length) % list.length], Home: list[0], End: list.at(-1) }[event.key];
    if (!next) return;
    event.preventDefault();
    settle(next);
    next.focus();
  });
}

class CardView {
  constructor(view, card) {
    this.view = view;
    this.card = card;
    this.said = card.said;
    this.timer = 0;
    this.dom = el('div', 'cm-cite');
    this.dom.setAttribute('role', 'dialog');
    cards.set(this.dom, this);
    this.dom.addEventListener('mousedown', (event) => {
      // a press on the card keeps the note's cursor where it was; its links and buttons answer themselves
      if (!event.target.closest('a[href], button')) event.preventDefault();
    });
    this.dom.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeCard(this.view, { focus: true });
    });
    this.draw();
  }

  get model() {
    const { state } = this.view;
    // the Link field is the drawn page's; the raw Markdown has the link's source to edit
    const canEdit = !state.readOnly && Boolean(state.field(drawn, false));
    return cardModel(this.said, { canEdit, handlers: state.facet(noteHandlers) });
  }

  draw() {
    const model = this.model;
    const caseId = this.view.state.field(noteCase, false)?.caseId ?? '';
    // the card is the tooltip itself, whose classes CodeMirror set: only its state's is changed
    this.dom.classList.remove('cm-cite-item', 'cm-cite-page', 'cm-cite-missing');
    this.dom.classList.add(`cm-cite-${model.state}`);
    this.dom.setAttribute('aria-label', `About ${model.title}`);
    const said = el('div', 'cm-cite-said', el('div', 'cm-cite-kicker', model.kicker), el('div', 'cm-cite-title', model.title));
    said.querySelector('.cm-cite-title').setAttribute('dir', 'auto');
    const head = el('div', 'cm-cite-head', el('span', 'cm-cite-icon', iconSvg(model.icon, 16)), said);
    if (model.thumb && caseId) {
      const picture = el('img', 'cm-cite-thumb');
      picture.alt = '';
      picture.loading = 'lazy';
      picture.src = fileUrl(caseId, model.thumb);
      picture.addEventListener('error', () => picture.remove());
      head.append(picture);
    }
    const parts = [head];
    if (model.line) parts.push(el('p', 'cm-cite-line', model.line));
    if (model.rows.length) {
      const rows = el('dl', 'cm-cite-rows');
      for (const row of model.rows) {
        const value = row.href ? el('a', '', row.value) : el('span', '', row.value);
        if (row.href) {
          value.href = row.href;
          value.target = '_blank';
          value.rel = 'noopener noreferrer';
          value.title = row.href;
          value.tabIndex = -1;
        }
        if (row.full) value.title = row.full;
        const dd = el('dd', row.tone ? `cm-cite-${row.tone}` : '', row.tone === 'ok' ? iconSvg('check', 12) : null, value,
          row.note ? el('span', 'cm-cite-note', ` · ${row.note}`) : null);
        rows.append(el('dt', '', row.label), dd);
      }
      parts.push(rows);
    }
    if (model.actions.length) {
      // where it leads first, then what the note does with it, kept together at the end
      const go = el('div', 'cm-cite-go', model.actions.filter((action) => !OWN.has(action.id)).map((action) => this.action(action)));
      const own = el('div', 'cm-cite-own', model.actions.filter((action) => OWN.has(action.id)).map((action) => this.action(action)));
      const bar = el('div', 'cm-cite-actions', go.childElementCount ? go : null, own.childElementCount ? own : null);
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'What to do with it');
      roving(bar);
      parts.push(bar);
    }
    // what a press did, said to a screen reader
    const status = el('div', 'cm-cite-status');
    status.setAttribute('aria-live', 'polite');
    parts.push(status);
    this.dom.replaceChildren(...parts);
  }

  /** One action's button, or its link for what opens in a new tab. */
  action(action) {
    const node = el(action.href ? 'a' : 'button', `cm-cite-action${action.primary ? ' cm-cite-primary' : ''}`, iconSvg(action.icon, 13),
      el('span', '', action.label));
    node.dataset.action = action.id;
    node.title = action.title;
    if (action.href) {
      node.href = action.href;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
      node.addEventListener('click', () => closeCard(this.view));
      return node;
    }
    node.type = 'button';
    node.addEventListener('click', () => this.run(action.id, node));
    return node;
  }

  async run(id, node) {
    const { view } = this;
    const handlers = view.state.facet(noteHandlers);
    const { target } = this.card;
    if (id === 'open') {
      const opener = handlers.opener?.(this.said.entity);
      closeCard(view);
      if (opener) opener.open();
      else handlers.open?.(this.said.entity);
    } else if (id === 'copy') {
      let copied = true;
      try {
        await navigator.clipboard.writeText(this.said.reference);
      } catch {
        copied = false;
      }
      this.say(node, copied ? 'Copied' : 'Not copied', copied ? 'Reference copied' : 'The browser refused the clipboard', copied);
    } else if (id === 'edit') {
      closeCard(view);
      view.dispatch({ selection: { anchor: Math.min(target.from + 1, target.to) } });
      view.focus();
      openLinkField(view);
    } else if (id === 'bookmark') {
      // said busy rather than disabled: a disabled button would drop the focus, and the card with it
      if (node.getAttribute('aria-disabled') === 'true') return;
      node.setAttribute('aria-disabled', 'true');
      node.lastChild.textContent = 'Filing…';
      const filed = await handlers.bookmark?.(target.url, this.said.title || target.words);
      if (!filed?.id) {
        node.removeAttribute('aria-disabled');
        node.lastChild.textContent = 'Bookmark it';
        return;
      }
      const held = this.dom.contains(document.activeElement);
      await this.refresh();
      // the card is drawn again: the keys stay in it
      if (held) this.dom.querySelector('.cm-cite-actions [tabindex="0"]')?.focus({ preventScroll: true });
      this.dom.querySelector('.cm-cite-status').textContent = 'Bookmarked';
    }
  }

  /** A press answered on its button for a moment, and said to a screen reader. */
  say(node, word, spoken, done) {
    const [icon, label] = node.children;
    const was = label.textContent;
    label.textContent = word;
    if (done) icon.replaceWith(iconSvg('check', 13));
    node.classList.toggle('cm-cite-done', done);
    this.dom.querySelector('.cm-cite-status').textContent = spoken;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      label.textContent = was;
      if (done) node.firstChild.replaceWith(icon);
      node.classList.remove('cm-cite-done');
    }, 1600);
  }

  /** The case read again (a bookmark just filed): the item it holds now can be opened. */
  update(update) {
    const { item, entity } = this.said;
    if (!item?.id || entity || !update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setNoteCase)))) return;
    const info = update.state.field(noteCase, false);
    const found = info ? resolve(info, item.id) : null;
    if (!found) return;
    this.said = { ...this.said, entity: found };
    const held = this.dom.contains(document.activeElement);
    this.draw();
    if (held) this.dom.querySelector('.cm-cite-actions [tabindex="0"]')?.focus({ preventScroll: true });
  }

  /** Read the citation again (a bookmark was filed) and draw what it says now. */
  async refresh() {
    this.said = await readCitation(this.view, this.card.target);
    this.draw();
  }

  /**
   * Under what was hovered: the chip, the first line of the link's words, the chip or
   * link in a drawn block (whose start the position says). Else under the citation's
   * first character, which, unlike its start, is never the end of the line above.
   */
  getCoords(pos) {
    const node = this.card.target.node;
    if (node?.isConnected) return node.getClientRects()[0] ?? node.getBoundingClientRect();
    const { to } = this.card.target;
    return (to > pos && this.view.coordsAtPos(pos + 1, -1)) || this.view.coordsAtPos(pos, 1) || this.view.coordsAtPos(pos);
  }

  /** Walk into the actions from the note. */
  enter() {
    const first = this.dom.querySelector('.cm-cite-actions [tabindex="0"]');
    first?.focus();
    return Boolean(first);
  }

  destroy() {
    clearTimeout(this.timer);
  }
}

/** Each card on a page, by its element. */
const cards = new WeakMap();

/** The card's view on the page now, or null. */
function cardView(view) {
  const node = view.dom.querySelector('.cm-cite');
  return node ? cards.get(node) ?? null : null;
}

/**
 * Watches the pointer and the cursor: a citation rested on long enough is read, then
 * shown; a hovered card goes once the pointer has left it and its words a moment.
 */
const watch = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.wait = null;
    this.leave = 0;
    this.move = (event) => this.moved(event);
    this.out = () => this.left();
    // the keys or a press gone elsewhere in the app take the card away; focus dropped to
    // nowhere (a button drawn again, the window left) does not
    this.blur = (event) => {
      const to = event.relatedTarget;
      if (to && !view.dom.contains(to)) queueMicrotask(() => closeCard(view));
    };
    this.press = (event) => {
      if (view.state.field(cardState, false) && !view.dom.contains(event.target)) closeCard(view);
    };
    view.dom.addEventListener('mousemove', this.move);
    view.dom.addEventListener('mouseleave', this.out);
    view.dom.addEventListener('focusout', this.blur);
    document.addEventListener('mousedown', this.press, true);
  }

  moved(event) {
    if (event.buttons) return;
    const shown = this.view.state.field(cardState, false);
    if (event.target instanceof Element && event.target.closest('.cm-cite')) {
      clearTimeout(this.leave);
      return;
    }
    const target = pointedAt(this.view, event);
    if (target && shown && keyOf(target) === keyOf(shown.target)) {
      clearTimeout(this.leave);
      if (this.wait?.by === 'hover') this.cancel();
      return;
    }
    if (target) {
      if (this.wait?.key !== keyOf(target)) this.start(target, 'hover', HOVER_MS);
    } else if (this.wait?.by === 'hover') this.cancel();
    if (shown?.by === 'hover') this.goSoon();
  }

  left() {
    if (this.wait?.by === 'hover') this.cancel();
    if (this.view.state.field(cardState, false)?.by === 'hover') this.goSoon();
  }

  goSoon() {
    clearTimeout(this.leave);
    this.leave = setTimeout(() => {
      const shown = this.view.state.field(cardState, false);
      const card = this.view.dom.querySelector('.cm-cite');
      // the keys in it keep it; a press with the mouse leaves it to the pointer
      if (shown?.by !== 'hover' || card?.matches(':hover') || card?.querySelector(':focus-visible')) return;
      closeCard(this.view);
    }, LEAVE_MS);
  }

  cancel() {
    if (this.wait) clearTimeout(this.wait.timer);
    this.wait = null;
  }

  /** Read `target` now and show it once `delay` has passed, if nothing else was rested on meanwhile. */
  start(target, by, delay) {
    this.cancel();
    const wait = { key: keyOf(target), by, timer: 0 };
    this.wait = wait;
    const read = readCitation(this.view, target).catch(() => null);
    wait.timer = setTimeout(async () => {
      const said = await read;
      if (this.wait !== wait || !said) return;
      this.wait = null;
      clearTimeout(this.leave);
      const effects = [setCard.of({ target, by, said })];
      if (by === 'caret') {
        const model = cardModel(said);
        effects.push(EditorView.announce.of(`${model.title}. ${model.kicker || model.line}. Tab for what to do with it, Escape to close.`));
      }
      this.view.dispatch({ effects });
    }, delay);
  }

  update(update) {
    if (update.docChanged) {
      // typing past a citation is not resting on it
      if (this.wait?.by === 'caret') this.cancel();
      return;
    }
    if (!update.selectionSet) return;
    const { state } = update;
    const range = state.selection.main;
    const target = state.field(focused, false) && range.empty ? caretCitation(state, range.head) : null;
    if (!target) {
      if (this.wait?.by === 'caret') this.cancel();
      return;
    }
    const shown = state.field(cardState, false);
    if (shown && keyOf(shown.target) === keyOf(target)) {
      // a hovered card the cursor then went into stays while the cursor does
      if (shown.by === 'hover') queueMicrotask(() => this.view.dispatch({ effects: setCard.of({ ...shownCard(this.view.state), by: 'caret' }) }));
      return;
    }
    if (this.wait?.key !== keyOf(target)) this.start(target, 'caret', CARET_MS);
  }

  destroy() {
    this.cancel();
    clearTimeout(this.leave);
    this.view.dom.removeEventListener('mousemove', this.move);
    this.view.dom.removeEventListener('mouseleave', this.out);
    this.view.dom.removeEventListener('focusout', this.blur);
    document.removeEventListener('mousedown', this.press, true);
  }
});

const keys = Prec.high(keymap.of([
  {
    key: 'Escape',
    run: (view) => {
      if (!view.state.field(cardState, false)) return false;
      closeCard(view);
      return true;
    },
  },
  {
    // the card the cursor rests on is one Tab away: its actions, walked with the arrows
    key: 'Tab',
    run: (view) => {
      const shown = view.state.field(cardState, false);
      if (shown?.by !== 'caret') return false;
      return cardView(view)?.enter() ?? false;
    },
  },
]));

const look = EditorView.theme({
  '.cm-tooltip.cm-cite': {
    width: '460px', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box', marginTop: '6px', borderRadius: '8px', border: '1px solid var(--border-strong)',
    background: 'var(--bg-2)', boxShadow: 'var(--shadow-2)', color: 'var(--text-1)', fontFamily: 'var(--font-sans)', fontSize: '12.5px', lineHeight: '1.4',
    overflow: 'hidden',
  },
  // a card that has one sentence to say is as wide as it
  '.cm-tooltip.cm-cite.cm-cite-missing': { width: 'auto', minWidth: '260px' },
  '.cm-cite-head': { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px 10px' },
  '.cm-cite-icon': {
    display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: '30px', height: '30px', borderRadius: '6px',
    background: 'var(--bg-3)', color: 'var(--text-2)',
  },
  '.cm-cite-item .cm-cite-icon': { color: 'var(--accent)', background: 'var(--accent-soft)' },
  '.cm-cite-said': { flex: '1', minWidth: '0' },
  '.cm-cite-kicker': { color: 'var(--text-3)', fontSize: '11px', letterSpacing: '0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-cite-title': {
    marginTop: '2px', color: 'var(--text-1)', fontSize: '13.5px', fontWeight: '650', lineHeight: '1.35', overflowWrap: 'anywhere',
    display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  '.cm-cite-thumb': { flex: 'none', width: '64px', height: '48px', objectFit: 'cover', borderRadius: '5px', border: '1px solid var(--border)', background: 'var(--bg-1)' },
  '.cm-cite-line': { margin: '0', padding: '0 14px 12px 54px', color: 'var(--text-2)' },
  '.cm-cite-rows': {
    display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', columnGap: '10px', rowGap: '5px', margin: '0', padding: '10px 14px 12px',
    borderTop: '1px solid var(--border)',
  },
  '.cm-cite-rows dt': { color: 'var(--text-3)' },
  '.cm-cite-rows dd': { display: 'flex', alignItems: 'center', gap: '5px', minWidth: '0', margin: '0', color: 'var(--text-1)' },
  '.cm-cite-rows dd > span, .cm-cite-rows dd > a': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-cite-rows a': { color: 'inherit', textDecoration: 'none' },
  '.cm-cite-rows a:hover': { textDecoration: 'underline' },
  '.cm-cite-muted': { color: 'var(--text-3) !important' },
  '.cm-cite-warn': { color: 'var(--warn) !important' },
  '.cm-cite-ok svg': { color: 'var(--ok)', flex: 'none' },
  '.cm-cite-mono': { fontFamily: 'var(--font-mono)', fontSize: '11.5px' },
  '.cm-cite-note': { color: 'var(--text-3)', flex: 'none' },
  '.cm-cite-actions': {
    display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-1)',
  },
  '.cm-cite-go, .cm-cite-own': { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  '.cm-cite-own': { marginLeft: 'auto' },
  '.cm-cite-action': {
    display: 'inline-flex', alignItems: 'center', gap: '5px', height: '26px', padding: '0 8px', borderRadius: '5px', whiteSpace: 'nowrap', boxSizing: 'border-box',
    border: '1px solid var(--border-strong)', background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer', font: 'inherit', fontSize: '12px',
    textDecoration: 'none',
  },
  '.cm-cite-action:hover': { borderColor: 'var(--accent)' },
  '.cm-cite-action:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-cite-action svg': { color: 'var(--text-2)', flex: 'none' },
  '.cm-cite-primary': { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-text)', fontWeight: '650' },
  '.cm-cite-primary svg': { color: 'var(--accent-text)' },
  '.cm-cite-primary:hover': { background: 'var(--accent-hover)' },
  '.cm-cite-done, .cm-cite-done svg': { color: 'var(--ok)' },
  '.cm-cite-status:empty': { display: 'none' },
  '.cm-cite-status': { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' },
});

/** The citation card, for the drawn page and the raw Markdown alike. */
export const citationCard = [cardState, watch, keys, look];
