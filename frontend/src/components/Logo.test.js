import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Logo from './Logo.svelte';

describe('Logo', () => {
  it('renders one svg on the icon grid', () => {
    const { body } = render(Logo);
    expect(body.match(/<svg/g)).toHaveLength(1);
    expect(body).toContain('viewBox="0 0 24 24"');
  });

  it('honours the size prop on both axes', () => {
    const { body } = render(Logo, { props: { size: 27 } });
    expect(body).toContain('width="27"');
    expect(body).toContain('height="27"');
  });

  // The mark this replaced hardcoded rgb(47,48,51) against a #1c1c1c topbar
  // and was invisible in dark mode. The west flank must stay on the token.
  it('draws the west flank through --brand-ink, never a fixed ink', () => {
    const { body } = render(Logo);
    expect(body).toContain('fill="var(--brand-ink, #e3e3e3)"');
    expect(body).not.toMatch(/fill="rgb\(/);
  });

  it('draws the east flank in the brand amber', () => {
    const { body } = render(Logo);
    expect(body).toContain('fill="#e8a33d"');
  });
});
