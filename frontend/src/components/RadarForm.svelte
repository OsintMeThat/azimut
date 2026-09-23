<script>
  /**
   * The dashboard's "Add a new layer" form for Sentinel-1, field by field.
   *
   * Nobody guesses these answers, and one of them (Data processing) blocks the
   * Save button until it is filled, so the table says what to put in each
   * field and, where it matters, why. The script under it is for the form that
   * offers no predefined product: it only has to be valid.
   */
  import { RADAR_FORM, RADAR_SCRIPT } from '../lib/copernicusSetup.js';

  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(RADAR_SCRIPT);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
</script>

<table class="radar-form" aria-label="Sentinel-1 layer form">
  <tbody>
    {#each RADAR_FORM as [field, value, why] (field)}
      <tr>
        <th scope="row">{field}</th>
        <td><strong>{value}</strong>{#if why}<small>{why}</small>{/if}</td>
      </tr>
    {/each}
  </tbody>
</table>
<details class="script">
  <summary>No predefined product in the list?</summary>
  <p>Paste this in the processing script instead.</p>
  <pre>{RADAR_SCRIPT}</pre>
  <button class="btn btn-sm" onclick={copy}>{copied ? 'Copied' : 'Copy the script'}</button>
</details>

<style>
  .radar-form {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-xs);
  }
  .radar-form th,
  .radar-form td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }
  .radar-form th {
    width: 38%;
    color: var(--text-2);
    font-weight: 500;
  }
  .radar-form strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .radar-form small {
    display: block;
    color: var(--text-3);
    font-size: 10.5px;
  }
  .script {
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .script p {
    margin: 6px 0 4px;
  }
  .script pre {
    margin: 0 0 6px;
    padding: 6px 8px;
    overflow-x: auto;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--text-1);
    font-size: 10.5px;
  }
</style>
