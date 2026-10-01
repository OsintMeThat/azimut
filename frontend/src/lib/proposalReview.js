/**
 * The words the proposal review reads in (`components/ProposalReview.svelte`).
 *
 * A proposal is shown as the sentence it stands for, so a line reads the way the graph
 * would say it: who posted what, which two points are one site and how far apart.
 */

/** How many proposals are waiting: the edges, since an account waits on its edges. */
export function waitingCount(pending) {
  return (pending?.posted ?? 0) + (pending?.sites ?? 0);
}

/** One proposal as a sentence. */
export function proposalSentence(item) {
  if (item?.type === 'posted') return `${item.from.label} posted ${item.to.label}`;
  if (item?.type === 'same-site-as') {
    const apart = Number.isFinite(item.metres) ? `, ${item.metres} m apart` : '';
    return `${item.from.label} and ${item.to.label} are one site${apart}`;
  }
  return `${item?.from?.label ?? ''} → ${item?.to?.label ?? ''}`;
}

/** What one pass filed, as the toast says it. */
export function filedWords(filed) {
  const parts = [];
  if (filed?.accounts) parts.push(`${filed.accounts} ${filed.accounts === 1 ? 'account' : 'accounts'}`);
  if (filed?.posted) parts.push(`${filed.posted} posted ${filed.posted === 1 ? 'link' : 'links'}`);
  if (filed?.sites) parts.push(`${filed.sites} same-site ${filed.sites === 1 ? 'link' : 'links'}`);
  return parts.length ? `Proposed ${parts.join(', ')}.` : 'Nothing new to propose.';
}

/**
 * What a saved geolocation shares with the rest of the case, as one line
 * (`GET /entities/{id}/kin`). Null when it shares nothing, so no line is drawn.
 */
export function kinSentence(kin) {
  if (!kin) return null;
  const parts = [];
  const sites = kin.sites?.length ?? 0;
  const places = kin.places?.length ?? 0;
  if (sites) {
    parts.push(`On the same site as ${sites} other ${sites === 1 ? 'geolocation' : 'geolocations'}`);
  } else if (places) {
    parts.push(`${places} other ${places === 1 ? 'point' : 'points'} of the case within ${kin.radius ?? 300} m`);
  }
  for (const account of kin.accounts ?? []) {
    if (account.files) {
      parts.push(`${account.label} posted ${account.files} other ${account.files === 1 ? 'file' : 'files'} here`);
    }
  }
  return parts.length ? parts.join(' · ') : null;
}
