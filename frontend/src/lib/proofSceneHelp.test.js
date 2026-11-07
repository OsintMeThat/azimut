import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PROOF_SCENE_HELP, PROOF_TIME_HELP, PROOF_TIME_TIPS } from './proofSceneHelp.js';

/** Geo Proof's own sources: the composer and its parts. */
const sources = () => {
  const dir = new URL('../tools/proof/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.svelte')).map((f) => new URL(f, dir));
  files.push(new URL('../tools/ProofComposer.svelte', import.meta.url));
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
};

describe('what Geo Proof\'s scene says on hover', () => {
  it('says one short clause per control, in the terse register of the app', () => {
    for (const [key, text] of Object.entries({ ...PROOF_SCENE_HELP, ...PROOF_TIME_HELP, ...PROOF_TIME_TIPS })) {
      expect(text, key).toMatch(/^[A-Z]/);
      expect(text, key).not.toMatch(/\.$/);
      expect(text, key).not.toContain('—');
      expect(text.length, key).toBeLessThanOrEqual(120);
    }
  });

  it('has no text left that no control shows', () => {
    const code = sources();
    for (const key of Object.keys(PROOF_SCENE_HELP)) {
      // the player takes its words as `help`, Geo Proof's by default (the Collage tool lends it its own)
      expect(code.includes(`PROOF_SCENE_HELP.${key}`) || code.includes(`HELP.${key}`) || code.includes(`help.${key}`), key).toBe(true);
    }
    expect(code).toContain('help={PROOF_TIME_HELP}');
    expect(code).toContain('tips={PROOF_TIME_TIPS}');
  });

  it('points Here at the player, where Inspect points at S and its bar', () => {
    expect(PROOF_TIME_HELP.startHere).toBe('Start at the frame on the player');
    expect(Object.values(PROOF_TIME_HELP).join(' ')).not.toMatch(/\(S\)|Shift\+S|the bar/);
    expect(Object.values(PROOF_TIME_TIPS).join(' ')).not.toMatch(/\bS\b|the bar/);
  });
});
