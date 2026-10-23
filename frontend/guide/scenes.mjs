/**
 * The demo case's pictures, drawn rather than collected.
 *
 * Every file the guide shows is made here from a seed, so no picture in the shipped
 * guide is anybody's photograph or anybody's map, and a rerun draws the same ones.
 * Each scene is an SVG the browser renders to a JPEG; the one video is a scene that
 * ffmpeg pans across.
 */

const W = 1600;
const H = 1000;

/** A small deterministic generator: the same seed draws the same ridge every run. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A skyline of hills across the width, closed at the bottom of the picture. */
function ridge(seed, base, amplitude, fill, steps = 28) {
  const next = random(seed);
  let y = base;
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    y = Math.min(H, Math.max(0, y + (next() - 0.5) * amplitude));
    points.push(`${Math.round((i / steps) * W)} ${Math.round(y)}`);
  }
  return `<path d="M0 ${H} L${points.join(' L')} L${W} ${H} Z" fill="${fill}"/>`;
}

const gradient = (id, stops, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops
    .map(([at, color]) => `<stop offset="${at}" stop-color="${color}"/>`)
    .join('')}</linearGradient>`;

const FILTERS = `
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="table" tableValues="0 0.16"/></feComponentTransfer>
  </filter>
  <filter id="soft"><feGaussianBlur stdDeviation="26"/></filter>
  <filter id="haze"><feGaussianBlur stdDeviation="3"/></filter>`;

const svg = (defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<defs>${FILTERS}${defs}</defs>${body}<rect width="${W}" height="${H}" filter="url(#grain)"/></svg>`;

function harbour() {
  const next = random(11);
  const cranes = [260, 520, 1180, 1390]
    .map((x, i) => {
      const h = 210 + i * 18;
      return `<g fill="#120f13">
        <rect x="${x}" y="${640 - h}" width="14" height="${h}"/>
        <path d="M${x - 70} ${640 - h} L${x + 160} ${640 - h} L${x + 160} ${652 - h} L${x - 70} ${652 - h} Z"/>
        <path d="M${x + 7} ${640 - h} L${x + 7} ${600 - h} L${x + 150} ${640 - h} Z" fill="none" stroke="#120f13" stroke-width="5"/>
      </g>`;
    })
    .join('');
  const glints = Array.from({ length: 70 }, () => {
    const x = next() * W;
    const y = 680 + next() * 300;
    return `<rect x="${x}" y="${y}" width="${30 + next() * 90}" height="2" fill="#f2a65a" opacity="${0.15 + next() * 0.35}"/>`;
  }).join('');
  return svg(
    gradient('sky', [[0, '#17213a'], [0.5, '#7b4a4f'], [0.78, '#e08a4a'], [1, '#f3b067']]) +
      gradient('sea', [[0, '#3a2c33'], [1, '#0b0d14']]),
    `<rect width="${W}" height="700" fill="url(#sky)"/>
     ${ridge(3, 600, 26, '#2c2129')}
     <rect y="640" width="${W}" height="${H - 640}" fill="url(#sea)"/>
     <g filter="url(#soft)" opacity="0.9">
       <ellipse cx="900" cy="470" rx="90" ry="170" fill="#3a3236"/>
       <ellipse cx="830" cy="320" rx="150" ry="140" fill="#463c40"/>
       <ellipse cx="720" cy="200" rx="230" ry="120" fill="#4f4548"/>
     </g>
     <ellipse cx="905" cy="628" rx="60" ry="16" fill="#ffb347" filter="url(#haze)"/>
     <rect x="0" y="628" width="${W}" height="14" fill="#140f12"/>
     ${cranes}
     ${glints}`
  );
}

function ridgeRoad() {
  return svg(
    gradient('sky', [[0, '#9fb6c9'], [0.6, '#dfe3dc'], [1, '#efe6d2']]),
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>
     ${ridge(21, 430, 60, '#a7b2bd')}
     ${ridge(22, 520, 70, '#7f8f8f')}
     ${ridge(23, 640, 80, '#5d6f58')}
     ${ridge(24, 780, 70, '#3f5136')}
     <path d="M-40 1000 C 380 900, 520 820, 760 760 S 1160 690, 1660 650" fill="none" stroke="#d8cfb6" stroke-width="34"/>
     <path d="M-40 1000 C 380 900, 520 820, 760 760 S 1160 690, 1660 650" fill="none" stroke="#f4eedc" stroke-width="3" stroke-dasharray="40 34"/>
     <g stroke="#2d3329" stroke-width="5" fill="none">
       <path d="M1180 700 L1180 520 M1150 560 L1210 560 M1160 600 L1200 600"/>
       <path d="M1420 660 L1420 500 M1392 536 L1448 536 M1400 574 L1440 574"/>
     </g>`
  );
}

function townSquare() {
  const next = random(31);
  let x = -20;
  const blocks = [];
  while (x < W) {
    const w = 140 + next() * 160;
    const h = 260 + next() * 300;
    const tone = ['#c9b79a', '#d8c9ad', '#b8a587', '#cdbfa6'][Math.floor(next() * 4)];
    blocks.push(`<rect x="${x}" y="${820 - h}" width="${w}" height="${h}" fill="${tone}"/>`);
    for (let wy = 820 - h + 30; wy < 780; wy += 56) {
      for (let wx = x + 18; wx < x + w - 30; wx += 42) {
        blocks.push(`<rect x="${wx}" y="${wy}" width="20" height="30" fill="#3b4250" opacity="0.85"/>`);
      }
    }
    x += w + 6;
  }
  return svg(
    gradient('sky', [[0, '#5d8fc4'], [1, '#bcd6ec']]) + gradient('ground', [[0, '#8a8174'], [1, '#5f584f']]),
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>
     <rect x="1040" y="140" width="64" height="420" fill="#e2d6bf"/>
     <path d="M1030 140 L1072 60 L1114 140 Z" fill="#9c7b56"/>
     <circle cx="1072" cy="200" r="22" fill="#f4efe4" stroke="#3b4250" stroke-width="4"/>
     ${blocks.join('')}
     <rect y="820" width="${W}" height="${H - 820}" fill="url(#ground)"/>
     <rect y="820" width="${W}" height="10" fill="#4a443c"/>`
  );
}

