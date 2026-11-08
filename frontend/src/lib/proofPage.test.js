import { describe, expect, it } from 'vitest';
import { FakeKonva } from './konva.fixture.js';
import { docSize, footerBand } from './composer.js';
import { drawPage, measurePage } from './proofPage.js';
import { SAMPLE_POINT, SAMPLE_SCENE, sampleProof } from './proofSample.js';
import { sceneBadges } from './proofScene.js';
import { starterData } from './proofTemplates.js';

const measure = (text, size) => text.length * size * 0.5;

function draw(style, options = {}, sample = {}) {
  const layer = new FakeKonva.Layer();
  const proof = sampleProof(style, sample);
  const page = drawPage(FakeKonva, layer, proof, options);
  const texts = layer.find('Text').map((node) => node.attrs.text);
  return { layer, proof, page, texts };
}

describe('the sample a template is shown on', () => {
  it('takes the style the way New proof lays a template on a proof', () => {
    const proof = sampleProof(starterData('free'));
    expect(proof.bg).toBe('#000000');
    expect(proof.layout).toBe('free');
    // stacked, as the template asks of the first two pictures
    expect(proof.panels[1].row).toBe(1);
    expect(proof.panels.every((panel) => !panel.caption)).toBe(true);
  });

  it('gives the two pictures one width when stacked and one height side by side', () => {
    const stacked = sampleProof({ panelDirection: 'vertical' });
    const wide = sampleProof({ panelDirection: 'horizontal' });
    const width = (p) => (p.natural[0] / p.natural[1]) * (p.scale ?? 1);
    expect(width(stacked.panels[0])).toBeCloseTo(width(stacked.panels[1]));
    expect(wide.panels.map((p) => p.scale)).toEqual([1, 1]);
  });

  it('carries a legend only when asked, since its words are a proof\'s own', () => {
    expect(Object.values(sampleProof({}).notes)).toEqual(['Half Dome', 'Nevada Fall', 'Line of sight']);
    expect(sampleProof({}, { legend: false }).notes).toEqual({});
  });
});

describe('the sample drawn as a page', () => {
  it('is the size the composer would measure for it', () => {
    const proof = sampleProof(starterData('legend'));
    const { width, height, printed } = measurePage(proof, { measure });
    const expected = docSize(proof.panels, proof.shapes, proof.notes, {
      captionSize: proof.captionSize, legendSize: proof.legendSize, footerSize: proof.footerSize,
      footerEnabled: true, footerLines: printed.length,
    }, proof.legendOrder, proof.layout, proof.space);
    expect({ width, height }).toEqual({ width: expected.width, height: expected.height });
  });

  it('prints captions, the legend and the footer the template asks for', () => {
    const { texts, page, layer } = draw(starterData('legend'));
    expect(texts).toContain('Ground photo, 1901');
    expect(texts).toContain('Half Dome');
    expect(texts).toContain(SAMPLE_POINT);
    expect(texts).toContain('Composed with Azimut · USGS The National Map');
    expect(layer.find('Rect').find((node) => node.name() === 'bg').attrs.fill).toBe('#0d1117');
    expect(page.width).toBeGreaterThan(0);
  });

  it('leaves out what the template turns off', () => {
    const { texts } = draw(starterData('bare'), {}, { legend: false });
    expect(texts).not.toContain('Ground photo, 1901');
    expect(texts).not.toContain('Composed with Azimut');
    expect(texts).not.toContain(SAMPLE_POINT);
  });

  it('keeps the credits off the footer until the template asks for them', () => {
    const { texts } = draw(starterData('free'));
    expect(texts).toContain('Composed with Azimut');
    expect(texts).not.toContain('Composed with Azimut · USGS The National Map');
  });

  it('prints the scene time on the frame when the template turns it on', () => {
    const style = starterData('legend');
    const badges = sceneBadges(true, SAMPLE_SCENE.frames, SAMPLE_SCENE.star, SAMPLE_SCENE.moments);
    const { texts } = draw(style, { badges });
    expect(texts.some((text) => /0:42/.test(text))).toBe(true);
  });

  it('shows where the logo goes when none is saved, and the handle when one is', () => {
    const { page, texts } = draw(starterData('free'), { handle: '@desk' });
    expect(texts).toContain('Your logo');
    expect(page.logo.id()).toBe('sig-logo');
    expect(page.handle.attrs.text).toBe('@desk');
    // stacked as the composer stacks them: the logo over the handle, in the same corner
    expect(page.logo.y()).toBeLessThan(page.handle.y());
  });

  it('adds the Azimut mark only when the template carries it', () => {
    expect(draw(starterData('free')).layer.findOne('#azimut-mark')).toBeUndefined();
    const marked = { ...starterData('free'), azimutMark: { anchor: 'br', name: true, size: 28 } };
    const { layer, page } = draw(marked, { handle: '@desk' });
    const mark = layer.findOne('#azimut-mark');
    expect(mark).toBeDefined();
    expect(layer.children.at(-1)).toBe(mark);
    expect(page.height).toBeGreaterThan(footerBand(28));
  });
});
