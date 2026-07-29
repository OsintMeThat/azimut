import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./RelationPicker.svelte', import.meta.url), 'utf8');

describe('RelationPicker', () => {
  it('collects a choice instead of filing it, because the subject may not exist yet', () => {
    // the Satellite save gate states "this photo was shot here" while filling in
    // a place the case has never held
    expect(source).toContain('value = $bindable(null)');
    expect(source).not.toContain('api.post');
    expect(source).toContain('entityId: entity.id');
    expect(source).toContain('direction: first.direction');
  });

  it('searches only the entity types the vocabulary accepts for this subject', () => {
    expect(source).toContain('relatableTypes(subjectType)');
    expect(source).toContain('buildCatalogQuery(caseId, { types: wanted, query: term, limit: PAGE })');
    expect(source).toContain('const PAGE = 8');
  });

  it('drops a stale page rather than letting it overwrite a newer keystroke', () => {
    expect(source).toContain('const mine = ++seq');
    expect(source).toContain('if (mine !== seq) return;');
  });

  it('lets the analyst pick the reading when the pair has more than one', () => {
    expect(source).toContain('relationOptions(subjectType, value.entityType)');
    expect(source).toContain('{#if options.length > 1}');
    expect(source).toContain('{option.label}');
  });

  it('shows nothing at all when the subject can hold no relation', () => {
    expect(source).toContain('{#if types.length}');
  });
});
