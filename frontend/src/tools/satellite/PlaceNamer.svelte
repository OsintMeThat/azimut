<script>
  /**
   * The name a dropped pin asks for before it is saved as a place (`state/drop.svelte.js`).
   *
   * It sits beside the pin and follows it as the map moves. Enter saves, Escape lets
   * the pin go, and Save waits for a name: a place with none only reads as its
   * coordinates later. Notes, a folder and the relations are the place card's, once it
   * exists.
   */
  import { onMount, tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { PLACE_NAME_MAX } from './state/drop.svelte.js';

  let {
    /** The map façade, which places the field on the pin. */
    engine,
    /** `{ lat, lon, title }`, the pin waiting. */
    pin,
    saving = false,
    /** The coordinates as the app writes them, under the field. */
    coords = '',
    ontitle,
    onsave,
    oncancel,
  } = $props();

  let at = $state(null);
  let input = $state();

  function place() {
    at = engine?.latLngToContainerPoint?.({ lat: pin.lat, lon: pin.lon }) ?? null;
  }

  $effect(() => {
    void pin.lat;
    void pin.lon;
    place();
  });

  onMount(() => {
    tick().then(() => input?.focus());
    return engine?.on?.('view-move', place);
  });

  const named = $derived(pin.title.trim().length > 0);

  function onkeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (named) onsave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      oncancel();
    }
  }
</script>

{#if at}
  <div class="namer card" style:left="{at.x}px" style:top="{at.y}px" data-testid="place-namer">
    <div class="namer-row">
      <input
        bind:this={input}
        class="input"
        type="text"
        value={pin.title}
        maxlength={PLACE_NAME_MAX}
        placeholder="Name this place"
        aria-label="Name of the place"
        oninput={(event) => ontitle(event.currentTarget.value)}
        {onkeydown}
      />
      <button
        class="btn btn-primary namer-save"
        onclick={onsave}
        disabled={!named || saving}
        title={named ? 'Save this place' : 'Name it first'}
      >
        <Icon name="pin" size={13} /> {saving ? 'Saving…' : 'Save'}
      </button>
      <button class="btn btn-icon" onclick={oncancel} title="Let go of this pin" aria-label="Let go of this pin">
        <Icon name="x" size={13} />
      </button>
    </div>
    {#if coords}<span class="namer-coords mono">{coords}</span>{/if}
  </div>
{/if}

<style>
  /* Beside the pin's tip, to its right, so the pin stays in sight. */
  .namer {
    position: absolute;
    z-index: 30;
    transform: translate(18px, -50%);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.3));
    pointer-events: auto;
  }
  .namer-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .namer-row .input {
    width: 190px;
  }
  .namer-save {
    white-space: nowrap;
  }
  .namer-coords {
    padding: 0 2px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
