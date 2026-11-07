<script>
  /**
   * A scene still to prove, shown in place of a proof when the strip lands on it. Nothing
   * is started by landing here: a slide never started is never saved. The page says what
   * the scene is and where it stands, and offers what comes next: **Make this slide**
   * (its frames chosen, the proof opened on them), **Geolocate** (the map, the scene
   * gathering its captures) and **Abandon…** with a word, or **Restore** once given up.
   */
  import { tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { ABANDONED, GEOLOCATING } from '../../lib/proofSlides.js';
  import { PROOF_SLIDES_HELP as HELP } from '../../lib/proofSlidesHelp.js';

  let {
    /** The scene's tile (`lib/proofSlides.slideTiles`). */
    tile,
    caseId = '',
    /** `{ path, thumb }` of the captures it gathered, in the order they came. */
    captures = [],
    busy = false,
    /** `(action, extra)`: `make`, `geolocate`, `abandon` (`extra` the reason) or `restore`. */
    onaction,
  } = $props();

  const CAPTURES_SHOWN = 6;
  let asking = $state(false);
  let reason = $state('');
  let reasonField = $state(null);

  const given = $derived(tile.state === ABANDONED);
  const line = $derived.by(() => {
    const state = given ? (tile.reason ? `Abandoned: ${tile.reason}` : 'Abandoned') : tile.words;
    return tile.time && tile.time !== tile.title ? `${tile.time} · ${state}` : state;
  });

  async function ask() {
    asking = true;
    reason = '';
    await tick();
    reasonField?.focus();
  }

  function leave(event) {
    event.preventDefault();
    asking = false;
    onaction?.('abandon', reason.trim());
  }
</script>

<div class="draft-page" class:given style:--scene={tile.color} data-testid="draft-page">
  <div class="draft-card">
    <span class="draft-pin" aria-hidden="true"><Icon name="pin" size={22} /></span>
    <h3 dir="auto">{tile.title}</h3>
    <p class="draft-line">
      {#if tile.state === GEOLOCATING}<span class="live" aria-hidden="true"></span>{/if}
      <span dir="auto">{line}</span>
    </p>
    {#if captures.length && !given}
      <ul class="draft-captures" aria-label="Captures gathered for it">
        {#each captures.slice(0, CAPTURES_SHOWN) as capture (capture.path)}
          <li><img src={fileUrl(caseId, capture.thumb || capture.path)} alt="" loading="lazy" decoding="async" /></li>
        {/each}
        {#if captures.length > CAPTURES_SHOWN}<li class="more">+{captures.length - CAPTURES_SHOWN}</li>{/if}
      </ul>
    {/if}
    {#if given}
      <div class="draft-acts">
        <button class="btn btn-sm" disabled={busy} title={HELP.restore} onclick={() => onaction?.('restore')}>
          <Icon name="undo" size={14} /> Restore</button>
      </div>
    {:else if asking}
      <form class="draft-why" onsubmit={leave}>
        <input class="input" aria-label="Why it is abandoned" placeholder="Why? (optional)" maxlength="200" dir="auto"
          title={HELP.reason} bind:value={reason} bind:this={reasonField}
          onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); asking = false; } }} />
        <button class="btn btn-sm" disabled={busy}>Abandon</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => (asking = false)}>Cancel</button>
      </form>
    {:else}
      <div class="draft-acts">
        <button class="btn btn-primary btn-sm" disabled={busy} title={HELP.make} onclick={() => onaction?.('make')}>
          <Icon name="proof" size={14} /> Make this slide</button>
        <button class="btn btn-sm" disabled={busy} title={HELP.geolocate} onclick={() => onaction?.('geolocate')}>
          <Icon name="crosshair" size={14} /> Geolocate</button>
        <button class="btn btn-ghost btn-sm" disabled={busy} title={HELP.abandon} onclick={ask}>Abandon…</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .draft-page { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; }
  .draft-card { display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 460px; padding: 26px 30px 24px;
    border: 1px dashed var(--border-strong); border-radius: var(--r-lg); background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    text-align: center; }
  .draft-pin { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; color: var(--scene, var(--accent));
    background: color-mix(in srgb, var(--scene, var(--accent)) 14%, transparent); }
  .given .draft-pin { color: var(--text-3); background: var(--bg-3); }
  h3 { margin: 4px 0 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-1);
    font-size: var(--fs-lg); font-weight: 650; }
  .given h3 { color: var(--text-2); }
  .draft-line { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--text-3); font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums; }
  .live { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: beat 1.6s ease-out infinite; }
  @keyframes beat { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent); } 80%, 100% { box-shadow: 0 0 0 6px transparent; } }
  @media (prefers-reduced-motion: reduce) { .live { animation: none; } }
  .draft-captures { display: flex; flex-wrap: wrap; justify-content: center; gap: 5px; margin: 4px 0 0; padding: 0; list-style: none; }
  .draft-captures li { display: grid; place-items: center; width: 54px; height: 36px; overflow: hidden; border-radius: 3px; background: var(--bg-3);
    color: var(--text-3); font-size: 11px; }
  .draft-captures img { width: 100%; height: 100%; object-fit: cover; }
  .draft-acts, .draft-why { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 10px; }
  .draft-why .input { width: 220px; height: 28px; font-size: var(--fs-sm); }
</style>
