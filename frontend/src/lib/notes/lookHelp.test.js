import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { LOOK_HELP } from './lookHelp.js';

/** The Notebook's own sources: the tool and its parts. */
const sources = () => {
  const dir = new URL('../../tools/notebook/', import.meta.url);
  const files = readdirSync(dir).filter((file) => file.endsWith('.svelte')).map((file) => new URL(file, dir));
  files.push(new URL('../../tools/Notebook.svelte', import.meta.url));
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
};

describe('what the print settings say on hover', () => {
  it('says one short clause per setting, in the terse register of the app', () => {
    for (const [key, text] of Object.entries(LOOK_HELP)) {
      expect(text, key).toMatch(/^[A-Z]/);
      expect(text, key).not.toMatch(/\.$/);
      expect(text, key).not.toContain('—');
      expect(text.length, key).toBeLessThanOrEqual(100);
    }
  });

  it('has no text left that no control shows', () => {
    const code = sources();
    for (const key of Object.keys(LOOK_HELP)) expect(code.includes(`LOOK_HELP.${key}`), key).toBe(true);
  });

  it('titles every control of the Look panel', () => {
    const panel = readFileSync(new URL('../../tools/notebook/LookControl.svelte', import.meta.url), 'utf8');
    const markup = panel.slice(panel.indexOf('</script>'));
    const controls = tags(markup, /<(input|button|select)\b/g);
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) expect(control, control).toMatch(/\btitle=/);
  });
});

/** Every opening tag a pattern starts, whole: braces hold `=>` without ending the tag. */
function tags(markup, start) {
  const found = [];
  for (const match of markup.matchAll(start)) {
    let depth = 0;
    let end = match.index;
    for (; end < markup.length; end += 1) {
      const char = markup[end];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    found.push(markup.slice(match.index, end + 1));
  }
  return found;
}
