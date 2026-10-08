/**
 * Draws the Horizon view from terrain meshes, on the GPU.
 *
 * The ground is real geometry in the eye's frame (geo.js): each tile a mesh with
 * its satellite picture, so a ridge's edge falls where its triangles do, at the
 * screen's own resolution and smoothed by multisampling, and the picture is read
 * per screen pixel through its mipmaps rather than once per cell of a raster.
 *
 * A frame is three passes:
 *
 * 1. **Ground**: the sky, then every tile, into a multisampled target: the
 *    colour, lit, shadowed, hazed and fogged. With ridge lines on (or for a
 *    reading) the distances are drawn again into a target of their own, one
 *    sample a pixel, so an edge's pixel holds the near ground or the far one and
 *    never an average of the two. A Photo frame is drawn straight through the
 *    lens; a Panorama into the faces of a cube round the eye, read by direction.
 *    Under a near limit the ground taken away leaves the band, filled as level
 *    ground is lit, as the app does.
 * 2. **Light**: once per position of the sun, how much of it reaches each cell of
 *    three height grids round the eye (6, 30 and 200 km), marched toward it with
 *    an edge as soft as its disc. Cast shadows are read from these by the ground
 *    pass, so turning or zooming costs nothing for them.
 * 3. **Screen**: the ridge lines read off the distances at the screen's pixels,
 *    the photo laid over (through the loupe, its lens curve undone), the fog
 *    over the lines.
 *
 * The ground's three looks: **Relief** lights it from the sun, the moon at
 * night or the map's north-west light, by its slope, and veils it with
 * distance; **Imagery** colours it with each tile's picture, lit and veiled
 * the same way (relief stands in until a tile's picture comes); **Plain** is a
 * dark ground that pales with distance, there for the ridge lines alone. The
 * **ridge lines** are a layer over any of them: where the ground beside a pixel
 * (above it, or to either side) is much farther than the ground at it, coloured
 * by distance, warm white near and cool blue far, the skyline twice as thick.
 * A **visibility** fades the ground into the air by distance, never a cut.
 *
 * WebGL2 with float colour targets is the only requirement; a browser without
 * them gets null back and the tab says so.
 */
import { basis, focal, principal } from '../camera.js';
import { MAP_LIGHT } from '../sky.js';

const GROUND_CODES = { relief: 0, imagery: 1, plain: 2 };
const NEAR = 0.5;
const FAR = 2e6;
const CUBE_MAX = 1536;

const COMMON = `
uniform float skyLight;
vec3 skyColour(float elevation) {
  float t = clamp((elevation + 2.0) / 30.0, 0.0, 1.0);
  vec3 day = mix(vec3(0.78, 0.84, 0.90), vec3(0.36, 0.49, 0.66), t);
  vec3 night = mix(vec3(0.07, 0.09, 0.13), vec3(0.02, 0.03, 0.05), t);
  return mix(night, day, skyLight);
}
// the plain ground's sky, lighter toward the horizon than any ground under it
vec3 plainSky(float elevation) {
  return mix(vec3(0.17, 0.21, 0.27), vec3(0.07, 0.09, 0.12), clamp(elevation / 25.0 + 0.1, 0.0, 1.0));
}`;

const FULL_VS = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

// --- 1. the sky behind the ground, in the target the ground is drawn into ---
const SKY_FS = `#version 300 es
precision highp float;
precision highp int;
${COMMON}
uniform vec3 fwd; uniform vec3 rgt; uniform vec3 upv;
uniform vec2 focalNdc; uniform vec2 shiftNdc; uniform vec2 size; uniform int ground;
uniform int distanceMode; uniform float nearCut;
uniform vec3 light; uniform vec3 tint; uniform float strength; uniform float ambient;
out vec4 colour;
void main() {
  vec2 ndc = gl_FragCoord.xy / size * 2.0 - 1.0;
  vec2 t = (ndc - shiftNdc) / focalNdc;
  vec3 d = normalize(fwd + t.x * rgt + t.y * upv);
  float elevation = degrees(asin(clamp(d.z, -1.0, 1.0)));
  // with the ground in front taken away, what lies under the eye's level and
  // nearer than the cut is the band: never drawn, filled as level ground is lit
  bool band = nearCut > 0.0 && elevation < 0.0;
  if (distanceMode == 1) {
    colour = vec4(band ? -2.0 : -1.0, 0.0, 0.0, 1.0);
    return;
  }
  if (band) {
    if (ground == 2) { colour = vec4(0.05, 0.055, 0.06, 1.0); return; }
    vec3 skyOn = ambient * mix(vec3(0.75, 0.82, 1.0), vec3(1.0), skyLight);
    colour = vec4(vec3(0.38, 0.37, 0.35) * (skyOn + (1.0 - min(ambient, 0.22)) * strength * max(light.z, 0.0) * tint), 1.0);
    return;
  }
  colour = vec4(ground == 2 ? plainSky(elevation) : skyColour(elevation), 1.0);
}`;

