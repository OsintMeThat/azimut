import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EntityCreate.svelte', import.meta.url), 'utf8');

describe('one dialog, wherever the analyst is standing', () => {
  it('builds itself from the registry instead of a form per type', () => {
    expect(source).toContain("import AttrFields from './AttrFields.svelte'");
    expect(source).toContain('<AttrFields type={draft.type} bind:values={draft.attrs} />');
    expect(source).toContain('creatableTypes()');
  });

  it('names the primary value for the chosen type, never "Name"', () => {
    // an IP address, a full name, a handle — a generic box is the lie this vocabulary
    // went to the trouble of avoiding
    expect(source).toContain('entityIdentityLabel(draft.type)');
    expect(source).toContain('entityIdentityPlaceholder(draft.type)');
    expect(source).not.toContain('>Name</label>');
  });

  it('says what each type is for, since choosing wrong is a filing mistake', () => {
    expect(source).toContain('title={entityHint(draft.type)}');
    expect(source).toContain('{#if entityHint(draft.type)}');
  });

  it('takes notes with the creation rather than after it', () => {
    expect(source).toContain('for="create-notes"');
    expect(source).toContain("...(draft.notes.trim() ? { notes: draft.notes.trim() } : {})");
  });

  it('stages photos for supported types and adds them after the entity exists', () => {
    expect(source).toContain("import EntityPhotoDraft from './EntityPhotoDraft.svelte'");
    expect(source).toContain('{#if hasImageGallery(draft.type)}');
    expect(source).toContain('<EntityPhotoDraft bind:photos');
    expect(source).toContain('await addPhotos(entity.id)');
    expect(source.indexOf('/entities`, {')).toBeLessThan(source.indexOf('await addPhotos(entity.id)'));
  });

  it('keeps computer imports private and Media choices as references', () => {
    expect(source).toContain('/entities/${entityId}/images/upload`');
    expect(source).toContain('{ media_ids: [photo.mediaId] }');
    expect(source).not.toContain('/media/upload`');
  });

  it('applies the selected primary photo before opening Details', () => {
    expect(source).toContain('imageIds.get(primaryPhotoId)');
    expect(source).toContain('/images/${primaryImageId}/primary`');
    expect(source.indexOf('await addPhotos(entity.id)')).toBeLessThan(source.indexOf('oncreated(entity)'));
  });
});

describe('a second record of one thing', () => {
  it('warns on an identifier the case already holds, and never blocks', () => {
    // in that family the value *is* the identity; merging is not shipped, so refusing
    // the entry would leave nowhere to put it
    expect(source).toContain("entityFamily(kind) !== 'identifier'");
    expect(source).toContain('This case already holds');
    expect(source).toContain('disabled={saving || !draft.type || !draft.label.trim()}');
  });

  it('hands the existing row back to whoever opened the dialog', () => {
    // the Board opens its Details, the graph selects its node: the same offer, two
    // right answers, so the dialog states neither
    expect(source).toContain('onclick={() => ontwin(twin)}');
  });

  it('asks the case once the value is typed, not once a letter is', () => {
    expect(source).toContain('setTimeout(');
    expect(source).toContain('}, 250);');
  });

  it('lets the registry decide what counts as the same value', () => {
    // Lowercasing the raw label in the browser let `@handle` and `handle` sit side
    // by side as two accounts, and one phone number spaced two ways as two numbers.
    // `entities.identity_key` is the one comparison, so the route is asked for it.
    expect(source).toContain('/entities/twin?');
    expect(source).not.toContain('buildCatalogQuery');
    expect(source).not.toContain('toLowerCase()');
  });
});

describe('creating something the surface will not show', () => {
  it('says so before the act rather than after it', () => {
    // a graph lens draws some types and not others, and filing something invisible
    // looks exactly like filing nothing at all
    expect(source).toContain('const unseen = $derived(hidden.includes(draft.type))');
    expect(source).toContain('{#if unseen && hiddenNote}');
  });
});
