import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('./ClaimConnections.svelte', import.meta.url), 'utf8');
const references = readFileSync(new URL('./ClaimReferences.svelte', import.meta.url), 'utf8');

describe('Claim connections', () => {
  it('gives subjects, location, sources and contradictions separate controls', () => {
    expect(editor).toContain("{ type: 'about', label: 'Subjects', add: 'Add subject' }");
    expect(editor).toContain("{ type: 'at', label: 'Location', add: 'Add location' }");
    expect(editor).toContain("{ type: 'cites', way: 'out', label: 'Sources', add: 'Add source' }");
    expect(editor).toContain('relationType={group.type}');
    expect(editor).toContain('action="claim"');
  });

  it('reads a citation by direction, because resting on is not symmetric', () => {
    // this statement resting on that one is a different fact from that one resting on
    // this, so the two readings are two groups
    expect(editor).toContain("label: 'Supports'");
    expect(editor).toContain("hint: 'statements that rest on this one'");
    expect(editor).toContain('row.direction === group.way');
  });

  it('states what rests on a statement from where that reasoning is written', () => {
    // the incoming group takes no source: it is added from the citing claim
    expect(editor).toContain('{#if group.add}');
    expect(editor).toContain('{#if group.add && adding === group.type}');
    // and a reading nobody can add to earns a heading only once it holds something
    expect(editor).toContain('{#if group.add || items.length}');
  });

  it('reads a contradiction under one heading, whichever end filed it', () => {
    // two statements that cannot both hold say the same thing from either end, so
    // splitting them into "contradicts" and "is contradicted by" would be two
    // headings for one finding — the group declares no `way`, so both are listed
    expect(editor).toContain(
      "{ type: 'contradicts', label: 'Contradictions', add: 'Add contradiction' }"
    );
    expect(editor).toContain('(!group.way || row.direction === group.way)');
  });

  it('stores the connector through the shared relation contract', () => {
    expect(editor).toContain('await saveRelation(caseId, claim.id, choice)');
    expect(editor).toContain('api.del(`/api/cases/${caseId}/links/${link.id}`)');
    expect(editor).not.toContain('api.patch');
  });

  it('never reads a rating off a Claim connector', () => {
    // Confidence belongs to the Claim node, and `about`/`at`/`cites` are declared
    // `ratable: false`, so no route can put one on these edges. Rendering one would
    // be a control for a state the model cannot reach.
    for (const source of [editor, references]) {
      expect(source).not.toContain('link.confidence');
      expect(source).not.toContain('confidenceLabel');
    }
  });

  it('shows incoming Claims as references, not editable relations', () => {
    expect(references).toContain('relationReading(row.link.type, row.direction)');
    expect(references).toContain('onwalk?.(row.entity)');
    expect(references).not.toContain('api.patch');
    expect(references).not.toContain('api.del');
  });
});
