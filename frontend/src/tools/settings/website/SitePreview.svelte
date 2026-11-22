<script>
  /**
   * What the site's name, line, logo and credit look like, drawn as the three places a reader meets
   * them: the bar over an article, the home page and the feed, in the site's own paper and ink
   * (`engine/site.py`, `engine/sitehome.py`). It follows what is typed. With the site read, the lists
   * show its latest articles, its categories and its pages; before, a sample stands in. A read that
   * finds the site's own bar in use (`azimut-bar.html`) shows it in place of Azimut's. An article by
   * someone else names them after its day, their picture first, as the site's lists do (`site._by`).
   */
  import { OWN_BAR_FILE, OWN_BAR_IN_USE, PREVIEWS, PREVIEW_SAMPLE as SAMPLE, WEBSITE_HELP as HELP } from '../../../lib/websiteSetup.js';

  let { name, tagline = '', logoUrl = '', credit = true, version = '', read = null } = $props();

  let view = $state('bar');
  const HOVER = { bar: HELP.previewBar, home: HELP.previewHome, feed: HELP.previewFeed };

  const listed = $derived((read?.items ?? []).filter((item) => item.role === 'article').slice(0, 2));
  const rows = $derived(listed.length
    ? listed.map((item) => ({ title: item.title, day: item.dateLabel || item.date, image: item.image, category: item.category,
      by: item.author && item.author !== name ? item.author : '', face: item.author && item.author !== name ? item.authorImage : '' }))
    : [{ title: SAMPLE.title, day: SAMPLE.day, image: '', category: SAMPLE.category }, { title: SAMPLE.other, day: SAMPLE.day, image: '', category: '' }]);
  const tabs = $derived((read?.categories ?? []).map((entry) => entry.name).slice(0, 4));
  const pages = $derived((read?.items ?? []).filter((item) => item.role === 'page').map((item) => item.title).slice(0, 2));
  const viewName = $derived(PREVIEWS.find((one) => one.id === view)?.label ?? '');
</script>

