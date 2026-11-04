// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get } }));
const { uiState } = await import('../lib/state.svelte.js');
const { default: NoteCitations } = await import('./NoteCitations.svelte');

let component;
let target;
afterEach(() => { if (component) unmount(component); target?.remove(); vi.clearAllMocks(); });

async function show(items) {
  get.mockResolvedValue({ items });
  target = document.createElement('div');
  document.body.append(target);
  const onopened = vi.fn();
  component = mount(NoteCitations, { target, props: { caseId: 'c1', entityId: 'p1', onopened } });
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  flushSync();
  return onopened;
}

it('lists each note citing the record with its sentence, and opens the note on it', async () => {
  const onopened = await show([
    { id: 'case', title: 'Case notes', folder: '', lines: [{ line: 3, text: 'Met at Quay.' }] },
    { id: 'n1', title: 'Lead', folder: 'Leads', lines: [{ line: 2, text: 'Quay is red.' }] },
  ]);
  expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/citations/p1');
  expect(target.textContent).toContain('Cited in notes');
  const line = [...target.querySelectorAll('.line')].find((node) => node.textContent === 'Quay is red.');
  line.click();
  expect(uiState.openNotebook).toEqual({ noteId: 'n1', line: 2 });
  expect(uiState.tool).toBe('notebook');
  expect(onopened).toHaveBeenCalled();
  [...target.querySelectorAll('.line')].find((node) => node.textContent === 'Met at Quay.').click();
  expect(uiState.openNotebook).toEqual({ noteId: null, line: 3 });
});

it('shows nothing for a record no note cites', async () => {
  await show([]);
  expect(target.textContent.trim()).toBe('');
});
