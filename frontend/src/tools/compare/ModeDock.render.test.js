import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import ModeDock from './ModeDock.svelte';

const compare = readFileSync(new URL('../Compare.svelte', import.meta.url), 'utf8');

const labels = (body) =>
  [...body.matchAll(/<span class="svelte-[^"]*">([^<]+)<\/span>/g)].map((label) => label[1]);

describe('the mode dock', () => {
  it('offers the four views, and Difference beside them on a pair it can read', () => {
    const { body } = render(ModeDock, { props: { mode: 'side', differenceable: true } });
    expect(labels(body)).toEqual(['Side by side', 'Swipe', 'Fade', 'Blink', 'Difference']);
    expect(body).toContain('title="Swipe (2)"');
  });

  it('does not offer Difference on a pair it cannot read', () => {
    const { body } = render(ModeDock, { props: { mode: 'side', differenceable: false } });
    expect(labels(body)).toEqual(['Side by side', 'Swipe', 'Fade', 'Blink']);
  });

  it('keeps the view pressed while Difference is on over it', () => {
    const { body } = render(ModeDock, { props: { mode: 'blink', difference: true, differenceable: true } });
    const pressed = [...body.matchAll(/aria-pressed="true"[^>]*>[\s\S]*?<span class="svelte-[^"]*">([^<]+)</g)]
      .map((match) => match[1]);
    expect(pressed).toEqual(['Blink', 'Difference']);
  });

  it('has no door to Detect, which is its own tab', () => {
    const { body } = render(ModeDock, { props: { mode: 'side', differenceable: true } });
    expect(body).not.toContain('Detect');
    expect(compare).not.toContain('detectHandoff');
  });
});
