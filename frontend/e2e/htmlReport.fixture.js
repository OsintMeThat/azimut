import { readFileSync } from 'node:fs';
import { STEPS_WEBM } from './video.fixture.js';

/**
 * An exported HTML report as the server writes it (`engine/notes_html.py`), in the
 * markup its contract fixes, with the reader's own style sheet and script inlined
 * from where the export reads them. The pictures are drawn by the caller, in a
 * browser, and handed in as data addresses; the clip is the specs' real one.
 */

const ASSETS = new URL('../../src/azimut/engine/notes_html_assets/', import.meta.url);
const CSS = readFileSync(new URL('reader.css', ASSETS), 'utf8');
const JS = readFileSync(new URL('reader.js', ASSETS), 'utf8');
const CLIP = `data:video/webm;base64,${STEPS_WEBM.toString('base64')}`;

/** Draw the report's pictures in the page: each a flat colour with a block, so each is told apart. */
export function drawPictures(page, colours) {
  return page.evaluate((list) => list.map((colour, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    context.fillStyle = colour;
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#222';
    context.fillRect(60 + index * 70, 120, 140, 90);
    return canvas.toDataURL('image/png');
  }), colours);
}

const zoom = (src, alt) => `<button class="az-zoom" type="button" aria-label="Open larger: ${alt}"><img src="${src}" alt="${alt}" width="640" height="360"></button>`;
const caption = (number, words, credit) => `<figcaption><span class="az-caption"><span class="az-fig-num">Figure ${number}.</span> ${words}</span>
<span class="az-credit"><span class="az-credit-kind">Imagery:</span> ${credit}</span></figcaption>`;

