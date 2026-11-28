<script>
  /**
   * A What's new page that plays: its beats fade one into the next in a loop, each
   * picture framed and slowly brought nearer, a control of it lit, a film, pages dealt
   * out or a site scrolled (lib/newsReel.js says what a beat is). A strip along its foot
   * says where the loop stands and a chip what the beat shows. A reader who asked for
   * less motion (`calm`) sees the first beat still, as it is first framed. The reel is a
   * picture: the page's words carry what it says, so it is hidden from a screen reader.
   */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { DEAL_MS, FADE_MS, HOLD_MS, SPREAD_MS, aim, beatsOf, fitBox, moveCss } from '../lib/newsReel.js';

  let { reel, calm = false } = $props();

  const beats = $derived(beatsOf(reel));
  /** The browser bar's height, which a beat in a browser draws below. */
  const BAR = 30;

  let roomW = $state(0);
  let roomH = $state(0);
  /** The beat shown, the one fading out behind it, and how many times the loop has turned. */
  let at = $state(0);
  let leaving = $state(-1);
  let turn = $state(0);
  /** The shown beat has begun its move; a deck has spread. */
  let going = $state(false);
  let spread = $state(false);
  let holding = $state(HOLD_MS);
  /** @type {(HTMLVideoElement | null)[]} */
  const films = $state([]);

  /** The fade's end, put away with the reel. */
  let faded = 0;
  function advance(from) {
    leaving = from;
    at = (from + 1) % beats.length;
    turn += 1;
    clearTimeout(faded);
    faded = setTimeout(() => (leaving = -1), FADE_MS + 40);
  }
  $effect(() => () => clearTimeout(faded));

  $effect(() => {
    if (!beats || calm || !roomW) return;
    void turn;
    const shown = untrack(() => at);
    const beat = beats[shown];
    const timers = [];
    going = false;
    spread = false;
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => (going = true))));
    if (beat.kind === 'deck') timers.push(setTimeout(() => (spread = true), SPREAD_MS));
    const next = (ms) => {
      holding = ms;
      timers.push(setTimeout(() => advance(shown), ms));
    };
    const film = films[shown];
    if (film) {
      const play = () => {
        film.currentTime = 0;
        film.playbackRate = beat.rate;
        film.play().catch(() => {});
        next(beat.hold ?? Math.round((film.duration * 1000) / beat.rate));
      };
      if (film.readyState >= 1) play();
      else film.addEventListener('loadedmetadata', play, { once: true });
      return () => {
        cancelAnimationFrame(frame);
        timers.forEach(clearTimeout);
        film.removeEventListener('loadedmetadata', play);
        film.pause();
      };
    }
    next(beat.hold ?? HOLD_MS);
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  });

  /** The room a beat draws in: below the bar when it sits in a browser. */
  const roomOf = (beat) => ({ w: roomW, h: beat.browser ? roomH - BAR : roomH });

  /** Where a guide picture stands, and its first and last framings. */
  function placed(beat) {
    const room = roomOf(beat);
    const box = fitBox(beat.width, beat.height, room.w, room.h, beat.contain);
    return {
      box,
      from: moveCss(aim(box, beat.from, room.w, room.h, beat.contain)),
      to: moveCss(aim(box, beat.to, room.w, room.h, beat.contain)),
    };
  }

  /** The deck's pages: as tall as most of the room, fanned from the middle one. */
  const deck = $derived.by(() => {
    const h = roomH * 0.69;
    const w = (h * 210) / 297;
    return { w, h, top: roomH * 0.11, step: w * 0.475 };
  });

  const moving = (i) => (i === at && going) || i === leaving;
</script>

