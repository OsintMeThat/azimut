<script>
  // Sun and moon for the parsed point on one local day. Every instant is written
  // twice, civil local and UTC, because an OSINT timestamp is only ever quoted in
  // one of the two and the reader needs the other.
  //
  // Polar day, polar night and a day with no moonrise are printed as what they
  // are. They are not failures, and above the Arctic Circle they are the norm.
  import { api } from '../../lib/api.js';
  import { toast, uiState } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';
  import MoonGlyph from '../../components/MoonGlyph.svelte';
  import DayChart from './DayChart.svelte';
  import SkyRose from './SkyRose.svelte';

  let { point = null } = $props();

  let sky = $state(null);
  let loading = $state(false);
  let day = $state(''); // empty: the backend reads today in the point's own zone
  let clock = $state(''); // empty: local midday, a neutral moment inside the day
  let request = 0;

  const shownDay = $derived(day || sky?.date || '');
  const shownClock = $derived(clock || sky?.moment?.local?.slice(11, 16) || '');

  // What the panel will answer, previewed before there is a point to answer for.
  // Mirrors the row order below, the way Coordinates previews its notation list.
  const PREVIEW_ROWS = [
    'Sunrise',
    'Solar noon',
    'Sunset',
    'Civil twilight',
    'Moonrise',
    'Moonset',
    'Phase',
  ];

  // One clause each, on the row rather than the label, so hovering anywhere in
  // the line explains it. These are the conventions the numbers were computed
  // under, which is what a reader quoting them needs to know.
  const NOTES = {
    sunrise: "When the sun's upper limb reaches the horizon, refraction included",
    noon: 'When the sun crosses the meridian, its highest point of the day',
    sunset: "When the sun's upper limb leaves the horizon, refraction included",
    civil: 'Sun down to 6° below the horizon: outdoor detail is still readable',
    nautical: 'Sun 6° to 12° below: the sea horizon is still visible',
    astronomical: 'Sun 12° to 18° below: darker than this changes nothing for the eye',
    moonrise: "When the moon's upper limb reaches the horizon, its parallax included",
    moonset: "When the moon's upper limb leaves the horizon, its parallax included",
    sunNow: 'Bearing from north, and height above the horizon, at the time above',
    moonNow: 'Bearing from north, and height above the horizon, at the time above',
    phase: 'Lit fraction, and the angle of the lit edge measured from straight up',
    sunState: 'At this latitude and date the sun never crosses the horizon',
    moonState: 'The moon stays up, or stays down, for the whole of this date',
  };

  $effect(() => {
    if (!point) return;
    const { lat, lon } = point;
    const params = new URLSearchParams({ lat, lon });
    if (day) params.set('date', day);
    if (clock) params.set('time', clock);
    const ticket = ++request;
    loading = true;
    api
      .get(`/api/geo/sky?${params}`)
      .then((result) => {
        if (ticket !== request) return; // a later edit already won
        sky = result;
      })
      .catch(() => {
        if (ticket === request) toast('Could not read the sky for that point', 'danger');
      })
      .finally(() => {
        if (ticket === request) loading = false;
      });
  });

  const time = (stamp) => stamp?.local?.slice(11, 16) ?? '';
  const utc = (stamp) => stamp?.utc?.slice(11, 16) ?? '';
  // A sunset or the end of a twilight can fall after local midnight; say so
  // rather than printing a time that looks like it belongs to the morning.
  const carry = (stamp) => (stamp && shownDay && stamp.local.slice(0, 10) !== shownDay ? '+1' : '');

  const SUN_STATES = { always_up: 'Midnight sun', always_down: 'Polar night' };
  const TWILIGHT_STATES = { always_up: 'Never that dark', always_down: 'Never that light' };
  const MOON_STATES = { always_up: 'Up all day', always_down: 'Down all day' };

  const degrees = (value) => (value === null || value === undefined ? '' : `${Math.round(value)}°`);

  const selectedMinute = $derived.by(() => {
    if (!sky?.moment?.local) return null;
    const [hours, mins] = sky.moment.local.slice(11, 16).split(':').map(Number);
    return hours * 60 + mins;
  });

  // Hand the point, the date and the time to the map, which opens its own Sun &
  // moon mode there. No computed value travels: the map asks for its own, so the
  // two entry points cannot drift apart.
  function showOnMap() {
    uiState.gotoCoords = { lat: point.lat, lon: point.lon };
    uiState.skyAt = {
      lat: point.lat,
      lon: point.lon,
      date: sky.date,
      time: sky.moment.local.slice(11, 16),
    };
    uiState.tool = 'satellite';
  }
