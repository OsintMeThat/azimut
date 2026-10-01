import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axisZone, forgetAxisZone, learnAxisZone, noteAxisZone } from './caseAxis.svelte.js';

function memory(entries = {}) {
  const held = new Map(Object.entries(entries));
  return { getItem: (key) => (held.has(key) ? held.get(key) : null), setItem: (key, value) => held.set(key, value) };
}

const PLACES = {
  items: [
    { id: 'p1', label: 'Oceanside pier', attrs: { lat: 33.19, lon: -117.38 } },
    { id: 'p2', label: 'Oceanside bluff', attrs: { lat: 33.21, lon: -117.40 } },
    { id: 'p3', label: 'Tokyo office', attrs: { lat: 35.68, lon: 139.76 } },
    { id: 'p4', label: 'Nowhere yet', attrs: {} },
  ],
};
const lookup = async ({ lon }) => (lon > 100 ? 'Asia/Tokyo' : 'America/Los_Angeles');

beforeEach(() => forgetAxisZone());

describe('the clock a case is read on', () => {
  it('is UTC until the case says otherwise, and only for that case', () => {
    expect(axisZone('case-a')).toBe('UTC');
    noteAxisZone('case-a', 'America/Los_Angeles');
    expect(axisZone('case-a')).toBe('America/Los_Angeles');
    expect(axisZone('case-b')).toBe('UTC');
    // a zone this browser cannot read is never taken
    noteAxisZone('case-a', 'Mars/Olympus');
    expect(axisZone('case-a')).toBe('America/Los_Angeles');
  });

  it('opens on where most of the case’s places are, as the axis does', async () => {
    const get = vi.fn(async () => PLACES);
    await learnAxisZone('case-a', { get, lookup, storage: memory() });
    expect(axisZone('case-a')).toBe('America/Los_Angeles');
    expect(get.mock.calls[0][0]).toContain('type=place');
  });

  it('follows the clock kept for the case', async () => {
    const get = vi.fn(async () => PLACES);
    await learnAxisZone('case-a', { get, lookup, storage: memory({ 'azimut:timeline-clock:case-a': 'utc' }) });
    expect(axisZone('case-a')).toBe('UTC');
    expect(get).not.toHaveBeenCalled();

    forgetAxisZone();
    await learnAxisZone('case-a', { get, lookup, storage: memory({ 'azimut:timeline-clock:case-a': 'zone:Asia/Aden' }) });
    expect(axisZone('case-a')).toBe('Asia/Aden');

    forgetAxisZone();
    await learnAxisZone('case-a', { get, lookup, storage: memory({ 'azimut:timeline-clock:case-a': 'place:p3' }) });
    expect(axisZone('case-a')).toBe('Asia/Tokyo');
  });

  it('asks once, and leaves the Timeline’s word standing', async () => {
    let answer;
    const get = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
    const first = learnAxisZone('case-a', { get, lookup, storage: memory() });
    const second = learnAxisZone('case-a', { get, lookup, storage: memory() });
    noteAxisZone('case-a', 'Europe/Paris');
    answer(PLACES);
    await Promise.all([first, second]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(axisZone('case-a')).toBe('Europe/Paris');
  });

  it('stays on UTC when the places cannot be read', async () => {
    await learnAxisZone('case-a', { get: async () => { throw new Error('offline'); }, lookup, storage: memory() });
    expect(axisZone('case-a')).toBe('UTC');
  });
});
