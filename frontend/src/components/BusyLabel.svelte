<script>
  /**
   * What a press says while it waits on a server: a small spinner and its busy words (`text`, such as
   * Publishing…) in place of its own, which it holds as children. The press around it is disabled and
   * `aria-busy` while it waits, and is the same press again once the answer comes, a failure included.
   * Shown alone, `busy` always on, it is a line saying what is under way. The one spinner of the
   * website's presses and lines, so none draws its own.
   */
  let { busy = false, text = '', children = null } = $props();
</script>

{#if busy}<span class="busy-spin" aria-hidden="true"></span><span>{text}</span>{:else}{@render children?.()}{/if}

<style>
  /* the accent, except on a press filled with a colour of its own, where it takes the press's ink */
  .busy-spin { display: inline-block; flex: none; width: 11px; height: 11px; border-radius: 50%; vertical-align: -1px; color: var(--accent);
    border: 2px solid color-mix(in srgb, currentColor 25%, transparent); border-top-color: currentColor; animation: busy-spin 0.9s linear infinite; }
  :global(:is(.btn-primary, .btn-danger, .btn-ok, .btn-info)) > .busy-spin { color: inherit; }
  @keyframes busy-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .busy-spin { animation: none; } }
</style>
