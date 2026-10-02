import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The shell's wiring for the two doors into the case: the Case button, and Add event
 *  from wherever the analyst is. */
const source = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8');
const markup = source.slice(source.indexOf('</script>'));

describe('the case on the rail', () => {
  it('sits under the four stages, a rule between them, with the theme at the foot', () => {
    const stages = markup.indexOf('{/each}', markup.indexOf('{#each WORKSPACES as ws (ws.id)}'));
    const rule = markup.indexOf('<span class="rail-rule"');
    const caseButton = markup.indexOf('onclick={() => openWorkspace(CASE_WORKSPACE)}');
    const theme = markup.indexOf('class="rail-btn theme-toggle"');
    expect(stages).toBeGreaterThan(-1);
    expect(rule).toBeGreaterThan(stages);
    expect(caseButton).toBeGreaterThan(rule);
    expect(theme).toBeGreaterThan(caseButton);
    expect(markup).toContain('title="The case: its Timeline, Board, Graph and Sheet"');
  });

  it('leaves the topbar to the case switcher', () => {
    expect(markup).not.toContain('case-btn');
  });
});

describe('Add event, from every tool', () => {
  it('is one icon button in the topbar, just before the guide mark', () => {
    const button = markup.indexOf('aria-label="Add an event"');
    const guide = markup.indexOf('onclick={() => openGuide(uiState.tool)}');
    expect(button).toBeGreaterThan(-1);
    expect(button).toBeLessThan(guide);
    expect(markup).toContain('<Icon name="eventAdd" size={16} />');
    // the words live in the tooltip, not beside the icon
    expect(markup).not.toContain('note-label');
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

describe('the tab strip', () => {
  it('names the open tool on its tab, since Geo Proof and Geo Report carry no title of their own', () => {
    expect(markup).toContain("aria-current={uiState.tool === toolId ? 'page' : undefined}");
    expect(readFileSync(new URL('./tools/ProofComposer.svelte', import.meta.url), 'utf8')).not.toContain('<h2>Geo Proof</h2>');
    expect(readFileSync(new URL('./tools/PostComposer.svelte', import.meta.url), 'utf8')).not.toContain('<h2>Geo Report</h2>');
  });
});
