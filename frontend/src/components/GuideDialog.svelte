<script>
  /**
   * The guide the `?` in the topbar opens: a menu on the left, the tools of a workspace
   * as tabs, and on a tool's tab a picture of it with its controls numbered.
   *
   * It opens on whatever asked for it (`at`: a tool, a page or a journey), read once:
   * what the reader then browses to is theirs. A number that leads somewhere opens the
   * screen it leads to in the same place, with a trail back, so a page reads as a
   * sequence. A journey walks one goal across the tools, each step on the picture of
   * the tool it happens in, and ends on what it made. A page can come in tabs of its
   * own, as the extension's does. The pages and their pictures are `lib/guide.js`.
   *
   * `detached` is the same guide in a tab of its own (`lib/guideWindow.js`), opened on
   * `place`: it fills the tab, keeps its place in the address, and what it would do to
   * the app it asks of the tab that detached it.
   */
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import GuideShot from './GuideShot.svelte';
  import { toast, uiState } from '../lib/state.svelte.js';
  import { openIssueReport, openTour } from '../lib/navigate.js';
  import { askApp, guideHash, openGuideTab } from '../lib/guideWindow.js';
  import {
    EXTENSION_SITES,
    FIXES,
    JOURNEYS,
    KEYMAP,
    MENU,
    MENU_ITEMS,
    PAGES,
    journeysThrough,
    landingFor,
    opensFrom,
    shotOf,
    stepMarks,
    stepShot,
    tabLabel,
    toolLabel,
  } from '../lib/guide.js';

  let { at, onclose, place = null, detached = false } = $props();

  const landing = untrack(() => place) ?? { ...landingFor(untrack(() => at)), step: 0 };
  let itemId = $state(landing.item);
  let tool = $state(landing.tool);
  let step = $state(landing.step);
  let active = $state(null);
  /** The screens opened from a number, deepest last. Empty on the page itself. */
  let trail = $state(landing.opens ? [opensFrom(landing.tool, landing.opens)].filter(Boolean) : []);

  const item = $derived(MENU_ITEMS.find((entry) => entry.id === itemId) ?? MENU_ITEMS[0]);
  const journey = $derived(
    item.kind === 'journey' ? JOURNEYS.find((one) => `journey:${one.id}` === item.id) : null
  );

  /** The step past a journey's last one, where what it made is shown. */
  const resultStep = $derived(journey?.result ? journey.steps.length : null);
  /** The furthest a journey's Next goes: its result, or its last step. */
  const lastStep = $derived(journey ? (resultStep ?? journey.steps.length - 1) : 0);
  /** The tab of a tabbed page that holds the table of where the extension works. */
  const sites = $derived(item.kind === 'tabs' && tool === 'extension-sites');

  /** What the picture area shows: its page, the picture's name and the marks drawn on it. */
  const view = $derived.by(() => {
    if (item.kind === 'page') return pageView(PAGES[item.id], PAGES[item.id].title);
    if (item.kind === 'workspace' && tool) return pageView(PAGES[tool], toolLabel(tool));
    // a page's own tabs explain the page, and open no tool
    if (item.kind === 'tabs' && PAGES[tool]) return { ...pageView(PAGES[tool], tabLabel(tool)), tool: null };
    if (journey && step === resultStep) {
      return { lead: journey.result.text, shot: journey.result.shot, marks: [], tips: [], tool: null };
    }
    if (journey) {
      const current = journey.steps[step];
      return {
        lead: current.text,
        shot: stepShot(current),
        // a step reads one control at a time, so its numbers lead nowhere else
        marks: stepMarks(current).map(({ opens, ...mark }) => mark),
        tips: [],
        tool: current.tool,
      };
    }
    return null;
  });

  function pageView(page, title) {
    if (!page) return null;
    const last = trail.at(-1);
    if (last) return { lead: last.lead, shot: last.shot, marks: last.marks ?? [], tips: last.tips ?? [], more: last.more, walk: last.walk, tool, title };
    return { lead: page.lead, shot: page.shot, marks: page.marks, tips: page.tips ?? [], more: page.more, tool, title };
  }

  const picture = $derived(view ? shotOf(view.shot) : null);
  const through = $derived(item.kind === 'workspace' && tool ? journeysThrough(tool) : []);

  function reset() {
    active = null;
    trail = [];
  }

  function choose(entry) {
    itemId = entry.id;
    tool = entry.tools[0] ?? null;
    step = 0;
    reset();
  }

  function pick(next) {
    tool = next;
    reset();
  }

  function goStep(index) {
    step = index;
    reset();
  }

  function openJourney(id, at = 1) {
    itemId = `journey:${id}`;
    tool = null;
    step = at - 1;
    reset();
  }

  /** A number that leads somewhere: show the screen it opens, with the way back. */
  function follow(index) {
    const mark = view?.marks[index];
    if (!mark?.opens) return;
    trail = [...trail, { ...mark.opens, from: mark.title }];
    active = null;
  }

  function back(depth) {
    trail = trail.slice(0, depth);
    active = null;
  }

  // a tab of its own keeps where the reader stands in its address, so a reload lands there
  $effect(() => {
    if (detached) history.replaceState(history.state, '', guideHash({ item: itemId, tool, step }));
  });

  function openTool(id) {
    if (detached) return askApp({ open: id });
    uiState.tool = id;
    onclose();
  }

  /** The newcomer's tour, over the app this guide was opened from (components/Onboarding.svelte). */
  function takeTour() {
    onclose();
    openTour();
  }

  /** Settings, System: the report there carries what the app knows of the problem. */
  function reportIssue() {
    if (detached) return askApp({ report: true });
    openIssueReport();
    onclose();
  }

  function detach() {
    if (!openGuideTab({ item: itemId, tool, step })) {
      toast('The browser refused a second tab. Allow pop-ups for this page', 'warn', 8000);
      return;
    }
    onclose();
  }

  const toggle = (n) => (active = active === n ? null : n);
