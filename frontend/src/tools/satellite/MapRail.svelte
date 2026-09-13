<script>
  /**
   * The map's toolbox: one strip, built from the registry (`lib/map/tools.js`).
   *
   * It replaced three stacked cards — a tool cluster, a view cluster and the
   * engine's zoom buttons — which between them mixed what the pointer does with
   * what the map shows. Only verbs live here now; what is *drawn* over the
   * imagery is a layer and belongs in the panel on the right.
   *
   * The strip floats over the map rather than docking against the body's left
   * edge, and that is deliberate twice over. The app already has a rail at that
   * edge, and a second one flush beside it reads as one confused column. And
   * chrome that lives inside the map surface travels with the surface: a
   * detached window and (SPEC v3) a second compare surface get their own rail
   * with no work, which a body-level toolbar would not give them.
   *
   * Height is reported out through `clientHeight` because the engine's own zoom
   * buttons are stacked underneath it (`--map-controls-top`, see `engine.css`),
   * and a rail that grows by a tool must push them down rather than be drawn on
   * top of them.
   */
  import Icon from '../../components/Icon.svelte';

  let {
    /** `railSections(...)` — the entries, cut into the groups it rules between. */
    sections,
    /** Per entry: `{ on, disabled, title }`, built by the host from its stores. */
    state = {},
    /** An entry was pressed. Arming, and the exclusion, are the host's. */
    onpick,
    /** The strip's own height, for whatever is stacked beneath it. */
    height = $bindable(0),
  } = $props();
</script>

<div class="rail card" bind:clientHeight={height}>
  {#each sections as section, index (section.group)}
    {#if index > 0}<div class="rule" aria-hidden="true"></div>{/if}
    {#each section.entries as entry (entry.id)}
      {@const is = state[entry.id] ?? {}}
      <button
        class="seat"
        class:on={is.on}
        disabled={is.disabled}
        aria-pressed={entry.kind === 'mode' ? Boolean(is.on) : undefined}
        onclick={() => onpick(entry.id)}
        title={is.title ?? entry.hint ?? entry.label}
        aria-label={entry.label}
      >
        <Icon name={entry.icon} size={16} />
      </button>
    {/each}
  {/each}
</div>

<style>
  /* In flow inside the tool's own corner (`.map-tools`), not positioned: the
     panel slot beside it is placed at `left: 100%` of that corner, and an
     absolutely positioned rail would leave it measuring against nothing and
     slide the panel over the map. */
  .rail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px;
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
  }
  /* the whole of the rail's grammar: one line between two kinds of work */
  .rule {
    height: 1px;
    margin: 2px 3px;
    background: var(--border);
  }
  .seat {
    position: relative;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-1);
    color: var(--text-2);
    cursor: pointer;
  }
  .seat:hover:not(:disabled) {
    color: var(--text-1);
    background: var(--bg-3);
  }
  /* Armed reads as an edge, not as a filled button: the accent is the app's
     selection colour, and a rail of amber squares would spend it on chrome. */
  .seat.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .seat.on::before {
    content: '';
    position: absolute;
    top: 5px;
    bottom: 5px;
    left: -3px;
    width: 2px;
    background: var(--accent);
  }
  .seat:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
