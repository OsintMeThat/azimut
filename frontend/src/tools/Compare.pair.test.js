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
