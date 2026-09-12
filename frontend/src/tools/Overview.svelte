<script>
  /**
   * Where the app opens: what this case is waiting on, what it looks like, and what
   * was worked on last.
   *
   * Two surfaces in one, chosen by whether a case is open. With a case it is a
   * reading — four outstanding counts as tiles, the case's points on a map, the last
   * things filed, and the case by family. Without one it is the front door, because a
   * fresh install lands in an empty workspace and nothing here could be summarised.
   *
   * **It asks the case nothing new.** The waiting counts come from the catalog summary
   * and one timeline page, both of which the Board and the Timeline already read; the
   * plate comes from the saved index the Satellite panel opens on. Pressing a row hands
   * the *question* to the surface that answers it rather than the rows it counted, so
   * the number here and the count there are one predicate asked twice, and no route,
   * table or migration was added to put a landing page in front of the app.
   *
   * Bounded like every other list (docs/STORAGE_AND_PERFORMANCE.md): five small reads
   * against the **open** case only. Nothing here opens a second case to count it, and
   * the only thing that reaches the network is the map of the case, which fetches the
   * free imagery under its points (`overview/PlaceMap.svelte`). The release card is
   * not an exception: it shows what the startup check already found, and says nothing
   * when that check is switched off.
   */
  import { api } from '../lib/api.js';
  import {
    caseState,
    createCase,
    openCase,
    prefs,
    toast,
    uiState,
    updatesState,
  } from '../lib/state.svelte.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { leaveAnalysisView, setAnalysisFilter } from '../lib/analysisSearch.svelte.js';
  import { askQuestion, emptyFilter } from '../lib/entityFilter.js';
  import { exactStamp, timeAgo } from '../lib/analysisViews.js';
  import { entityFamily, entityLabel, familyTitle } from '../lib/entityTypes.svelte.js';
  import { entityIcon, entityKindLabel } from '../lib/entityIcon.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { markdownHtml } from '../lib/markdown.js';
  import { openEntity } from '../lib/navigate.js';
  import { updateBadges } from '../lib/staleness.js';
  import {
    familyBars,
    lastTouched,
    mapPins,
    nothingWaiting,
    waitingRows,
    weekAgo,
  } from '../lib/overview.js';
  import { WORKSPACES } from '../lib/workspaces.js';
  import Icon from '../components/Icon.svelte';
  import Logo from '../components/Logo.svelte';
  import PlaceMap from './overview/PlaceMap.svelte';

  const RECENT = 6;

  /** What an empty case is offered instead of a reading of nothing. Three presses,
   *  in the order the pipeline runs, because a case with no material in it has no
   *  question to be asked about it yet. */
  const FIRST_STEPS = [
    {
      tool: 'media',
      icon: 'download',
      label: 'Bring in media',
      hint: 'import from your disk, or pull a post from its URL',
    },
    {
      tool: 'files',
      icon: 'folder',
      label: 'Drop in documents',
      hint: 'anything else the case is built from, filed in folders',
    },
    {
      tool: 'satellite',
      icon: 'satellite',
      label: 'Capture a map',
      hint: 'a view saved with its provider, coordinates and zoom',
    },
  ];

  let summary = $state(null); // catalog counts, or null until the first read lands
  let timeline = $state(null); // one timeline page, read for its undated count
  let recent = $state([]); // the newest rows the case filed
  let saved = $state([]); // the case's saved points, for the plate
  let week = $state(0); // how many landed in the last seven days
  let naming = $state(''); // the first case being named, on the front door
  let creating = $state(false);
  let notesOpen = $state(false); // is the release body unfolded

  const rows = $derived(waitingRows({ summary, timeline }));
  const clear = $derived(Boolean(summary) && nothingWaiting(rows));
  /** A case that holds nothing is not a case that is up to date. It has no reading,
   *  so it is offered the three ways material gets in instead. */
  const empty = $derived(Boolean(summary) && Number(summary.total ?? 0) === 0);
  const bars = $derived(familyBars(summary, entityFamily));
  const plate = $derived(mapPins(saved));
  const touched = $derived(lastTouched(caseState.current, caseState.list));
  const badges = $derived(updateBadges(updatesState, prefs.updateDismissedVersion));
  const notes = $derived(markdownHtml(updatesState.app?.notes ?? ''));
  /** Cases other than the one open, newest first — what the front door offers when
   *  the workspace is not actually empty, only unopened. */
  const others = $derived(caseState.list.filter((entry) => entry.id !== caseState.current?.id));

  /**
   * The five reads, settled together so one refusal cannot blank the page.
   *
   * Guarded on the case it was asked about: opening a second case while these are in
   * flight must not paint the first one's counts under the second one's name.
   */
  async function load(id) {
    const [counts, dates, newest, lately, points] = await Promise.allSettled([
      api.get(`/api/cases/${id}/catalog/summary`),
      api.get(`/api/cases/${id}/timeline?limit=1`),
      api.get(buildCatalogQuery(id, { limit: RECENT, order: '-created' })),
      api.get(buildCatalogQuery(id, { limit: 1, since: weekAgo() })),
      api.get(`/api/cases/${id}/satellite/index`),
    ]);
    if (caseState.current?.id !== id) return;
    if (counts.status === 'fulfilled') summary = counts.value;
    if (dates.status === 'fulfilled') timeline = dates.value;
    if (newest.status === 'fulfilled') recent = newest.value?.items ?? [];
    if (lately.status === 'fulfilled') week = Number(lately.value?.total ?? 0);
    if (points.status === 'fulfilled') saved = Array.isArray(points.value) ? points.value : [];
  }

  // Re-read when the case changes, when a write reloads it, and when the analyst
  // comes back to this tab. A summary surface that answers with what was true when it
  // was last looked at is worse than no summary: the counts are the whole point.
  $effect(() => {
    const id = caseState.current?.id;
    const looking = uiState.tool === 'overview';
    void caseState.rev;
    if (!id) {
      summary = null;
      timeline = null;
      recent = [];
      saved = [];
      week = 0;
      return;
    }
    if (looking) void load(id);
  });

  /**
   * Put one of the Board's standing questions on the Board, and go there.
   *
   * It travels through the slot Board and Graph already share, so the table lands on
   * exactly the rows this page counted. The named reading is left first: the question
   * came from here rather than from a saved view, and writing it into one would
   * quietly edit somebody else's view.
   */
  function askBoard(question) {
    const id = caseState.current?.id;
    leaveAnalysisView(id, 'board');
    setAnalysisFilter(id, askQuestion(emptyFilter(), question));
    uiState.tool = 'board';
  }

  /** Hand a waiting row to whichever surface answers it. */
  function ask(row) {
    if (row.surface === 'timeline') {
      uiState.tool = 'timeline';
      return;
    }
    askBoard(row.id);
  }

  function openSettings(tab = 'system') {
    uiState.settingsTab = tab;
    uiState.tool = 'settings';
  }

  /** The thumbnail the catalog attached to a row, or nothing. Data URLs come back
   *  whole; everything else is a case-relative path served by the file route. */
  function thumbSrc(item) {
    const thumb = item?.thumb;
    if (!thumb || !caseState.current) return '';
    return thumb.startsWith('data:') ? thumb : fileUrl(caseState.current.id, thumb);
  }

  async function create() {
    const name = naming.trim();
    if (!name || creating) return;
    creating = true;
    try {
      await createCase(name);
      naming = '';
    } catch (error) {
      toast(error.message, 'warn', 5000);
    } finally {
      creating = false;
    }
  }
