<script>
  /**
   * The pages of a PDF, drawn by PDF.js as they come near the view and let go
   * as they leave it, so a long report costs what is on screen.
   *
   * A new PDF is drawn behind the one shown: its pages near the view are drawn
   * first, then the two are swapped at once, so the pages never blink while a
   * note is typed. A press on a page hands its index up.
   */
  import { onDestroy, tick, untrack } from 'svelte';
  import { drawPage, openPdf, releaseCanvas } from '../lib/notes/pdfjs.js';

  let { data = null, onpage = null, onerror = () => {}, onpages = () => {}, label = 'Pages' } = $props();

  const MARGIN = 800;
  const PAD = 18;

  let scroller = $state(null);
  let width = $state(0);
  let sizes = $state([]);

  const slots = new Map();
  const near = new Set();
  let shown = null; // { doc, width, canvases: Map(index → canvas) }
  let loads = 0;
  let observer = null;
  let line = Promise.resolve();
  let gone = false;

  /** One page drawn at a time, so a long PDF never asks for all its pixels at once. */
  function queued(work) {
    const next = line.catch(() => {}).then(work);
    line = next;
    return next;
  }

  $effect(() => {
    const bytes = data;
    if (bytes) untrack(() => void load(bytes));
  });

  async function load(bytes) {
    const ticket = ++loads;
    let doc;
    try {
      doc = await openPdf(bytes);
    } catch (error) {
      if (ticket === loads && !gone) onerror(`The PDF could not be read: ${String(error?.message ?? error).split('\n')[0]}`);
      return;
    }
    if (ticket !== loads || gone) { void doc.destroy?.(); return; }
    try {
      const next = [];
      for (let index = 0; index < doc.numPages; index += 1) {
        const page = await doc.getPage(index + 1);
        const box = page.getViewport({ scale: 1 });
        next.push({ w: box.width, h: box.height });
      }
      const at = pageWidth();
      // what is in view now is drawn from the new PDF before anything changes on screen
      const first = [...near].filter((index) => index < next.length);
      const wanted = first.length ? first : [0, 1].filter((index) => index < next.length);
      const canvases = new Map();
      for (const index of wanted) {
        if (ticket !== loads || gone) break;
        canvases.set(index, await queued(() => drawPage(doc, index, at)));
      }
      if (ticket !== loads || gone) {
        for (const canvas of canvases.values()) releaseCanvas(canvas);
        void doc.destroy?.();
        return;
      }
      const old = shown;
      shown = { doc, width: at, canvases: new Map() };
      sizes = next;
      onpages(next.length);
      await tick();
      for (const [index, canvas] of canvases) place(index, canvas);
      if (old) {
        for (const canvas of old.canvases.values()) releaseCanvas(canvas);
        void old.doc.destroy?.();
      }
      for (const index of near) void ensure(index);
    } catch (error) {
      if (ticket === loads && !gone) onerror(`The PDF could not be drawn: ${String(error?.message ?? error).split('\n')[0]}`);
    }
  }

  function place(index, canvas) {
    const slot = slots.get(index);
    if (!shown || !slot) { releaseCanvas(canvas); return; }
    const old = shown.canvases.get(index);
    if (old && old !== canvas) releaseCanvas(old);
    shown.canvases.set(index, canvas);
    slot.replaceChildren(canvas);
  }

  /** A page near the view is drawn, once per document and width. */
  async function ensure(index) {
    const current = shown;
    if (!current || index >= sizes.length || current.canvases.has(index)) return;
    current.canvases.set(index, null);
    try {
      const canvas = await queued(() => drawPage(current.doc, index, current.width));
      if (shown !== current || !near.has(index)) { releaseCanvas(canvas); if (shown === current) current.canvases.delete(index); return; }
      place(index, canvas);
    } catch {
      if (shown === current) current.canvases.delete(index);
    }
  }

  /** A page far from the view lets its pixels go; its place keeps its size. */
  function let_go(index) {
    const canvas = shown?.canvases.get(index);
    if (!shown || canvas === undefined) return;
    shown.canvases.delete(index);
    releaseCanvas(canvas);
  }

  function pageWidth() {
    const room = (scroller?.clientWidth ?? 0) - PAD * 2;
    return Math.max(160, Math.min(900, room || 520));
  }

  // the pane resized: the pages in view are drawn again at the new width, behind the old ones
  let resizeTimer;
  $effect(() => {
    if (!scroller) return;
    width = pageWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redraw, 160);
    });
    watch.observe(scroller);
    return () => { watch.disconnect(); clearTimeout(resizeTimer); };
  });

  async function redraw() {
    const at = pageWidth();
    width = at;
    if (!shown || Math.abs(at - shown.width) < 2) return;
    const current = shown;
    current.width = at;
    for (const index of [...current.canvases.keys()]) {
      if (!near.has(index)) { let_go(index); continue; }
      try {
        const canvas = await queued(() => drawPage(current.doc, index, at));
        if (shown !== current || current.width !== at) { releaseCanvas(canvas); return; }
        place(index, canvas);
      } catch { /* drawn again when it is next seen */ }
    }
  }

  // which pages are near the view
  $effect(() => {
    if (!scroller) return;
    if (typeof IntersectionObserver === 'undefined') {
      observer = null;
      return;
    }
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = Number(entry.target.dataset.page);
        if (entry.isIntersecting) {
          near.add(index);
          void ensure(index);
        } else {
          near.delete(index);
          let_go(index);
        }
      }
    }, { root: scroller, rootMargin: `${MARGIN}px 0px` });
    for (const slot of slots.values()) observer.observe(slot);
    return () => { observer?.disconnect(); observer = null; };
  });

  /** Each page's place, watched while it is on the page. */
  function slot(node, index) {
    slots.set(index, node);
    observer?.observe(node);
    // no observer to say what is near: every page is
    if (!observer) { near.add(index); void ensure(index); }
    return {
      destroy() {
        observer?.unobserve(node);
        if (slots.get(index) === node) slots.delete(index);
        near.delete(index);
        let_go(index);
      },
    };
  }

  onDestroy(() => {
    gone = true;
    loads += 1;
    if (shown) {
      for (const canvas of shown.canvases.values()) releaseCanvas(canvas);
      void shown.doc.destroy?.();
      shown = null;
    }
  });
</script>

<div class="pages" bind:this={scroller} role="group" aria-label={label} style:--page-pad={`${PAD}px`}>
  {#each sizes as size, index (index)}
    <button type="button" class="sheet" data-page={index} use:slot={index}
      style:width={`${width}px`} style:height={`${Math.round(width * (size.h / size.w))}px`}
      title={onpage ? `Page ${index + 1}: go to it in the note` : `Page ${index + 1}`}
      aria-label={`Page ${index + 1} of ${sizes.length}`}
      onclick={() => onpage?.(index)}></button>
  {/each}
</div>

<style>
  .pages {
    flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; align-items: center; gap: 14px;
    padding: var(--page-pad) var(--page-pad) 40px; background: var(--bg-0, var(--bg-2));
  }
  .sheet {
    flex: none; position: relative; display: block; padding: 0; border: none; border-radius: 2px; background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .35), 0 0 0 1px rgba(0, 0, 0, .12); cursor: pointer; overflow: hidden;
  }
  .sheet:hover { box-shadow: 0 1px 3px rgba(0, 0, 0, .35), 0 0 0 2px var(--accent); }
  .sheet :global(canvas) { display: block; position: absolute; inset: 0; }
</style>
