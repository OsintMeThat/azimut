/**
 * Draws a panorama through the Horizon camera, on the GPU.
 *
 * The picture itself was made by the app (engine/horizon.py): this only looks
 * through it. One full-screen pass asks, for each pixel, which way it looks
 * (the same arithmetic as `camera.js`), and reads the panorama cell there:
 *
 * The ground is drawn one of three ways:
 *
 * - **Relief** lights the ground from a direction (the sun, the moon at
 *   night, when a day is set) using the slope the app sent, and veils it
 *   with distance.
 * - **Imagery** colours the ground with the satellite picture the app laid
 *   over the same grid (`setDrape`), veiled with distance like the relief.
 * - **Plain** is a dark ground that pales with distance under a night sky,
 *   there for the ridge lines alone.
 *
 * The **ridge lines** are a layer over any of them: the ridges as an eye picks
 * them out, where the ground beside a pixel (above it, or to either side on a
 * steep flank) is much farther than the ground at it. Each line is coloured by
 * its distance, warm white near and cool blue far, the summit-chart way of
 * reading depth; the skyline is drawn twice as thick, and over a busy ground a
 * line keeps a dark edge under it so it reads on snow as on forest. Ground
 * closer than 120 m draws no line: at a 30 m terrain step it only doubles.
 *
 * A visibility hazes the ground as air does: by the distance, until at the
 * visibility only a twentieth of its contrast is left, the far ridges
 * fading into the sky rather than cut off at a range.
 *
 * The light is the sky's (lib/horizon/sky.js `skyLight`): a direction, a
 * colour and a strength for the body that lights the ground, a share of light
 * the sky itself gives, and how bright the sky is, from day to a dark night.
 * Where the app marched the light over the terrain (`setShadow`), ground a
 * ridge hides from it keeps only the sky's light.
 *
 * Cells are read with `texelFetch`, so no filtering extension is needed and
 * the distances reach the shader exact. WebGL2 is the only requirement; a
 * browser without it gets null back and the tab says so.
 *
 * The cells are squares, which a coarse first picture would show as such: so
 * the silhouette follows the skyline's own curve (one exact elevation per
 * azimuth, read between the two columns either side), and inside it each
 * pixel reads the four cells around it. They split into the nearer surface
 * and what lies beyond it (ground twice as far, or sky); where the pixel
 * stands between their centres says which side it is on, so the edge of a
 * ridge in front of another runs smooth rather than in steps, and the slope
 * and the distance it is shaded with are blended over that side only.
 *
 * Two pictures can be held at once: the whole turn, and a finer window of it
 * for a narrow lens (`setDetail`). A direction inside the window reads the
 * window; everywhere else reads the turn, so turning past the window's edge
 * shows coarser ground rather than nothing while the next window comes.
 *
 * A photo or a video frame can lie over it all (`setPhoto`), fixed on screen
 * while the terrain moves under it: blended over the ground by a share, with
 * the ridge lines drawn over both, which is the picture a photo is aligned on.
 */
import { basis, focal } from './camera.js';
import { SKY } from './panorama.js';
import { MAP_LIGHT } from './sky.js';

/** The grounds as the shader numbers them. */
const GROUND_CODES = { relief: 0, imagery: 1, plain: 2 };

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D depthMap;
uniform sampler2D normalMap;
uniform sampler2D detailDepth;
uniform sampler2D detailNormal;
uniform sampler2D drapeMap;
uniform sampler2D detailDrape;
uniform sampler2D shadowMap;
uniform int hasShadow;
uniform sampler2D skylineMap;
uniform vec4 shadowAz;
uniform vec3 shadowEl;
uniform int hasDrape;
uniform int hasDetailDrape;
uniform vec2 size;
uniform int projection;
uniform vec3 forward;
uniform vec3 right;
uniform vec3 up;
uniform float focalPx;
uniform float heading;
uniform float tilt;
uniform float degPerPx;
// start, step, count, full (1) or a window (0)
uniform vec4 azGrid;
uniform vec3 elGrid;
uniform vec4 detailAz;
uniform vec3 detailEl;
uniform int hasDetail;
uniform int ground;
uniform int lines;
uniform vec3 light;
uniform vec3 lightTint;
uniform float lightStrength;
uniform float ambient;
uniform float skyLight;
uniform float shadowKeep;
uniform float visibility;
uniform float jump;
uniform float farLimit;
uniform float nearLimit;
uniform float cssPx;
uniform sampler2D photoMap;
uniform int hasPhoto;
uniform float photoMix;
out vec4 color;

