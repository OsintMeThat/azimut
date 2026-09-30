import { describe, expect, it, vi } from 'vitest';
import { fetchFileDates, fileDateWords } from './fileDates.js';

const row = (kind, raw, owner = 'm1') => ({ owner_id: owner, kind, raw, category: 'media' });

describe('what a file says about its dates', () => {
  it('names what each date is, the camera first', () => {
    expect(
      fileDateWords([row('published', '2026-03-14'), row('captured', '2026-03-12T14:02:00Z')], 'm1')
    ).toBe('captured 12 Mar 2026, 14:02:00 UTC · published 14 Mar 2026');
  });

  it('reads a camera clock to the second', () => {
    expect(fileDateWords([row('captured', '2023-06-22T17:07:16.000000Z')], 'm1')).toBe(
      'captured 22 Jun 2023, 17:07:16 UTC'
    );
  });

  it('leaves out when the analyst had the file, and dates owned by something else', () => {
    expect(
      fileDateWords([row('collected', '2026-08-01'), row('added', '2026-08-01'), row('imagery', '2026-03-11', 'other')], 'm1')
    ).toBe('');
  });

  it('reads the file’s own rows off the Timeline projection', async () => {
    const get = vi.fn(async () => ({ items: [row('imagery', '2026-03-11')] }));
    expect(await fetchFileDates('case-a', 'm1', { get })).toBe('imagery 11 Mar 2026');
    expect(get.mock.calls[0][0]).toContain('/api/cases/case-a/timeline?entity=m1');
    expect(get.mock.calls[0][0]).toContain('category=media');
  });
});
