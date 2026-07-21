import { describe, expect, it, vi } from 'vitest';
import { createToolLoader } from './toolLoader.js';

describe('createToolLoader', () => {
  it('deduplicates concurrent imports and caches the component', async () => {
    const component = () => 'tool';
    const load = vi.fn(async () => ({ default: component }));
    const loader = createToolLoader({ media: load });

    const [first, second] = await Promise.all([loader.load('media'), loader.load('media')]);
    expect(first).toBe(component);
    expect(second).toBe(component);
    expect(loader.get('media')).toBe(component);
    expect(load).toHaveBeenCalledTimes(1);
    await loader.load('media');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('allows a failed import to be retried', async () => {
    const component = () => 'tool';
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('missing chunk'))
      .mockResolvedValueOnce({ default: component });
    const loader = createToolLoader({ media: load });

    await expect(loader.load('media')).rejects.toThrow('missing chunk');
    await expect(loader.load('media')).resolves.toBe(component);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
