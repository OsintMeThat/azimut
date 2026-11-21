// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

/**
 * A post in the drawn note (`editor/postBlock.js`): drawn from the server's reading as
 * the documents draw it, its settings each one Undo step of exact lines, a selection
 * highlighted as its exact words, and an address not kept yet read only on a press.
 * Accounts and posts are made up.
 */

const server = vi.hoisted(() => ({ asked: [], answer: null, results: [], puts: [] }));
vi.mock('../../api.js', async (original) => {
  const real = await original();
  return {
    ...real,
    api: {
      ...real.api,
      post: vi.fn(async (path, body) => {
        server.asked.push([path, body]);
        if (path.endsWith('/social-posts/describe')) return server.answer(body.text);
        if (path.endsWith('/social-posts/fetch')) return { job_id: 'j1' };
        return {};
      }),
      get: vi.fn(async (path) => {
        server.asked.push([path]);
        if (path === '/api/jobs/j1') return { status: 'done', result: { results: server.results } };
        return {};
      }),
      put: vi.fn(async (path, body) => {
        server.puts.push([path, body]);
        return {};
      }),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { forgetPostDrawings } = await import('../postCards.js');
const { drawPosts, exactPassage, keepRead } = await import('./postBlock.js');

const POST = {
  id: 'e_post', at: 0, site: 'bluesky', site_label: 'Bluesky', url: 'https://bsky.app/profile/redseadesk.bsky.social/post/3m7k',
  name: 'Red Sea Desk', handle: 'redseadesk.bsky.social', text: 'Satellite pass this morning: no vehicles left at the checkpoint.',
  lang: 'en', rtl: false, when: '16 Nov 2026 · 09:40 UTC', posted_at: '2026-11-16T09:40:00Z', captured: '17 Nov 2026',
  avatar: '.posts/bluesky-3m7k.files/avatar.jpg', initials: 'RS', tint: ['#2f6fb0', '#1a3d66'], highlights: [], translation: '',
  archive: '', pictures: [{ kind: 'image', path: 'media/pic.jpg', media: 'media/pic.jpg', duration: '', alt: 'Checkpoint' }],
  proof: { label: 'Proof 12', id: 'e_proof', posted: '' },
};

/** What the server draws a block as: its lines read the way the engine reads them. */
function describing(text) {
  const avatar = !/avatar: hidden/.test(text);
  const form = /form: (\w+)/.exec(text)?.[1] ?? 'card';
  const highlights = [...text.matchAll(/^highlight: (.*)$/gm)].map((found) => found[1]);
  const translation = /^translation: (.*)$/m.exec(text)?.[1] ?? '';
  const posts = /post: e_post/.test(text) ? [{ ...POST, highlights, translation }] : [];
  const missing = [...text.matchAll(/^link: (.*)$/gm)].map((found) => found[1]);
  return { form, avatar, qr: /qr: on/.test(text), span: POST.when, missing, posts };
}

const NOTE = 'Before.\n\n::: post\npost: e_post\n:::\n\nAfter.';

let view;
let handlers;
beforeEach(() => {
  server.asked = [];
  server.puts = [];
  server.results = [];
  server.answer = describing;
  forgetPostDrawings();
});
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc, { readOnly = false } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  handlers = { tableToast: vi.fn(), open: vi.fn(), noteKey: 'c1:n1', noteId: 'n1' };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, readOnly }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [{ id: 'e_proof', type: 'proof', label: 'Proof 12', attrs: {} }] }) });
  view.focus = vi.fn();
  return view;
}

