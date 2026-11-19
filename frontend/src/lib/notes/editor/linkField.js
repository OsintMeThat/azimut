/**
 * The Link field of the selection bubble (Ctrl+K): an address pasted or typed is
 * looked up in the case first, nothing fetched. When the case holds the page (a
 * bookmark, a capture, a downloaded post), the field says so and offers to cite that
 * item as a chip in place of the words, or to keep a plain link. Words that are not
 * an address find the case's items by name, so a citation is made without knowing
 * how one is written.
 *
 * The case is asked through the editor's `lookup(url)` (`/sources/lookup`, read off
 * the address and the case alone); `lookupAddress` reads its answer, the fuller one
 * (`known`: who posted it, when, its archived copy, the day it was seen) when the
 * server gives it, the items filed for the address else, and the case's own records
 * when no server can be asked.
 */
import { foldText } from '../../textFold.js';
import { mentionMatches, pastedUrl } from '../syntax.js';
import { iconSvg } from './icon.js';
import { noteCase, noteHandlers } from './state.js';

/** How long typing rests before the case is asked. */
export const LOOKUP_REST_MS = 160;

/** What a kind of case item is called on the field's line. */
const NOUNS = { bookmark: 'Bookmark', capture: 'Capture', media: 'Media file', proof: 'Proof' };

/** The icon a case item is listed with. */
const TYPE_ICONS = {
  place: 'pin', media: 'image', bookmark: 'bookmark', capture: 'satellite', proof: 'proof', person: 'user', account: 'at',
  organization: 'building', note: 'note', claim: 'flag', event: 'calendar', vehicle: 'car', unit: 'shield',
};

/** An address typed or pasted, as one the case is asked about: `www.x.com/a` is read as https; null for words. */
export function linkAddress(text) {
  const value = String(text ?? '').trim();
  if (!value || /\s/.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return pastedUrl(value);
  if (/^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]\S*)?$/.test(value) && /\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(value)) return pastedUrl(`https://${value}`);
  return null;
}

/** An address as two of them are compared: no scheme, no `www.`, no fragment, no closing slash. */
function addressKey(url) {
  try {
    const parts = new URL(url);
    const path = parts.pathname.replace(/\/+$/, '');
    return `${parts.hostname.toLowerCase().replace(/^www\./, '')}${path}${parts.search}`;
  } catch {
    return '';
  }
}

