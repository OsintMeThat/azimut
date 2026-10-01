import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** What Compare hands the topbar's Add event: the pair's dates, read when it opens. */
const source = readFileSync(new URL('./Compare.svelte', import.meta.url), 'utf8');

describe('Add event over Compare', () => {
  it('offers each picture’s day and the span between them, one press each', () => {
    expect(source).toContain("offerNote('compare', null, {");
    expect(source).toContain('const { a: first, b: second } = pictureDates();');
    expect(source).toContain('return pairOffers(side(first), side(second), {');
    expect(source).toContain("onDestroy(() => withdrawNote('compare'));");
  });
});
