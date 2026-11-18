import { describe, expect, it } from 'vitest';
import {
  CREATE_SAID, GITHUB_FIELDS, GITHUB_FREE, PAGES_BY_HAND, PAGES_CARD, PAGES_INTRO, PAGES_ON_SAID, PAGES_PUBLIC, PAGES_SIGNUP, PAGES_STEPS,
  PAGES_UPDATE, REPO_STEPS, TOKEN_MORE, TOKEN_STEPS, accountProblem, githubReady, newRepositoryLink, pagesSettingsLink,
  shortNameFrom, shortNameOf, shortNameProblem, siteBase, tokenLink,
} from './githubPagesSetup.js';

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

describe('publishing from Azimut to GitHub Pages', () => {
  it('says each field, the token steps and the setup presses in plain sentences', () => {
    const texts = [GITHUB_FREE, TOKEN_MORE, CREATE_SAID, PAGES_ON_SAID, PAGES_BY_HAND, ...TOKEN_STEPS, ...REPO_STEPS,
      ...GITHUB_FIELDS.map(([, said]) => said)];
    for (const text of texts) {
      expect(text).toMatch(/^[A-Z]/);
      expect(text).toMatch(/\.$/);
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/[`*[\]<>{}]/);
    }
    expect(GITHUB_FIELDS.map(([name]) => name)).toEqual(['Account', 'Repository', 'Branch', 'Token']);
    expect(GITHUB_FREE).toContain('Free');
    expect(GITHUB_FREE).toContain('never in a backup');
    const steps = TOKEN_STEPS.join(' ');
    // a token for that one repository, with exactly what publishing needs
    for (const said of ['Fine-grained tokens', 'Only select repositories', 'Contents and Pages', 'Read and write', 'Metadata', 'shows once']) {
      expect(steps, said).toContain(said);
    }
    expect(steps).not.toContain('Administration');
    expect(TOKEN_MORE).toContain('Administration');
    expect(REPO_STEPS).toHaveLength(2);
    expect(PAGES_ON_SAID).toContain('public');
    for (const list of [TOKEN_STEPS, REPO_STEPS, GITHUB_FIELDS]) expect(Object.isFrozen(list)).toBe(true);
  });

  it('links to the token page with Contents and Pages picked, and to a new public repository', () => {
    const token = new URL(tokenLink('octo'));
    expect(token.origin + token.pathname).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(Object.fromEntries(token.searchParams)).toEqual({ name: 'Azimut', description: 'Publish reports to GitHub Pages',
      contents: 'write', pages: 'write', target_name: 'octo' });
    expect(new URL(tokenLink('-bad-')).searchParams.has('target_name')).toBe(false);
    const repo = new URL(newRepositoryLink('octo', 'articles'));
    expect(Object.fromEntries(repo.searchParams)).toEqual({ name: 'articles', visibility: 'public', owner: 'octo' });
    expect(pagesSettingsLink('octo', 'articles')).toBe('https://github.com/octo/articles/settings/pages');
  });

  it('says where the articles live as the server does', () => {
    expect(siteBase('Octo', 'articles')).toBe('https://octo.github.io/articles/');
    expect(siteBase('octo', 'Octo.github.io')).toBe('https://octo.github.io/');
    expect(siteBase('octo', 'articles', 'https://news.example.org/')).toBe('https://news.example.org/');
    expect(siteBase('octo', 'articles', 'http://example.org/articles')).toBe('https://example.org/articles/');
    expect(siteBase('octo', 'articles', 'javascript:alert(1)')).toBe('https://octo.github.io/articles/');
    expect(githubReady({ account: 'octo', repo: 'articles', branch: 'main', token: { set: true } })).toBe(true);
    expect(githubReady({ account: 'octo', repo: 'articles', branch: 'main', token: { set: false } })).toBe(false);
    expect(githubReady(null)).toBe(false);
  });

  it('checks a short name and an account as the server does', () => {
    for (const good of ['port-strike', 'a', 'wadi_sahm-2026', 'x'.repeat(80)]) expect(shortNameProblem(good), good).toBe('');
    for (const bad of ['Port-Strike', 'port strike', '../x', 'a/b', '-x', 'x-', '.x', 'a.b', 'é']) {
      expect(shortNameProblem(bad), bad).toMatch(/^A short name holds/);
    }
    expect(shortNameProblem('')).toMatch(/^Give the article a short name/);
    expect(shortNameProblem('x'.repeat(81))).toBe('A short name is 80 characters at most.');
    expect(accountProblem('octo-cat')).toBe('');
    expect(accountProblem('@octo')).toBe('');
    expect(accountProblem('-octo')).toMatch(/^An account name holds/);
    expect(shortNameOf('Port strike, 3 May — Ḥodeidah')).toBe('port-strike-3-may-hodeidah');
    expect(shortNameOf('...')).toBe('article');
    expect(shortNameOf('The fall of the Bab al-Mandab front, Sep-Nov 2026')).toBe('the-fall-of-the-bab-al-mandab-front-sep-nov-2026');
    expect(shortNameOf('The fall of the Bab al-Mandab front and the coast, Sep-Nov 2026')).toBe('the-fall-of-the-bab-al-mandab-front-and-the');
    expect(shortNameOf('x'.repeat(70))).toBe('x'.repeat(48));
    expect(shortNameFrom('https://desk.example.org/articles/Port-Strike/')).toBe('port-strike');
    expect(shortNameFrom('https://desk.example.org/')).toBe('');
    expect(shortNameFrom('not an address')).toBe('');
  });
});
