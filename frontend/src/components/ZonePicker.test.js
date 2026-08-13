import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ZonePicker.svelte', import.meta.url), 'utf8');

describe('choosing the clock a chronology is read on', () => {
  it('offers the four readings in one searchable list', () => {
    // an investigation is rarely in the analyst's own zone and often in no saved point
    // yet, so the reading has to be choosable outright — and picking between the four
    // kinds is one decision, so it is one control
    expect(source).toContain("onclick={() => pick('utc')}");
    expect(source).toContain("onclick={() => pick('machine')}");
    expect(source).toContain('onclick={() => pick(`place:${place.id}`)}');
    expect(source).toContain('onclick={() => pick(`zone:${zone}`)}');
    expect(source).toContain('<SearchInput bind:value={query}');
  });

  it('names the saved points apart, because picking one does a second thing', () => {
    // a point has coordinates, so its daylight can be drawn; a zone name cannot
    expect(source).toContain('Saved points · with daylight');
    expect(source).toContain('local time and daylight');
  });

  it('shows the offset in force at the window, not today-s', () => {
    // a winter window labelled with a summer offset is the bug this avoids
    expect(source).toContain('offsetLabel(zone, at)');
    expect(source).toContain('offsetLabel(resolved, at)');
    expect(source).toContain('at = 0,');
  });

  it('bounds the list and says what it left out', () => {
    expect(source).toContain('const ROWS = 40');
    expect(source).toContain('matching.slice(0, ROWS)');
    expect(source).toContain('more. Keep typing.');
    expect(source).toContain('No zone or point matches that.');
  });

  it('says so where the engine cannot list the world-s zones', () => {
    // `supportedValuesOf` landed in 2022; an older browser gets a plain sentence
    // rather than a control that silently pretends the world is UTC
    expect(source).toContain('This browser cannot list world zones.');
  });

  it('closes on a click outside, like every other menu here', () => {
    expect(source).toContain("document.addEventListener('pointerdown', closeOutside)");
    expect(source).toContain("document.removeEventListener('pointerdown', closeOutside)");
  });
});
