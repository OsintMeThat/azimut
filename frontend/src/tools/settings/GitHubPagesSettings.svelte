<script>
  /**
   * Settings › Publishing › GitHub Pages: the repository a note's web folder is
   * published to in one press, from the export dialog.
   *
   * The account, the repository and the branch save when a field is left; the token
   * goes up once when typed and never comes back, only whether one is kept and its
   * last four characters (`lib/githubPages.js`). Nothing here reaches GitHub but its
   * presses: Test connection, then Create the repository or Turn on Pages when the
   * test found them missing (`components/GitHubSetupPress.svelte`). The steps are the
   * export dialog's too (`lib/githubPagesSetup.js`), open while something is missing.
   */
  import Icon from '../../components/Icon.svelte';
  import GitHubSetupPress from '../../components/GitHubSetupPress.svelte';
  import { toast } from '../../lib/state.svelte.js';
  import { PUBLISHING_HELP as HELP } from '../../lib/publishingHelp.js';
  import { forgetGitHub, readGitHub, saveGitHub, testGitHub } from '../../lib/githubPages.js';
  import {
    DEFAULT_BRANCH, DEFAULT_REPO, GITHUB_FIELDS, GITHUB_FREE, PAGES_BY_HAND, PAGES_PUBLIC, PAGES_SIGNUP, PAGES_STEPS, TOKEN_MORE,
    TOKEN_STEPS, githubReady, tokenLink,
  } from '../../lib/githubPagesSetup.js';

  let state = $state(null);
  let account = $state('');
  let repo = $state('');
  let branch = $state('');
  let token = $state('');
  let saving = $state(false);
  // what Test connection said: null, 'testing', or { ok, text, warnings, needs, detail }
  let tested = $state(null);

  const ready = $derived(githubReady(state));
  const hint = (key) => GITHUB_FIELDS.find(([name]) => name === key)?.[1] ?? '';
  // the repository steps the web folder's how-to gives, word for word: sign up, then make it
  const repositorySteps = PAGES_STEPS.slice(0, 2);

  $effect(() => {
    let live = true;
    readGitHub()
      .then((value) => { if (live) take(value); })
      .catch((error) => {
        if (!live) return;
        take({ account: '', repo: DEFAULT_REPO, branch: DEFAULT_BRANCH, site: '', base: '', token: { set: false, hint: '' } });
        toast(`Could not read the GitHub settings: ${error.message}`, 'warn');
      });
    return () => { live = false; };
  });

  function take(value) {
    state = value;
    account = value.account;
    repo = value.repo;
    branch = value.branch;
  }

  /** One field saved; what the server keeps is what the field shows after. */
  async function save(patch) {
    saving = true;
    tested = null;
    try {
      take(await saveGitHub(patch));
      return true;
    } catch (error) {
      toast(error.message, 'danger', 6000);
      if (state) take(state);
      return false;
    } finally {
      saving = false;
    }
  }

  function saveField(key, value) {
    const typed = value.trim();
    if (typed !== (state?.[key] ?? '')) void save({ [key]: typed });
  }

  async function saveToken() {
    const typed = token.trim();
    if (!typed) return;
    if (await save({ token: typed })) {
      token = '';
      toast('Token kept on this computer', 'ok');
    }
  }

  async function test() {
    tested = 'testing';
    try {
      const answer = await testGitHub();
      const who = answer.login ? `Signed in as ${answer.login}. ` : '';
      tested = answer.ok
        ? { ok: true, text: `${who}${state.account}/${state.repo} is served at ${answer.base}`, warnings: answer.warnings ?? [] }
        : { ok: false, text: `${who}${answer.detail || 'GitHub did not answer as expected.'}`, needs: answer.needs ?? '', detail: answer.detail ?? '', warnings: [] };
      if (answer.base) state = { ...state, site: answer.base, base: answer.base };
    } catch (error) {
      tested = { ok: false, text: error.message, warnings: [] };
    }
  }

  async function forget() {
    try {
      take(await forgetGitHub());
      token = '';
      tested = null;
      toast('GitHub forgotten on this computer', 'ok');
    } catch (error) {
      toast(error.message, 'danger');
    }
  }
</script>

