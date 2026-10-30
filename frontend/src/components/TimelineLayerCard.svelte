<script>
  /**
   * A marker of one of the analyst's map layers, read in the Timeline's
   * inspector. It is not an event of the case, so it reads as what it is and
   * opens on the map, where its day and the rest are edited.
   */
  import Icon from './Icon.svelte';
  import { gotoPoint } from '../lib/navigate.js';
  import { addedLayers } from '../lib/map/addedLayersState.svelte.js';
  import { momentLabel } from '../lib/map/layerHistory.js';

  /** A state of a tracked feature opens the map on that moment, so it is drawn as it stood. */
  function show() {
    if (item.layer.moment) addedLayers.setTime(item.layer.name, { at: item.layer.moment });
    gotoPoint(item.layer.at.lat, item.layer.at.lon);
  }

  let { item, onclose } = $props();
  const marks = $derived([item.layer.status === 'destroyed' ? 'Destroyed' : item.layer.status === 'damaged' ? 'Damaged' : '',
    item.layer.external ? 'Geolocated by someone else' : ''].filter(Boolean).join(' · '));
</script>

<header><span class="dot"></span><span>Layer marker</span>
  <button title="Close inspector" onclick={onclose}><Icon name="x" size={13} /></button></header>
<div class="body">
  <div class="kind">{item.layer.title}{item.layer.group ? ` · ${item.layer.group}` : ''}</div>
  <h2 dir="auto">{item.label}</h2>
  <div class="day"><Icon name="clock" size={15} /><strong>{item.layer.moment ? momentLabel(item.layer.moment) : item.raw}</strong></div>
  {#if marks}<p class="marks">{marks}</p>{/if}
  {#each item.layer.links as link (link)}<a href={link} target="_blank" rel="noreferrer noopener">{link}</a>{/each}
</div>
<footer>
  {#if item.layer.at}<button class="btn btn-primary" onclick={show}>Show on the map</button>{/if}
</footer>

<style>
  header { display: flex; align-items: center; gap: 7px; min-height: 45px; padding: 0 13px; border-bottom: 1px solid var(--border); color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  header button { display: grid; margin-left: auto; padding: 4px; border: 0; background: none; color: var(--text-3); cursor: pointer; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .body { min-height: 0; overflow: auto; padding: 16px; }
  .kind { color: var(--accent); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  h2 { margin: 4px 0 16px; font-size: 17px; line-height: 1.3; }
  .day { display: flex; align-items: center; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); font-size: var(--fs-xs); }
  .day :global(svg) { color: var(--accent); }
  .marks { margin: 10px 0 0; color: var(--text-2); font-size: var(--fs-xs); }
  a { display: block; margin-top: 6px; font-size: var(--fs-xs); overflow-wrap: anywhere; text-decoration: underline; }
  footer { display: flex; justify-content: flex-end; gap: 5px; padding: 12px; border-top: 1px solid var(--border); }
</style>
