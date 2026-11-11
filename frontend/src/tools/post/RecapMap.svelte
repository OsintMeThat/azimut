<script>
  /**
   * Recap first's picture, in the thread's column: the places on a map (`lib/recapMap.js`)
   * or the proofs sheet. The map takes a few choices, each redrawn at once on a small
   * preview of what goes out: its ground (Satellite or Map), a dashed line joining the
   * places in the video's order, and the signature and the Azimut mark, as the analyst's
   * default proof style has them. The composer draws it whole and files it when the
   * thread needs its picture (`post/threadSheet.js` `makeRecapMap`), never on a choice.
   *
   * Local first: the preview is drawn on a plain ground until the analyst asks for the
   * map (`live`): Show the map, a pick of Map or of a ground. Places too close together
   * for a map leave the sheet, and a line says so.
   */
  import '@fontsource/inter/latin-400.css';
  import '@fontsource/inter/latin-600.css';
  import '@fontsource/inter/latin-700.css';
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import { myLogoUrl } from '../../lib/myLogo.js';
  import { defaultProofTemplate } from '../../lib/proofTemplates.js';
  import {
    BACKGROUNDS, BACKGROUND_NAMES, loadAppTile, mapOptions, recapFit, recapMapPreview, recapPlaces,
  } from '../../lib/recapMap.js';
  import { prefs, templatesState } from '../../lib/state.svelte.js';

  let {
    /** The places the thread posts (`videoThread.videoSlides`), null while read. */
    slides = null,
    /** What the recap carries: 'map' or 'sheet'. */
    recap = 'sheet',
    /** The map's choices (`recapMap.mapOptions`). */
    options = {},
    /** Whether the map's tiles may be asked for: the analyst pressed for the map. */
    live = false,
    /** `(kind)`: the recap carries the map or the sheet. */
    onrecap,
    /** `(patch)`: a choice changed. */
    onoptions,
    /** Ask for the map's tiles. */
    onlive,
    /** The preview's drawing, `lib/recapMap.js`'s by default. */
    preview = recapMapPreview,
  } = $props();

  const places = $derived(recapPlaces(slides ?? []));
  const fit = $derived(recapFit(places));
  const wanted = $derived(mapOptions(options));
  const onMap = $derived(recap === 'map' && fit.ok);
  const tooClose = $derived(slides !== null && !fit.ok);

  // What signs it: the analyst's default proof style, their logo and their handle.
  let providers = $state([]);
  let logo = $state(null);
  const handle = $derived(prefs.signatureHandle ?? '');
  const style = $derived(defaultProofTemplate(templatesState.proof, prefs.proofTemplate)?.data ?? null);
  const canSign = $derived(!!logo || !!handle.trim());

  // the catalogue (for the ground's credit) and the logo, read from the app once the map shows
  let sourcesRead = false;
  $effect(() => {
    if (!onMap || sourcesRead) return;
    sourcesRead = true;
    api.get('/api/satellite/providers').then((list) => { providers = Array.isArray(list) ? list : []; }, () => {});
    const picture = new Image();
    picture.onload = () => { logo = picture; };
    picture.onerror = () => { logo = null; };
    picture.src = myLogoUrl();
  });

  // The preview, drawn again on each change: the last asked wins, and the one before is let go.
  let shown = $state(null); // { url, revoke, missing }
  let drawing = $state(false);
  let turn = 0;
  $effect(() => {
    if (!onMap) return;
    const ask = { places, fit, wanted, live, providers, logo, handle, style };
    const mine = ++turn;
    drawing = true;
    (async () => {
      try {
        await Promise.all([document.fonts?.load?.('600 16px Inter'), document.fonts?.load?.('700 16px Inter')]);
        const next = await preview(ask.places, ask.fit, ask.wanted, {
          providers: ask.providers, loadTile: ask.live ? loadAppTile : null, style: ask.style, logo: ask.logo, handle: ask.handle,
        });
        if (mine !== turn) return next.revoke();
        shown?.revoke();
        shown = next;
      } catch {
        if (mine === turn) shown = null;
      } finally {
        if (mine === turn) drawing = false;
      }
    })();
  });
  $effect(() => () => shown?.revoke());

  const choose = (patch) => onoptions?.(patch);