vec2 directionAt(vec2 px) {
  if (projection == 1) {
    return vec2(heading + (px.x - size.x * 0.5) * degPerPx, tilt - (px.y - size.y * 0.5) * degPerPx);
  }
  float sx = (px.x - size.x * 0.5) / focalPx;
  float sy = -(px.y - size.y * 0.5) / focalPx;
  vec3 d = normalize(forward + sx * right + sy * up);
  return vec2(degrees(atan(d.x, d.y)), degrees(asin(clamp(d.z, -1.0, 1.0))));
}

// the cell of a grid a direction falls in, or -1 off it
ivec2 gridCell(vec2 dir, vec4 az, vec3 el) {
  float turn = 360.0 / az.y;
  float column = mod((dir.x - az.x) / az.y + 0.5, turn);
  float row = (el.x - dir.y) / el.y + 0.5;
  if (row < 0.0 || row >= el.z) return ivec2(-1);
  if (az.w > 0.5) column = mod(column, az.z);
  else if (column >= az.z) return ivec2(-1);
  return ivec2(int(floor(column)), int(floor(row)));
}

// the skyline's elevation at an azimuth, between the columns either side;
// far above everything off a window of the turn
float skylineOf(float azimuth) {
  float x = mod((azimuth - azGrid.x) / azGrid.y, 360.0 / azGrid.y);
  if (azGrid.w < 0.5 && x > azGrid.z - 1.0) return 1000.0;
  float c0 = floor(x);
  int i0 = int(mod(c0, azGrid.z));
  int i1 = int(mod(c0 + 1.0, azGrid.z));
  return mix(texelFetch(skylineMap, ivec2(i0, 0), 0).r, texelFetch(skylineMap, ivec2(i1, 0), 0).r, x - c0);
}

// The turn's ground at a direction under the skyline's curve, between its four
// cells around (see the header): the distance, and the slope's normal through
// normal; -1 where the cells hold no ground at all.
float turnAt(vec2 dir, out vec2 normal) {
  float x = mod((dir.x - azGrid.x) / azGrid.y, 360.0 / azGrid.y);
  float y = (elGrid.x - dir.y) / elGrid.y;
  float x0 = floor(x);
  float y0 = floor(y);
  float depth[4];
  float weight[4];
  ivec2 cells[4];
  float nearest = 1e12;
  for (int k = 0; k < 4; k++) {
    float cx = x0 + float(k % 2);
    float cy = clamp(y0 + float(k / 2), 0.0, elGrid.z - 1.0);
    bool off = azGrid.w < 0.5 && (cx < 0.0 || cx > azGrid.z - 1.0);
    cells[k] = ivec2(int(mod(cx, azGrid.z)), int(cy));
    depth[k] = off ? -3.0 : texelFetch(depthMap, cells[k], 0).r;
    weight[k] = off ? 0.0 : (k % 2 == 0 ? 1.0 - (x - x0) : x - x0) * (k / 2 == 0 ? 1.0 - (y - y0) : y - y0) + 1e-4;
    if (depth[k] >= 0.0) nearest = min(nearest, depth[k]);
  }
  normal = vec2(0.0);
  if (nearest >= 1e12) return -1.0;
  // the nearer surface: ground within twice the nearest; beyond it, the rest
  float front = 0.0;
  float total = 0.0;
  for (int k = 0; k < 4; k++) {
    total += weight[k];
    if (depth[k] >= 0.0 && depth[k] < nearest * 2.0) front += weight[k];
  }
  bool near = front >= 0.5 * total;
  float far = 0.0;
  float sum = 0.0;
  for (int k = 0; k < 4; k++) {
    bool ground = depth[k] >= 0.0;
    bool side = ground && (depth[k] < nearest * 2.0) == near;
    if (!side) continue;
    far += log(max(depth[k], 1.0)) * weight[k];
    normal += texelFetch(normalMap, cells[k], 0).rg * weight[k];
    sum += weight[k];
  }
  if (sum <= 0.0) {
    // beyond the nearer surface lies only sky: under the skyline, that is the surface's own edge
    for (int k = 0; k < 4; k++) {
      if (depth[k] < 0.0 || depth[k] >= nearest * 2.0) continue;
      far += log(max(depth[k], 1.0)) * weight[k];
      normal += texelFetch(normalMap, cells[k], 0).rg * weight[k];
      sum += weight[k];
    }
  }
  normal /= sum;
  return exp(far / sum);
}

