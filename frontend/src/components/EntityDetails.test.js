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

describe('import enrichment details', () => {
  it('keeps parsed image metadata in a collapsed EXIF section', () => {
    expect(source).toContain('<details class="metadata-details">');
    expect(source).toContain('<summary>EXIF metadata');
    expect(source).toContain('{infoData.taken_at}');
    expect(source).toContain('formatCoords(infoData.gps)');
    expect(source).toContain('{#each Object.entries(infoData.exif ?? {}) as [key, value] (key)}');
  });

  it('uses the same collapsed section for local video probe metadata', () => {
    expect(source).toContain('<summary>Video metadata');
    expect(source).toContain('Object.keys(infoData.video_metadata ?? {}).length');
    expect(source).toContain(
      '{#each Object.entries(infoData.video_metadata) as [key, value] (key)}'
    );
  });

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

describe('reading the file behind an entity', () => {
  it('reads one media file, not the whole case, to show its metadata', () => {
    // the EXIF and video dumps this panel renders are hundreds of rows each and
    // are deliberately absent from the browse index, so the list would neither
    // carry them nor be cheap to fetch
    expect(source).toContain('/media/item?path=${encodeURIComponent(path)}');
    expect(source).not.toContain('const list = await api.get(');
  });

  it('still reads a capture off the satellite list, which has no per-item read', () => {
    expect(source).toContain("(await api.get(`/api/cases/${cid}/satellite`)).find((m) => m.path === path)");
  });

  it('drops the panel data when the entity names no file', () => {
    expect(source).toContain("if (!path || (e.type !== 'media' && e.type !== 'capture'))");
  });
});

describe('metadata arriving after the panel opened', () => {
  it('polls the file while its enrichment job is still running', () => {
    // Enrichment runs in a job, so a file opened moments after its import has no
    // metadata yet. The Media Library's poll covers the modal it hosts, but this
    // body also lives in the case sidebar, where nothing else is watching.
    expect(source).toContain("infoData?.enrich_state === 'queued' || infoData?.enrich_state === 'running'");
    expect(source).toContain('return pollWhile(() => enriching, () => resolve(entity, false, true), 1500);');
  });

  it('re-reads quietly, so a background job finishing does not look like a fault', () => {
    expect(source).toContain('async function resolve(e, seedFields, quiet = false)');
    expect(source).toContain('if (!quiet) infoLoading = true;');
    // and a poll that missed keeps what is on screen rather than blanking it
    expect(source).toContain('if (!quiet) infoData = null;');
  });
});