/** The page, its pictures `[picture, before, after, step1, step2, step3, story1, story2]`, as an article or a story (`web`). */
export function reportHtml(pictures, { web = '' } = {}) {
  const [picture, before, after, s1, s2, s3, story1, story2] = pictures;
  const rows = Array.from({ length: 14 }, (_, index) => {
    const code = `V${String(index + 1).padStart(2, '0')}`;
    return `<tr id="${code}"><td>${code}</td><td>${['T-72B3 tank', 'BMP-2', 'Ural-4320 truck'][index % 3]}</td><td data-align="right">${(index * 37) % 90 + 5}%</td>`
      + `<td>burned, on its side</td><td>S04 0:23-0:37</td><td>3:04-3:11; 3:17-3:22</td><td>zone: between Dhubab and the airport road</td><td>12.74625, 43.49463</td><td>A</td></tr>`;
  }).join('\n');
  const step = (n, src, day, words) => `<div class="az-step" data-step="${n}" style="--az-n:${n}" data-label="${day}">
<figure class="az-figure" data-kind="picture">${zoom(src, `Plate ${n}`)}${caption(7 + n, `${day}, ${words}`, 'Esri, Maxar')}</figure></div>`;
  return `<!doctype html>
<html lang="en" dir="auto" data-look="report" data-font="" data-tlp="amber"${web ? ` data-web="${web}"` : ''} data-edition="public">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Ambush on the Wadi Sahm road</title>
<style id="az-reader">${CSS}</style></head>
<body>
<header class="az-cover" data-cover="style">
<p class="az-tlp" data-tlp="amber"><span>TLP:AMBER</span> <span class="az-tlp-note">Limited disclosure.</span></p>
<p class="az-kicker">REPORT</p>
<h1 class="az-title">Ambush on the Wadi Sahm road</h1>
<p class="az-standfirst">What open sources show of the column hit on 24 October 2025</p>
<p class="az-dateline"><time class="az-date" datetime="2025-10-28">28 October 2025</time></p>
</header>
<div class="az-page">
<nav class="az-contents" aria-label="Contents"><ol>
<li><a href="#the-footage"><span class="az-num">1</span> The footage</a></li>
<li><a href="#the-register"><span class="az-num">2</span> The register</a></li>
<li><a href="#how-it-unfolded"><span class="az-num">3</span> How it unfolded</a></li>
<li class="az-contents-sources"><a href="#sources">Sources</a></li></ol></nav>
<main class="az-body" id="main">
<h2 id="the-footage"><span class="az-num">1</span> The footage</h2>
<figure class="az-figure" data-kind="clip"><video class="az-clip" id="clip-1" src="${CLIP}" preload="metadata" controls muted></video>
${caption(1, 'The column under fire', 'x.com <a class="az-cite" href="#src-1" data-src="1">[1]</a>')}</figure>
<p>The first strike lands at <a class="az-time" href="#clip-1" data-clip="clip-1" data-t="0.6" data-end="1.0">[0:00–0:01]</a>.</p>
<figure class="az-figure" data-kind="picture">${zoom(picture, 'The junction from above')}${caption(2, 'The junction from above', 'Esri World Imagery, about 3 June 2025')}</figure>
<figure class="az-figure" data-kind="pair"><div class="az-compare"><img class="az-before" src="${before}" alt="Before" width="640" height="360"><img class="az-after" src="${after}" alt="After" width="640" height="360"><input class="az-slider" type="range" min="0" max="100" value="50" step="1" aria-label="Before and after"><span class="az-side-label" data-side="a"><span class="az-side-date">12 March 2025</span><span class="az-side-credit">Esri Wayback</span></span><span class="az-side-label" data-side="b"><span class="az-side-date">26 October 2025</span><span class="az-side-credit">Esri World Imagery</span></span></div>
${caption(3, 'The junction before and after', 'Esri Wayback and Esri World Imagery')}</figure>
<figure class="az-figure" data-kind="proof" data-width="100%" style="--az-width:100%" data-align="center">${zoom(picture, 'The junction, matched')}${caption(4, 'The junction, matched on the frame', 'Esri World Imagery')}</figure>
<figure class="az-figure" data-kind="picture" data-width="50%" style="--az-width:50%">${zoom(before, 'A small picture')}${caption(5, 'A small picture', 'Esri')}</figure>
<h3 id="the-two-videos">The two videos</h3>
<div class="az-table-wrap"><table class="az-table" data-rows="3"><thead><tr><th scope="col"></th><th scope="col">Video 1</th><th scope="col">Video 2</th></tr></thead><tbody>
<tr><td>Link</td><td><a href="https://x.com/MMY1444/status/2122054923298996698" target="_blank" rel="noopener noreferrer">https://x.com/MMY1444/status/2122054923298996698</a></td><td><a href="https://x.com/bonzerbarry/status/2122432246011281557" target="_blank" rel="noopener noreferrer">https://x.com/bonzerbarry/status/2122432246011281557</a></td></tr>
<tr id="SHA-256"><td>SHA-256</td><td>e1e32f4fcf40a0bcde7d2a638076d1a2995b8c96ccb0b53f198838f246cee09b</td><td>a9739638652c5d4726bf9dde71f80e9a214d9bb23338bed2dba541f94efe61de</td></tr>
<tr><td>Vehicles seen (at least)</td><td>33</td><td>46</td></tr></tbody></table></div>
<p>See <a href="https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2017/armoured-vehicles-of-the-world">https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2017/armoured-vehicles-of-the-world</a>.</p>
<h2 id="the-register"><span class="az-num">2</span> The register</h2>
<div class="az-table-wrap"><table class="az-table" data-rows="14"><thead><tr><th scope="col">Code</th><th scope="col">Type</th><th scope="col" data-align="right">Confidence</th>
<th scope="col">State</th><th scope="col">Video 1</th><th scope="col">Video 2</th><th scope="col">Position</th><th scope="col">Point</th><th scope="col">Close-up</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<p><a href="#V12">V12</a> is the clearest.</p>
<h2 id="how-it-unfolded"><span class="az-num">3</span> How it unfolded</h2>
<section class="az-steps" data-steps="3" aria-label="Steps">
${step(1, s1, '23 Oct 2025', 'the column on the road')}
${step(2, s2, '24 Oct 2025', 'the first strike')}
${step(3, s3, '25 Oct 2025', 'the wrecks pushed aside')}
<nav class="az-steps-bar" aria-label="Steps" hidden><button type="button" class="az-steps-prev" aria-label="Previous step">‹</button>
<ol class="az-steps-dots"><li><button type="button" data-step="1" aria-label="Step 1: 23 Oct 2025">23 Oct 2025</button></li><li><button type="button" data-step="2" aria-label="Step 2: 24 Oct 2025">24 Oct 2025</button></li><li><button type="button" data-step="3" aria-label="Step 3: 25 Oct 2025">25 Oct 2025</button></li></ol>
<button type="button" class="az-steps-next" aria-label="Next step">›</button></nav></section>
<section class="az-story" data-steps="2"><div class="az-story-lead"><p>Read from the ridge, the ambush took under a minute.</p></div>
<div class="az-story-figures">
<figure class="az-figure" data-kind="picture" data-step="1" style="--az-n:1" data-zoom="0.3,0.4,0.4,0.4">${zoom(story1, 'The road from the ridge')}${caption(11, 'The road from the ridge', 'Collected')}</figure>
<figure class="az-figure" data-kind="picture" data-step="2" style="--az-n:2">${zoom(story2, 'The burnt-out column')}${caption(12, 'The burnt-out column', 'Collected')}</figure>
</div><div class="az-story-steps">
<div class="az-story-step" data-step="1" style="--az-n:1"><p>The column comes round the bend in close order, tanks first.</p></div>
<div class="az-story-step" data-step="2" style="--az-n:2"><p>By the next morning the wrecks have been pushed off the road.</p></div>
</div></section>
<p>${'What the footage does not show is outside this report. '.repeat(40)}</p>
</main>
<section class="az-sources" id="sources" aria-labelledby="sources-title"><h2 id="sources-title">Sources</h2><ol>
<li id="src-1" data-kind="post"><span class="az-source-label">Column hit near Wadi Sahm</span> <span class="az-source-details">Video · x.com · posted 24 October 2025</span><span class="az-source-links"><a class="az-source-address" href="https://x.com/sahm_watch/status/1" target="_blank" rel="noopener noreferrer">https://x.com/sahm_watch/status/1</a></span></li>
</ol></section>
</div>
<footer class="az-footer"><p><span class="az-edition">Public edition</span> · <time datetime="2025-10-28">28 October 2025</time></p></footer>
<script>${JS}</script>
</body></html>`;
}
