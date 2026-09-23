import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('../lib/navigate.js', () => ({ openCopernicusSettings: vi.fn() }));
const { default: CopernicusNeeded } = await import('./CopernicusNeeded.svelte');

describe('what a tool needs from Copernicus', () => {
  it('says the account is free, and how to add both layers', () => {
    const { body } = render(CopernicusNeeded, { props: { need: 'account', tool: 'Detect' } });
    expect(body).toContain('Detect needs a Copernicus key');
    expect(body).toContain('free');
    expect(body).toContain('Simple Sentinel-2 L2A template');
    // the template brings Sentinel-2; Sentinel-1 is a layer added by hand
    expect(body).toContain('The template brings the Sentinel-2 layers with it');
    expect(body).toContain('Sentinel-1 GRD');
    expect(body).toContain('Open Settings → Imagery');
  });

  it('walks the radar layer form field by field once the key is set', () => {
    const { body } = render(CopernicusNeeded, { props: { need: 'radar', tool: 'Two radar passes' } });
    expect(body).toContain('Two radar passes needs the Sentinel-1 layer');
    for (const field of ['Data processing', 'Polarization', 'VV + VH', 'Orthorectification', 'Speckle Filter']) {
      expect(body).toContain(field);
    }
    expect(body).toContain('Open the Configuration Utility');
    expect(body).not.toContain('Simple Sentinel-2 L2A template');
  });
});
