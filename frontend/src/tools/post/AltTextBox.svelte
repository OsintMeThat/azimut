<script>
  /** The post's Alt text box, quiet beside its first picture (lib/postAlt.js). */
  import { ALT_BOX_TITLE } from '../../lib/postAlt.js';

  let { on = false, onchange = () => {} } = $props();
</script>

<label class="alt-box" title={ALT_BOX_TITLE}>
  <input type="checkbox" checked={on} onchange={(event) => onchange(event.currentTarget.checked)} />
  Alt text
</label>

<style>
  .alt-box {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--text-3);
    cursor: pointer;
    user-select: none;
  }
  .alt-box:hover { color: var(--text-2); }
  .alt-box input { margin: 0; accent-color: var(--accent); }
</style>
