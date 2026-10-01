/**
 * What the Sheet tab opens on: the sheets being worked on, and the sheets this case
 * could start right now.
 *
 * A tab that reopened the last sheet answered "where was I" and nothing else, and a case
 * with no sheet opened on an empty state listing what a sheet is for. Neither said that
 * the case already holds the makings of one: twenty files imported and not yet placed is
 * a worklist, eight proofs is an index. So the home leads with those, counted.
 */

/** The shapes the case builds by itself, and what each one is called on the home. */
export const CASE_SHAPES = {
  files: {
    title: 'Files to geolocate',
    hint: 'One row per picture or video you imported. A proof marks it done.',
  },
  proofs: {
    title: 'My geolocations',
    hint: 'One row per point of every proof, POV or not, with its date and source.',
  },
};

/** Newest edit first, with the sheet last opened here leading. */
export function recentSheets(sheets, lastId = null) {
  const stamp = (sheet) => sheet.modified_at ?? sheet.created_at ?? '';
  const ordered = [...(sheets ?? [])].sort((a, b) => stamp(b).localeCompare(stamp(a)));
  const at = ordered.findIndex((sheet) => sheet.id === lastId);
  if (at > 0) ordered.unshift(...ordered.splice(at, 1));
  return ordered;
}

/** The progress column's reading, in the footer's own words. */
export function progressWords(progress) {
  if (!progress || !progress.total) return '';
  const verb = progress.kind === 'state' ? 'done' : 'filled';
  return `${progress.count} of ${progress.total} ${verb}`;
}

/**
 * The sheets this case could start, each with what it would hold.
 *
 * `files` is the server's preview (`GET /sheets/from-case/files`), `proofs` how many
 * proofs the case holds. A shape the case has nothing for is not offered, and one
 * already built is opened rather than built twice: the second press is somebody going
 * back to their worklist, not asking for a twin of it.
 */
export function caseProposals({ files = null, proofs = 0, sheets = [] } = {}) {
  const built = (shape) => (sheets ?? []).find((sheet) => sheet.shape === shape)?.id ?? null;
  const out = [];
  if (files?.total) {
    const left = files.total - (files.answered ?? 0);
    out.push({
      shape: 'files',
      ...CASE_SHAPES.files,
      detail:
        `${files.total} imported ${files.total === 1 ? 'file' : 'files'}, ` +
        (left ? `${left} without a proof` : 'every one with a proof'),
      open: files.sheet ?? built('files'),
    });
  }
  if (proofs) {
    out.push({
      shape: 'proofs',
      ...CASE_SHAPES.proofs,
      detail: `${proofs} ${proofs === 1 ? 'proof' : 'proofs'}`,
      open: built('proofs'),
    });
  }
  return out;
}