// --- 1. the ground ---
const GROUND_VS = `#version 300 es
in vec3 pos; in vec3 nrm; in vec2 uv;
uniform vec3 eye; uniform vec3 fwd; uniform vec3 rgt; uniform vec3 upv;
uniform vec2 focalNdc; uniform vec2 shiftNdc; uniform float near; uniform float far;
out vec3 vPos; out vec3 vN; out vec2 vUv;
void main() {
  vPos = pos; vN = nrm; vUv = uv;
  vec3 p = pos - eye;
  float cz = dot(p, fwd);
  // clipped against a true near plane; the depth itself is written per pixel
  gl_Position = vec4(dot(p, rgt) * focalNdc.x + shiftNdc.x * cz, dot(p, upv) * focalNdc.y + shiftNdc.y * cz,
                     (cz * (far + near) - 2.0 * far * near) / (far - near), cz);
}`;

const GROUND_FS = `#version 300 es
precision highp float;
precision highp int;
${COMMON}
in vec3 vPos; in vec3 vN; in vec2 vUv;
uniform sampler2D img; uniform int hasImage; uniform int ground;
uniform vec3 eye; uniform vec3 fwd; uniform float near; uniform float far;
uniform float nearCut; uniform float farLimit; uniform float visibility; uniform float sharpen;
uniform vec3 light; uniform vec3 tint; uniform float strength; uniform float ambient; uniform float keep;
uniform int shadows; uniform sampler2D light0; uniform sampler2D light1; uniform sampler2D light2; uniform vec3 reach;
out vec4 colour;
uniform int distanceMode;

vec2 gridUv(vec2 xy, float r) { return vec2((xy.x + r) / (2.0 * r), (r - xy.y) / (2.0 * r)); }
// how much of the light reaches the ground there: 1 unless a ridge hides it
float shadeAt(vec2 xy) {
  if (shadows == 0) return 1.0;
  float m = max(abs(xy.x), abs(xy.y));
  if (m < reach.x * 0.97) return texture(light0, gridUv(xy, reach.x)).r;
  if (m < reach.y * 0.97) return texture(light1, gridUv(xy, reach.y)).r;
  if (m < reach.z * 0.97) return texture(light2, gridUv(xy, reach.z)).r;
  return 1.0;
}
// renderer.js: the sky's light (the share the analyst keeps in a shadow) and the body's
vec3 skyOn(float shade) {
  return ambient * mix(keep, 1.0, shade) * mix(vec3(0.75, 0.82, 1.0), vec3(1.0), skyLight);
}
vec3 lightOn(vec3 n, float shade) {
  return skyOn(shade) + (1.0 - min(ambient, 0.22)) * strength * max(dot(n, light), 0.0) * shade * tint;
}
float depthShare(float d) {
  return clamp(log(max(d, 50.0) / 300.0) / log(max(farLimit, 1000.0) / 300.0), 0.0, 1.0);
}
// a ground seen edge-on squeezes its picture far more one way than the other;
// past 16 to 1 the card blurs it by the longer side, this lets it squeeze
// sharpen times more first
vec3 picture() {
  vec2 gx = dFdx(vUv);
  vec2 gy = dFdy(vUv);
  float lx = length(gx);
  float ly = length(gy);
  if (lx > ly) gx *= clamp(16.0 * ly / max(lx, 1e-12), 1.0 / sharpen, 1.0);
  else gy *= clamp(16.0 * lx / max(ly, 1e-12), 1.0 / sharpen, 1.0);
  return textureGrad(img, vUv, gx, gy).rgb;
}

void main() {
  vec3 p = vPos - eye;
  float d = length(p);
  if (d < nearCut) discard;
  gl_FragDepth = log(max(dot(p, fwd), near) / near) / log(far / near);
  // the distance pass: how far, exact at the pixel's centre, for the ridge lines and readings
  if (distanceMode == 1) { colour = vec4(d, 0.0, 0.0, 1.0); return; }
  vec3 n = normalize(vN);
  float shade = shadeAt(vPos.xy);
  vec3 c;
  if (ground == 2) {
    // farther ground pales and cools, the way air layers a range
    float t = depthShare(d);
    vec3 fill = mix(vec3(0.05, 0.055, 0.06), vec3(0.13, 0.15, 0.18), t);
    float lit = strength * max(dot(n, light), 0.0) * shade;
    c = fill * (0.82 + 0.36 * lit * (1.0 - t * 0.6));
  } else if (ground == 1 && hasImage == 1) {
    vec3 pic = picture();
    float sun = strength * (0.28 + 0.28 * max(dot(n, light), 0.0)) * shade;
    pic *= 0.58 / 0.22 * skyOn(shade) + sun * tint;
    float veil = 1.0 - exp(-d / 60000.0);
    c = mix(pic, skyColour(0.0), veil * 0.75 * mix(0.35, 1.0, skyLight));
  } else {
    vec3 rock = vec3(0.62, 0.60, 0.56) * lightOn(n, shade);
    float haze = 1.0 - exp(-d / 45000.0);
    c = mix(rock, skyColour(0.0), haze * 0.85 * mix(0.35, 1.0, skyLight));
  }
  // ground in thick air fades into it
  vec3 air = ground == 2 ? plainSky(0.0) : skyColour(0.0);
  float fog = visibility > 0.0 ? 1.0 - exp(-3.0 * d / visibility) : 0.0;
  colour = vec4(mix(c, air, fog), 1.0);
}`;

