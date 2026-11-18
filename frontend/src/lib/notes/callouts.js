/**
 * The callouts a quote can open with, `> [!confirmed]`. The PDF and the HTML page
 * draw the same seven (`engine/notes_markdown.py` CALLOUTS); an unknown kind stays a
 * plain quote, marker written, as GitHub leaves it. `limits` says what the evidence
 * cannot say; the HTML page lists it in its contents.
 *
 * `internal` is the team's own: the internal edition prints it in a marked box and
 * the public edition leaves it out whole. Any other Markdown reader shows a quote.
 */
export const CALLOUTS = [
  { kind: 'confirmed', label: 'Confirmed', colour: 'var(--ok)', hint: 'What the sources settle' },
  { kind: 'unverified', label: 'Unverified', colour: 'var(--warn)', hint: 'Said, not yet checked' },
  { kind: 'lead', label: 'Lead', colour: 'var(--info)', hint: 'Something to follow up' },
  { kind: 'note', label: 'Note', colour: 'var(--text-2)', hint: 'An aside' },
  { kind: 'warning', label: 'Warning', colour: 'var(--danger)', hint: 'A caution for the reader' },
  { kind: 'limits', label: 'Limits', colour: '#7a8ca0', hint: 'What the evidence cannot say', words: 'limitations caveats method uncertainty' },
  {
    kind: 'internal', label: 'Internal', colour: 'var(--internal)', hint: 'Left out of the public edition',
    words: 'private team confidential edition',
  },
];

const BY_KIND = new Map(CALLOUTS.map((callout) => [callout.kind, callout]));

/** `> [!kind]` at the start of a line, with what follows on it. */
export const CALLOUT_LINE = /^(\s*>\s*)\[!([A-Za-z]+)\]\s*/;

/** The callout a line opens, or null. */
export function calloutOf(line) {
  const match = CALLOUT_LINE.exec(String(line ?? ''));
  return match ? BY_KIND.get(match[2].toLowerCase()) ?? null : null;
}

/** The Markdown that opens a callout of this kind. */
export function calloutMarkdown(kind, text = '') {
  return `> [!${kind}] ${text}`;
}
