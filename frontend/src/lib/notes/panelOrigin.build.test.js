// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';

/**
 * The browser test frames the note's panel from a stand-in page of the app's own
 * origin, since it cannot be an extension. That allowance must not ship. Built as a
 * release is built, `import.meta.env.MODE` is `production` and the branch is gone;
 * built under test it is there, which shows the check reads what it should.
 */

const entry = fileURLToPath(new URL('./panelOrigin.js', import.meta.url));

async function built(mode) {
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    mode,
    build: { write: false, minify: true, lib: { entry, formats: ['es'], fileName: 'panelOrigin' } },
  });
  const [result] = Array.isArray(output) ? output : [output];
  return result.output.map((chunk) => chunk.code ?? '').join('\n');
}

describe('the browser test\'s allowance', () => {
  it('is not in a production build', async () => {
    const code = await built('production');
    expect(code).not.toContain('testParent');
    expect(code).not.toMatch(/MODE|import\.meta\.env/);
    expect(code).toContain('chrome-extension://');
  }, 60_000);

  it('is there only under test', async () => {
    expect(await built('test')).toContain('testParent');
  }, 60_000);
});
