import { describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() } }));

const { citeOffer, freshCapture, panelOffer, pictureOffer, quoteMarkdown, quoteOffer, FRESH_CAPTURE_MS } = await import('./panelPuts.js');

/**
 * What the extension's panel puts in a note, built in the app from the facts it is
 * sent: the page cited, a passage quoted and linked to itself, a capture shown. The
 * page is looked up in the case first and kept as a bookmark only when it is not
 * there; nothing is fetched.
 */

const URL_ = 'https://example.org/news/strike';
const BOOKMARK = { id: 'b_new', type: 'bookmark', label: 'Strike on the port', attrs: { url: URL_ } };

function deps({ found = [], title = 'example.org/news/strike' } = {}) {
  return {
    lookup: vi.fn(async (_case, url) => ({ url, title, found })),
    make: vi.fn(async (_case, { title: label, url }) => ({ ...BOOKMARK, label, attrs: { url } })),
    reload: vi.fn(async () => {}),
  };
}

describe('Cite', () => {
  it('cites the item the case already holds for the page, filing nothing', async () => {
    const held = { id: 'm1', type: 'media', label: 'Post by @port_watch on X', attrs: {} };
    const made = deps({ found: [held] });
    const result = await citeOffer('c1', { url: URL_, title: 'Port Watch: smoke' }, made).put();
    expect(result).toEqual({ text: '[[entity:m1|Post by @port_watch on X]]', inline: true, filed: [] });
    expect(made.lookup).toHaveBeenCalledWith('c1', URL_, { title: 'Port Watch: smoke' });
    expect(made.make).not.toHaveBeenCalled();
  });

  it('keeps a page the case does not hold as a bookmark named as the lookup names it, which Undo trashes', async () => {
    const made = deps({ title: 'Strike on the port' });
    const result = await citeOffer('c1', { url: URL_, title: 'Strike on the port' }, made).put();
    expect(made.make).toHaveBeenCalledWith('c1', { title: 'Strike on the port', url: URL_ });
    expect(made.reload).toHaveBeenCalled();
    expect(result).toEqual({ text: '[[entity:b_new|Strike on the port]]', inline: true, filed: ['b_new'] });
  });
});

describe('Quote', () => {
  it('writes the words as a link to the passage, then the page\'s chip', async () => {
    const made = deps({ title: 'Strike on the port' });
    const result = await quoteOffer('c1', { url: URL_, title: 'Strike on the port', text: 'Berths 10 to 14\nwere closed.' }, made).put();
    expect(result.text).toBe(
      `> [“Berths 10 to 14 were closed.”](${URL_}#:~:text=Berths%2010%20to%2014,were%20closed.) [[entity:b_new|Strike on the port]]`,
    );
    expect(result.filed).toEqual(['b_new']);
    expect(result.inline).toBeUndefined();
  });

  it('escapes Markdown marks as Quote the post does, so the words read as they were', () => {
    const text = quoteMarkdown({ url: URL_, text: '*Breaking* [update] `code` <b> a_b # not a heading' });
    expect(text).toBe(`> [“\\*Breaking\\* \\[update\\] \\\`code\\\` \\<b> a_b # not a heading”](${URL_}#:~:text=%2ABreaking%2A%20%5Bupdate%5D%20%60code%60%20%3Cb%3E%20a_b%20%23%20not%20a%20heading)`);
  });

  it('cuts the words past a thousand characters with a mark, and still links the whole passage', () => {
    const words = Array.from({ length: 300 }, (_, at) => `word${at}`).join(' ');
    const text = quoteMarkdown({ url: URL_, text: words, record: BOOKMARK });
    const said = text.slice(text.indexOf('“') + 1, text.indexOf('”'));
    expect(said.endsWith(' \\[…\\]')).toBe(true);
    expect(said.length).toBeLessThanOrEqual(1000 + ' \\[…\\]'.length);
    expect(text).toContain('#:~:text=word0%20word1%20word2%20word3%20word4,word295%20word296%20word297%20word298%20word299)');
  });

  it('keeps a link whole when its address holds a parenthesis', () => {
    expect(quoteMarkdown({ url: 'https://en.wikipedia.org/wiki/Port_(city)', text: 'a port' }))
      .toBe('> [“a port”](https://en.wikipedia.org/wiki/Port_(city)#:~:text=a%20port)');
    expect(quoteMarkdown({ url: 'https://example.org/a)b', text: 'x' }))
      .toBe('> [“x”](https://example.org/a%29b#:~:text=x)');
  });
});

describe('Capture into the note', () => {
  const NOW = Date.parse('2026-11-05T10:00:00Z');
  const capture = (fields = {}) => ({
    id: 'e_cap', type: 'capture', label: 'example.org: Strike', attrs: { path: 'captures/shot.png' },
    provenance: { by: 'ingest', at: '2026-11-05T09:58:00Z', status: 'confirmed' }, ...fields,
  });

  it('shows the capture as a picture, which Undo trashes when the extension filed it a moment ago', async () => {
    const get = vi.fn(async () => ({ entity: capture() }));
    const reload = vi.fn(async () => {});
    const offer = pictureOffer('c1', { entityId: 'e_cap' }, { get, reload, now: () => NOW });
    expect(offer.picture).toBe(true);
    expect(await offer.put()).toEqual({ text: '[[media:e_cap|example.org: Strike]]', filed: ['e_cap'] });
    expect(get).toHaveBeenCalledWith('/api/cases/c1/entities/e_cap/chain');
    expect(reload).toHaveBeenCalled();
  });

  it('never trashes on Undo a record it did not see filed just now', async () => {
    for (const older of [
      capture({ provenance: { by: 'ingest', at: '2026-11-05T09:40:00Z' } }),
      capture({ provenance: { by: 'user', at: '2026-11-05T09:59:00Z' } }),
      capture({ type: 'media' }),
    ]) {
      const result = await pictureOffer('c1', { entityId: 'e_cap' }, { get: async () => ({ entity: older }), reload: async () => {}, now: () => NOW }).put();
      expect(result.filed).toEqual([]);
    }
    expect(freshCapture(capture(), NOW + FRESH_CAPTURE_MS + 1)).toBe(false);
  });

  it('refuses a record that is not a picture of this case', async () => {
    const offer = (get) => pictureOffer('c1', { entityId: 'e_x' }, { get, reload: async () => {}, now: () => NOW });
    await expect(offer(async () => { throw new Error('404'); }).put()).rejects.toThrow('That capture is not in this case');
    await expect(offer(async () => ({ entity: { id: 'p1', type: 'place', attrs: {} } })).put()).rejects.toThrow('not in this case');
  });
});

describe('the offer for a put', () => {
  it('follows its action', () => {
    expect(panelOffer('c1', { action: 'cite', url: URL_ }).id).toBe('cite');
    expect(panelOffer('c1', { action: 'quote', url: URL_, text: 'x' }).id).toBe('quote');
    expect(panelOffer('c1', { action: 'picture', entityId: 'e1' }).id).toBe('picture');
    expect(panelOffer('c1', { action: 'other' })).toBeNull();
  });
});
