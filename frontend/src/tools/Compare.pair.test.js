import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const compare = readFileSync(new URL('./Compare.svelte', import.meta.url), 'utf8');
const map = readFileSync(new URL('./Satellite.svelte', import.meta.url), 'utf8');
const state = readFileSync(new URL('../lib/state.svelte.js', import.meta.url), 'utf8');

describe('Compare here', () => {
  it('asks the archive before the tab changes, so a refusal costs no view', () => {
    const body = map.slice(map.indexOf('async function comparePoint('));
    expect(body).toContain('const pair = await comparePair(api, source, { ...point, zoom: center.zoom });');
    expect(body.indexOf('uiState.tool = \'compare\';')).toBeGreaterThan(
      body.indexOf('const pair = await comparePair(')
    );
    expect(body).toContain("toast(error.message, 'warn', 6000);");
  });

  it('leaves out an archive this machine has no key for', () => {
    expect(map).toContain(
      'COMPARE_SOURCES.filter((source) => !source.provider || imagery.find(source.provider))'
    );
  });

  it('travels as a pair of sides, the shape a saved comparison stores', () => {
    expect(state).toContain('compareAt: null,');
    expect(map).toContain('uiState.compareAt = { ...point, zoom: center.zoom, ...pair };');
    expect(compare).toContain('applySide(a, s2a, wba, pair.a, s1a);');
    expect(compare).toContain('applySide(b, s2b, wbb, pair.b, s1b);');
  });

  it('opens unsaved and unnamed, because nothing was filed', () => {
    const body = compare.slice(compare.indexOf('async function openPair('));
    expect(body).toContain('openedSession = null;');
    expect(body).toContain('savedSignature = null;');
    expect(body).toContain("mode = 'side';");
  });

  it('asks before it throws an unsaved comparison away', () => {
    expect(compare).toContain("discardTarget = { kind: 'pair', pair };");
    expect(compare).toContain("else if (target?.kind === 'pair') void openPair(target.pair);");
  });

  it('is consumed once, and only once the providers are known', () => {
    expect(compare).toContain(
      "if (uiState.tool !== 'compare' || !uiState.compareAt || !imagery.providers.length) return;"
    );
    expect(compare).toContain('uiState.compareAt = null;');
  });
});

describe('an export kept in the case', () => {
  it('is offered beside the copy on disk, and files the same image under its comparison', () => {
    expect(compare).toContain('<input type="checkbox" bind:checked={keepInCase} />');
    expect(compare).toContain('Also keep it in this case');
    const keep = compare.slice(compare.indexOf('async function keepExport('));
    expect(keep).toContain("form.append('spec', JSON.stringify(sessionSpec()));");
    expect(keep).toContain('pictureDateFields(pictureDates())');
    expect(keep).toContain('/compare/sessions/${encodeURIComponent(openedSession.name)}/images');
    expect(compare).toContain("const kept = await keepExport(owner.id, 'png', blob);");
    expect(compare).toContain('const kept = await keepExport(owner.id, animation, frameA, frameB);');
  });

  it('asks for a name first when the comparison was never saved, then exports', () => {
    const run = compare.slice(compare.indexOf('async function runExport('));
    expect(run).toContain('if (keepInCase && !openedSession) {');
    expect(run).toContain('exportAfterSave = true;');
    const save = compare.slice(compare.indexOf('async function performSessionSave('));
    expect(save).toContain('await runExport();');
    // cancelling the name cancels the export it was asked for
    expect(compare).toContain('function closeSaveDialog() {');
  });

  it('reopens a saved comparison from its own card on the map', () => {
    expect(compare).toContain("if (row?.kind === 'comparison' && row.session) requestOpenSession(row.session);");
    expect(compare).toContain('onedit={editSaved}');
  });
});