const text = () => view.state.doc.toString();
const settle = async () => {
  for (let step = 0; step < 6; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const box = () => view.dom.querySelector('.cm-post-block');
const press = (node) => {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  node.click();
};
const fetched = () => server.asked.filter(([path]) => path.includes('/social-posts/fetch'));

describe('a post in the note', () => {
  it('is drawn as the page draws it, from what the case keeps, and reads nothing on open', async () => {
    editor(NOTE);
    await settle();
    expect(box()).not.toBeNull();
    expect(box().querySelector('.cm-post-who b').textContent).toBe('Red Sea Desk');
    expect(box().querySelector('.cm-post-handle').textContent).toBe('@redseadesk.bsky.social');
    expect(box().querySelector('.cm-post-avatar img').getAttribute('src')).toBe('/files/c1/.posts/bluesky-3m7k.files/avatar.jpg');
    expect(box().querySelector('.cm-post-shot img').getAttribute('src')).toBe('/files/c1/media/pic.jpg');
    expect(box().querySelector('.cm-post-foot a').getAttribute('href')).toBe(POST.url);
    expect(box().querySelector('.cm-post-proof').textContent).toBe('Geolocated · Proof 12');
    // no counter, no widget: the words are the post's own, nothing from the site's page
    expect(box().textContent).not.toMatch(/like|repost|view count/i);
    expect(box().querySelector('iframe, script')).toBeNull();
    expect(fetched()).toEqual([]);
  });

  it('opens the proof it is geolocated by in the app', async () => {
    editor(NOTE);
    await settle();
    box().querySelector('.cm-post-proof').click();
    expect(handlers.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'e_proof' }));
  });

  it('writes each setting as its own line, one Undo step each', async () => {
    editor(NOTE);
    await settle();
    press(box().querySelector('.cm-post-settings-btn'));
    const quote = box().querySelector('.cm-post-seg-btn[data-form="quote"]');
    press(quote);
    expect(text()).toBe('Before.\n\n::: post\npost: e_post\nform: quote\n:::\n\nAfter.');
    await settle();
    expect(box().querySelector('.cm-post-quote-words').textContent).toBe(`“${POST.text}”`);
    const hide = box().querySelector('input.cm-post-hide-avatar');
    hide.checked = true;
    hide.dispatchEvent(new Event('change'));
    expect(text()).toContain('form: quote\navatar: hidden\n:::');
    await settle();
    expect(box().querySelector('.cm-post-initials').textContent).toBe('RS');
    undo(view);
    expect(text()).toBe('Before.\n\n::: post\npost: e_post\nform: quote\n:::\n\nAfter.');
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('keeps a translation typed in the settings', async () => {
    editor(NOTE);
    await settle();
    press(box().querySelector('.cm-post-settings-btn'));
    const area = box().querySelector('.cm-post-input');
    area.value = 'Aucun véhicule au point de contrôle.';
    area.dispatchEvent(new Event('change'));
    expect(text()).toContain('post: e_post\ntranslation: Aucun véhicule au point de contrôle.\n:::');
    await settle();
    expect(box().querySelector('.cm-post-translation').textContent).toBe('TranslationAucun véhicule au point de contrôle.');
  });

  it('highlights the words selected in the post, as their exact passage', async () => {
    editor(NOTE);
    await settle();
    const words = box().querySelector('.cm-post-text');
    const node = words.querySelector('p').firstChild;
    const start = POST.text.indexOf('no vehicles');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 'no vehicles left'.length);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    box().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await settle();
    const marker = box().querySelector('.cm-post-mark');
    expect(marker.hidden).toBe(false);
    marker.click();
    expect(text()).toContain('post: e_post\nhighlight: no vehicles left\n:::');
    await settle();
    expect(box().querySelector('.cm-post-text mark').textContent).toBe('no vehicles left');
  });

  it('reads an address not kept yet on its press only, then names it by its post', async () => {
    editor('::: post\nlink: https://bsky.app/profile/redseadesk.bsky.social/post/3m7k\n:::');
    await settle();
    const row = box().querySelector('.cm-post-row');
    expect(row.textContent).toContain('Not read yet');
    expect(fetched()).toEqual([]);
    server.results = [{ link: 'https://bsky.app/profile/redseadesk.bsky.social/post/3m7k', id: 'e_post' }];
    press(row.querySelector('.cm-post-read'));
    await settle();
    expect(fetched()).toHaveLength(1);
    expect(text()).toBe('::: post\npost: e_post\n:::');
  });

  it('says why a read failed, and offers Try again', async () => {
    editor('::: post\nlink: https://x.com/coast_monitor/status/12\n:::');
    await settle();
    server.results = [{ link: 'https://x.com/coast_monitor/status/12', error: 'X could not be reached: no connection' }];
    press(box().querySelector('.cm-post-read'));
    await settle();
    expect(text()).toBe('::: post\nlink: https://x.com/coast_monitor/status/12\n:::');
    const row = box().querySelector('.cm-post-row');
    expect(row.textContent).toContain('Not read: X could not be reached: no connection');
    expect(row.querySelector('.cm-post-read').textContent).toBe('Try again');
  });

  it('asks for a browser’s session when X wants one, and reads again with it', async () => {
    editor('::: post\nlink: https://x.com/coast_monitor/status/13\n:::');
    await settle();
    server.results = [{ link: 'https://x.com/coast_monitor/status/13', error: 'X wants a signed-in session', needs_auth: true }];
    press(box().querySelector('.cm-post-read'));
    await settle();
    const row = box().querySelector('.cm-post-row');
    expect(row.textContent).toContain('never a password');
    row.querySelector('.cm-post-select').value = 'firefox';
    server.results = [{ link: 'https://x.com/coast_monitor/status/13', id: 'e_post' }];
    row.querySelector('.cm-post-session .cm-post-act').click();
    await settle();
    expect(server.puts).toEqual([['/api/settings/prefs', { download_cookies: { source: 'browser', browser: 'firefox' } }]]);
    expect(text()).toBe('::: post\npost: e_post\n:::');
  });

  it('offers no settings in a note that cannot be written', async () => {
    editor(NOTE, { readOnly: true });
    await settle();
    expect(box().querySelector('.cm-post-bar')).toBeNull();
    expect(box().querySelector('.cm-post-who b').textContent).toBe('Red Sea Desk');
  });
});

describe('the drawing', () => {
  it('draws a thread numbered as published, its footer once', () => {
    const second = { ...POST, id: 'e_two', at: 1, proof: null };
    const drawn = drawPosts({ form: 'card', avatar: true, span: '16 Nov 2026 · 09:40 to 10:02 UTC', posts: [POST, second] }, { caseId: 'c1' });
    expect([...drawn.querySelectorAll('.cm-post-num')].map((node) => node.textContent)).toEqual(['1/2', '2/2']);
    expect(drawn.querySelectorAll('.cm-post-foot')).toHaveLength(1);
    expect(drawn.querySelector('.cm-post-when').textContent).toBe('16 Nov 2026 · 09:40 to 10:02 UTC · captured on 17 Nov 2026');
  });

  it('sets right-to-left words from the right, initials on the account’s colours with no picture', () => {
    const arabic = { ...POST, text: 'رتل من المركبات', rtl: true, lang: 'ar', avatar: '', highlights: ['رتل'] };
    const drawn = drawPosts({ form: 'card', avatar: true, posts: [arabic] }, { caseId: 'c1' });
    const words = drawn.querySelector('.cm-post-text');
    expect(words.dir).toBe('rtl');
    expect(words.lang).toBe('ar');
    expect(words.querySelector('mark').textContent).toBe('رتل');
    expect(drawn.querySelector('.cm-post-initials').style.getPropertyValue('--cm-post-a')).toBe('#2f6fb0');
  });

  it('sets each paragraph in its own direction, an Arabic place name over English words', () => {
    const mixed = { ...POST, text: 'غريرة، محافظة تعز\n\nLoyalists post photos claiming to be on site.', rtl: true };
    const drawn = drawPosts({ form: 'card', avatar: true, posts: [mixed] }, { caseId: 'c1' });
    expect([...drawn.querySelectorAll('.cm-post-para')].map((node) => node.dir)).toEqual(['rtl', 'ltr']);
  });

  it('draws one line a post in the compact form', () => {
    const drawn = drawPosts({ form: 'compact', avatar: true, posts: [POST, { ...POST, id: 'e_two' }] }, { caseId: 'c1' });
    expect(drawn.querySelectorAll('.cm-post-line')).toHaveLength(2);
    expect(drawn.querySelector('.cm-post-line-who').textContent).toBe('Red Sea Desk · Bluesky · 16 Nov 2026');
  });

  it('finds a passage selected across a line break as the post writes it', () => {
    expect(exactPassage('first line\nsecond line', 'line second')).toBe('line\nsecond');
  });

  it('names every address a read kept, in every post block of the note', () => {
    editor('::: post\nlink: https://x.com/a/status/1\n:::\n\n::: post\nlink: https://x.com/a/status/1\nform: quote\n:::');
    expect(keepRead(view, [{ link: 'https://x.com/a/status/1', id: 'e_1' }])).toBe(true);
    expect(text()).toBe('::: post\npost: e_1\n:::\n\n::: post\npost: e_1\nform: quote\n:::');
  });
});
