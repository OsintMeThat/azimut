<script>
  /**
   * The welcome, the tour and What's new (lib/onboarding.js), one card over the app.
   *
   * A newcomer meets the welcome: what Azimut is for, then the tour or the way past it.
   * The tour walks the four stages, a picture each with the one control that matters
   * lit, and ends on the case they are about to make, with the topbar's own `?` lit
   * through the veil and a line drawn to it: that is where help is, on any screen.
   * Someone who knows Azimut gets what their new version brings, in the same card, and
   * its page about the guide points at the same `?`.
   *
   * The tour is hard to leave by accident: the veil does nothing, Escape asks first, and
   * only Skip or its last page end it. Its page is kept as it turns, so a reload or the
   * next start picks it up there. The welcome and What's new close on Escape or the
   * veil and come back at the next start; Skip, Done or a choice puts them away.
   *
   * `onkeep(fields)` is handed `{ tour, whats_new_seen }` to keep; `onclose({ guide,
   * create })` is told whether the reader went for the guide, or for their first case.
   */
  import { untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import Spotlight from './Spotlight.svelte';
  import { portal } from '../lib/fullscreen.js';
  import { isTopOverlay, joinOverlays } from '../lib/overlayStack.js';
  import { shotOf } from '../lib/guide.js';
  import { TOUR, closeForThisStart, newsOf } from '../lib/onboarding.js';
  // filmed on the app's own globe by guide/hero.mjs: the whole Earth, then Yosemite Valley
  import film from '../assets/welcome/hero.webm';
  import filmStill from '../assets/welcome/hero.webp';

  let { start, version = '', anchor = null, hasCases = false, onkeep, onclose } = $props();

  const uid = $props.id();
  const FLIGHT_MS = 420;

  // opened on what it was asked for, it turns its own pages from there
  let mode = $state(untrack(() => start.kind));
  let step = $state(untrack(() => start.step ?? 0));
  const news = untrack(() => start.pages ?? newsOf(version));
  /** The tour asked whether to leave, after an Escape. */
  let asking = $state(false);
  let forward = $state(true);
  let leaving = $state(false);

  const pages = $derived(mode === 'tour' ? TOUR : mode === 'news' ? news : []);
  const page = $derived(pages[step] ?? null);
  const last = $derived(step === pages.length - 1);
  const shot = $derived(page?.shot ? shotOf(page.shot) : null);
  // the tour's last page, and a What's new page about the guide, point at the `?`
  const pointing = $derived((mode === 'tour' && last) || (mode === 'news' && Boolean(page?.help)));
  const going = $derived(
    !last ? 'Next' : mode === 'tour' && !hasCases ? 'Create my first case' : 'Done'
  );

  const self = {};
  $effect(() => joinOverlays(self, away));

  let rect = $state(null);
  let view = $state({ w: window.innerWidth, h: window.innerHeight });
  let box = $state({ left: 0, top: 0, w: 0, h: 0 });
  let root = $state(null);
  let card = $state(null);

  // offsets rather than the drawn box, so a page sliding in doesn't move the line
  function measure() {
    view = { w: window.innerWidth, h: window.innerHeight };
    if (card) box = { left: card.offsetLeft, top: card.offsetTop, w: card.offsetWidth, h: card.offsetHeight };
    const mark = pointing ? anchor?.getBoundingClientRect() : null;
    rect = mark && mark.width ? mark : null;
  }
  $effect(() => {
    measure();
    document.fonts?.ready.then(measure);
  });

  // The topbar can still be settling under the veil, and the card changes height from
  // one page to the next, so both are followed while the card is up.
  $effect(() => {
    let seen = '';
    let frame = requestAnimationFrame(function follow() {
      const mark = pointing ? anchor?.getBoundingClientRect() : null;
      const at = `${mark ? `${mark.left} ${mark.top} ${mark.width}` : '-'} ${card?.offsetWidth} ${card?.offsetHeight}`;
      if (at !== seen) {
        seen = at;
        measure();
      }
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  });

  /**
   * Out of the card's side and up into the button, or out of its top when the button
   * sits above the card (a narrow window). Both ends leave and arrive square, so the
   * curve reads as drawn rather than plotted.
   */
  const lead = $derived.by(() => {
    if (!rect) return null;
    const end = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom + 10) };
    const right = box.left + box.w;
    if (end.x > right + 64) {
      const start = { x: right, y: box.top + 38 };
      const c1 = Math.round(start.x + (end.x - start.x) * 0.6);
      const c2 = Math.round(end.y + (start.y - end.y) * 0.6);
      return { start, end, d: `M${start.x} ${start.y} C${c1} ${start.y} ${end.x} ${c2} ${end.x} ${end.y}` };
    }
    const start = { x: Math.min(Math.max(end.x, box.left + 40), right - 40), y: box.top };
    const rise = Math.round((start.y - end.y) / 2);
    return { start, end, d: `M${start.x} ${start.y} C${start.x} ${start.y - rise} ${end.x} ${end.y + rise} ${end.x} ${end.y}` };
  });

  // the main button keeps the focus as the card changes under it, so Enter walks on
  $effect(() => {
    void mode;
    void asking;
    queueMicrotask(() => root?.querySelector('.go')?.focus());
  });
  $effect(() => {
    const returnTo = document.activeElement;
    return () => {
      if (returnTo?.isConnected) returnTo.focus?.();
    };
  });

  const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const slide = $derived({ x: forward ? 28 : -28, duration: still() ? 0 : 260, opacity: 0 });

  /** Put away: into the lit `?` when there is one, so the eye follows to where help lives. */
  function finish(result = {}) {
    if (leaving) return;
    if (result.guide || !rect || !card?.animate || still()) {
      onclose(result);
      return;
    }
    leaving = true;
    const dx = Math.round(rect.left + rect.width / 2 - (box.left + box.w / 2));
    const dy = Math.round(rect.top + rect.height / 2 - (box.top + box.h / 2));
    const flight = [
      card.animate([{ translate: '0 0', scale: 1 }, { translate: `${dx}px ${dy}px`, scale: 0.05 }], {
        duration: FLIGHT_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards',
      }),
      card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FLIGHT_MS, easing: 'cubic-bezier(0.8, 0, 1, 1)', fill: 'forwards' }),
    ];
    Promise.all(flight.map((a) => a.finished)).finally(() => onclose(result));
  }

  /** Done with it for good: the tour, and the What's new of a version already known. */
  function putAway() {
    onkeep?.(mode === 'news' ? { whats_new_seen: version } : { tour: 'done', whats_new_seen: version });
  }

  function showMeAround() {
    forward = true;
    step = 0;
    mode = 'tour';
    onkeep?.({ tour: '1' });
  }

  function go(to) {
    if (to < 0 || to >= pages.length || to === step) return;
    forward = to > step;
    step = to;
    if (mode === 'tour') onkeep?.({ tour: String(to + 1) });
  }

  function next() {
    if (!last) return go(step + 1);
    putAway();
    finish({ create: mode === 'tour' && !hasCases });
  }

  function skip() {
    putAway();
    finish();
  }

  function toGuide() {
    putAway();
    finish({ guide: true });
  }

  /** Escape, the veil, the browser's Back: the tour asks first, the others wait for the next start. */
  function away() {
    if (mode === 'tour') {
      asking = true;
      return;
    }
    closeForThisStart(version);
    finish();
  }

  function onkeydown(e) {
    if (!isTopOverlay(self) || leaving) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (asking) asking = false;
      else away();
    } else if (mode !== 'welcome' && !asking && e.key === 'ArrowRight' && !last) {
      go(step + 1);
    } else if (mode !== 'welcome' && !asking && e.key === 'ArrowLeft') {
      go(step - 1);
    }
  }

  /** Tab stays on the card and the lit button rather than walking the page behind. */
  function trap(e) {
    if (e.key !== 'Tab' || !root) return;
    const items = [...root.querySelectorAll('button:not(:disabled)')];
    const [first, end] = [items[0], items.at(-1)];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      end.focus();
    } else if (!e.shiftKey && document.activeElement === end) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window {onkeydown} onresize={measure} />

