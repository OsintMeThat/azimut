import { describe, expect, it, vi } from 'vitest';
import { caseZone, caseZoneWords, clockReading, rememberClock, rememberedClock } from './caseClock.js';

const place = (label, lat, lon) => ({ id: label, label, lat, lon });

function memory() {
  const held = new Map();
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, String(value)),
    removeItem: (key) => held.delete(key),
    held,
  };
}

describe('the clock a case opens on', () => {
  it('takes the zone most of its places stand in, and says how many', async () => {
    const lookup = vi.fn(async ({ lon }) => (lon > 44 ? 'Asia/Aden' : 'Africa/Djibouti'));
    const found = await caseZone(
      [place('Sanaa', 15.35, 44.2), place('Marib', 15.46, 45.32), place('Djibouti', 11.59, 43.14)],
      { lookup }
    );
    expect(found).toMatchObject({ zone: 'Asia/Aden', count: 2, of: 3, places: ['Sanaa', 'Marib'] });
    expect(caseZoneWords(found)).toBe('2 of 3 places');
    expect(caseZoneWords({ ...found, count: 3 })).toBe("the case's places");
  });

  it('asks once for places a kilometre apart', async () => {
    const lookup = vi.fn(async () => 'Asia/Aden');
    const found = await caseZone(
      [place('Gate', 15.3501, 44.2001), place('Square', 15.3503, 44.2004)],
      { lookup }
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(found).toMatchObject({ count: 2, of: 2 });
  });

  it('stays on UTC with no placed point, or none that could be read', async () => {
    expect(await caseZone([], { lookup: vi.fn() })).toBeNull();
    expect(await caseZone([{ id: 'x', label: 'Nowhere' }], { lookup: vi.fn() })).toBeNull();
    expect(await caseZone([place('Sea', 10, 50)], { lookup: async () => '' })).toBeNull();
    expect(await caseZone([place('Sea', 10, 50)], { lookup: async () => { throw new Error('down'); } })).toBeNull();
  });

  it('keeps the clock picked per case, and forgets it on the default', () => {
    const storage = memory();
    expect(rememberedClock('case-a', storage)).toBe('case');
    rememberClock('case-a', 'utc', storage);
    expect(rememberedClock('case-a', storage)).toBe('utc');
    expect(rememberedClock('case-b', storage)).toBe('case');
    rememberClock('case-a', 'zone:../../etc', storage);
    expect(rememberedClock('case-a', storage)).toBe('utc');
    rememberClock('case-a', 'case', storage);
    expect(storage.held.size).toBe(0);
    // a value nobody could have written reads as the default
    storage.setItem('azimut:timeline-clock:case-c', 'garbage');
    expect(rememberedClock('case-c', storage)).toBe('case');
  });

  it('writes an instant on the axis clock the way the Timeline writes dates', () => {
    // a camera's 17:07:16 UTC in Sanaa was 20:07:16 there
    expect(clockReading('2023-06-22T17:07:16.000000Z', 'Asia/Aden')).toBe('22 Jun 2023, 20:07:16 Aden time');
    expect(clockReading('2024-01-05T23:30:00Z', 'America/New_York')).toBe('5 Jan 2024, 18:30:00 New York time');
    // under a heading that already names the clock
    expect(clockReading('2023-06-22T17:07:16Z', 'Asia/Aden', { named: false })).toBe('22 Jun 2023, 20:07:16');
    expect(clockReading('', 'Asia/Aden')).toBe('');
    expect(clockReading('2023-06-22T17:07:16Z', '')).toBe('');
  });
});