</script>

{#snippet legend(marks)}
  <ol class="legend">
    {#each marks as mark, index (mark.anchor)}
      <li class:on={active === index + 1}>
        <button
          class="mark"
          onmouseenter={() => (active = index + 1)}
          onmouseleave={() => (active = null)}
          onfocus={() => (active = index + 1)}
          onblur={() => (active = null)}
          onclick={() => toggle(index + 1)}
        >
          <span class="num">{index + 1}</span>
          <span class="words">
            <strong>{mark.title}</strong>
            <span>{mark.text}</span>
          </span>
        </button>
        {#if mark.opens}
          <button class="leads" onclick={() => follow(index)}>
            See what it opens <Icon name="chevronRight" size={12} />
          </button>
        {/if}
      </li>
    {/each}
  </ol>
{/snippet}

{#snippet trailBar(title)}
  {#if trail.length}
    <nav class="trail" aria-label="Where this screen opens from">
      <button onclick={() => back(0)}><Icon name="chevronLeft" size={13} /> {title}</button>
      {#each trail as crumb, depth (depth)}
        <Icon name="chevronRight" size={12} />
        {#if depth === trail.length - 1}
          <span>{crumb.from}</span>
        {:else}
          <button onclick={() => back(depth + 1)}>{crumb.from}</button>
        {/if}
      {/each}
    </nav>
  {/if}
{/snippet}

{#snippet content()}
  <div class="guide">
    <nav class="menu" aria-label="Guide pages">
      {#each MENU as group, index (index)}
        {#if group.title}<p class="group">{group.title}</p>{/if}
        {#each group.items as entry (entry.id)}
          <button
            class="entry"
            class:on={entry.id === item.id}
            aria-current={entry.id === item.id ? 'page' : undefined}
            onclick={() => choose(entry)}
          >
            <Icon name={entry.icon} size={15} />
            <span>{entry.label}</span>
          </button>
        {/each}
      {/each}
    </nav>

    <section class="page" aria-label={item.label}>
      <header class="head">
        <div class="titles">
          <h2>{item.label}</h2>
          {#if item.kind !== 'page' && item.lead}<p class="sub">{item.lead}</p>{/if}
        </div>
        {#if !detached}
          <div class="head-acts">
            <button class="btn btn-ghost btn-sm" onclick={detach} aria-label="Open in a new tab" title="Open in a new tab, to follow on another screen">
              <Icon name="external" size={15} />
            </button>
            <button class="btn btn-ghost btn-sm" onclick={onclose} aria-label="Close" title="Close">
              <Icon name="x" size={15} />
            </button>
          </div>
        {/if}
      </header>

      {#if item.kind === 'workspace' || item.kind === 'tabs'}
        <div class="tabs">
          {#each item.tools as option (option)}
            <button
              class="tab"
              class:on={option === tool}
              aria-current={option === tool ? 'page' : undefined}
              onclick={() => pick(option)}
            >
              {tabLabel(option)}
            </button>
          {/each}
        </div>
      {:else if journey}
        <ol class="steps">
          {#each journey.steps as one, index (index)}
            <li>
              <button
                class="step"
                class:on={index === step}
                class:done={index < step}
                aria-current={index === step ? 'step' : undefined}
                onclick={() => goStep(index)}
              >
                <span class="num">{index + 1}</span>
                {one.label ?? toolLabel(one.tool)}
              </button>
              {#if index < lastStep}<Icon name="chevronRight" size={13} />{/if}
            </li>
          {/each}
          {#if resultStep !== null}
            <li>
              <button
                class="step result"
                class:on={step === resultStep}
                aria-current={step === resultStep ? 'step' : undefined}
                onclick={() => goStep(resultStep)}
              >
                <Icon name="flag" size={13} />
                Result
              </button>
            </li>
          {/if}
        </ol>
      {/if}

      {#if view && picture}
        <div class="body">
          <div class="picture">
            {@render trailBar(view.title)}
            <p class="lead" class:instruction={Boolean(journey)}>{view.lead}</p>
            <GuideShot shot={picture} marks={view.marks} bind:active onopen={follow} />
            {#if view.tips.length}
              <section class="tips" aria-label="Tips">
                <p class="tips-head"><Icon name="bulb" size={14} /> Tips</p>
                <ul>
                  {#each view.tips as tip (tip.title)}
                    <li>
                      <strong>{tip.title}</strong>
                      <span>{tip.text}</span>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          </div>
          <aside class="side">
            {@render legend(view.marks)}
            {#if view.more}
              <!-- read on GitHub, a press away: the guide itself stays offline -->
              <a class="more" href={view.more.href} target="_blank" rel="noreferrer">
                <Icon name="note" size={14} />{view.more.text}<Icon name="external" size={11} />
              </a>
            {/if}
            {#if view.walk}
              {@const walked = JOURNEYS.find((one) => one.id === view.walk)}
              <div class="journeys">
                <p class="group">Walk it through</p>
                <button class="journey" onclick={() => openJourney(walked.id)}>
                  <span>{walked.title}</span>
                  <span class="at">{walked.steps.length} steps</span>
                </button>
              </div>
            {/if}
            {#if through.length && !trail.length}
              <div class="journeys">
                <p class="group">In these journeys</p>
                {#each through as one (one.id)}
                  <button class="journey" onclick={() => openJourney(one.id, one.step)}>
                    <span>{one.title}</span>
                    <span class="at">Step {one.step}</span>
                  </button>
                {/each}
              </div>
            {/if}
            {#if journey}
              <div class="walk">
                <button class="btn btn-sm" disabled={step === 0} onclick={() => goStep(step - 1)}>
                  <Icon name="chevronLeft" size={13} /> Back
                </button>
                <button class="btn btn-sm" disabled={step === lastStep} onclick={() => goStep(step + 1)}>
                  Next <Icon name="chevronRight" size={13} />
                </button>
              </div>
            {/if}
            <!-- the tour plays over the app, so a guide in a tab of its own leaves it out -->
            {#if item.id === 'start' && !trail.length && !detached}
              <button class="btn btn-primary go" onclick={takeTour}>
                Take the tour
                <Icon name="arrowRight" size={14} />
              </button>
            {/if}
            {#if view.tool}
              <button class="btn btn-primary go" onclick={() => openTool(view.tool)}>
                Open {toolLabel(view.tool)}
                <Icon name="arrowRight" size={14} />
              </button>
            {/if}
          </aside>
        </div>
      {:else if sites}
        <div class="sites">
          <p class="lead">{EXTENSION_SITES.lead}</p>
          <div class="grid-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">View</th>
                  {#each EXTENSION_SITES.columns as column (column)}<th scope="col">{column}</th>{/each}
                </tr>
              </thead>
              <tbody>
                {#each EXTENSION_SITES.rows as row, index (row.view)}
                  <tr>
                    <th scope="row">
                      {row.view}
                      {#if index === 0}
                        <span class="names">
                          {#each EXTENSION_SITES.sites as name (name)}<span>{name}</span>{/each}
                        </span>
                      {/if}
                    </th>
                    {#each row.cells as cell, at (at)}
                      <td>
                        {#if cell === 'yes'}
                          <span class="yes" role="img" aria-label="Yes"><Icon name="check" size={15} /></span>
                        {:else if cell === 'no'}
                          <span class="no" role="img" aria-label="No">–</span>
                        {:else}
                          <span class="says">{cell}</span>
                        {/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="elsewhere">
            {#each EXTENSION_SITES.elsewhere as one (one.where)}
              <section class="card-block">
                <h3>{one.where}</h3>
                <p>{one.text}</p>
              </section>
            {/each}
          </div>
        </div>
      {:else if item.kind === 'shortcuts'}
        <div class="reference keys">
          {#each KEYMAP as block (block.where)}
            <section class="card-block">
              <h3>{block.where}</h3>
              <dl>
                {#each block.keys as key (key.combo)}
                  <dt><kbd>{key.combo}</kbd></dt>
                  <dd>{key.does}</dd>
                {/each}
              </dl>
            </section>
          {/each}
        </div>
      {:else if item.kind === 'trouble'}
        <div class="reference fixes">
          {#each FIXES as one (one.symptom)}
            <section class="card-block">
              <h3>{one.symptom}</h3>
              <p>{one.fix}</p>
            </section>
          {/each}
        </div>
        <section class="report" aria-label="Report an issue">
          <div class="report-words">
            <h3>Still stuck?</h3>
            <p>Report an issue writes the version, the system and the last warnings with your paths and keys removed, and opens it on GitHub.</p>
          </div>
          <button class="btn btn-primary btn-sm" onclick={reportIssue}>
            Report an issue <Icon name="arrowRight" size={13} />
          </button>
        </section>
      {/if}
    </section>
  </div>
{/snippet}

{#if detached}
  <main class="detached" aria-label="Guide">{@render content()}</main>
{:else}
  <Modal title="Guide" bare width="min(1400px, calc(100vw - 48px))" {onclose}>{@render content()}</Modal>
{/if}

<style>
  .guide {
    display: grid;
    grid-template-columns: 216px minmax(0, 1fr);
    height: min(860px, calc(100vh - 96px));
  }
  .detached {
    height: 100vh;
    background: var(--bg-1);
  }
  .detached .guide {
    height: 100%;
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 14px 10px;
    border-right: 1px solid var(--border);
    background: var(--bg-0);
    overflow-y: auto;
  }
  .group {
    margin: 14px 8px 6px;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border-radius: var(--r-md);
    color: var(--text-2);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .entry:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .entry.on {
    background: var(--bg-3);
    color: var(--text-1);
    box-shadow: inset 2px 0 0 var(--text-1);
  }

  .page {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px 8px 22px;
  }
  .head-acts {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  h2 {
    font-size: var(--fs-xl);
    font-weight: 700;
  }
  .sub {
    margin-top: 3px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .tabs,
  .steps {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 0 22px;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    padding: 8px 12px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover {
    color: var(--text-1);
  }
  .tab.on {
    color: var(--text-1);
    border-bottom-color: var(--text-1);
  }
  .steps {
    list-style: none;
    margin: 0;
    padding-bottom: 10px;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
  }
  .steps li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px 5px 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .step:hover {
    color: var(--text-1);
  }
  .step.on {
    border-color: var(--text-2);
    color: var(--text-1);
    background: var(--bg-2);
  }
  .step .num {
    width: 20px;
    height: 20px;
  }
  .step.done .num {
    background: var(--bg-3);
    color: var(--text-2);
  }
  .step.result {
    padding-left: 10px;
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 272px;
    gap: 22px;
    padding: 16px 22px 22px;
  }
  .trail {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .trail button {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--text-2);
  }
  .trail button:hover {
    color: var(--text-1);
  }
  .trail span {
    color: var(--text-1);
  }
  .lead {
    margin-bottom: 12px;
    color: var(--text-2);
    font-size: var(--fs-md);
  }
  /* the height a picture may take: the dialog's, less its header, tabs and lead */
  .picture {
    --shot-room: calc(min(860px, 100vh - 96px) - 200px);
  }
  .lead.instruction {
    color: var(--text-1);
  }
  /* Tips read as one note under the picture, in the info colour, rather than as more
     cards: framed like the picture's controls, they passed for part of the screen. */
  .tips {
    margin-top: 18px;
    padding: 12px 16px 14px;
    border: 1px solid color-mix(in srgb, var(--info) 28%, transparent);
    border-radius: var(--r-md);
    background: var(--info-soft);
  }
  .tips-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--info);
  }
  .tips ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px 22px;
  }
  .tips li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: 11px;
    border-left: 2px solid color-mix(in srgb, var(--info) 50%, transparent);
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: 1.45;
  }
  .tips strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .more {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--info);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-decoration: none;
  }
  .more:hover {
    text-decoration: underline;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-top: 2px;
  }
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .legend li {
    border-radius: var(--r-md);
    transition: background 0.15s var(--ease);
  }
  .legend li:hover,
  .legend li.on {
    background: var(--bg-2);
  }
  .legend li.on .num {
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.16);
  }
  .mark {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    width: 100%;
    padding: 8px 9px;
    text-align: left;
  }
  .num {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: #f5f5f5;
    color: #111;
    font-size: 11.5px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    transition: box-shadow 0.15s var(--ease);
  }
  .words {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: 1.4;
  }
  .words strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .leads {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin: -2px 0 9px 42px;
    padding: 2px 6px 2px 9px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    font-size: var(--fs-xs);
    color: var(--text-1);
    transition: background 0.15s var(--ease);
  }
  .leads:hover {
    background: var(--bg-3);
  }
  .journeys {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .journeys .group {
    margin: 0 0 4px;
  }
  .journey {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 9px;
    border-radius: var(--r-md);
    background: var(--bg-2);
    font-size: var(--fs-sm);
    color: var(--text-1);
    text-align: left;
  }
  .journey:hover {
    background: var(--bg-3);
  }
  .at {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .walk {
    display: flex;
    gap: 8px;
  }
  .go {
    align-self: flex-start;
    gap: 7px;
  }

  .sites {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 22px 22px;
  }
  .sites .lead {
    margin: 0;
  }
  .grid-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
  }
  table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  th,
  td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
    line-height: 1.4;
  }
  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: 0;
  }
  thead th {
    background: var(--bg-2);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  tbody th {
    width: 34%;
    font-weight: 600;
    color: var(--text-1);
  }
  .names {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }
  .names span {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-2);
  }
  .yes {
    color: var(--ok);
  }
  .no {
    color: var(--text-3);
  }
  .says {
    color: var(--text-2);
  }
  .elsewhere {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
  .elsewhere .card-block {
    margin: 0;
  }

  .reference {
    padding: 16px 22px 22px;
    columns: 2 340px;
    column-gap: 14px;
  }
  .report {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 0 22px 22px;
    padding: 14px 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--bg-2);
  }
  .report-words {
    flex: 1;
    min-width: 0;
  }
  .report h3 {
    margin-bottom: 4px;
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-1);
  }
  .report p {
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: 1.45;
  }
  .card-block {
    break-inside: avoid;
    margin-bottom: 14px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
  }
  .card-block h3 {
    margin-bottom: 8px;
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-1);
  }
  .card-block p {
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: 1.45;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: var(--fs-sm);
  }
  dt {
    white-space: nowrap;
  }
  dd {
    margin: 0;
    color: var(--text-2);
    line-height: 1.4;
  }
  kbd {
    display: inline-block;
    padding: 1px 6px;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: var(--r-sm);
    background: var(--bg-1);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-1);
  }
</style>
