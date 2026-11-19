<script>
  /**
   * The files a note was exported as, PDFs, HTML pages and web folders, newest first:
   * the day, the format, the edition, a PDF's pages and the file's name, a web folder's
   * address. Show opens the folder it was written to (a web folder itself); Check
   * hashes the file again (a web folder's page) and says whether it is still the one
   * Azimut wrote. Nothing is fetched.
   *
   * **What changed** compares two public texts the note kept, or one and the note now
   * (`lib/notes/editionCompare.js`): each figure that changed in a sentence, then the
   * words, paragraph by paragraph. **Write the correction from this** drafts the What
   * changed line of the next export, which the analyst edits; `onexport` then opens the
   * export dialog on it. Nothing is published from here.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import { siteHost } from '../../lib/wordpressSetup.js';
  import {
    CHECK_SAID, CHECK_SAID_PAGE, MAX_CORRECTION, PUBLIC, checkEdition, correctionFor, editionDay, keepCorrection,
    readEditions, showEdition,
  } from '../../lib/notes/editions.svelte.js';
  import {
    NOW, compareEditions, draftCorrection, firstPair, paragraphPlace, textChoices,
  } from '../../lib/notes/editionCompare.js';

  let { caseId, noteId, title = '', onclose = () => {}, onexport = null } = $props();

  /** The icon a figure's sentence is marked with, by its kind. */
  const KIND_ICONS = { chart: 'chart', table: 'table', picture: 'image', map: 'globe', infographic: 'grid', diagram: 'graph', link: 'link' };

  const FORMAT_BADGES = { pdf: 'PDF', html: 'HTML', web: 'Web', github: 'GitHub' };

  let editions = $state(null);
  let failed = $state('');
  /** What Check said, by edition: `checking`, or the state the server answered. */
  let checked = $state({});
  let showing = $state('');
  /** The public texts kept for What changed, by SHA-256, newest first. */
  let kept = $state([]);
  /** The list, or What changed between `before` and `after`. */
  let comparing = $state(false);
  let before = $state('');
  let after = $state(NOW);
  /** What the server said: null while it is asked, the comparison, or { error }. */
  let comparison = $state(null);
  /** The What changed line being written from it, once Write the correction is pressed. */
  let line = $state(null);
  let asked = 0;

  const keyOf = (edition) => `${edition.at}|${edition.file}|${edition.post ?? ''}`;
  const choices = $derived(editions ? textChoices(editions, kept) : []);
  const labelOf = (sha) => (sha === NOW ? 'the note now' : choices.find((choice) => choice.sha === sha)?.label ?? '');

  $effect(() => {
    const id = caseId;
    const note = noteId;
    let live = true;
    untrack(() => {
      editions = null;
      failed = '';
      checked = {};
      kept = [];
      comparing = false;
    });
    readEditions(id, note)
      .then((read) => {
        if (!live) return;
        editions = read.editions;
        kept = read.kept;
        ({ before, after } = firstPair(textChoices(read.editions, read.kept)));
      })
      .catch((error) => { if (live) { editions = []; failed = error.message; } });
    return () => { live = false; };
  });

  async function compare() {
    if (!before || before === after) return;
    const ask = ++asked;
    comparing = true;
    comparison = null;
    line = null;
    try {
      const answer = await compareEditions(caseId, noteId, before, after);
      if (ask === asked) comparison = answer ?? { error: 'The answer could not be read' };
    } catch (error) {
      if (ask === asked) comparison = { error: error.message };
    }
  }

  function back() {
    asked += 1;
    comparing = false;
    comparison = null;
    line = null;
  }

  /** Draft the line from what changed, over any line kept for this note before. */
  function writeCorrection() {
    line = draftCorrection(comparison) || correctionFor(caseId, noteId);
  }

  function useLine() {
    keepCorrection(caseId, noteId, line);
    onexport?.();
  }

  async function check(edition) {
    const key = keyOf(edition);
    checked[key] = 'checking';
    try {
      checked[key] = await checkEdition(caseId, noteId, edition);
    } catch (error) {
      checked[key] = { error: error.message };
    }
  }

  async function show(edition) {
    showing = keyOf(edition);
    try {
      await showEdition(caseId, noteId, edition);
    } catch (error) {
      checked[keyOf(edition)] = { error: error.message };
    } finally {
      showing = '';
    }
  }
