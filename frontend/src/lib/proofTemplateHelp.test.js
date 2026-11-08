import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROOF_TEMPLATE_HELP } from './proofTemplateHelp.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const editor = read('../components/ProofTemplateEditor.svelte');
const composer = read('../tools/ProofComposer.svelte');

describe('what a proof template\'s settings say on hover', () => {
  it('says one short clause per setting, in the terse register of the app', () => {
    for (const [key, text] of Object.entries(PROOF_TEMPLATE_HELP)) {
      expect(text, key).toMatch(/^[A-Z]/);
      expect(text, key).not.toMatch(/\.$/);
      expect(text, key).not.toContain('—');
      expect(text.length, key).toBeLessThanOrEqual(90);
    }
  });

  it('has no text left that no setting shows', () => {
    for (const key of Object.keys(PROOF_TEMPLATE_HELP)) {
      expect(editor.includes(`HELP.${key}}`), key).toBe(true);
    }
  });

  it('leaves no setting row without one', () => {
    const rows = [...editor.matchAll(/<(?:div|label) class="pte-(?:row|slider|check)"([^>]*)>/g)];
    expect(rows.length).toBeGreaterThan(20);
    for (const [row, attrs] of rows) expect(attrs, row).toContain('title={HELP.');
  });

  it('says the same of the Azimut mark in Geo Proof\'s Style tab', () => {
    for (const key of ['mark', 'markCorner', 'markSize', 'markShow']) {
      expect(composer, key).toContain(`PROOF_TEMPLATE_HELP.${key}`);
    }
  });
});
