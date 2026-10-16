<script>
  /**
   * The way out of an open document, back to where documents of its kind are listed:
   * first in a tool's header, a chevron and the name of that place ("Plates",
   * "Files"), found where a way back is looked for rather than as a bare icon at the
   * far end. A view that closes onto the same screen says Close under a cross. The
   * tool writes what is pending before it leaves.
   */
  import Icon from './Icon.svelte';

  let { label, title = '', icon = 'chevronLeft', onclick } = $props();
</script>

<button type="button" class="btn btn-sm back" class:closes={icon === 'x'} {title} {onclick}>
  <Icon name={icon} size={icon === 'x' ? 13 : 15} /><span>{label}</span>
</button>

<style>
  .back { flex: none; gap: 3px; padding-left: 6px; font-weight: 600; }
  .back.closes { gap: 5px; padding-left: 8px; }
</style>
