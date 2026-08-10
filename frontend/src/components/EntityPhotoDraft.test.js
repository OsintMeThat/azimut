import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EntityPhotoDraft.svelte', import.meta.url), 'utf8');

describe('photos staged during entity creation', () => {
  it('accepts several computer images without using the Media upload route', () => {
    expect(source).toContain('accept="image/*"');
    expect(source).toContain('multiple');
    expect(source).toContain('URL.createObjectURL(file)');
    expect(source).not.toContain('/media/upload');
  });

  it('also stages existing Media Library images', () => {
    expect(source).toContain('Choose from media');
    expect(source).toContain("item.kind === 'image' && item.entity_id");
    expect(source).toContain("source: 'media'");
  });

  it('lets one staged image become primary and removes images before creation', () => {
    expect(source).toContain('Use ${photo.title} as primary photo');
    expect(source).toContain('primaryId = photo.draftId');
    expect(source).toContain('Remove ${photo.title}');
  });

  it('shows no empty frame and releases local previews', () => {
    expect(source).not.toContain('No photos yet');
    expect(source).toContain('URL.revokeObjectURL');
  });
});
