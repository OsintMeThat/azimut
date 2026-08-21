<script>
  import Icon from '../../components/Icon.svelte';

  let {
    containerEl = $bindable(),
    tool,
    textEdit,
    focusSelect,
    commitTextEdit,
    proofHasContent,
    proofStarted,
    openPicker,
    openNewProofDialog,
  } = $props();
</script>

<div class="canvas-wrap" class:drawing={tool !== 'select'}>
  <div class="konva" bind:this={containerEl}></div>
  {#if textEdit}
    <!-- A textarea, because a label can be two lines: Konva draws the newline,
         so the editor has to be able to hold one. -->
    <textarea
      class="text-edit"
      rows={textEdit.value.split('\n').length}
      style:left={`${textEdit.left}px`}
      style:top={`${textEdit.top}px`}
      style:font-size={`${textEdit.size}px`}
      style:color={textEdit.color}
      bind:value={textEdit.value}
      use:focusSelect
      onblur={() => commitTextEdit(true)}
      onkeydown={(event) => {
        event.stopPropagation();
        // Shift+Enter opens a second line. Enter on its own still ends the edit,
        // the way it did when this held one line only.
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          commitTextEdit(true);
        } else if (event.key === 'Escape') commitTextEdit(false);
      }}
    ></textarea>
  {/if}
  {#if !proofHasContent}
    <div class="empty overlay-empty">
      <div class="empty-icon"><Icon name="proof" size={42} /></div>
      {#if proofStarted}
        <h3>No panels yet</h3>
        <p>Add panels when you are ready.</p>
        <button class="btn" onclick={openPicker}>
          <Icon name="plus" size={15} /> Add panel
        </button>
      {:else}
        <h3>Compose a proof</h3>
        <p>Create a proof to choose its template and starting panels.</p>
        <button class="btn" onclick={openNewProofDialog}>
          <Icon name="plus" size={15} /> New proof
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .canvas-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    background:
      radial-gradient(circle at 1px 1px, rgba(148, 163, 196, 0.07) 1px, transparent 0) 0 0 / 22px 22px,
      var(--bg-0);
  }
  .canvas-wrap.drawing { cursor: crosshair; }
  .konva { position: absolute; inset: 0; }
  .text-edit {
    position: absolute;
    transform: translateY(-2px);
    min-width: 60px;
    padding: 0 2px;
    font-family: system-ui, sans-serif;
    font-weight: 700;
    line-height: 1.2;
    background: rgba(14, 14, 14, 0.85);
    border: 1px dashed var(--accent);
    border-radius: 2px;
    outline: none;
    /* Grows with its lines instead of scrolling, and stays the size the label
       will be: a drag handle in the corner would resize the editor, not the
       text. */
    resize: none;
    overflow: hidden;
    white-space: pre;
  }
  .overlay-empty {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .overlay-empty .btn { pointer-events: auto; }
</style>
