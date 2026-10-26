<script>
  /**
   * A column beside the map that docked reference windows share. The map
   * narrows for it rather than being covered; the windows stack at their
   * picture's height, in the order they were opened, the stack centred on the
   * column's height however many it holds. The edge facing the map is a drag
   * handle like the Saved panel's, and Satellite remeasures the map as it moves.
   */
  import { DOCK_W } from '../../lib/refViewers.js';

  let {
    /** 'left' or 'right' of the map. */
    side = 'right',
    width,
    /** A new width, with the row it shares so the store can bound it. */
    onwidth,
    children,
  } = $props();

  const KEY_STEP = 16;

  let el;
  let resizing = $state(false);

  const total = () => el?.parentElement?.clientWidth ?? window.innerWidth;
  // dragging toward the map widens the column
  const toward = $derived(side === 'left' ? 1 : -1);

  function startResize(e) {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection under the cursor
    const startX = e.clientX;
    const startW = width;
    const row = total();
    let next = startW;
    let frame = 0;
    resizing = true;
    // one width a frame, however fast the pointer moves
    const move = (ev) => {
      next = startW + toward * (ev.clientX - startX);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          onwidth?.(next, row);
        });
      }
    };
    const up = () => {
      resizing = false;
      if (frame) cancelAnimationFrame(frame);
      onwidth?.(next, row);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onKey(e) {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    onwidth?.(width + toward * step, total());
  }
</script>

<aside
  class="ref-dock {side}"
  class:resizing
  bind:this={el}
  style:width={`${width}px`}
  aria-label={`References docked on the ${side}`}
>
  <button
    type="button"
    class="rd-edge"
    aria-label="Resize the docked references"
    title="Drag to resize · double-click to reset"
    onpointerdown={startResize}
    ondblclick={() => onwidth?.(DOCK_W, total())}
    onkeydown={onKey}
  ></button>
  {@render children?.()}
</aside>

<style>
  .ref-dock {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-1);
  }
  .ref-dock.right {
    border-left: 1px solid var(--border);
  }
  .ref-dock.left {
    border-right: 1px solid var(--border);
  }
  .ref-dock.resizing {
    user-select: none;
  }
  .rd-edge {
    position: absolute;
    top: 0;
    width: 5px;
    height: 100%;
    z-index: 2;
    cursor: col-resize;
    background: transparent;
    border: none;
    padding: 0;
    transition: background 0.12s;
  }
  .right .rd-edge {
    left: 0;
  }
  .left .rd-edge {
    right: 0;
  }
  .rd-edge:hover,
  .rd-edge:focus-visible,
  .resizing .rd-edge {
    background: var(--accent);
    outline: none;
  }
</style>
