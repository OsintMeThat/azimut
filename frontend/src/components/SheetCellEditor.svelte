<script>
  /**
   * The box a cell is edited in, and what its column can offer while you type.
   *
   * A role is a lens and never a validator, so this **always** keeps the free text box.
   * The binders write `OK en cours` in a status column, `AFTER` in a date column and
   * `To be found` where a coordinate goes, on every page; an editor that offered only a
   * closed list or only a calendar would refuse exactly the cells that carry the
   * reasoning.
   *
   * What a role adds is a shortcut beside the box:
   *
   * - a **state** or a **set of values** offers its vocabulary, **narrowed to what has
   *   been typed**. On a column of thirty values, a list that showed all thirty while the
   *   analyst typed `s-1` was a list nobody read. On a multi-value column the narrowing
   *   works on the value after the last separator, because that is the one being written.
   * - the keyboard drives that list: ↑ and ↓ move, Enter and Tab take what is
   *   highlighted, and a value the vocabulary has never heard of can be **added to it**
   *   from here rather than from the column panel.
   * - a **date** offers a calendar, and what it writes is the form the column already
   *   uses — picking a date in a `dd/MM/yyyy` column leaves it a `dd/MM/yyyy` column.
   *
   * Clicking an offer stays a **toggle** on a multi-value column: that is how a list is
   * built and unbuilt with the mouse. The keyboard *completes* instead, which is what
   * typing means.
   */
  import Icon from './Icon.svelte';
  import { closeOnOutsidePointer } from '../lib/dismiss.js';
  import {
    DEFAULT_SEPARATOR,
    dateSpelling,
    parseWhen,
    pickerType,
    spellWhen,
    valueColour,
  } from '../lib/sheetRoles.js';

  let {
    value = '',
    role = null,
    column = null,
    table = null,
    oninput,
    oncommit,
    onaddvalue = null,
  } = $props();

  const kind = $derived(role?.kind ?? null);
  const vocabulary = $derived(kind === 'state' || kind === 'choice' ? (role.values ?? []) : []);
  const multi = $derived(kind === 'choice' ? role.multi : null);

  /** Where the value being written starts. On a list column that is after the last
   *  separator; everywhere else it is the whole cell. */
  const cut = $derived(multi ? String(value).lastIndexOf(multi) : -1);
  const head = $derived(cut === -1 ? '' : String(value).slice(0, cut + multi.length));
  const term = $derived((cut === -1 ? String(value) : String(value).slice(cut + multi.length)).trim());

  /** Whether the word being written is already, exactly, one the column knows. */
  const known = $derived(
    Boolean(term) && vocabulary.some((entry) => entry.toLowerCase() === term.toLowerCase()),
  );
  /**
   * The vocabulary narrowed to what is being typed.
   *
   * Narrowed only while the word is **unfinished**. A term that is already exactly one of
   * the column's values is not a prefix being completed, it is an answer that has landed
   * — and filtering on it collapsed the list to the value just chosen, which on a
   * multi-value column left nothing to click for the second one.
   */
  const offers = $derived(
    term && !known
      ? vocabulary.filter((entry) => entry.toLowerCase().includes(term.toLowerCase()))
      : vocabulary,
  );

  let highlight = $state(0);
  // Back to the top whenever the list changes under it: a highlight left on row seven of
  // a list that is now two long points at nothing.
  $effect(() => {
    void offers.length;
    highlight = 0;
  });

  /** The cells of this column, which is where both answers below come from. */
  const cells = $derived(
    kind === 'when' && table && column ? table.rows.map((row) => row[column.index]) : [],
  );
  /** How this column writes its dates, read from the column and not declared: a picker
   *  that restyled the file from a click would break the promise the file keeps the
   *  words. */
  const spelling = $derived(dateSpelling(cells));
  /** The column says which of the three it holds; the picker follows it. */
  const shape = $derived(role?.shape ?? 'date');

  /** What the picker should open on: whatever the cell already holds, in its own shape. */
  const picked = $derived.by(() => {
    if (kind !== 'when') return '';
    const read = parseWhen(value, role);
    if (!read) return '';
    if (shape === 'time') {
      return read.shape === 'time'
        ? read.text
        : new Date(read.key).toISOString().slice(11, 16);
    }
    if (read.shape !== 'moment') return '';
    const iso = new Date(read.key).toISOString();
    return shape === 'datetime' ? iso.slice(0, 16) : iso.slice(0, 10);
  });

  const held = $derived(
    multi
      ? String(value).split(multi).map((part) => part.trim()).filter(Boolean)
      : [String(value).trim()],
  );
  const taken = $derived(new Set(held));

  const colourOf = (entry) => valueColour(role, entry);

  /**
   * A pointer landing anywhere outside commits and closes.
   *
   * `blur` on the box is not enough on its own, and the reason is this component's own
   * shape: the offers hang *below* the cell in an absolute panel, so a click just under
   * the cell — which reads as "outside" to the analyst — lands on the panel, where the
   * press is deliberately swallowed to keep a chip clickable. Without this the editor
   * stayed open and nothing appeared to happen.
   */
  let box = $state(null);
  $effect(() => (box ? closeOnOutsidePointer(box, commit) : undefined));

  /**
   * Which way the offers open.
   *
   * They hang inside the grid's own scroller, so on the last rows on screen a list that
   * always dropped downwards was cut off by the edge of the table — on a status column,
   * exactly the rows an analyst works through last. Measured once as the editor opens,
   * against the scroller rather than the window: below the table is not room.
   */
  /** What the list asks for before it is worth turning it over. Its own `max-height`, so
   *  the two answers cannot drift apart. */
  const OFFERS_H = 260;
  let field = $state(null);
  let above = $state(false);
  $effect(() => {
    if (!field) return;
    const cell = field.getBoundingClientRect();
    const room = field.closest('#sheet-grid')?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    above = room.bottom - cell.bottom < OFFERS_H && cell.top - room.top > OFFERS_H;
  });

  /** Leave the cell holding one clean list rather than what the keystrokes left behind.
   *  Only on a column that declares a separator, where re-joining is what the column
   *  *means*: `Buk-M2E, , ZU23-2, ` is not two answers and a third empty one. */
  function commit() {
    if (multi) {
      const tidy = held.join(multi);
      if (tidy !== String(value)) oninput(tidy);
    }
    oncommit();
  }

  /** Click an offer: put the value in, or take it back out. The mouse gesture, and the
   *  reason it is a toggle is that a list is unbuilt as often as it is built. */
  function toggle(entry) {
    if (!multi) {
      oninput(entry);
      oncommit();
      return;
    }
    const values = [...held];
    const at = values.indexOf(entry);
    if (at === -1) values.push(entry);
    else values.splice(at, 1);
    oninput(values.join(multi || DEFAULT_SEPARATOR));
  }

  /** Take the highlighted offer as the completion of what is being typed. The keyboard
   *  gesture: it finishes the word, and on a list column it leaves the separator behind
   *  so the next value can be typed straight away. */
  function complete(entry) {
    if (!multi) {
      oninput(entry);
      return;
    }
    oninput(`${head}${entry}${multi}`);
  }

  /**
   * The keys the offer list owns, taken before the grid's own handler sees them.
   *
   * The grid listens on the window and gives Enter and Tab their meaning there, which is
   * right while nothing is open under the cursor. With a list open they mean "take this
   * one", so the press is stopped here rather than reaching two handlers with two ideas.
   */
  function onkeydown(event) {
    if (!offers.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlight = (highlight + step + offers.length) % offers.length;
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      complete(offers[highlight]);
      // A single-value column has nothing left to say once its answer is in.
      if (!multi) commit();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      complete(offers[highlight]);
      commit();
    }
  }
