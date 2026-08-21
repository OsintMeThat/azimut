import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CollageMenu.svelte', import.meta.url), 'utf8');

describe('CollageMenu renaming', () => {
  it('opens the tab you are already in for editing, and switches to the others', () => {
    expect(source).toContain(`    if (cl.id === session.activeCollageId) {
      renamingId = cl.id;
      draftName = cl.name ?? '';
    } else {
      switchCollage(cl.id);
    }`);
    expect(source).toContain(
      "title={cl.id === session.activeCollageId ? 'Rename this collage' : 'Switch to this collage'}"
    );
  });

  it('commits on Enter or blur and abandons on Escape', () => {
    expect(source).toContain("if (event.key === 'Enter') commitRename(cl);");
    expect(source).toContain("else if (event.key === 'Escape') renamingId = null;");
    expect(source).toContain('onblur={() => commitRename(cl)}');
  });

  it('refuses to blank a collage name', () => {
    expect(source).toContain(`    const next = draftName.trim();
    if (next && next !== cl.name) {`);
  });

  it('tells the Save tab the name is now the user\'s', () => {
    expect(source).toContain('onRename?.(cl);');
  });

  it('caps the name at the length the Save gate accepts', () => {
    expect(source).toContain('maxlength="200"');
  });
});

describe('CollageMenu frame tray', () => {
  it('numbers the tiles and names them like the Frame tab', () => {
    expect(source).toContain(
      "fr.time != null ? `Image ${i + 1} · t=${fr.time.toFixed(2)}s` : `Image ${i + 1}`"
    );
    expect(source).toContain('<span class="num">{i + 1}</span>');
  });

  it('counts how many pieces a frame already has on the collage', () => {
    expect(source).toContain(
      'const usedCount = (id) => active?.nodes.filter((n) => n.frameId === id).length ?? 0;'
    );
    expect(source).toContain('<span class="tag count">×{used}</span>');
  });

  it('lets the panel scroll instead of boxing the tray in its own window', () => {
    expect(source).not.toContain('max-height: 200px');
  });
});
