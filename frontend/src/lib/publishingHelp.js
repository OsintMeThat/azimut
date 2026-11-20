/**
 * What Settings › Publishing, its logo editor and its WordPress and GitHub Pages
 * sections say on hover, one clause each, and the limits they state under their fields.
 * `publishingHelp.test.js` holds every key to a sentence and to a control showing it,
 * and every control of the tab, the editor and the section to a hover text.
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
  signature: 'A picture of your handwritten signature, shown by a note\'s Signature block',
  signatureRemove: 'Take your signature off every note that shows it',
  wordpressSite: 'The WordPress site a note is sent to as a draft',
  wordpressUser: 'The username you sign in to WordPress with',
  wordpressPassword: 'An application password from Users › Profile, kept on this computer only',
  wordpressTest: 'Sign in to the site and say as whom',
  wordpressForget: 'Forget the address, the username and the password on this computer',
  wordpressHow: 'Where each answer is found in WordPress',
  wordpressGuide: "WordPress's own guide to application passwords",
  githubAccount: 'Your GitHub username, or the organisation that owns the repository',
  githubRepo: 'The repository the articles go in, one folder each',
  githubBranch: 'The branch GitHub Pages serves',
  githubToken: 'A fine-grained token for that one repository, kept on this computer only',
  githubTest: 'Sign in to GitHub and say whether Pages serves the repository',
  githubForget: 'Forget the account and the token on this computer',
  githubHow: 'How to make the repository and the token, step by step',
  githubSignup: 'Open a free GitHub account',
  githubTokenPage: "GitHub's token page, with Contents and Pages picked",
  githubCreate: 'Make the repository on GitHub, public, with a README',
  githubPagesOn: 'Turn GitHub Pages on for the branch',
  githubNewRepo: "GitHub's new repository page, with the name and Public picked",
  githubPagesSettings: "The repository's Pages settings on github.com",
  styleSources: 'A numbered list of every source a note of this style cites',
  styleGeolocations: 'A table of every proof the note cites: place, day, coordinates',
  styleCredits: 'The imagery, map, terrain and footage credits the note owes',
  styleMethod: 'Facts read from the case: tools, days, counts, fingerprints, edition',
  styleLimits: 'Every Limits box of the note, gathered at the end',
  styleEditions: 'The public editions before this one, and what each corrected',
  styleWritten: 'How each source is written: academic, for the web, or short',
  styleCheck: 'How the check before export names links with no archived copy or no seen day',
  stylesReset: "Every style back to what Azimut gives it",
};

/** The longest name, role or organisation a report prints (`api/settings.py`). */
export const REPORT_FIELD_MAX = 80;
/** The largest signature picture taken, in MB (`api/settings.py`). */
export const SIGNATURE_MAX_MB = 1;
/** The largest logo taken, in bytes (`config.SIGNATURE_MAX_BYTES`). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