function coast() {
  const next = random(41);
  const fields = Array.from({ length: 90 }, () => {
    const x = 700 + next() * 1000;
    const y = -60 + next() * 1100;
    const w = 60 + next() * 140;
    const h = 40 + next() * 110;
    const tone = ['#6f8a4c', '#8c9a5a', '#a99b62', '#5d7a45', '#b5a978'][Math.floor(next() * 5)];
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${tone}" transform="rotate(${-18 + next() * 10} ${x} ${y})" stroke="#4d5d35" stroke-width="2"/>`;
  }).join('');
  return svg(
    gradient('sea', [[0, '#0f3a57'], [0.7, '#1f6b84'], [1, '#3a97a2']], false),
    `<rect width="${W}" height="${H}" fill="url(#sea)"/>
     <path d="M640 -20 C 700 200, 560 380, 640 560 S 760 860, 700 1020 L1700 1020 L1700 -20 Z" fill="#7d8a55"/>
     ${fields}
     <path d="M640 -20 C 700 200, 560 380, 640 560 S 760 860, 700 1020" fill="none" stroke="#e7d8a8" stroke-width="44"/>
     <path d="M612 -20 C 672 200, 532 380, 612 560 S 732 860, 672 1020" fill="none" stroke="#bfe3e0" stroke-width="6" opacity="0.6"/>
     <path d="M900 -20 C 980 300, 860 600, 1020 1020" fill="none" stroke="#d9d2c0" stroke-width="12"/>`
  );
}

function nightGlow() {
  const next = random(51);
  const lights = Array.from({ length: 420 }, () => {
    const x = next() * W;
    const y = 640 + next() ** 1.6 * 360;
    const r = 1 + next() * 2.4;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${next() > 0.3 ? '#ffd28a' : '#cfe3ff'}" opacity="${0.4 + next() * 0.6}"/>`;
  }).join('');
  return svg(
    gradient('sky', [[0, '#05070d'], [0.62, '#141a2b'], [0.7, '#3c2a2a']]),
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>
     <ellipse cx="1120" cy="640" rx="320" ry="90" fill="#ff7a2f" opacity="0.55" filter="url(#soft)"/>
     ${ridge(52, 640, 10, '#0a0b10')}
     ${lights}`
  );
}

function desertRoad() {
  const next = random(61);
  const dashes = Array.from({ length: 9 }, (_, i) => {
    const t = i / 9;
    const y = 560 + t ** 1.5 * 440;
    const h = 8 + t * 60;
    const w = 3 + t * 12;
    return `<rect x="${800 - w / 2}" y="${y}" width="${w}" height="${h}" fill="#efe3c2"/>`;
  }).join('');
  const scrub = Array.from({ length: 60 }, () => {
    const x = next() * W;
    const y = 580 + next() * 420;
    if (Math.abs(x - 800) < (y - 540) * 0.9) return '';
    return `<ellipse cx="${x}" cy="${y}" rx="${6 + next() * 18}" ry="${3 + next() * 8}" fill="#7a7146" opacity="0.8"/>`;
  }).join('');
  return svg(
    gradient('sky', [[0, '#7fa7cf'], [1, '#e8dcc1']]) + gradient('sand', [[0, '#d5bd8c'], [1, '#b39462']]),
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>
     ${ridge(62, 545, 14, '#b9a585')}
     <rect y="560" width="${W}" height="${H - 560}" fill="url(#sand)"/>
     <path d="M780 560 L820 560 L1300 1000 L300 1000 Z" fill="#4b4741"/>
     ${dashes}
     ${scrub}
     <g fill="#2a2a26">
       <rect x="770" y="566" width="26" height="16"/><rect x="806" y="570" width="18" height="12"/>
       <rect x="742" y="578" width="34" height="22"/>
     </g>`
  );
}

/** The case as filed: what each file is called, where it says it came from, and how it is drawn. */
export const SCENES = [
  { file: 'harbour_smoke_0412.jpg', source: 'https://example.org/posts/0412', draw: harbour },
  { file: 'convoy_dashcam.mp4', source: 'https://example.org/videos/2271', draw: desertRoad, video: true },
  { file: 'coast_from_the_air.jpg', source: 'https://example.org/posts/0397', draw: coast },
  { file: 'ridge_road.jpg', source: '', draw: ridgeRoad },
  { file: 'town_square.jpg', source: 'https://example.org/posts/0388', draw: townSquare },
  { file: 'night_glow.jpg', source: 'https://example.org/posts/0420', draw: nightGlow },
];

export const SCENE_SIZE = { width: W, height: H };
