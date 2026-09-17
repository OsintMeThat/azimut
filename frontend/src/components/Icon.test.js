import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Icon, { paths } from './Icon.svelte';

describe('Icon', () => {
  it('renders a dedicated ghost glyph instead of the alert fallback', () => {
    expect(paths.ghost).toBeTruthy();
    expect(paths.ghost).not.toBe(paths.alert);

    const { body } = render(Icon, { props: { name: 'ghost', size: 15 } });

    expect(body).toContain(`d="${paths.ghost}"`);
    expect(body).not.toContain(`d="${paths.alert}"`);
  });
});
