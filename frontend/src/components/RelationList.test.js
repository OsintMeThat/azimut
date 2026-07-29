import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./RelationList.svelte', import.meta.url), 'utf8');

describe('RelationList', () => {
  it('is the one body every surface renders relations through', () => {
    // the case sidebar, the Media info modal, the map popup — and next the case
    // board. A second copy is how the vocabulary and the gestures drift apart.
    const hosts = ['EntityDetails.svelte', '../tools/satellite/SavedPopup.svelte'];
    for (const host of hosts) {
      const body = readFileSync(new URL(host, import.meta.url), 'utf8');
      expect(body).toContain('RelationList');
      // no host keeps its own confirm/dismiss call
      expect(body).not.toContain("{ status: 'confirmed' }");
    }
  });

  it('names an edge from the shared vocabulary, never by its type slug', () => {
    expect(source).toContain("from '../lib/relations.svelte.js'");
    expect(source).toContain('relationVerb(relation.link.type)');
  });

  it('offers confirm only on a suggestion', () => {
    expect(source).toContain("relation.link?.provenance?.status === 'suggested'");
    expect(source).toContain("api.patch(`/api/cases/${caseId}/links/${link.id}`, { status: 'confirmed' })");
    expect(source).toContain('{#if suggested}');
    expect(source).toContain('title="Confirm this relation"');
    expect(source).toContain('await onchanged?.()');
  });

  it('lets any relation be taken back, whatever its status', () => {
    // a relation is a statement; correcting one means removing the edge, and a
    // confirmed relation the analyst stated by hand is the likeliest mistake
    expect(source).toContain('api.del(`/api/cases/${caseId}/links/${link.id}`)');
    expect(source).toContain("title={suggested ? 'Dismiss this relation' : 'Remove this relation'}");
    expect(source).toContain("toast(suggested ? 'Relation dismissed' : 'Relation removed'");
    // the remove button sits outside the suggested-only branch
    const removeAt = source.indexOf('onclick={own(() => remove(relation.link, suggested))}');
    const branchEnd = source.indexOf('{/if}', source.indexOf('{#if suggested}'));
    expect(removeAt).toBeGreaterThan(branchEnd);
  });

  it('corrects a wrong reading on the same edge, without deleting it', () => {
    // a relation stays editable: same id, same provenance, right verb
    expect(source).toContain("api.patch(`/api/cases/${caseId}/links/${link.id}`, { type })");
    expect(source).toContain('function verbOptions(relation)');
    expect(source).toContain("option.direction === relation.direction");
    expect(source).toContain('return options.length > 1 ? options : [];');
    // no subject type means no restating: the alternatives cannot be worked out
    expect(source).toContain('if (!subjectType) return [];');
  });

  it('is given the subject type by every host, so restating works everywhere', () => {
    const hosts = {
      'EntityDetails.svelte': 'subjectType={entity.type}',
      '../tools/satellite/SavedPopup.svelte': "subjectType={row.kind === 'place' ? 'place' : 'capture'}",
      '../tools/Satellite.svelte': 'subjectType="place"',
    };
    for (const [host, expected] of Object.entries(hosts)) {
      const body = readFileSync(new URL(host, import.meta.url), 'utf8');
      expect(body).toContain(expected);
    }
  });

  it('keeps its clicks to itself, inside each handler', () => {
    // In a Leaflet popup, a click that looks like it reached the map closes the
    // card. These controls replace themselves, so their button can be detached by
    // the time the event bubbles and Leaflet's walk up to the popup container
    // finds nothing. It has to be stopped *in* the handler: Svelte delegates these
    // clicks to the app root, so an ancestor that stopped them would silence the
    // buttons instead of shielding them.
    expect(source).toContain('function own(handler)');
    expect(source).toContain('event.stopPropagation();');
    for (const wired of [
      'onclick={own(() => walk(relation.entity))}',
      'onclick={own(() => confirm(relation.link))}',
      'onclick={own(() => remove(relation.link, suggested))}',
      'onclick={own(() => (expanded = true))}',
    ]) {
      expect(source).toContain(wired);
    }
    // no host wraps the list in a click-swallowing ancestor
    const popup = readFileSync(new URL('../tools/satellite/SavedPopup.svelte', import.meta.url), 'utf8');
    expect(popup).not.toContain('use:insideCard');
  });

  it('puts the rows awaiting a decision first', () => {
    expect(source).toContain('Number(isSuggested(b)) - Number(isSuggested(a))');
  });

  it('caps a long list behind one click rather than growing the panel', () => {
    expect(source).toContain('max = 6');
    expect(source).toContain('expanded ? ordered : ordered.slice(0, max)');
    expect(source).toContain('+ {hidden} more');
  });

  it('offers the map for a neighbour that carries its own point', () => {
    // confirming "shot here" without seeing where is signing blind
    expect(source).toContain("entity?.type !== 'place'");
    expect(source).toContain('${lat.toFixed(6)}, ${lon.toFixed(6)}');
    expect(source).toContain('title={`Show ${point} on the map`}');
    expect(source).toContain('onclick={own(() => openEntity(relation.entity))}');
  });

  it('keeps the coordinates in the tooltip so a row stays one line', () => {
    expect(source).toContain('title={`Open ${relation.entity.label}${point ? ` · ${point}` : \'\'}`}');
  });
});
