import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownHtml } from './markdown.js';
import { diagramLegend, diagramPaper, drawMermaidDiagrams, renderMermaidSvg } from './mermaid.js';

function preview(markdown) {
  const { document } = new Window();
  const root = document.createElement('div');
  root.innerHTML = markdownHtml(markdown);
  return root;
}

const drawn = (svg = '<svg id="drawn"></svg>') => vi.fn()
  .mockResolvedValue({ render: vi.fn().mockResolvedValue({ svg }) });

describe('drawMermaidDiagrams', () => {
  it('replaces each diagram wrapper with the drawn SVG', async () => {
    const root = preview('```mermaid\nflowchart LR\n  A --> B\n```');
    const load = drawn();

    expect(await drawMermaidDiagrams(root, { load })).toBe(1);
    const wrapper = root.querySelector('.mermaid-diagram');
    expect(wrapper.innerHTML).toBe('<svg id="drawn"></svg>');
    expect(wrapper.dataset.processed).toBe('true');
  });

  it('passes the unescaped fence source to the renderer', async () => {
    const root = preview('```mermaid\nflowchart LR\n  A --> B & C\n```');
    const render = vi.fn().mockResolvedValue({ svg: '<svg></svg>' });

    await drawMermaidDiagrams(root, { load: async () => ({ render }) });
    expect(render.mock.calls[0][1]).toBe('flowchart LR\n  A --> B & C');
  });

  it('never loads the library when the note holds no diagram', async () => {
    const load = drawn();
    expect(await drawMermaidDiagrams(preview('# Notes\n\n```js\nconst x = 1;\n```'), { load })).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it('skips diagrams it has already drawn', async () => {
    const root = preview('```mermaid\nflowchart LR\n  A --> B\n```');
    const load = drawn();

    await drawMermaidDiagrams(root, { load });
    expect(await drawMermaidDiagrams(root, { load })).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the source visible and flags a diagram it cannot draw', async () => {
    const root = preview('```mermaid\nnot a diagram\n```');
    const load = async () => ({ render: () => Promise.reject(new Error('Parse error\non line 1')) });

    await drawMermaidDiagrams(root, { load });
    const wrapper = root.querySelector('.mermaid-diagram');
    expect(wrapper.classList.contains('mermaid-failed')).toBe(true);
    expect(wrapper.querySelector('.mermaid-error').textContent).toBe('Diagram not drawn: Parse error');
    expect(wrapper.textContent).toContain('not a diagram');
  });

  it('reports a failure to load the library rather than hanging', async () => {
    const root = preview('```mermaid\nflowchart LR\n  A --> B\n```');
    const load = () => Promise.reject(new Error('offline'));

    expect(await drawMermaidDiagrams(root, { load })).toBe(1);
    expect(root.querySelector('.mermaid-error').textContent)
      .toBe('Diagram not drawn: diagram support could not be loaded');
  });
});

describe('renderMermaidSvg', () => {
  const window = new Window();

  afterEach(() => vi.unstubAllGlobals());

  function browser() {
    vi.stubGlobal('DOMParser', window.DOMParser);
    vi.stubGlobal('XMLSerializer', window.XMLSerializer);
  }

  it('gives the diagram the size a canvas can read', async () => {
    browser();
    const render = vi.fn().mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" style="max-width: 320px"></svg>',
    });

    const drawn = await renderMermaidSvg('flowchart LR\n  A --> B', { load: async () => ({ render }) });

    expect(drawn).toMatchObject({ width: 320, height: 180 });
    expect(drawn.svg).toContain('width="320"');
    expect(drawn.svg).toContain('height="180"');
    // The style is what mermaid sizes itself with on screen, and what would
    // shrink the diagram to nothing once it is drawn onto a canvas.
    expect(drawn.svg).not.toContain('max-width');
  });

  it('turns HTML labels off, which an image element cannot rasterise', async () => {
    browser();
    const render = vi.fn().mockResolvedValue({ svg: '<svg viewBox="0 0 10 10"></svg>' });

    await renderMermaidSvg('flowchart LR\n  A --> B', { load: async () => ({ render }) });

    expect(render.mock.calls[0][1]).toContain('"htmlLabels": false');
    expect(render.mock.calls[0][1]).toContain('flowchart LR');
  });

  it('leaves a note’s own config block first, the only place Mermaid reads it', async () => {
    browser();
    const render = vi.fn().mockResolvedValue({ svg: '<svg viewBox="0 0 10 10"></svg>' });
    const block = '---\nconfig:\n  layout: elk\n---\n';

    await renderMermaidSvg(`${block}flowchart LR\n  A --> B`, { load: async () => ({ render }) });

    const sent = render.mock.calls[0][1];
    expect(sent.startsWith(block)).toBe(true);
    expect(sent.indexOf('"htmlLabels": false')).toBeGreaterThan(block.length - 1);
    expect(sent.indexOf('"htmlLabels": false')).toBeLessThan(sent.indexOf('flowchart LR'));
  });

  it('draws the legend a diagram’s comments name under it, and grows to hold it', async () => {
    browser();
    const render = vi.fn().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g class="root"></g></svg>' });
    const source = [
      'flowchart LR', '  A --> B', '  classDef c1 fill:#dde9f8,stroke:#2a78d6,color:#202124', '  classDef c2 fill:#fce7df,stroke:#eb6834,color:#202124',
      '  class A c1', '  class B c2', '  %% legend c1: Houthi side', '  %% legend c2: ‹Government› side',
    ].join('\n');

    const drawn = await renderMermaidSvg(source, { load: async () => ({ render }) });

    const picture = new window.DOMParser().parseFromString(drawn.svg, 'image/svg+xml');
    const legend = picture.querySelector('[data-legend]');
    expect([...legend.querySelectorAll('text')].map((node) => node.textContent)).toEqual(['Houthi side', '<Government> side']);
    expect(legend.querySelector('rect').getAttribute('style')).toContain('fill:#dde9f8;stroke:#2a78d6');
    expect(drawn.width).toBe(400);
    expect(drawn.height).toBeGreaterThan(200);
    expect(picture.documentElement.getAttribute('viewBox')).toBe(`0 0 400 ${drawn.height}`);
    expect(picture.documentElement.hasAttribute('data-background')).toBe(false);
  });

  it('lays a diagram whose config names its page on that page, and says so', async () => {
    browser();
    const render = vi.fn().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 300 100"><g class="root"></g></svg>' });
    const source = '---\nconfig:\n  theme: base\n  themeVariables:\n    darkMode: true\n    background: "#12161B"\n---\nflowchart LR\n  A --> B';

    const drawn = await renderMermaidSvg(source, { load: async () => ({ render }) });

    const picture = new window.DOMParser().parseFromString(drawn.svg, 'image/svg+xml').documentElement;
    expect(picture.getAttribute('data-background')).toBe('#12161b');
    const backdrop = picture.firstElementChild;
    expect(backdrop.tagName.toLowerCase()).toBe('rect');
    expect(backdrop.getAttribute('style')).toBe('fill:#12161b');
    expect([backdrop.getAttribute('x'), backdrop.getAttribute('y'), backdrop.getAttribute('width'), backdrop.getAttribute('height')]).toEqual(['-8', '-8', '300', '100']);
  });
});

describe('what a diagram’s source asks for besides Mermaid', () => {
  it('reads the page its config names, and nothing else as one', () => {
    expect(diagramPaper('---\nconfig:\n  themeVariables:\n    background: "#efe6d3"\n---\nflowchart LR\n  A --> B')).toBe('#efe6d3');
    expect(diagramPaper('flowchart LR\n  A --> B')).toBe('');
    expect(diagramPaper('flowchart LR\n  %% background: "#000000"\n  A --> B')).toBe('');
  });

  it('reads the legend its comments name, with the colours of their classes, none once it is off or a class is missing', () => {
    const source = 'flowchart LR\n  classDef c1 fill:#dde9f8,stroke:#2a78d6,color:#202124\n  %% legend c1: Houthis\n  %% legend c9: Nobody';
    expect(diagramLegend(source)).toEqual([{ name: 'Houthis', fill: '#dde9f8', stroke: '#2a78d6' }]);
    expect(diagramLegend(`${source}\n  %% legend: off`)).toEqual([]);
    expect(diagramLegend('flowchart LR\n  A --> B')).toEqual([]);
  });
});