// --- 2. the light on the grids ---
const LIGHT_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D grid0; uniform sampler2D grid1; uniform sampler2D grid2;
uniform vec3 reach; uniform vec3 cells; uniform float gridTop; uniform vec3 light;
uniform sampler2D own; uniform float ownReach; uniform float ownSize;
out vec4 color;
float gridHeight(sampler2D g, float r, float n, vec2 xy) {
  float cell = 2.0 * r / n;
  vec2 f = vec2((xy.x + r) / cell - 0.5, (r - xy.y) / cell - 0.5);
  vec2 i = floor(f);
  vec2 t = f - i;
  ivec2 m = ivec2(int(n) - 1);
  ivec2 a = clamp(ivec2(i), ivec2(0), m);
  ivec2 b = clamp(ivec2(i) + 1, ivec2(0), m);
  return mix(mix(texelFetch(g, a, 0).r, texelFetch(g, ivec2(b.x, a.y), 0).r, t.x),
             mix(texelFetch(g, ivec2(a.x, b.y), 0).r, texelFetch(g, b, 0).r, t.x), t.y);
}
// the finest grid's height under xy and its cell; a cell of -1 off them all
float heightAt(vec2 xy, out float cell) {
  float m = max(abs(xy.x), abs(xy.y));
  if (m < reach.x * 0.98) { cell = 2.0 * reach.x / cells.x; return gridHeight(grid0, reach.x, cells.x, xy); }
  if (m < reach.y * 0.98) { cell = 2.0 * reach.y / cells.y; return gridHeight(grid1, reach.y, cells.y, xy); }
  if (m < reach.z * 0.98) { cell = 2.0 * reach.z / cells.z; return gridHeight(grid2, reach.z, cells.z, xy); }
  cell = -1.0;
  return 0.0;
}
void main() {
  // the sun's disc is 0.53 degrees across: half of it over the ridge is half the light
  const float SUN = 0.004625;
  float cell = 2.0 * ownReach / ownSize;
  ivec2 cr = ivec2(gl_FragCoord.xy);
  vec3 p = vec3(-ownReach + (float(cr.x) + 0.5) * cell, ownReach - (float(cr.y) + 0.5) * cell, texelFetch(own, cr, 0).r);
  if (light.z < -0.01) { color = vec4(0.0); return; }
  float least = 1.0;
  float t = 3.0 * cell;
  for (int k = 0; k < 400; k++) {
    vec3 s = p + light * t;
    if (s.z > gridTop) break;
    float step;
    float h = heightAt(s.xy, step);
    if (step < 0.0) break;
    least = min(least, (s.z - h + 1.0) / t);
    if (least < -SUN) break;
    t += max(step * 0.8, t * 0.04);
  }
  color = vec4(clamp(0.5 + least / (2.0 * SUN), 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

// --- 3. the screen ---
const SCREEN_FS = `#version 300 es
precision highp float;
precision highp int;
${COMMON}
uniform int projection;
uniform sampler2D colour2D; uniform sampler2D dist2D;
uniform samplerCube colourCube; uniform samplerCube distCube;
uniform vec2 size; uniform float heading; uniform float tilt; uniform float degPerPx;
uniform int ground; uniform int lines; uniform float jump; uniform float cssPx;
uniform float farLimit; uniform float nearLimit; uniform float visibility;
uniform sampler2D photoMap; uniform int hasPhoto; uniform float photoMix; uniform vec3 loupe;
// the photo's lens curve undone: k, and its half-diagonal across and down (overlay.js bendShape)
uniform vec3 bend;
uniform int picking; uniform vec2 pickPx;
out vec4 color;

vec3 dirAt(vec2 px) {
  float az = radians(heading + (px.x - size.x * 0.5) * degPerPx);
  float el = radians(clamp(tilt - (px.y - size.y * 0.5) * degPerPx, -89.9, 89.9));
  return vec3(sin(az) * cos(el), cos(az) * cos(el), sin(el));
}
float distAt(vec2 px) {
  if (projection == 1) return texture(distCube, dirAt(px)).r;
  ivec2 i = clamp(ivec2(floor(px.x), floor(size.y - px.y)), ivec2(0), ivec2(size) - 1);
  return texelFetch(dist2D, i, 0).r;
}
vec3 colourAt(vec2 px) {
  if (projection == 1) return texture(colourCube, dirAt(px)).rgb;
  ivec2 i = clamp(ivec2(floor(px.x), floor(size.y - px.y)), ivec2(0), ivec2(size) - 1);
  return texelFetch(colour2D, i, 0).rgb;
}
float depthShare(float d) {
  return clamp(log(max(d, 50.0) / 300.0) / log(max(farLimit, 1000.0) / 300.0), 0.0, 1.0);
}
// a ridge line's colour: warm white near, cool blue far
vec3 lineTint(float d) {
  return mix(vec3(0.95, 0.90, 0.80), vec3(0.55, 0.70, 0.90), depthShare(d));
}
// how sharply ground at d steps back to ground at other: 0 for no edge, more for a deeper step
float stepTo(float d, float other) {
  if (other < 0.0 || other <= d * (1.0 + jump)) return 0.0;
  return clamp((other / d - 1.0 - jump) / (jump * 4.0) + 0.55, 0.55, 1.0);
}
// -1 is sky, -2 the band under a near limit (no ground drawn, no line either)
bool isSky(float d) { return d < -0.5 && d > -1.5; }
// x: how strongly the pixel lies on a ridge line reach pixels thick, y: 1 on the
// skyline, which is twice as thick. Only the near side of a step is drawn.
vec2 edgeAt(vec2 px, float d, float r) {
  float up = distAt(px - vec2(0.0, r));
  float left = distAt(px - vec2(r, 0.0));
  float right = distAt(px + vec2(r, 0.0));
  float up2 = distAt(px - vec2(0.0, 2.0 * r));
  if (isSky(up) || isSky(left) || isSky(right) || isSky(up2)) return vec2(1.0, 1.0);
  return vec2(max(stepTo(d, up), max(stepTo(d, left), stepTo(d, right))), 0.0);
}
float fogAt(float d) {
  return visibility > 0.0 ? 1.0 - exp(-3.0 * d / visibility) : 0.0;
}
void main() {
  vec2 px = picking == 1 ? pickPx : vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  float d = distAt(px);
  if (picking == 1) { color = vec4(d, 0.0, 0.0, 1.0); return; }
  vec3 base = colourAt(px);
  vec3 ink = vec3(0.0);
  float inkShare = 0.0;
  float edgeDark = 1.0;
  if (lines == 1 && d >= max(nearLimit, 120.0)) {
    vec2 edge = edgeAt(px, d, cssPx);
    if (edge.x > 0.0) {
      ink = edge.y > 0.5 ? mix(lineTint(d), vec3(1.0), 0.45) : lineTint(d);
      inkShare = edge.x;
    } else if ((ground != 2 || hasPhoto == 1) && edgeAt(px, d, 2.0 * cssPx).x > 0.0) {
      // over relief, imagery or a photo a line keeps a dark edge on its near side
      edgeDark = 0.45;
    }
  }
  vec3 air = ground == 2 ? plainSky(0.0) : skyColour(0.0);
  float fog = d >= 0.0 ? fogAt(d) : 0.0;
  if (hasPhoto == 1) {
    vec2 seen = loupe.xy + (px / size - 0.5) / loupe.z;
    vec2 off = (seen - 0.5) * bend.yz;
    vec2 raw = 0.5 + (seen - 0.5) * (1.0 + bend.x * dot(off, off));
    // where the straightened photo leaves the frame, the terrain shows
    float inside = step(0.0, raw.x) * step(raw.x, 1.0) * step(0.0, raw.y) * step(raw.y, 1.0);
    base = mix(base, texture(photoMap, raw).rgb, photoMix * inside);
  }
  base *= mix(edgeDark, 1.0, fog);
  base = mix(base, mix(ink, air, fog), inkShare);
  color = vec4(base, 1.0);
}`;

// the six faces of a cube round the eye, in GL's own order, as cameras: the
// texel a direction samples is the pixel this camera draws for it
const FACES = [
  { fwd: [1, 0, 0], rgt: [0, 0, -1], upv: [0, -1, 0] },
  { fwd: [-1, 0, 0], rgt: [0, 0, 1], upv: [0, -1, 0] },
  { fwd: [0, 1, 0], rgt: [1, 0, 0], upv: [0, 0, 1] },
  { fwd: [0, -1, 0], rgt: [1, 0, 0], upv: [0, 0, -1] },
  { fwd: [0, 0, 1], rgt: [1, 0, 0], upv: [0, -1, 0] },
  { fwd: [0, 0, -1], rgt: [-1, 0, 0], upv: [0, -1, 0] },
];

/** The unit vector toward a light at this azimuth and altitude, in degrees. */
export function lightVector(azimuth, altitude) {
  const a = (azimuth * Math.PI) / 180;
  const h = (altitude * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(h), Math.cos(a) * Math.cos(h), Math.sin(h)];
}

/** A renderer on a canvas, or null where the browser lacks WebGL2 or float targets. */
export function createMeshRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const maxAniso = aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));

  function compile(vs, fs, name) {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(shader)}`);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(program)}`);
    const cache = new Map();
    const at = (n) => {
      if (!cache.has(n)) cache.set(n, gl.getUniformLocation(program, n));
      return cache.get(n);
    };
    return { program, at };
  }
  const skyPass = compile(FULL_VS, SKY_FS, 'sky');
  const groundPass = compile(GROUND_VS, GROUND_FS, 'ground');
  const lightPass = compile(FULL_VS, LIGHT_FS, 'light');
  const screenPass = compile(FULL_VS, SCREEN_FS, 'screen');

  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const fullVao = gl.createVertexArray();
  gl.bindVertexArray(fullVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  for (const pass of [skyPass, lightPass, screenPass]) gl.bindAttribLocation(pass.program, 0, 'corner');
  for (const pass of [skyPass, lightPass, screenPass]) gl.linkProgram(pass.program);
  gl.bindAttribLocation(groundPass.program, 0, 'pos');
  gl.bindAttribLocation(groundPass.program, 1, 'nrm');
  gl.bindAttribLocation(groundPass.program, 2, 'uv');
  gl.linkProgram(groundPass.program);
  gl.bindVertexArray(null);

  // ---------- tiles ----------
  const meshes = new Map();
  function indicesOf(size) {
    if (meshes.has(size)) return meshes.get(size);
    const side = size + 1;
    const grid = side * side;
    const edge = [(k) => k, (k) => size * side + k, (k) => k * side, (k) => k * side + size];
    const list = [];
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const a = j * side + i;
        list.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
      }
    }
    for (let e = 0; e < 4; e += 1) {
      for (let k = 0; k < size; k += 1) {
        const s0 = grid + e * side + k;
        list.push(edge[e](k), s0, edge[e](k + 1), edge[e](k + 1), s0, s0 + 1);
      }
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(list), gl.STATIC_DRAW);
    const mesh = { buffer, count: list.length };
    meshes.set(size, mesh);
    return mesh;
  }

  function addTile({ data, size, image }) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [at, count, offset] of [[0, 3, 0], [1, 3, 12], [2, 2, 24]]) {
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, count, gl.FLOAT, false, 32, offset);
    }
    const mesh = indicesOf(size);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.buffer);
    gl.bindVertexArray(null);
    const tile = { vao, buffer, texture: null, count: mesh.count };
    setImage(tile, image);
    return tile;
  }

  /** A tile's picture, mipmapped and read edge-on through anisotropy; null takes it away. */
  function setImage(tile, image) {
    if (tile.texture) gl.deleteTexture(tile.texture);
    tile.texture = null;
    if (!image) return;
    tile.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tile.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAniso));
    image.close?.();
  }

  function dropTile(tile) {
    gl.deleteVertexArray(tile.vao);
    gl.deleteBuffer(tile.buffer);
    if (tile.texture) gl.deleteTexture(tile.texture);
  }

  // ---------- targets ----------
  function texture2D(format, width, height, filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function depthBuffer(width, height, multisample) {
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    if (multisample) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
    else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    return rb;
  }

  /** The multisampled colour target the ground is drawn into, kept until the size changes. */
  let msaa = null;
  function msaaTarget(width, height) {
    if (msaa && msaa.width === width && msaa.height === height) return msaa;
    if (msaa) {
      gl.deleteFramebuffer(msaa.fbo);
      gl.deleteRenderbuffer(msaa.colour);
      gl.deleteRenderbuffer(msaa.depth);
    }
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const colour = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, colour);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colour);
    const depth = depthBuffer(width, height, true);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    msaa = { fbo, colour, depth, width, height };
    return msaa;
  }

  /** Where a picture lands: a colour texture the multisampled one resolves into, a distance one drawn straight. */
  function landing(width, height) {
    return { resolveFbo: gl.createFramebuffer(), distFbo: gl.createFramebuffer(), distDepth: depthBuffer(width, height, false) };
  }
  function dropLanding(l) {
    gl.deleteFramebuffer(l.resolveFbo);
    gl.deleteFramebuffer(l.distFbo);
    gl.deleteRenderbuffer(l.distDepth);
  }

  /** The picture of a Photo frame. */
  let flat = null;
  function flatTarget(width, height) {
    if (flat && flat.width === width && flat.height === height) return flat;
    if (flat) {
      dropLanding(flat);
      gl.deleteTexture(flat.colour);
      gl.deleteTexture(flat.dist);
    }
    flat = { ...landing(width, height), colour: texture2D(gl.RGBA8, width, height, gl.NEAREST), dist: texture2D(gl.R32F, width, height, gl.NEAREST), width, height };
    return flat;
  }

  /** The cube a Panorama is drawn into, its faces `size` pixels a side. */
  let cube = null;
  function cubeTarget(size) {
    if (cube && cube.size === size) return cube;
    if (cube) {
      dropLanding(cube);
      gl.deleteTexture(cube.colour);
      gl.deleteTexture(cube.dist);
    }
    const make = (format, filter) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, format, size, size);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, filter);
      return t;
    };
    cube = { ...landing(size, size), size, colour: make(gl.RGBA8, gl.LINEAR), dist: make(gl.R32F, gl.NEAREST) };
    return cube;
  }

  // ---------- shadows ----------
  let grids = null;
  let lightKey = '';
  function setGrids(next) {
    if (grids) for (const g of grids.list) gl.deleteTexture(g.height), gl.deleteTexture(g.light), gl.deleteFramebuffer(g.fbo);
    grids = null;
    lightKey = '';
    if (!next) return;
    grids = {
      top: next.top,
      list: next.list.map((g) => {
        const height = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, height);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, g.size, g.size, 0, gl.RED, gl.FLOAT, g.heights);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const light = texture2D(gl.R8, g.size, g.size, gl.LINEAR);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, light, 0);
        return { ...g, heights: undefined, height, light, fbo };
      }),
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The light on the grids for a body here, marched again only when it moved. */
  function marchLight(azimuth, altitude) {
    const key = `${azimuth.toFixed(2)}/${altitude.toFixed(2)}`;
    if (!grids || key === lightKey) return;
    const { program, at } = lightPass;
    gl.useProgram(program);
    gl.bindVertexArray(fullVao);
    gl.disable(gl.DEPTH_TEST);
    grids.list.forEach((g, i) => {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, g.height);
      gl.uniform1i(at(`grid${i}`), 1 + i);
    });
    gl.uniform3f(at('reach'), ...grids.list.map((g) => g.reach));
    gl.uniform3f(at('cells'), ...grids.list.map((g) => g.size));
    gl.uniform1f(at('gridTop'), grids.top);
    gl.uniform3fv(at('light'), lightVector(azimuth, altitude));
    grids.list.forEach((g, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
      gl.viewport(0, 0, g.size, g.size);
      gl.uniform1i(at('own'), 1 + i);
      gl.uniform1f(at('ownReach'), g.reach);
      gl.uniform1f(at('ownSize'), g.size);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    lightKey = key;
  }

  // ---------- photo ----------
  const photoMap = gl.createTexture();
  let photo = false;
  function setPhoto(source) {
    photo = Boolean(source);
    if (!source) return;
    const moving = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photoMap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, moving ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (!moving) gl.generateMipmap(gl.TEXTURE_2D);
  }

  // ---------- a frame ----------
  /** Sky then ground through one camera into the bound target: the colour, or (distanceMode) the distance. */
  function paint(view, tiles, o, width, height, distanceMode) {
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(skyPass.program);
    gl.bindVertexArray(fullVao);
    const s = skyPass.at;
    gl.uniform3fv(s('fwd'), view.fwd);
    gl.uniform3fv(s('rgt'), view.rgt);
    gl.uniform3fv(s('upv'), view.upv);
    gl.uniform2fv(s('focalNdc'), view.focalNdc);
    gl.uniform2fv(s('shiftNdc'), view.shiftNdc);
    gl.uniform2f(s('size'), width, height);
    gl.uniform1i(s('ground'), GROUND_CODES[o.ground] ?? 0);
    gl.uniform1f(s('skyLight'), o.sky.sky);
    gl.uniform1i(s('distanceMode'), distanceMode ? 1 : 0);
    gl.uniform1f(s('nearCut'), o.near);
    gl.uniform3fv(s('light'), lightVector(o.sky.azimuth, o.sky.altitude));
    gl.uniform3fv(s('tint'), o.sky.tint);
    gl.uniform1f(s('strength'), o.sky.strength);
    gl.uniform1f(s('ambient'), o.sky.ambient);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const { program, at } = groundPass;
    gl.useProgram(program);
    gl.uniform1i(at('distanceMode'), distanceMode ? 1 : 0);
    gl.uniform3fv(at('eye'), o.eye);
    gl.uniform3fv(at('fwd'), view.fwd);
    gl.uniform3fv(at('rgt'), view.rgt);
    gl.uniform3fv(at('upv'), view.upv);
    gl.uniform2fv(at('focalNdc'), view.focalNdc);
    gl.uniform2fv(at('shiftNdc'), view.shiftNdc);
    gl.uniform1f(at('near'), NEAR);
    gl.uniform1f(at('far'), FAR);
    gl.uniform1i(at('ground'), GROUND_CODES[o.ground] ?? 0);
    gl.uniform1f(at('nearCut'), o.near);
    gl.uniform1f(at('farLimit'), o.far);
    gl.uniform1f(at('visibility'), o.visibility > 0 ? o.visibility : 0);
    gl.uniform1f(at('sharpen'), o.sharpen);
    gl.uniform3fv(at('light'), lightVector(o.sky.azimuth, o.sky.altitude));
    gl.uniform3fv(at('tint'), o.sky.tint);
    gl.uniform1f(at('strength'), o.sky.strength);
    gl.uniform1f(at('ambient'), o.sky.ambient);
    gl.uniform1f(at('skyLight'), o.sky.sky);
    gl.uniform1f(at('keep'), o.keep);
    const shading = Boolean(o.shaded && grids && !distanceMode);
    gl.uniform1i(at('shadows'), shading ? 1 : 0);
    if (shading) {
      grids.list.forEach((g, i) => {
        gl.activeTexture(gl.TEXTURE1 + i);
        gl.bindTexture(gl.TEXTURE_2D, g.light);
        gl.uniform1i(at(`light${i}`), 1 + i);
      });
      gl.uniform3f(at('reach'), ...grids.list.map((g) => g.reach));
    }
    gl.uniform1i(at('img'), 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const tile of tiles) {
      gl.uniform1i(at('hasImage'), tile.texture ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, tile.texture);
      gl.bindVertexArray(tile.vao);
      gl.drawElements(gl.TRIANGLES, tile.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }

  /**
   * One picture through one camera: the colour multisampled then resolved into
   * `colourOf()`, and with `distance` the distance drawn straight into `distOf()`.
   */
  function picture(view, tiles, o, width, height, where, attach, distance) {
    const target = msaaTarget(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    paint(view, tiles, o, width, height, false);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, where.resolveFbo);
    attach('colour');
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    if (distance) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, where.distFbo);
      attach('dist');
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, where.distDepth);
      paint(view, tiles, o, width, height, true);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The faces of the cube a panorama camera's frame looks through. */
  function facesSeen(camera) {
    const seen = new Set();
    const { width, height } = camera;
    const scale = camera.fov / width;
    for (let j = 0; j <= 8; j += 1) {
      for (let i = 0; i <= 16; i += 1) {
        const az = ((camera.heading + (i / 16 - 0.5) * width * scale) * Math.PI) / 180;
        const el = (Math.max(-89.9, Math.min(89.9, camera.tilt - (j / 8 - 0.5) * height * scale)) * Math.PI) / 180;
        const d = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
        const axis = d.map(Math.abs).reduce((best, v, k, all) => (v > all[best] ? k : best), 0);
        seen.add(axis * 2 + (d[axis] < 0 ? 1 : 0));
      }
    }
    return [...seen];
  }

  let lastView = null;
  let lastFrame = null;

  /** The ground through a camera into the flat target or the cube: colour, and distance when asked. */
  function render(camera, tiles, o, distance) {
    const width = canvas.width;
    const height = canvas.height;
    const panorama = camera.projection === 'panorama';
    if (!panorama) {
      const scaled = { ...camera, width, height, loupe: camera.loupe };
      const axes = basis(camera);
      const f = focal(scaled);
      const c = principal(scaled);
      const view = {
        fwd: axes.forward, rgt: axes.right, upv: axes.up,
        focalNdc: [(2 * f) / width, (2 * f) / height],
        shiftNdc: [(2 * c.x) / width - 1, 1 - (2 * c.y) / height],
      };
      const target = flatTarget(width, height);
      const attach = (what) => {
        const kind = what === 'colour' ? gl.DRAW_FRAMEBUFFER : gl.FRAMEBUFFER;
        gl.framebufferTexture2D(kind, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target[what], 0);
      };
      picture(view, tiles, o, width, height, target, attach, distance);
    } else {
      const degPerPx = camera.fov / width;
      const size = Math.min(CUBE_MAX, gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE), Math.max(256, Math.ceil((90 / degPerPx) * 1.1)));
      const target = cubeTarget(size);
      for (const face of facesSeen({ ...camera, width, height })) {
        const view = { ...FACES[face], focalNdc: [1, 1], shiftNdc: [0, 0] };
        const attach = (what) => {
          const kind = what === 'colour' ? gl.DRAW_FRAMEBUFFER : gl.FRAMEBUFFER;
          gl.framebufferTexture2D(kind, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, target[what], 0);
        };
        picture(view, tiles, o, size, size, target, attach, distance);
      }
    }
  }

  /**
   * One frame. `camera` as camera.js takes it, in CSS pixels; the canvas is
   * drawn at its own pixel size. `tiles` are what `addTile` gave, nearest
   * first. Options: `ground` ('relief', 'imagery', 'plain'), `lines`, `sky`
   * (sky.js `skyLight`), `shaded`, `keep` (sky.js `shadowKeep`), `visibility`
   * and `near` in metres (0 for none), `far` the view's far limit, `photo`
   * (0 to 1), `bend` its lens curve (overlay.js `bend`, `[k, across, down]`), `eye`
   * the eye's offset in the frame the tiles were built in, `sharpen` (see the
   * ground shader).
   */
  function draw(camera, tiles, options = {}) {
    const o = {
      ground: 'relief', lines: false, sky: MAP_LIGHT, shaded: false, keep: 1, visibility: 0, near: 0,
      far: 200000, photo: 1, eye: [0, 0, 0], sharpen: 4, jump: 0.12, bend: [0, 1, 1], ...options,
    };
    const width = canvas.width;
    const height = canvas.height;
    const density = width / camera.width;
    if (o.shaded && grids) marchLight(o.sky.azimuth, o.sky.altitude);
    const panorama = camera.projection === 'panorama';
    render(camera, tiles, o, o.lines);

    // the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    const { program, at } = screenPass;
    gl.useProgram(program);
    gl.bindVertexArray(fullVao);
    bindPicture(at, panorama);
    gl.uniform2f(at('size'), width, height);
    gl.uniform1f(at('heading'), camera.heading);
    gl.uniform1f(at('tilt'), camera.tilt);
    gl.uniform1f(at('degPerPx'), camera.fov / width);
    gl.uniform1i(at('ground'), GROUND_CODES[o.ground] ?? 0);
    gl.uniform1i(at('lines'), o.lines ? 1 : 0);
    gl.uniform1f(at('jump'), o.jump);
    gl.uniform1f(at('cssPx'), Math.max(1, Math.round(density)));
    gl.uniform1f(at('farLimit'), o.far);
    gl.uniform1f(at('nearLimit'), o.near);
    gl.uniform1f(at('visibility'), o.visibility > 0 ? o.visibility : 0);
    gl.uniform1f(at('skyLight'), o.sky.sky);
    gl.uniform1i(at('hasPhoto'), photo ? 1 : 0);
    gl.uniform1f(at('photoMix'), Math.min(1, Math.max(0, o.photo)));
    const loupe = camera.loupe ?? { x: 0.5, y: 0.5, zoom: 1 };
    gl.uniform3f(at('loupe'), loupe.x, loupe.y, loupe.zoom);
    gl.uniform3f(at('bend'), o.bend[0], o.bend[1], o.bend[2]);
    gl.uniform1i(at('picking'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    lastView = { panorama, width, height, density, camera, distance: o.lines };
    lastFrame = { camera, tiles, o };
  }

  function bindPicture(at, panorama) {
    const units = panorama
      ? [[gl.TEXTURE_CUBE_MAP, cube.colour, 'colourCube', 5], [gl.TEXTURE_CUBE_MAP, cube.dist, 'distCube', 6]]
      : [[gl.TEXTURE_2D, flat.colour, 'colour2D', 3], [gl.TEXTURE_2D, flat.dist, 'dist2D', 4]];
    for (const [kind, handle, name, unit] of units) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(kind, handle);
      gl.uniform1i(at(name), unit);
    }
    gl.activeTexture(gl.TEXTURE0 + 7);
    gl.bindTexture(gl.TEXTURE_2D, photoMap);
    gl.uniform1i(at('photoMap'), 7);
    gl.uniform1i(at('projection'), panorama ? 1 : 0);
  }

  // ---------- reading the ground under a pixel ----------
  const pickTex = texture2D(gl.RGBA32F, 1, 1, gl.NEAREST);
  const pickFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  /** The distance under a CSS pixel of the last frame drawn into the one-pixel target; false before any frame. */
  function pickInto(x, y) {
    if (!lastView) return false;
    // without ridge lines the frame drew no distances: draw them now, once
    if (!lastView.distance) {
      render(lastFrame.camera, lastFrame.tiles, lastFrame.o, true);
      lastView.distance = true;
    }
    const { program, at } = screenPass;
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
    gl.viewport(0, 0, 1, 1);
    gl.useProgram(program);
    gl.bindVertexArray(fullVao);
    bindPicture(at, lastView.panorama);
    gl.uniform1i(at('picking'), 1);
    gl.uniform2f(at('pickPx'), x * lastView.density, y * lastView.density);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** The distance in metres to the ground under a CSS pixel of the last frame, or null for sky. */
  function pick(x, y) {
    if (!pickInto(x, y)) return null;
    const out = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out[0] >= 0 ? out[0] : null;
  }

  // a reading the pointer asks for as it moves, read back once the GPU is done rather than
  // waited for: one at a time, each into a buffer of its own, the latest asked replacing any
  // not started
  let picking = null;
  let nextPick = null;

  /** As `pick`, without stalling the page: resolves a moment later, or undefined once a newer one was asked. */
  function pickSoon(x, y) {
    return new Promise((resolve) => {
      if (nextPick) nextPick.resolve(undefined);
      nextPick = { x, y, resolve };
      if (!picking) startPick();
    });
  }

  function startPick() {
    const asked = nextPick;
    nextPick = null;
    if (!asked) return;
    if (!pickInto(asked.x, asked.y)) return asked.resolve(null);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    picking = { fence, buffer, asked };
    const poll = () => {
      if (picking?.fence !== fence) return;
      if (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) return void setTimeout(poll, 4);
      gl.deleteSync(fence);
      const out = new Float32Array(4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(buffer);
      picking = null;
      asked.resolve(out[0] >= 0 ? out[0] : null);
      startPick();
    };
    setTimeout(poll, 0);
  }

  /** Everything on the GPU let go, and the context with it, for a view that closes. */
  function dispose() {
    setGrids(null);
    for (const pass of [skyPass, groundPass, lightPass, screenPass]) gl.deleteProgram(pass.program);
    for (const mesh of meshes.values()) gl.deleteBuffer(mesh.buffer);
    meshes.clear();
    gl.deleteBuffer(corners);
    gl.deleteVertexArray(fullVao);
    gl.deleteTexture(photoMap);
    gl.deleteTexture(pickTex);
    gl.deleteFramebuffer(pickFbo);
    if (picking) {
      gl.deleteSync(picking.fence);
      gl.deleteBuffer(picking.buffer);
      picking.asked.resolve(undefined);
    }
    picking = null;
    nextPick?.resolve(undefined);
    nextPick = null;
    if (msaa) {
      gl.deleteFramebuffer(msaa.fbo);
      gl.deleteRenderbuffer(msaa.colour);
      gl.deleteRenderbuffer(msaa.depth);
    }
    for (const target of [flat, cube]) {
      if (!target) continue;
      dropLanding(target);
      gl.deleteTexture(target.colour);
      gl.deleteTexture(target.dist);
    }
    msaa = flat = cube = null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  return { addTile, setImage, dropTile, setGrids, setPhoto, draw, pick, pickSoon, dispose };
}
