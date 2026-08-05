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
    expect(source).toContain('relationReading(relation.link.type, relation.direction)');
  });

  it('offers confirm only on a suggestion', () => {
    expect(source).toContain("relation.link?.provenance?.status === 'suggested'");
    expect(source).toContain("api.patch(`/api/cases/${caseId}/links/${link.id}`, { status: 'confirmed' })");
    expect(source).toContain('{#if suggested && !older}');
    expect(source).toContain('title="Confirm this relation"');
    expect(source).toContain('await onchanged?.()');
  });

  it('lets any relation be taken back, whatever its status', () => {
    // a relation is a statement; correcting one means removing the edge, and a
    // confirmed relation the analyst stated by hand is the likeliest mistake
    expect(source).toContain('api.del(`/api/cases/${caseId}/links/${link.id}`)');
    expect(source).toContain("const noun = action === 'mention' ? 'Mention' : 'Relation';");
    expect(source).toContain('title={suggested ? `Dismiss this ${action}` : `Remove this ${action}`}');
    // the remove button sits outside the suggested-only branch
    const removeAt = source.indexOf('onclick={own(() => remove(relation.link, suggested, action))}');
    const branchEnd = source.indexOf('{/if}', source.indexOf('{#if suggested}'));
    expect(removeAt).toBeGreaterThan(branchEnd);
  });

  it('corrects a wrong reading on the same edge, without deleting it', () => {
    // a relation stays editable: same id, same provenance, right verb
    expect(source).toContain("api.patch(`/api/cases/${caseId}/links/${link.id}`, { type })");
    expect(source).toContain('function verbOptions(relation)');
    expect(source).toContain('relationAction(relation.link.type)');
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
      'onclick={own(() => remove(relation.link, suggested, action))}',
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

  it('keeps one light list in every host', () => {
    expect(source).toContain('<div class="relations">');
    expect(source).not.toContain('class:cards');
    expect(source).not.toContain('.relations.cards');
  });

  it('offers the map for a neighbour that carries its own point', () => {
    // confirming "recorded here" without seeing where is signing blind
    expect(source).toContain("entity?.type !== 'place'");
    expect(source).toContain('${lat.toFixed(6)}, ${lon.toFixed(6)}');
    expect(source).toContain('title={`Show ${point} on the map`}');
    expect(source).toContain('onclick={own(() => openEntity(relation.entity))}');
  });

  it('keeps the coordinates in the tooltip so a row stays one line', () => {
    expect(source).toContain('title={`Open ${relation.entity.label}${point ? ` · ${point}` : \'\'}`}');
  });

  it('gives the name a line of its own and what it states the next one', () => {
    // beside two controls in a 300px panel a filename came out as "IM…", and the
    // name is what the analyst reads first
    expect(source).toContain('<div class="head">');
    expect(source).toContain('<div class="says">');
    // the verb reads the same whether it can be restated or not
    expect(source).toContain('<span class="chip verb" title=');
  });

  it('draws its own controls instead of letting the OS size a select', () => {
    // a native select is rendered in the browser's UI font and ignores much of what
    // it is told at this size, which is how the rating came out visibly larger than
    // the verb beside it. One chip rule carries both.
    expect(source).toContain('class="select chip verb-select"');
    expect(source).toContain('class="select chip rate"');
    expect(source).toContain('appearance: none;');
    expect(source).toContain('font: inherit;');
    // and it stays the app's dropdown rather than a second kind: same fill, border,
    // radius and focus ring, one size down
    expect(source).toContain('border-radius: var(--r-sm);');
    expect(source).toContain('font-size: var(--fs-xs);');
    expect(source).toContain('box-shadow: 0 0 0 2px var(--accent-soft);');
  });

  it('names the neighbour in its own class, clear of the form-label utility', () => {
    // app.css's `.label` upper-cases and shrinks whatever wears it, so a filename in
    // a relation row came out as a heading
    expect(source).toContain('<span class="name">');
    expect(source).not.toContain('class="label"');
  });

  it('colours the dropdown itself, which the browser draws from the control', () => {
    // a chip left transparent opened white-on-white in dark mode
    expect(source).toContain('.chip option {');
    expect(source).toContain('background-color: var(--bg-1);');
  });
});

describe('how sure of one relation', () => {
  it('rates an edge through the link patch, and clears with null not a level', () => {
    // absent is a state to return to, so '' sends null rather than being left out of
    // the body — a level picked by mistake must not be a hole
    expect(source).toContain("const value = raw === '' ? null : Number(raw);");
    expect(source).toContain('{ confidence: value }');
  });

  it('offers the levels the registry serves rather than a list of its own', () => {
    expect(source).toContain('{#each confidenceLevels() as level (level.value)}');
    expect(source).toContain('<option value="">Not assessed</option>');
  });

  it('shows no control where the API would refuse one', () => {
    // a derivation carries no rating, and a suggestion is reviewed before it is rated
    expect(source).toContain(
      '{#if !older && !suggested && isRatable(relation.link.type) && confidenceLevels().length}'
    );
  });

  it('keeps a ruled-out candidate in the list, dimmed rather than struck out', () => {
    // the elimination is the finding: eleven ruled out and one probable is what the
    // panel has to be able to show at a glance
    expect(source).toContain('class:refuted={rating === -1}');
    expect(source).toContain('.relation.refuted .subject .name {');
    expect(source).not.toContain('text-decoration: line-through');
  });

  it('stays quiet until it holds a level, since unrated is the common case', () => {
    expect(source).toContain('class:set={rating !== null}');
    expect(source).toContain('class:out={rating === -1}');
  });
});

