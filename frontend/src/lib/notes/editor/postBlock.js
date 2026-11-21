/**
 * A post from X or Bluesky in the note: a `::: post` block (`editor/postText.js`), drawn
 * as every document draws it (`engine/notes_posts.py`), from what the case keeps
 * (`POST /social-posts/describe`, nothing fetched): who posted it, the words with the
 * passage that matters highlighted, the analyst's translation, the pictures, the day,
 * "Geolocated · Proof N" when a proof of the case comes from it, and its links. Never
 * X's or Bluesky's widget: nothing of theirs runs in the page.
 *
 * Its bar opens its settings (`editor/postCard.js`): the form, the highlights, the
 * translation, the profile picture and the QR code of the PDF, each written into its own
 * line as one Undo step. Words selected in the drawn post offer *Highlight*, which keeps
 * them as the exact passage.
 *
 * A block still holding an address (`link:`) draws how its read goes: reading, failed
 * with why and *Try again*, X's wall with the browser whose session it may use, or not
 * read yet with *Read the post*. A read happens on one of those presses or on `/post`'s,
 * never because the note opened.
 */
import { isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';

import { fileUrl } from '../../fileUrl.js';
import { thisBrowser } from '../../thisBrowser.js';
import { describePost, onPostReading, postReading, readPosts, readSignedIn } from '../postCards.js';
import { rovingToolbar } from '../pictureSize.js';
import { registerBlock } from './blocks.js';
import { button, icon } from './gridMenu.js';
import { heldHeight, holdHeight, moveHeight, releaseHeight } from './heights.js';
import { POST_CARD_THEME, postSettings } from './postCard.js';
import { POST_BLOCK, postParagraphs, quotedWords, readPost, withHighlight, withKept } from './postText.js';
import { blocksIn, openSource } from './ranges.js';
import { noteHandlers, resolve } from './state.js';
import { lineChanges } from './tableText.js';
import { BlockWidget, markPicked, pickBlock } from './widgets.js';

/** A post's height before it is drawn, in pixels. */
const POST_HEIGHT = 300;
/** The browsers whose session a wall on X may use, as Media's downloads offer them. */
export const SESSION_BROWSERS = [
  ['firefox', 'Firefox'], ['chrome', 'Chrome'], ['edge', 'Edge'], ['brave', 'Brave'], ['chromium', 'Chromium'],
  ['opera', 'Opera'], ['safari', 'Safari'], ['vivaldi', 'Vivaldi'],
];
const GLYPH = {
  x: 'M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z',
  bluesky: 'M6.3 4.3C8.6 6 11 9.5 12 11.4c1-1.9 3.4-5.4 5.7-7.1 1.7-1.2 4.3-2.2 4.3.8 0 .6-.3 5-.5 5.7-.7 2.5-3.2 3.1-5.5 2.7 4 .7 5 2.9 2.8 5.2-4.2 4.3-6-1.1-6.5-2.5l-.3-.8-.3.8c-.5 1.4-2.3 6.8-6.5 2.5-2.2-2.3-1.2-4.5 2.8-5.2-2.3.4-4.8-.2-5.5-2.7C2.3 10.1 2 5.7 2 5.1c0-3 2.6-2 4.3-.8z',
};
const PIN = 'M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function glyph(path, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('class', className);
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

function outward(href, text, className = '') {
  const link = element('a', className, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

/** What a site is called, for a link not read yet. */
function siteOf(link) {
  return /bsky\.app/i.test(link) ? 'Bluesky' : 'X';
}

/** Every post block's addresses, each kept post named by its post from now on: `results` from a read. One change, its own Undo step. */
export function keepRead(view, results) {
  const kept = (results ?? []).filter((one) => one?.id);
  if (!view || view.state.readOnly || !kept.length) return false;
  const text = view.state.doc.toString();
  const changes = [];
  const fence = /^:::[ \t]*post[ \t]*\n([\s\S]*?)^:::[ \t]*$/gm;
  for (const match of text.matchAll(fence)) {
    const before = match[0];
    const after = withKept(before, kept);
    if (after === before) continue;
    for (const piece of lineChanges(before, after)) {
      changes.push({ from: match.index + piece.from, to: match.index + piece.to, insert: piece.insert });
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.post')] });
  return true;
}

/**
 * A post block worked on: drawn from the server's reading, each choice written into its
 * lines as one Undo step, a read started on its own presses.
 */
export class PostBox {
  constructor(box, widget, view) {
    this.box = box;
    this.view = view;
    this.widget = widget;
    this.answer = null;
    this.asked = 0;
    this.settings = null;
    this.gone = false;
    box.post = this;
    this.build();
    this.stopListening = onPostReading(() => this.drawReading());
    this.describe();
  }

  get info() { return this.widget.info; }
  get handlers() { return this.view.state.facet(noteHandlers); }
  get writable() { return this.widget.writable && !this.view.state.readOnly; }
  get caseId() { return this.info.caseId ?? ''; }
  get source() { return this.widget.source; }
  get block() { return readPost(this.source); }

  range() {
    let from;
    try {
      from = this.view.posAtDOM(this.box);
    } catch {
      return null;
    }
    return blocksIn(this.view.state, from).find((block) => block.from === from && block.kind === 'post') ?? null;
  }

  /** Change the block's lines with `change(source)`, as one step Undo takes back. */
  edit(change) {
    if (!this.writable) return false;
    const range = this.range();
    if (!range) return false;
    const source = this.view.state.sliceDoc(range.from, range.to);
    const next = change(source);
    if (next === source) return false;
    pickBlock(this.view, this.box);
    this.view.dispatch({
      changes: lineChanges(source, next).map((piece) => ({ from: range.from + piece.from, to: range.from + piece.to, insert: piece.insert })),
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.post')],
    });
    return true;
  }

  build() {
    const { box } = this;
    box.className = 'cm-block cm-block-post cm-post-block';
    box.dataset.block = 'post';
    const card = element('div', 'cm-post-frame');
    if (this.writable) card.append(this.makeBar());
    this.settingsPanel = element('div', 'cm-post-settings cm-post-ui');
    this.settingsPanel.hidden = true;
    this.settingsPanel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleSettings(false);
      this.settingsButton?.focus({ preventScroll: true });
    });
    this.stage = element('div', 'cm-post-stage');
    this.reading = element('div', 'cm-post-reading cm-post-ui');
    this.marker = button('cm-post-mark cm-post-ui', { label: 'Highlight', iconName: 'edit', title: 'Keep these words as the passage that matters' });
    this.marker.hidden = true;
    this.marker.addEventListener('mousedown', (event) => event.preventDefault());
    this.marker.addEventListener('click', () => this.highlight());
    card.append(this.settingsPanel, this.stage, this.reading, this.marker);
    box.append(card);
    box.addEventListener('mouseup', () => setTimeout(() => this.offerHighlight(), 0));
    box.addEventListener('keyup', () => this.offerHighlight());
  }

  makeBar() {
    const bar = element('div', 'cm-post-bar cm-post-ui');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Post');
    bar.append(element('span', 'cm-post-bar-name', 'Post'), element('span', 'cm-post-bar-said', 'drawn by Azimut, kept in the case'));
    bar.append(element('span', 'cm-chart-spring'));
    this.settingsButton = button('cm-chart-tool cm-post-settings-btn', { label: 'Settings', iconName: 'sliders', title: 'Form, highlight, translation and profile picture' });
    this.settingsButton.setAttribute('aria-pressed', 'false');
    this.settingsButton.addEventListener('mousedown', (event) => event.preventDefault());
    this.settingsButton.addEventListener('click', () => this.toggleSettings());
    const source = button('cm-chart-tool cm-chart-source', { label: 'Edit the source', alone: true, title: 'Edit the source' });
    source.dataset.editSource = 'true';
    source.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const range = this.range();
      if (range) openSource(this.view, range);
    });
    bar.append(this.settingsButton, source);
    rovingToolbar(bar);
    return bar;
  }

  toggleSettings(open = this.settingsPanel.hidden) {
    if (!this.writable) return;
    if (open && !this.settings) {
      this.settings = postSettings(this);
      this.settingsPanel.append(this.settings.element);
    }
    this.settingsPanel.hidden = !open;
    this.settingsButton?.setAttribute('aria-pressed', String(open));
    this.box.classList.toggle('cm-post-open', open);
    if (open) this.settings?.refresh();
    this.view.requestMeasure();
  }

  update(widget) {
    const before = this.widget;
    this.widget = widget;
    if (widget.source !== before.source || widget.info.caseId !== before.info.caseId || widget.postsKey() !== before.postsKey()) this.describe();
    else this.settings?.refresh();
  }

  /** Ask what the block draws, and draw it; the drawing it had stays until then. */
  async describe() {
    const asked = ++this.asked;
    if (!this.caseId) {
      this.answer = { posts: [], missing: this.block.entries.map((entry) => entry.value), form: 'card', avatar: true, qr: false };
      this.draw();
      return;
    }
    this.box.classList.add('cm-post-waiting');
    try {
      const answer = await describePost({ caseId: this.caseId, text: this.source, key: this.widget.postsKey() });
      if (asked !== this.asked || this.gone) return;
      this.answer = answer;
    } catch (error) {
      if (asked !== this.asked || this.gone) return;
      this.answer = { posts: [], missing: [], failed: error?.message || 'The post could not be drawn' };
    }
    this.box.classList.remove('cm-post-waiting');
    this.draw();
  }

  draw() {
    const answer = this.answer;
    if (!answer) return;
    this.stage.replaceChildren(drawPosts(answer, { caseId: this.caseId, onproof: (id) => this.openProof(id) }));
    if (answer.failed) this.stage.append(element('p', 'cm-post-said', answer.failed));
    this.drawReading();
    this.settings?.refresh();
    this.view.requestMeasure();
  }

  /** What each address the block holds says: reading, failed and why, or not read yet. */
  drawReading() {
    if (!this.answer || this.gone) return;
    const block = this.block;
    const shown = new Set((this.answer.posts ?? []).map((post) => post.at));
    const rows = [];
    for (const [at, entry] of block.entries.entries()) {
      if (shown.has(at)) continue;
      rows.push(entry.kind === 'link' ? this.linkRow(entry.value) : this.goneRow());
    }
    this.reading.replaceChildren(...rows);
    this.reading.hidden = !rows.length;
    if (!block.entries.length) {
      this.reading.hidden = false;
      this.reading.append(element('p', 'cm-post-said', 'No post yet: paste an X or Bluesky link in the source, or use / › Post.'));
    }
    this.view.requestMeasure();
  }

  goneRow() {
    const row = element('div', 'cm-post-row cm-post-gone');
    row.append(icon('alert', 14), element('span', '', 'This post is no longer in the case.'));
    return row;
  }

  linkRow(link) {
    const state = postReading(link);
    const row = element('div', `cm-post-row${state?.state === 'failed' ? ' cm-post-failed' : ''}`);
    row.dataset.link = link;
    const words = element('div', 'cm-post-row-words');
    const address = outward(link, link, 'cm-post-address');
    if (state?.state === 'busy') {
      row.classList.add('cm-post-busy');
      words.append(element('span', 'cm-post-row-said', `Reading the post from ${siteOf(link)}…`), address);
      row.append(element('span', 'cm-post-spin'), words);
      return row;
    }
    if (state?.state === 'failed' && state.needsAuth) {
      words.append(element('span', 'cm-post-row-said', state.refused
        ? 'X still refused with the session it was given. Sign in again in that browser, then try again.'
        : 'X wants a signed-in session to show this post. Azimut borrows the session of a browser you are signed in to, never a password.'), address);
      row.append(icon('lock', 14), words);
      if (this.writable) row.append(this.sessionPicker(link));
      return row;
    }
    if (state?.state === 'failed') {
      words.append(element('span', 'cm-post-row-said', `Not read: ${state.error}`), address);
      row.append(icon('alert', 14), words);
      if (this.writable) row.append(this.readButton(link, 'Try again'));
      return row;
    }
    words.append(element('span', 'cm-post-row-said', 'Not read yet. Reading it keeps its words and pictures in the case.'), address);
    row.append(icon('link', 14), words);
    if (this.writable) row.append(this.readButton(link, 'Read the post'));
    return row;
  }

  readButton(link, label) {
    const press = button('cm-post-act cm-post-read', { label, iconName: 'download', title: 'Read it from the site now and keep it in the case' });
    press.addEventListener('mousedown', (event) => event.preventDefault());
    press.addEventListener('click', () => this.read([link]));
    return press;
  }

  sessionPicker(link) {
    const holder = element('div', 'cm-post-session');
    const select = element('select', 'cm-post-select');
    select.title = 'The browser you are signed in to X in';
    for (const [id, label] of SESSION_BROWSERS) {
      const option = element('option', '', label);
      option.value = id;
      select.append(option);
    }
    select.value = thisBrowser();
    const press = button('cm-post-act', { label: 'Read signed in', iconName: 'download', title: 'Use that browser’s session for downloads, then read again' });
    press.addEventListener('click', async () => {
      press.disabled = true;
      try {
        const results = await readSignedIn({ caseId: this.caseId, links: [link], browser: select.value });
        keepRead(this.view, results);
      } catch (error) {
        this.handlers.tableToast?.(`Not read: ${error.message}`, [], 'danger');
      } finally {
        press.disabled = false;
      }
    });
    holder.append(select, press);
    return holder;
  }

  async read(links) {
    const results = await readPosts({ caseId: this.caseId, links });
    if (!keepRead(this.view, results)) this.describe();
  }

  openProof(id) {
    const entity = resolve(this.info, id);
    if (entity) this.handlers.open?.(entity);
  }

  // -- highlight --

  /** The words selected in one post's text, `{ at, words, node }`, or null. */
  selected() {
    const selection = this.box.ownerDocument.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.parentElement?.closest?.('.cm-post-text');
    const end = range.endContainer.parentElement?.closest?.('.cm-post-text');
    if (!start || start !== end || !this.box.contains(start)) return null;
    const words = selection.toString().replace(/\s+/g, ' ').trim();
    const post = (this.answer?.posts ?? []).find((one) => String(one.at) === start.dataset.at);
    if (!words || !post || !post.text.replace(/\s+/g, ' ').includes(words)) return null;
    return { at: post.at, words: exactPassage(post.text, words), range };
  }

  offerHighlight() {
    if (!this.writable || this.gone) return;
    const found = this.selected();
    if (!found) {
      this.marker.hidden = true;
      return;
    }
    const frame = this.box.getBoundingClientRect();
    const rect = found.range.getBoundingClientRect();
    this.marker.style.left = `${Math.max(8, rect.left - frame.left + rect.width / 2 - 50)}px`;
    this.marker.style.top = `${rect.bottom - frame.top + 6}px`;
    this.marker.hidden = false;
  }

  highlight() {
    const found = this.selected();
    this.marker.hidden = true;
    if (!found) return;
    this.box.ownerDocument.getSelection?.()?.removeAllRanges();
    this.edit((source) => withHighlight(source, found.at, found.words));
  }

  destroy() {
    this.gone = true;
    this.stopListening?.();
  }
}

/** The passage as the post writes it, its own spaces and line breaks, for words selected across a break. */
export function exactPassage(text, words) {
  const wanted = String(words).replace(/\s+/g, ' ').trim();
  if (text.includes(wanted)) return wanted;
  const pattern = wanted.split(' ').map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const found = new RegExp(pattern).exec(text);
  return found ? found[0] : wanted;
}

// -- the drawing -------------------------------------------------------------------------

function avatarOf(post, shown, caseId, small = false) {
  const round = element('span', `cm-post-avatar${small ? ' cm-post-avatar-small' : ''}`);
  if (shown && post.avatar) {
    const picture = element('img');
    picture.src = fileUrl(caseId, post.avatar);
    picture.alt = '';
    round.append(picture);
    return round;
  }
  round.classList.add('cm-post-initials');
  round.textContent = post.initials;
  round.style.setProperty('--cm-post-a', post.tint?.[0] ?? '#3c5a6e');
  round.style.setProperty('--cm-post-b', post.tint?.[1] ?? '#20323e');
  round.setAttribute('aria-hidden', 'true');
  return round;
}

function textOf(post) {
  const words = element('div', 'cm-post-text');
  words.dir = post.rtl ? 'rtl' : 'auto';
  if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(post.lang ?? '')) words.lang = post.lang;
  words.dataset.at = String(post.at);
  for (const paragraph of postParagraphs(post.text, post.highlights)) {
    const said = element('p', 'cm-post-para');
    said.dir = paragraph.rtl ? 'rtl' : 'ltr';
    for (const part of paragraph.stretches) said.append(part.lit ? element('mark', '', part.text) : document.createTextNode(part.text));
    words.append(said);
  }
  return words;
}

