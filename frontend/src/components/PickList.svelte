<script>
  /**
   * One value picked from a list drawn as the app draws its menus, never the system's own list: a
   * button showing the value, which opens the list under it (`FloatingMenu.svelte`). The list holds
   * "none" first (`emptyLabel`), then `options`, then a way to type a new one (`newLabel`), which turns
   * the button into a field for it.
   *
   * It is the ARIA select-only combobox: the focus stays on the button, which names the option under
   * the keys (`aria-activedescendant`). The arrows, Home and End walk the list, Enter (or Space) picks,
   * Escape and Tab close it, and letters typed filter it, said at its top and taken back by Backspace;
   * picking New with letters typed starts the field on them. In the field, every letter is handed up
   * as it is typed, Enter or leaving it ends it, and Escape gives the value back as it was.
   */
  import { tick } from 'svelte';
  import FloatingMenu from './FloatingMenu.svelte';
  import Icon from './Icon.svelte';
  import { foldText } from '../lib/textFold.js';

  let {
    /** The value picked, '' for none. */
    value = '',
    options = [],
    emptyLabel = 'None',
    newLabel = 'New…',
    newPlaceholder = '',
    maxlength = undefined,
    /** The button's id, and the field's while a new one is typed, for a `<label for>`. */
    id = undefined,
    title = '',
    /** What the list is called, read out with it. */
    label = '',
    describedby = undefined,
    /** Called with each value picked or typed. */
    onpick = () => {},
  } = $props();

  const listId = `pick-${Math.random().toString(36).slice(2, 9)}`;
  let open = $state(false);
  let query = $state('');
  let active = $state(0);
  let typing = $state(false);
  let draft = $state('');
  let before = '';
  let trigger = $state(null);
  let field = $state(null);

  // the value is always among the options, a new one typed included
  const named = $derived(value && !options.some((option) => option.toLowerCase() === value.toLowerCase()) ? [...options, value] : options);
  const entries = $derived.by(() => {
    const wanted = foldText(query.trim());
    const found = named.filter((option) => !wanted || foldText(option).includes(wanted));
    return [
      ...(wanted ? [] : [{ value: '', text: emptyLabel, none: true }]),
      ...found.map((option) => ({ value: option, text: option })),
      { value: null, text: newLabel, fresh: true },
    ];
  });
  const optionId = (index) => `${listId}-${index}`;
  const isOn = (entry) => !entry.fresh && entry.value.toLowerCase() === value.toLowerCase();

  function show() {
    query = '';
    open = true;
    active = Math.max(0, entries.findIndex(isOn));
  }

  function close() {
    open = false;
    query = '';
  }

  async function pick(entry) {
    const typed = query.trim();
    close();
    if (entry.fresh) {
      before = value;
      draft = typed;
      typing = true;
      await tick();
      field?.focus();
      return;
    }
    onpick(entry.value);
    trigger?.focus();
  }

  function filter(next) {
    query = next;
    active = 0;
  }

  /** The keys of a select-only combobox, on the button that keeps the focus. */
  function keys(event) {
    const { key } = event;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        event.preventDefault();
        show();
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        show();
        filter(key);
      }
      return;
    }
    const last = entries.length - 1;
    if (key === 'ArrowDown') active = Math.min(last, active + 1);
    else if (key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (key === 'Home') active = 0;
    else if (key === 'End') active = last;
    else if (key === 'Enter' || (key === ' ' && !query)) void pick(entries[active]);
    else if (key === 'Backspace') filter(query.slice(0, -1));
    else if (key === 'Tab') { close(); return; }
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) filter(query + key);
    else return;
    event.preventDefault();
  }

  function type(text) {
    draft = maxlength ? text.slice(0, maxlength) : text;
    onpick(draft);
  }

  /** The field left, by Enter or elsewhere: what it holds stands, trimmed; Escape gives back the value it opened on. */
  async function stop(keep = true) {
    if (!typing) return;
    typing = false;
    onpick(keep ? draft.trim() : before);
    await tick();
    trigger?.focus();
  }

  function fieldKeys(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void stop();
    } else if (event.key === 'Escape') {
      // the field's own Escape: the dialog around it stays open
      event.preventDefault();
      event.stopPropagation();
      void stop(false);
    }
  }
</script>

{#if typing}
  <input {id} class="input pick-field" bind:this={field} value={draft} {maxlength} placeholder={newPlaceholder} spellcheck="false" autocomplete="off"
    {title} aria-describedby={describedby} oninput={(event) => type(event.currentTarget.value)} onkeydown={fieldKeys} onblur={() => stop()} />
{:else}
  <button type="button" {id} class="input pick-trigger" bind:this={trigger} role="combobox" aria-haspopup="listbox" aria-expanded={open}
    aria-controls={open ? listId : undefined} aria-activedescendant={open ? optionId(active) : undefined} aria-label={label || undefined}
    aria-describedby={describedby} {title} onclick={() => (open ? close() : show())} onkeydown={keys}>
    <span class="pick-value" class:pick-none={!value}>{value || emptyLabel}</span>
    <Icon name="chevronDown" size={13} />
  </button>
{/if}

{#if open && trigger}
  <FloatingMenu anchor={trigger} below width={Math.max(trigger.offsetWidth || 0, 200)} role="presentation" onclose={close}>
    {#if query}<p class="fm-note pick-query"><Icon name="search" size={11} /><span>{query}</span></p>{/if}
    <ul class="pick-list" id={listId} role="listbox" aria-label={label || undefined}>
      {#each entries as entry, index (entry.fresh ? '\n new' : entry.none ? '\n none' : entry.value)}
        {#if entry.fresh && index > 0}<li class="fm-sep" role="presentation"></li>{/if}
        <!-- the button keeps the focus and the keys: an option is pressed by the pointer only -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li id={optionId(index)} role="option" class="fm-item" class:pick-active={index === active} class:pick-fresh={entry.fresh}
          class:pick-none={entry.none} aria-selected={isOn(entry)} onclick={() => pick(entry)} onpointermove={() => (active = index)}>
          {#if entry.fresh}<Icon name="plus" size={12} />{/if}
          <span class="fm-grow">{entry.text}</span>
          {#if isOn(entry)}<span class="fm-tick"><Icon name="check" size={12} /></span>{/if}
        </li>
      {/each}
    </ul>
  </FloatingMenu>
{/if}

<style>
  .pick-trigger { display: flex; align-items: center; gap: 8px; min-width: 0; text-align: left; cursor: pointer; }
  .pick-trigger:hover { border-color: var(--border-strong); }
  .pick-trigger[aria-expanded='true'] { border-color: var(--accent); }
  .pick-trigger > :global(svg) { flex: none; color: var(--text-3); }
  .pick-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick-value.pick-none { color: var(--text-3); }
  .pick-list { list-style: none; margin: 0; padding: 0; }
  .pick-list .fm-item.pick-active { background: var(--bg-3); }
  .pick-list .fm-item.pick-none { color: var(--text-2); }
  .pick-list .fm-item.pick-fresh { color: var(--accent); }
  .pick-list .fm-item.pick-fresh > :global(svg) { color: inherit; }
  .pick-query { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
  .pick-query span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
</style>
