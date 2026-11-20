/**
 * The case's pictures, to pick one beside what asked for it: a step strip's Add a step
 * and a picture's Replace. Each row shows the picture small, its name and its folder;
 * what is typed finds them by name or folder. A press, or Enter on the row the arrows
 * are on, picks one. Escape, a press elsewhere or a scroll of the page closes it.
 *
 * The small pictures are the ones the Media library already made (`media/metadata`),
 * asked once for the rows listed, never the files themselves: a list of eighty
 * pictures stays light.
 */
import { api } from '../../api.js';
import { fileUrl } from '../../fileUrl.js';
import { casePictures } from '../pictureSize.js';
import { noteCase } from './state.js';

/** The small pictures already made, by path, for a case: kept for the visit. */
const thumbs = new Map();

/** Forget the small pictures read (for tests). */
export function forgetPickerThumbs() {
  thumbs.clear();
}

/** The address of the small picture a record shows, when one is known. */
export function thumbOf(caseId, entity, made) {
  if (entity.type === 'proof') return fileUrl(caseId, entity.attrs.thumb || entity.attrs.path);
  const thumb = made.get(entity.attrs.path);
  return thumb ? fileUrl(caseId, thumb) : '';
}

/** Ask the case once for the small pictures of `entities` it has not said yet: a map of path to small picture. */
export async function readThumbs(caseId, entities, post = api.post) {
  const known = thumbs.get(caseId) ?? new Map();
  thumbs.set(caseId, known);
  const paths = entities.filter((entity) => entity.type !== 'proof' && !known.has(entity.attrs.path)).map((entity) => entity.attrs.path);
  if (!paths.length) return known;
  for (const path of paths) known.set(path, '');
  try {
    const rows = await post(`/api/cases/${caseId}/media/metadata`, { paths });
    for (const row of rows ?? []) if (row?.path && row.thumb_state === 'ready' && row.thumbnail) known.set(row.path, row.thumbnail);
  } catch {
    // a row with no small picture shows its icon
  }
  return known;
}

/** Where the list goes: under `anchor` (a rect), or above it when there is no room under. */
function place(box, anchor) {
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  let left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  let top = anchor.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 6);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  // a transformed parent makes `fixed` its own: measured, and moved back by what it shifted
  const drawn = box.getBoundingClientRect();
  if (Math.abs(drawn.left - left) > 0.5 || Math.abs(drawn.top - top) > 0.5) {
    left = 2 * left - drawn.left;
    top = 2 * top - drawn.top;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }
}

/**
 * Open the list of the case's pictures by `anchor` (an element or a rect), named
 * `title`; `pick(entity)` is called with the one pressed, then it closes. Answers
 * `{ close, box }`. `post` stands in for the API in tests.
 */
