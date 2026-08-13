import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('./TemporalClaimEditor.svelte', import.meta.url), 'utf8');
const picker = readFileSync(new URL('./TemporalTargetPicker.svelte', import.meta.url), 'utf8');

describe('temporal Claim editor', () => {
  it('uses the guided time helper and writes the atomic route', () => {
    expect(editor).toContain("import TemporalInput from './TemporalInput.svelte'");
    expect(editor).toContain('<TemporalInput\n    id="temporal-when"');
    expect(editor).toContain('onvaliditychange={(reading) => (whenValid = reading.valid)}');
    expect(editor).toContain('!whenValid || saving || loading');
    expect(editor).toContain("api.post(`/api/cases/${caseId}/timeline/claims`, body)");
    expect(editor).toContain("api.patch(`/api/cases/${caseId}/timeline/claims/${item.owner_id}`, body)");
  });

  it('keeps Claim confidence separate and allows auditable reasoning', () => {
    expect(editor).toContain('<span class="modal-label">Confidence</span>');
    expect(editor).toContain('How this was worked out');
    expect(editor).toContain('As the source put it');
  });

  it('gets about, place and evidence targets from the served relation registry', () => {
    expect(editor).toContain('relationType="about"');
    expect(editor).toContain('relationType="at"');
    expect(editor).toContain('relationType="cites"');
    expect(picker).toContain("relationOptions('claim', entry.type, 'claim')");
    expect(picker).toContain('buildCatalogQuery(caseId, { types, query: term, limit: 200 })');
  });
});
