/**
 * The sheets an investigation starts over and over.
 *
 * A new sheet used to be born as *Subject · Status · Notes* — the right answer when there
 * is nothing better to say, and the wrong one for the four tables an analyst builds by
 * hand every case: a verification worklist, a geolocation index, a list of accounts, a
 * run of events. Each of those is ten minutes of naming columns and declaring roles
 * before any work happens, and every analyst builds a slightly different one, which is
 * why two of their sheets never compare.
 *
 * So a template is columns **and** what the app should know about them: the status column
 * arrives as a state with its four words painted, the coordinates arrive as a point, the
 * dates arrive as dates. Nothing here is a schema — the columns are renamed, dropped and
 * added like any others the moment the sheet exists. It is a starting point, not a shape
 * the sheet has to keep.
 *
 * `progress` is which column the footer counts, so a fresh worklist can already say how
 * many rows are left.
 */

/** The blank one, which is what `POST /sheets` makes on its own. Listed rather than
 *  implied: a template picker whose plainest answer is missing reads as a picker with no
 *  way out of it. */
export const BLANK = {
  id: 'blank',
  label: 'Plain',
  hint: 'Subject, Status, Notes',
  columns: ['Subject', 'Status', 'Notes'],
  roles: {},
  progress: null,
};

export const SHEET_TEMPLATES = [
  BLANK,
  {
    id: 'verify',
    label: 'Verification worklist',
    hint: 'A claim per row, checked and ruled on',
    columns: ['Subject', 'Claim', 'Source', 'Status', 'Verdict', 'Checked on', 'Notes'],
    roles: {
      Status: { kind: 'state' },
      Verdict: { kind: 'choice', values: ['confirmed', 'contradicted', 'unresolved'] },
      'Checked on': { kind: 'stamped' },
    },
    progress: 'Status',
  },
  {
    // Named for what each column becomes rather than for what it looks like: this is the
    // one sheet the app can build proofs out of, and it can only do that when it knows
    // which address is the footage and which is the published picture. `Place` is gone —
    // that is what a build *writes*, not something an analyst types.
    id: 'geoloc',
    label: 'Geolocation index',
    hint: 'A picture per row, and where it turns out to be',
    columns: [
      'Title',
      'Source media',
      'Geolocation proof',
      'Coordinates',
      'Status',
      'Notes',
    ],
    roles: {
      'Source media': { kind: 'url' },
      'Geolocation proof': { kind: 'url' },
      Coordinates: { kind: 'latlon' },
      Status: { kind: 'state' },
    },
    progress: 'Coordinates',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    hint: 'Handles, where they post, when they were last seen',
    columns: ['Handle', 'Platform', 'Profile', 'Behind it', 'Last seen', 'Status', 'Notes'],
    roles: {
      Platform: { kind: 'choice' },
      'Last seen': { kind: 'when', shape: 'date' },
      Status: { kind: 'state' },
    },
    progress: 'Status',
  },
  {
    id: 'events',
    label: 'Events',
    hint: 'When, what, where, and what it rests on',
    columns: ['When', 'What', 'Where', 'Coordinates', 'Source', 'Confidence', 'Notes'],
    roles: {
      When: { kind: 'when', shape: 'datetime' },
      Coordinates: { kind: 'latlon' },
      Confidence: { kind: 'choice', values: ['high', 'medium', 'low'] },
    },
    progress: 'Coordinates',
  },
];

export function sheetTemplate(id) {
  return SHEET_TEMPLATES.find((entry) => entry.id === id) ?? BLANK;
}

/**
 * The sidecar a template asks for, over whatever the new sheet came back with.
 *
 * Applied as an ordinary save rather than at creation: the roles are the browser's to
 * declare — it owns reading them — and a create route that also took a sidecar would be a
 * second way to write one.
 */
export function templateMeta(meta, template) {
  const chosen = template ?? BLANK;
  const roles = { ...(meta?.roles ?? {}) };
  for (const [column, role] of Object.entries(chosen.roles ?? {})) roles[column] = { ...role };
  return {
    ...meta,
    roles,
    progress: chosen.progress ?? meta?.progress ?? null,
  };
}
