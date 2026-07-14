<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/state.svelte.js';
  import { monthCount, tilesOfFree, freeTierShare } from '../lib/usage.js';
  import Icon from '../components/Icon.svelte';

  // The keyed imagery providers the app knows how to light up (KEYED_PROVIDERS.md).
  // Keys are app-wide, stored locally in settings.json, never written into a
  // case folder or export bundle — they're the user's own billing identity.
  const KEYED = [
    {
      id: 'mapbox',
      label: 'Mapbox',
      field: 'Mapbox public access token',
      placeholder: 'pk.…',
      help: 'https://account.mapbox.com/access-tokens/',
      unlocks: 'Mapbox Satellite basemap',
      overage:
        'Beyond the free tier, Mapbox bills extra tiles automatically (pay-as-you-go, per 1,000). Set a spending alert in your Mapbox account.',
    },
    {
      id: 'google',
      label: 'Google',
      field: 'Google Maps Platform API key',
      placeholder: 'AIza…',
      help: 'https://developers.google.com/maps/documentation/tile/get-api-key',
      unlocks: 'Google Satellite basemap (Map Tiles API)',
      overage:
        'Beyond the free tier, Google bills extra tiles to your Cloud project (per 1,000). A quota cap in the Cloud Console makes it stop serving instead of billing.',
    },
  ];

  let keys = $state({ mapbox: '', google: '' });
  let shown = $state({ mapbox: false, google: false });
  let usage = $state({});
  let month = $state('');
  let saving = $state(false);
  let testing = $state({ mapbox: false, google: false });
  let testResult = $state({ mapbox: null, google: null }); // { ok, detail } | null

  async function load() {
    const s = await api.get('/api/settings');
    keys = { mapbox: s.api_keys.mapbox ?? '', google: s.api_keys.google ?? '' };
    usage = s.usage;
    month = s.month;
  }

  onMount(() => {
    load().catch((e) => toast(`Could not load settings: ${e.message}`, 'danger'));
  });

  async function saveKeys() {
    if (saving) return;
    saving = true;
    try {
      await api.put('/api/settings/keys', { mapbox: keys.mapbox, google: keys.google });
      testResult = { mapbox: null, google: null }; // stale verdicts for new keys
      toast('Keys saved — keyed basemaps now appear in the Satellite tab', 'ok');
    } catch (e) {
      toast(`Could not save keys: ${e.message}`, 'danger');
    } finally {
      saving = false;
    }
  }

  // exercise the *saved* key against the real service (Mapbox: one tile;
  // Google: createSession) so a typo shows up here, not mid-investigation
  async function testKey(id) {
    if (testing[id]) return;
    testing[id] = true;
    testResult[id] = null;
    try {
      await api.put('/api/settings/keys', { [id]: keys[id] }); // test what's in the field
      testResult[id] = await api.post(`/api/settings/keys/${id}/test`);
    } catch (e) {
      testResult[id] = { ok: false, detail: e.message };
    } finally {
      testing[id] = false;
    }
  }
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Settings</h2>
    <span class="sub">API keys & usage — stored locally, never in a case export</span>
  </div>

  <div class="body">
    <section class="card block">
      <h3><Icon name="key" size={15} /> Imagery API keys</h3>
      <p class="hint">
        Optional. Azimut's built-in basemaps (Esri, OSM) never need a key — your own
        Mapbox / Google keys just unlock extra official basemaps in the Satellite tab.
        Keys stay in <span class="mono">settings.json</span> on this machine.
      </p>

      {#each KEYED as k (k.id)}
        <div class="key-row">
          <label for="key-{k.id}">
            {k.field}
            <a href={k.help} target="_blank" rel="noreferrer" title="How to get one">
              how to get one <Icon name="external" size={11} />
            </a>
          </label>
          <div class="key-line">
            <input
              id="key-{k.id}"
              class="input"
              type={shown[k.id] ? 'text' : 'password'}
              placeholder={k.placeholder}
              bind:value={keys[k.id]}
              autocomplete="off"
              spellcheck="false"
            />
            <button
              class="btn btn-ghost btn-sm"
              onclick={() => (shown[k.id] = !shown[k.id])}
              title={shown[k.id] ? 'Hide key' : 'Show key'}
              aria-label={shown[k.id] ? 'Hide key' : 'Show key'}
            >
              <Icon name={shown[k.id] ? 'eyeOff' : 'eye'} size={14} />
            </button>
            <button
              class="btn btn-sm"
              onclick={() => testKey(k.id)}
              disabled={testing[k.id] || !keys[k.id].trim()}
              title="Save this key, then exercise it against the real service"
            >
              {testing[k.id] ? 'Testing…' : 'Test'}
            </button>
          </div>
          <div class="key-foot">
            <span class="unlocks">Unlocks: {k.unlocks}</span>
            {#if testResult[k.id]}
              <span class="verdict" class:ok={testResult[k.id].ok} class:bad={!testResult[k.id].ok}>
                <Icon name={testResult[k.id].ok ? 'check' : 'alert'} size={12} />
                {testResult[k.id].ok ? 'Key works' : testResult[k.id].detail}
              </span>
            {/if}
          </div>
        </div>
      {/each}

      <div class="actions">
        <button class="btn btn-primary" onclick={saveKeys} disabled={saving}>
          {saving ? 'Saving…' : 'Save keys'}
        </button>
      </div>
    </section>

    <section class="card block">
      <h3><Icon name="chart" size={15} /> Tile usage — {month}</h3>
      <p class="hint">
        Keyed providers bill per tile served. Azimut counts exactly what goes out to
        each provider (live map + captures, browser cache hits excluded), so this
        matches their billing as closely as possible. Local bookkeeping only — the
        counter never leaves this machine.
      </p>
      {#if KEYED.some((k) => keys[k.id] || monthCount(usage, k.id, month))}
        <div class="usage">
          {#each KEYED as k (k.id)}
            {#if keys[k.id] || monthCount(usage, k.id, month)}
              {@const count = monthCount(usage, k.id, month)}
              {@const share = freeTierShare(count, k.id)}
              <div class="usage-row">
                <div class="usage-line">
                  <span class="usage-name">{k.label}</span>
                  <span class="mono">{tilesOfFree(count, k.id)}</span>
                </div>
                <div class="meter-track" aria-hidden="true">
                  <div
                    class="meter-fill"
                    class:hot={share >= 0.9}
                    style="width:{Math.min(share * 100, 100)}%"
                  ></div>
                </div>
                <p class="overage">{k.overage}</p>
              </div>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="none">No keyed provider configured yet.</p>
      {/if}
      <button class="btn btn-ghost btn-sm" onclick={() => load()} title="Refresh counters">
        <Icon name="reset" size={13} /> Refresh
      </button>
    </section>

    <section class="card block">
      <h3><Icon name="shield" size={15} /> Provider terms, encoded</h3>
      <ul class="rules">
        <li>Google tiles are never cached to disk, and a Google capture is a flattened screenshot with the copyright line burned into its footer — both are conditions of Google's Map Tiles API terms.</li>
        <li>Mapbox captures keep the © Mapbox © OpenStreetMap attribution in their provenance.</li>
        <li>Keys are never bundled into a shared case or export.</li>
      </ul>
    </section>
  </div>
</div>

<style>
  .tool {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tool-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 14px 18px 10px;
  }
  .tool-header h2 {
    font-size: var(--fs-lg);
  }
  .sub {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 6px 18px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 720px;
  }
  .block {
    padding: 16px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-md);
    margin-bottom: 6px;
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-sm);
    margin-bottom: 14px;
    line-height: 1.5;
  }
  .key-row {
    margin-bottom: 14px;
  }
  .key-row label {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-weight: 600;
    margin-bottom: 5px;
  }
  .key-row label a {
    color: var(--accent);
    font-weight: 400;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .key-line {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .key-line .input {
    flex: 1;
    font-family: var(--font-mono);
  }
  .key-foot {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 4px;
    font-size: var(--fs-xs);
  }
  .unlocks {
    color: var(--text-3);
  }
  .verdict {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .verdict.ok {
    color: var(--ok);
  }
  .verdict.bad {
    color: var(--danger);
  }
  .actions {
    margin-top: 4px;
  }
  .usage {
    margin: 0 0 10px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: var(--fs-sm);
  }
  .usage-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 5px;
  }
  .usage-name {
    font-weight: 600;
    color: var(--text-2);
  }
  .meter-track {
    height: 5px;
    border-radius: 999px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .meter-fill {
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
    transition: width 0.3s var(--ease);
  }
  .meter-fill.hot {
    background: var(--danger);
  }
  .overage {
    margin-top: 5px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.4;
  }
  .none {
    color: var(--text-3);
    font-size: var(--fs-sm);
    margin-bottom: 10px;
  }
  .rules {
    margin: 0;
    padding-left: 18px;
    color: var(--text-2);
    font-size: var(--fs-sm);
    display: flex;
    flex-direction: column;
    gap: 6px;
    line-height: 1.45;
  }
</style>
