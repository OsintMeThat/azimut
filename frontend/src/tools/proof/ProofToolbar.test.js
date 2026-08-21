import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import ProofToolbar from './ProofToolbar.svelte';
import { PROOF_ICONS, iconByName } from '../../lib/proofIcons.js';

const DRAW_TOOLS = [
  { id: 'select', icon: 'cursor', label: 'Select / move', shortcut: 'v' },
  { id: 'rect', icon: 'square', label: 'Box', shortcut: 'r' },
  { id: 'text', icon: 'text', label: 'Text', shortcut: 't' },
];

// The composer hands the toolbar a count and a fill-ability read off the whole
// picked family; `selectedShape` is only the one when exactly one is picked.
// Mirror that here so a test naming a shape does not have to spell out both.
function props(overrides = {}) {
  const shape = 'selectedShape' in overrides ? overrides.selectedShape : null;
  return {
    selectedCount: shape ? 1 : 0,
    fillableSelection: ['rect', 'ellipse'].includes(shape?.kind),
    canUndo: true,
    canRedo: true,
    undo: vi.fn(),
    redo: vi.fn(),
    drawTools: DRAW_TOOLS,
    tool: 'rect',
    palette: ['#ff5252', '#40c4ff'],
    activeColor: '#ff5252',
    activeFill: 0,
    selectedShape: null,
    strokeW: 4,
    setColor: vi.fn(),
    setStroke: vi.fn(),
    setFill: vi.fn(),
    fit: vi.fn(),
    layout: 'grid',
    setLayoutMode: vi.fn(),
    guide: null,
    tweetGuides: { '16:9': 16 / 9, '4:5': 4 / 5 },
    panelCount: 2,
    applyMagic: vi.fn(),
    ...overrides,
  };
}

describe('ProofToolbar core (always visible)', () => {
  it('shows history, every draw tool and fit regardless of active tool', () => {
    const { body } = render(ProofToolbar, { props: props({ tool: 'select' }) });
    expect(body).toContain('Undo (Ctrl+Z)');
    expect(body).toContain('Redo');
    expect(body).toContain('Box (r)');
    expect(body).toContain('Text (t)');
    expect(body).toContain('Fit view (f)');
  });
});

describe('ProofToolbar context controls (colour + size)', () => {
  it('hides the colour palette and size slider when idle (Select, nothing selected)', () => {
    const { body } = render(ProofToolbar, {
      props: props({ tool: 'select', selectedShape: null }),
    });
    expect(body).not.toContain('aria-label="color #ff5252"');
    expect(body).not.toContain('stroke-slider');
  });

  it('shows the colour palette and size slider while a draw tool is active', () => {
    const { body } = render(ProofToolbar, { props: props({ tool: 'rect' }) });
    expect(body).toContain('aria-label="color #ff5252"');
    expect(body).toContain('aria-label="color #40c4ff"');
    expect(body).toContain('custom color');
    expect(body).toContain('stroke-slider');
  });

  it('shows the colour palette and size slider when a shape is selected under Select', () => {
    const { body } = render(ProofToolbar, {
      props: props({ tool: 'select', selectedShape: { kind: 'rect', strokeWidth: 3 } }),
    });
    expect(body).toContain('aria-label="color #ff5252"');
    expect(body).toContain('stroke-slider');
  });

  it('ranges the size slider for font size when a text shape is selected', () => {
    const { body } = render(ProofToolbar, {
      props: props({ tool: 'select', selectedShape: { kind: 'text', fontSize: 40 } }),
    });
    expect(body).toMatch(/class="stroke-slider[^"]*"[\s\S]*?max="120"/);
  });
});