// distance at a direction: >= 0 ground, -1 sky, -2 under the band (ground
// never drawn). The band's top sits over the highest ridge, so above it is sky.
float depthOf(vec2 dir) {
  if (hasDetail == 1) {
    ivec2 fine = gridCell(dir, detailAz, detailEl);
    if (fine.y >= 0) return texelFetch(detailDepth, fine, 0).r;
  }
  ivec2 cell = gridCell(dir, azGrid, elGrid);
  if (cell.y < 0) return dir.y > elGrid.x ? -1.0 : -2.0;
  // the silhouette follows the skyline's curve, not the cells' steps
  if (dir.y > skylineOf(dir.x)) return -1.0;
  vec2 normal;
  return turnAt(dir, normal);
}

// where a direction falls on a grid as a texture coordinate, between cell
// centres so the colours blend; x < 0 off the grid
vec2 gridUv(vec2 dir, vec4 az, vec3 el) {
  float turn = 360.0 / az.y;
  float column = mod((dir.x - az.x) / az.y, turn);
  float row = (el.x - dir.y) / el.y;
  if (row < -0.5 || row > el.z - 0.5) return vec2(-1.0);
  if (az.w < 0.5 && column > az.z - 0.5) return vec2(-1.0);
  return vec2((column + 0.5) / az.z, (row + 0.5) / el.z);
}

vec3 drapeOf(vec2 dir) {
  if (hasDetailDrape == 1) {
    vec2 fine = gridUv(dir, detailAz, detailEl);
    if (fine.x >= 0.0) return texture(detailDrape, fine).rgb;
  }
  vec2 coarse = gridUv(dir, azGrid, elGrid);
  return coarse.x >= 0.0 ? texture(drapeMap, coarse).rgb : vec3(0.30, 0.29, 0.27);
}

// the ground a pixel shades: the east and north parts of its slope's normal,
// and its distance (the turn's blended over the pixel's side of an edge, the
// finer window's cell by cell)
vec3 surfaceOf(vec2 dir, float d) {
  if (hasDetail == 1) {
    ivec2 fine = gridCell(dir, detailAz, detailEl);
    if (fine.y >= 0) return vec3(texelFetch(detailNormal, fine, 0).rg, d);
  }
  vec2 normal;
  float there = turnAt(dir, normal);
  return there < 0.0 ? vec3(texelFetch(normalMap, gridCell(dir, azGrid, elGrid), 0).rg, d) : vec3(normal, there);
}

vec3 skyColour(float elevation) {
  float t = clamp((elevation + 2.0) / 30.0, 0.0, 1.0);
  vec3 day = mix(vec3(0.78, 0.84, 0.90), vec3(0.36, 0.49, 0.66), t);
  vec3 night = mix(vec3(0.07, 0.09, 0.13), vec3(0.02, 0.03, 0.05), t);
  return mix(night, day, skyLight);
}

// how much of the light reaches the ground there: 1 unless a ridge hides it
float shadeOf(vec2 dir) {
  if (hasShadow == 0) return 1.0;
  vec2 at = gridUv(dir, shadowAz, shadowEl);
  return at.x < 0.0 ? 1.0 : texture(shadowMap, at).r;
}

