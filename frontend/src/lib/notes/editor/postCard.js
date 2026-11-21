/**
 * A post's settings, between its bar and the card (`editor/postBlock.js`): the form it is
 * drawn in, the passages highlighted, the analyst's translation, the profile picture and
 * the QR code of the PDF. Each choice writes its own line as one Undo step
 * (`editor/postText.js`) and is seen on the card at once. A thread is automatic: a block
 * naming several posts draws them on one card.
 */
import { icon } from './gridMenu.js';
import { POST_FORMS, readPost, withAvatar, withForm, withQr, withTranslation, withoutHighlight } from './postText.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(name, title) {
  const row = element('div', 'cm-post-field');
  const said = element('span', 'cm-post-field-name', name);
  if (title) said.title = title;
  row.append(said);
  return row;
}

function check(label, title, onchange) {
  const holder = element('label', 'cm-post-check');
  holder.title = title;
  const box = element('input');
  box.type = 'checkbox';
  box.addEventListener('change', () => onchange(box.checked));
  holder.append(box, document.createTextNode(label));
  return { holder, box };
}

/** The settings of the post `owner` (a `PostBox`): `{ element, refresh() }`. */
export function postSettings(owner) {
  const body = element('div', 'cm-post-settings-body');

  const formRow = field('Form', 'How the post is drawn');
  const seg = element('div', 'cm-post-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Form');
  const forms = POST_FORMS.map((form) => {
    const press = element('button', 'cm-post-seg-btn', form.label);
    press.type = 'button';
    press.title = form.title;
    press.dataset.form = form.id;
    press.setAttribute('role', 'radio');
    press.addEventListener('mousedown', (event) => event.preventDefault());
    press.addEventListener('click', () => owner.edit((source) => withForm(source, form.id)));
    seg.append(press);
    return press;
  });
  const thread = element('span', 'cm-post-note');
  formRow.append(seg, thread);

  const markRow = field('Highlight', 'The passage that matters, kept word for word');
  const marks = element('div', 'cm-post-marks');
  markRow.append(marks);

  const saidRow = field('Translation', 'Your own words, shown under the post');
  const said = element('div', 'cm-post-translations');
  saidRow.append(said);

  const lookRow = field('Show', 'What the card shows beside the post');
  const avatar = check('Hide the profile picture', 'Initials on a coloured round in its place', (on) => owner.edit((source) => withAvatar(source, !on)));
  const qr = check('QR code in the PDF', 'A code beside the card that opens the post from paper', (on) => owner.edit((source) => withQr(source, on)));
  avatar.box.className = 'cm-post-hide-avatar';
  qr.box.className = 'cm-post-qr';
  const looks = element('div', 'cm-post-looks');
  looks.append(avatar.holder, qr.holder);
  lookRow.append(looks);

  body.append(formRow, markRow, saidRow, lookRow);

  /** The translation fields, one per post, kept while the analyst types in one. */
  const typing = new Map();

  function refresh() {
    const block = readPost(owner.source);
    const posts = owner.answer?.posts ?? [];
    for (const press of forms) {
      const on = press.dataset.form === block.form;
      press.classList.toggle('cm-post-seg-on', on);
      press.setAttribute('aria-checked', String(on));
    }
    thread.textContent = posts.length > 1 ? `A thread of ${posts.length} posts, numbered as published` : '';
    avatar.box.checked = !block.avatar;
    qr.box.checked = block.qr;

    const chips = [];
    for (const [at, entry] of block.entries.entries()) {
      for (const passage of entry.highlights) {
        const chip = element('span', 'cm-post-chip');
        chip.dir = 'auto';
        chip.append(element('span', 'cm-post-chip-words', passage));
        const drop = element('button', 'cm-post-chip-drop');
        drop.type = 'button';
        drop.title = 'Stop highlighting these words';
        drop.setAttribute('aria-label', `Stop highlighting “${passage}”`);
        drop.append(icon('x', 12));
        drop.addEventListener('click', () => owner.edit((source) => withoutHighlight(source, at, passage)));
        chip.append(drop);
        chips.push(chip);
      }
    }
    marks.replaceChildren(...chips, element('span', 'cm-post-note', chips.length
      ? 'Select more words in the post to add a passage.' : 'Select words in the post, then press Highlight.'));

    const fields = [];
    for (const post of posts) {
      const entry = block.entries[post.at];
      if (!entry) continue;
      let area = typing.get(post.at);
      if (!area) {
        area = element('textarea', 'cm-post-input');
        area.rows = 2;
        area.dir = 'auto';
        area.addEventListener('change', () => owner.edit((source) => withTranslation(source, Number(area.dataset.at), area.value)));
        area.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) area.blur();
        });
        typing.set(post.at, area);
      }
      area.dataset.at = String(post.at);
      area.placeholder = posts.length > 1 ? `Your translation of post ${posts.indexOf(post) + 1}` : 'Your translation, if the post needs one';
      if (area.ownerDocument.activeElement !== area) area.value = entry.translation;
      fields.push(area);
    }
    if (!fields.length) fields.push(element('span', 'cm-post-note', 'Once the post is read.'));
    said.replaceChildren(...fields);
  }

  return { element: body, refresh };
}

