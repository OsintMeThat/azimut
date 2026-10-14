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
    expect(src).toContain("tool = 'icon';\n        toggle('icon');");
    // …and pressing it again puts the stamp down, as the rest of the rail does
    expect(src).toContain("if (tool === 'icon' && iconOpen) { tool = 'select'; toggle(''); return; }");
    expect(src).toContain("onclick={() => (tool = tool === entry.id ? 'select' : entry.id)}");
  });

  it('is lit by the tool in hand, not by the grid being open', () => {
    expect(src).toContain("class:active={tool === 'icon'}");
    expect(src).not.toContain("class:active={tool === 'icon' || iconOpen}");
  });
});

describe('the pointer control', () => {
  it('stays away until a callout is drawn or a label or callout is picked', () => {
    const { body } = render(ProofToolbar, { props: props({ tool: 'rect' }) });
    expect(body).not.toContain('title="Pointer"');
  });

  it('offers a leader and a bubble with the tool in hand, and no plain label', () => {
    const { body } = render(ProofToolbar, { props: props({ tool: 'callout', showTail: true, activeTail: 'bubble' }) });
    expect(body).toContain('title="Pointer"');
    expect(body).toContain('Leader line to the point');
    expect(body).toContain('Speech bubble');
    expect(body).not.toContain('No pointer: a plain label');
  });

  it('offers to take the pointer off a picked mark', () => {
    const { body } = render(ProofToolbar, {
      props: props({
        tool: 'select', showTail: true, tailNone: true, activeTail: 'leader',
        selectedShape: { kind: 'callout', fontSize: 30, color: '#ff5252' },
      }),
    });
    expect(body).toContain('No pointer: a plain label');
  });

  it('sizes a picked callout by its font, like a label', () => {
    const { body } = render(ProofToolbar, {
      props: props({ tool: 'select', selectedShape: { kind: 'callout', color: '#ff5252' } }),
    });
    expect(body).toContain('title="Font size"');
    expect(body).toContain('aria-label="font size"');
    // a callout's default size is its own, smaller than a label's
    expect(body).toMatch(/tb-size-val[^>]*>22</);
  });
});

describe('what the rail shows for the pick', () => {
  it('offers a line style to lines, and not to a label', () => {
    const line = render(ProofToolbar, { props: props({ tool: 'select', selectedShape: { kind: 'arrow' }, showDash: true }) });
    expect(line.body).toContain('title="Line style"');
    const label = render(ProofToolbar, { props: props({ tool: 'select', selectedShape: { kind: 'text', fontSize: 28 } }) });
    expect(label.body).not.toContain('title="Line style"');
  });

  it('offers a label its frame and background', () => {
    const { body } = render(ProofToolbar, {
      props: props({ tool: 'select', selectedShape: { kind: 'text', fontSize: 28 }, textBox: { frame: true, bg: null } }),
    });
    expect(body).toContain('title="Frame around the words"');
    expect(body).toContain('aria-pressed="true"');
    expect(body).toContain('title="Background"');
  });

  it('offers a picked panel its border, and nothing when no picture is picked', () => {
    const picked = render(ProofToolbar, { props: props({ tool: 'select', surfaceBorder: null }) });
    expect(picked.body).toContain('title="Border"');
    const none = render(ProofToolbar, { props: props({ tool: 'select' }) });
    expect(none.body).not.toContain('title="Border"');
  });

  it('names a cone\'s lens on its button, or its width when set by hand', () => {
    const lens = render(ProofToolbar, { props: props({ tool: 'cone', showLens: true, activeLens: { lens: '2', upright: false, fov: 38.2 } }) });
    expect(lens.body).toContain('2×');
    expect(lens.body).toContain('Zoom 2×');
    const own = render(ProofToolbar, { props: props({ tool: 'cone', showLens: true, activeLens: { lens: null, upright: false, fov: 52.4 } }) });
    expect(own.body).toContain('52°');
  });
});
