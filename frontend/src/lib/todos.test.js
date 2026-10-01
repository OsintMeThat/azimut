import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const put = vi.fn();
vi.mock('./api.js', () => ({ api: { get: (...a) => get(...a), put: (...a) => put(...a) } }));

const { loadTodos, saveTodos, todos } = await import('./todos.svelte.js');

const lists = [{ id: 'default', name: 'Tasks', tasks: [] }];

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  Object.assign(todos, { caseId: null, data: null, busy: false, error: '', conflict: false });
});

describe('the shared to-do copy', () => {
  it('is read once for every surface showing it', async () => {
    get.mockResolvedValue({ revision: 3, lists });
    await loadTodos('c1');
    expect(get).toHaveBeenCalledWith('/api/cases/c1/todos');
    expect(todos).toMatchObject({ caseId: 'c1', data: { revision: 3 }, busy: false });
  });

  it('saves at the revision it read, and keeps what the server answered', async () => {
    get.mockResolvedValue({ revision: 3, lists });
    put.mockImplementation(async (_url, body) => ({ ...body, revision: body.revision + 1 }));
    await loadTodos('c1');
    expect(await saveTodos('c1', [])).toBe(true);
    expect(put).toHaveBeenCalledWith('/api/cases/c1/todos', { revision: 3, lists: [] });
    expect(todos.data.revision).toBe(4);
  });

  it('stops writing after a newer revision refused it, until read again', async () => {
    get.mockResolvedValue({ revision: 3, lists });
    put.mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 409 }));
    await loadTodos('c1');
    expect(await saveTodos('c1', [])).toBe(false);
    expect(todos.conflict).toBe(true);
    expect(await saveTodos('c1', [])).toBe(false);
    expect(put).toHaveBeenCalledTimes(1);
    await loadTodos('c1');
    expect(todos.conflict).toBe(false);
  });

  it('drops the previous case and never saves into the wrong one', async () => {
    get.mockResolvedValueOnce({ revision: 1, lists });
    await loadTodos('c1');
    get.mockReturnValueOnce(new Promise(() => {}));
    void loadTodos('c2');
    expect(todos.data).toBeNull();
    expect(await saveTodos('c1', [])).toBe(false);
  });
});