// the sky's light on ground the body's light does or does not reach: in a
// shadow it keeps the share the analyst set (shadowKeep), in the open all of it
vec3 skyOn(float shade) {
  return ambient * mix(shadowKeep, 1.0, shade) * mix(vec3(0.75, 0.82, 1.0), vec3(1.0), skyLight);
}

// the light on ground facing n: the sky's, cooler as it darkens, and the
// body's where it is not hidden; a lit face by day sums to about one
vec3 lightOn(vec3 n, float shade) {
  float direct = lightStrength * max(dot(n, light), 0.0) * shade;
  return skyOn(shade) + (1.0 - min(ambient, 0.22)) * direct * lightTint;
}

// 0 next to the eye, 1 at the far limit, on a log scale as distance reads
float depthShare(float d) {
  return clamp(log(max(d, 50.0) / 300.0) / log(max(farLimit, 1000.0) / 300.0), 0.0, 1.0);
}

// a ridge line's colour: warm white near, cool blue far
vec3 lineTint(float d) {
  return mix(vec3(0.95, 0.90, 0.80), vec3(0.55, 0.70, 0.90), depthShare(d));
}

// the plain ground's sky, lighter toward the horizon than any ground under it
vec3 plainSky(float elevation) {
  return mix(vec3(0.17, 0.21, 0.27), vec3(0.07, 0.09, 0.12), clamp(elevation / 25.0 + 0.1, 0.0, 1.0));
}

// how sharply ground at d steps back to ground at other: 0 for no edge,
// more for a deeper step, which is drawn bolder
float stepTo(float d, float other) {
  if (other < 0.0 || other <= d * (1.0 + jump)) return 0.0;
  return clamp((other / d - 1.0 - jump) / (jump * 4.0) + 0.55, 0.55, 1.0);
}

// x: how strongly the pixel lies on a ridge line reach pixels thick, y: 1 on
// the skyline, which is twice as thick. Only the near side of a step is drawn.
vec2 edgeAt(vec2 px, float d, float reach) {
  float up = depthOf(directionAt(px - vec2(0.0, reach)));
  float left = depthOf(directionAt(px - vec2(reach, 0.0)));
  float right = depthOf(directionAt(px + vec2(reach, 0.0)));
  float up2 = depthOf(directionAt(px - vec2(0.0, 2.0 * reach)));
  if (up == -1.0 || left == -1.0 || right == -1.0 || up2 == -1.0) return vec2(1.0, 1.0);
  return vec2(max(stepTo(d, up), max(stepTo(d, left), stepTo(d, right))), 0.0);
}

vec3 groundColour(vec2 dir, float d, vec3 surface) {
  if (ground == 2) {
    if (d == -1.0) return plainSky(dir.y);
    if (d < 0.0) return vec3(0.05, 0.055, 0.06);
    // farther ground pales and cools, the way air layers a range
    float t = depthShare(surface.z);
    vec3 fill = mix(vec3(0.05, 0.055, 0.06), vec3(0.13, 0.15, 0.18), t);
    // a touch of the slope's light, so a face between two ridges still reads
    vec2 slope = surface.xy;
    vec3 facing = vec3(slope, sqrt(max(0.0, 1.0 - dot(slope, slope))));
    float lit = lightStrength * max(dot(facing, light), 0.0) * shadeOf(dir);
    return fill * (0.82 + 0.36 * lit * (1.0 - t * 0.6));
  }
  if (d == -1.0) return skyColour(dir.y);
  // the nearest ground, under the band: lit as level ground is, so a night darkens it too
  if (d < 0.0) return vec3(0.38, 0.37, 0.35) * lightOn(vec3(0.0, 0.0, 1.0), 1.0);
  if (ground == 1 && hasDrape == 1) {
    vec3 picture = drapeOf(dir);
    // the picture has its own shadows: the slope only nudges it, so a face
    // reads; a ridge's shadow and the night darken it
    vec2 tilted = surface.xy;
    vec3 facing = vec3(tilted, sqrt(max(0.0, 1.0 - dot(tilted, tilted))));
    float shade = shadeOf(dir);
    float sun = lightStrength * (0.28 + 0.28 * max(dot(facing, light), 0.0)) * shade;
    // by day in the open: 0.86 to 1.14 by the slope, as before shadows came
    picture *= 0.58 / 0.22 * skyOn(shade) + sun * lightTint;
    float veil = 1.0 - exp(-surface.z / 60000.0);
    // the air between lights up only as much as the sky does
    return mix(picture, skyColour(0.0), veil * 0.75 * mix(0.35, 1.0, skyLight));
  }
  vec2 en = surface.xy;
  vec3 n = vec3(en, sqrt(max(0.0, 1.0 - dot(en, en))));
  vec3 rock = vec3(0.62, 0.60, 0.56) * lightOn(n, shadeOf(dir));
  float haze = 1.0 - exp(-surface.z / 45000.0);
  return mix(rock, skyColour(0.0), haze * 0.85 * mix(0.35, 1.0, skyLight));
}

