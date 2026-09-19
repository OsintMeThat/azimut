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
