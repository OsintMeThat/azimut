import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EntityDetails.svelte', import.meta.url), 'utf8');

describe('entity photos', () => {
  it('shows the gallery only for types enabled by the registry', () => {
    expect(source).toContain("import EntityImages from './EntityImages.svelte'");
    expect(source).toContain('{#if hasImageGallery(entity.type)}');
    expect(source).toContain('<EntityImages {entity} />');
  });
});

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
    expect(source).toContain('relations={ordinaryRelations}');
    expect(source).toContain('relations={mentionRelations}');
    expect(source).toContain('onwalk={(target) => walkTo(target.id)}');
    expect(source).toContain('onchanged={reloadCase}');
  });

  it('asks before following a connection would throw away an unsaved field', () => {
    // walking replaces what the panel shows, which loses a half-typed field the
    // same way closing does — and it used to happen on one click, silently
    expect(source).toContain('function walkTo(id) {');
    expect(source).toContain('if (dirty) pendingWalk = id;');
    expect(source).toContain('{#if pendingWalk}');
  });

  it('reports whether Save has taken what is on screen, for the host that closes it', () => {
    expect(source).toContain('dirty = $bindable(false)');
    expect(source).toContain('function snapshot() {');
    expect(source).toContain('snapshot(); // what is on screen is now what the case holds');
  });

  it('says a proposal is one, and settles it where it is read', () => {
    expect(source).toContain("entity.provenance?.status === 'suggested'");
    expect(source).toContain("status: 'confirmed',");
    expect(source).toContain('async function confirmEntity()');
  });

  it('separates relations from the derivation chain, which has its own rule', () => {
    // a relation says something about the world; the chain says how a file was
    // made and decides what a delete destroys
    expect(source).toContain(
      '{#if canRelate || canMention || hasRelations || lineageCount || placedPoints.length}'
    );
    expect(source).toContain('{#if lineageCount}');
    expect(source).toContain('<details class="lineage-card">');
  });

  it('files a connection from its own Add action rather than the panel Save', () => {
    expect(source).toContain('async function addConnection(choice)');
    expect(source).toContain('await saveRelation(caseState.current.id, entity.id, choice);');
    expect(source).toContain('oncommit={addConnection}');
    const saveInfo = source.slice(source.indexOf('async function saveInfo()'), source.indexOf('// ── delete'));
    expect(saveInfo).not.toContain('saveRelation(');
  });

  it('closes the composer when the panel walks to another entity', () => {
    expect(source).toContain('currentId; // a different entity means a different subject');
    expect(source).toContain('connectionComposer = null;');
  });

  it('gives relations and mentions separate controls', () => {
    expect(source).toContain("relatableTypes(entity, 'relation') : []");
    expect(source).toContain("relatableTypes(entity, 'mention') : []");
    expect(source).toContain('>Add relation</button>');
    expect(source).toContain('>Add mention</button>');
    expect(source).toContain('action="relation"');
    expect(source).toContain('action="mention"');
  });

  it('explains each Add button with the target types from the registry', () => {
    expect(source).toContain('relationTargetTypes.map(entityLabel)');
    expect(source).toContain('mentionTargetTypes.map(entityLabel)');
    expect(source).toContain('title={relationTargetHint}');
    expect(source).toContain('title={mentionTargetHint}');
  });

  it('warns when a rename walks an identifier onto one the case already holds', () => {
    // The create dialog has warned since it shipped; renaming is the half where it
    // actually happens — an account filed as a bare handle gets its `@` typed in a
    // week later. Same route, same comparison, and it never refuses.
    expect(source).toContain('/entities/twin?');
    expect(source).toContain("entityFamily(kind) !== 'identifier'");
    expect(source).toContain('ignore: entity.id');
    expect(source).toContain('This case already holds');
    expect(source).toContain('onclick={() => walkTo(twin.id)}');
  });
});

