import { describe, expect, it } from 'vitest';
import { BLANK, SHEET_TEMPLATES, sheetTemplate, templateMeta } from './sheetTemplates.js';
import { emptyMeta } from './sheet.js';
import { normalizeRole } from './sheetRoles.js';

describe('the sheets a case starts from', () => {
  it('offers the plain one first, which is what the create route makes on its own', () => {
    expect(SHEET_TEMPLATES[0]).toBe(BLANK);
    expect(BLANK.columns).toEqual(['Subject', 'Status', 'Notes']);
  });

  it('names every column it declares a role for', () => {
    for (const template of SHEET_TEMPLATES) {
      for (const column of Object.keys(template.roles ?? {})) {
        expect(template.columns).toContain(column);
      }
      if (template.progress) expect(template.columns).toContain(template.progress);
    }
  });

  it('declares roles the app can actually read', () => {
    for (const template of SHEET_TEMPLATES) {
      for (const role of Object.values(template.roles ?? {})) {
        expect(normalizeRole(role)).not.toBeNull();
      }
    }
  });

  it('falls back to the plain one for a name nobody knows', () => {
    expect(sheetTemplate('nope')).toBe(BLANK);
    expect(sheetTemplate('geoloc').id).toBe('geoloc');
  });

  it('lays its roles over the sidecar the new sheet came back with', () => {
    const meta = templateMeta({ ...emptyMeta(), widths: { Subject: 200 } }, sheetTemplate('geoloc'));
    expect(meta.widths).toEqual({ Subject: 200 });
    expect(meta.roles.Coordinates).toEqual({ kind: 'latlon' });
    expect(meta.roles.Status.kind).toBe('state');
    expect(meta.progress).toBe('Coordinates');
  });

  // The build reads a sheet by its roles, not by its column names, so what a geolocation
  // index is born with is what decides whether `Build proofs` is offered on it at all.
  it('gives the geolocation index the two addresses and the point a build needs', () => {
    const template = sheetTemplate('geoloc');
    expect(template.columns).toEqual([
      'Title',
      'Source media',
      'Geolocation proof',
      'Coordinates',
      'Status',
      'Notes',
    ]);
    const kinds = Object.values(template.roles).map((role) => role.kind);
    expect(kinds.filter((kind) => kind === 'url')).toHaveLength(2);
    expect(kinds).toContain('latlon');
    expect(template.columns).not.toContain('Place');
  });
});
