import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AnalysisViews.svelte', import.meta.url), 'utf8');

describe('saved analysis views', () => {
  it('offers live and frozen readings, with the difference stated in the dialog', () => {
    expect(source).toContain('value="live"');
    expect(source).toContain('Recomputes the question from the current case.');
    expect(source).toContain('value="snapshot"');
    expect(source).toContain('Freezes up to 2,000 entities and their relations.');
  });

  it('can open, duplicate and trash a case-owned reading', () => {
    expect(source).toContain('/analysis-views`');
    expect(source).toContain('/duplicate`');
    expect(source).toContain('Duplicate view');
    expect(source).toContain('restoreGroup(caseId, result.trash)');
    expect(source).not.toContain('Export view');
    expect(source).not.toContain('Import');
  });

  it('autosaves a live recipe and exposes the current save state', () => {
    expect(source).toContain("analysisSearch.activeView.mode === 'snapshot'");
    expect(source).toContain("return 'live · saving…'");
    expect(source).toContain("return 'live · saved'");
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('AUTO_SAVE_AFTER');
    expect(source).toContain('setTimeout(() =>');
    expect(source).not.toContain('aria-label="Update saved view"');
    expect(source).toContain("api.put(`/api/cases/${caseId}/analysis-views/${viewId}`");
  });

  it('does not replay an autosave response over a newer edit', () => {
    expect(source).toContain('adoptSavedAnalysisView(caseId, view)');
    expect(source).toContain('analysisSearch.changeVersion === version');
    expect(source).not.toContain('await onopen(view);\n      await read();\n      toast(`Updated');
  });

  it('cancels a pending save when the recipe is changed back', () => {
    expect(source).toContain("if (!analysisSearch.modified) {");
    expect(source).toContain("analysisSearch.saveState = 'saved'");
  });

  it('keeps a snapshot immutable instead of recapturing it under the same name', () => {
    expect(source).toContain("disabled={analysisSearch.activeView?.mode === 'snapshot'}");
    expect(source).toContain('Duplicate the snapshot to keep another copy.');
  });
});
