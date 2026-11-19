<script module>
  /**
   * The app's own lines in the page it shows, never in an exported file: start where
   * the last page was read to, and say where this one is scrolled to. Inline, which
   * the page's own policy allows, and talking only to the window that holds it.
   */
  export function keptScroll(html, top) {
    const y = Math.max(0, Math.round(Number(top) || 0));
    const script = `<script>(function(){var y=${y};function go(){if(y)window.scrollTo({top:y,behavior:'instant'});}`
      + `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();`
      + `var t;addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){`
      + `parent.postMessage({azimutPage:Math.round(scrollY)},'*');},80);},{passive:true});})();<\/script>`;
    const text = String(html ?? '');
    const end = text.lastIndexOf('</body>');
    return end < 0 ? `${text}${script}` : `${text.slice(0, end)}${script}${text.slice(end)}`;
  }

  /**
   * A press inside the page lands in the page's own document, so a menu or a panel
   * floating over the app never hears it and stays open. Taking the focus is what
   * the app does see: the frame then tells the app it was pressed, as any part of
   * the app would, and every press-outside rule closes what it should.
   */
  export function pressFrame(frame) {
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    frame.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, composed: true }));
    frame.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
  }
</script>

<script>
  /**
   * An HTML page shown as the file reads in a browser, in a frame that can run the
   * page's own script and open its links in a new tab, and reach nothing of the app.
   *
   * Two frames take turns: the one on screen stays while the next is drawn, and the
   * next opens where the reader had scrolled to, so the page does not blink or jump
   * back to its top each time the note changes.
   */
  import { onDestroy, untrack } from 'svelte';

  let { html = '', label = 'The HTML page' } = $props();

  let frames = $state([{ doc: '', ticket: 0 }, { doc: '', ticket: 0 }]);
  let shown = $state(0);
  let ticket = 0;
  let top = 0;
  const elements = $state([]);

  // what each frame has finished loading: a page asked again as the hidden frame holds it
  // (an Undo back to it) loads nothing new there, so it is shown as it stands
  const done = ['', ''];

  $effect(() => {
    const next = html;
    if (!next) return;
    untrack(() => {
      ticket += 1;
      const other = 1 - shown;
      const doc = keptScroll(next, top);
      frames[other] = { doc, ticket };
      if (done[other] === doc) shown = other;
    });
  });

  function loaded(index) {
    done[index] = frames[index].doc;
    if (!frames[index].doc || frames[index].ticket !== ticket) return;
    shown = index;
  }

  function heard(event) {
    if (!elements.some((element) => element?.contentWindow && element.contentWindow === event.source)) return;
    if (event.source !== elements[shown]?.contentWindow) return;
    const y = Number(event.data?.azimutPage);
    if (Number.isFinite(y) && y >= 0) top = y;
  }
  // The window loses the focus to a frame of this page: read once it has moved.
  let focusCheck = 0;
  function left() {
    clearTimeout(focusCheck);
    focusCheck = setTimeout(() => {
      const frame = document.activeElement;
      if (frame && elements.includes(frame)) pressFrame(frame);
    }, 0);
  }
  window.addEventListener('message', heard);
  window.addEventListener('blur', left);
  onDestroy(() => {
    clearTimeout(focusCheck);
    window.removeEventListener('message', heard);
    window.removeEventListener('blur', left);
  });
</script>

<div class="html-page">
  {#each frames as frame, index (index)}
    <iframe bind:this={elements[index]} class:shown={shown === index} title={label} aria-hidden={shown !== index}
      inert={shown !== index} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"
      srcdoc={frame.doc} onload={() => loaded(index)}></iframe>
  {/each}
</div>

<style>
  .html-page { position: relative; flex: 1; min-height: 0; background: #fff; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; background: #fff; visibility: hidden; }
  iframe.shown { visibility: visible; }
</style>
