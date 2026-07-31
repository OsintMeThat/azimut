import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { caseState, uiState } from '../lib/state.svelte.js';
import PostComposer from './PostComposer.svelte';

const source = readFileSync(new URL('./PostComposer.svelte', import.meta.url), 'utf8');

describe('Post media picker search', () => {
  it('shows a search box only once the picker holds more than six items', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain('{#if pickerItems().length > 6}');
    expect(source).toContain('bind:value={pickerQuery}');
  });

  it('renders the filtered items and resets the query when the picker opens', () => {
    expect(source).toContain("import { matchesQuery } from '../lib/mediaFilter.js'");
    expect(source).toContain('items.filter((m) => matchesQuery(m, q))');
    expect(source).toContain('{#each (caseState.current ? visiblePickerItems() : []) as item (item.path)}');
    expect(source).toContain('pickerQuery = \'\';');
  });
});

afterEach(() => {
  caseState.current = null;
  uiState.postProof = null;
});

describe('Geo Report actions', () => {
  it('offers Save report and removes the old Copy report action', () => {
    caseState.current = { id: 'case-1', folders: [], entities: [] };

    const { body } = render(PostComposer);

    expect(body).toContain('Save report');
    expect(body).toContain('Publish on');
    expect(body).not.toContain('Copy report');
  });
});

describe('Post naming', () => {
  it('names the draft in the header, like Inspect and the Proof Composer', () => {
    expect(source).toContain('<input class="input title-input" bind:value={postName}');
    expect(source).toContain('aria-label="Post name"');
  });

  it('names a fresh draft "Post N" instead of deriving it from the place field', () => {
    expect(source).toContain("const freshPostName = () => nextName('draft', savedTitles(draftEntities, 'draft'));");
    expect(source).not.toContain("place.trim() || description.trim() || 'Untitled post'");
  });

  it('renames in place: saving sends the bound slug so the backend moves the file', () => {
    expect(source).toContain('rename_from: draftName,');
    expect(source).toContain('title: postName.trim(),');
    expect(source).toContain('postName = r.title;');
  });

  it('asks before an unbound draft takes a name another draft holds', () => {
    expect(source).toContain("if (!draftName && savedSlugs(draftEntities, 'draft').has(slugify(title, 'draft')))");
    expect(source).toContain('title="Overwrite this draft?"');
  });

  it('does not carry an auto-assigned proof name into the post text', () => {
    expect(source).toContain("isDefaultName(p.title, 'proof') ? '' : (p.title ?? '')");
    expect(source).toContain("!isDefaultName(item.title, 'proof')");
  });
});
