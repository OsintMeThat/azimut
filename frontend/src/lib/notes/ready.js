/**
 * The notes a new one can start from without a template of the analyst's own, and
 * how any template's words are filled in when a note is made from it.
 *
 * Templates the analyst keeps live in Settings (`templates.json`, kind `note`) and
 * use the same two words: `{today}` and `{now}`.
 */
import { logStamp, today } from './syntax.js';

export const READY_NOTES = [
  {
    id: 'blank',
    name: 'Blank',
    note: 'An empty page',
    body: '',
  },
  {
    id: 'geolocation',
    name: 'Geolocation',
    note: 'Claim, clues, matches, verdict',
    body: [
      '## Claim', '', 'What is said, by whom, and when.', '',
      '## Sources', '', '- ', '',
      '## Clues in the picture', '', '- ', '',
      '## Matches', '', '| Clue | In the picture | On the map |', '| --- | --- | --- |', '|  |  |  |', '',
      '## Verdict', '', '> [!unverified] Not placed yet.', '',
    ].join('\n'),
  },
  {
    id: 'log',
    name: 'Investigation log',
    note: 'Dated entries, one per step',
    body: ['Type / and pick Log entry to add the next one.', '', '### {now}', '', ''].join('\n'),
  },
  {
    id: 'source',
    name: 'Source profile',
    note: 'Who, track record, reliability',
    body: [
      '## Who', '', 'Name, handle, platform.', '',
      '## Track record', '', '- ', '',
      '## Reliability', '', '> [!note] How far this source can be trusted, and why.', '',
      '## Accounts', '', '- ', '',
    ].join('\n'),
  },
  {
    id: 'day',
    name: 'Daily summary',
    note: 'What changed, leads, next steps',
    body: [
      '## {today}', '',
      '### What changed', '', '- ', '',
      '### Leads', '', '- [ ] ', '',
      '### Next', '', '- [ ] ', '',
    ].join('\n'),
  },
];

/** A template's body with `{today}` and `{now}` written in. */
export function filledBody(body, now = new Date()) {
  return String(body ?? '').replaceAll('{today}', today(now)).replaceAll('{now}', logStamp(now));
}

/** A free title for a note made from a template: its name, numbered past the first. */
export function freeTitle(name, taken) {
  const base = String(name ?? '').trim() || 'Note';
  const used = new Set([...(taken ?? [])].map((title) => String(title).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
