<script>
  /**
   * What the site's name, line, logo and credit look like, drawn as the three places a reader meets
   * them: the bar over an article, the home page and the feed. It follows what is typed. With the site
   * read, the lists show its latest articles and categories; before, a sample stands in.
   */
  import { PREVIEWS, PREVIEW_SAMPLE as SAMPLE, WEBSITE_HELP as HELP } from '../../../lib/websiteSetup.js';

  let { name, tagline = '', logoUrl = '', credit = true, version = '', read = null } = $props();

  let view = $state('bar');
  const hover = { bar: HELP.previewBar, home: HELP.previewHome, feed: HELP.previewFeed };

  const listed = $derived((read?.items ?? []).filter((item) => item.role === 'article').slice(0, 2));
  const rows = $derived(listed.length
    ? listed.map((item) => ({ title: item.title, day: item.dateLabel || item.date, image: item.image }))
    : [{ title: SAMPLE.title, day: SAMPLE.day, image: '' }, { title: SAMPLE.other, day: SAMPLE.short, image: '' }]);
  const kicker = $derived(listed[0]?.category || read?.categories[0]?.name || SAMPLE.category);
  const tabs = $derived((read?.categories ?? []).map((entry) => entry.name).slice(0, 5));
</script>

<div class="preview">
  <div class="switch" role="group" aria-label="Preview">
    {#each PREVIEWS as one (one.id)}
      <button type="button" class:on={view === one.id} aria-pressed={view === one.id} title={hover[one.id]} onclick={() => (view = one.id)}>{one.label}</button>
    {/each}
  </div>

  <div class="paper" data-view={view} aria-label="Preview of the {view === 'bar' ? 'article bar' : view === 'home' ? 'home page' : 'feed'}">
    {#if view === 'bar'}
      <div class="bar">
        {#if logoUrl}<img class="lg" src={logoUrl} alt="" />{/if}
        <b data-preview="name">{name}</b><span class="back">{SAMPLE.back}</span>
      </div>
      <div class="art">
        <div class="kick">{kicker}</div>
        <h4>{rows[0].title}</h4>
        <div class="ln" style="width: 92%"></div><div class="ln" style="width: 86%"></div><div class="ln" style="width: 64%"></div>
      </div>
    {:else if view === 'home'}
      <div class="home">
        <div class="hd">
          {#if logoUrl}<img class="lg big" src={logoUrl} alt="" />{/if}
          <b data-preview="name">{name}</b>
        </div>
        {#if tagline}<p class="tg" data-preview="tagline">{tagline}</p>{/if}
        <div class="tb"><b>{SAMPLE.all}</b>{#each tabs as tab (tab)}<span>{tab}</span>{/each}</div>
        {#each rows as row, index (index)}
          <div class="it">
            <span class="th" style:background-image={row.image ? `url("${row.image}")` : null}></span>
            <div><h5>{row.title}</h5><small>{row.day}</small></div>
          </div>
        {/each}
        {#if credit}<div class="cr" data-preview="credit">Made with Azimut{version ? ` ${version}` : ''}</div>{/if}
      </div>
    {:else}
      <div class="feed">
        <div class="fh">{#if logoUrl}<img class="lg" src={logoUrl} alt="" />{/if}<span data-preview="name">{name}</span></div>
        {#if tagline}<div class="fd" data-preview="tagline">{tagline}</div>{/if}
        {#each rows as row, index (index)}<div class="fi">{row.title}<small>{row.day}</small></div>{/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .preview { min-width: 0; }
  .switch { display: flex; gap: 4px; margin-bottom: 10px; flex-wrap: wrap; }
  .switch button { border: 1px solid var(--border); background: var(--bg-2); border-radius: 99px; padding: 2px 10px; font: inherit;
    font-size: var(--fs-xs); color: var(--text-2); cursor: pointer; }
  .switch button:hover { color: var(--text-1); }
  .switch button.on { border-color: var(--accent); color: var(--text-1); background: var(--accent-soft); }
  /* the page of a site is light whatever the app's theme is: a reader's browser, not Azimut's */
  .paper { border-radius: 8px; overflow: hidden; border: 1px solid var(--border-strong); background: #fff; color: #1f2023;
    font-family: Georgia, 'Times New Roman', serif; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid #dedad3; font: 500 0.8rem/1 system-ui, sans-serif; }
  .lg { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; flex: none; }
  .lg.big { width: 36px; height: 36px; }
  .back { margin-left: auto; color: #62676f; }
  .art { padding: 16px 18px 18px; }
  .kick { font: 600 0.62rem/1 system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #1f4e79; }
  .art h4 { margin: 6px 0; font-size: 1.15rem; line-height: 1.2; color: #1f2023; text-transform: none; letter-spacing: 0; }
  .ln { height: 7px; border-radius: 3px; background: #ecebe7; margin-top: 7px; }
  .home { padding: 18px 18px 14px; }
  .hd { display: flex; gap: 10px; align-items: center; }
  .hd b { font: 700 1.1rem/1.1 system-ui, sans-serif; overflow-wrap: anywhere; }
  .tg { margin: 8px 0 10px; color: #62676f; font-size: 0.8rem; font-style: italic; }
  .tb { display: flex; gap: 12px; margin-top: 8px; font: 500 0.7rem/1 system-ui, sans-serif; color: #62676f; border-bottom: 1px solid #dedad3; padding-bottom: 6px; overflow: hidden; white-space: nowrap; }
  .tb b { color: #1f2023; border-bottom: 2px solid #1f4e79; padding-bottom: 5px; margin-bottom: -7px; }
  .it { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 10px; margin-top: 10px; }
  .th { height: 42px; border-radius: 3px; background: #ddd center / cover no-repeat; }
  .it h5 { margin: 0; font-size: 0.82rem; line-height: 1.2; color: #1f2023; text-transform: none; letter-spacing: 0; }
  .it small, .fi small { display: block; font: 400 0.66rem system-ui, sans-serif; color: #62676f; }
  .cr { margin-top: 12px; padding-top: 8px; border-top: 1px solid #dedad3; font: 400 0.66rem system-ui, sans-serif; color: #62676f; text-align: center; }
  .feed { padding: 12px 14px; font-family: system-ui, sans-serif; }
  .fh { display: flex; gap: 8px; align-items: center; font-size: 0.8rem; font-weight: 700; }
  .fd { color: #62676f; font-size: 0.7rem; margin: 2px 0 8px 26px; }
  .fi { border-top: 1px solid #eee; padding: 7px 0 0 26px; margin-top: 7px; font-size: 0.76rem; }
</style>
