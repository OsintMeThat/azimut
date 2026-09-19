<script>
  /**
   * A date typed as one line of text, shown day-first, and stored in the case's
   * temporal profile (`lib/looseDate.js` does the reading).
   *
   * The browser's own date input writes its placeholder in the browser's
   * language and its value in the browser's order, so an English interface read
   * `jj/mm/aaaa` on a French machine. This one says `dd/mm/yyyy` everywhere and
   * says, under the field, what it understood.
   *
   * `day` narrows it to one plain day, for a field that computes from a date
   * (the sky over a point) rather than stating one: a month, a range or a mark
   * of doubt is refused there rather than guessed at.
   *
   * Outside `day`, text it cannot read is still handed on as typed, which is
   * what the old advanced mode did: the save refuses it with the reason, and
   * the line under the field has already said it.
   */
  import Icon from './Icon.svelte';
  import DateBuilder from './DateBuilder.svelte';
  import { formatTemporalValue } from '../lib/timeline.js';
  import { LOOSE_DATE_HINT, friendlyDate, parseLooseDate } from '../lib/looseDate.js';

  let {
    id = undefined,
    /** The stored value: `2025-10-24`, `2025-10~`, `…T14:30:00Z`, `a/b`, or ''. */
    value = '',
    day = false,
    placeholder = 'dd/mm/yyyy',
    label = 'Date',
    disabled = false,
    /** Whether to say, under the field, what it was read as. A reason it
     *  could not be read is said either way. */
    reading = true,
    /** Whether a calendar can be opened beside the field, for a date somebody
     *  would rather build than spell. Off by default: most of these fields sit in
     *  a row where a second control would crowd what is already a small box. */
    calendar = false,
    onchange,
  } = $props();

  let text = $state('');
  let sent = $state(null);

  $effect(() => {
    const incoming = value ?? '';
    if (incoming !== sent) {
      text = friendlyDate(incoming);
      sent = incoming;
    }
  });

  function readText(input) {
    const parsed = parseLooseDate(input);
    if (!day || parsed.error || !parsed.value) return parsed;
    return /^\d{4}-\d{2}-\d{2}$/.test(parsed.value)
      ? parsed
      : { value: null, error: 'Give one full day, like 24/10/2025.' };
  }

  const parsed = $derived(readText(text));
  const said = $derived.by(() => {
    if (!text.trim()) return '';
    if (parsed.error) return parsed.error;
    const format = formatTemporalValue(parsed.value);
    return [format.label, ...format.qualifiers].join(' · ');
  });

  function commit(next) {
    if (next === sent) return;
    sent = next;
    onchange?.(next);
  }

  function input(event) {
    text = event.currentTarget.value;
    const read = readText(text);
    if (read.value !== null) commit(read.value);
    else if (!day) commit(text.trim());
  }

  // Once the field is left, a date it understood is shown the way it is kept,
  // so what stays on screen is what was saved.
  function settle() {
    if (parsed.value) text = friendlyDate(parsed.value);
  }

  // The builder, when the field offers one. It stays open while it is being
  // used — a date is built in two or three presses, precision then day then
  // doubt, and a panel that shut after the first would be re-opened for each.
  let open = $state(false);

  function build(next) {
    text = friendlyDate(next);
    commit(next);
  }
</script>

<div class="date-field">
  <div class="line" class:field-with-act={calendar}>
    <input
      {id}
      class="input input-sm mono"
      type="text"
      inputmode="text"
      autocomplete="off"
      spellcheck="false"
      aria-label={label}
      aria-invalid={Boolean(parsed.error)}
      title={day ? 'One day, as dd/mm/yyyy' : LOOSE_DATE_HINT}
      {placeholder}
      {disabled}
      value={text}
      oninput={input}
      onblur={settle}
      onkeydown={(event) => { if (event.key === 'Enter') settle(); }}
    />
    {#if calendar}
      <button
        type="button"
        class="field-act"
        class:on={open}
        {disabled}
        aria-expanded={open}
        aria-label="Build the date"
        title="Build the date"
        onclick={() => (open = !open)}
      >
        <Icon name="calendar" size={14} />
      </button>
    {/if}
  </div>
  {#if calendar && open}
    <DateBuilder value={parsed.value ?? ''} {label} onbuild={build} />
  {/if}
  {#if said && (reading || parsed.error)}
    <p class="said" class:bad={Boolean(parsed.error)} aria-live="polite">{said}</p>
  {/if}
</div>

<style>
  .date-field {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .date-field input {
    width: 100%;
    min-width: 0;
  }
  /* Stretch, not centre: the act at the end is a panel of the field's own box
     and has to be as tall as it. Centring left it a short tab floating in the
     middle of the right-hand edge. */
  .line {
    display: flex;
    align-items: stretch;
    min-width: 0;
  }
  .line input {
    flex: 1;
    min-width: 0;
  }
  /* A field whose text cannot be read says so on the box around it, which with
     the calendar beside it is the box they share. */
  .date-field :global(.field-with-act:has(input[aria-invalid='true'])),
  .date-field input[aria-invalid='true'] {
    border-color: var(--warn);
  }
  .said {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.4;
  }
  .said.bad {
    color: var(--warn);
  }
</style>