describe('ProofToolbar fill control', () => {
  it('follows the box tool, and stays out for the kinds that cannot hold a fill', () => {
    expect(render(ProofToolbar, { props: props({ tool: 'rect' }) }).body)
      .toContain('aria-label="fill opacity"');
    expect(render(ProofToolbar, { props: props({ tool: 'line' }) }).body)
      .not.toContain('aria-label="fill opacity"');
    expect(render(ProofToolbar, { props: props({ tool: 'text' }) }).body)
      .not.toContain('aria-label="fill opacity"');
  });

  it('follows the selected shape under Select rather than the tool', () => {
    const { body } = render(ProofToolbar, {
      props: props({ tool: 'select', selectedShape: { kind: 'ellipse', fillOpacity: 0.4 } }),
    });
    expect(body).toContain('aria-label="fill opacity"');
  });

  it('reads zero until a fill is asked for, and shows the share once it is', () => {
    expect(render(ProofToolbar, { props: props({ tool: 'rect', activeFill: 0 }) }).body)
      .toMatch(/tb-size-val[^"]*">0</);
    const filled = render(ProofToolbar, { props: props({ tool: 'rect', activeFill: 0.35 }) }).body;
    expect(filled).toMatch(/tb-size-val[^"]*">35</);
    expect(filled).toContain('rgba(255, 82, 82, 0.35)');
  });
});

describe('ProofToolbar with a family of shapes picked', () => {
  const family = { tool: 'select', selectedShape: null, selectedCount: 3 };

  it('keeps colour and size on show, though no single shape answers for them', () => {
    const { body } = render(ProofToolbar, { props: props({ ...family }) });
    expect(body).toContain('aria-label="color #ff5252"');
    expect(body).toContain('stroke-slider');
  });

  it('offers the fill when any of them can hold one, and not otherwise', () => {
    expect(render(ProofToolbar, { props: props({ ...family, fillableSelection: true }) }).body)
      .toContain('aria-label="fill opacity"');
    expect(render(ProofToolbar, { props: props({ ...family, fillableSelection: false }) }).body)
      .not.toContain('aria-label="fill opacity"');
  });
});

describe('ProofToolbar document controls (overflow flyout)', () => {
  it('carries layout modes, tweet guides and the magic repack action', () => {
    const { body } = render(ProofToolbar, { props: props() });
    expect(body).toContain('Grid layout: panels flow in rows');
    expect(body).toContain('Free layout: drag panels anywhere');
    expect(body).toContain('>16:9<');
    expect(body).toContain('>4:5<');
    expect(body).toContain('Repack panels');
  });

  it('disables the magic repack when there are no panels', () => {
    const { body } = render(ProofToolbar, { props: props({ panelCount: 0 }) });
    expect(body).toMatch(/title="Repack panels[^"]*"[^>]*disabled/);
  });
});

describe('the symbol picker', () => {
  it('offers every symbol in the set, each named', () => {
    const { body } = render(ProofToolbar, { props: props() });

    for (const entry of PROOF_ICONS) expect(body).toContain(`aria-label="${entry.label}"`);
    expect(body).toContain('flyout-icons');
  });

  it('shows the symbol in hand on the button that opens the grid', () => {
    const { body } = render(ProofToolbar, { props: props({ iconName: 'tank' }) });
    const button = body.slice(body.indexOf('title="Symbol (s)"'));

    expect(button).toContain(iconByName('tank').path);
  });

  it('lights the button while the stamp is the active tool', () => {
    const idle = render(ProofToolbar, { props: props({ tool: 'rect' }) }).body;
    const armed = render(ProofToolbar, { props: props({ tool: 'icon' }) }).body;
    const buttonOf = (body) => body.slice(body.indexOf('title="Symbol (s)"') - 120, body.indexOf('title="Symbol (s)"'));

    expect(buttonOf(idle)).not.toContain('active');
    expect(buttonOf(armed)).toContain('active');
  });

  it('keeps the stroke control away from a symbol that has no outline', () => {
    // a solid silhouette takes a colour and nothing else — a width slider that
    // moved nothing would be a control lying about what it does
    expect(render(ProofToolbar, { props: props({ showStroke: false }) }).body)
      .not.toContain('stroke-slider');
    expect(render(ProofToolbar, { props: props() }).body).toContain('stroke-slider');
  });

  it('offers the fill that becomes a symbol’s badge while stamping', () => {
    expect(render(ProofToolbar, { props: props({ tool: 'icon' }) }).body)
      .toContain('fill-slider');
  });
});

describe('the symbol picker reads in both themes', () => {
  const css = readFileSync(new URL('./ProofToolbar.svelte', import.meta.url), 'utf8');

  it('never paints a glyph with the ink meant for sitting on the accent', () => {
    // --accent-text is near-black in both themes: as a foreground on a
    // transparent button it disappears the moment the theme goes dark
    const rule = css
      .slice(css.indexOf('.icon-btn.active'), css.indexOf('}', css.indexOf('.icon-btn.active')))
      .replace(/\/\*[\s\S]*?\*\//g, ''); // the declarations, not the note explaining them

    expect(rule).not.toContain('--accent-text');
    expect(rule).toContain('var(--text-1)');
  });
});

describe('the symbol button', () => {
  const src = readFileSync(new URL('./ProofToolbar.svelte', import.meta.url), 'utf8');

  it('takes the tool as well as opening the grid, like the `s` it promises', () => {
    // It was the one button on the rail that only opened a flyout, so coming
    // back to the stamp meant re-picking a glyph already chosen.
    expect(src).toContain("onclick={() => { tool = 'icon'; toggle('icon'); }}");
    expect(src).toContain('onclick={() => (tool = entry.id)}'); // as the rest of the rail does
  });

  it('is lit by the tool in hand, not by the grid being open', () => {
    expect(src).toContain("class:active={tool === 'icon'}");
    expect(src).not.toContain("class:active={tool === 'icon' || iconOpen}");
  });
});
