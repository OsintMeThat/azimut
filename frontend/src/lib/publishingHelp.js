/**
 * What Settings › Publishing and its logo editor say on hover, one clause each,
 * and the limits they state under their fields. `publishingHelp.test.js` holds
 * every key to a sentence and to a control showing it, and every control of the
 * tab and the editor to a hover text.
 */
export const PUBLISHING_HELP = {
  mention: 'The handle a new post is addressed to',
  platform: 'The site a new post is written for',
  prefill: 'Let the capture extension type the thread and attach the proof',
  handle: 'Your handle, printed on proofs that turn on Add account handle',
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
  signature: 'A picture of your handwritten signature, shown by a note\'s Signature block',
  signatureRemove: 'Take your signature off every note that shows it',
};

/** The longest name, role or organisation a report prints (`api/settings.py`). */
export const REPORT_FIELD_MAX = 80;
/** The largest signature picture taken, in MB (`api/settings.py`). */
export const SIGNATURE_MAX_MB = 1;
/** The largest logo taken, in bytes (`config.SIGNATURE_MAX_BYTES`). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
