import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('./api.js', () => ({ api: { post: (...a) => post(...a) } }));

const { uploadFiles } = await import('./mediaImport.js');

const file = (name) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => post.mockReset());

describe('uploadFiles', () => {
  it('sends the stated origin with every file of the batch', async () => {
    post.mockResolvedValue({ duplicate: false, item: { path: 'media/a.png' }, entity: { id: 'e1' } });
    await uploadFiles('c1', [file('a.png'), file('b.png')], 'https://example.org/thread');
    expect(post).toHaveBeenCalledTimes(2);
    for (const [url, form] of post.mock.calls) {
      expect(url).toBe('/api/cases/c1/media/upload');
      expect(form.get('source_url')).toBe('https://example.org/thread');
    }
  });

  it('sends no origin when none was stated', async () => {
    post.mockResolvedValue({ duplicate: false, item: { path: 'media/a.png' }, entity: { id: 'e1' } });
    await uploadFiles('c1', [file('a.png')]);
    expect(post.mock.calls[0][1].has('source_url')).toBe(false);
  });

  it('keeps going past a refusal and says what landed, what was known, what failed', async () => {
    post
      .mockResolvedValueOnce({ duplicate: false, item: { path: 'media/a.png' }, entity: { id: 'e1' } })
      .mockResolvedValueOnce({ duplicate: true, item: { path: 'media/old.png' }, entity: { id: 'e0' } })
      .mockRejectedValueOnce(new Error('too large'))
      .mockResolvedValueOnce({ duplicate: false, item: { path: 'media/d.png' }, entity: { id: 'e4' } });
    const result = await uploadFiles('c1', ['a', 'b', 'c', 'd'].map((n) => file(`${n}.png`)));
    expect(result).toEqual({
      landed: ['media/a.png', 'media/d.png'],
      filed: [{ id: 'e1' }, { id: 'e4' }],
      duplicates: 1,
      failed: [{ name: 'c.png', message: 'too large' }],
    });
  });
});