function translationOf(post) {
  if (!post.translation?.trim()) return null;
  const said = element('p', 'cm-post-translation');
  said.dir = 'auto';
  said.append(element('small', '', 'Translation'), document.createTextNode(post.translation.trim()));
  return said;
}

function mediaOf(post, caseId) {
  const shown = (post.pictures ?? []).slice(0, 4);
  if (!shown.length) return null;
  const grid = element('div', 'cm-post-media');
  grid.dataset.count = String(shown.length);
  for (const one of shown) {
    const shot = outward(post.url, '', `cm-post-shot${one.path ? '' : ' cm-post-blank'}`);
    if (shown.length === 1) shot.dataset.alone = 'true';
    if (one.path) {
      const picture = element('img');
      picture.src = fileUrl(caseId, one.path);
      picture.alt = one.alt || `${one.kind === 'video' ? 'Video' : 'Picture'} posted by @${post.handle}`;
      shot.append(picture);
    } else shot.setAttribute('aria-label', one.alt || 'Video');
    if (one.kind === 'video') {
      shot.append(element('span', 'cm-post-play'));
      if (one.duration) shot.append(element('span', 'cm-post-dur', one.duration));
    }
    grid.append(shot);
  }
  return grid;
}

function proofOf(post, onproof) {
  if (!post.proof) return null;
  const badge = element('button', 'cm-post-proof cm-post-ui');
  badge.type = 'button';
  badge.title = `Open ${post.proof.label}, the proof that geolocates this post`;
  badge.append(glyph(PIN, 'cm-post-pin'), document.createTextNode(post.proof.badge ?? `Geolocated · ${post.proof.label}`));
  badge.addEventListener('mousedown', (event) => event.preventDefault());
  badge.addEventListener('click', () => onproof?.(post.proof.id));
  return badge;
}

