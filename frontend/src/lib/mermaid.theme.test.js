import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';

// Mermaid is a browser library of a megabyte; here it only says how it was set up and what it was asked to draw
const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>' })),
}));
vi.mock('mermaid', () => ({ default: { initialize, render } }));

const { CHART_FACE, CHART_PALETTE, renderMermaidSvg } = await import('./mermaid.js');

const XY = 'xychart-beta\n  title "Vehicles"\n  x-axis ["A", "B"]\n  bar [3, 2]\n  bar [1, 1]';

describe('the diagrams\' theme', () => {
  const window = new Window();
  afterEach(() => vi.unstubAllGlobals());
  const browser = () => {
    vi.stubGlobal('DOMParser', window.DOMParser);
    vi.stubGlobal('XMLSerializer', window.XMLSerializer);
  };

  it('draws a chart\'s series in the grade blues then grey, and leaves every other setting as it was', async () => {
    browser();
    await renderMermaidSvg(XY);
    expect(initialize).toHaveBeenCalledTimes(1);
    const [config] = initialize.mock.calls[0];
    expect(CHART_PALETTE).toEqual(['#184f95', '#3987e5', '#86b6ef', '#a9a79f']);
    expect(config.themeVariables.xyChart.plotColorPalette).toBe('#184f95, #3987e5, #86b6ef, #a9a79f');
    // the words of a chart in ink, its axes in soft greys: never Mermaid's cream on white
    expect(config.themeVariables.xyChart).toMatchObject({ titleColor: '#202124', xAxisLineColor: '#c3c2b7', yAxisLabelColor: '#52514e' });
    expect(JSON.stringify(config)).not.toMatch(/FFF4DD/i);
    // the rest is the theme every diagram already in a case was drawn with
    expect(config).toMatchObject({ theme: 'base', layout: 'dagre', look: 'classic', securityLevel: 'strict' });
    expect(config.themeVariables).toMatchObject({
      fontFamily: 'Inter, system-ui, sans-serif', primaryColor: '#fdf3e6', primaryBorderColor: '#bd7a25', lineColor: '#8a5a1a',
    });
  });

  it('sets a chart in the note\'s sans, and every other diagram in the type it had', async () => {
    browser();
    render.mockClear();
    await renderMermaidSvg(XY);
    await renderMermaidSvg('%% the losses\nxychart-beta horizontal\n  bar [1]');
    await renderMermaidSvg('flowchart LR\n  A --> B');
    const [chart, commented, flow] = render.mock.calls.map(([, source]) => source);
    const face = `"fontFamily": ${JSON.stringify(CHART_FACE)}`;
    expect(chart).toContain(face);
    expect(chart).toContain('"htmlLabels": false');
    expect(chart.indexOf(face)).toBeLessThan(chart.indexOf('xychart-beta'));
    expect(commented).toContain(face);
    expect(flow).not.toContain('fontFamily');
    expect(flow.startsWith('%%{init: {"htmlLabels": false, "journey": {"textPlacement": "tspan"}} }%%\n')).toBe(true);
  });

  it('keeps a chart\'s own config block first, the face after it', async () => {
    browser();
    render.mockClear();
    const block = '---\nconfig:\n  xyChart:\n    showDataLabel: true\n---\n';
    await renderMermaidSvg(`${block}${XY}`);
    const [[, sent]] = render.mock.calls;
    expect(sent.startsWith(block)).toBe(true);
    expect(sent).toContain('"fontFamily"');
  });
});
