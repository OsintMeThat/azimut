<script>
  /**
   * Articles: what the site holds, read on a press (`ArticleList.svelte`), the three kinds a note can
   * be on the site, the categories the read found with the pages that list them, and the pages every
   * site should have (`PagesCard.svelte`). The panel shows the read the session holds and asks
   * nothing itself.
   */
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import {
    CATEGORIES_NONE, CATEGORIES_NOTE, CATEGORIES_SAID, CATEGORIES_TITLE, CATEGORIES_UNREAD, HUB_LEADS, KINDS, KINDS_NOTE, categoryCountSaid,
    categoryPagesSaid,
  } from '../../../lib/websiteSetup.js';
  import ArticleList from './ArticleList.svelte';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';
  import KindBadge from './KindBadge.svelte';
  import PagesCard from './PagesCard.svelte';

  let { active = false, ready = false, github = null, readKey = '' } = $props();

  const [title, sub] = HUB_LEADS.articles;
  const read = $derived(siteRead.data);
</script>

<HubPanel id="articles" {active} {title} {sub}>
  <ArticleList {ready} {github} {readKey} />

  <div class="kinds hub-gap">
    {#each KINDS as [kind, said] (kind)}
      <HubCard><p class="kind-head"><KindBadge {kind} /></p><p>{said}</p></HubCard>
    {/each}
  </div>
  <p class="hub-hint kinds-note">{KINDS_NOTE}</p>

  <div class="hub-grid pair">
    <HubCard title={CATEGORIES_TITLE} label={CATEGORIES_TITLE}>
      <p>{CATEGORIES_SAID}</p>
      {#if !read || read.truncated || !read.categories.length}
        <p class="cats-none">{!read || read.truncated ? CATEGORIES_UNREAD : CATEGORIES_NONE}</p>
      {:else}
        <ul class="cats">
          {#each read.categories as category (category.name)}
            <li>
              <span class="name" title={category.name}>{category.name}</span>
              <span class="count">{categoryCountSaid(category.count)}</span>
              <span class="pg" class:none={!category.pages.length}>{categoryPagesSaid(category.pages)}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="hub-hint foot">{CATEGORIES_NOTE}</p>
    </HubCard>
    <PagesCard />
  </div>
</HubPanel>

<style>
  .kinds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .kind-head { line-height: 1; }
  .kinds-note { margin: 8px 2px 0; }
  .pair { margin-top: 18px; }
  .cats { list-style: none; margin: 10px 0 0; padding: 0; }
  .cats li { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name count' 'pg pg'; gap: 1px 10px; align-items: baseline;
    padding: 7px 0; border-top: 1px solid var(--border); }
  .cats li:first-child { border-top: 0; }
  .name { grid-area: name; overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); white-space: nowrap; text-overflow: ellipsis; }
  .count { grid-area: count; color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; }
  .pg { grid-area: pg; color: var(--text-2); font-family: var(--font-mono); font-size: 0.68rem; overflow-wrap: anywhere; }
  .pg.none { color: var(--text-3); font-family: inherit; font-size: var(--fs-xs); font-style: italic; }
  .cats-none { margin-top: 10px; color: var(--text-3); font-size: var(--fs-xs); }
  .foot { margin-top: 10px; }
  @container hub (max-width: 560px) { .kinds { grid-template-columns: minmax(0, 1fr); } }
</style>