function footOf(answer, onproof) {
  const [first] = answer.posts;
  const foot = element('div', 'cm-post-foot');
  const when = answer.posts.length > 1 ? answer.span : first.when;
  const said = [when, first.captured ? `captured on ${first.captured}` : ''].filter(Boolean).join(' · ');
  if (said) foot.append(element('span', 'cm-post-when', said));
  const seen = new Set();
  for (const post of answer.posts) {
    if (post.proof && !seen.has(post.proof.id)) {
      seen.add(post.proof.id);
      foot.append(proofOf(post, onproof));
    }
  }
  const links = element('span', 'cm-post-links');
  links.append(outward(first.url, `View on ${first.site_label} ↗`));
  if (/^https?:\/\//.test(first.archive ?? '')) links.append(outward(first.archive, 'Archived copy ↗'));
  foot.append(links);
  return foot;
}

/** A block's posts drawn as its form draws them, the HTML page's parts with the editor's look. */
export function drawPosts(answer, { caseId = '', onproof = null } = {}) {
  const holder = element('div', `cm-post-card-holder cm-post-form-${answer.form ?? 'card'}`);
  const posts = answer.posts ?? [];
  if (!posts.length) return holder;
  if (answer.form === 'quote') {
    const [first] = posts;
    const quote = element('blockquote', 'cm-post-quote');
    for (const post of posts) {
      const said = quotedWords(post.text, post.highlights);
      if (!said) continue;
      const words = element('p', 'cm-post-quote-words', `“${said}”`);
      words.dir = post.rtl ? 'rtl' : 'auto';
      quote.append(words);
      const translation = translationOf(post);
      if (translation) quote.append(translation);
    }
    const by = element('div', 'cm-post-by');
    const day = (first.when ?? '').split(' · ')[0];
    const words = element('span');
    words.append(element('b', '', first.name || first.handle), document.createTextNode(` on ${first.site_label}${day ? ` · ${day}` : ''} · `),
      outward(first.url, 'view ↗'));
    by.append(avatarOf(first, answer.avatar, caseId, true), words);
    const proof = proofOf(first, onproof);
    if (proof) by.append(proof);
    quote.append(by);
    holder.append(quote);
    return holder;
  }
  if (answer.form === 'compact') {
    for (const post of posts) {
      const line = element('div', 'cm-post-line');
      const words = element('div', 'cm-post-line-words');
      const who = element('div', 'cm-post-line-who');
      const day = (post.when ?? '').split(' · ')[0];
      who.append(element('b', '', post.name || post.handle), document.createTextNode(` · ${post.site_label}${day ? ` · ${day}` : ''}`));
      const text = outward(post.url, (post.translation || post.text).replace(/\s+/g, ' ').trim(), 'cm-post-line-text');
      text.dir = 'auto';
      words.append(who, text);
      line.append(avatarOf(post, answer.avatar, caseId, true), words);
      const first = (post.pictures ?? []).find((one) => one.path);
      if (first) {
        const thumb = element('img', 'cm-post-thumb');
        thumb.src = fileUrl(caseId, first.path);
        thumb.alt = '';
        line.append(thumb);
      }
      holder.append(line);
    }
    return holder;
  }
  const card = element('div', `cm-post-card${posts.length > 1 ? ' cm-post-thread' : ''}`);
  for (const [index, post] of posts.entries()) {
    const item = element('article', 'cm-post-item');
    const head = element('div', 'cm-post-head');
    const who = element('span', 'cm-post-who');
    who.append(element('b', '', post.name || post.handle));
    if (post.handle) who.append(element('span', 'cm-post-handle', `@${post.handle}`));
    head.append(avatarOf(post, answer.avatar, caseId), who);
    if (posts.length > 1) head.append(element('span', 'cm-post-num', `${index + 1}/${posts.length}`));
    else {
      const site = element('span', 'cm-post-site');
      if (GLYPH[post.site]) site.append(glyph(GLYPH[post.site], 'cm-post-glyph'));
      site.append(document.createTextNode(post.site_label));
      head.append(site);
    }
    item.append(head);
    if (post.text?.trim()) item.append(textOf(post));
    const translation = translationOf(post);
    if (translation) item.append(translation);
    const media = mediaOf(post, caseId);
    if (media) item.append(media);
    if (index === posts.length - 1) item.append(footOf(answer, onproof));
    card.append(item);
  }
  holder.append(card);
  return holder;
}

/** What a post block is drawn again for besides its words: the posts and proofs the case keeps. */
function postsKey(info) {
  return JSON.stringify((info.entities ?? [])
    .filter((entity) => entity.type === 'social-post' || entity.type === 'proof')
    .map((entity) => [entity.id, entity.label, entity.attrs?.archive_url ?? '', entity.attrs?.posted_url ?? '', entity.attrs?.posted?.length ?? 0]));
}

/** A post drawn in place: drawn again in place, its box, its bar and its open settings kept, when its lines change. */
export class PostWidget extends BlockWidget {
  constructor(spec) {
    super('post', spec.source, spec.info, spec.writable, '', spec.pinned, spec.picked);
  }

  postsKey() {
    this.keyed ??= postsKey(this.info);
    return this.keyed;
  }

  same(other) {
    return other instanceof PostWidget && other.source === this.source && other.writable === this.writable
      && other.info.caseId === this.info.caseId && other.postsKey() === this.postsKey();
  }

  toDOM(view) {
    const box = document.createElement('div');
    // eslint-disable-next-line no-new
    new PostBox(box, this, view);
    markPicked(box, this.picked);
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('.cm-post-ui, .cm-post-text, a, select, button')) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(box) } });
      view.focus();
    });
    box.addEventListener('dblclick', (event) => {
      if (event.target.closest('.cm-post-ui, .cm-post-text, a')) return;
      event.preventDefault();
      if (box.post.writable) box.post.toggleSettings(true);
      else openSource(view, box.post.range());
    });
    holdHeight(box, this);
    return box;
  }

  updateDOM(dom, _view, previous) {
    if (!dom.post || !(previous instanceof PostWidget) || previous.writable !== this.writable) return false;
    dom.post.update(this);
    markPicked(dom, this.picked);
    moveHeight(dom, this);
    return true;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown' || Boolean(event.target?.closest?.('.cm-post-ui, .cm-post-text, select'));
  }

  destroy(dom) {
    releaseHeight(dom);
    dom.post?.destroy();
  }

  get estimatedHeight() {
    return heldHeight(this) ?? POST_HEIGHT;
  }
}

