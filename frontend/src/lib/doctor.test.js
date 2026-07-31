import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('./api.js', () => ({ api: { get, post } }));

const { checkCase, repairCase } = await import('./doctor.js');

describe('Case Doctor API', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('encodes case ids in diagnostic and repair paths', async () => {
    get.mockResolvedValue({ status: 'healthy' });
    post.mockResolvedValue({ report: { status: 'healthy' } });

    await checkCase('scratch / 1');
    await repairCase('scratch / 1', { action: 'rebuild' });

    expect(get).toHaveBeenCalledWith('/api/cases/scratch%20%2F%201/doctor');
    expect(post).toHaveBeenCalledWith('/api/cases/scratch%20%2F%201/doctor/repair', {
      action: 'rebuild',
    });
  });
});