<div class="onboarding" class:leaving use:portal bind:this={root} onkeydown={trap} role="presentation">
  <!-- dark in either theme, cut round the topbar's `?` when the card points at it -->
  <div class="veil" role="presentation" onclick={() => mode !== 'tour' && away()}>
    <svg width={view.w} height={view.h} aria-hidden="true">
      <defs>
        <mask id="{uid}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width={view.w} height={view.h}>
          <rect width={view.w} height={view.h} fill="white" />
          {#if rect}
            <rect class="cut" x={rect.left - 3} y={rect.top - 3} width={rect.width + 6} height={rect.height + 6} rx="10" fill="black" />
          {/if}
        </mask>
      </defs>
      <rect class="shade" width={view.w} height={view.h} mask="url(#{uid}-cut)" />
    </svg>
  </div>
  {#if rect}
    <button
      class="lit"
      style:left="{rect.left - 3}px"
      style:top="{rect.top - 3}px"
      style:width="{rect.width + 6}px"
      style:height="{rect.height + 6}px"
      aria-label="Open the guide"
      title="Open the guide"
      onclick={toGuide}
    ></button>
  {/if}

  <div class="pane" bind:this={card} role="dialog" aria-modal="true" aria-labelledby="{uid}-title">
    {#snippet filmed()}
      <!-- the film loops through black at both ends, so it never cuts; a reader who asked
           for less motion gets its still -->
      <figure class="film">
        {#if still()}
          <img src={filmStill} alt="" />
        {:else}
          <video src={film} poster={filmStill} autoplay muted loop playsinline aria-hidden="true"></video>
        {/if}
        <figcaption>USGS imagery, public domain · relief © Mapterhorn</figcaption>
      </figure>
    {/snippet}
    {#if mode === 'welcome'}
      {@render filmed()}
    {:else}
    <div class="stage" class:filming={page?.film}>
      {#key `${mode}:${step}`}
        <div class="show" in:fly={slide}>
          {#if page?.film}
            {@render filmed()}
          {:else if shot}
            <Spotlight {shot} anchor={page?.anchor} label={page?.label ?? ''} />
          {:else if page?.items}
            <ul class="items">
              {#each page.items as item (item.text)}
                <li><span class="glyph"><Icon name={item.icon} size={18} /></span>{item.text}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/key}
    </div>
    {/if}

    <div class="body">
      {#key `${mode}:${step}`}
        <div class="words" in:fly={slide}>
          {#if mode === 'welcome'}
            <div class="hello">
              <Logo size={30} />
              <h2 id="{uid}-title"><span class="soft">Welcome to</span> Azimut</h2>
            </div>
            <p class="text">A workbench for open-source investigations, at its best on one question: where and when was this picture taken?</p>
            <ul class="three">
              <li><Icon name="download" size={15} />Bring in the posts, photos and videos you are looking into.</li>
              <li><Icon name="satellite" size={15} />Find where they were shot: imagery, relief, the skyline, the sun.</li>
              <li><Icon name="proof" size={15} />Prove it, and publish the proof.</li>
            </ul>
            <p class="local"><Icon name="lock" size={12} />Your cases stay on this computer, one folder each.</p>
          {:else if page}
            <p class="where">
              {#if mode === 'tour'}
                <Icon name={page.where.icon} size={13} />{page.where.label}
              {:else}
                <Icon name="star" size={13} />New in {page.version}
              {/if}
              {#if page.badge}<span class="badge">{page.badge}</span>{/if}
            </p>
            <h2 id="{uid}-title">{page.title}</h2>
            {#if page.text}<p class="text">{page.text}</p>{/if}
            {#if pointing}
              <p class="help">
                {#if mode === 'tour'}
                  Need help on a screen? Press
                  <span class="key" role="img" aria-label="?"><Icon name="help" size={14} /></span>
                  at the top right.
                {:else}
                  <span class="key" role="img" aria-label="?"><Icon name="help" size={14} /></span>
                  {page.help}
                {/if}
              </p>
            {/if}
          {/if}
        </div>
      {/key}
    </div>

    <footer>
      {#if mode === 'welcome'}
        <button class="btn btn-ghost btn-sm" onclick={skip}>I know Azimut already</button>
        <span></span>
        <button class="btn btn-primary go" onclick={showMeAround}>
          Show me around <Icon name="arrowRight" size={14} />
        </button>
      {:else if asking}
        <p class="ask">Leave the tour? Home can start it again.</p>
        <span></span>
        <div class="moves">
          <button class="btn btn-ghost btn-sm" onclick={skip}>Leave</button>
          <button class="btn btn-primary go" onclick={() => (asking = false)}>Continue</button>
        </div>
      {:else}
        <button class="btn btn-ghost btn-sm" onclick={skip}>{mode === 'tour' ? 'Skip the tour' : 'Skip'}</button>
        <div class="dots">
          {#each pages as one, at (at)}
            <button
              class:on={at === step}
              aria-label="{one.title}, page {at + 1} of {pages.length}"
              aria-current={at === step ? 'step' : undefined}
              onclick={() => go(at)}
            ></button>
          {/each}
        </div>
        <div class="moves">
          <button class="btn btn-ghost btn-sm" class:hidden={step === 0} disabled={step === 0} onclick={() => go(step - 1)}>
            <Icon name="chevronLeft" size={14} /> Back
          </button>
          <button class="btn btn-primary go" onclick={next}>
            {going}
            {#if !last}<Icon name="arrowRight" size={14} />{/if}
          </button>
        </div>
      {/if}
    </footer>
  </div>

  {#if lead}
    <svg class="lead" width={view.w} height={view.h} aria-hidden="true">
      <mask id="{uid}-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width={view.w} height={view.h}>
        <path class="reveal" d={lead.d} pathLength="1" />
      </mask>
      <path class="trail" d={lead.d} mask="url(#{uid}-reveal)" />
      <circle class="port" cx={lead.start.x} cy={lead.start.y} r="4" />
    </svg>
  {/if}
</div>

<style>
  /* over the topbar (1200) as well as the tool, unlike a modal, since the veil has to
     dim the topbar round the one button it points at; the veil is dark in either
     theme, so the line and the ring round the `?` are light in both */
  .onboarding {
    --ink: #f5f5f5;
    --spot-h: clamp(180px, calc(100vh - 380px), 420px);
    position: fixed;
    inset: 0;
    z-index: 1300;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .onboarding.leaving {
    pointer-events: none;
  }
  .veil,
  .veil svg {
    position: absolute;
    inset: 0;
  }
  .shade {
    fill: rgba(4, 7, 12, 0.76);
    animation: dim 0.3s var(--ease) backwards;
  }
  .cut {
    animation: dim 0.35s var(--ease) backwards;
  }
  .leaving .veil {
    opacity: 0;
    transition: opacity 0.42s var(--ease);
  }
  /* the topbar's own `?`, ringed where the veil is cut round it */
  .lit {
    position: fixed;
    border-radius: 10px;
    box-shadow:
      0 0 0 2px var(--ink),
      0 0 22px 4px rgba(245, 245, 245, 0);
    cursor: pointer;
    animation: dim 0.3s var(--ease) backwards;
    transition: box-shadow 0.2s var(--ease);
  }
  .lit::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    border: 2px solid var(--ink);
    /* once the line has reached it */
    animation: ping 1.8s var(--ease) 0.85s infinite backwards;
  }
  .leaving .lit {
    opacity: 0;
    transition: opacity 0.42s var(--ease);
  }

  .pane {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(760px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    background: var(--bg-1);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    overflow: hidden;
    box-shadow:
      0 28px 80px rgba(0, 0, 0, 0.6),
      0 2px 8px rgba(0, 0, 0, 0.3);
    animation: arrive 0.36s var(--ease) 0.06s backwards;
  }
  /* the picture's room is the same on every page, so the card holds still as it turns */
  .stage {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    height: calc(var(--spot-h) + 40px);
    padding: 20px;
    background:
      radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--text-1) 6%, transparent), transparent 70%),
      var(--bg-0);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
  }
  /* the welcome's film runs edge to edge, as tall as it is */
  .film {
    position: relative;
    margin: 0;
    line-height: 0;
    background: #000;
    border-bottom: 1px solid var(--border);
  }
  .film video,
  .film img {
    display: block;
    width: 100%;
    aspect-ratio: 9 / 4;
    object-fit: cover;
  }
  /* What's new plays the same film in the picture's room, filling it */
  .stage.filming {
    padding: 0;
    background: #000;
  }
  .stage.filming .show,
  .stage.filming .film {
    width: 100%;
    height: 100%;
    border-bottom: 0;
  }
  .stage.filming .film video,
  .stage.filming .film img {
    height: 100%;
    aspect-ratio: auto;
  }
  .badge {
    margin-left: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    background: var(--bg-2);
    color: var(--text-1);
    letter-spacing: 0.04em;
  }
  .film figcaption {
    position: absolute;
    right: 10px;
    bottom: 8px;
    font-size: 10px;
    line-height: 1.2;
    color: rgba(255, 255, 255, 0.62);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    pointer-events: none;
  }
  .show {
    display: grid;
    place-items: center;
    max-width: 100%;
    max-height: 100%;
  }
  .items {
    display: grid;
    gap: 14px;
    max-width: 440px;
    padding: 0;
    margin: 0;
    list-style: none;
    font-size: var(--fs-lg);
    color: var(--text-1);
  }
  .items li {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .glyph {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    color: var(--text-1);
  }
  .body {
    padding: 20px 26px 4px;
    min-height: 132px;
    overflow: auto;
  }
  .hello {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h2 {
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.25;
    color: var(--text-1);
  }
  .soft {
    color: var(--text-3);
    font-weight: 500;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .text {
    margin-top: 8px;
    max-width: 60ch;
    font-size: var(--fs-md);
    line-height: 1.55;
    color: var(--text-2);
  }
  .three {
    display: grid;
    gap: 8px;
    margin: 16px 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-md);
    color: var(--text-1);
  }
  .three li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .three :global(svg) {
    flex-shrink: 0;
    color: var(--text-3);
  }
  .local {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .help {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding: 9px 12px;
    border-radius: var(--r-lg);
    background: var(--bg-2);
    border: 1px solid var(--border);
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .key {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    color: var(--text-1);
    transition:
      border-color 0.2s var(--ease),
      background 0.2s var(--ease);
  }
  .key:hover {
    border-color: var(--text-1);
    background: var(--bg-3);
  }

  footer {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    padding: 14px 20px 16px 18px;
  }
  footer > :last-child {
    justify-self: end;
  }
  .moves {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .go {
    gap: 6px;
  }
  .hidden {
    visibility: hidden;
  }
  .ask {
    font-size: var(--fs-sm);
    color: var(--text-1);
    white-space: nowrap;
  }
  .dots {
    display: flex;
    gap: 2px;
  }
  .dots button {
    position: relative;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .dots button::after {
    content: '';
    position: absolute;
    inset: 6px;
    border-radius: 50%;
    background: var(--border-strong);
    transition:
      background 0.2s var(--ease),
      inset 0.2s var(--ease);
  }
  .dots button:hover::after {
    background: var(--text-3);
  }
  .dots button.on::after {
    inset: 5px;
    background: var(--text-1);
  }

  /* drawn from the card to the `?`, then its dots drift that way */
  .lead {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  .reveal {
    fill: none;
    stroke: #fff;
    stroke-width: 14;
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
    animation: draw 0.55s var(--ease) 0.3s backwards;
  }
  .leaving .reveal {
    animation: retract 0.42s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }
  .trail {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 0 7;
    stroke-opacity: 0.7;
    animation: flow 0.9s linear infinite;
    transition:
      stroke-opacity 0.2s var(--ease),
      stroke-width 0.2s var(--ease);
  }
  .port {
    fill: var(--ink);
    stroke: rgba(245, 245, 245, 0.22);
    stroke-width: 6;
    paint-order: stroke;
    animation: dim 0.2s var(--ease) 0.3s backwards;
    transition: opacity 0.12s var(--ease);
  }
  .leaving .port {
    opacity: 0;
  }
  /* pointing at the `?` from the card lights the way to it */
  .onboarding:has(.key:hover, .lit:hover) .trail {
    stroke-opacity: 1;
    stroke-width: 2.6;
  }
  .onboarding:has(.key:hover, .lit:hover) .lit {
    box-shadow:
      0 0 0 2px var(--ink),
      0 0 22px 4px rgba(245, 245, 245, 0.35);
  }

  @keyframes dim {
    from {
      opacity: 0;
    }
  }
  @keyframes arrive {
    from {
      opacity: 0;
      translate: 0 12px;
      scale: 0.97;
    }
  }
  @keyframes ping {
    from {
      opacity: 0.7;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(1.7);
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }
  @keyframes retract {
    to {
      stroke-dashoffset: -1;
    }
  }
  @keyframes flow {
    to {
      stroke-dashoffset: -7;
    }
  }

  /* a narrow window: the buttons first, the dots under them */
  @media (max-width: 560px) {
    footer {
      grid-template-columns: 1fr auto;
    }
    .dots {
      grid-row: 2;
      grid-column: 1 / -1;
      justify-self: center;
    }
    .ask {
      white-space: normal;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .shade,
    .cut,
    .lit,
    .lit::after,
    .pane,
    .reveal,
    .trail,
    .port {
      animation: none;
    }
  }
</style>