// the air between the eye and ground this far: its share of the colour, and
// none in clear air
float fogAt(float d) {
  return visibility > 0.0 ? 1.0 - exp(-3.0 * d / visibility) : 0.0;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  vec2 dir = directionAt(px);
  float d = depthOf(dir);
  vec3 surface = d >= 0.0 ? surfaceOf(dir, d) : vec3(0.0, 0.0, 0.0);
  vec3 base = groundColour(dir, d, surface);
  // a ridge line's ink and how much of the pixel it takes, or the dark edge it keeps
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
  // ground in thick air fades into it, lines and all
  vec3 air = ground == 2 ? plainSky(0.0) : skyColour(0.0);
  float fog = d >= 0.0 ? fogAt(surface.z) : 0.0;
  if (hasPhoto == 0) {
    base = mix(base * edgeDark, ink, inkShare);
    base = mix(base, air, fog);
  } else {
    // the photo over the hazed terrain, then the lines over both, hazed as before
    vec3 photo = texture(photoMap, px / size).rgb;
    base = mix(mix(base, air, fog), photo, photoMix);
    base *= mix(edgeDark, 1.0, fog);
    base = mix(base, mix(ink, air, fog), inkShare);
  }
  color = vec4(base, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`the Horizon shader did not compile: ${log}`);
  }
  return shader;
}

/** The unit vector toward a light at this azimuth and altitude, in degrees. */
export function lightVector(azimuth, altitude) {
  const a = (azimuth * Math.PI) / 180;
  const h = (altitude * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(h), Math.cos(a) * Math.cos(h), Math.sin(h)];
}

