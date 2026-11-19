/**
 * What the insert menu shows beside its list for the entry picked: a small drawing
 * of what the entry makes, its name, its line, and the Markdown it writes, which is
 * there to read and never to type.
 */
import { EditorView } from '@codemirror/view';

import { SLASH_COMMANDS, slashHint, slashInsert } from '../syntax.js';

const NOW = () => new Date();

/** An element of `tag` with `className`, holding `children` (elements or text). */
function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

/** `count` grey lines of words, the last one shorter. */
function lines(count, { short = 0.6 } = {}) {
  return Array.from({ length: count }, (_, at) => {
    const line = el('span', 'cm-ip-line');
    if (at === count - 1) line.style.width = `${Math.round(short * 100)}%`;
    return line;
  });
}

/** A picture's place: a frame with hills and a sun, as an empty picture is drawn. */
function picture(className = '') {
  return el('span', `cm-ip-picture ${className}`, el('span', 'cm-ip-sun'), el('span', 'cm-ip-hill'));
}

/** The drawings, by the kind of thing an entry makes. */
const ART = {
  heading: (command) => [el('span', `cm-ip-heading cm-ip-${command.id}`, 'Heading'), ...lines(2)],
  bullet: () => [1, 2, 3].map((at) => el('span', 'cm-ip-row', el('span', 'cm-ip-dot'), lines(1, { short: at === 3 ? 0.5 : 0.85 }))),
  numbered: () => [1, 2, 3].map((at) => el('span', 'cm-ip-row', el('span', 'cm-ip-num', `${at}.`), lines(1, { short: at === 3 ? 0.5 : 0.85 }))),
  task: () => [true, false, false].map((done, at) => el('span', `cm-ip-row${done ? ' cm-ip-done' : ''}`,
    el('span', `cm-ip-box${done ? ' cm-ip-ticked' : ''}`), lines(1, { short: at === 2 ? 0.5 : 0.8 }))),
  quote: () => [el('span', 'cm-ip-quote', lines(2, { short: 0.7 }))],
  callout: (command) => [callout(command.label, command.colour)],
  callouts: () => SLASH_COMMANDS.filter((command) => command.group === 'callout').slice(0, 3)
    .map((command) => callout(command.label, command.colour, 1)),
  code: () => [el('span', 'cm-ip-code', 'curl -I https://…', el('br'), 'HTTP/2 200')],
  entry: () => [el('span', 'cm-ip-stamp', slashInsert({ entry: true }, { now: NOW() }).text.replace(/^#+\s*/, '').trim()), ...lines(2)],
  date: () => [el('span', 'cm-ip-row', el('span', 'cm-ip-words', 'Checked on '), el('span', 'cm-ip-mono', slashInsert({ today: true }, { now: NOW() }).text))],
  hint: () => [el('span', 'cm-ip-guidance', 'Say where the picture was taken'), ...lines(1)],
  picture: () => [picture(), el('span', 'cm-ip-caption', 'Frame 12, the quay at dawn')],
  upload: () => [picture('cm-ip-upload'), el('span', 'cm-ip-caption', 'photo.jpg, added to the case')],
  steps: () => [el('span', 'cm-ip-strip', [1, 2, 3].map((at) => el('span', 'cm-ip-step', picture(), el('span', 'cm-ip-badge', String(at)))))],
  story: () => [el('span', 'cm-ip-story', picture(), el('span', 'cm-ip-col', lines(3)))],
  logo: () => [el('span', 'cm-ip-row', el('span', 'cm-ip-logo', 'LOGO')), ...lines(2)],
  cite: () => [el('span', 'cm-ip-row', el('span', 'cm-ip-words', 'Seen at '), el('span', 'cm-ip-chip', '✓ Quay north'), el('span', 'cm-ip-words', ' on day 2.'))],
  map: () => [el('span', 'cm-ip-map', el('span', 'cm-ip-front'), [1, 2, 3, 4].map((at) => el('span', `cm-ip-mark cm-ip-mark-${at}`)),
    el('span', 'cm-ip-map-said', 'Front, north · 16 Nov'))],
  include: () => [el('span', 'cm-ip-include', el('span', 'cm-ip-tag', 'Chapter 1'), el('span', 'cm-ip-title', 'Vehicle analysis'), lines(1))],
  divider: () => [...lines(2), el('span', 'cm-ip-rule'), ...lines(2)],
  pagebreak: () => [el('span', 'cm-ip-pages', el('span', 'cm-ip-page', lines(4)), el('span', 'cm-ip-cut', 'New page'), el('span', 'cm-ip-page', lines(2)))],
  cover: () => [el('span', 'cm-ip-sheet', el('span', 'cm-ip-corner cm-ip-top-right'), el('span', 'cm-ip-cover-title'), el('span', 'cm-ip-cover-sub'))],
  corner: (command) => [el('span', 'cm-ip-sheet', el('span', `cm-ip-corner cm-ip-${command.wrap ?? 'top-right'}`), el('span', 'cm-ip-cover-title'))],
  align: (command) => [el('span', `cm-ip-aligned cm-ip-${command.wrap ?? 'center'}`, lines(3, { short: 0.5 }))],
  signature: () => [el('span', 'cm-ip-signed', el('span', 'cm-ip-scribble'), el('span', 'cm-ip-signer', 'Your name'), lines(1, { short: 0.4 }))],
  field: (command) => [el('span', 'cm-ip-row', el('span', 'cm-ip-words', 'Written by '),
    el('span', 'cm-ip-field', command.text ? command.label.replace(/^Field: /, '') : 'name'), el('span', 'cm-ip-words', '.'))],
  table: () => [el('span', 'cm-ip-table', ['Source', 'Status', '', 'Seen', 'Confirmed', '', '', '', ''].map((cell, at) => el('span', at < 3 ? 'cm-ip-th' : 'cm-ip-td', cell)))],
  diagram: () => [el('span', 'cm-ip-diagram', el('span', 'cm-ip-node', 'Tip'), el('span', 'cm-ip-arrow'), el('span', 'cm-ip-node', 'Check'),
    el('span', 'cm-ip-arrow'), el('span', 'cm-ip-node cm-ip-node-done', 'Confirmed'))],
};

/** A callout as the note draws it: a coloured edge, its name, its words. */
function callout(label, colour, count = 2) {
  const box = el('span', 'cm-ip-callout', el('span', 'cm-ip-callout-label', label), lines(count, { short: 0.7 }));
  box.style.setProperty('--callout', colour);
  return box;
}

/** Which drawing an entry gets. */
function artOf(command) {
  if (command.menu === 'callout') return 'callouts';
  if (command.line?.startsWith('> [!')) return 'callout';
  if (/^h[1-6]$/.test(command.id)) return 'heading';
  if (command.group === 'corner' || command.menu === 'corner') return 'corner';
  if (command.group === 'align' || command.menu === 'align') return 'align';
  if (command.group === 'field' || command.menu === 'field') return 'field';
  return { 'my-logo': 'logo' }[command.id] ?? (ART[command.id] ? command.id : 'block');
}

/** What an entry writes in Markdown, cut to a few lines; '' for a group, which writes nothing itself. */
export function sampleMarkdown(command) {
  if (command.menu) return '';
  const written = {
    cite: '[[entity:…|Quay north]]',
    picture: '[[media:…|Frame 12]]',
    upload: '[[media:…|photo.jpg]]',
    map: '::: map\ntitle: The front, north\nlayer: Front, north\n:::',
    include: '[[include:…]]',
    table: '| Source | Status |\n| --- | --- |\n|  |  |',
    cover: '::: center\n# {title}\n{date}\n:::\n<!-- cover -->',
  }[command.id];
  if (written) return written;
  if (command.line) return `${command.line}${command.line.startsWith('> [!') ? '' : 'Your words'}`.trimEnd();
  if (command.wrap) return `::: ${command.wrap}\nYour words\n:::`;
  const made = slashInsert(command, { now: NOW() });
  const text = (made?.text ?? '').trim();
  const kept = text.split('\n');
  return kept.length > 6 ? [...kept.slice(0, 5), '…'].join('\n') : text;
}

/** The names a group holds, for its preview: "Confirmed, Unverified, Lead…". */
function members(command) {
  const names = SLASH_COMMANDS.filter((item) => item.group === command.menu).map((item) => item.label.replace(/^(Corner|Field): /, ''));
  return names.join(' · ');
}

/** The preview of `command`, as the menu shows it beside the list. */
export function insertPreview(command) {
  const drawing = ART[artOf(command)] ?? (() => lines(3));
  const pane = el('div', 'cm-ip',
    el('div', 'cm-ip-art', el('span', 'cm-ip-paper', drawing(command))),
    el('div', 'cm-ip-name', command.label),
    el('div', 'cm-ip-said', slashHint(command)));
  pane.dataset.entry = command.id;
  if (command.menu) {
    pane.append(el('div', 'cm-ip-members', members(command)), el('div', 'cm-ip-note', 'Pick it to see each one.'));
    return pane;
  }
  const sample = sampleMarkdown(command);
  if (sample) pane.append(el('pre', 'cm-ip-md', sample), el('div', 'cm-ip-note', 'Written for you. Markdown mode shows it as text.'));
  return pane;
}

/** How the preview is drawn: a small page in the note's own colours. */
export const previewLook = EditorView.theme({
  '.cm-ip': { display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--text-1)', fontSize: '12.5px', lineHeight: '1.4' },
  '.cm-ip-art': { padding: '2px 0 6px' },
  '.cm-ip-paper': {
    display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '104px', padding: '12px 14px', boxSizing: 'border-box', borderRadius: '6px',
    background: 'var(--bg-1)', border: '1px solid var(--border)', overflow: 'hidden', justifyContent: 'center',
  },
  '.cm-ip-name': { fontSize: '14px', fontWeight: '650' },
  '.cm-ip-said, .cm-ip-members': { color: 'var(--text-2)' },
  '.cm-ip-md': {
    margin: '4px 0 0', padding: '8px 10px', borderRadius: '5px', background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--text-3)',
    fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '120px', overflow: 'hidden',
  },
  '.cm-ip-note': { color: 'var(--text-3)', fontSize: '11px' },
  '.cm-ip-line': { display: 'block', height: '6px', width: '100%', borderRadius: '3px', background: 'color-mix(in srgb, var(--text-3) 45%, transparent)', flex: 'none' },
  '.cm-ip-row': { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' },
  '.cm-ip-row > .cm-ip-line': { flex: '1 1 auto' },
  '.cm-ip-words': { color: 'var(--text-2)', whiteSpace: 'pre' },
  '.cm-ip-mono': { fontFamily: 'var(--font-mono)', color: 'var(--text-1)' },
  '.cm-ip-heading': { fontWeight: '650', color: 'var(--text-1)', lineHeight: '1.1' },
  '.cm-ip-h1': { fontSize: '22px' },
  '.cm-ip-h2': { fontSize: '18px' },
  '.cm-ip-h3': { fontSize: '15px' },
  '.cm-ip-dot': { width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent)', flex: 'none' },
  '.cm-ip-num': { color: 'var(--accent)', fontSize: '11px', width: '12px', flex: 'none' },
  '.cm-ip-box': { width: '11px', height: '11px', border: '1.5px solid var(--text-3)', borderRadius: '3px', boxSizing: 'border-box', flex: 'none' },
  '.cm-ip-ticked': { background: 'var(--accent)', borderColor: 'var(--accent)' },
  '.cm-ip-done .cm-ip-line': { opacity: '0.45' },
  '.cm-ip-quote': { display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '10px', borderLeft: '2px solid var(--border-strong)' },
  '.cm-ip-callout': {
    display: 'flex', flexDirection: 'column', gap: '5px', padding: '7px 10px', borderLeft: '3px solid var(--callout)',
    background: 'color-mix(in srgb, var(--callout) 12%, transparent)', borderRadius: '0 4px 4px 0',
  },
  '.cm-ip-callout-label': { color: 'var(--callout)', fontSize: '9.5px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' },
  '.cm-ip-code': {
    display: 'block', padding: '8px 10px', borderRadius: '4px', background: 'var(--bg-2)', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-2)',
  },
  '.cm-ip-stamp': { fontWeight: '650', fontSize: '13px' },
  '.cm-ip-guidance': { color: 'var(--text-3)', fontStyle: 'italic', paddingLeft: '8px', borderLeft: '2px solid var(--border-strong)' },
  '.cm-ip-picture': {
    position: 'relative', display: 'block', height: '64px', borderRadius: '4px', overflow: 'hidden', flex: 'none',
    background: 'linear-gradient(180deg, #43566b 0%, #6b7f8f 100%)',
  },
  '.cm-ip-sun': { position: 'absolute', top: '10px', right: '16px', width: '12px', height: '12px', borderRadius: '50%', background: '#e8c27a' },
  '.cm-ip-hill': { position: 'absolute', left: '-10%', right: '-10%', bottom: '-22px', height: '44px', borderRadius: '50% 50% 0 0', background: '#2f3d35' },
  '.cm-ip-upload::after': {
    content: '"↑"', position: 'absolute', left: '8px', top: '6px', width: '18px', height: '18px', borderRadius: '4px', background: 'rgba(0,0,0,.45)',
    color: '#fff', fontSize: '12px', lineHeight: '18px', textAlign: 'center',
  },
  '.cm-ip-caption': { color: 'var(--text-2)', fontSize: '11px' },
  '.cm-ip-strip': { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' },
  '.cm-ip-step': { position: 'relative' },
  '.cm-ip-step .cm-ip-picture': { height: '52px' },
  '.cm-ip-badge': {
    position: 'absolute', top: '4px', left: '4px', minWidth: '15px', height: '15px', borderRadius: '8px', background: 'var(--accent)',
    color: 'var(--accent-text)', fontSize: '10px', fontWeight: '700', lineHeight: '15px', textAlign: 'center',
  },
  '.cm-ip-story': { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'center' },
  '.cm-ip-col': { display: 'flex', flexDirection: 'column', gap: '6px' },
  '.cm-ip-logo': {
    display: 'inline-block', padding: '4px 8px', border: '1px dashed var(--border-strong)', borderRadius: '4px', color: 'var(--text-3)',
    fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em',
  },
  '.cm-ip-chip': {
    display: 'inline-flex', padding: '0 6px', borderRadius: '4px', background: 'var(--bg-3)', border: '1px solid var(--border)',
    color: 'var(--text-1)', fontSize: '11.5px', whiteSpace: 'nowrap',
  },
  '.cm-ip-map': {
    position: 'relative', display: 'block', height: '86px', borderRadius: '4px', overflow: 'hidden',
    background: 'radial-gradient(circle at 30% 40%, #3d4f45 0, #2b3a33 55%, #22303a 100%)',
  },
  '.cm-ip-front': { position: 'absolute', left: '-5%', top: '42%', width: '110%', height: '0', borderTop: '2px dashed #e2614c', transform: 'rotate(-12deg)' },
  '.cm-ip-mark': { position: 'absolute', width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid #fff', boxSizing: 'border-box' },
  '.cm-ip-mark-1': { left: '22%', top: '24%', background: '#3987e5' },
  '.cm-ip-mark-2': { left: '48%', top: '58%', background: '#e2614c' },
  '.cm-ip-mark-3': { left: '70%', top: '30%', background: '#3987e5' },
  '.cm-ip-mark-4': { left: '34%', top: '70%', background: '#e8a33d' },
  '.cm-ip-map-said': { position: 'absolute', left: '6px', bottom: '6px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(16,18,22,.8)', color: '#fff', fontSize: '10px' },
  '.cm-ip-include': {
    display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 10px', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)',
    borderRadius: '5px', background: 'var(--bg-2)',
  },
  '.cm-ip-tag': { color: 'var(--accent)', fontSize: '9.5px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' },
  '.cm-ip-title': { fontWeight: '650', fontSize: '12.5px' },
  '.cm-ip-rule': { display: 'block', height: '0', borderTop: '1px solid var(--border-strong)', margin: '2px 0' },
  '.cm-ip-pages': { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'center' },
  '.cm-ip-page': {
    display: 'flex', flexDirection: 'column', gap: '5px', height: '70px', padding: '8px', boxSizing: 'border-box', borderRadius: '3px',
    background: 'var(--bg-2)', border: '1px solid var(--border)',
  },
  '.cm-ip-cut': { color: 'var(--text-3)', fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', writingMode: 'vertical-rl' },
  '.cm-ip-sheet': {
    position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', alignSelf: 'center',
    width: '86px', height: '112px', borderRadius: '3px', background: 'var(--bg-2)', border: '1px solid var(--border-strong)',
  },
  '.cm-ip-corner': { position: 'absolute', width: '20px', height: '9px', borderRadius: '2px', background: 'var(--accent)' },
  '.cm-ip-top-left': { top: '7px', left: '7px' },
  '.cm-ip-top-right': { top: '7px', right: '7px' },
  '.cm-ip-bottom-left': { bottom: '7px', left: '7px' },
  '.cm-ip-bottom-right': { bottom: '7px', right: '7px' },
  '.cm-ip-cover-title': { width: '56px', height: '8px', borderRadius: '3px', background: 'var(--text-2)' },
  '.cm-ip-cover-sub': { width: '36px', height: '5px', borderRadius: '3px', background: 'var(--text-3)' },
  '.cm-ip-aligned': { display: 'flex', flexDirection: 'column', gap: '6px' },
  '.cm-ip-aligned .cm-ip-line': { width: '70%' },
  '.cm-ip-center': { alignItems: 'center' },
  '.cm-ip-right': { alignItems: 'flex-end' },
  '.cm-ip-signed': { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' },
  '.cm-ip-scribble': { width: '70px', height: '22px', borderBottom: '2px solid var(--text-2)', borderRadius: '0 0 50% 50% / 0 0 100% 100%', transform: 'skewX(-18deg)' },
  '.cm-ip-signer': { fontWeight: '650', fontSize: '12px' },
  '.cm-ip-field': {
    display: 'inline-block', padding: '0 5px', borderRadius: '3px', background: 'var(--bg-2)', boxShadow: 'inset 0 0 0 1px var(--border)',
    color: 'var(--text-3)', fontStyle: 'italic',
  },
  '.cm-ip-table': { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', border: '1px solid var(--border-strong)', borderRadius: '3px', overflow: 'hidden' },
  '.cm-ip-th, .cm-ip-td': { minHeight: '20px', padding: '2px 6px', fontSize: '10.5px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' },
  '.cm-ip-th': { background: 'var(--bg-3)', fontWeight: '650' },
  '.cm-ip-td': { color: 'var(--text-2)' },
  '.cm-ip-diagram': { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '14px 8px', borderRadius: '4px', background: '#fff' },
  '.cm-ip-node': { padding: '4px 7px', border: '1.5px solid #184f95', borderRadius: '4px', color: '#202124', fontSize: '10.5px', background: '#eaf2fc' },
  '.cm-ip-node-done': { background: '#184f95', color: '#fff' },
  '.cm-ip-arrow': { width: '14px', height: '0', borderTop: '1.5px solid #5f6368' },
});
