/**
 * What Settings › Publishing, its logo editor and its Styles section say on hover, one
 * clause each, and the limits they state under their fields. `publishingHelp.test.js` holds
 * every key to a sentence and to a control showing it, and every control of the tab, the
 * editor and the section to a hover text. The WordPress and GitHub Pages sections of
 * Settings › Website have theirs in `websiteSetup.js`.
 */
export const PUBLISHING_HELP = {
  mention: 'The handle a new X post is addressed to',
  mentionBluesky: 'The handle a new Bluesky post is addressed to',
  platform: 'The site a new post is written for',
  prefill: 'Let the capture extension type the thread and attach the proof',
  handle: 'Your handle, printed on proofs that turn on Add account handle and on your web maps',
  logo: 'Your logo: on signed proofs, Map plates, and in notes with / and Your logo',
  logoEdit: 'Round your logo, frame it or set it on a disc',
  logoRemove: 'Take your logo off everything that shows it',
  logoMove: 'Drag to move your logo inside its shape',
  logoShape: 'The shape your logo is cut to',
  logoCorners: 'How round the corners are',
  logoFrame: 'How thick the frame is, none at the far left',
  logoFrameColour: 'The colour of the frame',
  logoBackground: 'A colour behind your logo, inside its shape',
  logoNoBackground: 'Keep the inside of the shape transparent',
  logoMargin: 'Room between your logo and the edge of its shape',
  logoZoom: 'How large your logo sits in its shape',
  logoReset: 'Back to the picture as you picked it',
  logoCancel: 'Close without changing your logo',
  logoSave: 'Use this logo everywhere it shows',
  name: 'Your name, printed where a note says {name}, as in its Signature block',
  role: 'Your role, printed where a note says {role}',
  organisation: 'Your organisation, printed where a note says {organisation}',
  site: 'Your own site, linked from your name and logo in notes and web maps',
  credit: 'End what you publish with Made with Azimut and its version, linked to the project',
  signature: 'A picture of your handwritten signature, shown by a note\'s Signature block',
  signatureRemove: 'Take your signature off every note that shows it',
  styleSources: 'A numbered list of every source a note of this style cites',
  styleGeolocations: 'A table of every proof the note cites: place, day, coordinates',
  styleCredits: 'The imagery, map, terrain and footage credits the note owes',
  styleMethod: 'Facts read from the case: tools, days, counts, fingerprints, edition',
  styleLimits: 'Every Limits box of the note, gathered at the end',
  styleEditions: 'The public editions before this one, and what each corrected',
  styleWritten: 'How the PDF writes each source: academic, for the web, or short. A web page lists them as cards',
  styleCheck: 'How the check before export names links with no archived copy or no seen day',
  stylesReset: "Every style back to what Azimut gives it",
};

/** The longest name, role or organisation a report prints (`api/settings.py`). */
export const REPORT_FIELD_MAX = 80;
/** The largest signature picture taken, in MB (`api/settings.py`). */
export const SIGNATURE_MAX_MB = 1;
/** The largest logo taken, in bytes (`config.SIGNATURE_MAX_BYTES`). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
