<script>
  /**
   * Difference's controls, in the stage footer beside the view's own. The
   * highlights lie over whichever view is on, so nothing here moves the maps;
   * the gear opens the full settings, docked on the stage's right edge.
   *
   * Read keeps one width whatever the reading is doing, so the gear beside it
   * never moves under the pointer. What a read is doing is said in the panel
   * and the map legend.
   *
   * The reading follows the camera by itself. A method that reads Sentinel-2
   * bands runs on the frames it holds, and past the ground they cover fetches
   * them again once the camera rests, for a pair it has already read.
   * Read says which of those it is: lit when the next move is the analyst's,
   * and naming what the reading does otherwise, never a press that does nothing.
   */
  import { CHANGE_BASES, changeNeedsFrames } from '../../lib/map/changeAssist.js';
  import Icon from '../../components/Icon.svelte';

  let {
    settings = $bindable(),
    /** Whether the settings panel is open; Compare draws it on the stage. */
    open = $bindable(false),
    status,
    /** due: Read has something to do · reading · tiles: waiting on the maps · current: nothing moved. */
    reading = 'due',
    onrun = () => {},
  } = $props();

  const runnable = $derived(status.ok && status.methods.includes(settings.method));
  const frames = $derived(changeNeedsFrames(settings, status));
  const due = $derived(runnable && reading === 'due');
  const READ = {
    due: ['Read', 'Read the pixels in this view'],
    reading: ['Reading…', 'Reading the pixels in this view'],
    tiles: ['Loading…', 'Waiting for the map tiles to load'],
    current: ['Up to date', 'Nothing moved since the last read'],
  };
  const read = $derived(READ[reading] ?? READ.due);
  const busy = $derived(reading === 'reading' || reading === 'tiles');
  const readTitle = $derived(!status.ok ? status.reason
    : !runnable ? 'This method needs another imagery source'
      : reading === 'due' && frames ? 'Read this view, one Sentinel-2 request a side'
        : read[1]);
</script>

<div class="difference-bar cmp-glass" aria-label="Difference">
  <span class="name">Difference</span>
  <div class="cmp-seg" aria-label="Image under the highlights">
    {#each CHANGE_BASES as entry}
      <button class:on={settings.base === entry.id} aria-pressed={settings.base === entry.id}
        title={entry.id === 'both' ? 'Highlights on both images' : `Highlights on image ${entry.label} only`}
        onclick={() => (settings = { ...settings, base: entry.id })}>{entry.label}</button>
    {/each}
  </div>
  <button
    class="cmp-icon"
    class:on={settings.blink}
    onclick={() => (settings = { ...settings, blink: !settings.blink })}
    aria-label={settings.blink ? 'Stop blinking the highlights' : 'Blink the highlights'}
    aria-pressed={settings.blink}
    title="Blink the highlights, easier to catch over busy imagery"
  >
    <Icon name="blink" size={15} />
  </button>
  <button class="text-btn read" class:busy class:due disabled={!due} onclick={() => onrun()} title={readTitle}>
    {runnable ? read[0] : 'Read'}
  </button>
  <button
    class="cmp-icon"
    class:on={open}
    aria-expanded={open}
    aria-label="Difference settings"
    title="Difference settings"
    onclick={() => (open = !open)}
  >
    <Icon name="settings" size={15} />
  </button>
</div>

<style>
  .difference-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 5px 6px 5px 10px;
  }
  .text-btn {
    padding: 4px 8px;
    border-radius: 6px;
    color: var(--glass-muted);
    font-size: 11.5px;
    font-weight: 600;
  }
  .text-btn:hover:not(:disabled) {
    color: var(--glass-ink);
    background: var(--glass-hover);
  }
  .text-btn:disabled { opacity: 0.4; }
  /* One width for every label, so the gear beside it never moves. */
  .text-btn.read { width: 84px; text-align: center; white-space: nowrap; }
  .text-btn.read.busy:disabled { opacity: 0.75; }
  /* Lit only when pressing it is the next move, in the primary-action amber. */
  .text-btn.read.due {
    color: var(--accent-text);
    background: var(--accent);
  }
  .text-btn.read.due:hover { color: var(--accent-text); background: var(--accent-hover); }
  .name {
    font-size: var(--fs-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--glass-dim);
  }
</style>
