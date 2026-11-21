<script>
  /**
   * The export dialog's Web folder branch, for GitHub Pages: the address the page will
   * live at, made of the site's address and a short name the analyst can change, what the
   * note is on the site, and what Publish to GitHub Pages found before it could publish.
   *
   * The site's address comes from Settings (`lib/githubPages.js`), read on this machine:
   * the address Pages last said it has, else `https://<account>.github.io/<repo>/`. The
   * short name starts as the last part of the address this note was last given, else
   * its title, and the whole address is handed up (`address`), so Export web folder
   * writes the same page Publish puts online. Only the dialog's Publish button reaches
   * GitHub, through `publish()`. When the repository is missing or Pages is off, the
   * press that sets it up shows here (`components/GitHubSetupPress.svelte`); while
   * GitHub is not set up, a Publish shows the way to Settings › Website.
   *
   * **On the site.** The note's Category (a field suggesting what the site already uses,
   * read again on a press of its own), whether it is an Article, in the site's list, or a
   * Page, off it and linked from its header, and the Picture its card has in the list.
   * Each starts from the note's look; the category and the role go up with the publish and
   * are kept in the look, the picture is kept in the look as it is picked. Whatever changes
   * the look is told (`onlook`), so the Notebook never saves an older one over it.
   *
   * **Before it replaces a folder.** A note published here before is checked first: when the
   * folder was changed on GitHub since, the dialog says so and `warned` is up, and the press
   * that follows publishes anyway. A warning, never a stop; a check that fails just publishes.
   */
  import Icon from '../../components/Icon.svelte';
  import GitHubSetupPress from '../../components/GitHubSetupPress.svelte';
  import { toast, uiState } from '../../lib/state.svelte.js';
  import { categoriesOf, checkFolder, publishNote, readCategories, readGitHub } from '../../lib/githubPages.js';
  import {
    GITHUB_FREE, MAX_SHORT, PAGES_PUBLIC, githubReady, shortNameFrom, shortNameOf, shortNameProblem,
  } from '../../lib/githubPagesSetup.js';
  import { listEditions } from '../../lib/notes/editions.svelte.js';
  import { readLook, writeLook } from '../../lib/notes/look.js';
  import { foldText } from '../../lib/textFold.js';
  import {
    CATEGORY_MAX, CATEGORY_SAID, HAND_EDITED, LIST_IMAGE_COVER, ON_SITE, ON_SITE_SAID, WEBSITE_HELP as HELP,
  } from '../../lib/websiteSetup.js';

  let {
    caseId,
    noteId,
    /** The note's title, which a first short name is made from. */
    title = '',
    /** The case's entities, for the pictures the list's card can show. */
    entities = [],
    /** The address the page will live at, handed up to the dialog. */
    address = $bindable(''),
    /** Whether GitHub Pages is set up in Settings. */
    connected = $bindable(false),
    /** What is wrong with the short name, or ''. */
    problem = $bindable(''),
    busy = $bindable(false),
    /** Whether the folder on GitHub was found changed, so the next press publishes anyway. */
    warned = $bindable(false),
    /** Writes what the editor still holds, before the note is read from disk. */
    prepare = async () => {},
    /** Called with each address typed, to keep it for this note. */
    onaddress = () => {},
    /** Called when something here changed the note's look, for whoever holds it to read it again. */
    onlook = () => {},
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

  // what the note is on the site: read from its look once the dialog shows, and sent with the publish
  let loaded = $state(false);
  let category = $state('');
  let role = $state('article');
  let listImage = $state('');
  // the look's own category, suggested with what the site uses
  let ownCategory = $state('');
  let reading = $state(false);
  let readSaid = $state('');
  let picking = $state(false);
  let pictureQuery = $state('');
  // typed before the look came, so what was typed is kept
  let touched = { category: false, role: false };

  // the folder on GitHub was found changed: the next press publishes anyway. Read here, and handed up (`warned`)
  let held = $state(false);

  // a branch opened afresh has published nothing yet, and warned of nothing
  busy = false;
  warned = false;

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
  $effect(() => { warned = held; });

  // the note's look, once GitHub is known to be set up: what it says it is on the site
  $effect(() => {
    if (!ready) return;
    let live = true;
    readLook(caseId, noteId).then((look) => {
      if (!live) return;
      ownCategory = look.category ?? '';
      if (!touched.category) category = ownCategory;
      if (!touched.role) role = look.role === 'page' ? 'page' : 'article';
      listImage = look.list_image ?? '';
      loaded = true;
    }).catch(() => {});
    return () => { live = false; };
  });

  const suggestions = $derived(categoriesOf([...(github?.categories ?? []), ownCategory]));
  const pictures = $derived(entities
    .filter((entity) => (entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path && entity.attrs?.kind !== 'video')
    .filter((entity) => foldText(entity.label).includes(foldText(pictureQuery.trim())))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 60));
  const listPicture = $derived(entities.find((entity) => entity.id === listImage) ?? null);

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
    // the folder warned of is the one the short name named
    held = false;
    if (!shortNameProblem(short)) onaddress(`${base}${short}/`);
  }

  function typeCategory(value) {
    touched.category = true;
    category = value.replace(/\s+/g, ' ').slice(0, CATEGORY_MAX);
  }

  function chooseRole(id) {
    touched.role = true;
    role = id;
    picking = false;
  }

  /** Read the site for the categories it uses, on this press only. */
  async function readSite() {
    if (reading) return;
    reading = true;
    readSaid = '';
    failed = '';
    needs = null;
    try {
      const answer = await readCategories();
      if (answer?.ok === false && answer.needs) {
        needs = { needs: answer.needs === 'repository' ? 'repository' : 'pages', detail: String(answer.detail ?? '') };
        return;
      }
      const found = categoriesOf(answer?.categories);
      github = { ...github, categories: found };
      const count = found.length;
      readSaid = [count ? `${count} categor${count === 1 ? 'y' : 'ies'} on the site.` : 'No category on the site yet.',
        ...(Array.isArray(answer?.warnings) ? answer.warnings : [])].join(' ');
    } catch (error) {
      failed = error.message;
    } finally {
      reading = false;
    }
  }

  /** A picture picked for the list, or none (the cover's): kept in the look at once, like the cover picture is. */
  async function pickImage(entity) {
    picking = false;
    pictureQuery = '';
    const before = listImage;
    const next = entity?.id ?? '';
    if (next === before) return;
    listImage = next;
    try {
      // the look as it is now: the Notebook may have changed it since this dialog read it
      const look = await readLook(caseId, noteId);
      await writeLook(caseId, noteId, { ...look, list_image: next });
      onlook();
    } catch (error) {
      listImage = before;
      toast(`Picture not saved: ${error.message}`, 'danger');
    }
  }

  /**
   * Whether the folder this publish replaces was changed on GitHub since this Azimut put it
   * there: asked only of a note published here before, and a check that fails says nothing.
   */
  async function handEdited() {
    try {
      const before = await listEditions(caseId, noteId);
      if (!before.some((edition) => edition.format === 'github')) return false;
      return Boolean((await checkFolder(caseId, noteId, short))?.edited);
    } catch {
      return false;
    }
  }

  /**
   * Publish the note to GitHub Pages; the dialog's button calls this. Answers what
   * GitHub said once published, or null when it was not: a folder changed on GitHub
   * asks for one more press first (`warned`).
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
      const told = held;
      if (!told && await handEdited()) {
        held = true;
        return null;
      }
      onaddress(address);
      const answer = await publishNote(caseId, noteId, {
        shortName: short, roundPov, changes, offlineMaps,
        ...(loaded || touched.category ? { category } : {}),
        ...(loaded || touched.role ? { role } : {}),
      });
      if (answer?.published) {
        held = false;
        onlook();
        return { ...answer, told };
      }
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
    uiState.settingsTab = 'website';
    uiState.tool = 'settings';
  }
</script>

{#if ready}
  <div class="gh" aria-label="GitHub Pages">
    <label class="lbl" for="export-short">Address it will live at</label>
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

    <div class="site" role="group" aria-label="On the site">
      <span class="lbl">On the site</span>
      <div class="choice" role="radiogroup" aria-label="On the site">
        {#each ON_SITE as choice (choice.id)}
          <button type="button" role="radio" aria-checked={role === choice.id} class:on={role === choice.id}
            title={choice.id === 'page' ? HELP.publishPage : HELP.publishArticle} onclick={() => chooseRole(choice.id)}>{choice.label}</button>
        {/each}
      </div>
      <p class="address-said">{ON_SITE_SAID[role]}</p>
      {#if role === 'article'}
        <label class="lbl" for="export-category" title={HELP.publishCategory}>Category</label>
        <div class="category-line">
          <input id="export-category" class="input" list="export-categories" value={category} maxlength={CATEGORY_MAX}
            spellcheck="false" autocomplete="off" placeholder="No category" title={HELP.publishCategory} aria-describedby="export-category-said"
            oninput={(event) => typeCategory(event.currentTarget.value)} />
          <datalist id="export-categories">
            {#each suggestions as name (name)}<option value={name}></option>{/each}
          </datalist>
          <button type="button" class="btn btn-ghost btn-sm" onclick={readSite} disabled={reading || busy} title={HELP.publishRead}>
            {reading ? 'Reading…' : 'Read the site'}</button>
        </div>
        <p id="export-category-said" class="address-said" role="status">{readSaid || CATEGORY_SAID}</p>
        <span class="lbl">Picture in the list</span>
        <div class="picked">
          <button type="button" class="btn btn-sm pick" title={HELP.publishImage} onclick={() => (picking = !picking)}>
            <Icon name="image" size={13} /><span>{listPicture?.label ?? (listImage ? 'No longer in the case' : LIST_IMAGE_COVER)}</span>
          </button>
          {#if listImage}
            <button type="button" class="btn btn-ghost btn-sm" title={HELP.publishImageClear} aria-label="Use the cover picture"
              onclick={() => pickImage(null)}><Icon name="x" size={12} /></button>
          {/if}
        </div>
        {#if picking}
          <div class="pictures">
            <!-- svelte-ignore a11y_autofocus -->
            <input class="input" bind:value={pictureQuery} placeholder="Find a picture…" autofocus title={HELP.publishImage}
              onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); picking = false; } }} />
            <div class="picture-list">
              {#each pictures as entity (entity.id)}
                <button type="button" class="picture-row" class:on={entity.id === listImage} title={entity.label}
                  onclick={() => pickImage(entity)}><Icon name="image" size={12} /><span>{entity.label}</span></button>
              {/each}
              {#if !pictures.length}<p class="none">No picture in the case matches.</p>{/if}
            </div>
          </div>
        {/if}
      {/if}
    </div>

    {#if busy}
      <p class="sending" role="status"><span class="spinner" aria-hidden="true"></span>
        Making the folder and sending it to {github.account}/{github.repo}…</p>
    {/if}
    {#if held}
      <div class="edited" role="alert">
        <p><Icon name="alert" size={13} /> {HAND_EDITED}</p>
        <button type="button" class="btn btn-sm" title={HELP.publishStop} onclick={() => (held = false)}>Don't publish</button>
      </div>
    {/if}
    {#if needs}
      <GitHubSetupPress needs={needs.needs} {github} detail={needs.detail} ondone={after} />
    {/if}
    {#if setUp}<p class="set-up" role="status"><Icon name="check" size={12} /> {setUp}</p>{/if}
    {#if failed}<p class="failed" role="alert"><Icon name="alert" size={12} /> {failed}</p>{/if}
  </div>
{:else if setupShown && github !== null}
  <div class="setup" role="group" aria-label="Set up GitHub Pages">
    <p class="lead"><Icon name="info" size={13} /> Publish to your own GitHub Pages site in one press: connect GitHub once, in Settings › Website.</p>
    <p class="quiet">{GITHUB_FREE}</p>
    <p class="quiet">{PAGES_PUBLIC}</p>
    <button type="button" class="btn btn-sm" title="Open Settings on Website, where GitHub Pages is set" onclick={openSettings}>
      Open Settings › Website</button>
  </div>
{/if}

<style>
  .gh { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-sm); }
  .lbl { color: var(--text-3); }
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
  .site { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .choice { display: inline-flex; align-self: flex-start; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .choice button { padding: 3px 12px; border: none; border-left: 1px solid var(--border); background: var(--bg-1); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer; }
  .choice button:first-child { border-left: none; }
  .choice button:hover:not(.on) { background: var(--bg-3); color: var(--text-1); }
  .choice button.on { background: var(--bg-3); color: var(--text-1); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  .choice button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .category-line { display: flex; align-items: center; gap: 6px; }
  .category-line .input { flex: 1; min-width: 0; }
  .picked { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .pick { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
  .pick span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pictures { display: flex; flex-direction: column; gap: 4px; }
  .picture-list { display: flex; flex-direction: column; max-height: 160px; overflow-y: auto; border: 1px solid var(--border);
    border-radius: var(--r-sm); background: var(--bg-1); }
  .picture-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border: none; background: none; color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); text-align: left; cursor: pointer; }
  .picture-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picture-row:hover { background: var(--bg-3); color: var(--text-1); }
  .picture-row.on { color: var(--accent); font-weight: 600; }
  .none { margin: 4px 6px; color: var(--text-3); font-size: var(--fs-xs); }
  .gh :global(.needs) { margin-top: 6px; }
  .sending { display: flex; align-items: center; gap: 7px; margin: 4px 0 0; color: var(--text-2); font-size: var(--fs-xs); }
  .spinner { flex: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  .edited { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 6px; border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
    border-radius: var(--r-md); padding: 8px 12px; background: color-mix(in srgb, var(--warn) 7%, var(--bg-1)); }
  .edited p { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); font-size: var(--fs-sm); }
  .edited :global(svg) { flex: none; color: var(--warn); }
  .set-up { display: flex; align-items: center; gap: 5px; margin: 4px 0 0; color: var(--ok); font-size: var(--fs-xs); }
  .failed { display: flex; align-items: center; gap: 5px; margin: 4px 0 0; color: var(--danger); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .setup { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 8px 12px 10px; background: var(--bg-1); font-size: var(--fs-sm); }
  .setup .btn { align-self: flex-start; margin-top: 2px; }
  .lead { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); }
  .quiet { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
</style>
