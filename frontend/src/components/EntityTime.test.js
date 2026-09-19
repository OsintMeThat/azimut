import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EntityTime.svelte', import.meta.url), 'utf8');

describe('entity Time tab', () => {
  it('uses the shared bounded projection and keeps all three authorities separate', () => {
    expect(source).toContain("for (const category of ['statement', 'media', 'case_activity'])");
    expect(source).toContain("item.category === 'statement'");
    expect(source).toContain("item.category === 'media'");
    expect(source).toContain("item.category === 'case_activity'");
    expect(source).toContain('Case activity');
  });

  it('does not attribute a cited statement date to its evidence', () => {
    expect(source).toContain("item.sources.includes(entity.id)");
    expect(source).toContain('Evidence for <span>{evidence.length}</span>');
    expect(source).toContain('These dates belong to claims this item supports.');
  });

  it('prefills a media capture assessment without changing file metadata', () => {
    expect(source).toContain("entity.type === 'media' ? 'Claim a capture date'");
    expect(source).toContain("initialStatement={entity.type === 'media' ? 'This media was captured' : ''}");
    expect(source).toContain("initialRole={entity.type === 'media' ? 'observed' : ''}");
  });

  it('hands the visible entity scope to the global Timeline', () => {
    expect(source).toContain('uiState.timelineFocus = { entityId: entity.id, entityLabel: entity.label');
    expect(source).toContain("uiState.tool = 'timeline'");
  });

  it('opens an existing assessment in an explicit inline editor', () => {
    expect(source).toContain('aria-label={`Edit ${item.label}`}');
    expect(source).toContain('class="time-editor"');
    expect(source).toContain("'Edit claim'");
    expect(source).not.toContain('<Modal');
  });

  it('uses the Timeline visual language and separates unresolved dates', () => {
    expect(source).toContain('formatTemporalValue(item.raw ?? \'\').label');
    expect(source).toContain('var(--timeline-statement)');
    expect(source).toContain('Not on UTC axis');
    expect(source).toContain('Undated <span>{visibleUndated.length}</span>');
    expect(source).not.toContain('title="Approximate">~');
  });

  it('edits the Claim date instead of creating an impossible nested assessment', () => {
    expect(source).toContain("ownStatement?.raw ? 'Edit claim date' : 'Set claim date'");
    expect(source).toContain("editor = entity.type === 'claim'");
    expect(source).toContain('This claim has no date yet.');
    expect(source).toContain('A claim has one date or range. File another claim for a separate date.');
    expect(source).toContain('visibleUndated = $derived(undated.filter');
  });
});

describe('entity Time tab — which date reads first', () => {
  it('puts what the analyst concluded above what the file reports', () => {
    // A proof that dates its footage states it here, and a stated date is the
    // answer: the file's own clock is what the analyst was correcting or filling
    // in. Pinned, because the order is the whole of the priority.
    const about = source.indexOf('Claims about this');
    const media = source.indexOf('Media dates');
    expect(about).toBeGreaterThan(-1);
    expect(media).toBeGreaterThan(about);
  });
});
