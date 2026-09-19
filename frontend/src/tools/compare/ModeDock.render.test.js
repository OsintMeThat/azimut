import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import ModeDock from './ModeDock.svelte';
import AnalyzerPanel from './AnalyzerPanel.svelte';

const compare = readFileSync(new URL('../Compare.svelte', import.meta.url), 'utf8');

/** Each named group, with the labels of the modes inside it. */
function groups(body) {
  return body
    .split('role="group" aria-label="')
    .slice(1)
    .map((chunk) => [
      chunk.slice(0, chunk.indexOf('"')),
      [...chunk.matchAll(/<span class="svelte-[^"]*">([^<]+)<\/span>/g)].map((label) => label[1]),
    ]);
}

describe('the mode dock', () => {
  const ready = { ok: true, reason: '' };

  it('names its two kinds of choice apart', () => {
    const { body } = render(ModeDock, { props: { mode: 'side', change: ready } });
    expect(groups(body)).toEqual([
      ['View', ['Side by side', 'Swipe', 'Fade', 'Blink']],
      ['Analysis', ['Difference', 'Detect']],
    ]);
  });

  it('says what an analysis still needs on the button itself', () => {
    const { body } = render(ModeDock, {
      props: {
        mode: 'side',
        change: { ok: false, reason: 'Add imagery A and B first.' },
        detect: { ok: false, reason: 'Detect reads Copernicus Sentinel-2: add your credentials in Settings → Imagery.' },
      },
    });
    expect(body).toMatch(/class="mode-btn[^"]*blocked[^"]*"[^>]*title="Add imagery A and B first\."/);
    expect(body).toMatch(/class="mode-btn[^"]*blocked[^"]*"[^>]*title="Detect reads Copernicus Sentinel-2/);
    // a ready mode keeps its name and key as the tooltip
    expect(body).toContain('title="Swipe (2)"');
  });

  it('marks nothing when every analysis can run', () => {
    const { body } = render(ModeDock, { props: { mode: 'change', change: ready, detect: ready } });
    expect(body).not.toContain('blocked');
  });
});

describe('Detect without Copernicus', () => {
  it('asks only once the provider list has been read, and never locks the panel', () => {
    expect(compare).toContain("imagery.providers.length && !imagery.find('sentinel2')");
    // saved areas and runs stay reachable: setMode refuses Difference, not Detect
    expect(compare).toContain("if (next === 'change' && !changeStatus.ok) {");
    expect(compare).not.toContain("next === 'analysis' && !detectStatus.ok");
  });

  it('says so at the top of the panel, with the way to Settings', () => {
    const { body } = render(AnalyzerPanel, {
      props: { caseId: 'c1', needs: 'Detect reads Copernicus Sentinel-2: add your credentials in Settings → Imagery.' },
    });
    expect(body).toContain('Detect reads Copernicus Sentinel-2');
    expect(body).toContain('Open Settings');
  });
});
