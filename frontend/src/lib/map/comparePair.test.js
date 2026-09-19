import { describe, expect, it, vi } from 'vitest';
import { comparePair, sentinelPair, sentinelWindow, waybackPair } from './comparePair.js';

const api = (answers) => ({
  get: vi.fn(async (url) => {
    for (const [fragment, answer] of Object.entries(answers)) {
      if (url.includes(fragment)) return answer;
    }
    throw new Error(`unexpected request: ${url}`);
  }),
});

describe('two pictures of one point', () => {
  it('takes the last two Wayback releases that changed it, older as A', async () => {
    const client = api({
      '/wayback/changes': {
        changes: [
          { release: 55, acquired: '2025-02-20', source: 'Maxar' },
          { release: 41, acquired: '2023-06-11', source: 'Maxar' },
          { release: 12, acquired: '2019-01-02', source: 'Maxar' },
        ],
      },
    });
    const pair = await waybackPair(client, { lat: 33.2597, lon: -117.4365, zoom: 16.4 });
    expect(client.get.mock.calls[0][0]).toContain('zoom=16');
    expect(pair.a).toEqual({ provider: 'esri-wayback', wayback_release: 41, present: true });
    expect(pair.b).toEqual({ provider: 'esri-wayback', wayback_release: 55, present: true });
    expect(pair.dates).toEqual(['2023-06-11', '2025-02-20']);
  });

  it('says so when the archive holds nothing to compare', async () => {
    await expect(
      waybackPair(api({ '/wayback/changes': { changes: [{ release: 55, acquired: '2025-02-20' }] } }), {
        lat: 1, lon: 2, zoom: 16,
      })
    ).rejects.toThrow(/one picture of this point/);
    await expect(
      waybackPair(api({ '/wayback/changes': { changes: [] } }), { lat: 1, lon: 2, zoom: 16 })
    ).rejects.toThrow(/no dated picture/);
  });

  it('takes the last two Copernicus passes, older as A, cloud and all', async () => {
    const client = api({
      '/sentinel/dates': {
        dates: [
          { date: '2026-09-11', cloud: 62, granules: 1 },
          { date: '2026-09-06', cloud: 4, granules: 2 },
        ],
      },
    });
    const pair = await sentinelPair(client, { lat: 33.2597, lon: -117.4365 }, new Date('2026-09-18T10:00:00Z'));
    expect(client.get.mock.calls[0][0]).toContain('start=2026-03-22&end=2026-09-18');
    expect(pair.a.sentinel.date).toBe('2026-09-06');
    expect(pair.b.sentinel.date).toBe('2026-09-11');
    expect(pair.a.provider).toBe('sentinel2');
    expect(pair.a.sentinel.maxcc).toBe(100);
  });

  it('says so when six months hold fewer than two passes', async () => {
    await expect(
      sentinelPair(api({ '/sentinel/dates': { dates: [{ date: '2026-09-11' }] } }), { lat: 1, lon: 2 })
    ).rejects.toThrow(/one pass over this point/);
  });

  it('asks the archive the choice named, and nothing else', async () => {
    const client = api({ '/wayback/changes': { changes: [] } });
    await expect(comparePair(client, 'nonsense', { lat: 1, lon: 2, zoom: 16 })).rejects.toThrow(/unknown/);
    expect(client.get).not.toHaveBeenCalled();
  });
});

describe('the Copernicus window', () => {
  it('ends today and reaches half a year back', () => {
    expect(sentinelWindow(new Date('2026-01-10T00:00:00Z'))).toEqual({
      start: '2025-07-14',
      end: '2026-01-10',
    });
  });
});
