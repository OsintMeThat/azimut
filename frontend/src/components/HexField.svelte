<script>
  /**
   * A colour as text, to copy out or paste in: `#d55e00`, `rgb(213, 94, 0)` and
   * the like are read (`lib/colourCode.js`). A paste is taken at once, a typed
   * code on Enter or on leaving the field; one that reads as no colour is marked
   * and Escape puts the colour back.
   */
  import { parseColour } from '../lib/colourCode.js';

  let { value = '', label = 'Colour code', disabled = false, onpick } = $props();
  let text = $state('');
  let wrong = $state(false);
  $effect(() => { text = String(value ?? '').toLowerCase(); wrong = false; });

  function take(raw) {
    const hex = parseColour(raw);
    if (!hex) { wrong = raw.trim() !== '' && raw.trim().toLowerCase() !== String(value ?? '').toLowerCase(); return; }
    wrong = false;
    text = hex;
    if (hex !== String(value ?? '').toLowerCase()) onpick?.(hex);
  }
  function paste(event) {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!parseColour(pasted)) return;
    event.preventDefault();
    take(pasted);
  }
  function key(event) {
    if (event.key === 'Enter') { event.preventDefault(); take(text); }
    else if (event.key === 'Escape' && text !== String(value ?? '').toLowerCase()) {
      event.stopPropagation();
      text = String(value ?? '').toLowerCase(); wrong = false;
    }
  }
</script>

<input type="text" class="hex" aria-label={label} aria-invalid={wrong} spellcheck="false" autocomplete="off" maxlength="40" {disabled}
  title="Type or paste a colour code, such as #d55e00 or rgb(213, 94, 0)" value={text}
  oninput={(event) => { text = event.currentTarget.value; wrong = false; }}
  onpaste={paste} onkeydown={key} onblur={() => take(text)} onfocus={(event) => event.currentTarget.select()} />

<style>
  .hex { width: 72px; min-width: 0; height: 24px; padding: 2px 6px; font-family: var(--font-mono); font-size: 11px; }
  .hex[aria-invalid='true'] { border-color: var(--danger); }
</style>
