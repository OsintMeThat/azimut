<script>
  /** One proof symbol, drawn for the interface — the toolbar picker and the
   *  layer list. The canvas draws the same paths through Konva; this is the
   *  DOM half so a button can show what it stamps. A stamp's carved details
   *  are holes here, as an interface icon's are. */
  import { ICON_BOX, iconByName } from '../lib/proofIcons.js';

  let { name, size = 20, color = 'currentColor' } = $props();

  const entry = $derived(iconByName(name));
</script>

{#if entry?.path}
  <svg
    width={size}
    height={size}
    viewBox="0 0 {ICON_BOX} {ICON_BOX}"
    aria-hidden="true"
    focusable="false"
  >
    <path d={entry.path} fill={color} fill-rule="evenodd" />
  </svg>
{/if}
