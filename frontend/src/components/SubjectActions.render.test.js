// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { get, patch, post, changed } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), changed: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get, patch, post } }));
vi.mock('../lib/state.svelte.js', () => ({ reloadCase: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/entityTypes.svelte.js', () => ({
  entityTypes: () => [
    { type: 'vehicle', label: 'Vehicle', retypable: true, mergeable: true },
    { type: 'vessel', label: 'Vessel', retypable: true, mergeable: true },
    { type: 'place', label: 'Place', mergeable: true },
    { type: 'claim', label: 'Claim' },
  ],
  entityLabel: (type) => type === 'vehicle' ? 'Vehicle' : type,
  entityFields: (type) => type === 'vehicle' ? [{ key: 'plate', label: 'Plate' }] : [],
}));
const { default: SubjectActions } = await import('./SubjectActions.svelte');
const { default: MergeSubjects } = await import('./MergeSubjects.svelte');
const entity = { id: 'newer', label: 'Newer', type: 'vehicle', attrs: {}, provenance: { at: '2026-09-02' } };
const other = { ...entity, id: 'older', label: 'Older', provenance: { at: '2026-09-01' } };
const preview = { fields: { kept: {}, added: {}, conflicts: [] }, links: { moved: 2, twins: 1, loops: 0 }, images: {}, pins: {}, views: [], sheets: 0, notes: 0, refused: [] };
let component;
async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); flushSync(); } }
async function open(Component = SubjectActions, props = {}) {
  const target = document.createElement('div'); document.body.append(target);
  component = mount(Component, { target, props: { caseId: 'case', entity, onchanged: changed, ...props } });
  await settle();
}
const button = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
beforeEach(() => { get.mockResolvedValue({ merges: [] }); patch.mockResolvedValue(entity); post.mockResolvedValue({}); });
afterEach(() => { if (component) unmount(component); document.body.innerHTML = ''; vi.resetAllMocks(); });

describe('subject corrections', () => {
  it('offers only registry-approved types and submits the selected type', async () => {
    await open(); button('Change type…').click(); await settle();
    const select = document.querySelector('select');
    expect([...select.options].map((o) => o.value)).toEqual(['vehicle', 'vessel']);
    select.options[0].selected = false; select.options[1].selected = true;
    select.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(select.value).toBe('vessel');
    expect(button('Change type').disabled).toBe(false);
    button('Change type').click(); await settle();
    expect(patch).toHaveBeenCalledWith('/api/cases/case/entities/newer', { type: 'vessel' });
    expect(changed).toHaveBeenCalledWith(entity);
  });
  it('keeps a refused change open and says what prevents it', async () => {
    patch.mockRejectedValue(new Error('A relation prevents this change'));
    await open(); button('Change type…').click(); await settle();
    const select = document.querySelector('select');
    select.options[0].selected = false; select.options[1].selected = true;
    select.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    button('Change type').click(); await settle();
    expect(document.querySelector('[role="alert"]').textContent).toContain('A relation prevents');
    expect(changed).not.toHaveBeenCalled();
  });
  it('shows retained fields with their original name and removes them explicitly', async () => {
    await open(SubjectActions, { entity: { ...entity, type: 'vessel', attrs: { plate: 'AA1234', _retained_fields: { plate: 'vehicle' } } } });
    expect(document.body.textContent).toContain('Kept from Vehicle');
    button('Remove Plate').click(); await settle();
    expect(patch).toHaveBeenCalledWith('/api/cases/case/entities/newer', { attrs: { plate: null } });
  });
  it('reloads the survivor after Undo and displays partial restoration', async () => {
    get.mockImplementation((url) => Promise.resolve(url.endsWith('/merges') ? { merges: [{ id: 'm1', merged_label: 'Old' }] } : { entity: { ...entity, attrs: { notes: 'Restored' } } }));
    post.mockResolvedValue({ lost: ['A photo was removed since'] });
    await open(); button('Undo').click(); await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/case/merges/m1/undo');
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ attrs: { notes: 'Restored' } }));
    expect(document.body.textContent).toContain('A photo was removed since');
  });
  it('does not offer correction actions for claims', async () => {
    await open(SubjectActions, { entity: { ...entity, type: 'claim' } });
    expect(document.querySelector('button')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('merge preview', () => {
  it('keeps the older subject by default, allows switching, and submits that direction', async () => {
    get.mockResolvedValue(preview);
    const merged = vi.fn();
    await open(MergeSubjects, { initialOther: other, onmerged: merged });
    expect(get).toHaveBeenLastCalledWith('/api/cases/case/entities/older/merge-preview?other=newer');
    document.querySelector('.choice').click(); await settle();
    expect(get).toHaveBeenLastCalledWith('/api/cases/case/entities/newer/merge-preview?other=older');
    button('Merge subjects').click(); await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/case/entities/newer/merge', { other: 'older' });
    expect(merged).toHaveBeenCalled();
  });
  it('blocks a preview with incompatible relations', async () => {
    get.mockResolvedValue({ ...preview, refused: [{ type: 'part-of', reason: 'would form a cycle' }] });
    await open(MergeSubjects, { initialOther: other });
    expect(button('Merge subjects').disabled).toBe(true);
    expect(document.body.textContent).toContain('would form a cycle');
    expect(post).not.toHaveBeenCalled();
  });
});
