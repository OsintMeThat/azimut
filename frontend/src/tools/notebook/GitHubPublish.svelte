<script>
  /**
   * The export dialog's Web folder branch, for GitHub Pages: the address the page will
   * live at, made of the site's address and a short name the analyst can change, and
   * what Publish to GitHub Pages found before it could publish.
   *
   * The site's address comes from Settings (`lib/githubPages.js`), read on this machine:
   * the address Pages last said it has, else `https://<account>.github.io/<repo>/`. The
   * short name starts as the last part of the address this note was last given, else
   * its title, and the whole address is handed up (`address`), so Export web folder
   * writes the same page Publish puts online. Only the dialog's Publish button reaches
   * GitHub, through `publish()`. When the repository is missing or Pages is off, the
   * press that sets it up shows here (`components/GitHubSetupPress.svelte`); while
   * GitHub is not set up, a Publish shows the way to Settings › Publishing.
   */
  import Icon from '../../components/Icon.svelte';
  import GitHubSetupPress from '../../components/GitHubSetupPress.svelte';
  import { uiState } from '../../lib/state.svelte.js';
  import { publishNote, readGitHub } from '../../lib/githubPages.js';
  import {
    GITHUB_FREE, MAX_SHORT, PAGES_PUBLIC, githubReady, shortNameFrom, shortNameOf, shortNameProblem,
  } from '../../lib/githubPagesSetup.js';

  let {
    caseId,
    noteId,
    /** The note's title, which a first short name is made from. */
    title = '',
    /** The address the page will live at, handed up to the dialog. */
    address = $bindable(''),
    /** Whether GitHub Pages is set up in Settings. */
    connected = $bindable(false),
    /** What is wrong with the short name, or ''. */
    problem = $bindable(''),
    busy = $bindable(false),
    /** Writes what the editor still holds, before the note is read from disk. */
    prepare = async () => {},
    /** Called with each address typed, to keep it for this note. */
    onaddress = () => {},
    /** Called when the analyst leaves the dialog for Settings. */
    onleave = () => {},
  } = $props();

  let github = $state(null);
  let short = $state('');
  let typed = false;
  // what Publish found missing: { needs, detail }, then what the press made of it
  let needs = $state(null);
  let setUp = $state('');
  let failed = $state('');
  let setupShown = $state(false);

  // a branch opened afresh has published nothing yet
  busy = false;

  $effect(() => {
    let live = true;
    readGitHub().then((value) => { if (live) github = value; }).catch(() => { if (live) github = null; });
    return () => { live = false; };
  });

  const base = $derived(github?.base ?? '');
  // read here, and handed up: the dialog's own copies may not be reactive
  const ready = $derived(githubReady(github));
  const wrong = $derived(ready ? shortNameProblem(short) : '');
  $effect(() => { connected = ready; });
  $effect(() => { problem = wrong; });

  // the short name: the one this note's address ends on, else its title, until typed
  $effect(() => {
    if (!ready || typed) return;
    const from = shortNameFrom(address);
    if (from) {
      if (from !== short) short = from;
    } else if (!short) {
      short = shortNameOf(title);
    }
  });

  // the whole address, handed up for the export and the check
  $effect(() => {
    if (!ready || !base || !short) return;
    const whole = `${base}${short}/`;
    if (whole !== address) address = whole;
  });

  function type(value) {
    typed = true;
    short = value.trim().toLowerCase();
    needs = null;
    failed = '';
    if (!shortNameProblem(short)) onaddress(`${base}${short}/`);
  }

  /**
   * Publish the note to GitHub Pages; the dialog's button calls this. Answers what
   * GitHub said once published, or null when it was not.
   */
  export async function publish({ roundPov = false, changes = '', offlineMaps = false } = {}) {
    if (busy) return null;
    if (!ready) {
      setupShown = true;
      return null;
    }
    if (wrong) return null;
    busy = true;
    failed = '';
    needs = null;
    setUp = '';
    try {
      await prepare();
      onaddress(address);
      const answer = await publishNote(caseId, noteId, { shortName: short, roundPov, changes, offlineMaps });
      if (answer?.published) return answer;
      needs = { needs: answer?.needs === 'repository' ? 'repository' : 'pages', detail: String(answer?.detail ?? '') };
      return null;
    } catch (error) {
      failed = error.message;
      return null;
    } finally {
      busy = false;
    }
  }

  /** A setup press worked: a new repository has Pages off still, then all is ready. */
  function after() {
    if (needs?.needs === 'repository') {
      needs = { needs: 'pages', detail: `The repository is made. Pages is off for ${github.account}/${github.repo}.` };
      return;
    }
    needs = null;
    setUp = 'Pages is on. Press Publish to GitHub Pages.';
  }

  function openSettings() {
    onleave();
    uiState.settingsTab = 'publishing';
    uiState.tool = 'settings';
  }