</script>

<!-- `display: contents`, so the wrapper is only there to be asked whether a pointer
     landed inside it. -->
<div class="editing" bind:this={box}>
  <!-- svelte-ignore a11y_autofocus -->
  <textarea class="editor" autofocus {value} bind:this={field}
            oninput={(event) => oninput(event.currentTarget.value)}
            {onkeydown}
            onblur={commit}></textarea>

  {#if vocabulary.length || kind === 'when'}
    <!-- Held open by the pointer going down on it rather than by focus: the box loses
         focus the moment a chip is pressed, and a blur that committed first would close
         this before the click landed. -->
    <div class="offers" class:above role="presentation"
         onpointerdown={(event) => event.preventDefault()}>
      {#each offers as entry, at (entry)}
        <button class="offer c-{colourOf(entry) ?? 'none'}" class:tinted={colourOf(entry)}
                class:on={taken.has(entry)} class:lit={at === highlight}
                onclick={() => toggle(entry)}>
          <i class="tick">{#if taken.has(entry)}<Icon name="check" size={11} />{/if}</i>
          <span>{entry}</span>
        </button>
      {/each}
      {#if vocabulary.length && !offers.length}
        <p class="none">No value of this column matches.</p>
      {/if}
      {#if term && !known && onaddvalue}
        <button class="offer add" onclick={() => onaddvalue(term)}>
          <i class="tick"><Icon name="plus" size={11} /></i>
          <span>Add “{term}” to this column's words</span>
        </button>
      {/if}
      {#if kind === 'when'}
        <label class="calendar">
          <Icon name="clock" size={12} />
          <input type={pickerType(shape)} value={picked}
                 aria-label={shape === 'time' ? 'Pick a time' : 'Pick a date'}
                 onchange={(event) =>
                   oninput(spellWhen(event.currentTarget.value, { shape, spelling, keep: value }))} />
        </label>
      {/if}
    </div>
  {/if}
</div>

<style>
  .editing { display: contents; }
  .editor {
    position: absolute; z-index: 4; left: 0; top: 0; width: 100%; min-height: 30px;
    max-height: 180px; padding: 5px 8px; resize: none;
    border: 2px solid var(--accent); border-radius: 2px;
    background: var(--bg-2); color: var(--text-1);
    font-size: var(--fs-sm); font-family: inherit; line-height: 1.4;
  }
  .editor:focus { outline: none; }
  /* A list down the page, not words side by side: these are the answers a column takes,
     and a row per answer is how a list is read. */
  .offers {
    position: absolute; z-index: 5; left: 0; top: calc(100% + 2px);
    display: flex; flex-direction: column; gap: 1px;
    min-width: 100%; width: max-content; max-width: 320px; max-height: 260px; overflow: auto;
    padding: 4px; border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 10px 24px #0005;
  }
  /* Turned over on the last rows on screen, where downwards is off the table. */
  .offers.above { top: auto; bottom: calc(100% + 2px); box-shadow: 0 -10px 24px #0005; }
  .offer {
    display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 7px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left;
    font-size: var(--fs-sm); white-space: nowrap;
  }
  .offer .tick { display: flex; width: 11px; flex: none; color: var(--accent); }
  .offer span { overflow: hidden; text-overflow: ellipsis; }
  .offer:hover { background: var(--bg-2); color: var(--text-1); }
  .offer.on { color: var(--text-1); }
  /* Where Enter would land. Marked with the selection colour, which is what it is. */
  .offer.lit { background: var(--accent-soft); color: var(--text-1); }
  .offer.add { color: var(--text-3); }
  .offer.add:hover { color: var(--accent); }
  /* A value with a colour of its own wears it here too, so the list reads the same as the
     cells it fills. The `.c-*` classes are global (`app.css`) and set `--mark`. */
  .offer.tinted span { color: var(--mark); }
  .none { padding: 4px 7px; color: var(--text-3); font-size: var(--fs-xs); }
  .calendar {
    display: flex; align-items: center; gap: 4px; margin-top: 3px; padding: 1px 5px;
    border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-3);
  }
  .calendar input {
    border: 0; background: none; color: var(--text-1); font-size: var(--fs-xs);
    font-family: inherit;
  }
</style>
