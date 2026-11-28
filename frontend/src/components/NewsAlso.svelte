<script>
  /**
   * What's new's "And also" page, laid out to be read at a glance: one change that may
   * need a word first (`update`), a row for what is worth seeing (`models`, vehicle models
   * drawn by the icon library itself, seen at an angle), a tile per smaller change
   * (`tiles`: the tool and what changed in it, a few words) and, with `kofi`, the tip:
   * Azimut is free, and the button opens Ko-fi in a tab of its own, so the reading goes on.
   */
  import Icon from './Icon.svelte';
  import { KOFI_PITCH, KOFI_URL } from '../lib/support.js';
  import { loadModels, modelsNow } from '../lib/icons/loadModels.svelte.js';
  import { MODEL_VIEWS } from '../lib/icons/modelMeta.js';

  let { page } = $props();

  const ANGLED = MODEL_VIEWS.find((view) => view.id === 'angled') ?? MODEL_VIEWS[0];

  $effect(() => {
    if (page.models && !modelsNow()) loadModels();
  });

  const fleet = $derived.by(() => {
    const engine = page.models ? modelsNow() : null;
    if (!engine) return [];
    return page.models.fleet
      .map(([id, colour]) => {
        const model = engine.modelById(id);
        return model ? engine.modelSvg(model, { px: 48, heading: ANGLED.heading, tilt: ANGLED.tilt, colour }) : '';
      })
      .filter(Boolean);
  });
</script>

<div class="also">
  {#if page.update}
    <p class="update">
      <span class="glyph"><Icon name={page.update.icon} size={18} /></span>
      <span>{page.update.text}<small>{page.update.more}</small></span>
    </p>
  {/if}
  {#if page.models}
    <div class="models">
      <span><b>{page.models.name}</b>{page.models.text}</span>
      <span class="fleet" aria-hidden="true">
        {#each fleet as drawing, i (i)}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- drawn by lib/icons/paint.js from the app's own numbers -->
          <span>{@html drawing}</span>
        {/each}
      </span>
    </div>
  {/if}
  {#if page.tiles?.length}
    <ul class="tiles">
      {#each page.tiles as tile (tile.name)}
        <li>
          <span class="glyph"><Icon name={tile.icon} size={16} /></span>
          <span><b>{tile.name}</b>{tile.text}</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if page.kofi && KOFI_URL}
    <div class="kofi">
      <span class="heart"><Icon name="heart" size={16} /></span>
      <span class="say"><strong>{KOFI_PITCH.title}</strong><span>{KOFI_PITCH.line}</span></span>
      <a href={KOFI_URL} target="_blank" rel="noreferrer"><Icon name="heart" size={13} /> Tip on Ko-fi</a>
    </div>
  {/if}
</div>

<style>
  .also {
    /* a set width: the room it sits in shrinks to what it holds */
    width: 720px;
    max-width: 100%;
    height: var(--spot-h, 420px);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 9px;
    overflow: auto;
  }
  .glyph {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    color: var(--text-1);
  }
  .update {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    padding: 7px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-1));
    border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent);
    font-size: var(--fs-md);
    color: var(--text-1);
  }
  .update .glyph {
    width: 32px;
    height: 32px;
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  small {
    display: block;
    margin-top: 1px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .models {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 60px;
    padding: 6px 12px;
    border-radius: 10px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  b {
    display: block;
    font-weight: 600;
    font-size: var(--fs-md);
    color: var(--text-1);
  }
  .fleet {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  .fleet span {
    display: block;
    width: 48px;
    height: 48px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tiles li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 9px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    font-size: var(--fs-sm);
    line-height: 1.25;
    color: var(--text-2);
  }
  .kofi {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px 8px 12px;
    border-radius: 10px;
    background: linear-gradient(120deg, color-mix(in srgb, #ff5e5b 16%, var(--bg-1)), color-mix(in srgb, var(--accent) 14%, var(--bg-1)));
    border: 1px solid color-mix(in srgb, #ff5e5b 40%, transparent);
  }
  .heart {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #ff5e5b;
    color: #fff;
  }
  .heart :global(svg) {
    fill: currentColor;
    animation: beat 2.4s ease-in-out infinite;
  }
  .say {
    flex: 1;
    min-width: 0;
  }
  .say strong {
    display: block;
    font-size: var(--fs-md);
    color: var(--text-1);
  }
  .say span {
    display: block;
    margin-top: 1px;
    font-size: var(--fs-xs);
    line-height: 1.35;
    color: var(--text-2);
  }
  .kofi a {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 13px;
    border-radius: 999px;
    background: #ff5e5b;
    color: #fff;
    font-size: var(--fs-sm);
    font-weight: 700;
    text-decoration: none;
  }
  .kofi a :global(svg) {
    fill: currentColor;
  }
  .kofi a:hover {
    filter: brightness(1.08);
  }
  @keyframes beat {
    0%,
    60%,
    100% {
      transform: scale(1);
    }
    10% {
      transform: scale(1.18);
    }
    20% {
      transform: scale(0.96);
    }
    30% {
      transform: scale(1.1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .heart :global(svg) {
      animation: none;
    }
  }
</style>
