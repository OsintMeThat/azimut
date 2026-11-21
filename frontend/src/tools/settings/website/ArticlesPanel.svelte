<script>
  /**
   * Articles: what the site lists, read on a press (`ArticleList.svelte`), the three kinds a note can be
   * on the site, the categories the read found and the pages every site should have
   * (`PagesCard.svelte`). The panel shows the read the session holds and asks nothing itself.
   */
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import {
    CATEGORIES_NONE, CATEGORIES_NOTE, CATEGORIES_SAID, CATEGORIES_TITLE, CATEGORIES_UNREAD, HUB_LEADS, KINDS, KINDS_NOTE,
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

  <div class="kinds">
    {#each KINDS as [kind, said] (kind)}
      <HubCard><span class="kind-title"><KindBadge {kind} /></span><p>{said}</p></HubCard>
    {/each}
  </div>
  <p class="note">{KINDS_NOTE}</p>

  <div class="pair">
    <HubCard title={CATEGORIES_TITLE}>
      <p>{CATEGORIES_SAID}</p>
      {#if !read}
        <p class="hint">{CATEGORIES_UNREAD}</p>
      {:else if !read.categories.length}
        <p class="hint">{CATEGORIES_NONE}</p>
      {:else}
        <ul class="cats">
          {#each read.categories as category (category.name)}
            <li>
              <span>{category.name}</span>
              <span class="n">{category.count} {category.count === 1 ? 'article' : 'articles'}</span>
              <span class="pg">{category.pages.length ? `${category.pages.join(', ')} lists ${category.count === 1 ? 'it' : 'them'}` : 'no page lists it'}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="hint foot">{CATEGORIES_NOTE}</p>
    </HubCard>
    <PagesCard />
  </div>
</HubPanel>

<style>
  .kinds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
  .kind-title { display: block; margin-bottom: 6px; }
  .note { margin: 8px 2px 0; color: var(--text-3); font-size: var(--fs-xs); }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; align-items: start; }
  .cats { list-style: none; margin: 8px 0 0; padding: 0; }
  .cats li { display: grid; grid-template-columns: minmax(0, 1fr) 90px minmax(0, 1fr); gap: 10px; padding: 7px 0; border-top: 1px solid var(--border);
    font-size: var(--fs-sm); align-items: center; color: var(--text-1); }
  .cats li:first-child { border-top: 0; }
  .n { color: var(--text-3); font-size: var(--fs-xs); }
  .pg { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-2); overflow-wrap: anywhere; }
  .foot { margin-top: 8px; }
  @media (max-width: 900px) { .kinds, .pair { grid-template-columns: 1fr; } }
</style>