describe('the vocabulary explains itself', () => {
  it('says what the verb means, from the registry rather than from here', () => {
    // "is part of" against "owns" is the distinction an order of battle turns on,
    // and neither word says it on its own
    expect(source).toContain("title={relationHint(relation.link.type) || 'What this relation states'}");
    expect(source).toContain('<span class="chip verb" title={relationHint(relation.link.type)}>');
  });

  it('places the rating on the scale rather than repeating its own label', () => {
    expect(source).toContain('confidenceHint(rating) || confidenceLabel(rating)');
  });
});

describe('how reliable the source is', () => {
  it('reads the grade off the neighbour, in the registry’s words', () => {
    // the letters are data, and the key is the contract — the same split as the
    // confidence levels, which are served rather than spelled here
    expect(source).toContain("import { loadEntityTypes, reliabilityOf } from '../lib/entityTypes.svelte.js'");
    expect(source).toContain('{@const source = reliabilityOf(relation.entity)}');
    expect(source).not.toMatch(/Usually reliable|Admiralty/);
  });

  it('never folds it into the edge’s rating', () => {
    // the whole point of the Admiralty scheme: two axes, never one number. So the
    // grade sits on the line carrying the entity's name, and the rating on the line
    // below carrying the edge's verb — no expression ever holds both.
    const head = source.slice(source.indexOf('<div class="head">'), source.indexOf('<div class="says">'));
    expect(head).toContain('title={`Source reliability: ${source.label}`}');
    expect(head).not.toMatch(/\{[^}]*\brating\b/);
    const says = source.slice(source.indexOf('<div class="says">'), source.indexOf('{/each}'));
    expect(says).not.toContain('source.grade');
  });

  it('shows nothing at all for an ungraded source', () => {
    // absence is never flagged: most sources are never graded, and a "not assessed"
    // badge on each of them is how an optional field becomes a chore
    expect(source).toContain('{#if source}');
    expect(source).not.toContain('Ungraded');
  });

  it('states the grade rather than offering it, since it belongs to that entity', () => {
    // it is edited in the source's own panel; a dropdown here would suggest this row
    // is what carries it
    expect(source).toContain('<span class="grade"');
    expect(source).not.toContain('class="select chip grade"');
  });

  it('loads the entity registry itself, since two of its three homes do not', () => {
    expect(source).toContain('loadEntityTypes();');
  });
});

describe('a pointer sits under its own heading', () => {
  it('takes the split from the registry rather than naming a verb here', () => {
    // which verbs head their own section is `links.RelationType.group`; a component
    // that knew "mentions" by name would have to be edited for the next one
    expect(source).toContain('relationGroup(relation.link.type)');
    expect(source).toContain('<p class="group">{section.group}</p>');
    // no verb is named in the code itself: the split is registry data
    expect(source).not.toContain("=== 'mentions'");
    expect(source).not.toContain("'Mentions'");
  });

  it('leaves the heading to a list that runs several actions together', () => {
    // a host that asked for one action has already named it above the list, and
    // the section drawing its own heading over its own rows said the word twice
    expect(source).toContain("actionFilter ? '' : relationGroup(relation.link.type)");
  });

  it('keeps the ungrouped rows first and unheaded, so the common list is unchanged', () => {
    // the map is seeded with the empty group, which is what fixes that order
    expect(source).toContain("const groups = new Map([['', []]]);");
    expect(source).toContain('{#if section.group}');
  });

  it('draws every row through one body, headed or not', () => {
    // a second copy of the row markup under the heading is how the two kinds of
    // statement start offering different gestures
    expect(source).toContain('{#snippet row(relation)}');
    expect((source.match(/\{@render row\(relation\)\}/g) ?? []).length).toBe(1);
  });

  it('shows the directed mention reading without a confidence control', () => {
    expect(source).toContain("{@const action = relationAction(relation.link.type)}");
    expect(source).toContain("class:mention={action === 'mention'}");
    expect(source).toContain("{:else if action === 'mention'}");
    expect(source).toContain('{relationReading(relation.link.type, relation.direction)}');
  });

  it('leaves an older out-of-matrix connection removable but not editable', () => {
    expect(source).toContain('const legacy = (relation) => !isCurrentConnection');
    expect(source).toContain('{#if older}');
    expect(source).toContain('<span class="older">Older connection</span>');
  });
});
