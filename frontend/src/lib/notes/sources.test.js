import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A web source for a note: what the case already holds is cited, a bookmark is named
 * from its address with nothing fetched, and only Download reaches the network.
 */

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../state.svelte.js', () => ({ reloadCase: vi.fn(async () => {}) }));

const {
  QUOTE_MAX, bookmarkOffer, canStateSourceOf, citeOffer, downloadOffer, forgetSourceable, lookupSource, quoteOffer, quotePost,
  sourceAddress, statePostedOf, stateSourceOf,
} = await import('./sources.js');

afterEach(() => forgetSourceable());

describe('a link looked up in the case', () => {
  it('is asked of the case by its address', async () => {
    const get = vi.fn(async () => ({ url: 'u', title: 't', found: [] }));
    await lookupSource('c1', 'https://x.com/a/status/1?s=20', { get });
    expect(get).toHaveBeenCalledWith('/api/cases/c1/sources/lookup?url=https%3A%2F%2Fx.com%2Fa%2Fstatus%2F1%3Fs%3D20');
  });

  it('passes on the title a page gave itself, which names it when its address says nothing better', async () => {
    const get = vi.fn(async () => ({ url: 'u', title: 't', found: [] }));
    await lookupSource('c1', 'https://example.org/a', { get, title: 'Strike & port' });
    expect(get).toHaveBeenCalledWith('/api/cases/c1/sources/lookup?url=https%3A%2F%2Fexample.org%2Fa&title=Strike+%26+port');
  });

  it('is only read when it is an address', () => {
    expect(sourceAddress('  https://t.me/port/4 ')).toBe('https://t.me/port/4');
    expect(sourceAddress('t.me/port/4')).toBeNull();
    expect(sourceAddress('javascript:alert(1)')).toBeNull();
  });
});

