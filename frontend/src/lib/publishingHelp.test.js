import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PUBLISHING_HELP } from './publishingHelp.js';

const TAB = readFileSync(new URL('../tools/settings/PublishingTab.svelte', import.meta.url), 'utf8');

describe('what Settings › Publishing says on hover', () => {
  it('says one short clause per setting, in the terse register of the app', () => {
    for (const [key, text] of Object.entries(PUBLISHING_HELP)) {
      expect(text, key).toMatch(/^[A-Z]/);
      expect(text, key).not.toMatch(/\.$/);
      expect(text, key).not.toContain('—');
      expect(text.length, key).toBeLessThanOrEqual(100);
    }
  });

  it('has no text left that no control shows', () => {
    for (const key of Object.keys(PUBLISHING_HELP)) expect(TAB.includes(`HELP.${key}`), key).toBe(true);
  });

  it('titles every control of the tab', () => {
    const markup = TAB.slice(TAB.indexOf('</script>'));
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