/** Enter on a picked post, or a double press: its settings; a locked note opens the source. */
function openPost(view, block) {
  const box = [...view.contentDOM.querySelectorAll('.cm-post-block')].find((node) => {
    try {
      return view.posAtDOM(node) === block.from;
    } catch {
      return false;
    }
  });
  if (!box?.post || !box.post.writable) return openSource(view, block);
  box.post.toggleSettings(true);
  return true;
}

const THEME = {
  '.cm-post-block': { padding: '6px var(--note-gutter, 32px)' },
  '.cm-post-frame': { position: 'relative', maxWidth: '600px' },
  '.cm-post-waiting .cm-post-stage': { opacity: '.6' },
  '.cm-post-bar': {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '0 0 6px', fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--text-3)',
  },
  '.cm-post-bar-name': { flex: 'none', fontWeight: '650', color: 'var(--text-2)' },
  '.cm-post-bar-said': { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-post-bar .cm-chart-tool': { flex: 'none' },
  '.cm-post-settings': {
    margin: '0 0 10px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-2)',
    fontFamily: 'var(--font-sans)', fontSize: '12.5px', color: 'var(--text-1)',
  },
  '.cm-post-settings[hidden], .cm-post-reading[hidden], .cm-post-mark[hidden]': { display: 'none' },
  // the card, as the page draws it (reader.post.css), in the editor's colours
  '.cm-post-card': {
    border: '1px solid var(--border-strong)', borderRadius: '14px', background: 'var(--bg-1)', overflow: 'hidden',
    fontFamily: 'var(--font-sans)', color: 'var(--text-1)', lineHeight: '1.5',
  },
  '.cm-post-item': { position: 'relative', padding: '14px 16px 10px' },
  '.cm-post-thread .cm-post-item + .cm-post-item': { borderTop: '1px dashed var(--border-strong)' },
  '.cm-post-thread .cm-post-item > :not(.cm-post-head, .cm-post-foot)': { marginLeft: '50px' },
  '.cm-post-thread .cm-post-item:not(:last-child)::after': {
    content: '""', position: 'absolute', left: '35px', top: '58px', bottom: '-14px', width: '2px', background: 'var(--border-strong)',
  },
  '.cm-post-head': { display: 'flex', alignItems: 'center', gap: '10px', minWidth: '0' },
  '.cm-post-avatar': {
    flex: 'none', width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', display: 'grid', placeItems: 'center',
    background: 'linear-gradient(135deg, var(--cm-post-a, #3c5a6e), var(--cm-post-b, #20323e))', color: '#fff',
    font: '600 14px/1 var(--font-sans)', letterSpacing: '0.02em',
  },
  '.cm-post-avatar img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  '.cm-post-avatar-small': { width: '24px', height: '24px', fontSize: '10px' },
  '.cm-post-who': { display: 'flex', flexDirection: 'column', minWidth: '0', lineHeight: '1.25' },
  '.cm-post-who b': { fontWeight: '650', fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-post-handle': { color: 'var(--text-3)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-post-site, .cm-post-num': {
    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-3)', fontSize: '12px', fontVariantNumeric: 'tabular-nums',
  },
  '.cm-post-glyph': { width: '15px', height: '15px' },
  '.cm-post-text': { margin: '11px 0 0', fontSize: '16.5px', lineHeight: '1.55', overflowWrap: 'anywhere', cursor: 'text', userSelect: 'text' },
  '.cm-post-para': { margin: '0', whiteSpace: 'pre-line', textAlign: 'start' },
  '.cm-post-para + .cm-post-para': { marginTop: '0.6em' },
  '.cm-post-para[dir="rtl"]': { fontSize: '1.2em', lineHeight: '1.65' },
  '.cm-post-text mark, .cm-post-quote mark': {
    background: 'var(--accent-soft)', color: 'inherit', padding: '0 2px', borderRadius: '2px',
    textDecoration: 'underline 2px var(--accent)', textUnderlineOffset: '4px', textDecorationSkipInk: 'none', boxDecorationBreak: 'clone',
  },
  '.cm-post-translation': {
    margin: '9px 0 0', padding: '2px 0 2px 12px', borderLeft: '3px solid var(--accent)', color: 'var(--text-2)', fontSize: '14.5px', whiteSpace: 'pre-line',
  },
  '.cm-post-translation small': {
    display: 'block', font: '650 10.5px/1.6 var(--font-sans)', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-3)',
  },
  '.cm-post-media': { display: 'grid', gap: '4px', marginTop: '11px', borderRadius: '12px', overflow: 'hidden' },
  '.cm-post-media:not([data-count="1"])': { gridTemplateColumns: '1fr 1fr' },
  '.cm-post-shot': { position: 'relative', display: 'block', aspectRatio: '4 / 3', background: 'var(--bg-3)', overflow: 'hidden' },
  '.cm-post-shot[data-alone]': { aspectRatio: 'auto', maxHeight: '420px' },
  '.cm-post-shot img': { display: 'block', width: '100%', height: '100%', objectFit: 'cover' },
  '.cm-post-shot[data-alone] img': { height: 'auto', maxHeight: '420px' },
  '.cm-post-blank': { background: '#2a2c30', minHeight: '160px' },
  '.cm-post-play': { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' },
  '.cm-post-play::before': { content: '""', width: '52px', height: '52px', borderRadius: '50%', background: 'rgba(0, 0, 0, .55)' },
  '.cm-post-play::after': {
    content: '""', position: 'absolute', left: '50%', top: '50%', margin: '-10px 0 0 -5px',
    borderLeft: '16px solid #fff', borderTop: '10px solid transparent', borderBottom: '10px solid transparent',
  },
  '.cm-post-dur': { position: 'absolute', left: '8px', bottom: '8px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(0, 0, 0, .6)', color: '#fff', fontSize: '12px' },
  '.cm-post-foot': {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', marginTop: '11px', paddingTop: '9px',
    borderTop: '1px solid var(--border)', fontSize: '12.5px', color: 'var(--text-3)',
  },
  '.cm-post-links': { marginLeft: 'auto', display: 'inline-flex', gap: '12px' },
  '.cm-post-links a, .cm-post-by a': { color: 'var(--accent)', textDecoration: 'none' },
  '.cm-post-links a:hover, .cm-post-by a:hover': { textDecoration: 'underline' },
  '.cm-post-proof': {
    display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '1px 9px 1px 7px', border: 'none', borderRadius: '999px',
    background: 'var(--accent-soft)', color: 'var(--accent)', font: '650 12.5px/1.5 var(--font-sans)', cursor: 'pointer',
  },
  '.cm-post-proof:hover': { filter: 'brightness(1.08)' },
  '.cm-post-pin': { width: '12px', height: '12px' },
  // the quote: the words alone, large, the name under them
  '.cm-post-quote': { margin: '4px 0', padding: '4px 0 4px 20px', borderLeft: '3px solid var(--accent)' },
  '.cm-post-quote-words': { margin: '0 0 8px', fontFamily: 'var(--font-serif, Georgia, serif)', fontStyle: 'italic', fontSize: '23px', lineHeight: '1.4' },
  '.cm-post-quote-words[dir="rtl"]': { fontStyle: 'normal', textAlign: 'right' },
  '.cm-post-by': { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '10px', fontFamily: 'var(--font-sans)', fontSize: '13.5px', color: 'var(--text-3)' },
  '.cm-post-by b': { color: 'var(--text-1)', fontWeight: '650' },
  // compact: one line a post
  '.cm-post-line': {
    display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr) auto', alignItems: 'center', gap: '10px', padding: '9px 0',
    borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-sans)',
  },
  '.cm-post-line:first-child': { borderTop: '1px solid var(--border)' },
  '.cm-post-line-words': { display: 'flex', flexDirection: 'column', minWidth: '0' },
  '.cm-post-line-who': { color: 'var(--text-3)', fontSize: '12.5px' },
  '.cm-post-line-who b': { color: 'var(--text-1)', fontWeight: '650' },
  '.cm-post-line-text': { color: 'var(--text-1)', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'none' },
  '.cm-post-thumb': { width: '64px', height: '44px', borderRadius: '6px', objectFit: 'cover' },
  // what an address not kept yet says
  '.cm-post-reading': { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', fontFamily: 'var(--font-sans)', fontSize: '13px' },
  '.cm-post-row': {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 10px', padding: '10px 12px', border: '1px dashed var(--border-strong)',
    borderRadius: '10px', background: 'var(--bg-2)', color: 'var(--text-2)',
  },
  '.cm-post-failed, .cm-post-gone': { borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--warn) 45%, var(--border))' },
  '.cm-post-row-words': { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 240px', minWidth: '0' },
  '.cm-post-row-said': { color: 'var(--text-1)' },
  '.cm-post-address': { color: 'var(--text-3)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-post-said': { margin: '6px 0', color: 'var(--text-3)', fontFamily: 'var(--font-sans)', fontSize: '13px' },
  '.cm-post-act': {
    display: 'inline-flex', alignItems: 'center', gap: '6px', height: '28px', padding: '0 10px', border: '1px solid var(--border-strong)',
    borderRadius: '6px', background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-post-act:hover:not(:disabled)': { background: 'var(--bg-3)' },
  '.cm-post-act:disabled': { opacity: '.5', cursor: 'default' },
  '.cm-post-session': { display: 'flex', gap: '6px', alignItems: 'center' },
  '.cm-post-select': {
    height: '28px', padding: '0 6px', border: '1px solid var(--border-strong)', borderRadius: '6px', background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit',
  },
  '.cm-post-spin': {
    width: '14px', height: '14px', borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)',
    animation: 'cm-post-spin 0.9s linear infinite', flex: 'none',
  },
  '@keyframes cm-post-spin': { to: { transform: 'rotate(360deg)' } },
  // the Highlight a selection in the drawn words offers, under it
  '.cm-post-mark': {
    position: 'absolute', zIndex: '5', display: 'inline-flex', alignItems: 'center', gap: '6px', height: '28px', padding: '0 10px',
    border: '1px solid var(--border-strong)', borderRadius: '6px', background: 'var(--bg-2)', color: 'var(--text-1)', boxShadow: 'var(--shadow-2)',
    font: '600 12.5px var(--font-sans)', cursor: 'pointer',
  },
};

registerBlock({
  name: 'post',
  fence: POST_BLOCK,
  widget: (spec) => new PostWidget(spec),
  open: openPost,
  atomic: true,
  height: POST_HEIGHT,
  theme: { ...THEME, ...POST_CARD_THEME },
});