export function openCasePicker(view, anchor, { title = 'Case pictures', pick, closed = () => {}, post = api.post } = {}) {
  const info = view.state.field(noteCase);
  const box = document.createElement('div');
  box.className = 'cm-picker';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', title);
  const head = document.createElement('div');
  head.className = 'cm-picker-head';
  head.textContent = title;
  const field = document.createElement('input');
  field.type = 'search';
  field.className = 'cm-picker-field';
  field.placeholder = 'Find a picture…';
  field.setAttribute('aria-label', 'Find a picture');
  const list = document.createElement('div');
  list.className = 'cm-picker-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', title);
  box.append(head, field, list);
  view.dom.append(box);

  let made = thumbs.get(info.caseId) ?? new Map();
  let rows = [];
  let at = 0;
  let over = false;

  const light = (index) => {
    at = Math.max(0, Math.min(index, rows.length - 1));
    rows.forEach((row, number) => row.setAttribute('aria-selected', String(number === at)));
    rows[at]?.scrollIntoView?.({ block: 'nearest' });
  };
  const fill = () => {
    const found = casePictures(info.entities, field.value);
    list.replaceChildren();
    rows = found.map((entity) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cm-picker-row';
      row.setAttribute('role', 'option');
      row.dataset.entityPick = entity.id;
      row.title = entity.label;
      const thumb = document.createElement('span');
      thumb.className = 'cm-picker-thumb';
      const src = thumbOf(info.caseId, entity, made);
      if (src) {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.src = src;
        thumb.append(image);
      }
      const words = document.createElement('span');
      words.className = 'cm-picker-words';
      const name = document.createElement('span');
      name.className = 'cm-picker-name';
      name.textContent = entity.label;
      words.append(name);
      if (entity.attrs?.folder) {
        const folder = document.createElement('small');
        folder.textContent = entity.attrs.folder;
        words.append(folder);
      }
      row.append(thumb, words);
      row.entity = entity;
      list.append(row);
      return row;
    });
    if (!rows.length) {
      const none = document.createElement('p');
      none.className = 'cm-picker-none';
      none.textContent = info.entities.length ? 'No matching picture.' : 'The case holds no picture yet.';
      list.append(none);
    }
    light(0);
  };

  const close = ({ refocus = false } = {}) => {
    if (over) return;
    over = true;
    box.remove();
    document.removeEventListener('pointerdown', outside, true);
    view.scrollDOM.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (refocus) view.focus();
    closed();
  };
  const choose = (row) => {
    if (!row?.entity) return;
    const { entity } = row;
    close();
    pick?.(entity);
  };
  const outside = (event) => {
    if (!box.contains(event.target)) close();
  };
  const onScroll = () => close();

  field.addEventListener('input', fill);
  box.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ refocus: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      light(at + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(rows[at]);
    }
  });
  list.addEventListener('mousedown', (event) => event.preventDefault());
  list.addEventListener('click', (event) => choose(event.target.closest('.cm-picker-row')));
  list.addEventListener('pointermove', (event) => {
    const row = event.target.closest('.cm-picker-row');
    if (row) light(rows.indexOf(row));
  });

  fill();
  place(box, anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor);
  field.focus({ preventScroll: true });
  // the small pictures come once the case says which are made
  void readThumbs(info.caseId, casePictures(info.entities, ''), post).then((known) => {
    if (over) return;
    made = known;
    for (const row of rows) {
      const thumb = row.querySelector('.cm-picker-thumb');
      const src = thumbOf(info.caseId, row.entity, made);
      if (!src || thumb.querySelector('img')) continue;
      const image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      image.src = src;
      thumb.append(image);
    }
  });
  // opened by a press, which must not close it on its way up
  setTimeout(() => {
    if (over) return;
    document.addEventListener('pointerdown', outside, true);
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  }, 0);
  return { close, box };
}

/** How the list looks, in the app's dark and light themes. */
export const pickerTheme = {
  '.cm-picker': {
    position: 'fixed', zIndex: '1250', width: '320px', maxWidth: 'calc(100vw - 16px)', padding: '8px', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-1)', border: '1px solid var(--border-strong)',
    borderRadius: 'var(--r-lg, 8px)', boxShadow: 'var(--shadow-2)', color: 'var(--text-1)', fontFamily: 'var(--font-sans)',
    fontSize: 'var(--fs-sm, 13px)', lineHeight: '1.3',
  },
  '.cm-picker-head': {
    color: 'var(--text-3)', fontSize: '11px', fontWeight: '650', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 4px 0',
  },
  '.cm-picker-field': {
    width: '100%', boxSizing: 'border-box', height: '30px', padding: '0 9px', border: '1px solid var(--border-strong)',
    borderRadius: 'var(--r-sm, 6px)', background: 'var(--bg-2)', color: 'var(--text-1)', font: 'inherit', outline: 'none',
  },
  '.cm-picker-field:focus': { borderColor: 'var(--accent)' },
  '.cm-picker-list': { maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1px' },
  '.cm-picker-row': {
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '4px', border: 'none', borderRadius: 'var(--r-sm, 6px)',
    background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
  },
  '.cm-picker-row[aria-selected="true"]': { background: 'var(--bg-3)' },
  '.cm-picker-thumb': {
    flex: 'none', width: '56px', height: '38px', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-3)',
    boxShadow: 'inset 0 0 0 1px var(--border)',
  },
  '.cm-picker-thumb img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  '.cm-picker-words': { display: 'flex', flexDirection: 'column', minWidth: '0', gap: '1px' },
  '.cm-picker-name': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-picker-words small': { color: 'var(--text-3)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-picker-none': { margin: '6px 4px', color: 'var(--text-3)', fontSize: '12px' },
};
