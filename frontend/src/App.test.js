import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The shell's wiring for the two doors into the case: the Case button, and Add event
 *  from wherever the analyst is. */
const source = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8');
const markup = source.slice(source.indexOf('</script>'));

describe('the case on the rail', () => {
  it('sits under the four stages, a rule between them, with the theme alone at the foot', () => {
    const stages = markup.indexOf('{/each}', markup.indexOf('{#each WORKSPACES as ws (ws.id)}'));
    const rule = markup.indexOf('<span class="rail-rule"');
    const caseButton = markup.indexOf('onclick={() => openWorkspace(CASE_WORKSPACE)}');
    const theme = markup.indexOf('onclick={toggleTheme}');
    expect(stages).toBeGreaterThan(-1);
    expect(rule).toBeGreaterThan(stages);
    expect(caseButton).toBeGreaterThan(rule);
    expect(theme).toBeGreaterThan(caseButton);
    expect(markup.slice(markup.indexOf('<nav class="rail">'), markup.indexOf('</nav>'))).not.toContain('openSupport');
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

describe('the ? in the topbar', () => {
  it('opens the guide over the tool it was pressed from, on every tool', () => {
    expect(markup).toContain('onclick={() => openGuide(uiState.tool)}');
    expect(markup).toMatch(/\{#if uiState\.guide\}\s*<GuideDialog at=\{uiState\.guide\.at\} onclose=\{\(\) => \(uiState\.guide = null\)\} \/>/);
    // no Guide tab any more, so nothing hides the mark
    expect(markup).not.toContain("uiState.tool !== 'guide'");
    expect(source).not.toContain("tools/Guide.svelte");
  });

  it('is what the tour and What’s new point at, and the update notice waits behind them', () => {
    expect(markup).toContain('bind:this={guideButton}');
    expect(markup).toMatch(/<Onboarding\s+start=\{uiState\.onboarding\}[\s\S]*?anchor=\{guideButton\}/);
    expect(markup).toContain('{#if updateState.show && !uiState.onboarding}');
    // decided once the case list says whether this is a newcomer, and never in a map window
    expect(source).toMatch(/\.finally\(\(\) => \{\s*onboardOnStart\(\);/);
    expect(source).toMatch(/function onboardOnStart\(\) \{\s*if \(solo \|\| uiState\.onboarding\) return;/);
    // asking for the guide from it opens it where the `?` would, or where the card says (Find's notice)
    expect(source).toMatch(/function onboarded\([^)]*\) \{[\s\S]*?if \(guide\) openGuide\(guide === true \? uiState\.tool : guide\);/);
  });
});

describe('the tab strip', () => {
  it('names the open tool on its tab, since Geo Proof and Post carry no title of their own', () => {
    expect(markup).toContain("aria-current={uiState.tool === toolId ? 'page' : undefined}");
    expect(readFileSync(new URL('./tools/ProofComposer.svelte', import.meta.url), 'utf8')).not.toContain('<h2>Geo Proof</h2>');
    expect(readFileSync(new URL('./tools/PostComposer.svelte', import.meta.url), 'utf8')).not.toContain('<h2>Post</h2>');
  });

  it('says on a tab\'s hover what it was called, for the release that renamed it', () => {
    expect(markup).toContain('title={TOOL_HOVERS[toolId]}');
  });
});

describe('the sidebar’s toggle and the first scene kept', () => {
  it('is the one toggle, with its dot, last in the top bar', () => {
    expect(markup).toContain('<SidebarToggle bind:button={sidebarToggle} onclick={toggleSidebar} />');
    expect(markup).not.toContain('title="Toggle case sidebar"');
    expect(markup.indexOf('<SidebarToggle')).toBeLessThan(markup.indexOf('</header>'));
    expect(markup.indexOf('<SidebarToggle')).toBeGreaterThan(markup.indexOf('bind:this={guideButton}'));
  });
});

describe('Tip, for Support & feedback', () => {
  it('sits in the top bar before Go to, named Tip, its heart beating there', () => {
    const tip = markup.indexOf('tip-btn');
    expect(tip).toBeGreaterThan(markup.indexOf('<div class="spacer"></div>'));
    expect(tip).toBeLessThan(markup.indexOf('data-guide="start.goto"'));
    const button = markup.slice(tip, markup.indexOf('</button>', tip));
    expect(button).toContain('title="Support & feedback"');
    expect(button).toContain('onclick={openSupport}');
    expect(button).toContain('{#key supportBeats}');
    expect(button).toContain('<span>Tip</span>');
    expect(markup.match(/onclick=\{openSupport\}/g)).toHaveLength(1);
  });
});

describe('Settings', () => {
  it('is the gear in the top bar, between the guide and the sidebar, so its dot is seen', () => {
    const at = markup.indexOf('data-guide="start.settings"');
    expect(markup.match(/data-guide="start\.settings"/g)).toHaveLength(1);
    expect(at).toBeGreaterThan(markup.indexOf('bind:this={guideButton}'));
    expect(at).toBeLessThan(markup.indexOf('<SidebarToggle'));
    expect(at).toBeLessThan(markup.indexOf('</header>'));
    const gear = markup.slice(at, markup.indexOf('<SidebarToggle'));
    expect(gear).toContain("class:topbar-active={uiState.tool === 'settings'}");
    expect(gear).toContain('{#if badges.any}');
    expect(gear).toContain('<span class="update-dot" aria-hidden="true"></span>');
    const rail = markup.slice(markup.indexOf('<nav class="rail">'), markup.indexOf('</nav>'));
    expect(rail).not.toContain("'settings'");
  });

  it('points once at the toggle or the To-do tab, Show opening the To-do', () => {
    expect(source).toContain('todoHintAt(uiState.sidebarOpen, uiState.sidebarView)');
    expect(source).toContain('aside.sidebar [role="tab"][data-view="todo"]');
    // given only once it has somewhere to point, so a later scene asks again
    expect(source.indexOf('if (!anchor) return;')).toBeLessThan(source.indexOf('todoHintGiven();'));
    expect(source).toContain('const at = bare || document.fullscreenElement ? null');
    expect(markup).toMatch(/<Coachmark[\s\S]{0,120}text="Your scenes wait here"[\s\S]{0,40}action="Show"/);
    expect(markup).toMatch(/onaction=\{\(\) => \{\s*todoPointer = null;\s*openTodo\(\);/);
  });

  it('lets it go once what it points at moves', () => {
    expect(source).toContain('const pointedFrom = $derived(`${uiState.sidebarOpen} ${uiState.sidebarView} ${uiState.tool} ${caseState.current?.id}`);');
    expect(source).toMatch(/void pointedFrom;\s*untrack\(\(\) => \(todoPointer = null\)\);/);
  });
});

describe('a capture the extension filed', () => {
  it('offers its toast’s Put to the note on the side, and nothing for a bookmark or a place', () => {
    const handler = source.slice(source.indexOf("onEvent('capture'"), source.indexOf("onEvent('bookmark'"));
    expect(handler).toContain('const put = captureToastAction(ev);');
    expect(handler).toContain("put ? [put] : []");
    expect(source).toContain('filedToast(lead, [entity], { fallback, timeout: also.length ? 8000 : 5000, also });');
  });
});
