<script>
  /**
   * One line to type in a terminal, with a button that copies it, so a step never
   * asks anyone to retype a path or a command.
   */
  import Icon from './Icon.svelte';
  import { copyText } from '../lib/clipboard.js';

  let { command } = $props();
</script>

<span class="command">
  <code>{command}</code>
  <button class="copy" title="Copy" aria-label="Copy {command}" onclick={() => copyText(command)}>
    <Icon name="copy" size={13} />
  </button>
</span>

<style>
  .command {
    display: flex;
    align-items: center;
    min-width: 0;
    background: var(--bg-0);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-1);
    overflow-wrap: anywhere;
    /* one click takes the whole line, for anyone who would rather select it */
    user-select: all;
  }
  .copy {
    display: flex;
    align-self: stretch;
    align-items: center;
    padding: 0 9px;
    color: var(--text-3);
    border-left: 1px solid var(--border);
  }
  .copy:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
</style>
