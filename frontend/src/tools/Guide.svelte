<script>
  /**
   * What the app is, and what each workspace is for.
   *
   * One section per rail workspace plus the case, read down a column with a contents
   * list beside it, between two that set up — what a case is, the capture extension,
   * then three jobs walked end to end — and two that close: the keys, and what to do
   * when something breaks. The text is `lib/guide.js` rather than markup here, so the
   * `?` in the topbar can open this tab on one section instead of the app growing a
   * second copy of the same sentences.
   *
   * Static on purpose: no tour, no overlay, no step that points at a live button.
   * A guided tour breaks silently on the first layout change and nobody notices for a
   * release; a page of text is wrong in a way that can be read and fixed.
   */
  import { GUIDE, readingSection } from '../lib/guide.js';
  import { ALL_WORKSPACES, TOOL_LABELS } from '../lib/workspaces.js';
  import { uiState } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';

  /** Where the whole picture lives, for a reader who downloaded a binary and has no
   *  repository in front of them. */
  const SPEC_URL = 'https://github.com/OsintMeThat/azimut/blob/main/docs/SPEC.md';

  /** How far below the top of the column a heading counts as the one being read. */
  const LINE = 120;
  /** How long a press owns the list for, while the smooth scroll travels. */
  const STEER = 700;

  /** The section the contents list is pointing at. Local to this tab: which paragraph
   *  somebody read last is not state the case or the browser should carry. */
  let at = $state(GUIDE[0].id);
  let column = $state(null);

  /** A section's mark: the workspace's own where the id names one, so the contents
   *  list and the rail cannot drift apart, and the section's own where it names none. */
  const iconOf = (section) =>
    ALL_WORKSPACES.find((ws) => ws.id === section.id)?.icon ?? section.icon ?? 'compass';

  /**
   * Follow the reading: the contents list marks whatever section is under the eye.
   *
   * Measured on the frame rather than on every scroll event, and off the **column**
   * rather than the window, since the page scrolls inside `.tool-body` and a heading's
   * viewport position says nothing about where it sits in there.
   */
  let frame = 0;
  let pending = false;
  let steering = 0;

  /** The headings, in document order, each measured against the top of the column. */
  function measure() {
    pending = false;
    if (!column) return;
    const top = column.getBoundingClientRect().top;
    const marks = GUIDE.map((section) => ({
      id: section.id,
      el: column.querySelector(`#guide-${section.id}`),
    }))
      .filter((mark) => mark.el)
      .map((mark) => ({ id: mark.id, top: mark.el.getBoundingClientRect().top - top }));
    at =
      readingSection(marks, {
        line: LINE,
        atBottom: column.scrollTop + column.clientHeight >= column.scrollHeight - 4,
      }) ?? at;
  }

  // The guard is its own flag rather than the frame handle: a handle is only assigned
  // once `requestAnimationFrame` returns, so anything that runs the callback before
  // that would leave a number behind and wedge this shut.
  function follow() {
    if (steering || pending || !column) return;
    pending = true;
    frame = requestAnimationFrame(measure);
  }

  $effect(() => {
    const el = column;
    if (!el) return;
    el.addEventListener('scroll', follow, { passive: true });
    return () => {
      el.removeEventListener('scroll', follow);
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(steering);
    };
  });

  /**
   * Jump to a section, and let the press own the list until it lands.
   *
   * Without that, the scroll it starts walks the highlight down every section on the
   * way, so the one control that says *go here* answers by pointing somewhere else
   * three times first.
   */
  function show(id) {
    at = id;
    clearTimeout(steering);
    steering = setTimeout(() => {
      steering = 0;
      follow();
    }, STEER);
    const target = column?.querySelector(`#guide-${id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Open the workspace a section describes, from the section itself. A guide that
   *  cannot be left at the thing it just explained is a document, not help. */
  function go(section) {
    const first = section.tools[0];
    if (first) uiState.tool = first;
  }

  /**
   * Arrive on a section, because the `?` in the topbar asked for it.
   *
   * The request is consumed rather than kept: it says *go there now*, and a reader who
   * then scrolls somewhere else must not be sent back the next time this tab is shown.
   * A frame is waited for because the column is laid out after this tab becomes the
   * visible one, and a heading measured in a hidden panel is at zero.
   */
  $effect(() => {
    const wanted = uiState.guideSection;
    if (!wanted) return;
    uiState.guideSection = null;
    requestAnimationFrame(() => show(wanted));
  });
</script>

<div class="tool">
  <div class="tool-body" bind:this={column}>
    <div class="sheet">
      <nav class="contents" aria-label="Guide contents">
        {#each GUIDE as section (section.id)}
          <button class="jump" class:on={at === section.id} onclick={() => show(section.id)}>
            <Icon name={iconOf(section)} size={14} />
            <span>{section.title}</span>
          </button>
        {/each}
      </nav>

      <div class="body">
        {#each GUIDE as section (section.id)}
          <section id="guide-{section.id}">
            <header>
              <h2><Icon name={iconOf(section)} size={17} />{section.title}</h2>
              {#if section.tools.length}
                <button class="aside" onclick={() => go(section)}>
                  Open it
                  <Icon name="arrowRight" size={13} />
                </button>
              {/if}
            </header>
            <p class="lead">{section.lead}</p>

            {#if section.tools.length}
              <p class="tabs">
                {#each section.tools as tool, i (tool)}
                  {#if i > 0}<span class="dot">·</span>{/if}<span>{TOOL_LABELS[tool] ?? tool}</span>
                {/each}
              </p>
            {/if}

            {#if section.points?.length}
              <dl>
                {#each section.points as point (point.label)}
                  <dt>{point.label}</dt>
                  <dd>{point.text}</dd>
                {/each}
              </dl>
            {/if}

            <!-- A job, tab by tab. The tool on each step is the control, not a label:
                 reading how something is done and then hunting for the tab it is done
                 in is the part a guide is supposed to remove. -->
            {#if section.recipes?.length}
              <div class="recipes">
                {#each section.recipes as recipe (recipe.title)}
                  <article class="recipe">
                    <h3>{recipe.title}</h3>
                    <p class="recipe-lead">{recipe.lead}</p>
                    <ol>
                      {#each recipe.steps as step, i (step.tool + i)}
                        <li>
                          <span class="step-n">{i + 1}</span>
                          <button class="step-tool" onclick={() => (uiState.tool = step.tool)}>
                            {TOOL_LABELS[step.tool] ?? step.tool}
                            <Icon name="arrowRight" size={11} />
                          </button>
                          <span class="step-say">{step.text}</span>
                        </li>
                      {/each}
                    </ol>
                  </article>
                {/each}
              </div>
            {/if}

            {#if section.keymap?.length}
              <div class="keymap">
                {#each section.keymap as group (group.where)}
                  <div class="keygroup">
                    <h3>{group.where}</h3>
                    <ul class="keys">
                      {#each group.keys as key (key.combo)}
                        <li><kbd>{key.combo}</kbd><span>{key.does}</span></li>
                      {/each}
                    </ul>
                  </div>
                {/each}
              </div>
            {/if}

            {#if section.fixes?.length}
              <dl class="fixes">
                {#each section.fixes as fix (fix.symptom)}
                  <dt>{fix.symptom}</dt>
                  <dd>{fix.fix}</dd>
                {/each}
              </dl>
            {/if}
          </section>
        {/each}

        <p class="tail">
          The full picture of what is shipped and what is planned lives in
          <a href={SPEC_URL} target="_blank" rel="noreferrer">
            docs/SPEC.md<Icon name="external" size={10} />
          </a>.
        </p>
      </div>
    </div>
  </div>
</div>

<style>
  .sheet {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    gap: 40px;
    max-width: 940px;
    margin: 0 auto;
    padding: 36px 28px 72px;
  }

  /* The contents list stays put while the text moves under it: six sections is more
     than fits a screen, and a reader who has scrolled has nothing else to navigate by. */
  .contents {
    position: sticky;
    top: 36px;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .jump {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border-left: 2px solid transparent;
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
    color: var(--text-3);
    font-size: var(--fs-sm);
    font-weight: 500;
    text-align: left;
    transition: color 0.14s var(--ease), background 0.14s var(--ease);
  }
  .jump:hover {
    color: var(--text-1);
    background: var(--bg-1);
  }
  .jump.on {
    color: var(--text-1);
    border-left-color: var(--accent);
  }

  section {
    padding-bottom: 34px;
    margin-bottom: 34px;
    border-bottom: 1px solid var(--border);
    scroll-margin-top: 24px;
  }
  section:last-of-type {
    border-bottom: 0;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: var(--fs-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .lead {
    margin-top: 7px;
    font-size: var(--fs-md);
    color: var(--text-2);
    line-height: 1.6;
  }
  /* Which tabs the section is about, in the words the tab strip uses. */
  .tabs {
    margin-top: 9px;
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
  }

  dl {
    margin: 22px 0 0;
  }
  dt {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
  }
  dd {
    margin: 3px 0 16px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: 1.62;
  }
  dd:last-child {
    margin-bottom: 0;
  }

  /* ---- worked examples ------------------------------------------------------ */

  .recipes {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 22px;
  }
  .recipe {
    padding: 16px 18px 18px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
  }
  .recipe h3 {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-1);
  }
  .recipe-lead {
    margin-top: 3px;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .recipe ol {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    counter-reset: step;
  }
  /* Number, tab, sentence: three columns rather than a wrapped line, so the steps
     read down the tabs they happen in instead of starting in a different place each
     time the tool's name changes length. */
  .recipe li {
    display: grid;
    grid-template-columns: 1.45rem 8rem minmax(0, 1fr);
    gap: 0 12px;
    align-items: start;
    padding-bottom: 12px;
  }
  .recipe li:last-child {
    padding-bottom: 0;
  }
  @media (max-width: 820px) {
    .recipe li {
      grid-template-columns: 1.45rem minmax(0, 1fr);
      row-gap: 5px;
    }
    .step-tool,
    .step-say {
      grid-column: 2;
    }
  }
  .step-n {
    flex-shrink: 0;
    width: 1.45rem;
    height: 1.45rem;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--bg-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    line-height: 1.35rem;
    text-align: center;
    color: var(--text-2);
  }
  .step-say {
    padding-top: 1px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: 1.6;
  }
  .step-tool {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    padding: 1px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-1);
    transition: border-color 0.14s var(--ease), color 0.14s var(--ease);
  }
  .step-tool:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ---- the keys ------------------------------------------------------------- */

  .keymap {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
    margin-top: 22px;
  }
  .keygroup {
    padding: 12px 14px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
  }
  .keygroup h3 {
    margin-bottom: 9px;
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
  }
  /* One grid for the whole card rather than one per row, so every key in a card
     starts at the same place and its sentence wraps in its own column instead of
     dropping whole to the next line. */
  .keys {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 7px 11px;
    align-items: baseline;
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .keys li {
    display: contents;
  }

  /* ---- when something does not work ----------------------------------------- */

  .fixes dt {
    padding-left: 13px;
    border-left: 2px solid var(--warn);
  }
  .fixes dd {
    padding-left: 15px;
  }
  kbd {
    justify-self: start;
    white-space: nowrap;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-1);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-align: center;
  }

  .aside {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-3);
    transition: color 0.14s var(--ease);
  }
  .aside:hover {
    color: var(--accent);
  }

  .dot {
    margin: 0 7px;
    opacity: 0.55;
  }
  .tail {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .tail a {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--accent);
  }
</style>
