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

  it('opens on where the case is, and says how much of the case that is', () => {
    // a video from Sanaa is argued in Sanaa's time, and the case knows where it is
    expect(source).toContain("choice = $bindable('case')");
    expect(source).toContain("onclick={() => pick('case')}");
    expect(source).toContain('{caseZoneWords(home)} · {offsetLabel(home.zone, at)}');
    // with no placed point the default is UTC, and the UTC row says so
    expect(source).toContain("if (choice === 'case') return home ? zoneWords(home.zone).place : 'UTC';");
    expect(source).toContain("class:on={choice === 'utc' || (choice === 'case' && !home)}");
    // the parent keeps what was picked
    expect(source).toContain('onpick?.(value);');
  });

  it('does not print the offset beside a name that already is it', () => {
    // the trigger read `UTC UTC`
    expect(source).toContain("{#if label !== 'UTC'}<small>{offsetLabel(resolved, at)}</small>{/if}");
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
