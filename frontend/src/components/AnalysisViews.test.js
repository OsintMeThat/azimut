import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AnalysisViews.svelte', import.meta.url), 'utf8');

describe('saved analysis views', () => {
  it('offers live and frozen readings, with the difference stated in the dialog', () => {
    expect(source).toContain('value="live"');
    expect(source).toContain('Recomputes the question from the current case.');
    expect(source).toContain('value="snapshot"');
    expect(source).toContain("surface === 'timeline'");
    expect(source).toContain('Freezes up to 5,000 timeline entries.');
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
    expect(source).toContain("slot.activeView.mode === 'snapshot'");
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
    expect(source).toContain('slot.changeVersion === version');
    expect(source).not.toContain('await onopen(view);\n      await read();\n      toast(`Updated');
  });

  it('flushes the active live view before a case switch', () => {
    expect(source).toContain('registerCaseChangeGuard(() => persistActive())');
    expect(source).toContain("current.surface !== surface");
  });

  it('offers only the readings this surface can draw, and says so when there are none', () => {
    expect(source).toContain('const family = $derived(viewFamily(surface))');
    expect(source).toContain('const slot = $derived(viewSlot(surface))');
    expect(source).toContain("stored.filter((view) => viewFamily(view.surface) === family)");
    expect(source).toContain('No saved timeline views yet.');
    expect(source).toContain('No saved board or graph views yet.');
    // the surface is worth naming only where the family holds two of them
    expect(source).toContain("{#if family === 'catalog'}· {view.surface}{/if}");
  });

  it('closes the menu on a press outside it, and resets the list gutter', () => {
    expect(source).toContain('closeOnOutsidePointer(anchor, () => (menu = false))');
    expect(source).toContain('list-style: none');
  });

  it('cancels a pending save when the recipe is changed back', () => {
    expect(source).toContain("if (!slot.modified) {");
    expect(source).toContain("slot.saveState = 'saved'");
  });

  it('keeps a snapshot immutable instead of recapturing it under the same name', () => {
    expect(source).toContain("disabled={slot.activeView?.mode === 'snapshot'}");
    expect(source).toContain('Duplicate the snapshot to keep another copy.');
    // A label is not a capture: the rename route takes both modes and no spec.
    expect(source).toContain('api.patch(');
    expect(source).toContain("{ name: next }");
  });

  it('reads the list in a remembered order, and only where there is one to read', () => {
    expect(source).toContain('sortViews(views, order)');
    expect(source).toContain('order = readViewOrder(family)');
    expect(source).toContain('writeViewOrder(family, value)');
    expect(source).toContain('{#if views.length > 1}');
    expect(source).toContain('{#each orders as choice (choice.id)}');
  });

  it('dates every row and spells the exact minute out of the way', () => {
    expect(source).toContain('timeAgo(view.updated_at, now)');
    expect(source).toContain('title={exactStamp(view.updated_at)}');
    expect(source).toContain('now = Date.now()');
  });
});
