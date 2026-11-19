// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

// a diagram is drawn by Mermaid in a browser, a chart by the server; here they answer at once
vi.mock('../../mermaid.js', () => ({ renderMermaidSvg: vi.fn(async () => ({ svg: '<svg></svg>' })) }));
vi.mock('../../api.js', async (original) => {
  const real = await original();
  return { ...real, api: { ...real.api, postBytes: vi.fn(async () => ({ data: new TextEncoder().encode('<svg></svg>').buffer, headers: new Headers() })) } };
});

const { noteExtensions, setNoteCase } = await import('../liveMarkdown.js');

/**
 * No drawn block keeps its room above and below in a margin: the editor measures a
 * block by its box, and a margin it cannot see would put every line under it out of
 * step with the page (where the handle, a press or a jump lands). Each kind keeps that
 * room inside its box, as a clear border where its margin was, so it looks the same.
 * `e2e/notebook-pictures.spec.js` measures it in a browser against the height map.
 */

const ROOF = { id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } };

let view;
afterEach(() => {
  view?.destroy();
  view = null;
});

function editor(doc) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions() }) });
  return view;
}

describe('the room above and below a drawn block', () => {
  const KINDS = {
    cover: '<!-- cover -->',
    pagebreak: '<!-- pagebreak -->',
    diagram: '```mermaid\nflowchart LR\n  A --> B\n```',
    steps: '::: steps\n[[media:m1|Roof]]\n:::',
    story: '::: story\n[[media:m1|Roof]]\nIt burnt.\n:::',
    map: '::: map\ntitle: Front\n:::',
    include: '[[include:n2]]',
    picture: '[[media:m1|Roof]]{width=50%}',
    table: '| A | B |\n| --- | --- |\n| 1 | 2 |',
    aligned: '::: center\nCentred.\n:::',
    html: '<div>HTML</div>',
    chart: '::: chart\nkind: bars\n| A | B |\n| --- | --- |\n| x | 1 |\n:::',
  };
  /** Where each kind keeps its room above and below now, as a clear border: what its margin was. */
  const ROOM = { cover: '14px', pagebreak: '10px', diagram: '4px', steps: '4px', story: '4px', map: '4px', include: '6px' };

  for (const [kind, source] of Object.entries(KINDS)) {
    it(`is never a margin the editor cannot measure, but inside the box of a ${kind}`, () => {
      editor(`Words.\n\n${source}\n\nEnd.`);
      view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [ROOF], notes: [{ id: 'n2', title: 'Shadows', excerpt: 'Noon.' }] }) });
      const rows = [...view.contentDOM.children].filter((row) => !row.classList.contains('cm-line'));
      expect(rows).toHaveLength(1);
      const [row] = rows;
      const drawn = row.dataset.block
        ?? (row.classList.contains('cm-cover-rule') ? 'cover' : row.classList.contains('cm-pagebreak') ? 'pagebreak' : row.dataset.include ? 'include' : '');
      expect(drawn).toBe(kind);
      const style = getComputedStyle(row);
      // none written reads as '' here, as a browser reads it as 0px
      for (const margin of [style.marginTop, style.marginBottom]) expect(['', '0px']).toContain(margin);
      if (ROOM[kind]) {
        // the room the page gave it stays, in a clear border where the margin was
        expect([style.borderTopWidth, style.borderBottomWidth]).toEqual([ROOM[kind], ROOM[kind]]);
        expect(style.borderTopColor).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
      }
    });
  }
});