/**
 * A renderer on a canvas, or null where the browser has no WebGL2.
 *
 * @param {HTMLCanvasElement} canvas
 */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`the Horizon shader did not link: ${gl.getProgramInfoLog(program)}`);
  }
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const at = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name) => gl.getUniformLocation(program, name);

  const depthMap = gl.createTexture();
  const normalMap = gl.createTexture();
  const detailDepth = gl.createTexture();
  const detailNormal = gl.createTexture();
  const drapeMap = gl.createTexture();
  const detailDrape = gl.createTexture();
  const shadowMap = gl.createTexture();
  const skylineMap = gl.createTexture();
  const photoMap = gl.createTexture();
  let photo = false;
  let shadow = null;
  let panorama = null;
  let detail = null;
  let draped = false;
  let detailDraped = false;

  /** An image into a texture whose cells blend, wrapping round a whole turn. */
  function uploadImage(unit, handle, image, wrap) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  function texture(unit, handle) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    for (const [key, value] of [
      [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]) {
      gl.texParameteri(gl.TEXTURE_2D, key, value);
    }
  }

  /** One picture into a pair of textures. */
  function upload(picture, depthUnit, depthHandle, normalUnit, normalHandle) {
    const width = picture.azimuth.count;
    const height = picture.elevation.count;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    texture(depthUnit, depthHandle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, picture.depth);
    const normals = new Int8Array(width * height * 2);
    for (let i = 0; i < width * height; i += 1) {
      normals[2 * i] = picture.east[i];
      normals[2 * i + 1] = picture.north[i];
    }
    texture(normalUnit, normalHandle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8_SNORM, width, height, 0, gl.RG, gl.BYTE, normals);
  }

  const grid = (picture) => [
    picture.azimuth.start,
    picture.azimuth.step,
    picture.azimuth.count,
    picture.azimuth.full === false ? 0 : 1,
  ];

  return {
    /** Hand over a decoded panorama of the whole turn (`decodePanorama`). */
    setPanorama(next) {
      panorama = next;
      upload(next, 0, depthMap, 1, normalMap);
      // the skyline's exact elevation per column, which the silhouette follows
      const skyline = Float32Array.from(next.skyline ?? [], (value) => (Number.isFinite(value) ? value : -90));
      texture(7, skylineMap);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, skyline.length || 1, 1, 0, gl.RED, gl.FLOAT, skyline.length ? skyline : new Float32Array([90]));
    },

    /**
     * The ground's colours over the whole turn, on its grid: an image (an
     * ImageBitmap) the app laid out (`/api/horizon/drape`), or null to drop it.
     */
    setDrape(image) {
      draped = Boolean(image);
      if (image) uploadImage(4, drapeMap, image, panorama?.azimuth.full !== false);
    },

    /** The same for the finer window, on its grid. */
    setDetailDrape(image) {
      detailDraped = Boolean(image);
      if (image) uploadImage(5, detailDrape, image, false);
    },

    /**
     * The light the app marched over the terrain (`/api/horizon/shadow`): one
     * byte a cell on its own grid (`{ light, azimuth, elevation }`), blended
     * between cells so a shadow's edge stays soft; null to drop it.
     */
    setShadow(next) {
      shadow = next;
      if (!next) return;
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, shadowMap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, next.azimuth.full === false ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.R8, next.azimuth.count, next.elevation.count, 0, gl.RED, gl.UNSIGNED_BYTE, next.light
      );
    },

    /**
     * A photo laid over the view, fixed on screen: an ImageBitmap, or a video
     * whose frame on show is read again each time this is called; null to
     * take it away. A still is shrunk smoothly (mipmaps), a frame is not.
     */
    setPhoto(source) {
      photo = Boolean(source);
      if (!source) return;
      const moving = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, photoMap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, moving ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (!moving) gl.generateMipmap(gl.TEXTURE_2D);
    },

    /** A finer window of the turn for a narrow lens, or null to drop it. */
    setDetail(next) {
      detail = next;
      if (next) upload(next, 2, detailDepth, 3, detailNormal);
    },

    get ready() {
      return !!panorama;
    },

    /**
     * One frame. `camera` as `camera.js` takes it, in CSS pixels; the canvas is
     * drawn at its own pixel size. `ground` is 'relief', 'imagery' or 'plain';
     * `lines` lays the ridge lines over it. `sky` is the light (`skyLight`),
     * `shaded` whether the shadow held belongs to it, `keep` the share of the
     * sky's light ground in shadow keeps (`sky.js shadowKeep`), `visibility`
     * how far the air lets the eye see in metres (0 for clear air), `photo`
     * how much of a photo laid over the view shows (0 to 1).
     */
    draw(
      camera,
      {
        ground = 'relief',
        lines = false,
        sky = MAP_LIGHT,
        shaded = false,
        keep = 1,
        visibility = 0,
        jump = 0.12,
        photo: photoShare = 1,
      } = {}
    ) {
      const width = canvas.width;
      const height = canvas.height;
      gl.viewport(0, 0, width, height);
      if (!panorama) {
        gl.clearColor(0.07, 0.08, 0.09, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      const density = width / camera.width;
      const scaled = { ...camera, width, height };
      const axes = basis(camera);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      for (const [unit, handle, name] of [
        [0, depthMap, 'depthMap'],
        [1, normalMap, 'normalMap'],
        [2, detailDepth, 'detailDepth'],
        [3, detailNormal, 'detailNormal'],
        [4, drapeMap, 'drapeMap'],
        [5, detailDrape, 'detailDrape'],
        [6, shadowMap, 'shadowMap'],
        [7, skylineMap, 'skylineMap'],
        [8, photoMap, 'photoMap'],
      ]) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, handle);
        gl.uniform1i(uniform(name), unit);
      }
      gl.uniform2f(uniform('size'), width, height);
      gl.uniform1i(uniform('projection'), camera.projection === 'panorama' ? 1 : 0);
      gl.uniform3fv(uniform('forward'), axes.forward);
      gl.uniform3fv(uniform('right'), axes.right);
      gl.uniform3fv(uniform('up'), axes.up);
      gl.uniform1f(uniform('focalPx'), focal(scaled));
      gl.uniform1f(uniform('heading'), camera.heading);
      gl.uniform1f(uniform('tilt'), camera.tilt);
      gl.uniform1f(uniform('degPerPx'), camera.fov / width);
      gl.uniform4fv(uniform('azGrid'), grid(panorama));
      gl.uniform3f(uniform('elGrid'), panorama.elevation.top, panorama.elevation.step, panorama.elevation.count);
      gl.uniform1i(uniform('hasDetail'), detail ? 1 : 0);
      if (detail) {
        gl.uniform4fv(uniform('detailAz'), grid(detail));
        gl.uniform3f(uniform('detailEl'), detail.elevation.top, detail.elevation.step, detail.elevation.count);
      }
      gl.uniform1i(uniform('ground'), GROUND_CODES[ground] ?? 0);
      gl.uniform1i(uniform('lines'), lines ? 1 : 0);
      gl.uniform1i(uniform('hasDrape'), draped ? 1 : 0);
      gl.uniform1i(uniform('hasDetailDrape'), detailDraped && detail ? 1 : 0);
      gl.uniform3fv(uniform('light'), lightVector(sky.azimuth, sky.altitude));
      gl.uniform3fv(uniform('lightTint'), sky.tint);
      gl.uniform1f(uniform('lightStrength'), sky.strength);
      gl.uniform1f(uniform('ambient'), sky.ambient);
      gl.uniform1f(uniform('skyLight'), sky.sky);
      gl.uniform1f(uniform('shadowKeep'), keep);
      gl.uniform1f(uniform('visibility'), visibility > 0 ? visibility : 0);
      const shading = Boolean(shaded && shadow);
      gl.uniform1i(uniform('hasShadow'), shading ? 1 : 0);
      if (shading) {
        gl.uniform4fv(uniform('shadowAz'), grid(shadow));
        gl.uniform3f(uniform('shadowEl'), shadow.elevation.top, shadow.elevation.step, shadow.elevation.count);
      }
      // lines are tested a CSS pixel apart, so a dense screen draws them as thick
      gl.uniform1f(uniform('jump'), jump);
      gl.uniform1f(uniform('cssPx'), Math.max(1, Math.round(density)));
      gl.uniform1f(uniform('farLimit'), panorama.far);
      gl.uniform1f(uniform('nearLimit'), panorama.near ?? 0);
      gl.uniform1i(uniform('hasPhoto'), photo ? 1 : 0);
      gl.uniform1f(uniform('photoMix'), Math.min(1, Math.max(0, photoShare)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    dispose() {
      gl.deleteTexture(depthMap);
      gl.deleteTexture(normalMap);
      gl.deleteTexture(detailDepth);
      gl.deleteTexture(detailNormal);
      gl.deleteTexture(drapeMap);
      gl.deleteTexture(detailDrape);
      gl.deleteTexture(shadowMap);
      gl.deleteTexture(skylineMap);
      gl.deleteTexture(photoMap);
      gl.deleteBuffer(corners);
      gl.deleteProgram(program);
      panorama = null;
      detail = null;
    },
  };
}

export { SKY };
