// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

/**
 * A diagram in the drawn note: its kind and Edit on its bar, its form on a double press,
 * its Mermaid behind `</>`, and every gesture of the form one Undo step of exact bytes;
 * `/` › Diagram's gallery, Kind…, and the two panels that make one from the case.
 */

// a diagram is drawn by Mermaid in a browser; here it answers at once
const { drawDiagram } = vi.hoisted(() => ({ drawDiagram: vi.fn(async () => ({ svg: '<svg data-drawn="true"></svg>', width: 10, height: 10 })) }));
vi.mock('../../mermaid.js', () => ({ renderMermaidSvg: drawDiagram }));

const server = vi.hoisted(() => ({ asked: [], palette: [], graph: null, views: [], timeline: null }));
vi.mock('../../api.js', async (original) => {
  const real = await original();
  return {
    ...real,
    api: {
      ...real.api,
      get: vi.fn(async (path) => {
        server.asked.push(path);
        if (path.endsWith('/layer-palette')) return { colours: server.palette, icons: [] };
        if (path.includes('/graph?')) return server.graph;
        if (path.endsWith('/analysis-views')) return { views: server.views };
        if (path.includes('/timeline?')) return server.timeline;
        return [];
      }),
      put: vi.fn(async (path, body) => {
        server.palette = body.colours;
        return { colours: body.colours, icons: [] };
      }),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase, startDiagram } = await import('../liveMarkdown.js');
const { writeDiagram, starterModel } = await import('./diagramText.js');
const { layerPalette } = await import('../../map/layerPalette.svelte.js');

const FLOW = `\`\`\`mermaid\n${writeDiagram(starterModel('flow'))}\n\`\`\``;
const NOTE = `How it ended.\n\n${FLOW}\n\nAfter.`;

let view;
beforeEach(() => {
  server.asked = [];
  server.palette = [];
  server.views = [];
  drawDiagram.mockClear();
});
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc, { readOnly = false, caseId = 'c1' } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const handlers = { tableToast: vi.fn(), open: vi.fn(), noteKey: `${caseId}:n1`, noteId: 'n1' };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, readOnly }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId, entities: [] }) });
  view.focus = vi.fn();
  return view;
}

