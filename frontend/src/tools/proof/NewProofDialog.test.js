import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import NewProofDialog from './NewProofDialog.svelte';
import { filterProofPanelItems } from '../../lib/composer.js';

const source = readFileSync(new URL('./NewProofDialog.svelte', import.meta.url), 'utf8');

const ITEMS = [
  { src: 'media/sat.png', label: '48.85, 2.35 · z17', kind: 'satellite', folder: '', thumb: 'media/sat.png', meta: {} },
  { src: 'media/IMG_1.jpg', label: 'Bridge', kind: 'media', folder: 'field', thumb: 'media/IMG_1.jpg', meta: {} },
];

function props(overrides = {}) {
  const query = overrides.query ?? '';
  const category = overrides.category ?? 'all';
  return {
    templateId: '',
    panelPaths: [],
    query,
    category,
    templates: [],
    items: ITEMS,
    filteredItems: filterProofPanelItems(ITEMS, query, category),
    loading: false,
    creating: false,
    caseId: 'case-1',
    togglePanel: vi.fn(),
    requestCreation: vi.fn(),
    startImport: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe('Create proof dialog', () => {
  it('offers importing a published proof beside composing one', () => {
    // The toolbar has no room for a seventh button, so this dialog is the door.
    const { body } = render(NewProofDialog, { props: props() });

    expect(body).toContain('Import a published proof');
    expect(source).toContain('onclick={startImport}');
  });

  it('offers the same category chips as the Add-a-panel picker', () => {
    const { body } = render(NewProofDialog, { props: props() });

    expect(body).toContain('Satellite captures');
    expect(body).toContain('Other images');
    expect(source).toContain("import PanelCategories from './PanelCategories.svelte'");
  });

  it('opens the shared folder browser behind the "…"', () => {
    expect(source).toContain("import FolderBrowser from '../../components/FolderBrowser.svelte'");
    expect(source).toContain('function toggleBrowser()');
    expect(source).toContain('rootLabel="Case images"');
    expect(source).toContain('onselect={(item) => togglePanel(item.src)}');
    expect(source).toContain('isSelected={(item) => panelPaths.includes(item.src)}');
    expect(source).toContain('mark');
  });

  it('does not ask for a name — the header names the proof', () => {
    const { body } = render(NewProofDialog, { props: props() });

    expect(body).not.toContain('Proof name');
    expect(source).not.toContain('bind:value={name}');
  });

  it('shows the thumbnail grid until the browser is opened', () => {
    const { body } = render(NewProofDialog, { props: props() });

    expect(body).toContain('pick-grid');
    expect(body).not.toContain('browser-list');
  });
});

describe('Create proof dialog previews', () => {
  const pending = [{ src: 'media/clip.png', label: 'Roof', kind: 'media', folder: '', thumb: null, thumbPending: true, meta: {} }];
  const ready = [{ src: 'media/roof.png', label: 'Roof', kind: 'media', folder: '', thumb: 'media/.thumbs/abc-g2.jpg', meta: {} }];

  it('renders the cached thumbnail when there is one', () => {
    const { body } = render(NewProofDialog, {
      props: props({ items: ready, filteredItems: ready }),
    });

    expect(body).toContain('/files/case-1/media/.thumbs/abc-g2.jpg');
  });

  it('shows a placeholder rather than the original while a thumbnail is generating', () => {
    const { body } = render(NewProofDialog, {
      props: props({ items: pending, filteredItems: pending }),
    });

    expect(body).not.toContain('<img');
    expect(body).not.toContain('media/clip.png');
  });
});