</script>

<div class="rm" data-testid="recap-picture">
  <div class="rm-row" role="radiogroup" aria-label="Recap picture">
    <span class="label">Recap picture</span>
    <div class="rm-seg">
      <button type="button" class="btn btn-sm" class:btn-primary={onMap} class:btn-ghost={!onMap} role="radio" aria-checked={onMap}
        disabled={!fit.ok} title={fit.ok ? 'The places on a map, numbered as the recap lists them' : 'No map for these places'}
        onclick={() => !onMap && onrecap?.('map')}>Map</button>
      <button type="button" class="btn btn-sm" class:btn-primary={!onMap} class:btn-ghost={onMap} role="radio" aria-checked={!onMap}
        title="The proofs' pictures side by side, numbered" onclick={() => onMap && onrecap?.('sheet')}>Proofs sheet</button>
    </div>
  </div>
  {#if tooClose}
    <p class="rm-note" data-testid="recap-fallback">{fit.why === 'none'
      ? 'These places have no point to put on a map, so the recap shows the proofs sheet.'
      : 'These places are too close together for a map, so the recap shows the proofs sheet.'}</p>
  {/if}

  {#if onMap}
    <div class="rm-preview dark-surface" aria-busy={drawing}>
      {#if shown}<img src={shown.url} alt="The recap map, small" />{/if}
      {#if !live}
        <button type="button" class="btn btn-sm rm-show" onclick={() => onlive?.()}
          title="Loads the map's tiles for this preview">
          <Icon name="satellite" size={13} /> Show the map
        </button>
      {:else if shown?.missing}
        <span class="rm-gap" title="Some tiles did not load: the plain ground shows there">Some tiles did not load</span>
      {/if}
    </div>

    <div class="rm-row" role="radiogroup" aria-label="Background">
      <span class="label">Background</span>
      <div class="rm-seg">
        {#each Object.keys(BACKGROUNDS) as one (one)}
          <button type="button" class="btn btn-sm" class:btn-primary={wanted.background === one} class:btn-ghost={wanted.background !== one}
            role="radio" aria-checked={wanted.background === one} onclick={() => choose({ background: one })}>{BACKGROUND_NAMES[one]}</button>
        {/each}
      </div>
    </div>
    <label class="rm-check" title="A dashed line from place to place, in the order the video shows them">
      <input type="checkbox" checked={wanted.line} onchange={(event) => choose({ line: event.currentTarget.checked })} />
      Line in video order
    </label>
    <div class="rm-checks">
      <label class="rm-check" title={canSign ? 'Your logo and handle, where your proofs put them' : 'Add a logo or your handle in Settings → Publishing to sign the map'}>
        <input type="checkbox" checked={wanted.signature && canSign} disabled={!canSign}
          onchange={(event) => choose({ signature: event.currentTarget.checked })} />
        Signature
      </label>
      <label class="rm-check" title="The Azimut mark, where your proofs put it">
        <input type="checkbox" checked={wanted.mark} onchange={(event) => choose({ mark: event.currentTarget.checked })} />
        Azimut mark
      </label>
    </div>
  {/if}
</div>

<style>
  .rm { display: flex; flex-direction: column; gap: 8px; }
  .rm-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .rm-row .label { margin: 0; }
  .rm-seg { display: flex; gap: 4px; }
  .rm-note { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .rm-preview {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: #2b3138;
  }
  .rm-preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .rm-show { position: relative; gap: 6px; box-shadow: var(--shadow-2); }
  .rm-gap {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 10.5px;
  }
  .rm-checks { display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .rm-check { display: inline-flex; align-items: center; gap: 7px; color: var(--text-2); font-size: var(--fs-sm); cursor: pointer; }
  .rm-check:has(input:disabled) { color: var(--text-3); cursor: default; }
</style>
