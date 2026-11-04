// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get, post, put } }));
const { uiState } = await import('../../lib/state.svelte.js');
const { openNote, releaseNote, noteReady, resetOpenNotes } = await import('../../lib/notes/noteDoc.svelte.js');
const { default: NoteTasks } = await import('./NoteTasks.svelte');

let component;
let target;
afterEach(() => { if (component) unmount(component); target?.remove(); resetOpenNotes(); vi.clearAllMocks(); });

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  flushSync();
}

const TASKS = { items: [{ id: 'n1', title: 'Lead', folder: '', done: 0, tasks: [{ line: 0, text: 'Check the date' }] }] };

it('lists the notes’ open tasks, ticks one in its note, and opens the note on a task', async () => {
  get.mockImplementation(async (url) => (url.endsWith('/notes/tasks') ? TASKS : { text: '- [ ] Check the date\n' }));
  post.mockResolvedValue({ text: '- [x] Check the date\n' });
  // the note is also open in this tab: the tick lands on its copy too
  const copy = openNote('c1', 'n1');
  await noteReady(copy);
  target = document.createElement('div');
  document.body.append(target);
  component = mount(NoteTasks, { target, props: { caseId: 'c1' } });
  await settle();
  expect(target.textContent).toContain('In the notes');
  expect(target.textContent).toContain('Check the date');

  target.querySelector('input[type="checkbox"]').dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/n1/task', { line: 0, text: 'Check the date', done: true });
  expect(copy.text).toBe('- [x] Check the date\n');
  expect(put).not.toHaveBeenCalled();

  target.querySelector('button.text').click();
  expect(uiState.openNotebook).toEqual({ noteId: 'n1', line: 0 });
  await releaseNote(copy);
});

it('waits for the lists to be read before reading the notes', async () => {
  get.mockResolvedValue({ items: [] });
  target = document.createElement('div');
  document.body.append(target);
  component = mount(NoteTasks, { target, props: { caseId: 'c1', ready: false } });
  await settle();
  expect(get).not.toHaveBeenCalled();
});
