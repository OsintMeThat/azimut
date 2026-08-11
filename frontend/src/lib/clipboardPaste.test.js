// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api.js';
import {
  hostOf,
  ignorePasteTarget,
  listenForPaste,
  MAX_PASTE_IMAGE_BYTES,
  pasteImage,
  pasteProblem,
  PASTE_RULES,
  readPaste,
  resolvePaste,
  sourceFromHtml,
} from './clipboardPaste.js';

vi.mock('./api.js', () => ({ api: { post: vi.fn(async () => ({ entity: { id: 'e1' } })) } }));

/** A clipboard as the browser hands one over: typed entries plus the flat file list. */
function clipboard({ image = null, text = '', html = '', size = 1024 } = {}) {
  const file = image ? { type: image, size, name: 'image.png' } : null;
  const data = { 'text/plain': text, 'text/html': html };
  return {
    items: file ? [{ kind: 'file', type: image, getAsFile: () => file }] : [],
    files: file ? [file] : [],
    getData: (type) => data[type] ?? '',
    file,
  };
}

describe('reading one paste', () => {
  it('takes the image when the clipboard carries pixels', () => {
    const cd = clipboard({ image: 'image/png' });
    expect(readPaste(cd)).toMatchObject({ kind: 'image', file: cd.file, sourceUrl: '' });
  });

  it('keeps the page an image was copied from as its source', () => {
    // a screenshot copied out of a browser carries the markup beside the pixels,
    // and that markup is the only place the image's own address exists
    const cd = clipboard({
      image: 'image/png',
      html: '<meta charset="utf-8"><img alt="x" src="https://example.com/shot.png" width="800">',
    });
    expect(readPaste(cd).sourceUrl).toBe('https://example.com/shot.png');
  });

  it('falls back to the copied text as the source when the markup has none', () => {
    const cd = clipboard({ image: 'image/png', text: 'https://example.com/page' });
    expect(readPaste(cd).sourceUrl).toBe('https://example.com/page');
  });

  it('lets pixels win over the link that came with them', () => {
    // the analyst pasted an image; the address is context, not the other candidate
    const cd = clipboard({ image: 'image/png', text: 'https://example.com/page' });
    expect(readPaste(cd).kind).toBe('image');
  });

  it('reads a lone http(s) address as a link', () => {
    expect(readPaste(clipboard({ text: 'https://example.com/x?a=1' }))).toEqual({
      kind: 'url',
      url: 'https://example.com/x?a=1',
    });
  });

  it('does not mistake a sentence containing an address for a link', () => {
    expect(readPaste(clipboard({ text: 'see https://example.com for more' }))).toMatchObject({
      kind: 'text',
    });
  });

  it('reads anything else as text, and an empty clipboard as nothing', () => {
    expect(readPaste(clipboard({ text: 'some notes' }))).toEqual({ kind: 'text', text: 'some notes' });
    expect(readPaste(clipboard())).toBeNull();
    expect(readPaste(null)).toBeNull();
  });

  it('takes the file list when an item entry hands back nothing', () => {
    // Safari has been known to list the entry and refuse the file
    const cd = clipboard({ image: 'image/png' });
    cd.items = [{ kind: 'file', type: 'image/png', getAsFile: () => null }];
    expect(readPaste(cd)).toMatchObject({ kind: 'image', file: cd.file });
  });

  it('ignores a non-image file entry', () => {
    const cd = clipboard();
    cd.items = [{ kind: 'file', type: 'application/pdf', getAsFile: () => ({ type: 'application/pdf' }) }];
    expect(readPaste(cd)).toBeNull();
  });
});

describe('the source read off copied markup', () => {
  it('accepts either quoting', () => {
    expect(sourceFromHtml("<img src='https://a.example/1.png'>")).toBe('https://a.example/1.png');
    expect(sourceFromHtml('<img src="https://a.example/2.png">')).toBe('https://a.example/2.png');
  });

  it('refuses anything that is not an http(s) address', () => {
    // a data: URI is the pixels again, not a provenance, and javascript: is worse
    expect(sourceFromHtml('<img src="data:image/png;base64,AAA">')).toBe('');
    expect(sourceFromHtml('<img src="javascript:alert(1)">')).toBe('');
    expect(sourceFromHtml('')).toBe('');
    expect(sourceFromHtml(null)).toBe('');
  });
});

describe('what each surface takes', () => {
  const image = { kind: 'image', file: { type: 'image/png', size: 2048 }, sourceUrl: '' };
  const url = { kind: 'url', url: 'https://example.com/page' };
  const text = { kind: 'text', text: 'hello' };

  it('files an image on all four surfaces', () => {
    for (const tool of ['media', 'files', 'graph', 'board']) {
      expect(resolvePaste(tool, image)).toMatchObject({ mode: 'form', kind: 'image' });
    }
  });

  it('refuses a link in Media, and says where it does work', () => {
    // Media takes files; a link there means a download, which has its own field
    const resolved = resolvePaste('media', url);
    expect(resolved.mode).toBe('refuse');
    expect(resolved.reason).toContain('URL field');
  });

  it('makes a bookmark of a link everywhere else', () => {
    for (const tool of ['files', 'graph', 'board']) {
      expect(resolvePaste(tool, url)).toMatchObject({ mode: 'form', kind: 'url' });
    }
  });

  it('refuses text on every surface rather than doing nothing', () => {
    for (const tool of ['media', 'files', 'graph', 'board']) {
      const resolved = resolvePaste(tool, text);
      expect(resolved.mode).toBe('refuse');
      expect(resolved.reason).toContain('note');
    }
  });

  it('refuses an image over the API cap, naming the limit', () => {
    const huge = { ...image, file: { type: 'image/png', size: MAX_PASTE_IMAGE_BYTES + 1 } };
    const resolved = resolvePaste('media', huge);
    expect(resolved.mode).toBe('refuse');
    expect(resolved.reason).toContain('25 MB');
  });

  it('offers a folder only where filing is what the surface is for', () => {
    expect(PASTE_RULES.files.image.fields).toContain('folder');
    expect(PASTE_RULES.files.url.fields).toContain('folder');
    for (const tool of ['media', 'graph', 'board']) {
      expect(PASTE_RULES[tool].image.fields).not.toContain('folder');
    }
  });

  it('says nothing at all for an empty clipboard or a surface without a rule', () => {
    expect(resolvePaste('media', null)).toBeNull();
    expect(resolvePaste('satellite', image)).toBeNull();
  });
});

