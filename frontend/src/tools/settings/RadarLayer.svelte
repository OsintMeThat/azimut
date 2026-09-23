<script>
  /**
   * The Sentinel-1 layer, inside the Copernicus card.
   *
   * Radar comes through the same account and the same configuration, but only
   * once a layer reading Sentinel-1 is added to it: Copernicus serves no radar
   * otherwise. Nothing in the configuration says which layer reads what, so
   * Find asks each new layer once with a tiny render only a radar layer can
   * answer, and keeps the first that does. It never runs on its own.
   */
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';
  import RadarForm from '../../components/RadarForm.svelte';
  import { RADAR_STEPS } from '../../lib/copernicusSetup.js';

  let { layer = $bindable(''), onchanged = () => {} } = $props();

  let busy = $state(false);
  let answer = $state(null);
  let typed = $state('');

  async function find(named = '') {
    if (busy) return;
    busy = true;
    answer = null;
    try {
      answer = await api.post('/api/satellite/sentinel1/layer', named ? { layer: named } : {});
      if (answer.ok) {
        layer = answer.layer;
        typed = '';
        toast(`Radar reads ${answer.layer}`, 'ok');
        onchanged();
      }
    } catch (error) {
      answer = { ok: false, detail: error.message };
    } finally {
      busy = false;
    }
  }

  async function forget() {
    await api.put('/api/settings/prefs', { sentinel1_layer: '' });
    layer = '';
    answer = null;
    onchanged();
  }
</script>

<div class="radar">
  <p class="head"><strong>Sentinel-1 radar</strong> <span>sees through cloud and at night</span></p>
  {#if layer}
    <p class="set"><Icon name="check" size={12} /> Radar reads <code>{layer}</code>.
      <button class="linkish" onclick={forget}>Forget it</button></p>
  {:else}
    <ol class="key-steps">
      {#each RADAR_STEPS as step (step)}<li>{step}</li>{/each}
    </ol>
    <RadarForm />
    <div class="line">
      <button class="btn btn-sm" disabled={busy} onclick={() => find()}>{busy ? 'Looking…' : 'Find the radar layer'}</button>
      <input class="input mono" placeholder="or its name, e.g. RADAR" bind:value={typed} spellcheck="false"
        aria-label="Sentinel-1 layer name" onkeydown={(event) => event.key === 'Enter' && typed.trim() && find(typed.trim())} />
      <button class="btn btn-sm" disabled={busy || !typed.trim()} onclick={() => find(typed.trim())}>Check</button>
    </div>
  {/if}
  {#if answer && !answer.ok}
    <p class="verdict bad"><Icon name="alert" size={12} /> {answer.detail}</p>
  {/if}
</div>

<style>
  .radar {
    display: grid;
    gap: 6px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .head {
    margin: 0;
    font-size: var(--fs-xs);
  }
  .head span {
    color: var(--text-3);
  }
  .set {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--ok, #46a758);
    font-size: var(--fs-xs);
  }
  .line {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .line .input {
    flex: 1;
    min-width: 0;
  }
  .key-steps {
    margin: 0;
    padding-left: 18px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .verdict.bad {
    display: flex;
    gap: 6px;
    margin: 0;
    color: var(--danger, #e5484d);
    font-size: var(--fs-xs);
  }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font-size: var(--fs-xs);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
