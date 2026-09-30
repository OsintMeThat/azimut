import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The shell's wiring for the two doors into the case: the Case button, and Add event
 *  from wherever the analyst is. */
const source = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8');
const markup = source.slice(source.indexOf('</script>'));

describe('the Case button', () => {
  it('names the workspace it opens, whose first tab is the Timeline', () => {
    expect(markup).toContain('title="Open the case: its Timeline, Board, Graph and Sheet"');
    expect(markup).toContain('<span>{CASE_WORKSPACE.label}</span>');
    expect(markup).toContain('onclick={() => openWorkspace(CASE_WORKSPACE)}');
  });
});

describe('Add event, from every tool', () => {
  it('is one labelled button in the topbar, just before the guide mark', () => {
    const button = markup.indexOf('aria-label="Add an event"');
    const guide = markup.indexOf('onclick={() => openGuide(uiState.tool)}');
    expect(button).toBeGreaterThan(-1);
    expect(button).toBeLessThan(guide);
    expect(markup).toContain('<Icon name="eventAdd" size={15} />');
    expect(markup).toContain('<kbd>Alt N</kbd>');
    // shown only with a case, since there is nowhere to add an event without one
    expect(markup).toMatch(/\{#if caseState\.current && !solo\}\s*<button[\s\S]{0,200}class:on=\{uiState\.noting\}/);
  });

  it('says why it is off on a frozen snapshot rather than hiding', () => {
    expect(source).toContain("'A frozen snapshot takes no new event. Leave it to add one.'");
    expect(markup).toContain('disabled={noteFrozen}');
  });

  it('answers Alt+N outside any field, and sends the Timeline to its own line', () => {
    expect(source).toContain("import { isNoteKey } from './lib/noteHere.svelte.js';");
    expect(markup).toContain('<svelte:window onkeydown={onGlobalKey} />');
    expect(source).toContain("if (uiState.tool === 'timeline') {");
    expect(source).toContain('uiState.timelineLineFocus += 1;');
  });

  it('mounts the one bar every tool shares', () => {
    expect(markup).toContain('<NoteBar />');
  });
});
