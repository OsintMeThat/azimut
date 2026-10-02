import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const wizard = readFileSync(new URL('./DetectWizard.svelte', import.meta.url), 'utf8');
const builder = readFileSync(new URL('./AnalyzerBuilder.svelte', import.meta.url), 'utf8');
const checks = readFileSync(new URL('./AnalyzerChecks.svelte', import.meta.url), 'utf8');

describe('a cap says why a control went grey', () => {
  it('holds one area cap, the backend\'s, and says it where drawing stops', () => {
    expect(wizard).toContain('const MAX_AREAS = 32;');
    expect(wizard).not.toMatch(/>= 32|> 32/);
    expect(wizard).toContain('{#if zones.length >= MAX_AREAS}<p class="hint">{FULL}.</p>{/if}');
    expect(wizard).toContain('title={zones.length >= MAX_AREAS ? FULL : undefined}');
    // ticking a group that would overflow says so instead of doing nothing
    expect(wizard).toContain('would pass the ${MAX_AREAS} areas a sweep holds');
  });

  it('names the rule and check limits on the buttons they disable', () => {
    expect(builder).toContain('`At most ${most} rules per analyzer`');
    expect(checks).toContain("'This analyzer holds all the checks it can'");
  });
});
