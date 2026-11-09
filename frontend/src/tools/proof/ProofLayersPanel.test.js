import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import ProofLayersPanel from './ProofLayersPanel.svelte';

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

describe('panel and overlay transforms', () => {
  it('offers the same crop control on both image kinds without arrow buttons', () => {
    expect(source).toContain('{#snippet transformControl(item, label)}');
    expect(source.match(/\{@render transformControl\(/g)).toHaveLength(2);
    expect(source).toContain('onclick={() => openCrop(item)}');
    expect(source).not.toContain('rotateSurface');
    expect(source).not.toContain('rotateLeft');
    expect(source).not.toContain('rotateRight');
  });

  it('shows a separate reset only after a crop or an upright cut exists', () => {
    expect(source).toContain('{#if item.crop || item.cut}');
    expect(source).toContain('onclick={() => resetCrop(item)}');
    expect(source).toContain('class:active={!!(item.crop || item.cut)}');
  });

  it('thumbs the overlay from its own image, which is now the untouched source', () => {
    expect(source).toContain('<img src={paste.img?.src} alt="" />');
    expect(source).not.toContain('sourceImg');
  });
});

describe('a proof kept as published', () => {
  it('lists its pictures in place of panels, with nothing to add, lay out or caption', () => {
    const noop = () => {};
    const { body } = render(ProofLayersPanel, {
      props: {
        proof: {
          panels: [], pastes: [], shapes: [], notes: {}, layout: 'grid',
          published: [{ id: 'u1', asset: 'a.png', natural: [1200, 675], sourceNatural: [1200, 675],
            url: 'https://x.com/a/1', img: { src: 'blob:pic' } }],
        },
        collapsed: { panels: false, overlays: false, annotations: false, elements: false },
        gonePanels: [], selectedPanelId: null, selectedPasteId: null, selectedIds: [], selectionLive: true,
        selectShape: noop, selectPanelRow: noop, selectPasteRow: noop, activeColor: '#ff5252', caseId: 'c1',
        scaleMin: 0.25, scaleMax: 2.5, scaleStep: 0.05, openPicker: noop, movePanelZ: noop, scalePanel: noop,
        openCrop: noop, resetCrop: noop, removePanel: noop, movePasteZ: noop, removePaste: noop,
        pickImageFile: noop, featureList: ['#ff5252'], moveLegendColor: noop, setColor: noop,
        moveShapeTo: noop, kindIcon: {}, kindLabel: {}, duplicateShape: noop, deleteShape: noop, markDirty: noop,
      },
    });
    expect(body).toContain('Published picture');
    expect(body).toContain('Shown as it was published: no panels, captions or legend.');
    expect(body).toContain('1200 × 675 px');
    expect(body).toContain('href="https://x.com/a/1"');
    expect(body).not.toContain('Add panel');
    expect(body).not.toContain('Caption…');
    // the legend it would never print is not offered either
    expect(body).not.toContain('Feature 1 legend');
    // overlays and marks still are
    expect(body).toContain('Add overlay');
    expect(body).toContain('Elements');
  });
});
