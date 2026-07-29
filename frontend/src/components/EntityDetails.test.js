import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EntityDetails.svelte', import.meta.url), 'utf8');

describe('capture details', () => {
  it('shows the recorded external capture page as a link', () => {
    expect(source).toContain('{#if infoData?.source_url}');
    expect(source).toContain('<span class="info-k">Source page</span>');
    expect(source).toContain('href={infoData.source_url}');
    expect(source).toContain('target="_blank" rel="noreferrer"');
  });
});

describe('relations in details', () => {
  it('renders relations through the shared list, walking the panel in place', () => {
    expect(source).toContain('relations={chain?.relations ?? []}');
    expect(source).toContain('onwalk={(target) => (walkedId = target.id)}');
    expect(source).toContain('onchanged={reloadCase}');
  });

  it('separates relations from the derivation chain, which has its own rule', () => {
    // a relation says something about the world; the chain says how a file was
    // made and decides what a delete destroys
    expect(source).toContain(
      '{#if chain && (chain.sources.length || chain.lost.length || chain.dependents.length)}'
    );
    expect(source).toContain('{#if canRelate}');
    expect(source).toContain('relatableTypes(entity.type).length > 0');
  });

  it('files a stated relation with Save rather than adding a second commit button', () => {
    expect(source).toContain('<RelationPicker subjectType={entity.type} bind:value={pendingRelation} />');
    expect(source).toContain('if (pendingRelation) {');
    expect(source).toContain('await saveRelation(cid, entity.id, pendingRelation);');
  });

  it('drops a pending relation when the panel walks to another entity', () => {
    expect(source).toContain('currentId; // a different entity means a different subject');
    expect(source).toContain('pendingRelation = null;');
  });
});