</script>

{#if ready}
  <div class="gh" aria-label="GitHub Pages">
    <label class="dest-label" for="export-short">Address it will live at</label>
    <div class="address-line" class:bad={wrong}>
      <span class="base mono" title={base}>{base}</span>
      <input id="export-short" class="input mono short" value={short} maxlength={MAX_SHORT} spellcheck="false" autocomplete="off"
        aria-label="Short name" aria-invalid={wrong ? 'true' : undefined} aria-describedby="export-short-said"
        title="The last part of the page's address: lower case, digits and hyphens"
        oninput={(event) => type(event.currentTarget.value)} />
      <span class="mono slash">/</span>
    </div>
    <p id="export-short-said" class="address-said" class:bad={wrong} role="status">
      {wrong || 'Publishing again under this short name replaces the page; GitHub keeps every earlier version.'}</p>
    {#if busy}
      <p class="sending" role="status"><span class="spinner" aria-hidden="true"></span>
        Making the folder and sending it to {github.account}/{github.repo}…</p>
    {/if}
    {#if needs}
      <GitHubSetupPress needs={needs.needs} {github} detail={needs.detail} ondone={after} />
    {/if}
    {#if setUp}<p class="set-up" role="status"><Icon name="check" size={12} /> {setUp}</p>{/if}
    {#if failed}<p class="failed" role="alert"><Icon name="alert" size={12} /> {failed}</p>{/if}
  </div>
{:else if setupShown && github !== null}
  <div class="setup" role="group" aria-label="Set up GitHub Pages">
    <p class="lead"><Icon name="info" size={13} /> Publish to your own GitHub Pages site in one press: connect GitHub once, in Settings › Publishing.</p>
    <p class="quiet">{GITHUB_FREE}</p>
    <p class="quiet">{PAGES_PUBLIC}</p>
    <button type="button" class="btn btn-sm" title="Open Settings on Publishing, where GitHub Pages is set" onclick={openSettings}>
      Open Settings › Publishing</button>
  </div>
{/if}

<style>
  .gh { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-sm); }
  .address-line { display: flex; align-items: center; min-width: 0; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); padding-left: 8px; }
  .address-line:focus-within { border-color: var(--accent); }
  .address-line.bad { border-color: var(--danger); }
  .base { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); }
  .short { flex: 1 1 140px; min-width: 100px; border: none; background: transparent; padding-left: 1px; padding-right: 2px; box-shadow: none; }
  .short:focus { outline: none; box-shadow: none; }
  .slash { padding-right: 8px; color: var(--text-3); }
  .mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
  .address-said { margin: 0; min-height: 1.2em; color: var(--text-3); font-size: var(--fs-xs); }
  .address-said.bad { color: var(--danger); }
  .gh :global(.needs) { margin-top: 6px; }
  .sending { display: flex; align-items: center; gap: 7px; margin: 4px 0 0; color: var(--text-2); font-size: var(--fs-xs); }
  .spinner { flex: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  .set-up { display: flex; align-items: center; gap: 5px; margin: 4px 0 0; color: var(--ok); font-size: var(--fs-xs); }
  .failed { display: flex; align-items: center; gap: 5px; margin: 4px 0 0; color: var(--danger); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .setup { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 8px 12px 10px; background: var(--bg-1); font-size: var(--fs-sm); }
  .setup .btn { align-self: flex-start; margin-top: 2px; }
  .lead { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); }
  .quiet { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
</style>
