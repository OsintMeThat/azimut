<script>
  import { COPERNICUS_CONFIGURATIONS, DISPLAY_FORM, DISPLAY_STEPS } from '../lib/copernicusSetup.js';
  import { openCopernicusSettings } from '../lib/navigate.js';
</script>

<details class="layer-help">
  <summary>Set up Copernicus layers</summary>
  <p>The free Copernicus configuration controls which display layers are available.</p>
  <ol>{#each DISPLAY_STEPS as step (step)}<li>{step}</li>{/each}</ol>
  <dl>{#each DISPLAY_FORM as [field, value] (field)}<dt>{field}</dt><dd>{value}</dd>{/each}</dl>
  <p>Optical rules read Sentinel-2 L2A bands through TRUE_COLOR; each index needs no separate display layer.</p>
  <div class="actions">
    <a href={COPERNICUS_CONFIGURATIONS} target="_blank" rel="noreferrer">Configuration Utility</a>
    <button class="btn btn-sm" onclick={openCopernicusSettings}>Settings → Imagery</button>
  </div>
</details>

<style>
  .layer-help { font-size: var(--fs-xs); line-height: 1.5; color: var(--text-2); }
  summary { cursor: pointer; color: var(--text-1); }
  p { margin: 8px 0; }
  ol { margin: 8px 0; padding-left: 20px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 8px 0; }
  dt { color: var(--text-1); }
  dd { margin: 0; }
  .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
</style>
