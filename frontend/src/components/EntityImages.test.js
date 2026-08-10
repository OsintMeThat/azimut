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
    expect(source).toContain('title="Remove from this entity"');
    expect(source).toContain('/entities/${entity.id}/images/${selected.id}`');
    expect(source).not.toContain('/media?path=');
  });

  it('shows no empty frame and keeps an added main image bounded', () => {
    expect(source).not.toContain('No photos yet.');
    expect(source).toContain('height: 220px;');
    expect(source).toContain('object-fit: contain;');
  });
});