<div class="preview">
  <div class="switch" role="group" aria-label="Preview">
    {#each PREVIEWS as one (one.id)}
      <button type="button" class:on={view === one.id} aria-pressed={view === one.id} title={HOVER[one.id]} onclick={() => (view = one.id)}>{one.label}</button>
    {/each}
  </div>

  <figure class="paper" data-view={view} aria-label="Preview of the {viewName.toLowerCase()}">
    {#if view === 'bar'}
      {#if read?.bar === 'yours'}
        <div class="bar own" data-preview="own-bar"><span class="own-file">{OWN_BAR_FILE}</span><span class="back">{OWN_BAR_IN_USE}</span></div>
      {:else}
        <div class="bar">
          {#if logoUrl}<img class="lg" src={logoUrl} alt="" />{/if}
          <b data-preview="name">{name}</b><span class="back">{SAMPLE.back}</span>
        </div>
      {/if}
      <div class="art">
        {#if rows[0].category}<div class="kick">{rows[0].category}</div>{/if}
        <h4>{rows[0].title}</h4>
        <p class="meta">{rows[0].day}</p>
        <div class="ln" style:width="94%"></div><div class="ln" style:width="88%"></div><div class="ln" style:width="91%"></div><div class="ln" style:width="62%"></div>
      </div>
    {:else if view === 'home'}
      <div class="home">
        <div class="hd">
          <span class="brand">{#if logoUrl}<img class="lg big" src={logoUrl} alt="" />{/if}<b data-preview="name">{name}</b></span>
          {#if pages.length}<span class="pages">{#each pages as page (page)}<span>{page}</span>{/each}</span>{/if}
        </div>
        {#if tagline}<p class="tg" data-preview="tagline">{tagline}</p>{/if}
        <div class="tb"><b>{SAMPLE.all}</b>{#each tabs as tab (tab)}<span>{tab}</span>{/each}</div>
        {#each rows as row, index (index)}
          <div class="it">
            <span class="th" style:background-image={row.image ? `url("${row.image}")` : null}></span>
            <div class="tx">{#if row.category}<span class="kick">{row.category}</span>{/if}<h5>{row.title}</h5>
              <small>{row.day}{#if row.by} · {#if row.face}<img class="face" src={row.face} alt="" referrerpolicy="no-referrer" />{/if}<span data-preview="by">{row.by}</span>{/if}</small></div>
          </div>
        {/each}
        {#if credit}<div class="cr" data-preview="credit">Made with Azimut{version ? ` ${version}` : ''}</div>{/if}
      </div>
    {:else}
      <div class="feed">
        <div class="fh">{#if logoUrl}<img class="lg" src={logoUrl} alt="" />{/if}<b data-preview="name">{name}</b><span class="rss">RSS</span></div>
        {#if tagline}<div class="fd" data-preview="tagline">{tagline}</div>{/if}
        {#each rows as row, index (index)}
          <div class="fi"><span class="dot" aria-hidden="true"></span><span>{row.title}<small>{row.day}</small></span></div>
        {/each}
      </div>
    {/if}
  </figure>
</div>

<style>
  .preview { min-width: 0; }
  .switch { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
  .switch button { padding: 2px 10px; border: 1px solid var(--border); border-radius: 99px; background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
    transition: color 0.12s var(--ease), border-color 0.12s var(--ease); }
  .switch button:hover { color: var(--text-1); border-color: var(--border-strong); }
  .switch button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .switch button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* a page of the site is paper and ink whatever the app's theme: a reader's browser, not Azimut */
  .paper { --ink: #1f2023; --ink-2: #3d4046; --muted: #62676f; --rule: #dedad3; --tint: #f6f4f0; --site: #1f4e79;
    margin: 0; min-height: 252px; overflow: hidden; border: 1px solid var(--border-strong); border-radius: 8px; background: #fff; color: var(--ink);
    font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif; box-shadow: var(--shadow-1); }
  .lg { flex: none; width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
  .lg.big { width: 34px; height: 34px; }
  b { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .kick { display: block; color: var(--site); font: 700 0.6rem/1.2 system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }

  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--rule); background: rgba(255, 255, 255, 0.94);
    font: 500 0.8rem/1 system-ui, sans-serif; }
  .back { margin-left: auto; flex: none; color: var(--muted); }
  /* the site's own bar, which Azimut does not draw: its place, marked */
  .bar.own { border-bottom-style: dashed; background: repeating-linear-gradient(135deg, #fff 0 6px, var(--tint) 6px 12px); }
  .own-file { overflow: hidden; color: var(--ink); font: 500 0.72rem/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; white-space: nowrap;
    text-overflow: ellipsis; }
  .art { padding: 18px 20px 20px; }
  .art h4 { margin: 6px 0 4px; color: var(--ink); font: 700 1.15rem/1.2 system-ui, sans-serif; letter-spacing: -0.01em; text-transform: none; }
  .meta { margin: 0 0 12px; color: var(--muted); font: 400 0.68rem system-ui, sans-serif; }
  .ln { height: 7px; margin-top: 8px; border-radius: 3px; background: #ecebe7; }

  .home { padding: 16px 18px 12px; }
  .hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .brand b { color: var(--ink); font: 700 1.05rem/1.1 system-ui, sans-serif; letter-spacing: -0.02em; }
  .pages { display: flex; flex: none; gap: 10px; color: var(--ink-2); font: 400 0.66rem system-ui, sans-serif; }
  .tg { margin: 8px 0 0; overflow: hidden; color: var(--ink-2); font-size: 0.78rem; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2;
    line-clamp: 2; -webkit-box-orient: vertical; }
  .tb { display: flex; gap: 5px; margin: 12px 0 4px; overflow: hidden; font: 500 0.62rem/1 system-ui, sans-serif; white-space: nowrap; }
  .tb > * { padding: 4px 8px; border: 1px solid var(--rule); border-radius: 99px; color: var(--ink-2); font-weight: 500; }
  .tb b { border-color: var(--ink); background: var(--ink); color: #fff; overflow: visible; }
  .it { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; align-items: center; margin-top: 10px; }
  .th { height: 38px; border-radius: 3px; background: var(--tint) center / cover no-repeat; }
  .tx { min-width: 0; }
  .it h5 { margin: 1px 0 0; overflow: hidden; color: var(--ink); font: 700 0.78rem/1.25 system-ui, sans-serif; white-space: nowrap; text-overflow: ellipsis;
    letter-spacing: 0; text-transform: none; }
  .it small, .fi small { display: block; color: var(--muted); font: 400 0.64rem system-ui, sans-serif; }
  .it .face { width: 1.1em; height: 1.1em; margin-right: 0.3em; border-radius: 50%; object-fit: cover; vertical-align: -0.25em; }
  .cr { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--rule); color: var(--muted); font: 400 0.64rem system-ui, sans-serif; text-align: center; }

  .feed { padding: 14px 16px; font-family: system-ui, sans-serif; }
  .fh { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
  .rss { margin-left: auto; flex: none; padding: 1px 5px; border-radius: 3px; background: #f3a33a; color: #fff; font-size: 0.56rem; font-weight: 700; letter-spacing: 0.05em; }
  .fd { margin: 3px 0 10px 28px; color: var(--muted); font-size: 0.7rem; line-height: 1.4; }
  .fi { display: flex; gap: 8px; align-items: baseline; padding: 8px 0 0 10px; margin-top: 8px; border-top: 1px solid #eee; font-size: 0.76rem; line-height: 1.3; }
  .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--site); transform: translateY(-1px); }
</style>