describe('what the dialog opens on', () => {
  it('names a pasted link after its host, so the title is never blank', () => {
    const resolved = resolvePaste('files', { kind: 'url', url: 'https://leak.example.com/a/b' });
    expect(resolved.values.title).toBe('leak.example.com');
  });

  it('opens on the folder the analyst is standing in', () => {
    const resolved = resolvePaste('files', { kind: 'url', url: 'https://x.example' }, {
      folder: 'Sources',
    });
    expect(resolved.values.folder).toBe('Sources');
  });

  it('prefills an image source with the page it was copied from', () => {
    const resolved = resolvePaste('graph', {
      kind: 'image',
      file: { type: 'image/png', size: 10 },
      sourceUrl: 'https://example.com/shot.png',
    });
    expect(resolved.values.source).toBe('https://example.com/shot.png');
    expect(resolved.values.title).toBe('');
  });

  it('holds a bookmark until it has a title, and an image needs none', () => {
    const bookmark = resolvePaste('files', { kind: 'url', url: 'https://x.example' });
    expect(pasteProblem(bookmark)).toBe('');
    bookmark.values.title = '  ';
    expect(pasteProblem(bookmark)).toContain('title');

    const image = resolvePaste('media', { kind: 'image', file: { type: 'image/png', size: 1 } });
    expect(pasteProblem(image)).toBe('');
  });

  it('refuses a typed source that is not an http(s) address', () => {
    const image = resolvePaste('media', { kind: 'image', file: { type: 'image/png', size: 1 } });
    image.values.source = 'not a url';
    expect(pasteProblem(image)).toContain('http(s)');
    image.values.source = 'https://example.com/x';
    expect(pasteProblem(image)).toBe('');
  });

  it('reads a host off an address, and nothing off a broken one', () => {
    expect(hostOf('https://a.b.example/c')).toBe('a.b.example');
    expect(hostOf('nonsense')).toBe('');
  });
});

describe('the window listener', () => {
  let off = null;
  afterEach(() => {
    off?.();
    off = null;
  });

  function paste(cd, target = document.body) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: cd });
    Object.defineProperty(event, 'target', { value: target });
    window.dispatchEvent(event);
    return event;
  }

  it('hands over what the clipboard held and keeps the browser out of it', () => {
    const seen = [];
    off = listenForPaste((payload) => seen.push(payload));
    const event = paste(clipboard({ text: 'https://example.com/x' }));
    expect(seen).toEqual([{ kind: 'url', url: 'https://example.com/x' }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a paste into a field alone', () => {
    // in a search box or a title input, Ctrl+V is the ordinary one
    const input = document.createElement('input');
    document.body.append(input);
    const seen = [];
    off = listenForPaste((payload) => seen.push(payload));
    const event = paste(clipboard({ text: 'https://example.com/x' }), input);
    expect(seen).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    input.remove();
  });

  it('stays quiet on an empty clipboard', () => {
    const seen = [];
    off = listenForPaste((payload) => seen.push(payload));
    const event = paste(clipboard());
    expect(seen).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops listening once torn down, which is what keeps hidden tabs quiet', () => {
    // every visited tool stays mounted behind the visible one, so the teardown is
    // the whole guard against four surfaces answering one Ctrl+V
    const seen = [];
    listenForPaste((payload) => seen.push(payload))();
    paste(clipboard({ text: 'https://example.com/x' }));
    expect(seen).toEqual([]);
  });

  it('reads an editable target through the node that was clicked', () => {
    const box = document.createElement('div');
    box.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    box.append(inner);
    document.body.append(box);
    expect(ignorePasteTarget(inner)).toBe(true);
    expect(ignorePasteTarget(document.body)).toBe(false);
    expect(ignorePasteTarget(undefined)).toBe(false);
    box.remove();
  });
});

describe('filing a pasted image', () => {
  beforeEach(() => api.post.mockClear());

  it('posts to the paste route with the title and the source typed beside it', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    await pasteImage('case-1', { file, title: '  Front gate  ', sourceUrl: ' https://e.example/x ' });
    const [path, form] = api.post.mock.calls[0];
    expect(path).toBe('/api/cases/case-1/media/paste');
    expect(form.get('file')).toBe(file);
    expect(form.get('title')).toBe('Front gate');
    expect(form.get('source_url')).toBe('https://e.example/x');
  });

  it('sends neither field when the analyst filled in nothing', async () => {
    await pasteImage('case-1', {
      file: new File([new Uint8Array([1])], 'image.png', { type: 'image/png' }),
    });
    const form = api.post.mock.calls[0][1];
    expect(form.has('title')).toBe(false);
    expect(form.has('source_url')).toBe(false);
  });
});
