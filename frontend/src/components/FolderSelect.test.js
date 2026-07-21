import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FolderSelect from './FolderSelect.svelte';

describe('FolderSelect trigger', () => {
  it('shows the empty label when nothing is picked', () => {
    const { body } = render(FolderSelect, { props: { value: '', emptyLabel: 'Unfiled' } });
    expect(body).toContain('Unfiled');
  });

  it('shows the picked folder path on the trigger', () => {
    const { body } = render(FolderSelect, {
      props: { value: 'research/sources', folders: ['research', 'research/sources'] },
    });
    expect(body).toContain('research/sources');
  });
});
