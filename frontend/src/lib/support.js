/**
 * Where Support & feedback sends people. Only a press ever opens these, and a block
 * stays hidden while its link is empty, so the app ships whole with either one missing.
 *
 * `.invalid` never resolves (RFC 6761), so a stand-in can send nobody to a stranger's
 * page, and a release refuses one (tests/test_whats_new.py).
 */
export const KOFI_URL = 'https://ko-fi.com/osintmethat';
export const FEEDBACK_FORM_URL = '';

/**
 * The line above the tip. One is drawn each time the dialog opens and another every
 * `TIP_LINE_SECONDS`, never the same twice in a row; a press draws the next at once.
 */
export const TIP_LINES = [
  "Cheaper than a gym membership, and you'll actually use this one.",
  'You use your gym membership in January. Azimut, all year round.',
  'You found this button on your own. Excellent sense of direction.',
  "Cheaper than a streaming subscription, and here you're the detective.",
  'Azimut is free. If it ever spared you an evening squinting at a blurry video shot at night, a tip helps keep it going.',
  'The sun gives the time, the shadow gives the place, and coffee gives the courage.',
  'Azimut points north. A coffee points out you were here.',
  'Azimut: €0 a month, 0 ads, 0 accounts. Coffee stays optional.',
  'Azimut is free. The coffee that keeps it running, less so.',
  'Made by one person, a lot of evenings and an amount of coffee no one could geolocate.',
];

/** Long enough to read the longest line twice over. */
export const TIP_LINE_SECONDS = 10;

/** A line at random, other than `current` whenever another one exists. */
export function drawTipLine(current, lines = TIP_LINES, random = Math.random) {
  const pool = lines.length > 1 ? lines.filter((line) => line !== current) : lines;
  return pool[Math.floor(random() * pool.length)] ?? '';
}