const text = () => view.state.doc.toString();
const settle = async () => {
  for (let step = 0; step < 4; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (node) => {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  node.click();
};
const box = () => view.dom.querySelector('.cm-dg-block');
const form = () => view.dom.querySelector('.dg-form');
const field = (label) => [...form().querySelectorAll('[aria-label]')].find((node) => node.getAttribute('aria-label') === label);
/** Type `value` in a field of words and commit it, as Enter does. */
function typeIn(node, value) {
  node.focus();
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
function choose(node, value) {
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
}
/** The body of the note's one diagram, as Mermaid. */
const body = () => /```mermaid\n([\s\S]*?)\n```/.exec(text())[1];

async function openForm(doc = NOTE) {
  editor(doc);
  await settle();
  box().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await settle();
  expect(form()).not.toBeNull();
}

describe('a diagram on the page', () => {
  it('says its kind on its bar, opens its form on a double press, and its Mermaid behind </>', async () => {
    editor(NOTE);
    await settle();
    expect(box().querySelector('.cm-dg-kind').textContent).toBe('Flow');
    expect(box().querySelector('.cm-dg-unread').hidden).toBe(true);
    expect(box().querySelector('svg[data-drawn]')).not.toBeNull();
    box().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(form().querySelectorAll('.dg-rows')[0].children).toHaveLength(4);
    expect(form().querySelectorAll('.dg-rows')[1].children).toHaveLength(3);
    expect(field('Box 2').value).toBe('Can it be checked?');
    expect(box().querySelector('.cm-dg-edit').getAttribute('aria-pressed')).toBe('true');
    press(box().querySelector('[data-edit-source]'));
    expect(view.dom.querySelector('.cm-dg-block')).toBeNull();
    expect(view.contentDOM.textContent).toContain('flowchart LR');
  });

  it('says of Mermaid the form cannot read that it opens as its source, and opens it so', async () => {
    editor('```mermaid\nflowchart LR\n  subgraph Side\n  A --> B\n  end\n```\n\nAfter.');
    await settle();
    expect(box().querySelector('.cm-dg-unread').hidden).toBe(false);
    expect(box().querySelector('.cm-dg-unread').textContent).toBe('Written in Mermaid the form cannot read: edit its source');
    expect(box().querySelector('.cm-dg-edit').hidden).toBe(true);
    box().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(form()).toBeNull();
    expect(view.dom.querySelector('.cm-dg-block')).toBeNull();
    expect(view.contentDOM.textContent).toContain('subgraph Side');
  });

  it('offers no form in a note nobody can write in, and opens its source', async () => {
    editor(NOTE, { readOnly: true });
    await settle();
    expect(box().querySelector('.cm-dg-bar')).toBeNull();
    expect(box().querySelector('[data-edit-source]')).not.toBeNull();
  });
});

describe('each gesture of the form', () => {
  /** Run `gesture`, then expect the note changed and one Undo to give back its exact bytes. */
  async function oneStep(gesture, expectWritten) {
    const before = text();
    await gesture();
    await settle();
    expect(text()).not.toBe(before);
    if (expectWritten) expect(body()).toContain(expectWritten);
    undo(view);
    await settle();
    expect(text()).toBe(before);
  }

  it('writes a box’s words, shape and category, one Undo each', async () => {
    await openForm();
    await oneStep(() => typeIn(field('Box 1'), 'Houthi gains around Taiz'), 'n1["Houthi gains around Taiz"]');
    await oneStep(() => choose(field('Shape of box 1'), 'cylinder'), 'n1[("What was seen")]');
    await oneStep(() => typeIn(field('Category of box 1'), 'Houthi side'), '%% legend c1: Houthi side');
    await oneStep(() => typeIn(field('Box 4'), 'Left open\nfor now'), 'n4["Left open<br>for now"]');
  });

  it('adds, moves and takes out a box, one Undo each, the links of a box taken out with it', async () => {
    await openForm();
    await oneStep(() => press(form().querySelector('.dg-add-box')), 'n5[" "]');
    await oneStep(() => press(field('Move box 1 down')), 'n2{"Can it be checked?"}\n  n1["What was seen"]');
    await oneStep(() => press(field('Remove box 2')), 'flowchart LR\n  n1["What was seen"]\n  n3("Confirmed")\n  n4["Left open"]');
  });

  it('writes a link’s ends, words, line and arrow, and adds one, one Undo each', async () => {
    await openForm();
    await oneStep(() => choose(field('To, link 1'), 'n4'), 'n1 --> n4');
    await oneStep(() => typeIn(field('Words on link 1'), 'reported'), 'n1 -->|"reported"| n2');
    await oneStep(() => press(field('Dashed, link 1')), 'n1 -.-> n2');
    await oneStep(() => press(field('Arrow, link 1')), 'n1 --- n2');
    await oneStep(() => press(form().querySelector('.dg-add-link')), 'n3 --> n4');
    await oneStep(() => press(field('Move link 1 down')), 'n2 -->|"Yes"| n3\n  n1 --> n2');
  });

  it('switches the direction, the style, the title and the legend, one Undo each', async () => {
    await openForm(`${NOTE.replace('  n2 -.->|"No"| n4', '  n2 -.->|"No"| n4\n  classDef c1 fill:#dde9f8,stroke:#2a78d6,color:#202124\n  class n1 c1\n  %% legend c1: Side')}`);
    const direction = form().querySelector('[aria-label="Direction"]');
    await oneStep(() => press([...direction.querySelectorAll('button')].find((node) => node.textContent.includes('Top down'))), 'flowchart TD');
    const style = form().querySelector('[aria-label="Style"]');
    await oneStep(() => press([...style.querySelectorAll('button')].find((node) => node.textContent === 'Dark')), 'background: "#12161b"');
    await oneStep(() => typeIn(field('Title'), 'The withdrawal'), 'title: "The withdrawal"');
    const legend = form().querySelector('[data-key="legend"]');
    await oneStep(() => {
      legend.checked = false;
      legend.dispatchEvent(new Event('change', { bubbles: true }));
    }, '%% legend: off');
  });

  it('gives a category a colour from the case’s palette or a code, one Undo each', async () => {
    server.palette = [{ name: 'Houthi side', colour: '#c8231b' }];
    layerPalette.load('c1', true);
    await openForm();
    // the case's own name, and its colour
    await oneStep(() => typeIn(field('Category of box 2'), 'houthi side'), 'stroke:#c8231b,color:#202124\n  class n2 c1\n  %% legend c1: Houthi side');
    typeIn(field('Category of box 2'), 'Other side');
    await settle();
    await oneStep(async () => {
      press(form().querySelector('.dg-swatch'));
      const menu = view.dom.querySelector('.dg-colour-menu');
      typeIn(menu.querySelector('.dg-colour-code'), '6250d6');
    }, 'stroke:#6250d6');
  });

  it('takes the last gesture back with its own Undo, and the form follows', async () => {
    await openForm();
    const before = text();
    typeIn(field('Box 1'), 'New words');
    await settle();
    press(form().querySelector('.dg-undo'));
    await settle();
    expect(text()).toBe(before);
    expect(field('Box 1').value).toBe('What was seen');
  });

  it('draws it as another kind that keeps its boxes, and greys the one it cannot be', async () => {
    await openForm();
    press(form().querySelector('.dg-change-kind'));
    const gallery = view.dom.querySelector('.dg-gallery');
    expect(gallery.querySelector('[data-kind="timeline"]').disabled).toBe(true);
    expect(gallery.querySelector('.dg-pick-now').dataset.kind).toBe('flow');
    const before = text();
    press(gallery.querySelector('[data-kind="org"]'));
    await settle();
    expect(body()).toContain('%% kind: org');
    expect(body()).toContain('n2 --- n3');
    expect(box().querySelector('.cm-dg-kind').textContent).toBe('Organisation');
    undo(view);
    expect(text()).toBe(before);
  });
});

describe('/ › Diagram', () => {
  it('shows the six kinds and the two from the case, and writes the one picked with its form open, one Undo', async () => {
    editor('Intro.\n\n');
    view.dispatch({ selection: { anchor: text().length } });
    startDiagram(view);
    await settle();
    const gallery = view.dom.querySelector('.dg-gallery');
    expect([...gallery.querySelectorAll('.dg-pick')].map((node) => node.dataset.kind)).toEqual(['flow', 'network', 'org', 'timeline', 'mindmap', 'sequence']);
    expect(gallery.querySelector('.dg-pick-needs').textContent).toBe('Steps and decisions, joined by arrows');
    expect(gallery.querySelectorAll('.dg-gallery-case-btn')).toHaveLength(2);
    press(gallery.querySelector('[data-kind="sequence"]'));
    await settle();
    expect(body()).toBe(writeDiagram(starterModel('sequence')));
    expect(form()).not.toBeNull();
    expect(form().querySelector('.dg-kind').textContent).toBe('Sequence');
    undo(view);
    expect(text()).toBe('Intro.\n\n');
  });

  it('makes a network of the entities ticked, listing what it will write first', async () => {
    server.graph = {
      nodes: [
        { id: 'e_a', type: 'account', label: '@first', family: 'identifier', degree: 1 },
        { id: 'e_m', type: 'media', label: 'Video', family: 'collected', degree: 2 },
        { id: 'e_p', type: 'proof', label: 'Proof 3', family: 'document', degree: 1 },
      ],
      links: [{ id: 'l1', from: 'e_a', to: 'e_m', type: 'posted' }, { id: 'l2', from: 'e_p', to: 'e_m', type: 'derived-from' }],
      total: 3,
      truncated: false,
    };
    editor('Intro.\n\n');
    view.dispatch({ selection: { anchor: text().length } });
    startDiagram(view);
    await settle();
    press(view.dom.querySelector('.dg-case-graph'));
    await settle();
    const panel = view.dom.querySelector('.dg-case');
    expect(panel.querySelector('.dg-case-said').textContent).toBe('Tick at least one entity.');
    expect(panel.querySelector('.dg-case-write').disabled).toBe(true);
    for (const row of panel.querySelectorAll('.dg-case-row')) {
      if (!row.textContent.includes('Video')) {
        const tick = row.querySelector('input');
        tick.checked = true;
        tick.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    expect(view.dom.querySelector('.dg-case-said').textContent).toBe('Will write 2 boxes and 1 link:');
    expect([...view.dom.querySelectorAll('.dg-case-list li')].map((node) => node.textContent)).toEqual(['@first · account', 'Proof 3 · proof', '@first — Proof 3: via 1 media']);
    press(view.dom.querySelector('.dg-case-write'));
    await settle();
    expect(body()).toContain('%% kind: network');
    expect(body()).toContain('e_a -.-|"via 1 media"| e_p');
    expect(server.asked.some((path) => path.startsWith('/api/cases/c1/graph?lens=all'))).toBe(true);
  });

  it('makes a timeline of the case’s dated events, all ticked, listing them first', async () => {
    server.timeline = {
      items: [
        { id: 't1', raw: '2026-10-18~', earliest: '2026-10-17T21:00:00Z', label: 'Material of Proof 14 was taken' },
        { id: 't2', raw: '2026-11-15', earliest: '2026-11-14T21:00:00Z', label: 'Proof 1' },
      ],
      total: 2,
      extent: { from: '2026-10-17T21:00:00Z', to: '2026-11-15T21:00:00Z' },
    };
    editor('Intro.\n\n');
    view.dispatch({ selection: { anchor: text().length } });
    startDiagram(view);
    await settle();
    press(view.dom.querySelector('.dg-case-timeline'));
    await settle();
    expect(view.dom.querySelector('.dg-case-said').textContent).toBe('Will write 2 events:');
    expect(view.dom.querySelector('.dg-case-from').value).toBe('2026-10-17');
    press(view.dom.querySelector('.dg-case-write'));
    await settle();
    expect(body()).toContain('about 18 Oct 2026 : Material of Proof 14 was taken');
    expect(body()).toContain('15 Nov 2026 : Proof 1');
  });
});
