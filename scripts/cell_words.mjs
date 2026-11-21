// The month and weekday names a cell may be written with, in every language CLDR names
// them in, for the one reader of days in a cell (`engine/cellread.py`, `lib/cellRead.js`).
//
//   node scripts/cell_words.mjs
//
// Writes the same file twice, `src/azimut/engine/cell_words.json` for the engine and
// `frontend/src/lib/cellWords.json` for the browser; `tests/test_cellread.py` fails when
// the two differ. Run it again only to add a language: the names come from the ICU data
// of the Node that runs it, so a newer Node may spell an abbreviation differently.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Most spoken first: a word two languages give to different months goes to the first.
// `listopad` is November in Polish and Czech, October in Croatian.
const LANGUAGES = (
  'en zh es hi ar fr bn pt ru ur id de ja pa mr te tr ta vi ko it fa ha sw jv gu kn ml or my ' +
  'am pl uk ms th yo ig om ro nl az uz si km kk ne so ps ckb ku sd ug hu el cs sv be sr sr-Latn bg ' +
  'he da fi sk no nb hr bs ka hy sq lt lv sl et mk mn tk ky tg ti lo bo ga cy eu ca gl is af zu ' +
  'xh fil lb mt fo fy rm gd br oc qu ' +
  'ar-SY ar-IQ ar-LB ar-JO ar-DZ ar-TN ar-MA zh-Hant pt-PT es-MX fr-CA'
).split(' ');

// Words a day is written with that say nothing of it: "5 de marzo de 2026", "the 5th of
// March", "le 5 mars", "am 5. März", "5 марта 2026 г.", "5 marca 2026 r.", "ngày 5".
const CONNECTORS = ['de', 'del', 'di', 'du', 'of', 'the', 'le', 'la', 'el', 'am', 'im', 'den', 'der', 'em', 'on',
  'w', 'в', 'г', 'года', 'год', 'roku', 'r', 'ngay', 'nam'];
// What may follow a day's number: 1st, 1er, 1º, 1ª.
const ORDINALS = ['st', 'nd', 'rd', 'th', 'er', 're', 'eme', 'e', 'º', 'ª'];

const latin = (word) => /^[\p{Script=Latin}\p{M}\s'’-]+$/u.test(word.normalize('NFKD'));

/** A word as both readers look it up: NFKC, lower case, no dots nor direction marks, and
 *  no accents in the Latin script only, where `fevrier` is how `février` is often typed
 *  (an Indic or Thai mark is a letter of the word: dropped, two months would meet). */
export function fold(word) {
  let said = word.normalize('NFKC').toLocaleLowerCase('en').replace(/[.‎‏؜ـ]/g, '').replace(/\s+/g, ' ').trim();
  if (latin(said)) said = said.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC');
  return said;
}

function names(language, options, part, dates) {
  const found = [];
  for (const [index, date] of dates.entries()) {
    const forms = new Set();
    const locale = `${language}-u-ca-gregory`;
    for (const width of ['long', 'short']) {
      forms.add(new Intl.DateTimeFormat(locale, { [part]: width, timeZone: 'UTC' }).format(date));
      for (const piece of new Intl.DateTimeFormat(locale, { ...options, [part]: width, timeZone: 'UTC' }).formatToParts(date)) {
        if (piece.type === part) forms.add(piece.value);
      }
    }
    found.push([index + 1, [...forms].map(fold)]);
  }
  return found;
}

const months = new Map();
const weekdays = new Set();
const dropped = new Set();
const missing = [];
for (const language of LANGUAGES) {
  if (!Intl.DateTimeFormat.supportedLocalesOf([language]).length) {
    missing.push(language);
    continue;
  }
  const mine = new Map();
  const monthDates = Array.from({ length: 12 }, (_, month) => new Date(Date.UTC(2026, month, 15)));
  for (const [month, words] of names(language, { day: 'numeric' }, 'month', monthDates)) {
    for (const word of words) {
      if (!word || /\d/.test(word) || (latin(word) && [...word].length < 3)) continue;
      if (mine.has(word) && mine.get(word) !== month) dropped.add(word);
      mine.set(word, month);
    }
  }
  for (const [word, month] of mine) {
    if (dropped.has(word) || months.has(word)) continue;
    months.set(word, month);
  }
  // 2026-03-02 was a Monday
  const weekDates = Array.from({ length: 7 }, (_, day) => new Date(Date.UTC(2026, 2, 2 + day)));
  for (const [, words] of names(language, { day: 'numeric', month: 'long' }, 'weekday', weekDates)) {
    for (const word of words) {
      if (word && !/\d/.test(word) && !(latin(word) && [...word].length < 3)) weekdays.add(word);
    }
  }
}
for (const word of dropped) months.delete(word);
for (const word of months.keys()) weekdays.delete(word);
// a connector that is also a weekday somewhere is skipped either way
for (const word of CONNECTORS) {
  if (months.has(word)) throw new Error(`"${word}" is a connector and a month`);
  weekdays.delete(word);
}

const sorted = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const data = {
  why: [
    'The month and weekday names a cell may be written with, in every language CLDR names them in,',
    'folded as both readers fold a word (scripts/cell_words.mjs `fold`). Made by scripts/cell_words.mjs;',
    'src/azimut/engine/cell_words.json and frontend/src/lib/cellWords.json are the same file.',
  ],
  languages: LANGUAGES.filter((language) => !missing.includes(language)),
  months: sorted(months),
  weekdays: [...weekdays].sort(),
  connectors: CONNECTORS,
  ordinals: ORDINALS,
  // 2026年3月5日, 2026년 3월 5일: a number then the mark of what it counts.
  marks: { year: ['年', '년'], month: ['月', '월'], day: ['日', '일'] },
  // tháng 3: the month said by its number after this word.
  month_number: ['thang', 'thg'],
  // במרץ: "in March", the preposition glued to the month.
  prefixes: ['ב'],
};
const text = `${JSON.stringify(data, null, 1)}\n`;
for (const path of ['src/azimut/engine/cell_words.json', 'frontend/src/lib/cellWords.json']) writeFileSync(join(root, path), text);
console.log(`${data.languages.length} languages, ${months.size} month words, ${weekdays.size} weekday words` +
  (missing.length ? `; no data for ${missing.join(' ')}` : ''));
