import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ProofLayersPanel.svelte', import.meta.url), 'utf8');

describe('Proof Layers panel hierarchy', () => {
  it('keeps section headings compact inside button styles', () => {
    const styles = source.slice(source.indexOf('<style>'));

    expect(styles).toContain('.side-title.collapsible');
    expect(styles).toContain('font-size: var(--fs-xs);');
    expect(styles).toContain('font-weight: 600;');
    expect(styles).not.toContain('font: inherit;');
  });

  it('makes the add-panel action explicit and prominent', () => {
    expect(source).toContain('class="btn btn-sm side-add"');
    expect(source).toContain('<Icon name="plus" size={13} /> Add panel');
    expect(source).toContain('background: var(--bg-2);');
    expect(source).toContain('border-color: var(--border-strong);');
    expect(source).toContain('line-height: 1.1;');
    expect(source).toContain('margin-bottom: 8px;');
    expect(source).not.toContain('btn-primary btn-sm side-add');
  });
});
