import { describe, expect, it } from 'vitest';
import { PAGES_CARD, PAGES_INTRO, PAGES_PUBLIC, PAGES_SIGNUP, PAGES_STEPS, PAGES_UPDATE } from './githubPagesSetup.js';

/**
 * The steps the export dialog shows, which the folder's HOW-TO-PUBLISH.md holds too
 * (`tests/test_notes_web.py` holds the server's copy to these words).
 */
describe('how to put a web folder on GitHub Pages', () => {
  it('walks a first-timer through it, free, with no command line', () => {
    expect(PAGES_INTRO).toContain('free');
    expect(PAGES_INTRO).toContain('no command line');
    expect(PAGES_PUBLIC).toMatch(/^A Pages site is public/);
    expect(PAGES_SIGNUP).toBe('https://github.com/signup');
    const steps = PAGES_STEPS.join(' ');
    for (const said of ['New repository', 'Public', 'Add file › Upload files', 'Commit changes', 'Settings › Pages',
      'Deploy from a branch', 'main and / (root)', 'about a minute', 'https://your-name.github.io/articles/']) {
      expect(steps, said).toContain(said);
    }
    expect(PAGES_STEPS.join(' ')).toContain('Address it will live at');
    expect(PAGES_UPDATE).toContain('again');
    expect(PAGES_CARD).toContain('picture card');
    expect(Object.isFrozen(PAGES_STEPS)).toBe(true);
  });

  it('says each step in plain sentences, with no markup and no em-dash', () => {
    for (const text of [PAGES_INTRO, PAGES_PUBLIC, ...PAGES_STEPS, PAGES_UPDATE, PAGES_CARD]) {
      expect(text).toMatch(/^[A-Z]/);
      expect(text).toMatch(/\.$/);
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/[`*_[\]<>{}]/);
    }
  });
});
