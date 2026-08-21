<script>
  /** One proof symbol, drawn for the interface — the toolbar picker and the
   *  layer list. The canvas draws the same paths through Konva; this is the
   *  DOM half so a button can show what it stamps. */
  import { ICON_BOX, iconByName, isSolidIcon } from '../lib/proofIcons.js';

  let { name, size = 20, color = 'currentColor' } = $props();

  const entry = $derived(iconByName(name));
  const solid = $derived(isSolidIcon(name));
</script>

{#if entry}
  <svg
    width={size}
    height={size}
    viewBox="0 0 {ICON_BOX} {ICON_BOX}"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d={entry.path}
      fill={solid ? color : 'none'}
      fill-rule={solid ? 'evenodd' : null}
      stroke={solid ? 'none' : color}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/if}
