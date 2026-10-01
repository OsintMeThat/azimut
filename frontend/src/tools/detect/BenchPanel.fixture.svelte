<script>
  /** Detect's column with its bench handed to the test (`benchHolder.fixture.svelte.js`). */
  import DetectPanel from './DetectPanel.svelte';
  import { holder } from './benchHolder.fixture.svelte.js';

  let props = $props();
  let builder = $state(null);
  $effect(() => { holder.bench = builder; });
</script>

<DetectPanel {...props} bind:builder />
