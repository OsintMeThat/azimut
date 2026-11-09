// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The nudge toward scenes, kept in this browser, or for the session when it keeps nothing. */

async function fresh() {
  vi.resetModules();
  return import('./sceneHints.js');
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the To-do named once', () => {
  it('is due until it was given, then never again in this browser', async () => {
    const first = await fresh();
    expect(first.todoHintDue()).toBe(true);
    first.todoHintGiven();
    expect(first.todoHintDue()).toBe(false);
    const next = await fresh();
    expect(next.todoHintDue()).toBe(false);
  });

  it('is given once for the session when the browser keeps nothing', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { todoHintDue, todoHintGiven } = await fresh();
    expect(todoHintDue()).toBe(true);
    todoHintGiven();
    expect(todoHintDue()).toBe(false);
  });
});

describe('where the first scene kept points', () => {
  it('at the toggle while the sidebar is closed, its To-do tab while it shows another view', async () => {
    const { todoHintAt } = await fresh();
    expect(todoHintAt(false, 'folders')).toBe('toggle');
    expect(todoHintAt(false, 'todo')).toBe('toggle');
    expect(todoHintAt(true, 'folders')).toBe('tab');
    expect(todoHintAt(true, 'recent')).toBe('tab');
  });

  it('nowhere while the To-do is on screen, where the scene shows up by itself', async () => {
    const { todoHintAt } = await fresh();
    expect(todoHintAt(true, 'todo')).toBeNull();
  });
});
