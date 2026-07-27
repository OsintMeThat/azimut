import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Wordmark from './Wordmark.svelte';

describe('Wordmark', () => {
  it('honours the height prop', () => {
    const { body } = render(Wordmark, { props: { height: 13 } });
    expect(body).toContain('height="13"');
  });

  it('draws the letterforms through --brand-ink', () => {
    const { body } = render(Wordmark);
    expect(body).toContain('stroke="var(--brand-ink, #e3e3e3)"');
    expect(body).not.toMatch(/stroke="rgb\(/);
  });

  // The amber belongs to the mark alone; the wordmark is pure ink.
  it('carries no amber', () => {
    const { body } = render(Wordmark);
    expect(body).not.toContain('#e8a33d');
  });

  // A mitred point on the A goes thin and sharp beside the squared M, U and T.
  it('cuts the A apex flat', () => {
    const { body } = render(Wordmark);
    expect(body).toContain('d="M0 100 25 0h13.3l25 100"');
  });
});