<section class="group github" data-guide="settings.github" aria-label="GitHub Pages">
  <h3>GitHub Pages</h3>
  <p class="intro">Publish a note's web folder to your own GitHub Pages site in one press, from the export dialog. You get an address to share on X.</p>
  <label class="row" title={HELP.githubAccount}>
    <span class="row-label"><span>Account</span><span class="row-hint">{hint('Account')}</span></span>
    <input class="input wide" bind:value={account} onchange={() => saveField('account', account)} placeholder="your-name"
      spellcheck="false" autocomplete="username" disabled={state === null} title={HELP.githubAccount} />
  </label>
  <label class="row" title={HELP.githubRepo}>
    <span class="row-label"><span>Repository</span><span class="row-hint">{hint('Repository')}</span></span>
    <input class="input wide" bind:value={repo} onchange={() => saveField('repo', repo)} placeholder={DEFAULT_REPO}
      spellcheck="false" autocomplete="off" disabled={state === null} title={HELP.githubRepo} />
  </label>
  <label class="row" title={HELP.githubBranch}>
    <span class="row-label"><span>Branch</span><span class="row-hint">{hint('Branch')}</span></span>
    <input class="input wide" bind:value={branch} onchange={() => saveField('branch', branch)} placeholder={DEFAULT_BRANCH}
      spellcheck="false" autocomplete="off" disabled={state === null} title={HELP.githubBranch} />
  </label>
  <label class="row" title={HELP.githubToken}>
    <span class="row-label">
      <span>Token</span>
      <span class="row-hint">
        {#if state?.token.set}Kept on this computer{state.token.hint ? `, ending ${state.token.hint.replace('…', '')}` : ''}. Paste a new one to replace it.
        {:else}A fine-grained token for that one repository. Kept on this computer only, never in a backup.{/if}
      </span>
    </span>
    <input class="input wide mono" type="password" bind:value={token} onchange={saveToken}
      placeholder={state?.token.set ? `github_pat_•••• ${state.token.hint.replace('…', '')}` : 'github_pat_…'}
      autocomplete="new-password" spellcheck="false" disabled={state === null} title={HELP.githubToken} />
  </label>
  <div class="row actions">
    <span class="said" role="status" data-state={tested === 'testing' ? 'testing' : tested?.ok ? 'ok' : tested ? 'error' : ''}>
      {#if tested === 'testing'}Asking GitHub about {state.account}/{state.repo}…
      {:else if tested}<Icon name={tested.ok ? 'check' : 'alert'} size={12} /> {tested.text}
      {:else if ready}<span>Articles go to {state.base}<em>short-name</em>/</span>{/if}
    </span>
    <button class="btn btn-sm" onclick={test} disabled={!ready || saving || tested === 'testing'} title={HELP.githubTest}>
      Test connection</button>
    <button class="btn btn-ghost btn-sm" onclick={forget} disabled={!state || (!state.account && !state.token.set)}
      title={HELP.githubForget}>Forget</button>
  </div>
  {#if tested?.warnings?.length}
    <ul class="warnings" aria-label="To mind">
      {#each tested.warnings as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
    </ul>
  {/if}
  {#if tested?.needs}
    <GitHubSetupPress needs={tested.needs} github={state} detail={tested.detail} ondone={test} />
  {/if}
  {#if state}
    <details class="how" open={!ready}>
      <summary title={HELP.githubHow}>How to set up GitHub Pages</summary>
      <p class="note-line">{GITHUB_FREE}</p>
      <p class="note-line public">{PAGES_PUBLIC}</p>
      <h4>The repository</h4>
      <ol>
        {#each repositorySteps as step, index (index)}
          <li>{step}{#if index === 0}{' '}<a href={PAGES_SIGNUP} target="_blank" rel="noopener noreferrer" title={HELP.githubSignup}>Sign up</a>{/if}</li>
        {/each}
      </ol>
      <h4>The token</h4>
      <ol>{#each TOKEN_STEPS as step, index (index)}<li>{step}</li>{/each}</ol>
      <a class="guide" href={tokenLink(state.account)} target="_blank" rel="noopener noreferrer" title={HELP.githubTokenPage}>
        Make the token on github.com <Icon name="external" size={11} /></a>
      <p class="note-line">{TOKEN_MORE}</p>
      <h4>Pages</h4>
      <p class="note-line">Press Test connection, then Turn on Pages if it is off.</p>
      <p class="note-line">{PAGES_BY_HAND}</p>
      <dl>
        {#each GITHUB_FIELDS as [name, said] (name)}<dt>{name}</dt><dd>{said}</dd>{/each}
      </dl>
    </details>
  {/if}
</section>

<style>
  .wide { width: 300px; flex-shrink: 0; }
  .mono { font-family: var(--font-mono); }
  label.row { cursor: default; }
  .actions { justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .said { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 5px; color: var(--text-3); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .said em { font-style: normal; color: var(--text-2); }
  .said[data-state='ok'] { color: var(--ok); }
  .said[data-state='error'] { color: var(--danger); }
  .warnings { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; color: var(--warn); font-size: var(--fs-xs); }
  .warnings li { display: flex; align-items: center; gap: 5px; }
  .github :global(.needs) { margin-top: 8px; }
  .how { margin-top: 10px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px 12px 10px; background: var(--bg-1); }
  .how summary { cursor: pointer; color: var(--text-2); font-size: var(--fs-sm); padding: 2px 0; }
  .how h4 { margin: 10px 0 2px; color: var(--text-1); font-size: var(--fs-xs); font-weight: 600; }
  .how ol { margin: 2px 0 4px; padding-left: 20px; display: flex; flex-direction: column; gap: 3px; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .note-line { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .note-line.public { color: var(--warn); }
  .how dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 10px 0 2px; font-size: var(--fs-xs); }
  .how dt { color: var(--text-1); font-weight: 600; }
  .how dd { margin: 0; color: var(--text-2); line-height: 1.5; }
  .guide { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; font-size: var(--fs-xs); color: var(--accent); }
</style>