describe('what a source puts in the note', () => {
  it('cites what the case holds, in the line', async () => {
    const offer = citeOffer({ id: 'm1', label: 'clip.mp4', type: 'media' });
    expect(offer.label).toBe('Cite “clip.mp4”');
    expect(await offer.put()).toEqual({ text: '[[entity:m1|clip.mp4]]', inline: true });
  });

  it('keeps a bookmark named from the address, filed only for this note', async () => {
    const make = vi.fn(async (_case, { title }) => ({ id: 'b1', label: title }));
    const reload = vi.fn();
    const offer = bookmarkOffer('c1', { url: 'https://x.com/port_watch/status/9', title: 'Post by @port_watch on X' }, { make, reload });
    expect(await offer.put()).toEqual({ text: '[[entity:b1|Post by @port_watch on X]]', inline: true, filed: ['b1'] });
    expect(make).toHaveBeenCalledWith('c1', { title: 'Post by @port_watch on X', url: 'https://x.com/port_watch/status/9' });
    expect(reload).toHaveBeenCalled();
  });

  it('downloads the post when pressed, and cites the file it filed', async () => {
    const post = vi.fn(async () => ({ job_id: 'j1' }));
    const answers = [{ status: 'running' }, { status: 'done', result: { entity: { id: 'm9', label: 'clip.mp4' } } }];
    const get = vi.fn(async () => answers.shift());
    const offer = downloadOffer('c1', 'https://t.me/port/4', { post, get, reload: vi.fn(), wait: 0 });
    expect(offer.busy).toBe('Downloading the post…');
    expect(await offer.put({ signal: new AbortController().signal })).toEqual({ text: '[[entity:m9|clip.mp4]]', inline: true, filed: ['m9'] });
    expect(post).toHaveBeenCalledWith('/api/cases/c1/media/download', { url: 'https://t.me/port/4', index: null, title: null, use_cookies: false });
  });

  it('cites a file the case already held without filing it again', async () => {
    const offer = downloadOffer('c1', 'https://t.me/port/4', {
      post: async () => ({ job_id: 'j1' }),
      get: async () => ({ status: 'done', result: { duplicate: true, entity: { id: 'm1', label: 'old.mp4' } } }),
      reload: vi.fn(),
      wait: 0,
    });
    expect((await offer.put({})).filed).toEqual([]);
  });

  it('sends a post Media has to ask about back to Media', async () => {
    const offer = downloadOffer('c1', 'https://x.com/a/status/1', {
      post: async () => ({ job_id: 'j1' }),
      get: async () => ({ status: 'done', result: { multi: true, items: [] } }),
      wait: 0,
    });
    await expect(offer.put({})).rejects.toThrow('This post holds several files. Download it from Media to pick them');
  });

  it('says why a download failed', async () => {
    const offer = downloadOffer('c1', 'https://x.com/a/status/1', {
      post: async () => ({ job_id: 'j1' }), get: async () => ({ status: 'error', error: 'HTTP 404' }), wait: 0,
    });
    await expect(offer.put({})).rejects.toThrow('Download failed: HTTP 404');
  });

  it('stops asking once cancelled', async () => {
    const controller = new AbortController();
    const get = vi.fn(async () => { controller.abort(); return { status: 'running' }; });
    const offer = downloadOffer('c1', 'https://x.com/a/status/1', { post: async () => ({ job_id: 'j1' }), get, wait: 0 });
    await expect(offer.put({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(get).toHaveBeenCalledOnce();
  });
});

describe('a picture’s stated source', () => {
  const upload = { id: 'm1', type: 'media', label: 'shot', attrs: { path: 'media/shot.png', kind: 'image' } };
  const frame = { id: 'm2', type: 'media', label: 'frame', attrs: { path: 'media/frame.png', kind: 'image' } };

  it('is asked of every picture drawn at once, in one request', async () => {
    const post = vi.fn(async () => [
      { path: 'media/shot.png', source: { type: 'clipboard' } },
      { path: 'media/frame.png', source: { type: 'inspect', from: 'media/clip.mp4' } },
    ]);
    const answers = await Promise.all([canStateSourceOf('c1', upload, { post }), canStateSourceOf('c1', frame, { post })]);
    expect(answers).toEqual([true, false]);
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/api/cases/c1/media/metadata', { paths: ['media/shot.png', 'media/frame.png'] });
    // and kept, until the case changes
    expect(await canStateSourceOf('c1', upload, { post })).toBe(true);
    expect(post).toHaveBeenCalledOnce();
  });

  it('is never offered for a capture, a video or a file that names its source', async () => {
    const post = vi.fn();
    expect(await canStateSourceOf('c1', { ...upload, type: 'capture' }, { post })).toBe(false);
    expect(await canStateSourceOf('c1', { ...upload, attrs: { ...upload.attrs, kind: 'video' } }, { post })).toBe(false);
    expect(await canStateSourceOf('c1', { ...upload, attrs: { ...upload.attrs, source_url: 'https://a.b/c' } }, { post })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('is written as stated, and refused when it is not an address', async () => {
    const patch = vi.fn(async () => ({}));
    const reload = vi.fn();
    await stateSourceOf('c1', upload, ' https://t.me/port/4 ', { patch, reload });
    expect(patch).toHaveBeenCalledWith('/api/cases/c1/media', { path: 'media/shot.png', source_url: 'https://t.me/port/4' });
    expect(reload).toHaveBeenCalled();
    await expect(stateSourceOf('c1', upload, 'a friend', { patch, reload })).rejects.toThrow('The source must be an http(s) address.');
  });
});

describe('where a proof was posted', () => {
  it('is kept on the proof, taken off when emptied, and refused when it is not an address', async () => {
    const patch = vi.fn(async () => ({}));
    const reload = vi.fn();
    const proof = { id: 'p28', type: 'proof', attrs: { path: 'proofs/28.png' } };
    await statePostedOf('c1', proof, ' https://x.com/me/status/1 ', { patch, reload });
    expect(patch).toHaveBeenCalledWith('/api/cases/c1/entities/p28', { attrs: { posted_url: 'https://x.com/me/status/1' } });
    expect(reload).toHaveBeenCalledTimes(1);
    await statePostedOf('c1', proof, '', { patch, reload });
    expect(patch).toHaveBeenLastCalledWith('/api/cases/c1/entities/p28', { attrs: { posted_url: '' } });
    await expect(statePostedOf('c1', proof, 'my post', { patch, reload })).rejects.toThrow('http(s)');
    expect(patch).toHaveBeenCalledTimes(2);
  });
});

describe('a post, quoted', () => {
  const clip = { id: 'm1', label: 'clip.mp4' };
  const download = (source) => ({ path: 'media/clip.mp4', source: { type: 'download', ...source } });

  it('gives its words as posted, the account the address names, the day and the file', () => {
    const text = quotePost(download({
      url: 'https://x.com/port_watch/status/9', description: 'Smoke over the port this morning', uploader: 'Port Watch', upload_date: '20260312',
    }), clip);
    expect(text).toBe('> "Smoke over the port this morning" (@port_watch, 12 Mar 2026) [[entity:m1|clip.mp4]]');
  });

  it('keeps the post’s lines, and its words from being read as Markdown', () => {
    const text = quotePost(download({ url: 'https://example.org/v/1', description: '# Breaking\n\n*two* [blasts]', uploader: 'Harbour TV' }), clip);
    expect(text.split('\n')).toEqual([
      '> "\\# Breaking',
      '>',
      '> \\*two\\* \\[blasts\\]" (Harbour TV) [[entity:m1|clip.mp4]]',
    ]);
  });

  it('says where a long post was cut', () => {
    const text = quotePost(download({ url: 'https://t.me/port/4', description: 'word '.repeat(400) }), clip);
    expect(text.length).toBeLessThan(QUOTE_MAX + 80);
    expect(text).toContain(' […]" (@port) [[entity:m1|clip.mp4]]');
  });

  it('is offered only when the download kept the post’s words', () => {
    expect(quoteOffer(download({ url: 'https://t.me/port/4', description: '' }), clip)).toBeNull();
    expect(quoteOffer({ source: { type: 'upload', description: 'typed' } }, clip)).toBeNull();
    const offer = quoteOffer(download({ url: 'https://t.me/port/4', description: 'Seen' }), clip);
    expect(offer).toMatchObject({ id: 'quote', label: 'Quote the post' });
  });
});
