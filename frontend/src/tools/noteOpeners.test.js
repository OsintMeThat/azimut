import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openerFor, resetOpeners, registerOpener } from '../lib/notes/openers.js';
import { uiState } from '../lib/state.svelte.js';
import { proofOpener } from './proof/proof.opener.js';
import { captureOpener } from './satellite/capture.opener.js';
import { pairOpener } from './compare/pair.opener.js';
import { collageOpener, frameOpener } from './inspect/frame.opener.js';
import { pinOpener } from './detect/pin.opener.js';
import { plateOpener } from './plate/plate.opener.js';
import { viewOpener } from './horizon/view.opener.js';
import { takeSeek } from './inspect/handoff.js';
import { takeCandidate } from './detect/handoff.js';

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn() } }));

/**
 * The way back from a picture in a note to the tool state it was made in. Each
 * opener is checked for what it accepts (the bar shows `Open in <Tool>` only then)
 * and for what it hands the tool.
 */
beforeEach(() => {
  resetOpeners();
  for (const [tool, opener] of [['proof', proofOpener], ['satellite', captureOpener], ['compare', pairOpener],
    ['inspect', frameOpener], ['collage', collageOpener], ['detect', pinOpener], ['plate', plateOpener], ['horizon', viewOpener]]) registerOpener(tool, opener);
  uiState.tool = 'notebook';
});

const media = (attrs) => ({ id: 'e_m', type: 'media', label: 'm', attrs: { path: 'media/m.png', ...attrs } });

describe('opening a note\'s picture where it was made', () => {
  it('opens a proof in Geo Proof', () => {
    const found = openerFor({ id: 'e_p', type: 'proof', label: 'P', attrs: { spec: 'proofs/.meta/Port strike.json', path: 'proofs/Port strike.png' } });
    expect(found.label).toBe('Open in Geo Proof');
    found.open();
    expect(uiState.openProof).toBe('Port strike');
    expect(uiState.tool).toBe('proof');
  });

  it('opens a capture in the Map on its view and basemap', () => {
    const found = openerFor({ id: 'e_c', type: 'capture', label: 'c',
      attrs: { path: 'media/sat.png', lat: 15.37, lon: 44.19, zoom: 17, bearing: 30, provider: 'esri-world-imagery' } });
    expect(found.label).toBe('Open in Map');
    found.open();
    expect(uiState.gotoCoords).toEqual({ lat: 15.37, lon: 44.19, zoom: 17, bearing: 30, provider: 'esri-world-imagery' });
    expect(uiState.focusCapture).toBe('media/sat.png');
    expect(uiState.tool).toBe('satellite');
  });

  it('opens a kept pair on its saved comparison', () => {
    const found = openerFor(media({ compare_session: 'compare/Water tower, 2024-05-03 to 2026-09-02.json' }));
    expect(found.label).toBe('Open in Compare');
    found.open();
    expect(uiState.openCompare).toBe('Water tower, 2024-05-03 to 2026-09-02');
    expect(uiState.tool).toBe('compare');
  });

  it('opens a frame on its video at the instant it was cut', () => {
    const found = openerFor(media({ frame_of: 'media/clip.mp4', frame_time: 12.48 }));
    expect(found.label).toBe('Open in Inspect');
    found.open();
    expect(uiState.inspectPath).toBe('media/clip.mp4');
    expect(takeSeek('media/other.mp4')).toBe(null);
    expect(takeSeek('media/clip.mp4')).toBe(12.48);
    expect(takeSeek('media/clip.mp4')).toBe(null); // once
  });

  it('opens a collage\'s picture on the collage', () => {
    const found = openerFor(media({ collage: 'Quay panorama' }));
    expect(found.label).toBe('Open in Collage');
    found.open();
    expect(uiState.openCollage).toBe('Quay panorama');
  });

  it('opens a pin\'s evidence on its run, at its candidate', () => {
    const found = openerFor(media({ analysis_run: 'a1b2c3d4e5f6', candidate_id: '0-3' }));
    expect(found.label).toBe('Open in Detect');
    found.open();
    expect(uiState.openAnalyzer).toBe('runs-a1b2c3d4e5f6');
    expect(takeCandidate('a1b2c3d4e5f6')).toBe('0-3');
  });

  it('opens a plate\'s page on the plate, at the day and the step it shows', () => {
    const found = openerFor(media({ plate_spec: '.mapplates/Port strike.json', plate_day: '2026-03-02', plate_step: 'st_2' }));
    expect(found.label).toBe('Open in Map plate');
    found.open();
    expect(uiState.openPlate).toBe('Port strike');
    expect(uiState.openPlateAt).toEqual({ day: '2026-03-02', step: 'st_2' });
    expect(uiState.tool).toBe('plate');
    // the days side by side show no one day: the plate opens as it was left
    openerFor(media({ plate_spec: '.mapplates/Port strike.json' })).open();
    expect(uiState.openPlateAt).toBe(null);
  });

  it('opens a picture kept from a saved Horizon view on that view', () => {
    const found = openerFor(media({ horizon_view: '.horizon/Ridge above the town.json' }));
    expect(found.label).toBe('Open in Horizon');
    found.open();
    expect(uiState.openHorizonView).toBe('Ridge above the town');
    expect(uiState.tool).toBe('horizon');
  });

  it('offers nothing for a picture no tool can reopen', () => {
    expect(openerFor(media({}))).toBe(null);
    expect(openerFor({ id: 'e_c', type: 'capture', label: 'c', attrs: { path: 'x.png' } })).toBe(null);
    expect(openerFor(media({ analysis_run: '../etc', candidate_id: '1' }))).toBe(null);
  });
});
