/**
 * The entry line's pure half: what `@` offers, in what order, and what a name the
 * case has never held is guessed to be.
 *
 * Nothing here reaches the network or Svelte. The line (`EntryLine.svelte`) asks the
 * catalog, and these decide what the answer looks like on screen.
 */
import { entitySearchMatches } from './entitySearch.js';
import { foldText } from './textFold.js';

/**
 * The names an entity is also known by, one per entry.
 *
 * `aliases` is one free field, and analysts separate names the way they separate
 * anything: a semicolon, a comma or a line each. All three split.
 */
export function aliasesOf(entity) {
  return String(entity?.attrs?.aliases ?? '')
    .split(/[;,\n]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Whether the typed term names the entity exactly, by its label or one of its other names. */
export function namesExactly(entity, term) {
  const wanted = foldText(String(term ?? '').trim());
  if (!wanted) return false;
  return [entity?.label, ...aliasesOf(entity)].some((name) => foldText(String(name ?? '').trim()) === wanted);
}

/**
 * The catalog's answer to `@term`, in the order the line offers it.
 *
 * An exact name first, label or other name alike, since that is the entity being
 * typed. Then what this draft already mentions, which is the likeliest second pick.
 * Then the rest, in the catalog's order. Each row says which field matched when it
 * was not the name, so a vehicle found by its plate does not read as a stray result.
 */
export function rankMentions(rows, term, mentioned = new Set()) {
  const ranked = rows.map((entity, index) => {
    const exact = namesExactly(entity, term);
    const rank = exact ? 0 : mentioned.has(entity.id) ? 1 : 2;
    const matches = String(term ?? '').trim() ? entitySearchMatches(entity, term) : [];
    const named = matches.some((match) => match.field === 'label');
    const alias = exact && !foldText(String(entity.label ?? '')).includes(foldText(String(term).trim()))
      ? aliasesOf(entity).find((name) => foldText(name) === foldText(String(term).trim()))
      : '';
    const reason = alias
      ? { label: 'Also known as', value: alias }
      : named ? null : matches[0] ?? null;
    return { entity, rank, index, reason };
  });
  return ranked
    .sort((one, other) => one.rank - other.rank || one.index - other.index)
    .map(({ entity, reason }) => ({ entity, reason }));
}

/**
 * The `@term` being typed at the caret, or null.
 *
 * An `@` starts a mention at the start of the text or after a space, so an address
 * like `name@example.org` stays text. The term runs to the caret and stops at a
 * line break; a space is allowed, since subjects have names with spaces in them.
 */
export function mentionAt(text, caret) {
  const before = String(text ?? '').slice(0, caret);
  // The last `@` that opens a word; one inside a word, as in an address typed after
  // it, belongs to the term.
  const found = /(?:^|\s)@([^\n]*)$/.exec(before);
  if (!found) return null;
  const term = found[1];
  const start = before.length - term.length - 1;
  if (term.length > 80 || /\s{2}/.test(term)) return null;
  return { start, end: caret, term };
}

/** The text with the `@term` replaced by the name, and where the caret goes next. */
export function insertMention(text, mention, name) {
  const after = String(text).slice(mention.end);
  const joint = after.startsWith(' ') ? '' : ' ';
  const next = `${String(text).slice(0, mention.start)}${name}${joint}${after}`;
  return { text: next, caret: mention.start + name.length + joint.length };
}

// What an identifier looks like. Each one is checked on its own and none of them
// guesses between two readings: a value that could be either stays unguessed.
const URL = /^https?:\/\/\S+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^(?=.*:.*:)[0-9a-f:]+(?:\.\d+){0,3}$/i;
const HANDLE = /^@[\p{L}\p{N}_.]{1,64}$/u;
const PHONE = /^\+?[\d\s().-]+$/;
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$/i;

function identifierOf(value) {
  if (URL.test(value)) return { type: 'account', rule: 'looks like a profile address' };
  if (EMAIL.test(value)) return { type: 'email', rule: 'looks like an email' };
  const [address, bits, extra] = value.split('/');
  if (bits !== undefined && extra === undefined && /^\d{1,3}$/.test(bits)
    && (IPV4.test(address) || IPV6.test(address))) {
    return { type: 'network', rule: 'looks like a network' };
  }
  if (IPV4.test(value) || IPV6.test(value)) return { type: 'ip', rule: 'looks like an IP address' };
  if (HANDLE.test(value)) return { type: 'account', rule: 'looks like a handle' };
  const digits = value.replace(/\D/g, '').length;
  if (PHONE.test(value) && digits >= 7 && digits <= 15 && /^\+|\s|-/.test(value)) {
    return { type: 'phone', rule: 'looks like a phone number' };
  }
  if (DOMAIN.test(value) && /[a-z]/i.test(value.split('.').at(-2) ?? '')) {
    return { type: 'domain', rule: 'looks like a domain' };
  }
  return null;
}

/**
 * What a new subject is taken to be, and the rule that says so.
 *
 * An identifier is recognised by its shape. Anything else is the subject type this
 * case uses most, read off the catalog summary, and a case with none is a person. A
 * place is never guessed: a place is a point, and a name is not one.
 */
export function guessSubjectType(label, { mostUsed = '' } = {}) {
  const value = String(label ?? '').trim();
  const identifier = value ? identifierOf(value) : null;
  if (identifier) return identifier;
  if (mostUsed) return { type: mostUsed, rule: 'the type this case uses most' };
  return { type: 'person', rule: 'no other hint' };
}

/** The types a new subject is offered as, before `Other…`. */
export const QUICK_TYPES = ['person', 'organization', 'account'];

/**
 * The subject type the case holds most of, among the ones a line can create.
 *
 * `creatable` is the registry's hand-made types. A Claim is not a subject here, and a
 * tie goes to the one the registry lists first.
 */
export function mostUsedType(summary, creatable) {
  let best = '';
  let most = 0;
  for (const entry of creatable) {
    if (entry.type === 'claim') continue;
    const held = Number(summary?.by_type?.[entry.type] ?? 0);
    if (held > most) {
      best = entry.type;
      most = held;
    }
  }
  return best;
}

/** The menu a new subject's type chip opens on: the quick types, the case's own
 *  favourite when it is not one of them, then everything else a line can create. */
export function typeMenu(creatable, mostUsed = '') {
  const known = new Set(creatable.map((entry) => entry.type));
  const quick = [...QUICK_TYPES, mostUsed].filter((type, index, all) =>
    type && known.has(type) && all.indexOf(type) === index);
  const other = creatable
    .map((entry) => entry.type)
    .filter((type) => type !== 'claim' && !quick.includes(type));
  return { quick, other };
}
