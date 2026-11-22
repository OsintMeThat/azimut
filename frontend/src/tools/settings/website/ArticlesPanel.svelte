<script>
  /**
   * Articles: what the site holds, read on a press (`ArticleList.svelte`), where each article's category is
   * picked on its line, the three kinds a note can be on the site, and the pages every site should have
   * (`PagesCard.svelte`). The categories themselves are their own panel (`CategoriesPanel.svelte`). The panel
   * shows the read the session holds and asks nothing itself.
   */
  import { HUB_LEADS, KINDS, KINDS_NOTE } from '../../../lib/websiteSetup.js';
  import ArticleList from './ArticleList.svelte';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';
  import KindBadge from './KindBadge.svelte';
  import PagesCard from './PagesCard.svelte';

  let { active = false, ready = false, github = null, readKey = '', onchange = () => {} } = $props();

  const [title, sub] = HUB_LEADS.articles;
</script>

<HubPanel id="articles" {active} {title} {sub}>
  <ArticleList {ready} {github} {readKey} {onchange} />

  <div class="kinds hub-gap">
    {#each KINDS as [kind, said] (kind)}
      <HubCard><p class="kind-head"><KindBadge {kind} /></p><p>{said}</p></HubCard>
    {/each}
  </div>
  <p class="hub-hint kinds-note">{KINDS_NOTE}</p>

  <div class="hub-grid pair">
    <PagesCard />
  </div>
</HubPanel>

<style>
  .kinds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .kind-head { line-height: 1; }
  .kinds-note { margin: 8px 2px 0; }
  .pair { margin-top: 18px; }
  @container hub (max-width: 560px) { .kinds { grid-template-columns: minmax(0, 1fr); } }
</style>
