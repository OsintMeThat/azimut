import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import FolderBrowser from './FolderBrowser.svelte';
import { UNFILED } from '../lib/folderBrowse.js';

const entries = [
  { id: 'a', label: 'Loose photo', attrs: { folder: '' } },
  { id: 'b', label: 'Bridge', attrs: { folder: 'field' } },
  { id: 'c', label: 'Roof', attrs: { folder: 'field/day-1' } },
];

const at = (path, props = {}) =>
  render(FolderBrowser, { props: { entries, path, rootLabel: 'Case media', onnavigate: () => {}, ...props } }).body;

describe('FolderBrowser', () => {
  it('shows the folders at the root, not the entries', () => {
    const body = at('');

    expect(body).toContain('Unfiled');
    expect(body).toContain('field');
    expect(body).not.toContain('Bridge');
    expect(body).toContain('Case media');
  });

  it('lists what is filed in the folder it is pointed at', () => {
    expect(at('field')).toContain('Bridge');
    expect(at('field/day-1')).toContain('Roof');
    expect(at(UNFILED)).toContain('Loose photo');
  });

  it('hides the entries the search excludes, keeping the folders', () => {
    const body = at('', { matches: () => false });

    expect(body).toContain('field');

    expect(at('field', { matches: () => false })).not.toContain('Bridge');
    expect(at('field/day-1', { matches: () => false })).toContain('Nothing here.');
  });

  it('says what an empty folder is empty of', () => {
    expect(at('field/day-9', { emptyText: 'This folder has no matching media.' })).toContain(
      'This folder has no matching media.'
    );
  });

  it('marks the single selection, and every selected row when multi-select', () => {
    expect(at('field', { selectedId: 'b' })).toContain('selected');

    const multi = at('field', { mark: true, isSelected: (entry) => entry.id === 'b' });
    expect(multi).toContain('aria-pressed="true"');
  });

  it('renders the caller’s icon and label per row', () => {
    const body = at('field', { icon: () => 'satellite', label: (entry) => `${entry.label}!` });

    expect(body).toContain('Bridge!');
  });

  it('hands the entries to the caller’s row snippet when it passes one', () => {
    const row = createRawSnippet((entry) => ({
      render: () => `<div class="rich-row">${entry().label} with a thumbnail</div>`,
    }));

    const body = at('field', { row });

    expect(body).toContain('Bridge with a thumbnail');
    expect(body).not.toContain('browser-row"'); // the default entry button stays out
  });

  it('keeps its own folders and crumbs around a caller’s rows', () => {
    const row = createRawSnippet((entry) => ({ render: () => `<div>${entry().label}</div>` }));

    const body = at('field', { row });

    expect(body).toContain('folder-row'); // field/day-1
    expect(body).toContain('Case media');
  });
});
