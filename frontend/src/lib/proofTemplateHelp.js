/**
 * What a proof template's settings say on hover, one clause each. The Azimut mark's
 * words are shared with Geo Proof's Style tab, and the scene time's come from the
 * scene's own help, so the same switch says the same thing everywhere.
 * `proofTemplateHelp.test.js` holds every key to a sentence and to a control.
 */
import { FOOTER_LINE } from './composer.js';
import { PROOF_SCENE_HELP } from './proofSceneHelp.js';

export const PROOF_TEMPLATE_HELP = {
  // the sample
  sampleLegend: 'A legend\'s words are each proof\'s own, so the sample shows one or not',

  // the page
  background: 'The colour behind the pictures, which the text colours follow',
  layout: 'Grid keeps the pictures in rows, Free lets them be placed and overlapped by hand',
  direction: 'How the first two pictures of a new proof sit',
  outerMargin: 'The margin around everything on the page',
  betweenPictures: 'The space between two pictures of a row',
  betweenRows: 'The space between two rows of pictures',

  // the text
  font: 'The typeface every word on the proof is set in, shipped with Azimut',
  bold: 'Sets the words of labels, callouts and tags in bold',
  captions: 'Off, added panels start blank',
  captionSize: 'The size of the words under a picture',
  captionColour: 'Auto follows the background',
  legendSize: 'The size of the legend\'s words',
  sceneBadge: PROOF_SCENE_HELP.badge,

  // the footer
  footer: 'The band under the pictures',
  footerSize: 'The size of the footer\'s words',
  footerCoords: 'Prints the proof\'s points in the footer',
  footerText: 'Prints the footer\'s line',
  footerCredits: 'Adds the panels\' imagery credits after the footer\'s line',
  footerLine: `Left empty, it reads ${FOOTER_LINE}`,
  footerColour: 'Auto follows the background',
  footerAlign: 'Which side the footer\'s words sit on',

  // the signature
  logo: 'Stamps your logo from Settings › Publishing',
  logoCorner: 'The corner the logo starts from, before it is dragged',
  logoSize: 'How much of the page the logo takes',
  logoOpacity: 'How much of the picture shows through the logo',
  handle: 'Prints your handle from Settings › Publishing',
  handleCorner: 'The corner the handle starts from, before it is dragged',
  handleSize: 'The size of the handle',
  handleColour: 'The colour of the handle',
  mark: 'Draws the Azimut mark in a corner, beside your signature',
  markCorner: 'The corner the mark sits in, stepping past a logo or a handle there',
  markSize: 'How tall the mark stands',
  markName: 'Writes AZIMUT after the arrow',

  // the colours
  palette: 'The colours Geo Proof offers for marks, the first one in hand',
};
