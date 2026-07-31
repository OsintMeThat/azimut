import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { markdownHtml } from '../lib/markdown.js';

const source = readFileSync(new URL('./UpdateModal.svelte', import.meta.url), 'utf8');

describe('release notes', () => {
  it('renders the release body as Markdown, through the shared renderer', () => {
    expect(source).toContain("import { markdownHtml } from '../lib/markdown.js'");
    expect(source).toContain('markdownHtml(updateState.notes)');
    expect(source).toContain('<div class="notes markdown">{@html notes}</div>');
  });

  it('scrolls a long note inside the pop-up', () => {
    expect(source).toMatch(/\.notes \{[^}]*max-height: 40vh;[^}]*overflow: auto;/s);
  });

  it('turns a release body into headings, lists and links', () => {
    const html = markdownHtml("## What's new\n\n- A [fix](https://example.invalid/pr/1)\n");
    expect(html).toContain("<h2>What&#39;s new</h2>");
    expect(html).toContain('<li>A <a href="https://example.invalid/pr/1" target="_blank" rel="noreferrer">fix</a></li>');
  });

  it('drops HTML a release body should never carry', () => {
    const html = markdownHtml('<script>alert(1)</script>\n\n[bad](javascript:alert(1))');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });

  it('shows nothing when the release has no body', () => {
    expect(source).toContain('{#if updateState.notes}');
  });
});
