<script>
  /**
   * The slides of a proof's video, on a strip under the canvas, the way Map plate lays
   * its steps under the page: the video's name, then a tile per scene in clip order
   * (each proved one with its thumbnail, each still to prove dashed with its two counts,
   * the abandoned ones greyed at the end), **+ New scene**, the list of every slide and
   * the fold.
   *
   * A press on a tile moves there, which saves the slide left (the composer's
   * `switchSlide`); the strip itself never writes. Each tile's ⋯, a right-click, and the
   * context-menu key or Shift+F10 on a focused tile open one menu: for a proof Rename, Show
   * in Inspect, Abandon… while it states no place and Delete…; for a scene still to prove
   * Make this slide, Geolocate and Abandon….
   *
   * Past what the strip holds whole, the tiles shrink to their picture and number, an
   * arrow each side says how many are out of sight and a count says which one is shown.
   * On a narrow window it is a pager. Folded, or for a video this proof is alone on, it
   * is one thin line; the fold lasts the session only.
   *
   * ←/→ walk the tiles without opening them, Enter opens, Home and End go to the ends.
   * Alt+←/→ go to the next slide from anywhere in the composer, which handles them.
   */
  import { tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import SceneCounts from '../../components/SceneCounts.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { videoName } from '../../lib/proofScene.js';
  import { ABANDONED, GEOLOCATING, NEW, NO_PICTURE, findTiles } from '../../lib/proofSlides.js';
  import { PROOF_SLIDES_HELP as HELP } from '../../lib/proofSlidesHelp.js';

  let {
    /** `lib/proofSlides.slideTiles`, in strip order. */
    tiles = [],
    /** The video the slides are of, a path in the case, and its title in Media. */
    video = '',
    title = '',
    caseId = '',
    /** The video is no longer in the case: the line says so, with no tiles. */
    gone = false,
    /** Folded to its thin line, for the session. */
    folded = $bindable(false),
    /** The tile a switch is heading to while the slide left is saved. */
    heading = null,
    /** The slide on screen changed since it was saved. */
    dirty = false,
    /** `(tile)`: move to that slide. */
    onpick,
    /** A new slide of the video. */
    onnew,
    /** `(step)`: the slide before (-1) or after (1) the one on screen. */
    onstep,
    /** The video's name pressed: its player. */
    onvideo,
    /** `(action, tile, extra)`: `inspect`, `make`, `geolocate`, `abandon` (`extra` the reason), `restore`,
     *  `rename` (`extra` the new name) or `delete`. */
    onaction,
    /** Every proved slide's picture copied into one numbered folder; null where it is not offered. */
    onexport = null,
  } = $props();

  /** A tile's width and the gap after it; the strip's padding, its gaps and +; under what it turns into a pager. */
  const TILE = 162;
  const ROOM = 92;
  const NARROW = 440;
  /** Under this the video's name gives way to its icon, its name on hover. */
  const TIGHT = 760;

  let width = $state(0);
  let lead = $state(0);
  let tail = $state(0);
  let lane = $state(null);
  let before = $state(0);
  let after = $state(0);
  let overflowing = $state(false);
  /** `{ tile, anchor }` or `{ tile, at }` of the tile's menu, `asking` once Abandon asks why,
   *  `renaming` while Rename holds the new name. */
  let menu = $state(null);
  let reason = $state('');
  let rename = $state('');
  let listAnchor = $state(null);
  /** The strip's own menu, by its ⋯. */
  let seriesAnchor = $state(null);
  let listOpen = $state(false);
  let query = $state('');
  let listBox = $state(null);

  const index = $derived(tiles.findIndex((t) => t.current));
  const shown = $derived(index >= 0 ? tiles[index] : null);
  const firstLeft = $derived(tiles.findIndex((t) => t.state === ABANDONED));
  const lone = $derived(tiles.length <= 1);
  const narrow = $derived(width > 0 && width < NARROW);
  const tight = $derived(width > 0 && width < TIGHT);
  const compact = $derived(width > 0 && tiles.length * TILE > width - lead - tail - ROOM);
  const mode = $derived(gone ? 'gone' : lone ? 'lone' : folded ? 'folded' : narrow ? 'pager' : 'strip');
  const found = $derived(findTiles(tiles, query));
  const name = $derived(videoName(video, title));
  const count = (n) => (n === 1 ? '1 scene' : `${n} scenes`);
  const proved = $derived(tiles.filter((t) => t.kind === 'proof' && t.state !== NO_PICTURE).length);

  /** How many tiles stand more than half out of sight, each side. */
  function measure() {
    if (!lane) return;
    const left = lane.scrollLeft;
    const right = left + lane.clientWidth;
    const out = [0, 0];
    for (const slot of lane.querySelectorAll('.slot')) {
      const middle = slot.offsetLeft + slot.offsetWidth / 2;
      if (middle < left) out[0] += 1;
      else if (middle > right) out[1] += 1;
    }
    [before, after] = out;
    overflowing = lane.scrollWidth > lane.clientWidth + 1;
  }

  // The slide on screen stands in the middle of the strip: glided to from the slide
  // before, put there at once when the strip is laid out again (shrunk, widened, read).
  let centred = '';
  $effect(() => {
    void tiles.length; void compact; void mode; void width; void overflowing;
    const key = shown?.key ?? '';
    if (!lane) return;
    const tile = key ? lane.querySelector(`[data-key="${CSS.escape(key)}"]`)?.closest('.slot') : null;
    if (tile) {
      const left = Math.max(0, tile.offsetLeft - (lane.clientWidth - tile.offsetWidth) / 2);
      if (centred && centred !== key) lane.scrollTo?.({ left, behavior: 'smooth' });
      else lane.scrollLeft = left;
    }
    centred = key;
    measure();
  });

  $effect(() => {
    if (!lane || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(lane);
    return () => observer.disconnect();
  });

  /** The wheel turns the strip sideways when it runs longer than the bar. */
  function wheel(node) {
    const turn = (event) => {
      if (node.scrollWidth <= node.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1);
    };
    node.addEventListener('wheel', turn, { passive: false });
    return () => node.removeEventListener('wheel', turn);
  }

  function page(direction) {
    lane?.scrollBy?.({ left: direction * Math.max(TILE, lane.clientWidth * 0.8), behavior: 'smooth' });
  }

  /** ←/→ walk the tiles without opening one, Home and End go to the ends. Alt+←/→ are the composer's. */
  function arrows(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(lane?.querySelectorAll('button.tile') ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    event.stopPropagation();
    const at = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : Math.min(buttons.length - 1, Math.max(0, (at < 0 ? Math.max(0, index) : at) + (event.key === 'ArrowLeft' ? -1 : 1)));
    buttons[next].focus();
    buttons[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // -- a tile ----------------------------------------------------------------------------

  /** What a tile says on hover: its name and time, why it was given up, what a press does. */
  function tip(tile) {
    const parts = [tile.title];
    if (tile.time && tile.time !== tile.title) parts.push(tile.time);
    if (tile.state === ABANDONED) parts.push(tile.reason ? `Abandoned: ${tile.reason}` : 'Abandoned');
    else if (tile.kind === 'draft' || tile.unplaced) parts.push(tile.words);
    else if (tile.state === NEW) parts.push(HELP.unsaved);
    const act = tile.current ? HELP.current : heading === tile.key ? HELP.heading : tile.kind === 'draft' ? HELP.scene : HELP.open;
    return `${parts.filter(Boolean).join(' · ')}. ${act}`;
  }

  const hasMenu = (tile) => tile.kind !== 'new';

  function openMenu(tile, anchor) {
    reason = '';
    menu = menu?.tile.key === tile.key && !menu.at ? null : { tile, anchor };
  }

  function context(event, tile) {
    if (!hasMenu(tile)) return;
    event.preventDefault();
    reason = '';
    menu = { tile, at: { x: event.clientX, y: event.clientY } };
  }

  /**
   * The context-menu event the same key may raise once the menu is up: some browsers send
   * it as the key comes back up, at what holds the focus by then, which would open the
   * browser's own menu over this one. It is taken, and only until just after the key is let go.
   */
  function swallowContext() {
    const swallow = (event) => {
      event.preventDefault();
      event.stopPropagation();
      done();
    };
    const later = () => setTimeout(done, 50);
    const timer = setTimeout(done, 400);
    function done() {
      clearTimeout(timer);
      window.removeEventListener('contextmenu', swallow, true);
      window.removeEventListener('keyup', later, true);
    }
    window.addEventListener('contextmenu', swallow, true);
    window.addEventListener('keyup', later, true);
  }

  /** The context-menu key, or Shift+F10, on a focused tile: its menu, under it, the keys in it. */
  async function menuKeys(event, tile) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    if (!hasMenu(tile)) return;
    event.preventDefault();
    event.stopPropagation();
    swallowContext();
    reason = '';
    menu = { tile, anchor: event.currentTarget };
    await tick();
    document.querySelector('.float-menu .fm-item')?.focus();
  }

  function act(action, extra) {
    const tile = menu?.tile;
    menu = null;
    if (tile) onaction?.(action, tile, extra);
  }

  async function askWhy() {
    menu = { ...menu, asking: true };
    await tick();
    document.querySelector('.slide-why input')?.focus();
  }

  async function askName() {
    rename = menu.tile.title;
    menu = { ...menu, renaming: true };
    await tick();
    document.querySelector('.slide-name input')?.select();
  }

  // -- the list --------------------------------------------------------------------------

  async function toggleList(event) {
    listAnchor = event.currentTarget;
    listOpen = !listOpen;
    query = '';
    if (!listOpen) return;
    await tick();
    listBox?.querySelector('input')?.focus();
  }

  function pickListed(tile) {
    listOpen = false;
    if (!tile.current) onpick?.(tile);
  }

  function listKeys(event) {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    if (found[0]) pickListed(found[0]);
  }
</script>

{#snippet chip()}
  <button type="button" class="chip" class:bare={tight && mode === 'strip'} aria-label={name} title={`${video}. ${HELP.video}`} onclick={() => onvideo?.()}>
    <Icon name="video" size={13} /><span class="chip-name" dir="auto">{name}</span>
  </button>
{/snippet}

{#snippet newScene(words = true)}
  <button type="button" class="add" class:bare={!words} aria-label="New scene" title={HELP.newScene} onclick={() => onnew?.()}>
    <Icon name="plus" size={13} />{#if words}<span>New scene</span>{/if}
  </button>
{/snippet}

{#snippet steppers()}
  <button type="button" class="step" aria-label="Previous slide" title={HELP.previous} disabled={index <= 0} onclick={() => onstep?.(-1)}>
    <Icon name="chevronLeft" size={14} /></button>
  <button type="button" class="step" aria-label="Next slide" title={HELP.next} disabled={index < 0 || index >= tiles.length - 1} onclick={() => onstep?.(1)}>
    <Icon name="chevronRight" size={14} /></button>
{/snippet}

{#snippet listButton()}
  <button type="button" class="list" aria-label="Every slide" aria-haspopup="dialog" aria-expanded={listOpen} title={HELP.list} onclick={toggleList}>
    <Icon name="list" size={13} /><span class="num">{tiles.length}</span>
  </button>
{/snippet}

{#snippet series()}
  {#if onexport}
    <button type="button" class="list" aria-label="More for the slides" aria-haspopup="menu" aria-expanded={!!seriesAnchor}
      title={HELP.series} onclick={(event) => (seriesAnchor = seriesAnchor ? null : event.currentTarget)}>
      <Icon name="more" size={14} stroke={2.6} /></button>
  {/if}
{/snippet}

{#snippet fold()}
  <button type="button" class="fold" aria-label={folded ? 'Show the slides' : 'Hide the slides'} aria-expanded={!folded}
    title={folded ? HELP.unfold : HELP.fold} onclick={() => (folded = !folded)}>
    <Icon name={folded ? 'chevronUp' : 'chevronDown'} size={14} /></button>
{/snippet}

{#snippet thumb(tile)}
  <span class="thumb" class:hollow={!tile.thumb}>
    {#if tile.thumb}
      <img src={fileUrl(caseId, tile.thumb)} alt="" loading="lazy" decoding="async" />
    {:else if tile.state === NEW}
      <Icon name="plus" size={15} />
    {:else if tile.kind === 'draft'}
      <span class="pin" style:color={tile.state === ABANDONED ? null : tile.color}><Icon name="pin" size={16} /></span>
    {:else}
      <Icon name="proof" size={15} />
    {/if}
    {#if tile.state === GEOLOCATING}<span class="live" aria-hidden="true"></span>{/if}
    {#if tile.unplaced}<span class="unplaced" aria-hidden="true"></span>{/if}
    {#if compact}<span class="tile-num">{tile.number}</span>{/if}
  </span>
{/snippet}

<div class="slides" class:line={mode !== 'strip'} class:compact={compact && mode === 'strip'} bind:clientWidth={width}
  role="region" aria-label="Slides of the video" data-guide="proof.slides">
  {#if mode === 'gone'}
    <span class="said"><Icon name="video" size={13} />The video of this proof is no longer in the case</span>
  {:else if mode === 'lone'}
    {@render chip()}
    <span class="dot-sep" aria-hidden="true">·</span>
    <span class="said">{count(1)}</span>
    {@render newScene()}
  {:else if mode === 'folded'}
    {@render chip()}
    <span class="dot-sep" aria-hidden="true">·</span>
    <span class="said grow" title={HELP.tally}>
      <span class="num">{index >= 0 ? `${index + 1} / ${tiles.length}` : count(tiles.length)}</span>
      {#if shown}<span class="said-title" dir="auto">{shown.title}</span>{/if}
    </span>
    {@render steppers()}
    {@render newScene()}
    {@render fold()}
  {:else if mode === 'pager'}
    {@render steppers()}
    <span class="said grow" title={HELP.tally}>
      <span class="num">{index >= 0 ? `Slide ${index + 1} of ${tiles.length}` : count(tiles.length)}</span>
      {#if shown}<span class="dot-sep" aria-hidden="true">·</span><span class="said-title" dir="auto">{shown.title}</span>{/if}
    </span>
    {@render newScene(false)}
    {@render listButton()}
    {@render series()}
    {@render fold()}
  {:else}
    <div class="lead" bind:clientWidth={lead}>{@render chip()}</div>
    {#if overflowing && !tight}
      <button type="button" class="edge" disabled={!before} aria-label={before ? `${before} more before` : 'No slide before'}
        title={HELP.before} onclick={() => page(-1)}><Icon name="chevronLeft" size={12} />{before || ''}</button>
    {/if}
    <div class="lane" class:fade-before={tight && before > 0} class:fade-after={tight && after > 0}
      role="listbox" aria-label="Slides" aria-orientation="horizontal" tabindex="-1" bind:this={lane}
      onscroll={measure} onkeydown={arrows} {@attach wheel}>
      {#each tiles as tile, i (tile.key)}
        {#if i === firstLeft && i > 0}<span class="rule" role="presentation"></span>{/if}
        <div class="slot" role="presentation" oncontextmenu={(event) => context(event, tile)}>
          <button type="button" class="tile {tile.kind} {tile.state}" class:on={tile.current} class:heading={heading === tile.key}
            role="option" aria-selected={tile.current} data-key={tile.key} style:--scene={tile.color}
            tabindex={tile.current || (index < 0 && i === 0) ? 0 : -1}
            aria-label={`${tile.number}. ${tile.title}, ${tile.words}`} title={tip(tile)} aria-keyshortcuts={hasMenu(tile) ? 'Shift+F10' : undefined}
            onclick={() => !tile.current && onpick?.(tile)} onkeydown={(event) => menuKeys(event, tile)}>
            {@render thumb(tile)}
            <span class="tile-title" dir="auto">{tile.title}{#if tile.current && dirty}<span class="dirty" title={HELP.dirty}></span>{/if}</span>
            {#if tile.kind === 'draft' && tile.state !== ABANDONED}
              <span class="tile-words counted"><SceneCounts scene={tile.row} live={tile.state === GEOLOCATING} size={10} /></span>
            {:else}
              <span class="tile-words">{tile.words}</span>
            {/if}
          </button>
          {#if hasMenu(tile)}
            <button type="button" class="more" aria-label={`More for ${tile.title}`} title={HELP.more} aria-haspopup="menu"
              aria-expanded={menu?.tile.key === tile.key}
              onclick={(event) => openMenu(tile, event.currentTarget)}><Icon name="more" size={13} stroke={2.6} /></button>
          {/if}
        </div>
      {/each}
    </div>
    {#if overflowing && !tight}
      <button type="button" class="edge" disabled={!after} aria-label={after ? `${after} more after` : 'No slide after'}
        title={HELP.after} onclick={() => page(1)}>{after || ''}<Icon name="chevronRight" size={12} /></button>
    {/if}
    {@render newScene(false)}
    <div class="tail" bind:clientWidth={tail}>
      {@render listButton()}
      {#if compact && !tight}
        <span class="tally num" title={HELP.tally}>{index >= 0 ? `${index + 1} / ${tiles.length}` : tiles.length}</span>
      {/if}
      {@render series()}
      {@render fold()}
    </div>
  {/if}
</div>

{#if menu}
  {@const tile = menu.tile}
  <FloatingMenu anchor={menu.anchor} at={menu.at} width={240} label={tile.title} onclose={() => (menu = null)}>
    <p class="fm-head" dir="auto">{tile.title}</p>
    {#if tile.kind === 'proof'}
      {#if tile.state === ABANDONED && tile.reason}<p class="fm-note" dir="auto">Abandoned: {tile.reason}</p>{/if}
      {#if menu.asking}
        <form class="slide-why" onsubmit={(event) => { event.preventDefault(); act('abandon', reason.trim()); }}>
          <input class="input" aria-label="Why it is abandoned" placeholder="Why? (optional)" maxlength="200" dir="auto"
            title={HELP.reason} bind:value={reason} />
          <button class="btn btn-xs">Abandon</button>
        </form>
      {:else if menu.renaming}
        <form class="slide-name" onsubmit={(event) => { event.preventDefault(); if (rename.trim()) act('rename', rename.trim()); }}>
          <input class="input" aria-label="New name" maxlength="200" dir="auto" title={HELP.name} bind:value={rename} />
          <button class="btn btn-xs" disabled={!rename.trim()}>Rename</button>
        </form>
      {:else}
        <button type="button" class="fm-item" title={HELP.rename} onclick={askName}>
          <Icon name="edit" size={14} /><span class="fm-grow">Rename</span></button>
        <button type="button" class="fm-item" title={HELP.inspect} onclick={() => act('inspect')}>
          <Icon name="inspect" size={14} /><span class="fm-grow">Show in Inspect</span></button>
        {#if tile.state === ABANDONED}
          <button type="button" class="fm-item" title={HELP.restore} onclick={() => act('restore')}>
            <Icon name="undo" size={14} /><span class="fm-grow">Restore</span></button>
        {:else if tile.unplaced}
          <div class="fm-sep"></div>
          <p class="fm-note">{HELP.unplaced}</p>
          <button type="button" class="fm-item" title={HELP.abandon} onclick={askWhy}>
            <Icon name="eyeOff" size={14} /><span class="fm-grow">Abandon…</span></button>
        {/if}
        <div class="fm-sep"></div>
        <button type="button" class="fm-item danger" title={HELP.delete} onclick={() => act('delete')}>
          <Icon name="trash" size={14} /><span class="fm-grow">Delete…</span></button>
      {/if}
    {:else if tile.state === ABANDONED}
      {#if tile.reason}<p class="fm-note" dir="auto">Abandoned: {tile.reason}</p>{/if}
      <button type="button" class="fm-item" title={HELP.restore} onclick={() => act('restore')}>
        <Icon name="undo" size={14} /><span class="fm-grow">Restore</span></button>
    {:else if menu.asking}
      <form class="slide-why" onsubmit={(event) => { event.preventDefault(); act('abandon', reason.trim()); }}>
        <input class="input" aria-label="Why it is abandoned" placeholder="Why? (optional)" maxlength="200" dir="auto"
          title={HELP.reason} bind:value={reason} />
        <button class="btn btn-xs">Abandon</button>
      </form>
    {:else}
      <button type="button" class="fm-item" title={HELP.make} onclick={() => act('make')}>
        <Icon name="proof" size={14} /><span class="fm-grow">Make this slide</span></button>
      <button type="button" class="fm-item" title={HELP.geolocate} onclick={() => act('geolocate')}>
        <Icon name="crosshair" size={14} /><span class="fm-grow">Geolocate</span></button>
      <div class="fm-sep"></div>
      <button type="button" class="fm-item" title={HELP.abandon} onclick={askWhy}>
        <Icon name="eyeOff" size={14} /><span class="fm-grow">Abandon…</span></button>
    {/if}
  </FloatingMenu>
{/if}

{#if seriesAnchor}
  <FloatingMenu anchor={seriesAnchor} width={250} align="end" label="The slides" onclose={() => (seriesAnchor = null)}>
    <button type="button" class="fm-item" disabled={!proved} title={HELP.export}
      onclick={() => { seriesAnchor = null; onexport?.(); }}>
      <Icon name="download" size={14} /><span class="fm-grow">Export the slides</span></button>
    <p class="fm-note">{proved ? `${proved === 1 ? '1 picture' : `${proved} pictures`}, numbered in clip order, in a folder of their own` : 'No slide has a picture yet'}</p>
  </FloatingMenu>
{/if}

{#if listOpen}
  <FloatingMenu anchor={listAnchor} width={300} align="end" label="Every slide" role="dialog" column onclose={() => (listOpen = false)}>
    <div class="list-search" bind:this={listBox} role="presentation" onkeydown={listKeys}>
      <SearchInput bind:value={query} placeholder="Find a slide" width="100%" title={HELP.search} count={query ? found.length : null} />
    </div>
    <div class="list-rows" role="listbox" aria-label="Every slide">
      {#each found as tile (tile.key)}
        <button type="button" class="fm-item row {tile.kind} {tile.state}" class:on={tile.current} role="option" aria-selected={tile.current}
          style:--scene={tile.color} onclick={() => pickListed(tile)}>
          <span class="row-num num">{tile.number}</span>
          <span class="row-edge" aria-hidden="true"></span>
          <span class="fm-grow" dir="auto">{tile.title}</span>
          <span class="row-words">{tile.words}</span>
        </button>
      {:else}
        <p class="fm-note">No slide matches</p>
      {/each}
    </div>
  </FloatingMenu>
{/if}

<style>
  .slides { display: flex; flex: none; align-items: center; gap: 6px; min-width: 0; height: 62px; padding: 6px 14px; box-sizing: border-box; overflow: hidden;
    border-top: 1px solid var(--border); background: var(--bg-1); }
  .slides.line { height: 28px; padding: 0 10px 0 14px; gap: 6px; }
  .lead, .tail { display: flex; flex: none; align-items: center; gap: 6px; }
  /* + follows the last tile, as Map plate's does; the list, the menu and the fold keep the right end */
  .tail { margin-left: auto; }

  .chip { display: inline-flex; align-items: center; gap: 5px; max-width: 170px; height: 26px; padding: 0 8px; border-radius: var(--r-sm);
    color: var(--text-2); font-size: 11px; cursor: pointer; }
  .line .chip { height: 22px; padding: 0 6px; }
  .chip:hover { background: var(--bg-3); color: var(--text-1); }
  .chip.bare { width: 28px; padding: 0; justify-content: center; }
  .chip.bare .chip-name { display: none; }
  .chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .said { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; color: var(--text-3); font-size: 11px; white-space: nowrap; }
  .said .num { flex: none; }
  .said.grow { flex: 1; }
  .said-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); font-weight: 600; }
  .dot-sep { color: var(--text-3); font-size: 11px; }
  .num { font-variant-numeric: tabular-nums; }

  /* the tiles scroll between the video's name and +, with no scrollbar, so the strip keeps its height */
  .lane { position: relative; display: flex; flex: 0 1 auto; align-items: center; gap: 6px; min-width: 0; height: 100%; padding: 0 1px; overflow-x: auto;
    scrollbar-width: none; outline: none; }
  .lane::-webkit-scrollbar { display: none; }
  /* on a tight strip, the tiles out of sight fade into its ends rather than take arrows */
  .lane.fade-before { mask-image: linear-gradient(to right, transparent, #000 28px); }
  .lane.fade-after { mask-image: linear-gradient(to left, transparent, #000 28px); }
  .lane.fade-before.fade-after { mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent); }
  .rule { flex: none; width: 1px; height: 34px; margin: 0 4px; background: var(--border-strong); }
  .slot { position: relative; display: flex; flex: none; }

  .tile { display: grid; grid-template-columns: 64px minmax(0, 1fr); grid-template-rows: 1fr 1fr; column-gap: 7px; align-items: center;
    width: 156px; height: 50px; padding: 4px 8px 4px 4px; box-sizing: border-box; border: 1px solid var(--border);
    border-left: 3px solid var(--scene, var(--border-strong)); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-2);
    font-size: 11px; text-align: left; cursor: pointer; transition: border-color .12s, background-color .12s; }
  .tile:hover { border-color: var(--border-strong); border-left-color: var(--scene, var(--border-strong)); color: var(--text-1); }
  .tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tile.on { border-color: var(--accent); border-left-color: var(--scene, var(--accent)); background: var(--accent-soft); color: var(--text-1);
    box-shadow: 0 0 0 1px var(--accent); cursor: default; }
  /* a scene still to prove is dashed, its colour edge kept; a new slide is solid until saved */
  .tile.draft { border-style: dashed; border-left-style: solid; background: transparent; }
  .tile.draft.on { background: var(--accent-soft); }
  .tile.abandoned { opacity: .5; border-left-color: var(--border-strong); }
  .tile.abandoned:hover, .tile.abandoned.on { opacity: .8; }
  .tile.heading { outline: 1px dashed var(--accent); outline-offset: 2px; }

  .thumb { position: relative; grid-row: span 2; display: grid; place-items: center; width: 64px; height: 40px; border-radius: 2px;
    overflow: hidden; background: var(--bg-3); color: var(--text-3); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .draft .thumb.hollow { background: transparent; border: 1px dashed var(--border-strong); box-sizing: border-box; }
  .pin { display: grid; place-items: center; color: var(--text-3); }
  .tile-num { position: absolute; left: 2px; top: 2px; min-width: 14px; padding: 0 3px; border-radius: 2px; background: rgba(0, 0, 0, .68);
    color: #fff; font-size: 9px; font-weight: 700; line-height: 13px; text-align: center; font-variant-numeric: tabular-nums; }
  /* the scene being geolocated now: a small beat in the corner */
  .live { position: absolute; right: 3px; top: 3px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
    box-shadow: 0 0 0 0 var(--accent); animation: beat 1.6s ease-out infinite; }
  @keyframes beat { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent); } 80%, 100% { box-shadow: 0 0 0 6px transparent; } }
  @media (prefers-reduced-motion: reduce) { .live { animation: none; } }
  /* a slide saved with no place yet: a small amber dot in the corner */
  .unplaced { position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px; border-radius: 50%; background: var(--warn);
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, .55); }

  .tile-title { align-self: end; display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; white-space: nowrap;
    font-weight: 600; line-height: 14px; }
  .tile-title { text-overflow: ellipsis; }
  .tile-words { align-self: start; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3);
    font-size: 10px; line-height: 14px; font-variant-numeric: tabular-nums; }
  .tile.new .tile-words { color: var(--accent); }
  .dirty { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

  /* a tile's menu comes up under the pointer or the keys, so thirty tiles are not thirty ⋯ */
  .more { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); cursor: pointer; opacity: 0; transition: opacity .12s; }
  .slot:hover .more, .slot:focus-within .more, .more[aria-expanded='true'] { opacity: 1; }
  .more:hover, .more:focus-visible { background: var(--bg-3); color: var(--text-1); }

  /* past what the strip holds whole: a slide's picture and number, its name on hover */
  .compact .tile { grid-template-columns: 64px; grid-template-rows: 40px; width: 75px; column-gap: 0; padding: 4px; }
  .compact .tile-title, .compact .tile-words { display: none; }
  .compact .more { top: 6px; right: 6px; width: 16px; height: 16px; background: rgba(0, 0, 0, .62); color: #fff; }

  .edge { display: flex; flex: none; align-items: center; justify-content: center; gap: 1px; width: 30px; height: 50px;
    border-radius: var(--r-sm); color: var(--text-2); font-size: 10.5px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; }
  .edge:hover:not(:disabled) { background: var(--bg-3); color: var(--accent); }
  .edge:disabled { color: var(--text-3); opacity: .45; cursor: default; }

  .add { display: inline-flex; flex: none; align-items: center; justify-content: center; gap: 5px; height: 50px; padding: 0 12px;
    border: 1px dashed var(--border-strong); border-radius: var(--r-sm); color: var(--text-2); font-size: 11px; font-weight: 600;
    white-space: nowrap; cursor: pointer; }
  .add:hover { border-color: var(--accent); color: var(--text-1); }
  .add.bare { width: 34px; padding: 0; }
  .line .add { height: 22px; padding: 0 8px; }
  .line .add.bare { width: 24px; padding: 0; }

  .list, .fold, .step { display: inline-flex; flex: none; align-items: center; justify-content: center; gap: 4px; height: 26px; min-width: 26px;
    padding: 0 5px; border-radius: var(--r-sm); color: var(--text-2); font-size: 11px; cursor: pointer; }
  .line .list, .line .fold, .line .step { height: 22px; min-width: 22px; }
  .list:hover, .fold:hover, .step:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .list[aria-expanded='true'] { background: var(--accent-soft); color: var(--text-1); }
  .step:disabled { opacity: .35; cursor: default; }
  .tally { min-width: 40px; color: var(--text-3); font-size: 10.5px; text-align: center; white-space: nowrap; }

  .slide-why, .slide-name { display: flex; gap: 6px; padding: 4px; }
  .slide-why .input, .slide-name .input { flex: 1; min-width: 0; height: 26px; font-size: var(--fs-xs); }
  .list-search { padding: 2px 2px 6px; }
  .list-rows { min-height: 0; overflow-y: auto; }
  .row { gap: 7px; }
  .row.on { background: var(--accent-soft); }
  .row-num { flex: none; width: 20px; color: var(--text-3); font-size: 10.5px; text-align: right; }
  .row-edge { flex: none; width: 3px; height: 16px; border-radius: 2px; background: var(--scene, var(--border-strong)); }
  .row.draft .row-edge { opacity: .6; }
  .row.abandoned { opacity: .55; }
  .row-words { flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); font-size: 10.5px; }
</style>
