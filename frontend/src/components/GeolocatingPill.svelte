<script>
  /**
   * The top bar's word on the scene the open case is geolocating, from every tool:
   * its time, its label and its two counts (`components/SceneCounts`), the captures
   * gathered for it on the map and the frames and collages its video gives it. Every
   * capture filed meanwhile is gathered for it on the server, the extension's included,
   * so the map's count is what moves here, with a short pulse when it does, on the
   * server's word and before it is read again (`lib/geolocating.svelte.js`). A dot in the
   * scene's colour, the one Inspect's bar and the reference window draw it in, ties
   * the three together (`order`, `lib/scenes.sceneColorAt`). Its label goes
   * back to the scene in Inspect, Make the proof opens Inspect's chooser on it, Open the
   * proof the proof that holds it, open in Geo Proof or saved (`openHeldProof`), and ✕
   * stops. Its counts open the list of what the scene gathered, leads included
   * (`components/GatheredPanel.svelte`), and three small links go to Inspect on the
   * scene, Satellite and Horizon. It sits in the top bar, clear of every map control
   * and capture button.
   */
  import { onDestroy, untrack } from 'svelte';
  import GatheredPanel from './GatheredPanel.svelte';
  import Icon from './Icon.svelte';
  import SceneCounts from './SceneCounts.svelte';
  import { onEvent } from '../lib/events.js';
  import { fileStem } from '../lib/proofScene.js';
  import { caseState, toast, uiState } from '../lib/state.svelte.js';
  import {
    geolocating, goWithScene, heldInGeoProof, openHeldProof, readGeolocating, stopGeolocating,
  } from '../lib/geolocating.svelte.js';
  import { GEOLOCATING_HELP as HELP } from '../lib/geolocatingHelp.js';
  import { sceneColorAt } from '../lib/scenes.js';
  import { captureCount, isPicture, queueShortTime, queueTime } from '../lib/sceneQueue.js';

  const held = $derived(
    geolocating.caseId && geolocating.caseId === caseState.current?.id ? geolocating.scene : null,
  );
  // a picture says Whole picture where a video's scene says its time, its first moment
  // and the rest counted when it holds several; every one of them on hover
  const said = $derived(held ? { kind: 'draft', start: held.start, end: held.end, more: held.more, file_kind: held.file_kind } : null);
  const time = $derived(said ? queueShortTime(said) : '');
  const picture = $derived(isPicture(held));
  // the proof open in Geo Proof holds it, saved or not: the press goes back to it
  const inGeoProof = $derived(heldInGeoProof(held));
  const count = $derived(captureCount(held));
  // what the case calls its file: its title in Media, else its name with no extension
  const file = $derived(held ? held.file_title || fileStem(held.video) : '');
  const color = $derived(held ? sceneColorAt(held.order) : null);
  // a narrow bar drops the word and the label; the whole line stays on the pill
  const named = $derived(held ? ['Geolocating', queueTime(said), held.label].filter(Boolean).join(' · ') : '');

  // Read when a case opens, and again when the case reloads while one is held: a
  // capture reloads it, so the count is right even with no word from the server.
  let readFor = null;
  $effect(() => {
    const id = caseState.current?.id ?? null;
    caseState.rev;
    untrack(() => {
      if (!id || (id === readFor && !held)) return;
      readFor = id;
      readGeolocating(id);
    });
  });

  // Its video's scenes saved, here or in another tab: it may have been renamed or retimed.
  onDestroy(
    onEvent('scenes', (event) => {
      if (held && event.case_id === geolocating.caseId && event.video === held.video) readGeolocating(event.case_id);
    }),
  );

  // A capture gathered: the count steps up with a pulse, rather than a toast.
  let pulse = $state(0);
  let last = { id: null, count: 0 };
  $effect(() => {
    const id = held?.id ?? null;
    const n = count;
    if (id && id === last.id && n > last.count) untrack(() => (pulse += 1));
    last = { id, count: n };
  });

  // The list of what it gathered, under the counts; closed when the scene ends.
  let listOpen = $state(false);
  let countButton = $state();
  $effect(() => {
    if (!held) listOpen = false;
  });

  function backToScene(proof = false) {
    if (!held) return;
    uiState.inspectScene = { video: held.video, draft: held.id, ...(proof ? { proof: true } : {}) };
    uiState.tool = 'inspect';
  }

  async function stop() {
    const id = caseState.current?.id;
    if (!id) return;
    try {
      await stopGeolocating(id);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }
</script>

{#if held}
  <div class="geo-pill" role="group" aria-label={named} style:--scene={color} data-guide="geo.pill">
    <button
      class="geo-scene"
      onclick={() => backToScene()}
      title={HELP.back(file)}
    >
      <Icon name="crosshair" size={13} />
      <span class="geo-what">Geolocating</span>
      <span class="geo-dot" style:--scene={color} aria-hidden="true" data-testid="geolocating-dot"></span>
      <span class="geo-time" class:mono={held.start != null && !picture} title={held.more?.length ? queueTime(said) : undefined}>{time}</span>
      {#if held.label}
        <span class="geo-sep" aria-hidden="true">·</span>
        <span class="geo-label" dir="auto">{held.label}</span>
      {/if}
    </button>
    {#key pulse}
      <button
        class="geo-count"
        class:open={listOpen}
        bind:this={countButton}
        onclick={() => (listOpen = !listOpen)}
        aria-expanded={listOpen}
        aria-label={HELP.gathered}
        data-testid="geolocating-count"
        data-guide="geo.counts"
      >
        <SceneCounts scene={held} live mark={false} size={12} bump={pulse > 0} />
      </button>
    {/key}
    <span class="geo-links" data-guide="geo.links">
      <button class="geo-link" onclick={() => backToScene()} title={HELP.inspect} aria-label={HELP.inspect}>
        <Icon name="inspect" size={13} />
      </button>
      <button class="geo-link" onclick={() => goWithScene('satellite')} title={HELP.satellite} aria-label="Go to Satellite">
        <Icon name="satellite" size={13} />
      </button>
      <button class="geo-link" onclick={() => goWithScene('horizon')} title={HELP.horizon} aria-label={HELP.horizon}>
        <Icon name="horizon" size={13} />
      </button>
    </span>
    <span class="geo-rule" aria-hidden="true"></span>
    <!-- once a proof holds the scene, open in Geo Proof or saved with no place yet, the press opens it: never a second one -->
    {#if inGeoProof || held.proof}
      <button class="geo-make" onclick={() => openHeldProof(held)} title={inGeoProof ? HELP.openHere : HELP.open} data-guide="geo.make">
        <Icon name="proof" size={12} />
        <span class="geo-make-words">Open the proof</span>
      </button>
    {:else}
      <button class="geo-make" onclick={() => backToScene(true)} title={picture ? HELP.makePicture : HELP.make} data-guide="geo.make">
        <Icon name="proof" size={12} />
        <span class="geo-make-words">Make the proof</span>
      </button>
    {/if}
    <button class="geo-stop" onclick={stop} title={HELP.stop} aria-label="Stop geolocating" data-guide="geo.stop">
      <Icon name="x" size={12} />
    </button>
  </div>
  {#if listOpen && countButton}
    <GatheredPanel
      caseId={geolocating.caseId}
      scene={held}
      {color}
      anchor={countButton}
      onclose={() => (listOpen = false)}
    />
  {/if}
{/if}

<style>
  /* A calm capsule in the bar: the accent only on its mark and its edge. */
  .geo-pill {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 640px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 3px 0 0;
    border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border));
    border-radius: 14px;
    background: var(--bg-0);
    color: var(--text-1);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .geo-scene {
    flex: 0 1 auto;
    min-width: 0;
    height: 100%;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 10px;
    border-radius: 14px 0 0 14px;
    color: inherit;
  }
  .geo-scene:hover {
    background: var(--bg-2);
  }
  .geo-scene :global(svg) {
    flex-shrink: 0;
    color: var(--accent);
  }
  .geo-what {
    color: var(--text-2);
    font-weight: 600;
  }
  .geo-sep {
    color: var(--text-3);
  }
  .geo-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--scene);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--scene) 28%, transparent);
  }
  .geo-time {
    flex-shrink: 0;
    color: var(--text-1);
  }
  .geo-label {
    min-width: 0;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-1);
    font-weight: 500;
  }
  .geo-count {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    padding: 0 8px;
    border-radius: 10px;
    background: var(--bg-3);
    color: inherit;
  }
  .geo-count:hover,
  .geo-count.open {
    background: var(--bg-2);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .geo-links {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    margin-left: 2px;
  }
  .geo-link {
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
    border-radius: 11px;
    color: var(--text-3);
  }
  .geo-link:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .geo-rule {
    flex-shrink: 0;
    width: 1px;
    height: 14px;
    margin: 0 3px;
    background: var(--border-strong);
  }
  .geo-make,
  .geo-stop {
    flex-shrink: 0;
    height: 22px;
    display: inline-flex;
    align-items: center;
    border-radius: 11px;
    color: var(--text-2);
  }
  .geo-make {
    gap: 5px;
    padding: 0 8px;
    font-weight: 500;
  }
  .geo-make :global(svg) {
    color: var(--accent);
  }
  .geo-stop {
    justify-content: center;
    width: 22px;
  }
  .geo-make:hover,
  .geo-stop:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  /* a narrower window keeps the time, the count and the two acts */
  @media (max-width: 1240px) {
    .geo-what {
      display: none;
    }
    .geo-label {
      max-width: 120px;
    }
  }
  @media (max-width: 1080px) {
    .geo-make-words {
      display: none;
    }
    .geo-label {
      max-width: 80px;
    }
  }
</style>