</script>

<Modal title={comparing ? 'What changed' : 'Editions'} {onclose} width={comparing ? '720px' : '700px'}>
  {#if comparing}
    <div class="between">
      <button type="button" class="btn btn-ghost btn-xs" title="Back to every edition of this note" onclick={back}>‹ Editions</button>
      <p>From <strong>{labelOf(before)}</strong> to <strong>{labelOf(after)}</strong></p>
    </div>
    {#if comparison === null}
      <p class="quiet" role="status">Comparing…</p>
    {:else if comparison.error}
      <p class="quiet error" role="alert"><Icon name="alert" size={12} /> Could not compare them: {comparison.error}</p>
    {:else if comparison.same}
      <p class="quiet" role="status"><Icon name="check" size={12} /> Nothing changed: the two texts are the same.</p>
    {:else}
      {#if comparison.sentences.length}
        <section class="part" aria-labelledby="changed-figures">
          <h4 id="changed-figures" class="part-head">{comparison.sentences.some((item) => item.kind === 'link') ? 'Figures and links' : 'Figures'}</h4>
          <ul class="sentences">
            {#each comparison.sentences as sentence, index (index)}
              <li data-kind={sentence.kind}><Icon name={KIND_ICONS[sentence.kind] ?? 'info'} size={13} /><span>{sentence.said}</span></li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if comparison.paragraphs.length}
        <section class="part" aria-labelledby="changed-words">
          <h4 id="changed-words" class="part-head">Words</h4>
          {#each comparison.paragraphs as paragraph, index (index)}
            <article class="para" data-state={paragraph.state}>
              <p class="place">{paragraphPlace(paragraph)}</p>
              <p class="words" class:heading={paragraph.heading}>{#each paragraph.parts as part, at (at)}{#if part.op === '+'}<ins>{part.text}</ins>{:else if part.op === '-'}<del>{part.text}</del>{:else}<span>{part.text}</span>{/if}{' '}{/each}</p>
            </article>
          {/each}
        </section>
      {/if}
      <p class="quiet tally">{comparison.unchanged} paragraph{comparison.unchanged === 1 ? '' : 's'} unchanged{comparison.more ? `, ${comparison.more} more change${comparison.more === 1 ? '' : 's'} not listed` : ''}.</p>
      {#if line !== null}
        <div class="correction">
          <label class="part-head" for="correction-line">What changed, for the next export</label>
          <textarea id="correction-line" class="input" rows="3" maxlength={MAX_CORRECTION} bind:value={line}></textarea>
          <p class="hint"><span class="count">{line.length}/{MAX_CORRECTION}</span> Goes in the What changed line of your next HTML page or web folder, where you can still change it.</p>
        </div>
      {/if}
    {/if}
  {:else}
  <p class="lead">{title ? `Every PDF, HTML page, web folder, WordPress draft and published page of “${title}”, newest first.` : 'Every PDF, HTML page, web folder, WordPress draft and published page of this note, newest first.'} Each one stays where it was written.</p>
  {#if editions === null}
    <p class="quiet" role="status">Reading…</p>
  {:else if failed}
    <p class="quiet error" role="alert"><Icon name="alert" size={12} /> Could not read the editions: {failed}</p>
  {:else if !editions.length}
    <p class="quiet">Nothing exported yet. Each export is listed here.</p>
  {:else}
    {#if choices.length}
      <section class="compare" aria-label="What changed">
        <p class="compare-head"><strong>What changed</strong> between two public editions, or one and the note now</p>
        <div class="compare-row">
          <label class="pick">From
            <select class="input" bind:value={before} title="A public edition: its number, when it was exported and as what">
              {#each choices as choice (choice.sha)}<option value={choice.sha}>{choice.label}</option>{/each}
            </select></label>
          <label class="pick">to
            <select class="input" bind:value={after} title="Another public edition, or the note as it would print now">
              <option value={NOW}>The note now</option>
              {#each choices as choice (choice.sha)}<option value={choice.sha}>{choice.label}</option>{/each}
            </select></label>
          <button type="button" class="btn btn-primary btn-xs" disabled={!before || before === after} onclick={compare}
            title="Every figure and paragraph that changed between the two">Compare</button>
        </div>
      </section>
    {/if}
    <ul class="list" aria-label="Editions">
      {#each editions as edition (keyOf(edition))}
        {@const state = checked[keyOf(edition)]}
        <li class="row">
          {#if edition.format === 'wordpress'}
            <!-- a WordPress draft is no file: its site, and Open in WordPress in place of Show and Check -->
            <div class="what">
              <div class="head">
                <span class="day">{editionDay(edition.at)}</span>
                <span class="badge format" data-format="wordpress">WordPress</span>
                <span class="badge edition">Public</span>
              </div>
              <span class="file">Draft on {siteHost(edition.site)}</span>
            </div>
            <a class="btn btn-ghost btn-xs" href={edition.edit} target="_blank" rel="noopener noreferrer"
              title="The draft in WordPress's editor; it may have been published since">Open in WordPress</a>
          {:else if edition.format === 'github'}
            <!-- a page on GitHub Pages: its address, and Open and Check, which reads it back from the repository -->
            <div class="what">
              <div class="head">
                <span class="day">{editionDay(edition.at)}</span>
                <span class="badge format" data-format="github">GitHub</span>
                <span class="badge edition">Public</span>
              </div>
              <span class="file mono" title={edition.pdf_sha256 ? `SHA-256 ${edition.pdf_sha256}` : edition.address}>{edition.address}</span>
              <span class="file" title="The repository and the commit it was published in">{edition.repository} · {edition.commit.slice(0, 7)}</span>
              {#if state === 'checking'}
                <span class="said" role="status">Checking…</span>
              {:else if typeof state === 'string'}
                <span class="said" data-state={state} role="status">
                  <Icon name={state === 'unchanged' ? 'check' : 'alert'} size={12} /> {CHECK_SAID_PAGE[state]}</span>
              {:else if state?.error}
                <span class="said" data-state="error" role="status"><Icon name="alert" size={12} /> {state.error}</span>
              {/if}
            </div>
            <a class="btn btn-ghost btn-xs" href={edition.address} target="_blank" rel="noopener noreferrer"
              title="The page at its address, in a new tab">Open</a>
            <button type="button" class="btn btn-ghost btn-xs" title="Read the page back from the repository and compare it with what Azimut published"
              disabled={state === 'checking'} onclick={() => check(edition)}>Check</button>
          {:else}
          <div class="what">
            <div class="head">
              <span class="day">{editionDay(edition.at)}</span>
              <span class="badge format" data-format={edition.format}>{FORMAT_BADGES[edition.format] ?? 'PDF'}</span>
              <span class="badge edition" class:internal={edition.edition !== PUBLIC}>{edition.edition === PUBLIC ? 'Public' : 'Internal'}</span>
              {#if edition.format === 'pdf'}<span class="pages">{edition.pages} page{edition.pages === 1 ? '' : 's'}</span>{/if}
            </div>
            <span class="file mono" title={edition.pdf_sha256 ? `SHA-256 ${edition.pdf_sha256}` : edition.file}>{edition.file}</span>
            {#if edition.address}<span class="file mono" title="The address it was made for">{edition.address}</span>{/if}
            {#if state === 'checking'}
              <span class="said" role="status">Checking…</span>
            {:else if typeof state === 'string'}
              <span class="said" data-state={state} role="status">
                <Icon name={state === 'unchanged' ? 'check' : 'alert'} size={12} /> {CHECK_SAID[state]}</span>
            {:else if state?.error}
              <span class="said" data-state="error" role="status"><Icon name="alert" size={12} /> {state.error}</span>
            {/if}
          </div>
          <button type="button" class="btn btn-ghost btn-xs" title="Open the folder it was written to" disabled={showing === keyOf(edition)}
            onclick={() => show(edition)}>Show</button>
          <button type="button" class="btn btn-ghost btn-xs" title="Read the file again and compare it with what Azimut wrote"
            disabled={state === 'checking'} onclick={() => check(edition)}>Check</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {/if}
  <div class="actions">
    {#if comparing && comparison && !comparison.error && !comparison.same}
      {#if line === null}
        <button type="button" class="btn" onclick={writeCorrection}
          title="Draft the What changed line of the next export from this comparison">Write the correction from this</button>
      {:else if onexport}
        <button type="button" class="btn btn-primary" disabled={!line.trim()} onclick={useLine}
          title="Open the export with this line in What changed; nothing is written before you export">Export with this line…</button>
      {/if}
    {/if}
    <span class="grow"></span>
    <button type="button" class="btn" onclick={onclose}>Close</button>
  </div>
</Modal>

<style>
  .lead { margin: 0 0 10px; color: var(--text-2); font-size: var(--fs-sm); }
  .quiet { margin: 6px 0; color: var(--text-3); font-size: var(--fs-sm); display: flex; align-items: center; gap: 6px; }
  .quiet.error { color: var(--danger); }
  .list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: var(--r-md); }
  .row { display: flex; align-items: center; gap: 6px; padding: 7px 8px 7px 10px; border-top: 1px solid var(--border); }
  .row:first-child { border-top: none; }
  .what { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .head { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--text-1); }
  .pages { color: var(--text-3); font-size: var(--fs-xs); }
  .edition { color: var(--text-2); }
  .format { color: var(--text-2); font-family: var(--font-mono); letter-spacing: .02em; }
  .format[data-format='html'], .format[data-format='web'] { color: var(--accent); }
  .edition.internal { background: color-mix(in srgb, var(--internal) 16%, transparent); color: var(--internal); }
  .file { color: var(--text-3); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .said { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-xs); color: var(--text-2); }
  .said[data-state='unchanged'] { color: var(--ok); }
  .said[data-state='changed'], .said[data-state='error'] { color: var(--danger); }
  .said[data-state='missing'] { color: var(--warn); }
  .mono { font-family: var(--font-mono); }
  .actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .actions .grow { flex: 1; }
  .compare { display: flex; flex-direction: column; gap: 7px; margin: 0 0 10px; padding: 8px 10px 9px;
    border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-2); font-size: var(--fs-sm); }
  .compare-head { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .compare-head strong { color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; margin-right: 4px; }
  .compare-row { display: flex; align-items: center; gap: 10px; }
  .pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--text-2); }
  .pick select { flex: 1; min-width: 0; padding-block: 3px; font-size: var(--fs-sm); }
  .between { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; font-size: var(--fs-sm); color: var(--text-2); }
  .between p { margin: 0; }
  .between strong { color: var(--text-1); font-weight: 600; }
  .part { margin: 0 0 14px; }
  .part-head { display: block; margin: 0 0 6px; font-size: var(--fs-xs); font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--text-3); }
  .sentences { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .sentences li { display: flex; align-items: flex-start; gap: 8px; padding: 7px 10px; border-radius: var(--r-md);
    background: var(--bg-2); color: var(--text-1); font-size: var(--fs-sm); line-height: 1.45; }
  .sentences li :global(svg) { flex: none; margin-top: 2px; color: var(--accent); }
  .para { padding: 8px 10px; border-left: 3px solid var(--border-strong); margin: 0 0 8px; background: var(--bg-2);
    border-radius: 0 var(--r-md) var(--r-md) 0; }
  .para[data-state='added'] { border-left-color: var(--ok); }
  .para[data-state='removed'] { border-left-color: var(--danger); }
  .place { margin: 0 0 3px; font-size: var(--fs-xs); color: var(--text-3); }
  .words { margin: 0; font-size: var(--fs-sm); line-height: 1.55; color: var(--text-2); overflow-wrap: anywhere; }
  .words.heading { font-weight: 600; color: var(--text-1); }
  .words ins { text-decoration: none; color: var(--text-1); background: color-mix(in srgb, var(--ok) 22%, transparent);
    border-radius: 3px; padding: 0 2px; }
  .words del { color: var(--text-2); background: color-mix(in srgb, var(--danger) 16%, transparent);
    text-decoration-color: color-mix(in srgb, var(--danger) 70%, transparent); border-radius: 3px; padding: 0 2px; }
  .tally { margin-top: 0; }
  .correction { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
  .correction textarea { width: 100%; resize: vertical; font-size: var(--fs-sm); line-height: 1.45; }
  .hint { margin: 6px 0 0; font-size: var(--fs-xs); color: var(--text-3); }
  .hint .count { font-variant-numeric: tabular-nums; margin-right: 6px; }
  .format[data-format='wordpress'], .format[data-format='github'] { color: var(--accent); }
</style>