</script>

<div class="sky" class:loading>
  <div class="sky-head">
    <h3>Sun &amp; moon</h3>
    <input
      class="input input-sm"
      type="date"
      value={shownDay}
      disabled={!point}
      onchange={(e) => (day = e.currentTarget.value)}
      title="Local date at this point"
    />
    <input
      class="input input-sm"
      type="time"
      value={shownClock}
      disabled={!point}
      onchange={(e) => (clock = e.currentTarget.value)}
      title="Local time at this point"
    />
    {#if !point}
      <span class="zone">Computed here, offline, for whatever coordinate you paste.</span>
    {/if}
    {#if sky}
      <span class="zone" title={sky.zone.name}>
        {sky.zone.name} · {sky.zone.abbreviation} {sky.zone.offset}
      </span>
      <button class="btn btn-sm" onclick={showOnMap} title="Draw this day's path on the map">
        <Icon name="crosshair" size={14} /> Show on map
      </button>
    {/if}
  </div>

  {#if sky}
    <div class="grid">
      <div class="table">
        <div class="head">
          <span></span><span>Local</span><span>UTC</span><span></span>
        </div>

        <p class="section">Sun</p>
        {#if sky.sun.state === 'rises'}
          <div class="row" title={NOTES.sunrise}>
            <span class="k">Sunrise</span>
            <span class="v mono">{time(sky.sun.rise)}<sup>{carry(sky.sun.rise)}</sup></span>
            <span class="v mono dim">{utc(sky.sun.rise)}</span>
            <span class="x">az {degrees(sky.sun.rise_azimuth)}</span>
          </div>
          <div class="row" title={NOTES.noon}>
            <span class="k">Solar noon</span>
            <span class="v mono">{time(sky.sun.transit)}</span>
            <span class="v mono dim">{utc(sky.sun.transit)}</span>
            <span class="x">alt {degrees(sky.sun.transit_altitude)}</span>
          </div>
          <div class="row" title={NOTES.sunset}>
            <span class="k">Sunset</span>
            <span class="v mono">{time(sky.sun.set)}<sup>{carry(sky.sun.set)}</sup></span>
            <span class="v mono dim">{utc(sky.sun.set)}</span>
            <span class="x">az {degrees(sky.sun.set_azimuth)}</span>
          </div>
        {:else}
          <div class="row" title={NOTES.sunState}>
            <span class="k">Sunrise, sunset</span>
            <span class="v state">{SUN_STATES[sky.sun.state]}</span>
            <span class="v"></span>
            <span class="x">highest {degrees(sky.sun.transit_altitude)}</span>
          </div>
        {/if}
        {#each Object.entries(sky.twilight) as [name, phase] (name)}
          <div class="row" title={NOTES[name]}>
            <span class="k">{name[0].toUpperCase() + name.slice(1)} twilight</span>
            {#if phase.state === 'rises'}
              <span class="v mono"
                >{time(phase.dawn)} – {time(phase.dusk)}<sup>{carry(phase.dusk)}</sup></span
              >
              <span class="v mono dim">{utc(phase.dawn)} – {utc(phase.dusk)}</span>
            {:else}
              <span class="v state">{TWILIGHT_STATES[phase.state]}</span>
              <span class="v"></span>
            {/if}
            <span class="x"></span>
          </div>
        {/each}
        <div class="row row-now" title={NOTES.sunNow}>
          <span class="k">At {shownClock}</span>
          <span class="v mono">az {degrees(sky.sun.azimuth)}</span>
          <span class="v mono">alt {degrees(sky.sun.altitude)}</span>
          <span class="x">{sky.sun.altitude < 0 ? 'below the horizon' : ''}</span>
        </div>

        <p class="section">Moon</p>
        {#if sky.moon.state === 'rises'}
          {#each sky.moon.rises as rise, i (rise.utc)}
            <div class="row" title={NOTES.moonrise}>
              <span class="k">Moonrise</span>
              <span class="v mono">{time(rise)}</span>
              <span class="v mono dim">{utc(rise)}</span>
              <span class="x">az {degrees(sky.moon.rise_azimuths[i])}</span>
            </div>
          {/each}
          {#if !sky.moon.rises.length}
            <div class="row" title={NOTES.moonrise}>
              <span class="k">Moonrise</span>
              <span class="v state">None on this date</span>
              <span class="v"></span><span class="x"></span>
            </div>
          {/if}
          {#each sky.moon.sets as set, i (set.utc)}
            <div class="row" title={NOTES.moonset}>
              <span class="k">Moonset</span>
              <span class="v mono">{time(set)}</span>
              <span class="v mono dim">{utc(set)}</span>
              <span class="x">az {degrees(sky.moon.set_azimuths[i])}</span>
            </div>
          {/each}
          {#if !sky.moon.sets.length}
            <div class="row" title={NOTES.moonset}>
              <span class="k">Moonset</span>
              <span class="v state">None on this date</span>
              <span class="v"></span><span class="x"></span>
            </div>
          {/if}
        {:else}
          <div class="row" title={NOTES.moonState}>
            <span class="k">Moonrise, moonset</span>
            <span class="v state">{MOON_STATES[sky.moon.state]}</span>
            <span class="v"></span><span class="x"></span>
          </div>
        {/if}
        <div class="row row-now" title={NOTES.moonNow}>
          <span class="k">At {shownClock}</span>
          <span class="v mono">az {degrees(sky.moon.azimuth)}</span>
          <span class="v mono">alt {degrees(sky.moon.altitude)}</span>
          <span class="x">{sky.moon.altitude < 0 ? 'below the horizon' : ''}</span>
        </div>
        <div class="row" title={NOTES.phase}>
          <span class="k">Phase</span>
          <!-- drawn whatever the moon's altitude: the phase is a fact about the
               date, not about whether it happens to be up right now -->
          <span class="v phase">
            <MoonGlyph
              illuminated={sky.moon.illuminated}
              phaseAngle={sky.moon.phase_angle}
              waxing={sky.moon.waxing}
            />
            {sky.moon.phase}
          </span>
          <span class="v mono">{Math.round(sky.moon.illuminated * 100)}% lit</span>
          <span class="x">limb {degrees(sky.moon.limb_from_vertical)} from vertical</span>
        </div>
      </div>

      <SkyRose sun={sky.sun} moon={sky.moon} />
    </div>
    <DayChart
      curve={sky.curve}
      minutes={sky.curve.minutes}
      selected={selectedMinute}
      sun={sky.sun.altitude}
      moon={sky.moon.altitude}
    />
  {:else}
    <div class="table preview">
      <div class="head"><span></span><span>Local</span><span>UTC</span><span></span></div>
      {#each PREVIEW_ROWS as label (label)}
        <div class="row">
          <span class="k">{label}</span>
          <span class="v mono">–</span>
          <span class="v mono">–</span>
          <span class="x"></span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sky {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 16px;
    transition: opacity 120ms var(--ease);
  }
  .sky.loading {
    opacity: 0.6;
  }
  .sky-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .input-sm {
    width: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
  .zone {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .grid {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .table {
    flex: 1;
    min-width: 0;
  }
  .preview .v {
    color: var(--text-3);
  }
  .head,
  .row {
    display: grid;
    /* Wide enough that a twilight range reads on one line, which it did not at
       the narrow width. */
    grid-template-columns: 190px 170px 150px 1fr;
    align-items: baseline;
    gap: 10px;
    padding: 4px 0;
  }
  .head {
    font-size: var(--fs-xs);
    color: var(--text-3);
    border-bottom: 1px solid var(--border);
  }
  .section {
    margin: 10px 0 2px;
    font-size: var(--fs-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .k {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .v {
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .v.dim {
    color: var(--text-3);
  }
  .v.state,
  .v.phase {
    color: var(--text-2);
  }
  .v.phase {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .row-now .v {
    font-family: var(--font-mono);
  }
  .x {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  sup {
    color: var(--text-3);
    font-size: 0.7em;
  }
  @media (max-width: 780px) {
    .grid {
      flex-direction: column;
    }
  }
</style>
