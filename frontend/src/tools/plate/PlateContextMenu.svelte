<script>
  /**
   * The plate's right-click menu: what can be done to what is under the pointer, an
   * element of the page or of the list, or the page itself (`components/ContextMenu`).
   * Every item is a shortcut to something the inspector, the list or a key already does.
   */
  import ContextMenu from '../../components/ContextMenu.svelte';

  let { menu = null, onclose = () => {} } = $props();
</script>

<ContextMenu {menu} {onclose} label="The plate" />
