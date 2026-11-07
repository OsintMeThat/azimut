import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROOF_SLIDES_HELP } from './proofSlidesHelp.js';

/** Where the slides speak: the strip, the page of a scene to prove, and the composer. */
const sources = () => ['../tools/proof/ProofSlides.svelte', '../tools/proof/DraftPage.svelte', '../tools/ProofComposer.svelte']
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');

describe('what Geo Proof\'s slides say on hover', () => {
  it('says one short clause per control, in the terse register of the app', () => {
    for (const [key, text] of Object.entries(PROOF_SLIDES_HELP)) {
      expect(text, key).toMatch(/^[A-Z]/);
      expect(text, key).not.toMatch(/\.$/);
      expect(text, key).not.toContain('—');
      expect(text.length, key).toBeLessThanOrEqual(80);
    }
  });

  it('has no text left that no control shows', () => {
    const code = sources();
    for (const key of Object.keys(PROOF_SLIDES_HELP)) expect(code.includes(`HELP.${key}`), key).toBe(true);
  });

  it('names the keys that move between slides', () => {
    expect(PROOF_SLIDES_HELP.previous).toContain('Alt+←');
    expect(PROOF_SLIDES_HELP.next).toContain('Alt+→');
  });
});
