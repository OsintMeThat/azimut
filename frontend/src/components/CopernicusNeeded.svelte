<script>
  /**
   * What a tool needs from Copernicus before it can work, in the middle of it.
   *
   * Detect reads nothing else, and Compare's satellite and radar passes neither,
   * so a missing account is not a detail for a corner: it is said where the
   * work would be, with the recipe and the way to Settings. Two layers come out
   * of the recipe. The Sentinel-2 one arrives with the template the key is made
   * from; the Sentinel-1 one is added by hand to the same configuration, only
   * for the radar analyzers and the radar basemap.
   */
  import Icon from './Icon.svelte';
  import RadarForm from './RadarForm.svelte';
  import {
    ACCOUNT_STEPS,
    COPERNICUS_CONFIGURATIONS,
    COPERNICUS_SIGNUP,
    RADAR_STEPS,
  } from '../lib/copernicusSetup.js';
  import { openCopernicusSettings } from '../lib/navigate.js';

  let {
    /** 'account': no Copernicus key yet · 'radar': the key, but no Sentinel-1 layer. */
    need = 'account',
    /** Who is asking, e.g. "Detect" or "Two satellite passes". */
    tool = 'This tool',
    /** Shown when the notice can be put away, as Compare's can. */
    onclose = null,
  } = $props();
</script>

<section class="copernicus card" aria-label="Copernicus setup">
  <header>
    <Icon name="satellite" size={18} />
    <h3>{need === 'account'
      ? `${tool} needs a Copernicus key`
      : `${tool} needs the Sentinel-1 layer`}</h3>
    {#if onclose}
      <button class="cmp-icon" onclick={onclose} aria-label="Close" title="Close"><Icon name="x" size={13} /></button>
    {/if}
  </header>
  <p class="lead">
    {need === 'account'
      ? 'Copernicus is the EU’s satellite archive. The account is free and takes a few minutes to set up.'
      : 'The key is set. Radar needs one more layer in the same Copernicus configuration.'}
  </p>

  {#if need === 'account'}
    <h4><span class="n">1</span> Sentinel-2, the key</h4>
    <ol>
      {#each ACCOUNT_STEPS as step (step)}<li>{step}</li>{/each}
    </ol>
    <p class="note">The template brings the Sentinel-2 layers with it: there is nothing more to add for them.</p>
    <details>
      <summary><span class="n">2</span> Sentinel-1 radar, only for the radar analyzers</summary>
      <ol>
        {#each RADAR_STEPS as step (step)}<li>{step}</li>{/each}
      </ol>
      <RadarForm />
    </details>
  {:else}
    <ol>
      {#each RADAR_STEPS as step (step)}<li>{step}</li>{/each}
    </ol>
    <RadarForm />
  {/if}

  <div class="actions">
    <button class="btn btn-primary btn-sm" onclick={openCopernicusSettings}>Open Settings → Imagery</button>
    <a class="btn btn-sm" href={need === 'account' ? COPERNICUS_SIGNUP : COPERNICUS_CONFIGURATIONS}
      target="_blank" rel="noreferrer">
      {need === 'account' ? 'Register on Copernicus' : 'Open the Configuration Utility'} <Icon name="external" size={11} />
    </a>
  </div>
</section>

<style>
  .copernicus {
    display: grid;
    gap: 8px;
    width: min(560px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    overflow-y: auto;
    padding: 16px 18px;
    background: var(--bg-1);
    box-shadow: var(--shadow-2);
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-1);
  }
  h3 {
    flex: 1;
    margin: 0;
    font-size: var(--fs-md, 14px);
  }
  h4,
  summary {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 0;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  summary {
    cursor: pointer;
  }
  .n {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10.5px;
  }
  .lead,
  .note {
    margin: 0;
    line-height: 1.5;
  }
  .note {
    color: var(--text-3);
  }
  ol {
    margin: 0;
    padding-left: 20px;
    line-height: 1.55;
  }
  details {
    display: grid;
    gap: 6px;
  }
  details[open] > :global(*:not(summary)) {
    margin-top: 6px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }
  .actions a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    text-decoration: none;
  }
</style>
