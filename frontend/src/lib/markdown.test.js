import { describe, expect, it } from 'vitest';
import { entityReference, markdownHtml, remoteImageUrls } from './markdown.js';

describe('markdownHtml', () => {
  it('renders GitHub-flavored tables, task lists and fenced code', () => {
    const html = markdownHtml('| Name | Value |\n| --- | --- |\n| A | B |\n\n- [x] done\n\n```js\nconst x = 1;\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<pre><code class="language-js">');
  });

  it('removes unsafe HTML and URL schemes', () => {
    const html = markdownHtml('<script>alert(1)</script>\n\n[bad](javascript:alert(1))');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });

  it('renders entity references as clickable local links', () => {
    const source = entityReference({ id: 'e_lead', label: 'Lead' });
    expect(source).toBe('[[entity:e_lead|Lead]]');
    expect(markdownHtml(source, { entities: [{ id: 'e_lead', label: 'Lead' }] }))
      .toContain('data-entity-id="e_lead"');
  });

  it('keeps deleted case references visible as broken', () => {
    expect(markdownHtml('[[entity:e_gone|Deleted lead]]')).toContain('Reference unavailable: Deleted lead');
    expect(markdownHtml('![Deleted image](/files/case-1/media/gone.png)', { caseId: 'case-1' }))
      .toContain('Media unavailable: Deleted image');
  });

  it('sizes and aligns images without allowing unsafe values', () => {
    const html = markdownHtml('![Map](/map.png){width=50% align=center}');
    expect(html).toContain('class="markdown-image align-center"');
    expect(html).toContain('style="width: 50%"');

    const invalid = markdownHtml('![Map](/map.png){width=99999px align=diagonal}');
    expect(invalid).toContain('class="markdown-image align-left"');
    expect(invalid).not.toContain('width:');
  });

  it('applies alignment blocks to rendered Markdown content', () => {
    const html = markdownHtml('::: center\n**Centred text**\n:::');
    expect(html).toContain('<div class="markdown-align align-center">');
    expect(html).toContain('<strong>Centred text</strong>');
  });

  it('applies image options to case media', () => {
    const html = markdownHtml('[[media:e_image|Map]]{width=320px align=right}', {
      caseId: 'case-1',
      entities: [{ id: 'e_image', label: 'Map', type: 'media', attrs: { path: 'media/map.png', kind: 'image' } }],
    });
    expect(html).toContain('src="/files/case-1/media/map.png"');
    expect(html).toContain('class="markdown-image align-right"');
    expect(html).toContain('style="width: 320px"');
  });
});

describe('remoteImageUrls', () => {
  it('reports external inline images but not links or case media', () => {
    const source = [
      '[Website](https://example.com/page)',
      '![Tracker](https://images.example/pixel.png)',
      '![Local](/files/case-1/media/local.png)',
      '[[media:e_local|Filed image]]',
    ].join('\n\n');
    expect(remoteImageUrls(source)).toEqual(['https://images.example/pixel.png']);
  });

  it('deduplicates remote images and recognizes protocol-relative URLs', () => {
    const source = '![A](//images.example/a.png)\n![A again](https://images.example/a.png)';
    expect(remoteImageUrls(source)).toEqual(['https://images.example/a.png']);
  });
});
