import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireKey } from './fireKey.svelte.js';

afterEach(() => vi.useRealTimers());

describe('whether the fire layer can be used', () => {
  it('reads the sensors and the key from our own backend', async () => {
    const api = { get: vi.fn(async () => ({ sensors: [{ id: 'viirs' }], keyed: true, state: 'ok', paused: null })) };
    const key = createFireKey({ api });
    await key.load();
    expect(api.get).toHaveBeenCalledWith('/api/firms/sensors');
    expect(key.keyed).toBe(true);
    expect(key.sensors).toEqual([{ id: 'viirs' }]);
  });

  it('stays locked when the backend cannot say', async () => {
    const key = createFireKey({ api: { get: vi.fn(async () => { throw new Error('down'); }) } });
    await key.load();
    expect(key.keyed).toBe(false);
    expect(key.state).toBe('missing');
  });

  it('asks again once a spent allowance’s pause is over, and not before', async () => {
    vi.useFakeTimers();
    const until = new Date(Date.now() + 60_000).toISOString();
    const api = { get: vi.fn(async () => ({ sensors: [], keyed: true, paused: { until } })) };
    const key = createFireKey({ api });
    await key.load();
    expect(key.paused).toEqual({ until });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(api.get).toHaveBeenCalledTimes(2);
    key.destroy();
  });

  it('asks once for a burst of failed tiles', async () => {
    vi.useFakeTimers();
    const api = { get: vi.fn(async () => ({ sensors: [], keyed: true })) };
    const key = createFireKey({ api });
    key.trouble();
    key.trouble();
    key.trouble();
    await vi.advanceTimersByTimeAsync(900);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
