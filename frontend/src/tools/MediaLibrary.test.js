import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MediaLibrary.svelte', import.meta.url), 'utf8');

function cssBlock(selector) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('\n  }', start);
  return end < 0 ? '' : source.slice(start, end);
}

describe('Media Library thumbnail layout', () => {
  it('keeps every thumbnail in a fixed frame regardless of source dimensions', () => {
    const thumb = cssBlock('.thumb');

    expect(thumb).toContain('width: 100%;');
    expect(thumb).toContain('aspect-ratio: 16 / 10;');
    expect(thumb).toContain('min-height: 0;');
    expect(thumb).toContain('overflow: hidden;');
    expect(thumb).toContain('flex: 0 0 auto;');
  });

  it('prevents the thumbnail image from contributing intrinsic dimensions', () => {
    const image = cssBlock('.thumb img');

    expect(image).toContain('position: absolute;');
    expect(image).toContain('inset: 0;');
    expect(image).toContain('display: block;');
    expect(image).toContain('min-width: 0;');
    expect(image).toContain('min-height: 0;');
    expect(image).toContain('object-fit: cover;');
  });
});

describe('Media Library thumbnail states', () => {
  it('shows the image only when its thumbnail is ready and not broken', () => {
    // the ready branch is gated on thumb_state and the broken-thumb fallback set
    expect(source).toContain("item.thumb_state === 'ready' && !brokenThumbs.has(item.path)");
    // a broken <img> reports once into brokenThumbs rather than retrying
    expect(source).toContain('onerror={() => (brokenThumbs = new Set(brokenThumbs).add(item.path))}');
    // lazy + async decode per the doc's UI failure behaviour
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('decoding="async"');
  });

  it('renders a generating placeholder and a retry affordance for failures', () => {
    expect(source).toContain("item.thumb_state === 'queued' || item.thumb_state === 'running'");
    expect(source).toContain('Generating…');
    expect(source).toContain("item.thumb_state === 'failed'");
    expect(source).toContain('regenerateThumbs(item.path)');
  });

  it('polls while thumbnails are pending and only while the tool is visible', () => {
    expect(source).toContain("i.thumb_state === 'queued' || i.thumb_state === 'running'");
    expect(source).toContain("if (!thumbsPending || uiState.tool !== 'media' || !caseState.current) return;");
    expect(source).toContain('/media/thumbnails/regenerate');
  });

  it('repeats the poll (not a one-shot timer that leaves a slow thumbnail stuck)', () => {
    // a self-repeating poll, so a thumbnail slower than one tick still resolves
    // without a page reload; the effect alone would not re-arm while pending
    expect(source).toContain('pollWhile(() => thumbsPending, () => refresh(), 1500)');
    expect(source).not.toContain('setTimeout(() => refresh()');
  });
});

describe('Media Library bounded loading', () => {
  it('browses via the bounded /media/page endpoint, not the unbounded list', () => {
    expect(source).toContain('createPagedList');
    expect(source).toContain('buildMediaQuery(caseState.current?.id');
    // the browse view must not fetch the whole media list on mount
    expect(source).not.toMatch(/api\.get\(`\/api\/cases\/\$\{[^}]+\}\/media`\)/);
  });

  it('shares the SearchInput and pages the rest in with Show more', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain('pl.setQuery(query)');
    expect(source).toContain('{#if pl.hasMore}');
    expect(source).toContain('pl.loadMore()');
  });

  it('clears the previous case before loading the next', () => {
    expect(source).toContain('pl.clear()');
  });
});

describe('Media Library gated-download cookie affordance', () => {
  it('keeps the first attempt cookie-less and only opts in on retry', () => {
    // default download path never asks for cookies (local-first)
    expect(source).toContain('async function startDownload(target, index = null, title = null, useCookies = false)');
    expect(source).toContain('use_cookies: useCookies');
  });

  it('surfaces a login wall as the cookie prompt, not a plain error', () => {
    expect(source).toContain("status.status === 'done' && status.result?.needs_auth");
    expect(source).toContain('authPrompt = {');
    expect(source).toContain('platform: status.result.platform');
    expect(source).toContain('guidance: status.result.guidance');
  });

  it('states plainly that it borrows an existing login and never a password', () => {
    expect(source).toContain("already signed in to this site");
    expect(source).toContain('it never asks for a password');
  });

  it('retries with a saved browser source and re-downloads signed in', () => {
    expect(source).toContain("download_cookies: { source: 'browser', browser: authPrompt.browser }");
    expect(source).toContain('startDownload(url, index, title, true)');
  });

  it('offers the cookies.txt file fallback', () => {
    expect(source).toContain("await api.post('/api/settings/cookies-file', form)");
    expect(source).toContain('Use a cookies.txt file');
  });

  it('blocks the browser read for Chromium on Windows and steers to the file', () => {
    expect(source).toContain("authPrompt.guidance === 'windows-chromium'");
    expect(source).toContain("authPrompt.platform === 'win32' && CHROMIUM_BROWSERS.has(authPrompt.browser)");
    expect(source).toContain('disabled={authPrompt.busy || chromiumBlocked}');
  });
});
