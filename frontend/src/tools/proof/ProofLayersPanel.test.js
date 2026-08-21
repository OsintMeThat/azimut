import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ProofLayersPanel.svelte', import.meta.url), 'utf8');

describe('Proof Layers panel hierarchy', () => {
  it('keeps section headings compact inside button styles', () => {
    const styles = source.slice(source.indexOf('<style>'));

    expect(styles).toContain('.side-title.collapsible');
    expect(styles).toContain('font-size: var(--fs-xs);');
    expect(styles).toContain('font-weight: 600;');
    expect(styles).not.toContain('font: inherit;');
  });

  it('makes the add-panel action explicit and prominent', () => {
    expect(source).toContain('class="btn btn-sm side-add"');
    expect(source).toContain('<Icon name="plus" size={13} /> Add panel');
    expect(source).toContain('background: var(--bg-2);');
    expect(source).toContain('border-color: var(--border-strong);');
    expect(source).toContain('line-height: 1.1;');
    expect(source).toContain('margin-bottom: 8px;');
    expect(source).not.toContain('btn-primary btn-sm side-add');
  });
});

describe('the rows and the canvas agree about what is picked', () => {
  it('lights a row only while the pick can be acted on', () => {
    // With a drawing tool in hand the canvas shows no handles and Delete reaches
    // nothing, so a row lit orange was a selection visible in one column and
    // absent from the other.
    expect(source).toContain('class:selected={selectionLive && selectedPanelId === panel.id}');
    expect(source).toContain('class:selected={selectionLive && selectedPasteId === paste.id}');
    expect(source).toContain('class:selected={selectionLive && selectedIds.includes(shape.id)}');
  });

  it('hands a pick back to the composer instead of writing it in place', () => {
    // Writing selectedPanelId straight through the binding skipped the switch
    // back to Select that makes the pick answer to anything.
    expect(source).toContain('onclick={() => selectPanelRow(panel.id)}');
    expect(source).toContain('onclick={() => selectPasteRow(paste.id)}');
    expect(source).not.toContain('$bindable');
  });
});
