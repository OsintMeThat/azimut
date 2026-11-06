<script>
  import Icon from './Icon.svelte';
  import { MAX_MOMENTS, parseClock } from '../lib/scenes.js';

  // When a scene happens, opened for a change: Whole video, Instant or Passage, then
  // its moments, each typed, taken from the frame on screen or nudged a frame at a
  // time, and Apply. Driven by a `lib/sceneEdit.svelte.js`, which holds what the
  // fields read; nothing is kept until Apply.
  //
  // Inspect opens it in a scene's row of its drawer, Geo Proof under its scene's
  // player. Only the words differ: what a control says on hover (`help`), and what
  // the line under the moments says about the frame on screen (`tips`).
  let {
    edit,
    help,
    tips,
    onhere,
    onkind,
    onnudge,
    onaddmoment,
    onapply,
    oncancel,
  } = $props();

  function fieldKey(e, which, index) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onapply?.();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      oncancel?.();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onnudge?.(which, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey, index);
    }
  }

  // A field that opens in hand is picked, so typing replaces it.
  function picked(node, inHand) {
    if (inHand) {
      node.focus();
      node.select();
    }
  }

  const KINDS = $derived([
    { id: 'whole', label: 'Whole video', help: help.whole },
    { id: 'instant', label: 'Instant', help: help.instant },
    { id: 'passage', label: 'Passage', help: help.passage },
  ]);
</script>

<div class="editor" role="group" aria-label="When the scene happens">
  <div class="kinds" role="radiogroup" aria-label="Kind of time">
    {#each KINDS as k (k.id)}
      <button role="radio" aria-checked={edit.kind === k.id} class:on={edit.kind === k.id} onclick={() => onkind?.(k.id)} title={k.help}>{k.label}</button>
    {/each}
  </div>
  {#if edit.whole}
    <p class="tip">{tips.whole}</p>
  {:else}
    {#each edit.moments as m, i (i)}
      <div
        class="moment"
        class:held={edit.moments.length > 1 && i === edit.active}
        role="group"
        aria-label={`Moment ${i + 1}`}
        data-testid="scene-moment"
        onfocusin={() => edit.activate(i)}
        onpointerdown={() => edit.activate(i)}
      >
        <label class="field">
          <span class="name">{m.passage ? 'Start' : 'At'}</span>
          <span class="field-with-act">
            <input
              class="input mono"
              value={m.startText}
              oninput={(e) => edit.typeStart(e.currentTarget.value, i)}
              onkeydown={(e) => fieldKey(e, 'start', i)}
              aria-label="Scene start"
              aria-invalid={parseClock(m.startText) == null}
              title={help.field}
              spellcheck="false"
              autocomplete="off"
              use:picked={i === edit.active}
            />
            <button class="field-act here" onclick={() => onhere?.('start', i)} title={help.startHere}>Here</button>
          </span>
        </label>
        {#if m.passage}
          <label class="field">
            <span class="name">End</span>
            <span class="field-with-act">
              <input
                class="input mono"
                value={m.endText}
                oninput={(e) => edit.typeEnd(e.currentTarget.value, i)}
                onkeydown={(e) => fieldKey(e, 'end', i)}
                aria-label="Scene end"
                aria-invalid={parseClock(m.endText) == null}
                title={help.field}
                spellcheck="false"
                autocomplete="off"
              />
              <button class="field-act here" onclick={() => onhere?.('end', i)} title={help.endHere}>Here</button>
            </span>
          </label>
        {:else}
          <span class="field"></span>
        {/if}
        {#if edit.moments.length > 1}
          <button class="drop" onclick={() => edit.remove(i)} title={help.remove} aria-label="Remove this moment">
            <Icon name="x" size={11} />
          </button>
        {/if}
      </div>
    {/each}
    {#if edit.many && edit.moments.length < MAX_MOMENTS}
      <button class="btn btn-ghost btn-xs another" onclick={() => onaddmoment?.()} title={help.add}>
        <Icon name="plus" size={11} /> Another moment
      </button>
    {/if}
  {/if}
  {#if edit.problem}
    <p class="problem" role="alert">{edit.problem}</p>
  {:else if !edit.whole}
    <p class="tip">{edit.end != null ? tips.passage : tips.instant}</p>
  {/if}
  <div class="acts">
    <button class="btn btn-ghost btn-xs" onclick={() => oncancel?.()}>Cancel</button>
    <button class="btn btn-primary btn-xs" disabled={Boolean(edit.problem)} onclick={() => onapply?.()} title={help.apply}>Apply</button>
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .kinds {
    display: grid;
    grid-template-columns: 1.3fr 1fr 1fr;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .kinds button {
    padding: 3px 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .kinds button + button {
    border-left: 1px solid var(--border);
  }
  .kinds button:hover:not(.on) {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .kinds button.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  /* One moment: its start, its end when it is a passage, and its removal. */
  .moment {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    align-items: end;
    gap: 6px;
    padding-left: 6px;
    border-left: 2px solid transparent;
  }
  .moment.held {
    border-left-color: var(--scene, var(--accent));
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    color: var(--text-3);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .field .input {
    padding: 3px 6px;
    font-size: var(--fs-xs);
  }
  .field .input[aria-invalid='true'] {
    color: var(--danger);
  }
  .here {
    width: auto;
    padding: 0 7px;
    font-size: 11px;
  }
  .drop {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 26px;
    border-radius: var(--r-sm);
    color: var(--text-3);
  }
  .drop:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .another {
    align-self: flex-start;
  }
  .problem,
  .tip {
    margin: 0;
    font-size: 11px;
    line-height: 1.35;
  }
  .problem {
    color: var(--danger);
  }
  .tip {
    color: var(--text-3);
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
</style>