{#if beats}
  <div class="reel" class:calm aria-hidden="true" bind:clientWidth={roomW} bind:clientHeight={roomH}>
    {#if roomW}
      {#each beats as beat, i (i)}
        <div class="beat" class:on={i === at} class:go={moving(i)} class:spread={i === at ? spread || calm : i === leaving}>
          {#if beat.kind === 'deck'}
            <div class="deck">
              {#each beat.pages as src, n (n)}
                {@const d = n - (beat.pages.length - 1) / 2}
                <div
                  class="sheet"
                  class:hero={d === 0}
                  style:--n={n}
                  style:--x="{d * deck.step}px"
                  style:--y="{Math.abs(d) * deck.h * 0.048}px"
                  style:--r="{d * 6}deg"
                  style:--deal="{DEAL_MS}ms"
                  style:width="{deck.w}px"
                  style:height="{deck.h}px"
                  style:top="{deck.top}px"
                  style:margin-left="{-deck.w / 2}px"
                  style:z-index={10 - Math.abs(d)}
                >
                  <img {src} alt="" />
                </div>
              {/each}
            </div>
            {#if beat.pills.length}
              <div class="pills">
                {#each beat.pills as pill, n (pill)}<span style:--n={n}>{pill}</span>{/each}
              </div>
            {/if}
          {:else}
            <div class="frame" class:browser={beat.browser}>
              {#if beat.browser}
                <div class="bar">
                  <span class="lights"><i></i><i></i><i></i></span>
                  <span class="address">
                    <span class="lock" class:file={beat.file}><Icon name={beat.file ? 'file' : 'lock'} size={11} /></span>
                    {beat.browser}
                  </span>
                </div>
              {/if}
              <div class="view">
                {#if beat.kind === 'site'}
                  {@const width = roomOf(beat).w}
                  <img
                    class="page"
                    src={beat.src}
                    alt=""
                    style:--scroll="{-beat.scroll * width}px"
                    style:--scroll-ms="{(beat.hold ?? HOLD_MS) * 0.42}ms"
                  />
                  {#if beat.click}
                    <span
                      class="pointer"
                      style:--from-x="{width * 0.82}px"
                      style:--from-y="{roomOf(beat).h - 60}px"
                      style:--to-x="{beat.click[0] * width}px"
                      style:--to-y="{(beat.click[1] - beat.scroll) * width}px"
                      style:--scroll-ms="{(beat.hold ?? HOLD_MS) * 0.42}ms"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 2l16 9-7 2-3 7z" /></svg>
                      <i></i>
                    </span>
                  {/if}
                {:else if beat.width && !beat.browser}
                  {@const at2 = placed(beat)}
                  <div
                    class="box"
                    style:width="{at2.box.w}px"
                    style:height="{at2.box.h}px"
                    style:left="{at2.box.left}px"
                    style:top="{at2.box.top}px"
                    style:--from={at2.from}
                    style:--to={at2.to}
                    style:--move="{(beat.hold ?? HOLD_MS) + 500}ms"
                  >
                    {#if beat.film && !calm}
                      <video bind:this={films[i]} src={beat.film} poster={beat.src} muted playsinline preload="auto"></video>
                    {:else}
                      <img src={beat.src} alt="" />
                    {/if}
                    {#if beat.ring}
                      {@const r = beat.ring}
                      <span
                        class="ring"
                        style:left="{((r.x - 3) / beat.width) * 100}%"
                        style:top="{((r.y - 3) / beat.height) * 100}%"
                        style:width="{((r.w + 6) / beat.width) * 100}%"
                        style:height="{((r.h + 6) / beat.height) * 100}%"
                        style:--light="{r.light}ms"
                      ></span>
                      {#if r.label}
                        <span
                          class="name"
                          class:above={r.above}
                          style:left="{((r.x + r.w / 2) / beat.width) * 100}%"
                          style:top="{((r.above ? r.y - 3 : r.y + r.h + 3) / beat.height) * 100}%"
                          style:--light="{r.light + 200}ms">{r.label}</span
                        >
                      {/if}
                    {/if}
                  </div>
                {:else if beat.film && !calm}
                  <video class="fill" bind:this={films[i]} src={beat.film} poster={beat.src} muted playsinline preload="auto"></video>
                {:else}
                  <img class="fill" src={beat.src} alt="" />
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}
      {#if beats[at].chip}
        <span class="chip">
          {#if beats.length > 1}<b>{at + 1}</b>{/if}{beats[at].chip}
        </span>
      {/if}
      {#if beats.length > 1 && !calm}
        <span class="strip" style:--hold="{holding}ms">
          {#each beats as _, i (i)}<i class:done={i < at} class:now={i === at && going}></i>{/each}
        </span>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .reel {
    position: relative;
    /* a set width: the room it sits in shrinks to what it holds */
    width: 720px;
    max-width: 100%;
    height: var(--spot-h, 420px);
    border-radius: var(--r-lg);
    overflow: hidden;
    background: #0e1116;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
  }
  .beat {
    position: absolute;
    inset: 0;
    opacity: 0;
    overflow: hidden;
    transition: opacity 0.38s var(--ease);
  }
  .beat.on {
    opacity: 1;
  }
  .frame,
  .view {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  /* a guide picture, brought from its first framing to its last */
  .box {
    position: absolute;
    transform-origin: 0 0;
    transform: var(--from);
  }
  .go .box {
    transform: var(--to);
    transition: transform var(--move) cubic-bezier(0.45, 0.05, 0.35, 1);
  }
  .box img,
  .box video {
    display: block;
    width: 100%;
    height: 100%;
  }
  .fill {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top;
  }
  /* white and ink, as the guide's Spotlight lights a control */
  .ring {
    position: absolute;
    border: 2px solid #fff;
    border-radius: 8px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.5),
      0 0 0 9999px rgba(6, 8, 12, 0.42);
    opacity: 0;
    transition: opacity 0.35s var(--ease);
  }
  .go .ring {
    opacity: 1;
    transition-delay: var(--light);
  }
  .name {
    position: absolute;
    translate: -50% 8px;
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(17, 17, 17, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #f5f5f5;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.3s var(--ease);
  }
  .name.above {
    translate: -50% calc(-100% - 8px);
  }
  .go .name {
    opacity: 1;
    transition-delay: var(--light);
  }

  /* a browser round a web page, in the light chrome every browser wears */
  .browser .bar {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    background: #e9e9ec;
    border-bottom: 1px solid #d4d4d8;
  }
  .browser .view {
    top: 30px;
    background: #fff;
  }
  .lights {
    display: flex;
    gap: 5px;
  }
  .lights i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #ec6a5e;
  }
  .lights i:nth-child(2) {
    background: #f4bf4f;
  }
  .lights i:nth-child(3) {
    background: #61c554;
  }
  .address {
    flex: 1;
    min-width: 0;
    height: 20px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border-radius: 6px;
    background: #fff;
    border: 1px solid #d4d4d8;
    color: #3b3b40;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
  }
  .lock {
    display: inline-flex;
    color: #2f7d32;
  }
  .lock.file {
    color: #6b6b72;
  }

  /* a site scrolled, then pressed */
  .page {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: auto;
  }
  .go .page {
    transform: translateY(var(--scroll));
    transition: transform var(--scroll-ms) cubic-bezier(0.45, 0.05, 0.35, 1) 350ms;
  }
  .pointer {
    position: absolute;
    left: 0;
    top: 0;
    transform: translate(var(--from-x), var(--from-y));
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.45));
  }
  .pointer path {
    fill: #111;
    stroke: #fff;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .go .pointer {
    transform: translate(var(--to-x), var(--to-y));
    transition: transform 850ms cubic-bezier(0.3, 0.6, 0.3, 1) calc(350ms + var(--scroll-ms));
  }
  .pointer i {
    position: absolute;
    left: -10px;
    top: -10px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid #1f4e79;
    opacity: 0;
  }
  .go .pointer i {
    animation: press 0.5s var(--ease) calc(1250ms + var(--scroll-ms));
  }

  /* a report's pages dealt out on a plain table, the middle one lifted */
  .deck {
    position: absolute;
    inset: 0;
    perspective: 1100px;
    background: #26272a;
  }
  .sheet {
    position: absolute;
    left: 50%;
    border-radius: 2px;
    background: #fff;
    box-shadow:
      0 18px 40px rgba(0, 0, 0, 0.55),
      0 2px 6px rgba(0, 0, 0, 0.35);
    opacity: 0;
    transform: translate3d(calc(var(--x) * 0.2), 420px, -300px) rotateX(38deg) rotateZ(calc(var(--r) * -1.6));
  }
  .sheet img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 2px;
  }
  .go .sheet {
    opacity: 1;
    transform: translate3d(var(--x), var(--y), 0) rotateZ(var(--r));
    transition:
      transform 0.9s cubic-bezier(0.2, 0.95, 0.25, 1.12) calc(var(--n) * var(--deal)),
      opacity 0.4s ease calc(var(--n) * var(--deal));
  }
  .spread .sheet {
    opacity: 1;
    transform: translate3d(calc(var(--x) * 1.08), calc(var(--y) - 4px), 0) rotateZ(calc(var(--r) * 1.12));
    transition: transform 1.6s var(--ease);
  }
  .spread .sheet.hero {
    transform: translate3d(0, -12px, 60px) scale(1.1);
    box-shadow:
      0 30px 60px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(232, 163, 61, 0.5);
  }
  .pills {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 16px;
    display: flex;
    justify-content: center;
    gap: 8px;
  }
  .pills span {
    padding: 5px 12px;
    border-radius: 999px;
    background: rgba(14, 14, 14, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #f3f3f3;
    font-size: 12px;
    font-weight: 600;
    opacity: 0;
    translate: 0 10px;
  }
  .pills span:first-child {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .spread .pills span {
    opacity: 1;
    translate: 0 0;
    transition:
      opacity 0.35s,
      translate 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2);
    transition-delay: calc(var(--n) * 80ms);
  }

  /* where the loop stands */
  .chip {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px 5px 6px;
    border-radius: 999px;
    background: rgba(12, 12, 12, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: #f2f2f2;
    font-size: 11.5px;
    font-weight: 600;
  }
  .chip b {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 10.5px;
  }
  .strip {
    position: absolute;
    left: 3px;
    right: 3px;
    bottom: 3px;
    height: 3px;
    display: flex;
    gap: 3px;
  }
  .strip i {
    position: relative;
    flex: 1;
    overflow: hidden;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
  }
  .strip i::after {
    content: '';
    position: absolute;
    inset: 0;
    transform-origin: left;
    transform: scaleX(0);
    background: rgba(255, 255, 255, 0.85);
  }
  .strip i.done::after {
    transform: scaleX(1);
  }
  .strip i.now::after {
    animation: hold var(--hold) linear forwards;
  }

  /* a reader who asked for less motion: the first framing, still, its control lit */
  .calm *,
  .calm .beat {
    transition: none !important;
    animation: none !important;
  }
  .calm .ring,
  .calm .name {
    opacity: 1;
  }

  @keyframes hold {
    to {
      transform: scaleX(1);
    }
  }
  @keyframes press {
    from {
      opacity: 0.9;
      transform: scale(0.6);
    }
    to {
      opacity: 0;
      transform: scale(2.2);
    }
  }
</style>
