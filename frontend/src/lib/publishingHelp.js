/**
 * What Settings › Publishing says on hover, one clause each, and the limits it
 * states under its fields. `publishingHelp.test.js` holds every key to a sentence
 * and to a control showing it, and every control of the tab to a hover text.
 */
export const PUBLISHING_HELP = {
  mention: 'The handle a new Geo Report draft is addressed to',
  platform: 'The site a new Geo Report draft is written for',
  prefill: 'Let the capture extension type the thread and attach the proof',
  handle: 'Your handle, printed on proofs that turn on Add account handle',
  logo: 'Your logo: on signed proofs, Map plates, and in notes with / and Your logo',
  logoRemove: 'Take your logo off everything that shows it',
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
