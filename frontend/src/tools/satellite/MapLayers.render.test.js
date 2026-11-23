import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import MapLayers from './MapLayers.svelte';

describe('a layer that cannot be switched on', () => {
  const rows = [
    {
      id: 'firms',
      label: 'Active fires',
      on: false,
      disabled: true,
      detail: 'needs a free key',
      title: 'Add a NASA FIRMS key in Settings → Imagery',
      toggle: () => {},
      actions: [{ label: 'Add a FIRMS key', quiet: true, run: () => {} }],
    },
  ];

  it('says why on the row, and carries the reason on its name', () => {
    const { body } = render(MapLayers, { props: { rows } });
    expect(body).toContain('needs a free key');
    expect(body).toContain('Add a FIRMS key');
    // the reason is on the name too, not only on the greyed switch
    expect(body).toMatch(/class="name[^"]*"[^>]*title="Add a NASA FIRMS key in Settings → Imagery"/);
  });
});

describe('a switch of another layer', () => {
  const rows = [
    { id: 'places', label: 'Places', on: true, detail: '15', toggle: () => {} },
    { id: 'places-names', label: 'Names', of: 'places', on: false, toggle: () => {} },
  ];

  it('draws the Names switch on the Places line, small, not as a row of its own', () => {
    const { body } = render(MapLayers, { props: { rows } });
    expect(body.match(/<li\b/g)).toHaveLength(1);
    expect(body).toMatch(/class="eye switch[^"]*"[^>]*aria-label="Names"/);
    expect(body).toContain('>15</span>');
  });
});
