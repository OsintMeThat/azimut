<script>
  /**
   * What is drawn over the imagery, listed in one place.
   *
   * Before, a layer was wherever it had been added: OSM labels and the case's
   * saved pins were buttons in the toolbox, a sheet's points and a Timeline
   * window were cards floating over the map with their own close buttons, and
   * nothing said they were the same kind of thing. They are: each is something
   * laid over the picture, on or off, and none of them changes what the pointer
   * does.
   *
   * A handoff layer — points another tool sent here — appears in the list when
   * it arrives and leaves when it is closed, so the panel never shows a switch
   * for something that is not there.
   */
  import Icon from '../../components/Icon.svelte';
  import LayerRows from '../../components/LayerRows.svelte';

  let {
    /**
     * `{ id, label, on, disabled, title, detail, toggle }`, plus three that
     * only some layers carry: `actions` (buttons under the row), `controls`
     * (its own settings, for a layer that is a question) and `note` (why it is
     * on but drawing nothing yet).
     */
    rows,
    open = $bindable(true),
  } = $props();

  const live = $derived(rows.filter((row) => row.on && !row.disabled).length);
</script>

<button type="button" class="sub-head" onclick={() => (open = !open)}>
  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
  <Icon name="stack" size={13} />
  <span>Layers</span>
  <span class="count">{live}</span>
</button>

{#if open}
  <LayerRows {rows} />
{/if}
