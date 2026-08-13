<script>
  /**
   * Imagery provider keys, and what each one has cost this month.
   *
   * One card per keyed provider (IMAGERY_PROVIDERS.md): collapsed it shows what
   * the provider gives and what it costs, open it holds the setup steps, the key
   * field, a live test and the two allowances the analyst can correct. Keys are
   * app-wide, stored in settings.json, and never travel into a case or an export.
   *
   * The meter is the point of the card. A basemap that bills per tile is one an
   * investigation can run into silently, so the free-tier share is on screen
   * before it matters, and past `BLOCK_SHARE` the app falls back to free imagery
   * unless the analyst says otherwise.
   */
  import Icon from '../../components/Icon.svelte';
  import {
    monthCount,
    tilesOfFree,
    freeTierShare,
    usageBlocked,
    providerStatus,
    BLOCK_SHARE,
    FREE_TIER,
  } from '../../lib/usage.js';

  let {
    KEYED,
    keys,
    usage,
    month,
    tiers,
    tierEdits,
    enabled,
    overrides,
    testResult,
    testing,
    ecoZooms,
    load,
    saveKey,
    testKey,
    saveProviderPrefs,
    saveEcoZoom,
    saveFreeTier,
    eco = $bindable(),
    ecoMaxZoom = $bindable(),
  } = $props();

  const perProvider = (value) => Object.fromEntries(KEYED.map((k) => [k.id, value(k)]));

  // Card state is this tab's own: which card is open, whose key is legible.
  // Start closed so setup details appear only for the provider being set up.
  let open = $state(perProvider(() => false));
  let shown = $state(perProvider(() => false));
  let termsOpen = $state(false);
</script>

