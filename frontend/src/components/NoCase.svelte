<script>
  /**
   * What a tool shows with no case open: what it would do with one, and a way in
   * that needs none. The scratch session is the README's "no setup" road, the same
   * one Media and the map take on their own; it can be kept as a case later.
   */
  import Icon from './Icon.svelte';
  import { ensureCase, toast } from '../lib/state.svelte.js';

  let { icon = 'folder', what } = $props();
  let starting = $state(false);

  async function start() {
    starting = true;
    try {
      await ensureCase();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      starting = false;
    }
  }
</script>

<div class="no-case">
  <Icon name={icon} size={36} />
  <p>Open a case to {what}.</p>
  <button class="btn btn-sm" disabled={starting} onclick={start}>
    <Icon name="plus" size={14} /> {starting ? 'Starting…' : 'Start a scratch session'}
  </button>
</div>

<style>
  .no-case {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    min-height: 220px;
    padding: 24px;
    color: var(--text-3);
    text-align: center;
  }
  p {
    margin: 0;
    color: var(--text-2);
  }
</style>
