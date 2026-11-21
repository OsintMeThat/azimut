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
   * read again on a press of its own), whether it is an Article, in the site's list, a
   * Page, off it and linked from its header, or Unlisted, online at its address and in no list,
   * and the Picture its card has in the list. One line says where the note will appear, naming the
   * site for an Article; while Settings › Website holds no title, another says what the site is then
   * called, with a press to name it there.
   * Each starts from the note's look; the category and the role go up with the publish and
   * are kept in the look, the picture is kept in the look as it is picked. Whatever changes
   * the look is told (`onlook`), so the Notebook never saves an older one over it.
   *
   * **Author.** Who wrote the note, for an article written by someone else: its page is signed with
   * that name and the site's lists name it. Empty is the analyst, the name its placeholder shows. Beside
   * it, an optional picture of the author from the case's pictures, never a logo in its place. Both are
   * kept in the look as they are left, with or without GitHub set up, so a note's author travels in its
   * case's bundle and opens filled in on the machine that publishes it.
   *
   * **Place on the site's map.** An Article may stand somewhere, for a map of the site's articles: its
   * coordinates pasted as `lat, lon` (or as the Sheet reads them) and a name for its pin, both optional and
   * empty for most notes. Under them, what the coordinates read as, or why they are no place, which holds the
   * publish back. When the note names one obvious point (`placeOffer`, `engine/siteplace.py`), a press offers
   * it with the rule it was read by, and only while the coordinates are empty: nothing is ever filled without
   * that press. It goes up with the publish and is kept in the look like the category; emptied, it is gone.
   *
   * **Before it replaces a folder.** Every press asks the check first (`checkFolder`). A folder no record
   * of this note names is another's: the dialog names what it holds and offers **Replace it**, which
   * publishes on (`onpublish`), or **Pick another address**, which puts a free short name in the field
   * and the focus on it. The note's own folder changed on GitHub since is said too. Either way `warned` is
   * up and the press that follows publishes anyway: a warning, never a stop, and a check that fails just
   * publishes. A folder Azimut did not make is never replaced, so that one offers another address only.
   */
  import BusyLabel from '../../components/BusyLabel.svelte';
  import Icon from '../../components/Icon.svelte';
  import GitHubSetupPress from '../../components/GitHubSetupPress.svelte';
  import { prefs, toast, uiState } from '../../lib/state.svelte.js';
  import { categoriesOf, checkFolder, placeOffer, publishNote, readCategories, readGitHub } from '../../lib/githubPages.js';
  import {
    GITHUB_FREE, MAX_SHORT, PAGES_PUBLIC, githubReady, shortNameFrom, shortNameOf, shortNameProblem,
  } from '../../lib/githubPagesSetup.js';
  import { readLook, writeLook } from '../../lib/notes/look.js';
  import { foldText } from '../../lib/textFold.js';
  import { siteName } from '../../lib/websiteHub.js';
  import {
    AUTHOR_IMAGE_LABEL, AUTHOR_IMAGE_NONE, AUTHOR_LABEL, AUTHOR_MAX, BUSY,
    CATEGORY_MAX, CATEGORY_SAID, HAND_EDITED, LIST_IMAGE_COVER, NO_NAME_PRESS, ON_SITE, PICK_ANOTHER, PLACE_COORDS_LABEL, PLACE_COORDS_PLACEHOLDER,
    PLACE_NAME_LABEL, PLACE_NAME_MAX, PLACE_NAME_PLACEHOLDER, PLACE_TITLE, PLACE_WHY, REPLACE_PRESS, WEBSITE_HELP as HELP, noNameSaid, onSiteSaid,
    placeText, placeUseSaid, readPlace, takenOutsideSaid, takenSaid,
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
    /** What is wrong with the short name or the article's place, or ''. */
    problem = $bindable(''),
    busy = $bindable(false),
    /** Whether the check found something at the address, so the next press publishes anyway. */
    warned = $bindable(false),
    /** Writes what the editor still holds, before the note is read from disk. */
    prepare = async () => {},
    /** Called with each address typed, to keep it for this note. */
    onaddress = () => {},
    /** Called when something here changed the note's look, for whoever holds it to read it again. */
    onlook = () => {},
    /** Called when the analyst leaves the dialog for Settings. */
    onleave = () => {},
    /** Publishes as the dialog's own button does: Replace it is that press, the analyst warned. */
    onpublish = () => {},
  } = $props();

  let github = $state(null);
  // whether GitHub's settings were read, so the author's fields stand alone only once GitHub is known to be off
  let githubRead = $state(false);
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
  // who wrote the note and their picture, as the look keeps them; the name kept when the field is left
  let author = $state('');
  let ownAuthor = $state('');
  let authorImage = $state('');
  let authorSaving = Promise.resolve();
  // the look's own category, suggested with what the site uses
  let ownCategory = $state('');
  let reading = $state(false);
  let readSaid = $state('');
  // which picture is being picked: '' none, 'list' or 'author'
  let picking = $state('');
  let pictureQuery = $state('');
  // where the article stands on the site's map, as typed: the look's own until changed
  let coords = $state('');
  let placeName = $state('');
  // the point the note offers, shown as a press and never filled without it
  let offer = $state(null);
  // typed before the look came, so what was typed is kept
  let touched = { category: false, role: false, place: false, author: false };

  // what the check found at the address, until the analyst answers: { kind: 'edited' }, or { kind: 'taken',
  // title, ours, free } for another's folder. The next press publishes anyway, unless Azimut did not make it
  let held = $state(null);
  // a folder Azimut did not make is never replaced: that press checks again rather than publish
  const replaceable = $derived(held !== null && (held.kind === 'edited' || held.ours));
  let shortField = $state(null);

  // a branch opened afresh has published nothing yet, and warned of nothing
  busy = false;
  warned = false;

  $effect(() => {
    let live = true;
    readGitHub().then((value) => { if (live) github = value; }).catch(() => { if (live) github = null; })
      .finally(() => { if (live) githubRead = true; });
    return () => { live = false; };
  });

  const base = $derived(github?.base ?? '');
  // what the site is called: the title of Settings › Website, else what the server falls back to (the Publishing name, then the account)
  const named = $derived(prefs.siteTitle.trim());
  const siteCalled = $derived(named || github?.website?.title || siteName({ report: prefs.reportName, account: github?.account }));
  // read here, and handed up: the dialog's own copies may not be reactive
  const ready = $derived(githubReady(github));
  const wrong = $derived(ready ? shortNameProblem(short) : '');
  $effect(() => { connected = ready; });
  $effect(() => { problem = wrong || placeWrong; });
  $effect(() => { warned = replaceable; });

  // the note's look: what it says it is on the site, and who wrote it, which is asked with GitHub off too
  $effect(() => {
    let live = true;
    readLook(caseId, noteId).then((look) => {
      if (!live) return;
      ownCategory = look.category ?? '';
      if (!touched.category) category = ownCategory;
      if (!touched.role) role = look.role === 'page' || look.role === 'unlisted' ? look.role : 'article';
      if (!touched.place) {
        coords = placeText(look.place);
        placeName = look.place?.name ?? '';
      }
      listImage = look.list_image ?? '';
      ownAuthor = look.author ?? '';
      if (!touched.author) author = ownAuthor;
      authorImage = look.author_image ?? '';
      loaded = true;
    }).catch(() => {});
    return () => { live = false; };
  });

  // the point the note offers for its place, read from the case once GitHub is set up; a failed read offers none
  $effect(() => {
    if (!ready) return;
    let live = true;
    placeOffer(caseId, noteId).then((value) => { if (live) offer = value; }).catch(() => {});
    return () => { live = false; };
  });

  const placeRead = $derived(readPlace(coords, placeName));
  // only an article shows its place, so only its place can hold the publish back
  const placeWrong = $derived(role === 'article' ? placeRead.problem : '');

  const suggestions = $derived(categoriesOf([...(github?.categories ?? []), ownCategory]));
  const pictures = $derived(entities
    .filter((entity) => (entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path && entity.attrs?.kind !== 'video')
    .filter((entity) => foldText(entity.label).includes(foldText(pictureQuery.trim())))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 60));
  const listPicture = $derived(entities.find((entity) => entity.id === listImage) ?? null);
  const authorPicture = $derived(entities.find((entity) => entity.id === authorImage) ?? null);
  // the name an article with no author of its own is by: the Publishing name, else the site's
  const authorDefault = $derived(prefs.reportName.trim() || siteCalled || '');

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
    held = null;
    if (!shortNameProblem(short)) onaddress(`${base}${short}/`);
  }

  function typeCategory(value) {
    touched.category = true;
    category = value.replace(/\s+/g, ' ').slice(0, CATEGORY_MAX);
  }

  function typePlace(value, name = placeName) {
    touched.place = true;
    coords = value;
    placeName = name;
  }

  /** The note's offer taken, on its press only: its point, and its name unless one was typed. */
  function useOffer() {
    if (!offer) return;
    typePlace(placeText(offer), placeName.trim() ? placeName : offer.name);
  }

  function chooseRole(id) {
    touched.role = true;
    role = id;
    picking = '';
  }

  function typeAuthor(value) {
    touched.author = true;
    author = value;
  }

  /** The author's name kept in the look as the field is left; empty, the article is the analyst's again. */
  function saveAuthor() {
    const next = author.split(/\s+/).filter(Boolean).join(' ').slice(0, AUTHOR_MAX);
    author = next;
    if (next === ownAuthor) return;
    const before = ownAuthor;
    ownAuthor = next;
    authorSaving = keepInLook({ author: next }).catch((error) => {
      ownAuthor = before;
      toast(`Author not saved: ${error.message}`, 'danger');
    });
  }

  /** One change kept in the look at once, read afresh: the Notebook may have changed it since this dialog read it. */
  async function keepInLook(changes) {
    const look = await readLook(caseId, noteId);
    await writeLook(caseId, noteId, { ...look, ...changes });
    onlook();
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

  /** A picture picked for the list or the author, or none: kept in the look at once, like the cover picture is. */
  async function pickImage(entity, which = picking) {
    picking = '';
    pictureQuery = '';
    const before = which === 'author' ? authorImage : listImage;
    const next = entity?.id ?? '';
    if (next === before) return;
    if (which === 'author') authorImage = next;
    else listImage = next;
    try {
      await keepInLook(which === 'author' ? { author_image: next } : { list_image: next });
    } catch (error) {
      if (which === 'author') authorImage = before;
      else listImage = before;
      toast(`Picture not saved: ${error.message}`, 'danger');
    }
  }

  /**
   * What stands at the address before a publish replaces it, or null for nothing to say: another
   * article, map or page of the site (`taken`), or this note's own folder changed on GitHub since.
   * A check that fails says nothing.
   */
  async function inTheWay() {
    try {
      const answer = await checkFolder(caseId, noteId, short);
      if (answer?.taken) {
        return { kind: 'taken', title: String(answer.taken.title || short), ours: answer.taken.ours === true, free: String(answer.free ?? '') };
      }
      return answer?.edited ? { kind: 'edited' } : null;
    } catch {
      return null;
    }
  }

  /** Leave what holds the address and take a free short name, the field focused to change it. */
  function pickAnother() {
    const free = held?.free ?? '';
    held = null;
    if (free) type(free);
    shortField?.focus();
    shortField?.select?.();
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
    if (wrong || placeWrong) return null;
    busy = true;
    failed = '';
    needs = null;
    setUp = '';
    try {
      await prepare();
      // an author typed and left a moment ago is in the look before the page is made
      await authorSaving;
      const told = replaceable;
      if (!told) {
        const found = await inTheWay();
        if (found) {
          held = found;
          return null;
        }
      }
      onaddress(address);
      const answer = await publishNote(caseId, noteId, {
        shortName: short, roundPov, changes, offlineMaps,
        ...(loaded || touched.category ? { category } : {}),
        ...(loaded || touched.role ? { role } : {}),
        // an article's place as the fields hold it; for a page or an unlisted one, the look's own stays
        ...((loaded || touched.place) && role === 'article' ? { place: placeRead.place } : {}),
      });
      if (answer?.published) {
        held = null;
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

  function openSettings(panel = '') {
    onleave();
    uiState.settingsTab = panel ? `website:${panel}` : 'website';
    uiState.tool = 'settings';
  }
</script>

{#snippet picker(which)}
  {#if picking === which}
    <div class="pictures">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" bind:value={pictureQuery} placeholder="Find a picture…" autofocus
        title={which === 'author' ? HELP.publishAuthorImage : HELP.publishImage}
        onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); picking = ''; } }} />
      <div class="picture-list">
        {#each pictures as entity (entity.id)}
          <button type="button" class="picture-row" class:on={entity.id === (which === 'author' ? authorImage : listImage)}
            title={entity.label} onclick={() => pickImage(entity, which)}><Icon name="image" size={12} /><span>{entity.label}</span></button>
        {/each}
        {#if !pictures.length}<p class="none">No picture in the case matches.</p>{/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet authorFields()}
  <label class="lbl" for="export-author" title={HELP.publishAuthor}>{AUTHOR_LABEL}</label>
  <input id="export-author" class="input" value={author} maxlength={AUTHOR_MAX} spellcheck="false" autocomplete="off"
    placeholder={authorDefault} title={HELP.publishAuthor}
    oninput={(event) => typeAuthor(event.currentTarget.value)} onchange={saveAuthor} />
  <span class="lbl">{AUTHOR_IMAGE_LABEL}</span>
  <div class="picked">
    <button type="button" class="btn btn-sm pick" data-pick="author" title={HELP.publishAuthorImage}
      onclick={() => (picking = picking === 'author' ? '' : 'author')}>
      <Icon name="image" size={13} /><span>{authorPicture?.label ?? (authorImage ? 'No longer in the case' : AUTHOR_IMAGE_NONE)}</span>
    </button>
    {#if authorImage}
      <button type="button" class="btn btn-ghost btn-sm" title={HELP.publishAuthorImageClear} aria-label="No author picture"
        onclick={() => pickImage(null, 'author')}><Icon name="x" size={12} /></button>
    {/if}
  </div>
  {@render picker('author')}
{/snippet}

{#if ready}
  <div class="gh" aria-label="GitHub Pages">
    <label class="lbl" for="export-short">Address it will live at</label>
    <div class="address-line" class:bad={wrong}>
      <span class="base mono" title={base}>{base}</span>
      <input id="export-short" class="input mono short" bind:this={shortField} value={short} maxlength={MAX_SHORT} spellcheck="false" autocomplete="off"
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
            title={{ page: HELP.publishPage, unlisted: HELP.publishUnlisted }[choice.id] ?? HELP.publishArticle}
            onclick={() => chooseRole(choice.id)}>{choice.label}</button>
        {/each}
      </div>
      <p class="address-said" role="status">{onSiteSaid(role, siteCalled)}</p>
      {#if !named && siteCalled}
        <p class="address-said">{noNameSaid(siteCalled)}
          <button type="button" class="link" title={HELP.publishName} onclick={() => openSettings('identity')}>{NO_NAME_PRESS}</button></p>
      {/if}
      {@render authorFields()}
      {#if role === 'article'}
        <label class="lbl" for="export-category" title={HELP.publishCategory}>Category</label>
        <div class="category-line">
          <input id="export-category" class="input" list="export-categories" value={category} maxlength={CATEGORY_MAX}
            spellcheck="false" autocomplete="off" placeholder="No category" title={HELP.publishCategory} aria-describedby="export-category-said"
            oninput={(event) => typeCategory(event.currentTarget.value)} />
          <datalist id="export-categories">
            {#each suggestions as name (name)}<option value={name}></option>{/each}
          </datalist>
          <button type="button" class="btn btn-ghost btn-sm" onclick={readSite} disabled={reading || busy} aria-busy={reading}
            title={HELP.publishRead}><BusyLabel busy={reading} text={BUSY.read}>Read the site</BusyLabel></button>
        </div>
        <p id="export-category-said" class="address-said" role="status">{readSaid || CATEGORY_SAID}</p>
        <span class="lbl">Picture in the list</span>
        <div class="picked">
          <button type="button" class="btn btn-sm pick" data-pick="list" title={HELP.publishImage} onclick={() => (picking = picking === 'list' ? '' : 'list')}>
            <Icon name="image" size={13} /><span>{listPicture?.label ?? (listImage ? 'No longer in the case' : LIST_IMAGE_COVER)}</span>
          </button>
          {#if listImage}
            <button type="button" class="btn btn-ghost btn-sm" title={HELP.publishImageClear} aria-label="Use the cover picture"
              onclick={() => pickImage(null, 'list')}><Icon name="x" size={12} /></button>
          {/if}
        </div>
        {@render picker('list')}
        <div class="place" role="group" aria-label={PLACE_TITLE}>
          <span class="lbl">{PLACE_TITLE}</span>
          <div class="place-fields">
            <input id="export-place" class="input mono" value={coords} spellcheck="false" autocomplete="off"
              placeholder={PLACE_COORDS_PLACEHOLDER} aria-label={PLACE_COORDS_LABEL} title={HELP.publishPlace}
              aria-invalid={placeWrong ? 'true' : undefined} aria-describedby="export-place-said"
              oninput={(event) => typePlace(event.currentTarget.value)} />
            <input id="export-place-name" class="input" value={placeName} maxlength={PLACE_NAME_MAX} spellcheck="false"
              autocomplete="off" placeholder={PLACE_NAME_PLACEHOLDER} aria-label={PLACE_NAME_LABEL} title={HELP.publishPlaceName}
              oninput={(event) => typePlace(coords, event.currentTarget.value)} />
          </div>
          <p id="export-place-said" class="address-said" class:bad={placeWrong} role="status">{placeRead.said}</p>
          {#if offer && !coords.trim()}
            <p class="place-offer">
              <button type="button" class="btn btn-sm" title={HELP.publishPlaceUse} onclick={useOffer}>
                <Icon name="pin" size={12} /><span>{placeUseSaid(offer)}</span></button>
              <span class="place-why">{PLACE_WHY[offer.from]}</span>
            </p>
          {/if}
        </div>
      {/if}
    </div>

    {#if busy}
      <p class="sending" role="status"><BusyLabel busy text="Making the folder and sending it to {github.account}/{github.repo}…" /></p>
    {/if}
    {#if held}
      <div class="held" role="alert">
        <p><Icon name="alert" size={13} />
          {held.kind === 'edited' ? HAND_EDITED : held.ours ? takenSaid(held.title) : takenOutsideSaid(held.title)}</p>
        <div class="held-presses">
          {#if held.kind === 'edited'}
            <button type="button" class="btn btn-sm" title={HELP.publishStop} onclick={() => (held = null)}>Don't publish</button>
          {:else}
            {#if held.ours}
              <button type="button" class="btn btn-sm" disabled={busy} aria-busy={busy} title={HELP.publishReplace}
                onclick={() => onpublish()}><BusyLabel {busy} text={BUSY.publish}>{REPLACE_PRESS}</BusyLabel></button>
            {/if}
            <button type="button" class="btn btn-sm" disabled={busy} title={HELP.publishPickAnother} onclick={pickAnother}>{PICK_ANOTHER}</button>
          {/if}
        </div>
      </div>
    {/if}
    {#if needs}
      <GitHubSetupPress needs={needs.needs} {github} detail={needs.detail} ondone={after} />
    {/if}
    {#if setUp}<p class="set-up" role="status"><Icon name="check" size={12} /> {setUp}</p>{/if}
    {#if failed}<p class="failed" role="alert"><Icon name="alert" size={12} /> {failed}</p>{/if}
  </div>
{:else if githubRead}
  <!-- with GitHub off, who wrote the note can still be said, so it travels with the case -->
  <div class="site alone" role="group" aria-label={AUTHOR_LABEL}>{@render authorFields()}</div>
{/if}
{#if !ready && setupShown && github !== null}
  <div class="setup" role="group" aria-label="Set up GitHub Pages">
    <p class="lead"><Icon name="info" size={13} /> Publish to your own GitHub Pages site in one press: connect GitHub once, in Settings › Website.</p>
    <p class="quiet">{GITHUB_FREE}</p>
    <p class="quiet">{PAGES_PUBLIC}</p>
    <button type="button" class="btn btn-sm" title="Open Settings on Website, where GitHub Pages is set" onclick={() => openSettings()}>
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
  .link { padding: 0; border: 0; background: none; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline; }
  .link:hover { color: var(--accent-hover); }
  .site { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .site.alone { margin-top: 0; font-size: var(--fs-sm); }
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
  .place { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .place-fields { display: flex; gap: 6px; }
  .place-fields .input { flex: 1 1 0; min-width: 0; }
  .place-fields .input[aria-invalid='true'] { border-color: var(--danger); }
  .place-offer { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0; }
  .place-offer .btn { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
  .place-offer .btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .place-why { color: var(--text-3); font-size: var(--fs-xs); }
  .gh :global(.needs) { margin-top: 6px; }
  .sending { display: flex; align-items: center; gap: 7px; margin: 4px 0 0; color: var(--text-2); font-size: var(--fs-xs); }
  .held { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 6px; border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
    border-radius: var(--r-md); padding: 8px 12px; background: color-mix(in srgb, var(--warn) 7%, var(--bg-1)); }
  .held p { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); font-size: var(--fs-sm); overflow-wrap: anywhere; }
  .held p > :global(svg) { flex: none; color: var(--warn); }
  .held-presses { display: flex; flex-wrap: wrap; gap: 6px; }
  .set-up { display: flex; align-items: center; gap: 5px; margin: 4px 0 0; color: var(--ok); font-size: var(--fs-xs); }
  .failed { display: flex; align-items: center; gap: 5px; margin: 4px 0 0; color: var(--danger); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .setup { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 8px 12px 10px; background: var(--bg-1); font-size: var(--fs-sm); }
  .setup .btn { align-self: flex-start; margin-top: 2px; }
  .lead { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); }
  .quiet { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
</style>
