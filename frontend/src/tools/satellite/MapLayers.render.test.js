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

describe('a switch under another layer, and a layer in a colour', () => {
  const rows = [
    { id: 'places', label: 'Places', on: true, toggle: () => {} },
    { id: 'places-names', label: 'Names', of: 'places', on: false, toggle: () => {} },
    { id: 'leads', label: 'Leads', dot: 'var(--anno-2)', on: true, detail: '3', toggle: () => {} },
  ];

  it('indents the Names switch under Places, and dots the leads in their scene’s colour', () => {
    const { body } = render(MapLayers, { props: { rows } });
    expect(body).toMatch(/<li class="[^"]*\bsub\b[^"]*"[^>]*>\s*<div class="row[^"]*">\s*<button[^>]*aria-label="Names"/);
    expect(body).toContain('style="background: var(--anno-2);"');
    expect(body).toContain('>3</span>');
    // no other row is indented or dotted
    expect(body.match(/<li class="[^"]*\bsub(?![\w-])/g)).toHaveLength(1);
    expect(body.match(/class="dot/g)).toHaveLength(1);
  });
});
