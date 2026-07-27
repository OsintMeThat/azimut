import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { markdownHtml } from './markdown.js';
import { drawMermaidDiagrams } from './mermaid.js';

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