/** The case's own record filed for `url`, read from the records the editor holds: the case's answer when no server is asked. */
function heldLocally(entities, url) {
  const key = addressKey(url);
  if (!key) return null;
  const order = ['media', 'bookmark', 'capture'];
  const found = (entities ?? [])
    .filter((entity) => order.includes(entity.type))
    .filter((entity) => addressKey(entity.attrs?.url || entity.attrs?.source_url || '') === key)
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return found[0] ? itemOf(found[0]) : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-17…` as the day it is: `17 Nov`, the year said when it is not this one. */
export function shortDay(value, now = new Date()) {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  const month = MONTHS[Number(day?.[2]) - 1];
  if (!day || !month || Number(day[3]) < 1 || Number(day[3]) > 31) return '';
  return `${Number(day[3])} ${month}${Number(day[1]) === now.getFullYear() ? '' : ` ${day[1]}`}`;
}

/** A record the lookup answered (`found`), as the field reads it. */
function itemOf(entity) {
  const attrs = entity.attrs ?? {};
  return {
    id: entity.id,
    type: entity.type,
    label: entity.label || '',
    noun: NOUNS[entity.type] ?? '',
    author: '',
    published: '',
    archive: attrs.archive_url || '',
    archivedAt: '',
    seen: attrs.fetched_at || '',
    full: false,
  };
}

/**
 * What the case holds at `url`, `{ url, title, item }`: `title` the name the address
 * gives the page (*Post by @desk on X*), `item` the case's record for it or null.
 * `lookup(url)` asks the server; without one, or when it fails, the editor's own
 * records answer.
 */
export async function lookupAddress(url, { lookup = null, entities = [] } = {}) {
  let answer = null;
  if (lookup) {
    try {
      answer = await lookup(url);
    } catch {
      answer = null;
    }
  }
  const local = heldLocally(entities, url);
  if (!answer) return { url, title: '', item: local };
  const known = answer.known;
  if (known?.id) {
    return {
      url,
      title: answer.title || '',
      item: {
        id: known.id, type: known.type || '', label: known.label || '', noun: known.noun || NOUNS[known.type] || '', author: known.author || '',
        published: known.published || '', archive: known.archive || '', archivedAt: known.archived_at || '', seen: known.seen || '', full: true,
      },
    };
  }
  const [found] = answer.found ?? [];
  return { url, title: answer.title || '', item: found?.id ? itemOf(found) : local };
}

/** How often `item` or `url` is cited in `text` already. */
export function citedTimes(text, item, url) {
  const body = String(text ?? '');
  let count = 0;
  if (item?.id) count += body.split(`[[entity:${item.id}|`).length - 1 + body.split(`[[media:${item.id}|`).length - 1;
  if (url) count += body.split(`](${url})`).length - 1;
  return count;
}

/** The line under "In the case": what it is, who posted it and when, when the case saw it, its copy, how often this note cites it. */
export function itemFacts(item, { cited = 0, now = new Date() } = {}) {
  const facts = [];
  if (item.noun) facts.push(item.noun);
  if (item.author) facts.push(`by ${item.author}`);
  if (item.published) facts.push(`posted ${shortDay(item.published, now)}`);
  if (item.seen) facts.push(`seen ${shortDay(item.seen, now)}`);
  if (item.archive) facts.push(item.archivedAt ? `archived ${shortDay(item.archivedAt, now)}` : 'archived');
  else if (item.full) facts.push('not archived');
  if (cited) facts.push(cited === 1 ? 'cited once in this note' : `cited ${cited} times in this note`);
  // a day the record holds in no form a day is read in says nothing
  return facts.filter((fact) => !fact.endsWith(' ')).join(' · ');
}

// -- the field ----------------------------------------------------------------------

function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

function button(className, text, { title = '', icon = '', primary = false } = {}) {
  const node = el('button', `cm-link-button${primary ? ' cm-link-primary' : ''}${className ? ` ${className}` : ''}`);
  node.type = 'button';
  if (icon) node.append(iconSvg(icon, 13));
  if (text) node.append(text);
  if (title) node.title = title;
  return node;
}

/**
 * The field, for the words `target` names (`linkTarget` in `editor/marks.js`), in
 * `view`. `act` carries out what is picked: `{ link: url, title }`, `{ cite: entity }`,
 * `{ bookmark: url, title }`, `{ remove: true }` or `{ close: true }`. Answers
 * `{ dom, focus(), destroy() }`.
 */
export function linkField(view, target, act) {
  const handlers = view.state.facet(noteHandlers);
  const input = el('input', 'cm-link-input');
  input.type = 'text';
  input.placeholder = 'Paste a link, or find a case item by name';
  input.setAttribute('aria-label', 'Link address, or a case item to cite');
  input.spellcheck = false;
  input.value = target.url || '';
  const answer = el('div', 'cm-link-answer');
  answer.setAttribute('aria-live', 'polite');
  const row = el('div', 'cm-link-row', el('span', 'cm-link-icon', iconSvg('link', 14)), input);
  if (target.existing) {
    const remove = button('cm-link-remove', 'Remove', { title: 'Take the link off, keep the words', icon: 'unlink' });
    remove.addEventListener('click', () => act({ remove: true }));
    row.append(remove);
  }
  const dom = el('div', 'cm-link-field', row, answer, el('div', 'cm-link-foot', 'Looked up in the case as you type. Nothing is fetched.'));
  let asked = 0;
  let timer = null;
  /** What Enter does now. */
  let primary = null;
  let rows = [];
  let lit = 0;

  const light = (index) => {
    lit = Math.max(0, Math.min(rows.length - 1, index));
    rows.forEach((node, at) => node.setAttribute('aria-selected', String(at === lit)));
    rows[lit]?.scrollIntoView?.({ block: 'nearest' });
  };

  const show = (...nodes) => {
    answer.replaceChildren(...nodes);
    rows = [...answer.querySelectorAll('.cm-link-item')];
    if (rows.length) light(0);
  };

  const foundCard = ({ url, title, item }) => {
    const cited = citedTimes(view.state.doc.toString(), item, url);
    const cite = button('', 'Cite it', { title: 'The case item in place of these words, as a chip', primary: true });
    cite.addEventListener('click', () => act({ cite: { id: item.id, label: item.label, type: item.type } }));
    const keep = button('', 'Keep the link', { title: 'A plain link to the address' });
    keep.addEventListener('click', () => act({ link: url, title }));
    primary = () => cite.click();
    return el('div', 'cm-link-card cm-link-found',
      el('span', 'cm-link-mark', iconSvg('check', 14)),
      el('div', 'cm-link-said', el('div', 'cm-link-head', 'In the case: ', el('strong', '', item.label || title || url)),
        el('div', 'cm-link-facts', itemFacts(item, { cited }))),
      el('div', 'cm-link-actions', cite, keep));
  };

  const newCard = ({ url, title }) => {
    const link = button('', 'Link', { title: 'A plain link to the address', primary: true });
    link.addEventListener('click', () => act({ link: url, title }));
    primary = () => link.click();
    const actions = el('div', 'cm-link-actions', link);
    if (handlers.bookmark) {
      const keep = button('', 'Bookmark it', { title: 'File it as a bookmark of the case, then cite it' });
      keep.addEventListener('click', () => act({ bookmark: url, title }));
      actions.append(keep);
    }
    return el('div', 'cm-link-card cm-link-new',
      el('span', 'cm-link-mark cm-link-none', iconSvg('link', 14)),
      el('div', 'cm-link-said', el('div', 'cm-link-head', 'Not in the case yet'), el('div', 'cm-link-facts', title || url)),
      actions);
  };

  const itemsList = (query) => {
    const info = view.state.field(noteCase, false);
    const found = mentionMatches(info?.entities ?? [], query, 6);
    if (!found.length) {
      primary = null;
      return [el('div', 'cm-link-empty', 'No case item by that name. Paste an address to link it.')];
    }
    const list = el('div', 'cm-link-items');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Case items');
    for (const entity of found) {
      const item = el('button', 'cm-link-item', el('span', 'cm-link-item-icon', iconSvg(TYPE_ICONS[entity.type] ?? 'tag', 13)),
        el('span', 'cm-link-item-name', entity.label), el('span', 'cm-link-item-kind', [entity.type, entity.attrs?.folder].filter(Boolean).join(' · ')));
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.title = 'Cite it in place of these words, as a chip';
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', () => act({ cite: entity }));
      list.append(item);
    }
    primary = () => rows[lit]?.click();
    return [el('div', 'cm-link-caption', 'Cite a case item'), list];
  };

  const read = async () => {
    const text = input.value.trim();
    const ask = ++asked;
    primary = null;
    if (!text) {
      show();
      return;
    }
    const url = linkAddress(text);
    if (!url) {
      show(...itemsList(foldText(text)));
      return;
    }
    const said = await lookupAddress(url, { lookup: handlers.lookup, entities: view.state.field(noteCase, false)?.entities ?? [] });
    if (ask !== asked) return;
    show(said.item ? foundCard(said) : newCard(said));
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    // a pasted address is looked up at once, typing when it rests
    timer = setTimeout(read, linkAddress(input.value) && input.value.length > 12 ? 0 : LOOKUP_REST_MS);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      act({ close: true });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(timer);
      if (primary) primary();
      else if (linkAddress(input.value)) act({ link: linkAddress(input.value), title: '' });
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length) {
      event.preventDefault();
      light(lit + (event.key === 'ArrowDown' ? 1 : -1));
    }
  });
  if (input.value) void read();

  return {
    dom,
    /** Settles any lookup still waiting, for tests. */
    settle: () => {
      clearTimeout(timer);
      return read();
    },
    focus: () => {
      input.focus();
      input.select();
    },
    destroy: () => {
      clearTimeout(timer);
      asked += 1;
    },
  };
}
