<script>
  /**
   * The segmented control that says how a screen renders its answer.
   *
   * Files and the Media Library have drawn this by hand for a while — *Small · Large
   * · List*, the same markup and the same rules copied twice. This is that control,
   * defined once, so the third screen to want one adds no third copy. Those two are a
   * drop-in migration whenever it is wanted: the classes, the sizes and the
   * `aria-pressed` behaviour are theirs, unchanged.
   *
   * **An option may be offered and unavailable**, which is the reason this is a
   * component rather than three buttons. The app's rule is that a control you can see
   * and cannot use teaches something, where one that is not there teaches nothing —
   * so a disabled option keeps its place and states its reason in the tooltip instead
   * of disappearing. The state currently *on* is never disabled by a caller, or the
   * screen would show itself as unavailable.
   */
  import Icon from './Icon.svelte';

  /**
   * @type {{
   *   options: Array<{id: string, label: string, icon: string, hint?: string, disabled?: boolean}>,
   *   value: string,
   *   label?: string,
   *   onpick: (id: string) => void,
   * }}
   */
  let { options = [], value, label = 'View', onpick } = $props();
</script>

<div class="view-switch" role="group" aria-label={label}>
  {#each options as option (option.id)}
    <button
      class="view-btn"
      class:active={value === option.id}
      title={option.hint ?? `${option.label} view`}
      aria-pressed={value === option.id}
      disabled={Boolean(option.disabled) && value !== option.id}
      onclick={() => onpick?.(option.id)}
    >
      <Icon name={option.icon} size={14} /> {option.label}
    </button>
  {/each}
</div>

<style>
  .view-switch {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    flex-shrink: 0;
  }
  .view-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .view-btn:hover {
    color: var(--text-1);
  }
  .view-btn.active {
    background: var(--bg-3);
    color: var(--text-1);
  }
  /* Offered and unavailable: dimmed where a hidden control would have taught
     nothing, and it keeps the pointer rather than inviting a click that does
     nothing. The reason is in the tooltip, which is where the caller puts it. */
  .view-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .view-btn:disabled:hover {
    color: var(--text-3);
  }
</style>
