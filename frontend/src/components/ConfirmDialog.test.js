import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ConfirmDialog.svelte', import.meta.url), 'utf8');

describe('confirmation register', () => {
  it('shows the recoverable consequence separately from losses and scars', () => {
    expect(source).toContain("restorable = ''");
    expect(source).toContain('{#if restorable}');
    expect(source).toContain('class="conseq restorable"');
    expect(source).toContain('<Icon name="undo"');
  });

  it('reserves danger for actions that cannot be restored', () => {
    expect(source).toContain("tone: 'danger'  → nothing comes back");
    expect(source).toContain("tone: 'default' → reversible");
  });
});
