<script>
  /** One half of Compare's shared A/B layer sheet. */
  import DayPicker from '../../components/DayPicker.svelte';
  import Icon from '../../components/Icon.svelte';
  import {
    DATED as FIRMS_DATED,
    lastDayOf,
    today as firmsToday,
    WINDOWS as FIRMS_WINDOWS,
  } from '../../lib/map/firms.js';
  import {
    COMPOSITE as NIGHT_COMPOSITE,
    firstNight,
    lastNight,
    SENSORS as NIGHT_SENSORS,
  } from '../../lib/map/nightlights.js';

  let {
    letter,
    present,
    layers,
    overlays,
    firms,
    night,
    firmsSensors,
    firesKeyed,
    savedCount,
    ontoggle,
    onfirms,
    onnight,
    oncopy,
    onclear,
  } = $props();

  const disabled = (id) =>
    !present || (id === 'firms' && !firesKeyed) || (id === 'saved' && !savedCount);
  const on = (id) => overlays.includes(id);
  const disabledReason = (id) =>
    id === 'firms' && !firesKeyed
      ? 'Add a FIRMS key in Settings'
      : id === 'saved' && !savedCount
        ? 'No saved work in this case'
        : '';
</script>

<section class="layer-pane" aria-label={`Imagery ${letter} layers`}>
  <header>
    <span class="letter">{letter}</span>
    <div>
      <strong>Imagery {letter}</strong>
      <small>{present ? `${overlays.length} visible` : 'No imagery selected'}</small>
    </div>
    <button class="copy" disabled={!present} onclick={oncopy} title={`Copy imagery ${letter} layers to the other side`}>
      <Icon name="copy" size={13} /> Copy
    </button>
  </header>

  <div class="layer-list">
    {#each layers as layer (layer.id)}
      <div class="layer-block" class:active={on(layer.id)} class:disabled={disabled(layer.id)}>
        <div class="layer-row">
          <button
            type="button"
            class="eye"
            class:on={on(layer.id)}
            disabled={disabled(layer.id)}
            aria-label={`${on(layer.id) ? 'Hide' : 'Show'} ${layer.label} on imagery ${letter}`}
            aria-pressed={on(layer.id)}
            title={disabledReason(layer.id) || layer.hint}
            onclick={() => ontoggle(layer.id)}
          >
            <Icon name={on(layer.id) ? 'eye' : 'eyeOff'} size={14} />
          </button>
          <button
            type="button"
            class="layer-name"
            disabled={disabled(layer.id)}
            title={disabledReason(layer.id) || layer.hint}
            onclick={() => ontoggle(layer.id)}
          >
            <strong>{layer.label}</strong>
            <small>{disabledReason(layer.id) || layer.hint}</small>
          </button>
        </div>

        {#if layer.id === 'firms' && on('firms') && firesKeyed}
          <div class="settings" aria-label={`Active fires settings for imagery ${letter}`}>
            <label>
              <span>Sensor</span>
              <select
                class="select"
                value={firms.sensor}
                onchange={(event) => onfirms({ sensor: event.currentTarget.value })}
              >
                {#each firmsSensors as sensor (sensor.id)}
                  <option value={sensor.id}>{sensor.label}</option>
                {/each}
              </select>
            </label>
            <div class="setting">
              <span>Period</span>
              <div class="chips">
                {#each FIRMS_WINDOWS as option (option.id)}
                  <button
                    type="button"
                    class:on={firms.window === option.id}
                    onclick={() => onfirms({ window: option.id })}
                  >{option.label}</button>
                {/each}
                <button
                  type="button"
                  class:on={firms.window === FIRMS_DATED}
                  onclick={() => onfirms({
                    window: FIRMS_DATED,
                    ...(!firms.first ? { first: firmsToday() } : {}),
                  })}
                >Custom</button>
              </div>
            </div>
            {#if firms.window === FIRMS_DATED}
              <div class="date-grid">
                <label>
                  <span>From</span>
                  <DayPicker
                    value={firms.first}
                    max={firmsToday()}
                    label="First day of detections to draw"
                    placeholder="Pick a day"
                    onpick={(day) => onfirms({ first: day })}
                  />
                </label>
                <label>
                  <span>To</span>
                  <DayPicker
                    value={firms.last}
                    min={firms.first}
                    max={lastDayOf(firms.first)}
                    label="Last day; blank draws the first day alone"
                    placeholder="Same day"
                    clearable
                    onpick={(day) => onfirms({ last: day })}
                  />
                </label>
              </div>
            {/if}
          </div>
        {/if}

        {#if layer.id === 'nightlights' && on('nightlights')}
          <div class="settings" aria-label={`Night lights settings for imagery ${letter}`}>
            <label>
              <span>Product</span>
              <select
                class="select"
                value={night.source}
                onchange={(event) => onnight({ source: event.currentTarget.value })}
              >
                {#each NIGHT_SENSORS as sensor (sensor.id)}
                  <option value={sensor.id}>{sensor.label} nightly</option>
                {/each}
                <option value={NIGHT_COMPOSITE.id}>{NIGHT_COMPOSITE.label} composite</option>
              </select>
            </label>
            {#if night.source !== NIGHT_COMPOSITE.id}
              <label class="night-date">
                <span>Night</span>
                <DayPicker
                  value={night.day}
                  min={firstNight(night.source)}
                  max={lastNight()}
                  label="Night of the pass, around 01:30 local time"
                  placeholder="Pick a night"
                  onpick={(day) => onnight({ day })}
                />
              </label>
            {:else}
              <p class="baseline">Cloud-free 2016 baseline</p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <footer>
    <button class="btn btn-ghost btn-sm" disabled={!present || !overlays.length} onclick={onclear}>Clear {letter}</button>
  </footer>
</section>

<style>
  .layer-pane {
    min-width: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    overflow: hidden;
  }
  header {
    min-height: 54px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 11px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
  }
  header > div { min-width: 0; flex: 1; }
  header strong, header small { display: block; }
  header strong { color: var(--text-1); font-size: var(--fs-sm); }
  header small { margin-top: 1px; color: var(--text-3); font-size: 10px; }
  .letter {
    display: grid;
    place-items: center;
    width: 25px;
    height: 25px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    color: var(--accent);
    background: var(--bg-0);
    font-size: var(--fs-xs);
    font-weight: 700;
  }
  .copy {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 7px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 10px;
  }
  .copy:hover:not(:disabled) { color: var(--text-1); background: var(--bg-3); }
  .copy:disabled { opacity: .45; }
  .layer-list { min-height: 0; overflow: auto; padding: 5px 8px; }
  .layer-block { border-bottom: 1px solid var(--border); }
  .layer-block:last-child { border-bottom: 0; }
  .layer-block.disabled { opacity: .52; }
  .layer-row { min-height: 43px; display: flex; align-items: center; gap: 6px; }
  .eye {
    display: grid;
    place-items: center;
    flex: 0 0 27px;
    width: 27px;
    height: 27px;
    border-radius: var(--r-sm);
    color: var(--text-3);
  }
  .eye:hover:not(:disabled) { color: var(--text-1); background: var(--bg-3); }
  .eye.on { color: var(--accent); }
  .layer-name { min-width: 0; flex: 1; padding: 5px 0; text-align: left; }
  .layer-name strong, .layer-name small { display: block; }
  .layer-name strong { color: var(--text-2); font-size: var(--fs-sm); }
  .layer-name small {
    margin-top: 1px;
    overflow: hidden;
    color: var(--text-3);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .active .layer-name strong { color: var(--text-1); }
  .settings {
    display: grid;
    gap: 8px;
    margin: 0 0 8px 33px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .settings label, .setting { min-width: 0; display: grid; gap: 4px; }
  .settings label > span, .setting > span {
    color: var(--text-3);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: .03em;
  }
  .settings .select { width: 100%; min-width: 0; padding: 5px 7px; font: inherit; font-size: 11px; }
  .chips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .chips button {
    min-width: 0;
    padding: 4px 3px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-2);
    background: var(--bg-1);
    font-size: 10px;
  }
  .chips button:hover { border-color: var(--border-strong); color: var(--text-1); }
  .chips button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .date-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 7px; }
  .night-date { max-width: 220px; }
  .baseline { margin: 0; color: var(--text-3); font-size: 10px; }
  footer { display: flex; justify-content: flex-end; margin-top: auto; padding: 7px 9px; border-top: 1px solid var(--border); }
  @media (max-width: 720px) {
    .date-grid { grid-template-columns: 1fr; }
  }
</style>
