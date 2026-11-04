import { describe, expect, it } from 'vitest';
import { FEEDBACK_FORM_URL, KOFI_URL } from './support.js';

describe('the support links', () => {
  it('lead to Ko-fi or nowhere, never to a page somebody else could claim', () => {
    expect(KOFI_URL).toMatch(/^$|^https:\/\/ko-fi\.(com|invalid)\/[\w-]+$/);
  });

  it('use https where a form is set', () => {
    expect(FEEDBACK_FORM_URL).toMatch(/^$|^https:\/\//);
  });
});
