<script>
  // A stand-in for EntryLine in the NoteBar tests: records what it was seated with.
  let { entity = null, also = [] } = $props();
  $effect(() => {
    globalThis.__noteBarLine?.push({ entity, also });
  });
  export function focus() {}
</script>

<div class="entry-line-stub"></div>