export const POST_CARD_THEME = {
  '.cm-post-settings-body': { display: 'flex', flexDirection: 'column', gap: '11px', padding: '12px 14px 13px' },
  '.cm-post-field': { display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', alignItems: 'start', gap: '10px', minWidth: '0' },
  '.cm-post-field > :not(.cm-post-field-name)': { gridColumn: '2' },
  '.cm-post-field-name': { color: 'var(--text-2)', fontSize: '11.5px', paddingTop: '6px' },
  '.cm-post-seg': { display: 'inline-flex', justifySelf: 'start', border: '1px solid var(--border-strong)', borderRadius: '6px', overflow: 'hidden' },
  '.cm-post-seg-btn': {
    height: '28px', padding: '0 12px', border: 'none', borderRight: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-2)',
    font: 'inherit', cursor: 'pointer',
  },
  '.cm-post-seg-btn:last-child': { borderRight: 'none' },
  '.cm-post-seg-btn:hover': { color: 'var(--text-1)', background: 'var(--bg-3)' },
  '.cm-post-seg-on, .cm-post-seg-on:hover': { background: 'var(--accent-soft)', color: 'var(--text-1)', fontWeight: '650' },
  '.cm-post-note': { color: 'var(--text-3)', fontSize: '11.5px', alignSelf: 'center' },
  '.cm-post-marks': { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', paddingTop: '3px' },
  '.cm-post-chip': {
    display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '100%', padding: '2px 4px 2px 9px', borderRadius: '999px',
    background: 'var(--accent-soft)', color: 'var(--text-1)', fontSize: '12px',
  },
  '.cm-post-chip-words': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '360px' },
  '.cm-post-chip-drop': {
    display: 'inline-grid', placeItems: 'center', width: '18px', height: '18px', padding: '0', border: 'none', borderRadius: '50%',
    background: 'none', color: 'var(--text-2)', cursor: 'pointer',
  },
  '.cm-post-chip-drop:hover': { background: 'var(--bg-3)', color: 'var(--text-1)' },
  '.cm-post-translations': { display: 'flex', flexDirection: 'column', gap: '6px' },
  '.cm-post-input': {
    boxSizing: 'border-box', width: '100%', minHeight: '48px', padding: '5px 8px', border: '1px solid var(--border-strong)', borderRadius: '5px',
    background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', resize: 'vertical', outline: 'none',
  },
  '.cm-post-input:focus': { borderColor: 'var(--info)' },
  '.cm-post-looks': { display: 'flex', flexWrap: 'wrap', gap: '6px 18px', paddingTop: '5px' },
  '.cm-post-check': { display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-1)', cursor: 'pointer' },
};
