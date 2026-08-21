import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EntityImages.svelte', import.meta.url), 'utf8');

describe('entity photo gallery', () => {
  it('supports multiple direct imports from the computer', () => {
    expect(source).toContain('accept="image/*"');
    expect(source).toContain('multiple');
    expect(source).toContain('Add from computer');
    expect(source).toContain('/entities/${entity.id}/images/upload`');
    expect(source).not.toContain('/media/upload`');
  });

  it('also attaches multiple existing Media Library images', () => {
    expect(source).toContain('Choose from media');
    expect(source).toContain("item.kind === 'image' && item.entity_id");
    expect(source).toContain(': [...picked, mediaId];');
    expect(source).toContain('{ media_ids: picked }');
  });

  it('chooses one primary photo and propagates the change', () => {
    expect(source).toContain('/primary`');
    expect(source).toContain('Set as primary');
    expect(source).toContain("await reloadCase();");
  });

  it('detaches without deleting the underlying media', () => {
    expect(source).toContain('/entities/${entity.id}/images/${image.id}`');
    expect(source).not.toContain('/media?path=');
  });

  it('names the two acts apart, since only one of them is a delete', () => {
    // "Remove" covered both: a reference the media survives, and the only copy the case
    // ever had of an imported photo. One word for two outcomes is one of them unannounced.
    expect(source).toContain("{selected.direct ? 'Delete this copy' : 'Remove'}");
    expect(source).toContain('Take it off this entity; the media stays in the case');
    expect(source).not.toContain('title="Remove from this entity"');
  });

  it('asks before deleting a photo no Trash will hold', () => {
    // A presentation photo is not an artifact, so `engine/trash.py` never sees it and the
    // toast carries no Undo: the click has to be the confirmation.
    expect(source).toContain('if (selected.direct) dropping = selected;');
    expect(source).toContain('else drop(selected);');
    expect(source).toContain('<ConfirmDialog');
    expect(source).toContain('tone="danger"');
    expect(source).toContain('this cannot be brought back');
  });

  it('shows no empty frame and keeps an added main image bounded', () => {
    expect(source).not.toContain('No photos yet.');
    expect(source).toContain('height: 220px;');
    expect(source).toContain('object-fit: contain;');
  });
});
