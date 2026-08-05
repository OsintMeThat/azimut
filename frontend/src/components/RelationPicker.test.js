import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./RelationPicker.svelte', import.meta.url), 'utf8');

describe('RelationPicker', () => {
  it('collects a choice instead of filing it, because the subject may not exist yet', () => {
    // the Satellite save gate states "this photo was recorded here" while filling in
    // a place the case has never held
    expect(source).toContain('value = $bindable(null)');
    expect(source).not.toContain('api.post');
    expect(source).toContain('entityId: entity.id');
    expect(source).toContain('direction: first.direction');
  });

  it('searches only the entity types the vocabulary accepts for this subject', () => {
    expect(source).toContain('relatableTypes(subjectEnd, action)');
    expect(source).toContain('buildCatalogQuery(caseId, { types: wanted, query: term, limit: FETCH })');
    expect(source).toContain('const FETCH = 500');
    expect(source).not.toContain('.slice(0, PAGE)');
  });

  it('keeps one target of each compatible type on the compact first page', () => {
    expect(source).toContain('function visibleResults(items, term)');
    expect(source).toContain('if (seen.has(entity.type)) rest.push(entity);');
    expect(source).toContain('results = visibleResults(compatible, term);');
  });

  it('drops a stale page rather than letting it overwrite a newer keystroke', () => {
    expect(source).toContain('const mine = ++seq');
    expect(source).toContain('if (mine !== seq) return;');
  });

  it('lets the analyst pick the reading when the pair has more than one', () => {
    expect(source).toContain('relationOptions(subjectEnd, { type: value.entityType, attrs: value.attrs }, action)');
    expect(source).toContain("{#if action !== 'mention' && options.length > 1}");
    expect(source).toContain('{option.label}');
    expect(source).toContain('`${option.type}:${option.direction}` === event.currentTarget.value');
    expect(source).toContain('value={`${value.type}:${value.direction}`}');
  });

  it('shows nothing at all when the subject can hold no relation', () => {
    expect(source).toContain('{#if types.length}');
  });
});

describe('relations and mentions are separate gestures', () => {
  it('filters the vocabulary before it searches or chooses a verb', () => {
    expect(source).toContain("action = 'relation'");
    expect(source).toContain('relationOptions(subjectEnd, entity, action)');
  });

  it('uses distinct add and clear labels for a mention', () => {
    expect(source).toContain("action === 'mention' ? 'Add mention' : 'Add relation'");
    expect(source).toContain("action === 'mention' ? 'Clear mention' : 'Clear relation'");
    expect(source).not.toContain('Relate to…');
  });

  it('can commit immediately when Details opens it as a composer', () => {
    expect(source).toContain('expanded = false');
    expect(source).toContain('oncommit = null');
    expect(source).toContain('await oncommit(value)');
    expect(source).toContain("{commitBusy ? 'Adding…' : actionLabel}");
  });

  it('does not show a verb on a mention pointer', () => {
    expect(source).toContain("{#if action !== 'mention' && options.length > 1}");
    expect(source).toContain("{:else if action !== 'mention'}");
  });
});

describe('an empty result says what it was waiting for', () => {
  it('names the types this subject may be related to', () => {
    // "Nothing to relate here yet" read as "nothing can be related here", where the
    // truth is that the case holds none of the types this one joins
    expect(source).toContain("{action === 'mention' ? 'mention' : 'relate this to'}");
    expect(source).toContain('const accepted = $derived(');
    expect(source).toContain('entityLabel(type)');
  });

  it('separates a case with none of them from a search that matched none', () => {
    expect(source).toContain('{:else if query.trim()}');
    expect(source).toContain('Nothing matches.');
  });

  it('keeps the last word for a subject the vocabulary joins to nothing at all', () => {
    expect(source).toContain('Nothing in the vocabulary relates to this.');
  });
});

describe('the verb menu is split the way the list is', () => {
  it('offers a headed verb under its heading, from the registry', () => {
    expect(source).toContain('<optgroup label={verbs.group}>');
    expect(source).toContain("const group = option.group ?? '';");
    expect(source).not.toContain('Mentions');
  });

  it('files the first reading, which relationOptions has already ordered', () => {
    // the picker never re-sorts: the ordering rule lives in the shared registry so
    // the list and this control cannot disagree about what a pair mainly says
    expect(source).toContain('const [first] = relationOptions(subjectEnd, entity, action)');
    expect(source).not.toContain('options.sort(');
  });

  it('can lock a Claim picker to one connector', () => {
    expect(source).toContain('relationType = null');
    expect(source).toContain('!relationType || option.type === relationType');
  });
});
