<script>
  /**
   * The ground's shape, on or off, and how the camera leans over it.
   *
   * Sits under the compass because it is the same kind of reading: which way
   * the map looks. Off, the map is the flat picture every capture has always
   * been. On, the relief rises under the imagery, and the middle-drag that
   * turns the map tilts it too, as in Google Earth. An exaggerated relief says
   * so in the control itself, since a slope drawn twice its height is a reading
   * aid and not how the ground looks.
   */
  import { EXAGGERATIONS } from '../../lib/map/relief.js';

  let {
    on = $bindable(false),
    exaggeration = $bindable(1),
    /** The camera's tilt now, in degrees from straight down. */
    pitch = 0,
    /** Tilt the camera to this many degrees. */
    ontilt = () => {},
    /** Say something once, the first time relief is switched on. */
    onhint = () => {},
  } = $props();

  /** A tilted view goes back flat; a flat one leans to a reading angle. */
  const READING_TILT = 60;
  const tilted = $derived(pitch > 0);
  const HINTED = 'azimut.relief.hinted';

  /** On, and the first time ever, a word on how the view tilts: nothing on screen shows it. */
  function toggle() {
    on = !on;
    if (!on) return;
    try {
      if (localStorage.getItem(HINTED)) return;
      localStorage.setItem(HINTED, '1');
    } catch {
      return;
    }
    onhint('Middle-drag or Shift+drag the map to tilt and turn it');
  }
</script>

<div class="relief-ctl" class:on>
  <button
    class="toggle"
    aria-pressed={on}
    onclick={toggle}
    title={on ? 'Back to the flat map' : 'Show the relief in 3D'}
  >
    3D
  </button>
  {#if on}
    <button
      class="tilt"
      onclick={() => ontilt(tilted ? 0 : READING_TILT)}
      title={tilted ? 'Look straight down' : 'Lean the view toward the horizon'}
      aria-label={tilted ? 'Look straight down' : 'Tilt the view'}
    >
      Tilt <span class="mono">{Math.round(pitch)}°</span>
    </button>
    <select
      class="scale"
      class:raised={exaggeration !== 1}
      bind:value={exaggeration}
      title={exaggeration === 1 ? 'Heights at their real scale' : `Heights drawn ${exaggeration}× taller than they are`}
      aria-label="Relief height scale"
    >
      {#each EXAGGERATIONS as step (step)}
        <option value={step}>{step === 1 ? 'Real heights' : `Heights ×${step}`}</option>
      {/each}
    </select>
  {/if}
</div>

<style>
  .relief-ctl {
    display: flex;
    align-items: stretch;
    height: 30px;
    border-radius: var(--radius-1);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 0 0 1px var(--border);
  }
  .relief-ctl.on {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .toggle {
    padding: 0 9px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--text-2);
    cursor: pointer;
  }
  .toggle:hover,
  .on .toggle {
    color: var(--accent);
  }
  .tilt {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    font-size: var(--fs-xs);
    color: var(--text-1);
    border-left: 1px solid var(--border);
    cursor: pointer;
  }
  .tilt:hover {
    color: var(--accent);
  }
  .scale {
    padding: 0 4px;
    border: none;
    border-left: 1px solid var(--border);
    background: none;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .scale.raised {
    color: var(--warn);
  }
</style>
