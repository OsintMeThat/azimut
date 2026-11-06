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

  it('opens the survivor while preserving the original wording and escaping its label', () => {
    const source = '[[entity:old|Earlier name]]';
    const html = markdownHtml(source, {
      entities: [{ id: 'kept', label: 'Kept "subject" <test>' }],
      redirects: { old: { id: 'kept', label: 'Earlier name' } },
    });
    expect(html).toContain('data-entity-id="kept"');
    expect(html).toContain('Merged into Kept &quot;subject&quot; &lt;test&gt;');
    expect(html).toContain('>Earlier name</a>');
    expect(markdownHtml(source, { redirects: { old: { id: 'gone' } } }))
      .toContain('Reference unavailable');
  });

  it('sizes and aligns images without allowing unsafe values', () => {
    const html = markdownHtml('![Map](/map.png){width=50% align=center}');
    expect(html).toContain('class="markdown-image align-center"');
    expect(html).toContain('style="width: 50%"');

    const invalid = markdownHtml('![Map](/map.png){width=99999px align=diagonal}');
    expect(invalid).toContain('class="markdown-image align-left"');
    expect(invalid).not.toContain('width:');
    // a place written is kept; none written takes the block's, as the PDF does
    expect(invalid).toContain('data-unaligned="true"');
    expect(html).not.toContain('data-unaligned');
    expect(markdownHtml('![Map](/map.png){align=left}')).not.toContain('data-unaligned');
  });

  it('applies alignment blocks to rendered Markdown content', () => {
    const html = markdownHtml('::: center\n**Centred text**\n:::');
    expect(html).toContain('<div class="markdown-align align-center">');
    expect(html).toContain('<strong>Centred text</strong>');
  });

  it('sets a block named for a corner of the cover on its side', () => {
    for (const [name, side] of [['top-left', 'left'], ['bottom-left', 'left'], ['top-right', 'right'], ['bottom-right', 'right']]) {
      const html = markdownHtml(`::: ${name}\n**Mark**\n:::`);
      expect(html, name).toContain(`<div class="markdown-align align-${side}">`);
      expect(html, name).toContain('<strong>Mark</strong>');
    }
    // a picture in it takes the side's place when its line writes none
    expect(markdownHtml('::: top-right\n![Logo](/logo.png)\n:::')).toContain('align-right');
    // anything else after the colons is text
    expect(markdownHtml('::: top\nHello\n:::')).not.toContain('markdown-align');
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

  it('shows a picture\'s caption under it, as the PDF prints it', () => {
    const entities = [{ id: 'e_image', label: 'Map', type: 'media', attrs: { path: 'media/map.png', kind: 'image' } }];
    const html = markdownHtml('[[media:e_image|Map]]{width=50% align=center caption="Smoke over the <port>"}', { caseId: 'case-1', entities });
    expect(html).toContain('style="width: 50%"');
    expect(html).toContain('<span class="markdown-caption align-center">Smoke over the &lt;port&gt;</span>');
    // the words of a caption are not a size
    const worded = markdownHtml('[[media:e_image|Map]]{caption="width=10% of the quay"}', { caseId: 'case-1', entities });
    expect(worded).not.toContain('width: 10%');
    expect(worded).toContain('width=10% of the quay</span>');
  });

  it('shows an image\'s title as its caption, unless a caption is written', () => {
    expect(markdownHtml('![Map](/map.png "Pier at dawn")')).toContain('<span class="markdown-caption align-left">Pier at dawn</span>');
    const both = markdownHtml('![Map](/map.png "Pier at dawn"){caption="The pier"}');
    expect(both).toContain('>The pier</span>');
    expect(both).not.toContain('>Pier at dawn</span>');
    expect(markdownHtml('![Map](/map.png){width=50%}')).not.toContain('markdown-caption');
  });

  it('draws the app\'s logo, the analyst\'s and their signature from this computer, or says one is not set', () => {
    const azimut = markdownHtml('![Azimut](azimut:logo){width=25% align=center}');
    expect(azimut).toContain('src="/api/notes/pictures/logo"');
    expect(azimut).toContain('class="markdown-image align-center builtin-logo"');
    expect(azimut).toContain('style="width: 25%"');
    // neither of the analyst's two is asked for until Settings says it is there
    expect(markdownHtml('![Logo](azimut:my-logo){width=25%}')).toContain('No logo set in Settings › Publishing');
    expect(markdownHtml('![Logo](azimut:my-logo)')).not.toContain('<img');
    const identity = { name: '', role: '', organisation: '', logo: true, signature: true, rev: 3 };
    expect(markdownHtml('![Logo](azimut:my-logo){width=25%}', { identity })).toContain('src="/api/notes/pictures/my-logo?v=3"');
    expect(markdownHtml('![Signature](azimut:my-signature)', { identity })).toContain('src="/api/notes/pictures/my-signature?v=3"');
    expect(markdownHtml('![Signature](azimut:my-signature)')).toContain('No signature set in Settings › Publishing');
    // anything else under the scheme is no picture of the app's
    expect(markdownHtml('![X](azimut:other)')).not.toContain('/api/notes/pictures');
  });
});

describe('mermaid fences', () => {
  it('wraps the diagram source instead of rendering it as code', () => {
    const html = markdownHtml('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(html).toContain('<div class="mermaid-diagram"><pre class="mermaid-source">');
    expect(html).not.toContain('language-mermaid');
    expect(html).toContain('flowchart LR');
  });

  it('escapes the source so a diagram cannot inject markup', () => {
    const html = markdownHtml('```mermaid\nflowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B\n```');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('leaves other fenced languages alone', () => {
    expect(markdownHtml('```mermaidjs\nnot a diagram\n```')).toContain('language-mermaidjs');
    expect(markdownHtml('```\nplain\n```')).toContain('<pre><code>');
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
