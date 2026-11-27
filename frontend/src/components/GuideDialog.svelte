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
   * A journey fills the guide, its menu folded away: each step plays over its screen
   * (components/JourneyStage.svelte), what to press lit one action at a time, and a
   * trail of its steps runs under it (components/JourneyTrail.svelte). A journey that
   * reads the case pins the step the open case has reached (`lib/journeyHere.js`) and
   * opens on it. Show me closes the guide on the step's tool with the control being read
   * ringed in the app (`lib/showInApp.svelte.js`). The geolocation journey can also be
   * practised on a real photo whose place is known (`lib/practiceCase.js`), and its
   * result then says how close the answer came.
   *
   * `detached` is the same guide in a tab of its own (`lib/guideWindow.js`), opened on
   * `place`: it fills the tab, keeps its place in the address, and what it would do to
   * the app it asks of the tab that detached it.
   */
  import { tick, untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import GuideShot from './GuideShot.svelte';
  import JourneyStage from './JourneyStage.svelte';
  import JourneyTrail, { stepIcon } from './JourneyTrail.svelte';
  import { caseState, prefs, toast, uiState } from '../lib/state.svelte.js';
  import { openIssueReport, openTour } from '../lib/navigate.js';
  import { askApp, guideHash, openGuideTab } from '../lib/guideWindow.js';
  import { openFindExample } from '../lib/findExample.js';
  import { gatherFacts, hereOn } from '../lib/journeyHere.js';
  import { showInApp } from '../lib/showInApp.svelte.js';
  import { checkAnswer, isPractice, openPractice } from '../lib/practiceCase.js';
  import { formatDistance } from '../lib/measure.js';
  import { GUIDE_SEARCH_MIN, searchGuide, trailTo } from '../lib/guideSearch.js';
  import { foldTerms } from '../lib/textFold.js';
  import {
    EXTENSION_SITES,
    FIXES,
    JOURNEY_CAVEAT,
    JOURNEYS,
    KEYMAP,
    MENU,
    MENU_ITEMS,
    PAGES,
    journeyEdges,
    journeyNodes,
    journeyResult,
    journeysThrough,
    landingFor,
    markShot,
    opensFrom,
    shotOf,
    stepAs,
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
  const landedTrail = landing.path?.length ? trailTo(landing.tool ?? landing.item, landing.path)
    : landing.opens ? [opensFrom(landing.tool, landing.opens)].filter(Boolean) : [];
  /** The screens opened from a number, deepest last. Empty on the page itself. */
  let trail = $state(landedTrail);
  // a number asked for by name (a search, Ctrl+K) is lit as the guide opens on it
  let active = $state(landing.mark ? litNumber(landing.tool ?? landing.item, landedTrail, landing.mark) : null);
  /** A photo or a video, as the reader picked a journey's start; else as the case says. */
  let chosenKind = $state(null);
  /** Where the open case stands on the journey (`lib/journeyHere.js`), or null. */
  let where = $state(null);
  // a reader who already chose a step is not moved to where the case stands
  let moved = landing.step > 0;
  /** A journey opens on its welcome: what it walks, and that it is one example. */
  let welcome = $state(String(landing.item ?? '').startsWith('journey:') && !(landing.step > 0));
  /** The action of the step being read, the steps read before it, and where the last press landed. */
  let act = $state(0);
  let behind = $state([]);
  let landed = $state(null);
  /** The menu beside a journey, kept as the reader left it: shown until Guide folds it. */
  let menuShown = $state(true);

  const item = $derived(MENU_ITEMS.find((entry) => entry.id === itemId) ?? MENU_ITEMS[0]);
  const journey = $derived(
    item.kind === 'journey' ? JOURNEYS.find((one) => `journey:${one.id}` === item.id) : null
  );
  const nodes = $derived(journey ? journeyNodes(journey) : []);
  const kind = $derived(chosenKind ?? where?.kind ?? null);
  /** The start being read on, where a journey has one per kind of file: a photo's unless a video's was picked. */
  const branch = $derived.by(() => {
    if (!nodes.some((node) => node.kind)) return null;
    const start = nodes.find((node) => node.at[0] === 0 && (node.kind ?? 'photo') === (kind ?? 'photo'));
    return start ? { icon: stepIcon(start), label: start.label } : null;
  });
  const practising = $derived(isPractice(caseState.current));

  // read once a journey that reads the case opens on the practice case, from the tab the
  // app runs in: elsewhere the trail follows the reader alone
  $effect(() => {
    const caseId = caseState.current?.id;
    const reads = journey?.reads && isPractice(caseState.current);
    where = null;
    if (!reads || detached || !caseId) return;
    let gone = false;
    untrack(() => gatherFacts(caseId))
      .then((facts) => {
        if (gone) return;
        // the proved scene's point stays with the facts, for the practice case's answer
        where = { ...hereOn(facts), point: facts.point };
        const at = untrack(() => nodes.findIndex((node) => node.id === where.here));
        if (!moved && at >= 0) step = at;
      })
      // a case that cannot be read leaves the map showing only the way
      .catch(() => {});
    return () => (gone = true);
  });

  /** The step past a journey's last one, where what it made is shown. */
  const resultStep = $derived(journey?.result ? journey.steps.length : null);
  /** The tab of a tabbed page that holds the table of where the extension works. */
  const sites = $derived(item.kind === 'tabs' && tool === 'extension-sites');

  /** What the picture area shows: its page, the picture's name and the marks drawn on it. */
  const view = $derived.by(() => {
    if (item.kind === 'page') return pageView(PAGES[item.id], PAGES[item.id].title);
    if (item.kind === 'workspace' && tool) return pageView(PAGES[tool], toolLabel(tool));
    // a page's own tabs explain the page, and open no tool
    if (item.kind === 'tabs' && PAGES[tool]) return { ...pageView(PAGES[tool], tabLabel(tool)), tool: null };
    return null;
  });

  /** The journey's step being played: its screen, and each control to press on it in order. */
  const stage = $derived.by(() => {
    if (!journey) return null;
    if (welcome) {
      const made = journeyResult(journey, kind);
      // the tools it goes through, in the order it meets them
      const tools = [...new Set(journey.steps.map((one) => one.tool))].map((id) => ({ id, label: toolLabel(id), icon: stepIcon({ tool: id }) }));
      const starts = nodes.filter((node) => node.at[0] === 0).map((node) => ({ id: node.id, label: node.label, icon: stepIcon(node) }));
      return { id: 'welcome', welcome: true, shot: made.shot, title: journey.title, lead: journey.lead, tools, starts, marks: [] };
    }
    if (step === resultStep) {
      // the step the reader came from picks the ending, where a journey has more than one
      const made = journeyResult(journey, kind, idOf(behind.at(-1)));
      return { id: 'result', result: true, label: resultLabel, shot: made.shot, text: made.text, example: made.example, marks: [] };
    }
    const current = stepAs(journey.steps[step], kind);
    return {
      ...current,
      id: nodes[step].id,
      shot: stepShot(current),
      // a step reads one control at a time, so its numbers lead nowhere else
      marks: stepMarks(current).map(({ opens, ...mark }) => ({ ...mark, shot: markShot(current, mark) })),
    };
  });

  function pageView(page, title) {
    if (!page) return null;
    const last = trail.at(-1);
    if (last) return { lead: last.lead, shot: last.shot, marks: last.marks ?? [], tips: last.tips ?? [], more: last.more, walk: last.walk, tool, title };
    return { lead: page.lead, shot: page.shot, marks: page.marks, tips: page.tips ?? [], more: page.more, tool, title };
  }

  const picture = $derived(view ? shotOf(view.shot) : null);
  /** Where a step leads once its last control is pressed: the first way out, or the result after the last. */
  const onward = $derived.by(() => {
    if (!stage || stage.result || stage.ask) return null;
    const out = journeyEdges(journey).find((edge) => edge.from === stage.id);
    return out?.to ?? (journey.result ? 'result' : null);
  });
  const resultLabel = $derived(journey?.practice && practising ? 'Your answer' : 'Result');
  /** The id of a journey's step by its place, its result past the last. */
  const idOf = (index) => (index === resultStep ? 'result' : nodes[index]?.id);
  const pickedId = $derived(journey && !welcome ? idOf(step) : null);
  /** How close the practice case's proof came to where the photo was taken. */
  const answer = $derived.by(() => {
    if (!practising || !where?.point) return null;
    const { metres, right } = checkAnswer(where.point);
    return { right, said: `Your point is ${formatDistance(metres, prefs.units)} from where the photo was taken.` };
  });
  const through = $derived(item.kind === 'workspace' && tool ? journeysThrough(tool) : []);

  function reset() {
    active = null;
    trail = [];
  }

  function choose(entry) {
    itemId = entry.id;
    welcome = entry.kind === 'journey';
    tool = entry.tools[0] ?? null;
    step = 0;
    act = 0;
    behind = [];
    landed = null;
    reset();
  }

  function pick(next) {
    tool = next;
    reset();
  }

  function goStep(index) {
    welcome = false;
    if (index !== step) behind.push(step);
    step = index;
    act = 0;
    moved = true;
    landed = null;
    reset();
  }

  /** A step of the journey: a start sets the kind of file walked with, the result ends it. */
  function pickNode(id) {
    if (id === 'result') return goStep(resultStep);
    const at = nodes.findIndex((node) => node.id === id);
    if (at < 0) return;
    // a journey with a start per kind of file reads on as the start picked
    if (nodes.some((node) => node.kind) && nodes[at].at[0] === 0) chosenKind = nodes[at].kind ?? 'photo';
    goStep(at);
  }

  /**
   * Past the welcome, on the start pressed: a journey with a start per kind of file reads
   * on as that one. A step the case already stands at is kept (`where`).
   */
  function begin(id) {
    welcome = false;
    const at = nodes.findIndex((node) => node.id === id);
    if (at < 0) return;
    if (nodes.some((node) => node.kind)) chosenKind = nodes[at].kind ?? 'photo';
    if (nodes[step]?.at[0] === 0) step = at;
    act = 0;
  }

  /** The step's last control pressed: on to where it leads, saying where that landed. */
  function pressed() {
    const then = stage.then;
    if (!onward) return;
    pickNode(onward);
    if (then) landed = { text: then };
  }

  /** Back the way the reader came, on the last action of that step. */
  function stepBack() {
    const before = behind.pop();
    if (before === undefined) return;
    step = before;
    landed = null;
    act = Math.max(0, (stage?.marks.length ?? 1) - 1);
  }

  function openJourney(id, at = 1) {
    itemId = `journey:${id}`;
    welcome = at <= 1;
    tool = null;
    step = at - 1;
    act = 0;
    behind = [];
    landed = null;
    moved = at > 1;
    chosenKind = null;
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

  /** The step's tool, the control being read pointed at in the app itself. */
  function showMe(mark) {
    // a press made on another tool's screen (Media before Inspect) is shown there
    const ask = {
      tool: mark.tool ?? stage.tool,
      anchor: mark.anchor,
      label: mark.title,
      press: mark.text,
      ...(stage.sidebar ? { sidebar: stage.sidebar } : {}),
      ...(mark.settings ? { settings: mark.settings } : {}),
    };
    if (detached) return askApp({ show: ask });
    onclose();
    showInApp(ask);
  }

  // ← and → walk a journey's actions, as a press on the bubble does
  function onkey(event) {
    if (!stage || stage.ask || stage.result || event.target.closest?.('input, textarea')) return;
    if (event.key === 'ArrowRight' && act < stage.marks.length - 1) act += 1;
    else if (event.key === 'ArrowRight' && onward) pressed();
    else if (event.key === 'ArrowLeft' && act > 0) act -= 1;
    else if (event.key === 'ArrowLeft') stepBack();
    else return;
    event.preventDefault();
  }

  /** The practice case: a real photo whose place is known, filed in a case of its own. */
  function practise() {
    onclose();
    openPractice();
  }

  /** The newcomer's tour, over the app this guide was opened from (components/Onboarding.svelte). */
  function takeTour() {
    onclose();
    openTour();
  }

  /** The search this journey walked, ready to run in the app. */
  function tryExample() {
    if (detached) return askApp({ example: true });
    onclose();
    openFindExample();
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

  /** Which number of the screen, counted from 1, is `anchor`: the last screen opened, else the page. */
  function litNumber(page, opened, anchor) {
    const marks = opened.at(-1)?.marks ?? PAGES[page]?.marks ?? [];
    const at = marks.findIndex((mark) => mark.anchor === anchor);
    return at < 0 ? null : at + 1;
  }

  // -- the search at the top of the menu --------------------------------------------
  let query = $state('');
  let guideEl = $state(null);
  const found = $derived(foldTerms(query).join('').length >= GUIDE_SEARCH_MIN ? searchGuide(query, 30) : null);

  /** Open the guide where a search found the words: the page, the screens to it, the number lit, or the step. */
  async function goTo(place) {
    const entry = MENU_ITEMS.find((one) => one.id === place.item);
    if (!entry) return;
    query = '';
    if (entry.kind === 'journey') {
      openJourney(entry.id.slice('journey:'.length), (place.step ?? 0) + 1);
      return;
    }
    choose(entry);
    if (place.tool) pick(place.tool);
    trail = trailTo(place.tool ?? entry.id, place.path ?? []);
    if (place.mark) active = litNumber(place.tool ?? entry.id, trail, place.mark);
    await tick();
    guideEl?.querySelector('.legend li.on')?.scrollIntoView({ block: 'nearest' });
  }

  /** Enter opens the first answer; Escape empties the box before it closes the guide. */
  function searchKeys(event) {
    if (event.key === 'Enter' && found?.length) {
      event.preventDefault();
      goTo(found[0].place);
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      query = '';
    }
  }
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
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="guide" class:immersed={journey && !menuShown} onkeydown={journey ? onkey : undefined} bind:this={guideEl}>
    <nav class="menu" aria-label="Guide pages">
      <label class="find" title="Search every page, tip, journey step, shortcut and fix of the guide">
        <Icon name="search" size={14} />
        <input type="search" placeholder="Search the guide" aria-label="Search the guide" spellcheck="false" autocomplete="off"
          bind:value={query} onkeydown={searchKeys} />
      </label>
      {#if found}
        <div class="found" aria-label="Found in the guide">
          {#each found as hit (hit.id)}
            <button class="hit" onclick={() => goTo(hit.place)}>
              <span class="hit-title">{hit.title}</span>
              <span class="hit-where">{hit.where}</span>
            </button>
          {:else}
            <p class="nothing">Nothing in the guide uses these words. Try another one.</p>
          {/each}
        </div>
      {:else}
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
      {/if}
    </nav>

    <section class="page" aria-label={item.label}>
      <header class="head">
        {#if journey}
          <button class="btn btn-ghost btn-sm menu-toggle" onclick={() => (menuShown = !menuShown)} title={menuShown ? 'Hide the guide’s menu' : 'The guide’s menu'}>
            <Icon name={menuShown ? 'chevronLeft' : 'list'} size={14} /> Guide
          </button>
        {/if}
        <div class="titles">
          <h2>{item.label}{#if journey}<span class="caveat-mark" title={JOURNEY_CAVEAT} aria-label={JOURNEY_CAVEAT}><Icon name="info" size={15} /></span>{/if}</h2>
          {#if item.kind !== 'page' && item.lead}<p class="sub">{item.lead}</p>{/if}
        </div>
        {#if journey?.practice && !detached}
          {#if practising}
            <div class="case-chip">
              <Icon name="pin" size={14} />
              <strong>{caseState.current.name}</strong>
              {#if where?.scene}<span>{where.scene}</span>{/if}
              {#each where?.facts ?? [] as fact (fact.text)}
                <span class="fact" class:ok={fact.ok}>{#if fact.ok}<Icon name="check" size={11} />{/if}{fact.text}</span>
              {/each}
            </div>
          {:else}
            <button class="practice" onclick={practise} title="A real photo whose place is known, in a case of its own">
              <Icon name="pin" size={13} /> Practise on a real photo
            </button>
          {/if}
        {/if}
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
      {/if}

      {#if stage}
        <JourneyStage
          step={stage}
          {act}
          {nodes}
          landing={landed}
          here={where}
          {answer}
          canBack={behind.length > 0}
          showable={Boolean(stage.tool)}
          onact={(next) => (act = next)}
          onpressed={pressed}
          onback={stepBack}
          onchoose={pickNode}
          onshow={showMe}
          onexample={tryExample}
          onbegin={begin}
          {branch}
        />
        <JourneyTrail {journey} picked={pickedId} here={where} walked={behind.map(idOf)} result={resultLabel} onpick={pickNode} />
      {/if}

      {#if view && picture}
        <div class="body">
          <div class="picture">
            {@render trailBar(view.title)}
            <p class="lead">{view.lead}</p>
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
  /* a journey fills the guide: the menu folds away until asked for */
  .guide.immersed {
    grid-template-columns: 0 minmax(0, 1fr);
  }
  .guide.immersed .menu {
    visibility: hidden;
    padding: 0;
    border: 0;
  }
  .menu-toggle {
    flex-shrink: 0;
    gap: 5px;
    margin-top: 1px;
  }
  .case-chip {
    display: flex;
    align-items: center;
    gap: 6px 10px;
    flex-wrap: wrap;
    margin-left: auto;
    max-width: 58%;
    padding: 6px 8px 6px 11px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--bg-0);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .case-chip > :global(svg) {
    color: var(--accent);
  }
  .case-chip strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .case-chip .fact {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .case-chip .fact.ok {
    color: var(--ok);
  }
  .case-chip .fact:not(.ok)::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .practice {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    padding: 5px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .practice:hover {
    background: color-mix(in srgb, var(--accent) 26%, transparent);
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
  .find {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 2px 6px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    color: var(--text-3);
  }
  .find:focus-within {
    border-color: var(--border-strong);
    color: var(--text-2);
  }
  .find input {
    flex: 1;
    min-width: 0;
    padding: 7px 0;
    border: 0;
    background: none;
    color: var(--text-1);
    font-size: var(--fs-sm);
    outline: none;
  }
  .found {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .hit {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 7px 9px;
    border-radius: var(--r-md);
    text-align: left;
  }
  .hit:hover,
  .hit:focus-visible {
    background: var(--bg-2);
  }
  .hit-title {
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .hit-where {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .nothing {
    margin: 8px 9px;
    color: var(--text-3);
    font-size: var(--fs-sm);
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
  /* one example, not all there is: said on hover by the journey's title */
  .caveat-mark {
    display: inline-flex;
    vertical-align: middle;
    margin-left: 8px;
    color: var(--text-3);
    cursor: help;
  }
  .sub {
    margin-top: 3px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .tabs {
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
