import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SearchInput from './SearchInput.svelte';

describe('SearchInput', () => {
  it('renders the placeholder and no clear button when empty', () => {
    const { body } = render(SearchInput, { props: { placeholder: 'Find a file…', value: '' } });
    expect(body).toContain('Find a file…');
    expect(body).not.toContain('Clear search');
  });

  it('shows the clear button and a count when a value is present', () => {
    const { body } = render(SearchInput, { props: { value: 'bridge', count: '3 shown' } });
    expect(body).toContain('Clear search');
    expect(body).toContain('3 shown');
  });
});
