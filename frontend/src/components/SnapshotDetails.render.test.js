// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get, post } }));
vi.mock('../lib/relations.svelte.js', () => ({ loadRelationTypes: () => {}, relationVerb: (type) => type }));
vi.mock('../lib/entityTypes.svelte.js', () => ({ entityLabel: (type) => type }));
vi.mock('../lib/entityIcon.js', () => ({ entityIcon: () => 'pin' }));
const { default: SnapshotDetails } = await import('./SnapshotDetails.svelte');

it('marks a merged snapshot subject without replacing captured fields', async () => {
  post.mockResolvedValue({ redirects: { old: { id: 'kept' } } });
  get.mockResolvedValue({ entity: { id: 'kept', label: 'Current subject', attrs: { notes: 'Changed later' } } });
  const target = document.createElement('div'); document.body.append(target);
  const entity = { id: 'old', type: 'person', label: 'Captured subject', attrs: { notes: 'Captured notes' } };
  const component = mount(SnapshotDetails, { target, props: { caseId: 'case', entity } });
  try {
    for (let i = 0; i < 8; i++) { flushSync(); await Promise.resolve(); }
    flushSync();
    expect(target.querySelector('[role="status"]').textContent).toBe('Merged into Current subject');
    expect(target.textContent).toContain('Captured notes');
    expect(target.textContent).not.toContain('Changed later');
    expect(entity.label).toBe('Captured subject');
  } finally { unmount(component); target.remove(); }
});
