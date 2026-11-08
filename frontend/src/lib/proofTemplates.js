/**
 * Proof templates as Settings › Templates makes them: the starters a new one is
 * picked from, the default New proof starts with, and a template said in a few words.
 *
 * Starters are offered when a template is made and never put in the analyst's list
 * on their own. Each is a whole style, so it says everything a template can say,
 * the scene time and the imagery credits included. They cover the ways proofs are
 * usually laid out: pictures placed freely with no legend, a grid with a colour legend,
 * a before-and-after pair, a stack sized for a post, and pictures alone for a
 * report. None names anyone: a logo and a handle are slots, filled from Settings ›
 * Publishing when there is one. `legend` says whether its card shows the sample with
 * a legend, since the legend's words are a proof's own and no template holds them.
 */
import { PAD, GAP, ROW_GAP, newSignature, newSignatureText, normalizeProofStyle } from './composer.js';
import { DEFAULT_PROOF_FONT, PROOF_FONTS } from './proofFonts.js';

/** A palette that reads on a white page: the shipped one, deeper, with black for white. */
const ON_WHITE = ['#e53935', '#1e88e5', '#f9a825', '#43a047', '#8e24aa', '#fb8c00', '#212121'];

/** Every key a style can state, from Azimut's own defaults for a new proof. */
function style(overrides = {}) {
  return normalizeProofStyle({
    font: DEFAULT_PROOF_FONT,
    sceneBadge: false,
    footerCredits: false,
    ...overrides,
  });
}

export const PROOF_STARTERS = Object.freeze([
  {
    id: 'blank',
    name: 'Blank',
    said: 'The look a new proof has, to make your own.',
    legend: true,
    data: style(),
  },
  {
    id: 'free',
    name: 'Free layout',
    said: 'Pictures placed freely on black, no captions or legend, one footer line.',
    legend: false,
    data: style({
      bg: '#000000', layout: 'free', panelDirection: 'vertical', space: { pad: 15, gap: 15, rowGap: 15 },
      captionsEnabled: false, legendSize: 26, footerSize: 28, footerColor: '#ffffff', font: 'barlow',
      signature: newSignature(), signatureText: { ...newSignatureText(), size: 36 },
    }),
  },
  {
    id: 'legend',
    name: 'Grid with a legend',
    said: 'Captioned pictures in a row, a colour legend under them, the point and credits below.',
    legend: true,
    data: style({
      bg: '#0d1117', layout: 'grid', space: { pad: PAD, gap: GAP, rowGap: ROW_GAP },
      captionSize: 22, legendSize: 24, footerSize: 18, footerCoords: true, footerCredits: true,
      sceneBadge: true, signatureText: newSignatureText(),
    }),
  },
  {
    id: 'pair',
    name: 'Before and after',
    said: 'Two pictures side by side on white, each with its caption.',
    legend: false,
    data: style({
      bg: '#ffffff', layout: 'grid', space: { pad: 24, gap: 10, rowGap: 18 },
      captionSize: 24, legendSize: 22, footerSize: 18, footerCoords: true, footerCredits: true,
      signatureText: { ...newSignatureText(), color: '#1b1f24' }, palette: ON_WHITE,
    }),
  },
  {
    id: 'post',
    name: 'Stacked for a post',
    said: 'One picture over the other, the words large enough to read on a phone.',
    legend: true,
    data: style({
      bg: '#0d1117', layout: 'grid', panelDirection: 'vertical', space: { pad: 18, gap: 12, rowGap: 12 },
      captionSize: 34, legendSize: 32, footerSize: 26, footerCoords: true,
      signatureText: { ...newSignatureText(), size: 36 },
    }),
  },
  {
    id: 'bare',
    name: 'Pictures only',
    said: 'No margin, caption or footer, for a report that says the rest.',
    legend: false,
    data: style({
      bg: '#ffffff', layout: 'grid', space: { pad: 0, gap: 6, rowGap: 6 },
      captionsEnabled: false, footerEnabled: false, palette: ON_WHITE,
    }),
  },
]);

/** A starter's style, as a copy the editor can change. */
export function starterData(id) {
  const starter = PROOF_STARTERS.find((one) => one.id === id) ?? PROOF_STARTERS[0];
  return JSON.parse(JSON.stringify(starter.data));
}

/**
 * The template New proof starts with: the one Settings marks as the default, while
 * it exists. An id whose template was deleted reads as none, without a word.
 */
export function defaultProofTemplate(templates, id) {
  if (!id) return null;
  return (templates ?? []).find((template) => template.id === id) ?? null;
}

/** A template in a few words, under its name: how its pictures sit and its typeface. */
export function proofTemplateSummary(data) {
  const look = normalizeProofStyle(data);
  const layout = look.layout === 'free'
    ? 'Free layout'
    : look.panelDirection === 'vertical' ? 'Stacked' : 'Side by side';
  const face = PROOF_FONTS.find((font) => font.id === look.font)?.label ?? 'System font';
  return `${layout} · ${face}`;
}