describe('reading the file behind an entity', () => {
  it('can place host actions directly below the media preview', () => {
    expect(source).toContain('previewActions,');
    expect(source).toContain('{@render previewActions()}');
    expect(source).toContain('.info-preview-actions {');
    expect(source).toContain('justify-content: flex-end;');
  });

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

describe('the two tabs', () => {
  it('cuts on the model seam: what the item says in Info, what the analyst states in Case', () => {
    expect(source).toContain("let tab = $state('info')");
    expect(source).toContain('aria-selected={tab === \'info\'}');
    expect(source).toContain(">Info<");
    expect(source).toContain(">Case<");
  });

  it('shows hand-made entity fields directly instead of hiding them behind Case', () => {
    expect(source).toContain('isManualEntityType(entity.type)');
    expect(source).toContain('{#if !unifiedDetails}');
    expect(source).toContain("{#if tab === 'info' || unifiedDetails}");
    expect(source).toContain('{#if unifiedDetails && declaredFields.length}');
    expect(source).toContain("{#if tab === 'case' || unifiedDetails}");
  });

  it('keeps the preview and the title above both, and the actions below', () => {
    const tabs = source.indexOf('<div class="ed-tabs"');
    expect(source.indexOf('class="info-preview"')).toBeLessThan(tabs);
    expect(source.indexOf('id="ed-title"')).toBeLessThan(tabs);
    // Save commits fields from both tabs, so its bar cannot be inside either
    expect(source.indexOf('class="details-actions"')).toBeGreaterThan(
      source.indexOf("{#if tab === 'case' || unifiedDetails}")
    );
  });

  it('names the primary field from the entity type', () => {
    expect(source).toContain('entityIdentityLabel(entity.type)');
    expect(source).toContain('entityIdentityPlaceholder(entity.type)');
    expect(source).toContain('for="ed-title">{identityLabel}</label>');
  });

  it('files the declared fields, the derivation chain and the relations under Case', () => {
    const caseTab = source.indexOf("{#if tab === 'case' || unifiedDetails}");
    // precision is the analyst's judgement, not something the file reports, so it
    // belongs beside the relations rather than among the read-only rows
    expect(source.indexOf('<AttrFields', caseTab)).toBeGreaterThan(caseTab);
    expect(source.indexOf('<details class="lineage-card">')).toBeGreaterThan(caseTab);
    expect(source.indexOf('<RelationList')).toBeGreaterThan(caseTab);
  });

  it('keeps connections light and lineage collapsed', () => {
    expect(source).toContain('<div class="case-layout">');
    expect(source).toContain('<section class="case-card profile-card">');
    expect(source).toContain('<section class="connections">');
    expect(source).not.toContain('connections-card');
    expect(source).not.toContain('layout="cards"');
    expect(source).not.toContain('class="chain-h"');
    expect(source).toContain('Made from & used by');
    expect(source).not.toContain('>History<');
  });

  it('keeps Claim connectors in their own editor', () => {
    expect(source).toContain("{#if entity.type === 'claim'}");
    expect(source).toContain('<ClaimConnections');
    expect(source).toContain('<ClaimReferences');
    expect(source).toContain('relations={claimRelations}');
  });

  it('files the metadata, the notes and the folder under Info', () => {
    const infoTab = source.indexOf("{#if tab === 'info' || unifiedDetails}");
    const caseTab = source.indexOf("{#if tab === 'case' || unifiedDetails}");
    for (const marker of [
      '<div class="info-rows">',
      '<summary>EXIF metadata',
      'id="ed-notes"',
      '<FolderSelect',
    ]) {
      const at = source.indexOf(marker);
      expect(at, marker).toBeGreaterThan(infoTab);
      expect(at, marker).toBeLessThan(caseTab);
    }
  });

  it('opens a freshly walked entity on Info rather than wherever the last one sat', () => {
    expect(source).toContain("tab = 'info';");
  });
});

describe('the declared fields', () => {
  it('are generated from the registry, not written per type here', () => {
    expect(source).toContain("import AttrFields from './AttrFields.svelte'");
    expect(source).toContain('<AttrFields type={entity.type} bind:values={infoAttrs} />');
    expect(source).toContain('{#if unifiedDetails && declaredFields.length}');
  });

  it('are seeded from the entity and committed beside the notes, merged not replaced', () => {
    expect(source).toContain('fields.map((f) => [f.key, e.attrs?.[f.key] ?? null])');
    expect(source).toContain('attrs: { notes: infoNotes.trim(), ...infoAttrs }');
  });

  it('re-seed when the vocabulary lands after the panel opened', () => {
    // The registry is fetched, so an entity can be on screen before its fields are
    // known. `EntityDetails.render.test.js` drives the DOM for the real proof.
    expect(source).toContain('seededFields === 0 && fields.length > 0 && !dirtyNow');
  });

  it('count as something filed, so Case never says the entity is empty while showing them', () => {
    expect(source).toContain('!hasRelations && !declaredFields.length && !lineageCount');
  });
});

describe('a bookmark, which is what a claim rests on', () => {
  it('reports when the page was seen, under Info with the rest of the save', () => {
    // stamped by whatever filed it, so it is what the item says about itself rather
    // than the analyst's judgement — and absent on one typed by hand
    expect(source).toContain('{#if entity.attrs.fetched_at}');
    expect(source).toContain('<span class="info-k">Fetched</span>');
    expect(source).not.toContain('Never fetched');
  });

  it('opens the archived copy, so the field is not one nobody can read back', () => {
    expect(source).toContain("{#if entity.type === 'bookmark' && entity.attrs?.archive_url}");
    expect(source).toContain('href={entity.attrs.archive_url}');
    expect(source).toContain('Open archived copy');
  });

  it('leaves the grade and the archived copy to the generated form', () => {
    // both are declared fields: spelling either one here is a second editor to keep
    // in step with the registry
    expect(source).not.toContain('reliability');
    expect(source).not.toContain('Source reliability');
  });
});

describe('where the chain puts this entity', () => {
  it('reads it from its own route, once the Case tab is on screen', () => {
    // the walk reaches further than the chain's one hop, and the panel opens on
    // Info — a click through a list of rows must not pay for it
    expect(source).toContain("const wanted = tab === 'case' || unifiedDetails;");
    expect(source).toContain('/placement`)');
    expect(source).toContain('if (mySeq === placeSeq) placement = p;');
  });

  it('lists one row per point, because a case can place one file twice', () => {
    expect(source).toContain('{#each placedPoints as point (`${point.lat},${point.lon}`)}');
    expect(source).toContain('<h4>On the map</h4>');
  });

  it('names what placed each point rather than claiming the entity holds it', () => {
    // the relation to the point differs per row — a video was placed there by a
    // proof, a proof by the capture it composes — so the row says it, not the label
    expect(source).toContain('{#if point.via}');
    expect(source).toContain('<span>via {point.via.label}</span>');
    expect(source).toContain('onclick={() => walkTo(point.via.id)}');
  });

  it('offers the map for a point the way a relation row does', () => {
    expect(source).toContain('onclick={() => gotoPoint(Number(point.lat), Number(point.lon))}');
    expect(source).toContain('title={`Show ${pointText(point)} on the map`}');
  });

  it('says when it stopped short instead of trailing off in silence', () => {
    expect(source).toContain('{#if placement?.truncated}');
    expect(source).toContain('More points than this panel lists');
  });
});

describe('what the statements about this entity come to', () => {
  it('adds up the rows the panel was already listing', () => {
    // the claims pointing here were always on screen; answering "how many of these
    // were destroyed" meant reading four rows and doing the arithmetic
    expect(source).toContain('/tally`)');
    expect(source).toContain('if (mySeq === statedSeq) stated = row;');
    expect(source).toContain('{#if stated?.statements || stated?.refuted}');
  });

  it('reads it on the same terms as the placement beside it', () => {
    // its own request, only once the Case tab is on screen, re-read after a save
    expect(source).toMatch(/const mySeq = \+\+statedSeq;/);
    expect(source).toContain('caseState.rev;');
  });

  it('never prints the sum without what it left out', () => {
    expect(source).toContain('countLines(stated, claimReads)');
    expect(source).toContain('noteLines(stated)');
    expect(source).toContain('confidenceLine(stated, claimReads)');
  });

  it('takes its words from the served registry, not a list kept here', () => {
    expect(source).toContain("for (const field of entityFields('claim'))");
  });

  it('sits above the statements rather than replacing them', () => {
    expect(source).toMatch(/<\/div>\s*{\/if}\s*<ClaimReferences/);
  });
});

describe('a file the app has no viewer for', () => {
  it('offers its folder instead of a download', () => {
    // the browser's answer is a copy in Downloads, worked on outside the case
    expect(source).toContain('opensInFileManager(entity)');
    expect(source).toContain('Show in folder');
    expect(source).toContain('onclick={() => showInFolder(entity)}');
  });

  it('drops the tool button for it, since no tool reopens a document', () => {
    expect(source).toContain('{#if (ENTITY_TOOL[entity.type] && !inFileManager)');
  });
});
