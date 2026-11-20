<script>
  /**
   * Ready to publish?: what the check before export says of one note, in one panel
   * (`lib/notes/readyPanel.js`). Five groups in a reader's order, Words, Sources,
   * Figures, Edition, Weight and reach; each line its words, Go to where it names a
   * line, and its own fix where one exists. A group with nothing to look at says so.
   *
   * It reads only. A fix is pressed here and done by the Notebook with the action that
   * exists elsewhere (`onfix`), after which the check is asked again; Undo takes back
   * one that edited the note.
   *
   * Without the app's `tools` around the note (the extension's panel), nothing exports
   * there: the foot opens the note in Azimut instead (`onexport`), and the fixes only the
   * Notebook can do are left out (`readyLines`).
   */
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import LinkList from './LinkList.svelte';
  import { GROUPS, checkedWords, issueCount, readyLines } from '../../lib/notes/readyPanel.js';

  let {
    /** The note's name, under the title. */
    title = '',
    /** What the check said (`readReady`), null while it is first asked. */
    ready = null,
    checking = false,
    failed = '',
    /** Whether the note is open in the editor, so a fix can write in it. */
    canEdit = false,
    /** Whether the export rounds the points of view. */
    rounded = false,
    /** The line whose fix is under way, by its key. */
    busy = '',
    /** Opened from the export dialog: its foot goes back there. */
    fromExport = false,
    /** Whether the app's tools are around the note; without them the foot opens it in Azimut to export. */
    tools = true,
    onfix = () => {},
    ongo = () => {},
    onclose = () => {},
    onexport = () => {},
  } = $props();

  const groups = $derived(readyLines(ready, { canEdit, rounded, tools }));
  const issues = $derived(issueCount(groups));
</script>

<Modal title="Ready to publish?" {onclose} width="620px" align="top">
  <div class="ready" aria-busy={checking}>
    <p class="said" role="status">
      {#if !ready && checking}Checking “{title}”…
      {:else if !ready}{failed ? `The check could not be read: ${failed}` : 'Nothing was checked.'}
      {:else}<span class="title" dir="auto">{title}</span> · {checkedWords(ready)}
        {issues ? `${issues} to look at.` : 'Nothing to look at.'}{#if checking}<span class="again"> Checking again…</span>{/if}{/if}
    </p>
    {#if ready}
      <div class="groups">
        {#each GROUPS as group (group.id)}
          {@const lines = groups[group.id]}
          {@const open = lines.filter((line) => line.issue).length}
          <section class="group" aria-labelledby={`ready-${group.id}`} data-group={group.id}>
            <h4 id={`ready-${group.id}`} class="group-head">{group.label}
              {#if open}<span class="count" aria-label={`${open} to look at`}>{open}</span>{/if}</h4>
            {#if !lines.length}
              <p class="clear"><Icon name="check" size={12} /> Nothing to look at.</p>
            {:else}
              <ul class="lines" aria-label={group.label}>
                {#each lines as line (line.key)}
                  <li class="line" class:info={!line.issue} data-kind={line.kind}>
                    <span class="words" dir="auto" id={`ready-line-${line.key}`}>{line.text}</span>
                    {#if Number.isInteger(line.line)}
                      <button type="button" class="btn btn-ghost btn-xs" title="Open the note at this line"
                        aria-describedby={`ready-line-${line.key}`} onclick={() => ongo(line)}>Go to</button>
                    {/if}
                    {#if line.fix}
                      <button type="button" class="btn btn-xs fix" title={line.fix.title} disabled={Boolean(busy)}
                        aria-describedby={`ready-line-${line.key}`} onclick={() => onfix(line)}>
                        {busy === line.key ? 'Working…' : line.fix.label}</button>
                    {/if}
                    {#if line.items?.length}
                      <LinkList items={line.items} label={line.text} ongo={(at) => ongo({ ...line, line: at })} />
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  </div>
  <div class="foot">
    <span class="note">Nothing changes until you press a fix; Undo takes back one that wrote in the note.</span>
    {#if fromExport}
      <button type="button" class="btn btn-primary" onclick={onclose}>Back to the export</button>
    {:else if !tools}
      <button type="button" class="btn btn-primary" onclick={onexport} title="Open this note in Azimut, in a tab, to export it">
        <Icon name="external" size={14} /> Open in Azimut</button>
    {:else}
      <button type="button" class="btn btn-primary" onclick={onexport} title="Export this note as a PDF, an HTML page or a web folder">
        <Icon name="download" size={14} /> Export…</button>
    {/if}
  </div>
</Modal>

<style>
  .ready { display: flex; flex-direction: column; gap: 10px; font-size: var(--fs-sm); }
  .said { margin: 0; color: var(--text-2); }
  .said .title { color: var(--text-1); font-weight: 600; }
  .again { color: var(--text-3); }
  .groups { display: flex; flex-direction: column; gap: 6px; max-height: min(62vh, 620px); overflow: auto; padding-right: 2px; }
  .group { border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-1); padding: 6px 10px 6px; }
  .group-head {
    display: flex; align-items: center; gap: 6px; margin: 0 0 2px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600;
    text-transform: uppercase; letter-spacing: .05em;
  }
  .count {
    min-width: 16px; padding: 0 5px; border-radius: 8px; background: color-mix(in srgb, var(--warn) 18%, transparent);
    color: var(--text-1); font-size: 10.5px; line-height: 16px; text-align: center; letter-spacing: 0;
  }
  .clear { display: flex; align-items: center; gap: 5px; margin: 2px 0; color: var(--text-3); font-size: var(--fs-xs); }
  .clear :global(svg) { color: var(--ok); }
  .lines { list-style: none; margin: 0; padding: 0; }
  .line { display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; min-height: 26px; color: var(--text-1); }
  .line::before { content: ''; flex: none; width: 5px; height: 5px; border-radius: 50%; background: color-mix(in srgb, var(--warn) 70%, var(--text-3)); }
  .line.info { color: var(--text-2); }
  .line.info::before { background: var(--text-3); opacity: .6; }
  .words { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .line .btn { flex: none; }
  .foot { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .note { flex: 1; min-width: 0; color: var(--text-3); font-size: var(--fs-xs); }
</style>
