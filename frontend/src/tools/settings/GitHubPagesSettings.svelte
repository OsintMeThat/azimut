<script>
  /**
   * Settings › Website › GitHub Pages: the repository a note's web folder is
   * published to in one press, from the export dialog.
   *
   * The account, the repository and the branch save when a field is left; the token
   * goes up once when typed and never comes back, only whether one is kept and its
   * last four characters (`lib/githubPages.js`). Nothing here reaches GitHub but its
   * presses, each saying so with a spinner while it waits: Test connection, then Create the repository or Turn on Pages when the
   * test found them missing (`components/GitHubSetupPress.svelte`). The steps are the
   * export dialog's too (`lib/githubPagesSetup.js`), open while something is missing. The tab
   * holding it is handed each state read (`onchange`), for Update the site to know whether it is set up.
   */
  import BusyLabel from '../../components/BusyLabel.svelte';
  import Icon from '../../components/Icon.svelte';
  import GitHubSetupPress from '../../components/GitHubSetupPress.svelte';
  import HubCard from './website/HubCard.svelte';
  import HubField from './website/HubField.svelte';
  import { toast } from '../../lib/state.svelte.js';
  import { BUSY, WEBSITE_HELP as HELP } from '../../lib/websiteSetup.js';
  import { forgetGitHub, readGitHub, saveGitHub, testGitHub } from '../../lib/githubPages.js';
  import {
    DEFAULT_BRANCH, DEFAULT_REPO, GITHUB_FIELDS, GITHUB_FREE, PAGES_BY_HAND, PAGES_PUBLIC, PAGES_SIGNUP, PAGES_STEPS, TOKEN_MORE,
    TOKEN_STEPS, githubReady, tokenLink,
  } from '../../lib/githubPagesSetup.js';

  let { onchange = () => {} } = $props();

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
    onchange(value);
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
      if (answer.base) {
        state = { ...state, site: answer.base, base: answer.base };
        onchange(state);
      }
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

<HubCard label="GitHub Pages" guide="settings.github" title="GitHub Pages">
  {#snippet aside()}
    {#if tested?.ok}<span class="hub-pill ok">Connected</span>{:else if ready}<span class="hub-pill ok">Set up</span>{:else if state}<span class="hub-pill">Not set up</span>{/if}
  {/snippet}
  <HubField id="github-account" label="Account" hint={hint('Account')}>
    <input id="github-account" class="input" bind:value={account} onchange={() => saveField('account', account)} placeholder="your-name"
      spellcheck="false" autocomplete="username" disabled={state === null} title={HELP.githubAccount} />
  </HubField>
  <HubField id="github-repo" label="Repository" hint={hint('Repository')}>
    <input id="github-repo" class="input" bind:value={repo} onchange={() => saveField('repo', repo)} placeholder={DEFAULT_REPO}
      spellcheck="false" autocomplete="off" disabled={state === null} title={HELP.githubRepo} />
  </HubField>
  <HubField id="github-branch" label="Branch" hint={hint('Branch')}>
    <input id="github-branch" class="input" bind:value={branch} onchange={() => saveField('branch', branch)} placeholder={DEFAULT_BRANCH}
      spellcheck="false" autocomplete="off" disabled={state === null} title={HELP.githubBranch} />
  </HubField>
  <HubField id="github-token" label="Token"
    hint={state?.token.set
      ? `Kept on this computer${state.token.hint ? `, ending ${state.token.hint.replace('…', '')}` : ''}. Paste a new one to replace it.`
      : 'A fine-grained token for that one repository. Kept on this computer only, never in a backup.'}>
    <input id="github-token" class="input hub-mono" type="password" bind:value={token} onchange={saveToken}
      placeholder={state?.token.set ? `github_pat_•••• ${state.token.hint.replace('…', '')}` : 'github_pat_…'}
      autocomplete="new-password" spellcheck="false" disabled={state === null} title={HELP.githubToken} />
  </HubField>
  <div class="actions">
    <button type="button" class="btn btn-sm" onclick={test} disabled={!ready || saving || tested === 'testing'} aria-busy={tested === 'testing'}
      title={HELP.githubTest}><BusyLabel busy={tested === 'testing'} text={BUSY.test}>Test connection</BusyLabel></button>
    <button type="button" class="btn btn-ghost btn-sm" onclick={forget} disabled={!state || (!state.account && !state.token.set)}
      title={HELP.githubForget}>Forget</button>
    <span class="said hub-line" role="status" data-state={tested === 'testing' ? '' : tested?.ok ? 'ok' : tested ? 'error' : ''}>
      {#if tested && tested !== 'testing'}<Icon name={tested.ok ? 'check' : 'alert'} size={12} /> {tested.text}
      {:else if ready}<span>Articles go to {state.base}<em>short-name</em>/</span>{/if}
    </span>
  </div>
  {#if tested?.warnings?.length}
    <ul class="hub-warnings" aria-label="To mind">
      {#each tested.warnings as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
    </ul>
  {/if}
  {#if tested?.needs}
    <div class="needs"><GitHubSetupPress needs={tested.needs} github={state} detail={tested.detail} ondone={test} /></div>
  {/if}
  {#if state}
    <details class="how hub-how" open={!ready}>
      <summary title={HELP.githubHow}>How to make the repository and the token</summary>
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
      <a class="hub-ext" href={tokenLink(state.account)} target="_blank" rel="noopener noreferrer" title={HELP.githubTokenPage}>
        Make the token on github.com <Icon name="external" size={11} /></a>
      <p class="note-line">{TOKEN_MORE}</p>
      <h4>Pages</h4>
      <p class="note-line">Press Test connection, then Turn on Pages if it is off.</p>
      <p class="note-line">{PAGES_BY_HAND}</p>
    </details>
  {/if}
</HubCard>

<style>
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
  .said { flex: 1 1 200px; margin-left: 4px; }
  .said em { font-style: normal; color: var(--text-2); }
  .needs { margin-top: 10px; }
  .how h4 { margin: 10px 0 2px; color: var(--text-1); font-size: var(--fs-xs); font-weight: 600; }
  .how ol { margin-top: 2px; }
  .how a { color: var(--accent); }
  .how .hub-ext { margin-top: 4px; }
  .note-line { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .note-line.public { color: var(--warn); }
</style>
