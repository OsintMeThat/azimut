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

describe('an option framed by the pictured guide', () => {
  it('carries its own anchor, apart from the switch’s', () => {
    const framed = [options[0], { ...options[1], guide: 'horizon.find' }];
    const { body } = render(ViewSwitch, { props: { options: framed, value: 'view', guide: 'horizon.modes', onpick: () => {} } });
    expect(body).toContain('data-guide="horizon.modes"');
    expect(body).toMatch(/<button[^>]*data-guide="horizon\.find"[^>]*>/);
    expect(body.match(/data-guide=/g)).toHaveLength(2);
  });
});
