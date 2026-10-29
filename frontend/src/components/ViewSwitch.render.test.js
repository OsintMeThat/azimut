import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ViewSwitch from './ViewSwitch.svelte';

const options = [
  { id: 'view', label: 'View', icon: 'horizon', hint: 'The terrain' },
  { id: 'find', label: 'Find', icon: 'search', tag: 'Beta', hint: 'Beta: search' },
];

describe('a tag on an option of the view switch', () => {
  it('draws the tag as a pill after the label, hidden from screen readers', () => {
    const { body } = render(ViewSwitch, { props: { options, value: 'view', onpick: () => {} } });
    expect(body).toMatch(/Find\s*(<!--[^>]*-->)?<span class="view-tag[^"]*" aria-hidden="true">Beta<\/span>/);
  });

  it('draws no pill on an option without one', () => {
    const { body } = render(ViewSwitch, { props: { options: options.slice(0, 1), value: 'view', onpick: () => {} } });
    expect(body).not.toContain('view-tag');
  });
});
