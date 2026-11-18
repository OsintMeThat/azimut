import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PASSWORD_WHERE, WORDPRESS_COM, WORDPRESS_FIELDS, WORDPRESS_FREE, siteHost, webLink, wordpressReady,
} from './wordpressSetup.js';

const SETTINGS = readFileSync(new URL('../tools/settings/WordPressSettings.svelte', import.meta.url), 'utf8');
const DIALOG = readFileSync(new URL('../tools/notebook/WordPressDraft.svelte', import.meta.url), 'utf8');

describe('how a WordPress site is connected', () => {
  it('says each field, what to type and where WordPress shows it', () => {
    expect(WORDPRESS_FIELDS.map(([name]) => name)).toEqual(['Site address', 'Username', 'Application password']);
    const password = WORDPRESS_FIELDS[2][1];
    expect(password).toContain('Users › Profile');
    expect(password).toContain('Add Application Password');
    expect(PASSWORD_WHERE).toBe('Users › Profile › Application Passwords');
    for (const [, said] of WORDPRESS_FIELDS) expect(said).not.toContain('—');
  });

  it('says it is free, built in, and a draft only, and what WordPress.com needs', () => {
    expect(WORDPRESS_FREE).toMatch(/^Free/);
    expect(WORDPRESS_FREE).toContain('5.6');
    expect(WORDPRESS_FREE).toContain('drafts');
    expect(WORDPRESS_COM).toContain('OAuth');
  });

  it('is read by Settings and by the export dialog alike', () => {
    for (const source of [SETTINGS, DIALOG]) {
      expect(source).toContain("from '../../lib/wordpressSetup.js'");
      expect(source).toContain('WORDPRESS_FIELDS');
      expect(source).toContain('WORDPRESS_FREE');
      expect(source).toContain('WORDPRESS_COM');
    }
  });

  it('is ready only with an address, a username and a password kept', () => {
    expect(wordpressReady(null)).toBe(false);
    expect(wordpressReady({ site: 'https://a.org', user: 'desk', password: { set: false } })).toBe(false);
    expect(wordpressReady({ site: 'https://a.org', user: '', password: { set: true } })).toBe(false);
    expect(wordpressReady({ site: 'https://a.org', user: 'desk', password: { set: true, hint: '…6789' } })).toBe(true);
  });

  it('names a site by its host, and keeps only web addresses as links', () => {
    expect(siteHost('https://desk.example.org')).toBe('desk.example.org');
    expect(siteHost('https://example.org/news/')).toBe('example.org/news');
    expect(siteHost('not a url')).toBe('not a url');
    expect(webLink('https://a.org/wp-admin/post.php?post=3&action=edit')).toBe('https://a.org/wp-admin/post.php?post=3&action=edit');
    expect(webLink('javascript:alert(1)')).toBe('');
    expect(webLink('')).toBe('');
  });
});