</script>

<div class="tool home">
  <div class="tool-body">
    <div class="sheet" class:centred={!caseState.current}>
      {#if caseState.current}
        <header class="head">
          <div class="who">
            <h1>{caseState.current.name}</h1>
            <p class="meta">
              {#if touched}<span title={exactStamp(touched)}>Updated {timeAgo(touched)}</span>{/if}
              {#if summary}<span>{summary.total} entities</span>{/if}
              {#if caseState.current.scratch}<span class="scratch">Scratch session</span>{/if}
            </p>
          </div>
          <button class="btn" onclick={() => (uiState.tool = 'board')}>
            Open the board
            <Icon name="arrowRight" size={14} />
          </button>
        </header>

        {#if badges.app}
          <!-- What the startup check already found, said once. It never checks
               anything itself, so with the release check off this never appears, and
               the body it unfolds came back with that same answer. -->
          <div class="notice">
            <button class="notice-head" onclick={() => (notesOpen = !notesOpen)}>
              <Icon name="download" size={14} />
              <span>Azimut {updatesState.app?.latest} is available</span>
              {#if updatesState.app?.notes}
                <em>{notesOpen ? 'Hide notes' : "What's new"}</em>
                <Icon name={notesOpen ? 'chevronUp' : 'chevronDown'} size={13} />
              {/if}
            </button>
            {#if notesOpen && updatesState.app?.notes}
              <!-- Our own release body, through the renderer the Notebook uses, which
                   strips unsafe HTML. -->
              <div class="notes markdown">{@html notes}</div>
            {/if}
            <div class="notice-foot">
              <a class="btn btn-sm btn-primary" href={updatesState.app?.url} target="_blank" rel="noreferrer">
                <Icon name="download" size={13} /> Download
                <Icon name="external" size={11} />
              </a>
              <button class="btn btn-ghost btn-sm" onclick={() => openSettings('system')}>
                Settings
              </button>
            </div>
          </div>
        {/if}

        {#if badges.extensionMissing}
          <button class="notice-line" onclick={() => openSettings('extension')}>
            <Icon name="crop" size={14} />
            <span>The capture extension is not installed. It files the map you are looking at, in any tab, straight into this case.</span>
            <em>Install</em>
          </button>
        {/if}

        {#if empty}
          <section>
            <h2 class="label">Nothing in this case yet</h2>
            <ul class="steps">
              {#each FIRST_STEPS as step (step.tool)}
                <li>
                  <button class="step" onclick={() => (uiState.tool = step.tool)}>
                    <span class="step-mark"><Icon name={step.icon} size={19} /></span>
                    <strong>{step.label}</strong>
                    <span class="step-hint">{step.hint}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {:else}
          <div class="grid" class:flat={!plate.pins.length}>
            <section class="area-waiting">
              <h2 class="label">What is waiting</h2>
              {#if !summary}
                <p class="quiet-line">Reading the case…</p>
              {:else if clear}
                <p class="quiet-line">Nothing waiting on these four right now.</p>
              {:else}
                <ul class="tiles">
                  {#each rows as row (row.id)}
                    <li>
                      <button
                        class="tile"
                        class:none={row.count === 0}
                        disabled={row.count === 0}
                        title={row.count === 0 ? 'Nothing here' : row.hint}
                        onclick={() => ask(row)}
                      >
                        <span class="tile-mark"><Icon name={row.icon} size={15} /></span>
                        <span class="n">{row.count}</span>
                        <span class="say-label">{row.label}</span>
                        <span class="say-hint">{row.hint}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>

            {#if plate.pins.length}
              <section class="area-places">
                <h2 class="label">On the ground</h2>
                <PlaceMap
                  pins={plate.pins}
                  total={plate.total}
                  imperial={prefs.units === 'imperial'}
                  onopen={() => (uiState.tool = 'satellite')}
                />
              </section>
            {/if}

            {#if recent.length}
              <section class="area-recent">
                <h2 class="label">
                  <span>Recent work</span>
                  {#if week}
                    <button class="aside" onclick={() => askBoard('week')}>
                      {week} added this week
                    </button>
                  {/if}
                </h2>
                <ul class="rows">
                  {#each recent as item (item.id)}
                    {@const src = thumbSrc(item)}
                    <li>
                      <button class="row thin" onclick={() => openEntity(item)}>
                        <span class="glyph" class:shot={Boolean(src)}>
                          {#if src}
                            <img src={src} alt="" loading="lazy" />
                          {:else}
                            <Icon name={entityIcon(item)} size={15} />
                          {/if}
                        </span>
                        <span class="say">
                          <span class="say-label">{item.label}</span>
                          <span class="say-hint">{entityKindLabel(item, entityLabel(item.type))}</span>
                        </span>
                        <span class="when" title={exactStamp(item.provenance?.at)}>
                          {timeAgo(item.provenance?.at)}
                        </span>
                      </button>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}

            {#if bars.length}
              <section class="area-figures">
                <h2 class="label">In the case</h2>
                <ul class="bars">
                  {#each bars as entry (entry.family)}
                    <li style="--tint: var(--graph-{entry.family}, var(--text-3))">
                      <span class="bar-label">{familyTitle(entry.family)}</span>
                      <span class="track"><i style="width: {Math.max(entry.share * 100, 2)}%"></i></span>
                      <strong>{entry.count}</strong>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          </div>
        {/if}

        <footer class="foot">
          <button class="aside" onclick={() => (uiState.tool = 'guide')}>
            New here? Read the guide
            <Icon name="arrowRight" size={13} />
          </button>
        </footer>
      {:else}
        <!-- The front door. A fresh install lands here, with no case to summarise and
             nothing on screen that says what any of the rail means. -->
        <div class="door">
          <Logo size={52} />
          <h1>Azimut</h1>
          <p class="pitch">
            A local OSINT workspace. Source media, geolocation work, proofs and notes live
            in one case folder you can copy anywhere.
          </p>

          <ol class="pipeline">
            {#each WORKSPACES as ws, i (ws.id)}
              {#if i > 0}<li class="arrow" aria-hidden="true"><Icon name="chevronRight" size={13} /></li>{/if}
              <li class="stage">
                <Icon name={ws.icon} size={17} />
                <span>{ws.label}</span>
              </li>
            {/each}
          </ol>

          <div class="start">
            <label class="label" for="home-case-name">Name your first case</label>
            <div class="start-row">
              <input
                id="home-case-name"
                class="input"
                bind:value={naming}
                placeholder="Kharkiv strike, 12 March"
                onkeydown={(e) => e.key === 'Enter' && create()}
              />
              <button class="btn btn-primary" disabled={!naming.trim() || creating} onclick={create}>
                Create
              </button>
            </div>
          </div>

          {#if others.length}
            <div class="reopen">
              <span class="label">Or open one you have</span>
              <ul>
                {#each others.slice(0, 5) as entry (entry.id)}
                  <li>
                    <button class="chip" onclick={() => openCase(entry.id)}>
                      <span>{entry.name}</span>
                      {#if entry.updated_at}<em>{timeAgo(entry.updated_at)}</em>{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          <div class="door-foot">
            <button class="btn btn-ghost btn-sm" onclick={() => (uiState.tool = 'guide')}>
              Read the guide
              <Icon name="arrowRight" size={13} />
            </button>
            <span class="door-note">Nothing leaves this machine.</span>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Wider than a reading column and narrower than the tools: this page is scanned
     rather than read, and four counts hung in a 760px ribbon on a 27-inch screen is
     the emptiest an app can look. The front door keeps the narrow measure. */
  .sheet {
    max-width: 1180px;
    margin: 0 auto;
    padding: 40px 28px 56px;
  }
  /* The front door is the whole page rather than its first band, so it is centred
     in the window instead of hanging from the top of it. */
  .sheet.centred {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    max-width: 820px;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding-bottom: 30px;
  }
  .head h1 {
    font-size: var(--fs-xl);
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.2;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 5px;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  /* middots between the facts, drawn rather than typed so no fact has to carry one */
  .meta span + span::before {
    content: '·';
    margin-right: 10px;
  }
  .meta .scratch {
    color: var(--warn);
  }

  /* ---- the two notices ------------------------------------------------------ */

  .notice {
    margin-bottom: 16px;
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    overflow: hidden;
  }
  .notice-head {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 10px 12px;
    color: var(--text-2);
    font-size: var(--fs-sm);
    text-align: left;
    transition: background 0.15s var(--ease);
  }
  .notice-head:hover {
    background: var(--bg-2);
  }
  .notice-head em {
    margin-left: auto;
    color: var(--accent);
    font-style: normal;
    font-weight: 600;
    font-size: var(--fs-xs);
  }
  /* Capped, because a release body is somebody else's document and this is a corner
     of a landing page: past a screenful the place to read it is the release page. */
  .notes {
    max-height: 260px;
    overflow: auto;
    padding: 4px 14px 12px;
    border-top: 1px solid var(--border);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .notes :global(h1),
  .notes :global(h2),
  .notes :global(h3) {
    margin: 14px 0 6px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
  }
  .notes :global(ul) {
    margin: 0;
    padding-left: 18px;
  }
  .notes :global(li) {
    margin: 3px 0;
  }
  .notice-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid var(--border);
  }

  /* The extension, said in one line. It disappears the moment one is installed, so
     it is a setup step rather than a standing message. */
  .notice-line {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    margin-bottom: 16px;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    color: var(--text-3);
    font-size: var(--fs-sm);
    text-align: left;
    transition: background 0.15s var(--ease), color 0.15s var(--ease);
  }
  .notice-line:hover {
    background: var(--bg-2);
    color: var(--text-2);
  }
  .notice-line em {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--accent);
    font-style: normal;
    font-weight: 600;
    font-size: var(--fs-xs);
  }

  /* ---- the reading ---------------------------------------------------------- */

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    grid-template-areas:
      'waiting places'
      'recent figures';
    gap: 30px 40px;
    align-items: start;
    padding-top: 4px;
  }
  /* With no point saved there is no plate, and the figures take the shoulder rather
     than leaving a hole where the map would have been. */
  .grid.flat {
    grid-template-areas:
      'waiting figures'
      'recent recent';
  }
  .area-waiting {
    grid-area: waiting;
  }
  .area-places {
    grid-area: places;
  }
  .area-recent {
    grid-area: recent;
  }
  .area-figures {
    grid-area: figures;
  }
  @media (max-width: 980px) {
    .grid,
    .grid.flat {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'waiting' 'places' 'recent' 'figures';
      gap: 30px;
    }
  }

  .label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  /* Four counts as tiles rather than four lines: this is the band somebody opens the
     app to read, and a number is read at a glance or it is not read. */
  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0 8px;
    width: 100%;
    height: 100%;
    padding: 13px 14px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    text-align: left;
    transition: background 0.14s var(--ease), border-color 0.14s var(--ease);
  }
  .tile:not(:disabled):hover,
  .tile:focus-visible {
    background: var(--bg-2);
    border-color: var(--accent);
    outline: none;
  }
  .tile-mark {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    color: var(--text-3);
  }
  .tile .n {
    grid-column: 1;
    grid-row: 1;
    font-size: 1.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    line-height: 1.1;
    color: var(--text-1);
  }
  .tile .say-label {
    grid-column: 1 / -1;
    margin-top: 6px;
  }
  /* A tile is not a row: the hint has the width to be read, so it wraps to a second
     line rather than being cut off mid-clause. */
  .tile .say-hint {
    grid-column: 1 / -1;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    line-height: 1.45;
  }
  /* A count of nothing is the answer, so the tile states it and stops being a control
     rather than offering a press that lands on an empty table. */
  .tile.none {
    cursor: default;
    background: transparent;
  }
  .tile.none .n,
  .tile.none .say-label {
    color: var(--text-3);
    font-weight: 500;
  }
  .tile.none .say-hint {
    opacity: 0.65;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* Flat rows with a hairline between them, not cards. The active mark is the amber
     edge bar the rail already uses for "you are here", so the app has one way of
     saying a row is under the pointer. */
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 9px 10px 9px 8px;
    border-bottom: 1px solid var(--border);
    border-left: 2px solid transparent;
    text-align: left;
    transition: background 0.14s var(--ease), border-color 0.14s var(--ease);
  }
  .rows li:last-child .row {
    border-bottom-color: transparent;
  }
  .row:not(:disabled):hover {
    background: var(--bg-1);
    border-left-color: var(--accent);
  }
  .row:focus-visible {
    outline: none;
    background: var(--bg-1);
    border-left-color: var(--accent);
  }

  .say {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .say-label {
    font-size: var(--fs-md);
    font-weight: 500;
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .say-hint {
    font-size: var(--fs-sm);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .say-label {
    font-size: var(--fs-sm);
  }
  .row .say-hint {
    font-size: var(--fs-xs);
  }

  /* The case's own pictures, where it has them: a list of six filenames says far less
     about an afternoon's work than six frames of it. */
  .glyph {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 26px;
    color: var(--text-3);
  }
  .glyph.shot {
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg-2);
  }
  .glyph img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .row.thin:hover .glyph {
    color: var(--text-2);
  }
  .when {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }

  .quiet-line {
    padding: 12px 8px;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }

  /* The case by family, in the hues the Graph gives those same eight families. One
     reading of one case cannot be two palettes. */
  .bars {
    list-style: none;
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
  }
  .bars li {
    display: grid;
    grid-template-columns: minmax(0, 5.5rem) minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }
  .bars li + li {
    margin-top: 9px;
  }
  .bar-label {
    font-size: var(--fs-xs);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-2);
    overflow: hidden;
  }
  .track i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--tint);
    opacity: 0.85;
  }
  .bars strong {
    font-size: var(--fs-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text-1);
  }

  /* ---- a case with nothing in it -------------------------------------------- */

  .steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .step {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    width: 100%;
    height: 100%;
    padding: 18px 16px 17px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    text-align: left;
    transition: background 0.14s var(--ease), border-color 0.14s var(--ease);
  }
  .step:hover,
  .step:focus-visible {
    background: var(--bg-2);
    border-color: var(--accent);
    outline: none;
  }
  .step-mark {
    display: flex;
    margin-bottom: 9px;
    color: var(--accent);
  }
  .step strong {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-1);
  }
  .step-hint {
    font-size: var(--fs-sm);
    color: var(--text-3);
    line-height: 1.5;
  }

  /* A quiet secondary act: the guide link, and the count beside a heading. */
  .aside {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-3);
    transition: color 0.14s var(--ease);
  }
  .aside:hover {
    color: var(--accent);
  }
  .foot {
    margin-top: 36px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  /* ---- the front door ------------------------------------------------------ */

  .door {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
  }
  .door h1 {
    margin-top: 16px;
    font-size: var(--fs-xl);
    font-weight: 600;
    letter-spacing: -0.015em;
  }
  .pitch {
    max-width: 460px;
    margin-top: 8px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: 1.6;
  }

  /* The rail, before anyone has used it. It is a sequence and reads as one. */
  .pipeline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 6px;
    list-style: none;
    margin: 30px 0 34px;
    padding: 0;
  }
  .stage {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-2);
  }
  .arrow {
    display: flex;
    color: var(--text-3);
    opacity: 0.7;
  }

  .start {
    width: min(420px, 100%);
    text-align: left;
  }
  .start-row {
    display: flex;
    gap: 8px;
  }
  .start-row .input {
    flex: 1;
  }

  .reopen {
    margin-top: 28px;
    width: min(520px, 100%);
  }
  .reopen .label {
    justify-content: center;
  }
  .reopen ul {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    padding: 5px 11px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    font-size: var(--fs-sm);
    color: var(--text-1);
    transition: background 0.14s var(--ease), border-color 0.14s var(--ease);
  }
  .chip:hover {
    background: var(--bg-2);
    border-color: var(--border-strong);
  }
  .chip em {
    font-style: normal;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }

  .door-foot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 40px;
  }
  .door-note {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
