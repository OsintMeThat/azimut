#!/usr/bin/env node
/**
 * Writes an HTML gallery of the vehicle models, drawn by the app's own modules
 * (`frontend/src/lib/icons/`): every model at Top, Angled and Side, at marker
 * sizes over a drawn ground, as map badges, as picker previews in both themes,
 * and in each of the app's colours. A page to judge the drawings by eye.
 *
 *   node scripts/icon_gallery.mjs [out.html]
 *
 * The ground is drawn in the page, so the file needs nothing else. It is not
 * real imagery.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolve(here, '../frontend/src/lib/icons');
const { modelById } = await import(`${lib}/models.js`);
const { MODEL_META, MODEL_FAMILIES } = await import(`${lib}/modelMeta.js`);
const { modelSvg, VIEWS } = await import(`${lib}/paint.js`);
const { solve } = await import(`${lib}/solve.js`);

const out = resolve(process.argv[2] ?? '/tmp/claude-1000/m3i/gallery.html');
const COLOURS = [['#0072b2', 'Blue'], ['#d55e00', 'Orange'], ['#009e73', 'Green'], ['#cc79a7', 'Purple'], ['#f0e442', 'Yellow']];
const PROOF_COLOURS = ['#ff5252', '#40c4ff', '#ffd740', '#69f0ae', '#e040fb', '#ff9e40', '#ffffff'];
const TURNS = [0, 35, 80, 140, 200, 260, 315, 20, 110, 170, 230, 300];
const SUN = [0.46, -0.34];

const families = MODEL_FAMILIES.map((family) => ({ family, items: MODEL_META.filter((m) => m.family === family) }));
const all = MODEL_META;
const sizeOf = (m) => (m.len < 1 ? `${Math.round(m.len * 100)} cm` : `${m.len.toFixed(1)} m`);

// what solving every view costs, measured here so the page can say it
const t0 = performance.now();
for (const meta of all) modelById(meta.id);
const buildMs = performance.now() - t0;
let solves = 0;
const t1 = performance.now();
for (const meta of all) {
  const model = modelById(meta.id);
  for (let h = 0; h < 360; h += 30) for (const t of [0, 55, 84]) { solve(model, h, t); solves++; }
}
const solveMs = (performance.now() - t1) / solves;
let worst = { id: '', ms: 0 };
for (const meta of all) {
  const model = modelById(meta.id);
  const s = performance.now();
  for (let k = 0; k < 20; k++) solve(model, 130, 55);
  const ms = (performance.now() - s) / 20;
  if (ms > worst.ms) worst = { id: meta.label, ms, solids: model.prims.length };
}

const card = (meta) => {
  const model = modelById(meta.id);
  const pics = VIEWS.map((v) => `<div class="pic" title="${v.label}">${modelSvg(model, { px: 104, colour: '#d3d6d9', heading: v.heading, tilt: v.tilt, line: 0.5, pad: 1.08, label: `${meta.label}, ${v.label}` })}</div>`).join('');
  return `<div class="card"><div class="pics">${pics}</div><div class="name"><span>${meta.label}</span><small>${sizeOf(model)} · ${model.prims.length} solids</small></div></div>`;
};

const strip = (px, { halo, line, sun = null, tilt = 0 }) => all.map((meta, i) => modelSvg(modelById(meta.id), {
  px, fit: 'bbox', heading: TURNS[i % 12], tilt, colour: COLOURS[i % 5][0], halo, line, pad: 1.1, sun, label: meta.label,
})).join('');

const disc = (meta, i) => {
  const c = COLOURS[i % 5][0];
  const paper = c === '#f0e442' ? '#14161a' : '#ffffff';
  const model = modelById(meta.id);
  const inner = modelSvg(model, { px: 44, fit: 'bbox', pad: 1.04, heading: TURNS[i % 12], mode: 'ink', disc: c, paper, line: 0.42 })
    .replace(/^<svg width="44" height="44"/, '<svg x="10" y="10" width="44" height="44"');
  return `<svg width="28" height="28" viewBox="0 0 64 64" role="img" aria-label="${meta.label}"><circle cx="32" cy="32" r="29.6" fill="rgba(0,0,0,.35)"/><circle cx="32" cy="32" r="28" fill="${c}" stroke="#fff" stroke-width="2.5"/>${inner}</svg>`;
};

const picker = (theme) => `<div class="picker ${theme}">${families.map((g) => `<h4>${g.family}</h4><div class="grid">${g.items.map((meta) => `<span class="glyph" title="${meta.label}">${modelSvg(modelById(meta.id), { px: 40, mode: 'mono', heading: 130, tilt: 55, line: 0.35, pad: 1.04 })}</span>`).join('')}</div>`).join('')}</div>`;

const colourRow = ['model-tank', 'model-pickup', 'model-heli', 'model-cargo'].map((id) => {
  const model = modelById(id);
  const row = [...COLOURS.map((c) => c[0]), ...PROOF_COLOURS].map((c) => [0, 55].map((t) => modelSvg(model, {
    px: 64, colour: c, heading: t ? 130 : 30, tilt: t, halo: 0.9, line: 0.5, pad: 1.08,
  })).join('')).join('');
  return `<div class="strip">${row}</div>`;
}).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Azimut vehicle models</title>
<style>
:root{--bg-0:#151515;--bg-1:#1c1c1c;--bg-2:#252525;--bg-3:#2f2f2f;--border:rgba(255,255,255,.09);--text-1:#e3e3e3;--text-2:#9f9f9f;--accent:#e8a33d;
  --font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color-scheme:dark}
:root[data-theme=light]{--bg-0:#f3f3f3;--bg-1:#fafafa;--bg-2:#ffffff;--bg-3:#ececec;--border:rgba(0,0,0,.1);--text-1:#1f1f1f;--text-2:#5c5c5c;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg-0);color:var(--text-1);font:14px/1.45 var(--font)}
main{max-width:1320px;margin:0 auto;padding:28px 24px 64px;display:flex;flex-direction:column;gap:40px}
h1{font-size:1.35rem;font-weight:600;margin:0}
h2{font-size:1.05rem;font-weight:600;margin:0 0 4px}
h3{margin:0 0 8px;font-size:.8rem;font-weight:500;color:var(--text-2)}
p{margin:0 0 12px;color:var(--text-2);font-size:.85rem}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}
button{font:inherit;color:var(--text-1);background:var(--bg-2);border:1px solid var(--border);border-radius:4px;padding:5px 12px;cursor:pointer}
.facts{font:.75rem var(--mono);color:var(--text-2)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:8px;margin-bottom:18px}
.card{background:var(--bg-1);border:1px solid var(--border);border-radius:4px;padding:10px 10px 8px;display:flex;flex-direction:column;gap:6px}
.pics{display:flex;justify-content:space-between}
.pic{width:104px;height:104px;display:grid;place-items:center}
.name{font-size:.8rem;display:flex;justify-content:space-between}
.name small{font:.72rem var(--mono);color:var(--text-2)}
.ground{position:relative;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:30px 16px 14px;border-radius:4px;background:#6d6252 center/1400px;margin-bottom:8px}
.ground .lab{position:absolute;left:8px;top:6px;font-size:.72rem;padding:0 5px;border-radius:3px;background:rgba(20,20,20,.85);color:#e3e3e3}
.ground svg,.strip svg{display:block;overflow:visible}
.strip{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:8px;background:var(--bg-1);border:1px solid var(--border);border-radius:4px;margin-bottom:6px}
.pickers{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.picker{padding:10px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.25)}
.picker.dark{background:#252525;color:#9f9f9f}.picker.light{background:#fff;color:#5c5c5c}
.picker h4{margin:6px 0 4px;font-size:.72rem;font-weight:500}
.picker .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.picker .glyph{aspect-ratio:1;display:grid;place-items:center;border:1px solid transparent;border-radius:3px}
.picker .glyph:hover{border-color:rgba(128,128,128,.5);color:currentColor}
</style>
</head>
<body>
<main>
  <div class="top">
    <div><h1>Vehicle models</h1><p>${all.length} models drawn by the app's own modules (lib/icons). Nothing here is an image file.</p></div>
    <div><span class="facts">built in ${buildMs.toFixed(1)} ms · a view solves in ${solveMs.toFixed(2)} ms on average, ${worst.ms.toFixed(2)} ms for the ${worst.id} (${worst.solids} solids)</span> <button id="theme">Light theme</button></div>
  </div>
  <section><h2>The set</h2><p>Top, Angled (tilt 55°) and Side (tilt 84°). Size is the model's length.</p>
    ${families.map((g) => `<h3>${g.family}</h3><div class="cards">${g.items.map(card).join('')}</div>`).join('')}
  </section>
  <section><h2>On the ground</h2><p>Marker sizes in the layer colours, turned at random, with the dark halo every free model wears.</p>
    <div class="ground"><span class="lab">48 px</span>${strip(48, { halo: 0.8, line: 0.4 })}</div>
    <div class="ground"><span class="lab">28 px</span>${strip(28, { halo: 0.7, line: 0.25 })}</div>
    <div class="ground"><span class="lab">24 px</span>${strip(24, { halo: 0.7, line: 0.22 })}</div>
    <div class="ground"><span class="lab">48 px, angled</span>${strip(48, { halo: 0.8, line: 0.4, tilt: 55 })}</div>
    <div class="ground"><span class="lab">48 px, with a cast shadow</span>${strip(48, { halo: 0.8, line: 0.4, sun: SUN })}</div>
    <div class="ground"><span class="lab">Map badge, 28 px</span>${all.map(disc).join('')}</div>
  </section>
  <section><h2>Colours</h2><p>The five layer colours, then the seven proof colours, top and angled.</p>${colourRow}</section>
  <section><h2>Picker previews</h2><p>Shaded from the theme's text colour, so the picker follows the theme.</p><div class="pickers">${picker('dark')}${picker('light')}</div></section>
</main>
<script>
'use strict';
const TAU=Math.PI*2,TILE=1400;
const roadY=x=>TILE*.5+58*Math.sin(x/TILE*TAU);
const roadX=y=>TILE*.68+40*Math.sin(y/TILE*TAU*2);
function makeGround(){
  const S=TILE,c=document.createElement('canvas');c.width=c.height=S;
  const g=c.getContext('2d');
  let seed=48271;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const lattice=P=>{const a=new Float32Array(P*P);for(let i=0;i<a.length;i++)a[i]=rnd();
    const at=(x,y)=>a[((y%P)+P)%P*P+((x%P)+P)%P];
    return (u,v)=>{const x=u*P,y=v*P,xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
      const top=at(xi,yi)+(at(xi+1,yi)-at(xi,yi))*sx,bot=at(xi,yi+1)+(at(xi+1,yi+1)-at(xi,yi+1))*sx;return top+(bot-top)*sy}};
  const n1=lattice(5),n2=lattice(13),n3=lattice(37),n4=lattice(110),n5=lattice(320);
  const img=g.createImageData(S,S),D=img.data;
  for(let y=0,i=0;y<S;y++)for(let x=0;x<S;x++,i+=4){
    const u=x/S,v=y/S,t=n1(u,v)*.34+n2(u,v)*.28+n3(u,v)*.2+n4(u,v)*.12+n5(u,v)*.06;
    const k=Math.max(0,Math.min(1,(t-.28)/.44)),gr=(rnd()-.5)*14;
    D[i]=134+k*74+gr;D[i+1]=118+k*70+gr;D[i+2]=92+k*62+gr;D[i+3]=255;
  }
  g.putImageData(img,0,0);g.lineCap='round';g.lineJoin='round';
  const road=(points,width)=>{const trace=()=>{g.beginPath();points.forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]))};
    trace();g.strokeStyle='rgba(112,98,78,.55)';g.lineWidth=width+16;g.stroke();trace();g.strokeStyle='#4b4a48';g.lineWidth=width;g.stroke()};
  const along=[],down=[];for(let x=-40;x<=S+40;x+=10)along.push([x,roadY(x)]);for(let y=-40;y<=S+40;y+=10)down.push([roadX(y),y]);
  road(down,34);road(along,50);
  for(let k=0;k<60;k++){const w=60+rnd()*120,h=50+rnd()*90,x=rnd()*(S-w),y=rnd()*(S-h);
    g.fillStyle='rgba('+(160+rnd()*24)+','+(146+rnd()*22)+','+(118+rnd()*18)+',.6)';g.fillRect(x,y,w,h);
    g.strokeStyle='#8c7d66';g.lineWidth=2.4;g.strokeRect(x,y,w,h);
    const bw=20+rnd()*w*.5,bh=20+rnd()*h*.5,bx=x+6+rnd()*(w-bw-12),by=y+6+rnd()*(h-bh-12),shade=176+rnd()*36;
    g.fillStyle='rgba(22,18,14,.56)';g.fillRect(bx+6,by+6,bw,bh);g.fillStyle='rgb('+shade+','+(shade-9)+','+(shade-24)+')';g.fillRect(bx,by,bw,bh)}
  for(let k=0;k<620;k++){const x=rnd()*S,y=rnd()*S,r=1.2+rnd()*rnd()*5.6;
    g.fillStyle='rgba(26,22,16,.42)';g.beginPath();g.arc(x+r*.8,y+r*.7,r,0,TAU);g.fill();
    g.fillStyle='rgb('+(74+rnd()*24)+','+(74+rnd()*22)+','+(48+rnd()*14)+')';g.beginPath();g.arc(x,y,r,0,TAU);g.fill()}
  return c;
}
const url=makeGround().toDataURL('image/jpeg',.88);
document.querySelectorAll('.ground').forEach(el=>{el.style.backgroundImage='url('+url+')'});
const btn=document.getElementById('theme');
btn.onclick=()=>{const light=document.documentElement.dataset.theme!=='light';document.documentElement.dataset.theme=light?'light':'dark';btn.textContent=light?'Dark theme':'Light theme'};
if(location.hash==='#light'){document.documentElement.dataset.theme='light';btn.textContent='Dark theme'}
</script>
</body>
</html>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}: ${all.length} models, ${(html.length / 1024).toFixed(0)} KB; build ${buildMs.toFixed(1)} ms, solve ${solveMs.toFixed(2)} ms average, worst ${worst.id} ${worst.ms.toFixed(2)} ms`);
