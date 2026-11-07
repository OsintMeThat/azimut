// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The two nudges toward scenes, kept in this browser, or for the session when it keeps nothing. */

async function fresh() {
  vi.resetModules();
  return import('./sceneHints.js');
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the strip\'s invitation', () => {
  it('asks until Not now, per file and per case, across sessions', async () => {
    const first = await fresh();
    expect(first.inviteDeclined('case-a', 'media/clip.mp4')).toBe(false);
    first.declineInvite('case-a', 'media/clip.mp4');
    expect(first.inviteDeclined('case-a', 'media/clip.mp4')).toBe(true);
    expect(first.inviteDeclined('case-a', 'media/other.mp4')).toBe(false);
    expect(first.inviteDeclined('case-b', 'media/clip.mp4')).toBe(false);

    const next = await fresh();
    expect(next.inviteDeclined('case-a', 'media/clip.mp4')).toBe(true);
  });

  it('keeps a bounded list, the oldest going first', async () => {
    const { DECLINED_MAX, declineInvite, inviteDeclined } = await fresh();
    for (let i = 0; i <= DECLINED_MAX; i += 1) declineInvite('case-a', `media/${i}.mp4`);
    expect(JSON.parse(localStorage.getItem('azimut:sceneInviteDeclined'))).toHaveLength(DECLINED_MAX);
    const next = await fresh();
    expect(next.inviteDeclined('case-a', 'media/0.mp4')).toBe(false);
    expect(next.inviteDeclined('case-a', `media/${DECLINED_MAX}.mp4`)).toBe(true);
    expect(inviteDeclined('case-a', 'media/0.mp4')).toBe(true); // this session still knows
  });

  it('holds its word for the session when the browser keeps nothing, and survives a broken list', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { declineInvite, inviteDeclined } = await fresh();
    expect(() => declineInvite('case-a', 'media/clip.mp4')).not.toThrow();
    expect(inviteDeclined('case-a', 'media/clip.mp4')).toBe(true);

    vi.restoreAllMocks();
    localStorage.setItem('azimut:sceneInviteDeclined', 'not json');
    const broken = await fresh();
    expect(broken.inviteDeclined('case-a', 'media/clip.mp4')).toBe(false);
    localStorage.setItem('azimut:sceneInviteDeclined', '{"a":1}');
    expect(broken.inviteDeclined('case-a', 'media/clip.mp4')).toBe(false);
  });
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
