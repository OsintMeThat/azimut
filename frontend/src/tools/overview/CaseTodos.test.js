// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get, put } }));
import CaseTodos from './CaseTodos.svelte';
let component;
let target;
const initial = () => ({ revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] });
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flushSync();
}
async function open(data = initial()) {
  get.mockResolvedValue(data);
  put.mockImplementation(async (_url, body) => ({ ...body, revision: body.revision + 1 }));
  target = document.createElement('div');
  document.body.append(target);
  component = mount(CaseTodos, { target, props: { caseId: 'case-a' } });
  flushSync();
  await settle();
}
const input = (label) => target.querySelector(`input[aria-label="${label}"]`);
const button = (label) => target.querySelector(`button[aria-label="${label}"]`);
async function type(label, value) {
  input(label).value = value;
  input(label).dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}
async function submit(label) {
  input(label).closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}
afterEach(async () => { if (component) await unmount(component); target?.remove(); vi.clearAllMocks(); });

it('adds, edits, checks, unchecks and deletes a task with persisted counters', async () => {
  await open();
  await type('New task', 'Check image');
  await submit('New task');
  expect(target.textContent).toContain('0/1');
  expect(input('New task').value).toBe('');
  input('Task text').value = 'Check source';
  input('Task text').dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const checkbox = () => target.querySelector('input[type="checkbox"]');
  checkbox().click(); await settle();
  expect(target.textContent).toContain('1/1');
  expect(input('Task text').classList.contains('done')).toBe(true);
  checkbox().click(); await settle();
  expect(target.textContent).toContain('0/1');
  button('Delete Check source').click(); await settle();
  expect(target.textContent).toContain('0/0');
  expect(put).toHaveBeenLastCalledWith('/api/cases/case-a/todos', expect.objectContaining({ lists: [{ id: 'default', name: 'Tasks', tasks: [] }] }));
});

it('creates and renames separate lists and confirms deleting a populated list', async () => {
  await open();
  button('Add list').click(); await settle();
  await type('List name', 'Sources'); await submit('List name');
  await type('New task', 'Contact source'); await submit('New task');
  button('List options').click(); await settle();
  [...target.querySelectorAll('button')].find((b) => b.textContent === 'Rename list').click(); await settle();
  await type('List name', 'Contacts'); await submit('List name');
  expect(target.textContent).toContain('Contacts');
  button('List options').click(); await settle();
  [...target.querySelectorAll('button')].find((b) => b.textContent === 'Delete list').click(); await settle();
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Cancel').click(); await settle();
  expect(input('Task text').value).toBe('Contact source');
  [...target.querySelectorAll('button')].find((b) => b.textContent === 'Delete list').click(); await settle();
  [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Delete list').click(); await settle();
  expect(target.textContent).not.toContain('Contacts');
  expect(target.textContent).toContain('Tasks');
});

it('retains the draft on save failure and blocks stale writes until reload', async () => {
  await open();
  put.mockRejectedValueOnce(Object.assign(new Error('Changed in another tab'), { status: 409 }));
  await type('New task', 'Keep draft'); await submit('New task');
  expect(input('New task').value).toBe('Keep draft');
  expect(target.querySelector('fieldset').disabled).toBe(true);
  expect(target.querySelector('[role="alert"]').textContent).toContain('Changed in another tab');
  [...target.querySelectorAll('button')].find((b) => b.textContent === 'Reload lists').click(); await settle();
  expect(target.querySelector('fieldset').disabled).toBe(false);
  await submit('New task');
  expect(input('Task text').value).toBe('Keep draft');
});

it('does not write a default list on mount', async () => {
  await open();
  expect(put).not.toHaveBeenCalled();
  expect(get).toHaveBeenCalledWith('/api/cases/case-a/todos');
});

it('offers a reload when the first read fails', async () => {
  get.mockRejectedValueOnce(new Error('Case unavailable'));
  target = document.createElement('div');
  document.body.append(target);
  component = mount(CaseTodos, { target, props: { caseId: 'case-a' } });
  flushSync();
  await settle();
  expect(target.querySelector('[role="alert"]').textContent).toContain('Case unavailable');
  get.mockResolvedValueOnce(initial());
  [...target.querySelectorAll('button')].find((b) => b.textContent === 'Reload lists').click(); await settle();
  expect(target.querySelector('[role="alert"]')).toBeNull();
  expect(input('New task')).not.toBeNull();
});

it('titles the block like the other Home sections and avoids the global empty state', async () => {
  await open({ revision: 0, lists: [] });
  expect(target.querySelector('h2').classList.contains('label')).toBe(true);
  expect(target.textContent).toContain('Add a list to start.');
  expect(target.querySelector('.empty')).toBeNull();
});