<section class="group">
  <h3>Providers</h3>
  <p class="intro">
    Add provider keys to unlock more Satellite basemaps; usage appears on each card.
  </p>

  <div class="cards">
    {#each KEYED as k (k.id)}
      {@const count = monthCount(usage, k.id, month)}
      {@const share = freeTierShare(count, k.id, tiers)}
      {@const st = providerStatus({
        key: keys[k.id],
        enabled: enabled[k.id],
        status: testResult[k.id],
        count,
        meter: k.id,
        overrides,
        tiers,
      })}
      <div class="card" class:open={open[k.id]}>
        <div class="card-head">
          <button
            class="card-toggle"
            onclick={() => (open[k.id] = !open[k.id])}
            aria-expanded={open[k.id]}
          >
            <Icon name={open[k.id] ? 'chevronDown' : 'chevronRight'} size={13} />
            <span class="card-name">{k.label}</span>
            <span class="card-gives">{k.gives}</span>
          </button>
          <span
            class="chip {st.tone}"
            title={st.tone === 'bad' ? testResult[k.id]?.detail : undefined}
          >{st.label}</span>
          {#if keys[k.id]}
            <input
              class="card-enable"
              type="checkbox"
              bind:checked={enabled[k.id]}
              onchange={saveProviderPrefs}
              title="Show or hide this basemap in the Satellite tab"
              aria-label="Show {k.label} in the Satellite tab"
            />
          {/if}
        </div>

        <!-- one line either way: what it would cost, or what it has cost -->
        {#if keys[k.id] || count}
          <div class="card-meter">
            <div class="meter-track" aria-hidden="true">
              <div
                class="meter-fill"
                class:hot={share >= BLOCK_SHARE}
                style="width:{Math.min(share * 100, 100)}%"
              ></div>
            </div>
            <span class="mono meter-read">{tilesOfFree(count, k.id, tiers)}</span>
          </div>
        {:else if !open[k.id]}
          <!-- open, the body's overage already leads with the cost -->
          <p class="card-cost">{k.cost}</p>
        {/if}

        {#if open[k.id]}
          <div class="card-body">
            {#if k.warning}
              <p class="key-warning"><Icon name="alert" size={12} /> {k.warning}</p>
            {/if}
            {#if k.steps}
              <ol class="key-steps">
                {#each k.steps as step (step)}
                  <li>{step}</li>
                {/each}
              </ol>
            {/if}

            <label class="key-label" for="key-{k.id}">
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
                onchange={() => saveKey(k.id)}
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
                title="Exercise this key against the real service"
              >
                {testing[k.id] ? 'Testing…' : 'Test'}
              </button>
            </div>
            {#if testResult[k.id] && !testResult[k.id].ok}
              <p class="verdict bad">
                <Icon name="alert" size={12} />
                {testResult[k.id].detail}
              </p>
            {/if}

            <p class="overage">{k.cost}. {k.overage}</p>

            {#if keys[k.id] || count}
              {#if usageBlocked(count, k.id, overrides, tiers)}
                <p class="blocked">
                  <Icon name="alert" size={12} />
                  Paused at {Math.round(BLOCK_SHARE * 100)}% of the free tier. The map and
                  captures fall back to free imagery until next month, or:
                </p>
              {/if}
              {#if share >= BLOCK_SHARE || overrides[k.id]}
                <label
                  class="toggle override"
                  title="Serve past the pause (extra tiles are billed)"
                >
                  <input
                    type="checkbox"
                    bind:checked={overrides[k.id]}
                    onchange={saveProviderPrefs}
                  />
                  keep serving past {Math.round(BLOCK_SHARE * 100)}% (billed)
                </label>
              {/if}

              <div class="card-controls">
                <label
                  class="ctrl"
                  title={k.tierNote ??
                    "This account's monthly free allowance. Check the provider dashboard"}
                >
                  <span>Free allowance</span>
                  <input
                    class="input num mono"
                    type="number"
                    min="1"
                    step="1000"
                    placeholder={String(FREE_TIER[k.id] ?? '')}
                    bind:value={tierEdits[k.id]}
                    onchange={saveFreeTier}
                  />
                  <span class="ctrl-note">
                    {tierEdits[k.id].trim() === ''
                      ? 'blank = the documented default'
                      : `default is ${(FREE_TIER[k.id] ?? 0).toLocaleString('en-US')}`}
                  </span>
                </label>

                {#if k.browserTest}
                  <p class="ctrl-note">
                    Eco mode is unavailable because reopening this widget starts another billed map load.
                  </p>
                {:else}
                  <label
                    class="ctrl"
                    title="Blank uses global; 0 disables eco mode"
                  >
                    <span>Eco below z ≤</span>
                    <input
                      class="input num mono"
                      type="number"
                      min="0"
                      max="21"
                      placeholder={k.id === 'sentinelhub' ? '11' : String(ecoMaxZoom)}
                      bind:value={ecoZooms[k.id]}
                      onchange={saveEcoZoom}
                      disabled={!eco}
                      aria-label="Eco threshold for {k.label}"
                    />
                    <span class="ctrl-note">
                      {k.id === 'sentinelhub'
                        ? 'blank = 11 (it caps at z14)'
                        : 'blank = the global threshold'}
                    </span>
                  </label>
                {/if}
              </div>

              <a class="card-link" href={k.usage} target="_blank" rel="noreferrer">
                {k.label} usage & limits <Icon name="external" size={11} />
              </a>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="cards-foot">
    <span class="row-hint">Counters for {month}. Stored locally.</span>
    <button class="btn btn-ghost btn-sm" onclick={() => load()} title="Refresh counters">
      <Icon name="reset" size={13} /> Refresh
    </button>
  </div>
</section>

<section class="group">
  <h3>Eco mode</h3>
  <label
    class="toggle eco"
    title="Zoomed out this far, billed basemaps swap to free imagery"
  >
    <input type="checkbox" bind:checked={eco} onchange={saveEcoZoom} />
    Use free imagery when zoomed out, up to z ≤
    <input
      class="input num mono"
      type="number"
      min="1"
      max="21"
      bind:value={ecoMaxZoom}
      onchange={saveEcoZoom}
      disabled={!eco}
      aria-label="Eco mode zoom threshold"
    />
  </label>
  <p class="note">
    Applies while zoomed out; provider cards can override it.
  </p>
</section>

<section class="group">
  <div class="card">
    <div class="card-head">
      <button
        class="card-toggle"
        onclick={() => (termsOpen = !termsOpen)}
        aria-expanded={termsOpen}
      >
        <Icon name={termsOpen ? 'chevronDown' : 'chevronRight'} size={13} />
        <span class="card-name">Provider terms</span>
        <span class="card-gives">Applied automatically</span>
      </button>
    </div>
    {#if termsOpen}
      <ul class="rules">
        <li>Google tiles are not cached; captures are screenshots with attribution.</li>
        <li>Mapbox attribution remains attached to captures.</li>
        <li>Provider keys stay outside cases and exports.</li>
      </ul>
    {/if}
  </div>
</section>

<style>
  /* Recipe for a provider whose "key" is a configuration you build yourself */
  .key-steps {
    margin: 4px 0 8px;
    padding-left: 18px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .key-steps li {
    margin: 1px 0;
  }

  .key-warning {
    display: flex;
    align-items: baseline;
    gap: 5px;
    margin: 4px 0 8px;
    color: var(--warn, #d8a03d);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }


  /* Provider cards show a summary until opened for setup. */
  .cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .card {
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 8px 10px;
    background: var(--bg-2);
    transition: border-color 0.12s var(--ease);
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .card-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-3);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .card-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    flex-shrink: 0;
  }

  .card-gives {
    font-size: var(--fs-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-enable {
    accent-color: var(--accent);
    margin: 0;
    flex-shrink: 0;
    cursor: pointer;
  }

  /* One-word verdict; the tooltip carries the detail. */
  .chip {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--text-3);
    white-space: nowrap;
  }

  .chip.ok {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  }

  .chip.bad {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }

  .card-meter {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 7px 0 1px;
  }

  .card-meter .meter-track {
    flex: 1;
  }

  .meter-read,
  .card-cost {
    font-size: var(--fs-xs);
    color: var(--text-3);
    white-space: nowrap;
  }

  .card-cost {
    margin: 5px 0 1px 21px; /* aligned under the name, past the chevron */
  }

  .card-body {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .card-controls {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 9px;
  }

  .ctrl {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }

  /* Align provider control fields in one column. */
  .ctrl > span:first-child {
    min-width: 104px;
    color: var(--text-2);
  }

  .ctrl-note {
    opacity: 0.8;
  }

  .card-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    color: var(--accent);
    font-size: var(--fs-xs);
  }

  .cards-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
  }

  .key-label {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-weight: 600;
    margin-bottom: 5px;
  }

  .key-label a {
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

  .verdict {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 5px;
    font-size: var(--fs-xs);
    line-height: 1.4;
  }

  .verdict.bad {
    color: var(--danger);
  }

  .meter-track {
    height: 5px;
    border-radius: var(--r-sm);
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
    margin-top: 9px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    cursor: pointer;
    user-select: none;
  }

  .toggle input {
    accent-color: var(--accent);
    margin: 0;
  }

  .toggle.override {
    margin-top: 6px;
    color: var(--danger);
  }

  .toggle.eco {
    display: flex;
    margin: 2px 0;
  }

  /* every small numeric box in this tab: eco thresholds, free allowances */
  .num {
    width: 92px;
    padding: 2px 6px;
    flex-shrink: 0;
  }

  .blocked {
    margin-top: 6px;
    color: var(--danger);
    font-size: var(--fs-xs);
    display: flex;
    align-items: center;
    gap: 5px;
    line-height: 1.4;
  }

  .rules {
    margin: 12px 0 2px;
    padding-left: 18px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    display: flex;
    flex-direction: column;
    gap: 6px;
    line-height: 1.45;
  }

  .card.open {
    border-color: var(--text-3);
    background: none;
  }

  .chip.warn {
    color: var(--warn, #d8a03d);
    border-color: color-mix(in srgb, var(--warn, #d8a03d) 40%, transparent);
  }

  .key-line .input {
    flex: 1;
    font-family: var(--font-mono);
  }
</style>
