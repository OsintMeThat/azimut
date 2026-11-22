<script module>
  /**
   * The app's own lines in the page it shows, never in an exported file: start where
   * the last page was read to, and say where this one is scrolled to. Inline, which
   * the page's own policy allows, and talking only to the window that holds it.
   *
   * The frame made wider or narrower (the pane dragged, the whole screen, a phone's
   * width) keeps the line read at the top of the view where it was, rather than the
   * same number of pixels down a page that wrapped again. The window holding it can
   * send it back to a scroll it read before (`{ azimutScroll }`), kept through the
   * resize still under way.
   */
  export function keptScroll(html, top) {
    const y = Math.max(0, Math.round(Number(top) || 0));
    const script = `<script>(function(){var y=${y};function go(){if(y)window.scrollTo({top:y,behavior:'instant'});}`
      + `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();`
      // the block of the reading across a line near the top of the view (below a bar the page keeps
      // there), never one held still on the screen, and how far into it the line falls
      + `var spot=null,back=null,held=false,s,t;function line(){return Math.min(96,innerHeight/4);}`
      + `function still(n){for(;n&&n!==document.body;n=n.parentElement){var p=getComputedStyle(n).position;if(p==='sticky'||p==='fixed')return true;}return false;}`
      + `function mark(){var all=document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,figure,blockquote,pre,tr,dt,dd'),at=line();`
      + `for(var i=0;i<all.length;i++){var r=all[i].getBoundingClientRect();`
      + `if(r.height&&r.bottom>at&&!still(all[i])){spot={n:all[i],top:r.top,into:r.top<at?(at-r.top)/r.height:0};return;}}spot=null;}`
      + `function keep(){if(back!==null){window.scrollTo({top:back,behavior:'instant'});return;}if(!spot||!spot.n.isConnected)return;`
      + `var r=spot.n.getBoundingClientRect();window.scrollBy({top:r.top-(spot.into?line()-spot.into*r.height:spot.top),behavior:'instant'});}`
      + `function hold(){held=true;clearTimeout(s);s=setTimeout(function(){held=false;back=null;mark();},300);}`
      + `addEventListener('load',function(){if(!held)mark();});`
      + `addEventListener('resize',function(){keep();requestAnimationFrame(keep);hold();});`
      + `addEventListener('message',function(e){if(e.source!==parent||!e.data||typeof e.data.azimutScroll!=='number')return;`
      + `back=Math.max(0,e.data.azimutScroll);keep();hold();});`
      + `addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){if(!held)mark();`
      + `parent.postMessage({azimutPage:Math.round(scrollY)},'*');},80);},{passive:true});`
      // a double-click says the note's line the element comes from, and the word it took, as a TeX viewer does
      + `addEventListener('dblclick',function(e){var n=e.target&&e.target.closest?e.target.closest('[data-line]'):null;if(!n)return;`
      + `var w=String(getSelection?getSelection():'').trim().slice(0,80);`
      + `parent.postMessage({azimutLine:Number(n.getAttribute('data-line')),azimutWord:w},'*');});`
      // a right-click opens the app's menu rather than the browser's: what it is on goes up with it
      + `addEventListener('contextmenu',function(e){var t=e.target,n=t&&t.closest?t.closest('[data-line]'):null,`
      + `a=t&&t.closest?t.closest('a[href]'):null,w='';e.preventDefault();`
      + `try{var r=document.caretRangeFromPoint?document.caretRangeFromPoint(e.clientX,e.clientY):null,`
      + `p=!r&&document.caretPositionFromPoint?document.caretPositionFromPoint(e.clientX,e.clientY):null,`
      + `o=r?r.startContainer:p&&p.offsetNode,k=r?r.startOffset:p&&p.offset;`
      + `if(o&&o.nodeType===3){var x=o.data,i=k,j=k,c=/[\\p{L}\\p{N}'’-]/u;while(i>0&&c.test(x[i-1]))i--;`
      + `while(j<x.length&&c.test(x[j]))j++;w=x.slice(i,j);}}catch(_){}`
      + `var s=String(getSelection?getSelection():'').trim();`
      + `parent.postMessage({azimutMenu:{line:n?Number(n.getAttribute('data-line')):-1,word:w.slice(0,80),`
      + `words:(s||(n?n.innerText:'')).slice(0,4000),href:a&&/^https?:/i.test(a.href)?a.href:'',x:e.clientX,y:e.clientY}},'*');});`
      + `})();<\/script>`;
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

  let { html = '', label = 'The HTML page', online = null, onmenu = null } = $props();

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

  /** How far down the page shown is read, in pixels. */
  export function readTo() {
    return top;
  }

  /** The page shown read from `y` again, and the next one drawn opening there too. */
  export function backTo(y) {
    top = Math.max(0, Number(y) || 0);
    elements[shown]?.contentWindow?.postMessage({ azimutScroll: top }, '*');
  }

  function heard(event) {
    if (!elements.some((element) => element?.contentWindow && element.contentWindow === event.source)) return;
    if (event.source !== elements[shown]?.contentWindow) return;
    const asked = event.data?.azimutMenu;
    if (asked && typeof asked === 'object') {
      // where the pointer is in the window: the frame's own place, and its scale when it is drawn smaller
      const frame = elements[shown];
      const box = frame.getBoundingClientRect();
      const scale = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
      const line = Number(asked.line);
      onmenu?.({
        line: Number.isInteger(line) && line >= 0 ? line : -1,
        word: typeof asked.word === 'string' ? asked.word.slice(0, 80) : '',
        words: typeof asked.words === 'string' ? asked.words.slice(0, 4000) : '',
        href: typeof asked.href === 'string' && /^https?:\/\//i.test(asked.href) ? asked.href : '',
        at: { x: box.left + (Number(asked.x) || 0) * scale, y: box.top + (Number(asked.y) || 0) * scale },
      });
      return;
    }
    const line = Number(event.data?.azimutLine);
    if (Number.isInteger(line) && line >= 0) {
      online?.(line, typeof event.data.azimutWord === 'string' ? event.data.azimutWord.slice(0, 80) : '');
      return;
    }
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
