import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get } }));

const { forgetMaps, mapSiteOf, quotePreview, tabHost } = await import('./panelTab.js');

/**
 * What the Add menu shows of the tab in front: its host, a preview of the words
 * selected, and whether it is a map, which the app asks of the server once an address.
 */

beforeEach(() => {
  forgetMaps();
  get.mockReset();
  get.mockImplementation(async (url) => {
    if (url === '/api/settings') return { ingest_token: 'pairing-token' };
    if (url.includes('google.com%2Fmaps')) return { site: 'google-maps', lat: 48.85, lon: 2.29 };
    return { site: null };
  });
});

describe('a tab\'s host', () => {
  it('is its host without www, or nothing for what is no address', () => {
    expect(tabHost('https://www.example.org/news/strike?a=1')).toBe('example.org');
    expect(tabHost('https://news.example.org/')).toBe('news.example.org');
    expect(tabHost('not an address')).toBe('');
    expect(tabHost('')).toBe('');
    expect(tabHost(undefined)).toBe('');
  });
});

describe('the words selected, shown short', () => {
  it('is on one line between quotes, cut at a word past 60 characters', () => {
    expect(quotePreview('Berths 10 to 14\n  were   closed.')).toBe('“Berths 10 to 14 were closed.”');
    const long = 'Berths 10 to 14 were closed on Tuesday after a strike hit the port overnight and the harbour authority said';
    expect(quotePreview(long)).toBe('“Berths 10 to 14 were closed on Tuesday after a strike hit…”');
    expect(quotePreview('x'.repeat(60))).toBe(`“${'x'.repeat(60)}”`);
    expect(quotePreview('')).toBe('');
    expect(quotePreview('  \n ')).toBe('');
    expect(quotePreview(undefined)).toBe('');
    // one long word has no place to be cut at
    expect(quotePreview('abcdefghij'.repeat(10))).toBe(`“${'abcdefghij'.repeat(6)}…”`);
  });
});

describe('whether the tab is a map', () => {
  const MAP = 'https://www.google.com/maps/@48.85,2.29,17z';

  it('is the site the server names, asked with the pairing token the app holds', async () => {
    expect(await mapSiteOf(MAP)).toBe('google-maps');
    expect(get).toHaveBeenCalledWith('/api/settings');
    expect(get).toHaveBeenCalledWith(`/api/ingest/parse?url=${encodeURIComponent(MAP)}`, { headers: { 'X-Azimut-Token': 'pairing-token' } });
  });

  it('is nothing for a page that is not a map', async () => {
    expect(await mapSiteOf('https://example.org/news')).toBeNull();
  });

  it('asks once for an address, and the token once for all', async () => {
    await Promise.all([mapSiteOf(MAP), mapSiteOf(MAP)]);
    await mapSiteOf(MAP);
    await mapSiteOf('https://example.org/news');
    await mapSiteOf('https://example.org/news');
    expect(get.mock.calls.filter(([url]) => url.startsWith('/api/ingest/parse'))).toHaveLength(2);
    expect(get.mock.calls.filter(([url]) => url === '/api/settings')).toHaveLength(1);
  });

  it('is nothing, and asked again next time, when the question could not be put', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/api/settings') return { ingest_token: 'pairing-token' };
      throw new Error('Azimut is not running');
    });
    expect(await mapSiteOf(MAP)).toBeNull();
    get.mockImplementation(async (url) => (url === '/api/settings' ? { ingest_token: 'pairing-token' } : { site: 'google-maps' }));
    expect(await mapSiteOf(MAP)).toBe('google-maps');
  });

  it('is nothing, and asked again later, while no pairing token is minted', async () => {
    get.mockImplementation(async (url) => (url === '/api/settings' ? { ingest_token: '' } : { site: 'google-maps' }));
    expect(await mapSiteOf(MAP)).toBeNull();
    expect(get.mock.calls.some(([url]) => url.startsWith('/api/ingest/parse'))).toBe(false);
    get.mockImplementation(async (url) => (url === '/api/settings' ? { ingest_token: 'pairing-token' } : { site: 'google-maps' }));
    expect(await mapSiteOf(MAP)).toBe('google-maps');
  });

  it('takes an answer with no site, or a site that is no word, for nothing', async () => {
    get.mockImplementation(async (url) => (url === '/api/settings' ? { ingest_token: 't' } : { site: 7 }));
    expect(await mapSiteOf('https://a.example/')).toBeNull();
    get.mockImplementation(async (url) => (url === '/api/settings' ? { ingest_token: 't' } : null));
    expect(await mapSiteOf('https://b.example/')).toBeNull();
  });
});
