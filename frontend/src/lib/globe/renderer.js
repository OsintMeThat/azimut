/**
 * Draws the globe on the GPU: the sky, then every tile with its picture.
 *
 * Everything is placed relative to the eye. Each tile's vertices are relative
 * to its own centre (mesh.js), and the step from the eye to that centre is
 * worked out at full precision on the page and handed over per tile, so the
 * GPU's single floats only ever hold small numbers: the ground a metre from the
 * eye stays as steady as the ground seen from space.
 *
 * Depth is written on a logarithmic scale of the distance, from `NEAR` to
 * `FAR`, which keeps ground a few metres away and ground thousands of
 * kilometres away apart in one buffer with no plane to tune per view.
 *
 * The sky is one pass over the screen that works out, per pixel, whether its
 * ray meets the sphere: what it meets shows the sea (only ever seen where no
 * tile is drawn, past the Mercator grid at the poles), what it misses shows the
 * air, pale at the horizon, blue above, and from high up the black of space
 * with the atmosphere's rim round the Earth. The ground is lit by its slope as
 * a hillshade from the north-west, gently over a picture that has its own
 * shadows, and veiled by the air between it and the eye, thicker low down.
 *
 * Without a picture the ground is drawn plain (`setGround`): a colour, the
 * heights tinted over it, and its slopes shaded over what is laid on it, as a
 * plate's quiet and topographic grounds are drawn flat. A picture takes the
 * flat map's tone (`setTone`): faded over the plain ground, greyed, lit,
 * contrasted, its hue turned, by the flat map's own formulas.
 *
 * WebGL2 is the one requirement; without it `createRenderer` answers null.
 */
import { EARTH, length, localFrame, sub } from './earth.js';
import { QUARTER, STRIDE, tileIndices } from './mesh.js';

export const NEAR = 0.5;
export const FAR = 1e8;
const LOG_FAR = Math.log2(FAR / NEAR);

/** The ground's look while it has no picture yet: a pale stone, lit by its relief. */
const BARE = [0.55, 0.55, 0.52];
/** How strongly the slope lights a picture, which already holds its own shadows. */
const SHADING = 0.45;
/** Height stops a tinted ground takes at most. */
export const TINT_STOPS = 10;

/** A `#rrggbb` colour as three channels from 0 to 1. */
export function rgbOf(hex) {
  const value = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''))?.[1];
  if (!value) return null;
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
}

/**
 * The plain ground the shader draws where there is no picture: `colour`, the
 * heights `tints` (metres, colour) laid over it at `tintOpacity`, and the
 * slopes shaded at `shade` over what is laid on the ground too (`shadeLaid`).
 * Without a style, the pale stone a ground waits for its picture on.
 */
export function groundUniforms(style = null) {
  const stops = (style?.tints ?? [])
    .map(([metres, hex]) => [Number(metres), rgbOf(hex)])
    .filter(([metres, rgb]) => Number.isFinite(metres) && rgb)
    .slice(0, TINT_STOPS);
  const at = new Float32Array(TINT_STOPS);
  const colours = new Float32Array(TINT_STOPS * 3);
  stops.forEach(([metres, rgb], i) => {
    at[i] = metres;
    colours.set(rgb, i * 3);
  });
  return {
    bare: rgbOf(style?.colour) ?? BARE,
    tintCount: stops.length,
    tintAt: at,
    tintColour: colours,
    tintOpacity: Math.min(1, Math.max(0, style?.tintOpacity ?? 0.85)),
    shade: Math.min(1, Math.max(0, style?.shade ?? 1)),
    shadeLaid: style ? 1 : 0,
  };
}

/**
 * A picture's tone as the flat map paints a raster (`raster-opacity`,
 * `-saturation`, `-brightness-max`, `-contrast`, `-hue-rotate`): the same
 * factors its shader is handed, so a picture looks the same on both.
 */
export function toneUniforms(tone = {}) {
  const angle = ((tone.hue ?? 0) * Math.PI) / 180;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const saturation = tone.saturation ?? 0;
  const contrast = tone.contrast ?? 0;
  return {
    spin: [(2 * c + 1) / 3, (-Math.sqrt(3) * s - c + 1) / 3, (Math.sqrt(3) * s - c + 1) / 3],
    saturation: saturation > 0 ? 1 - 1 / (1.001 - saturation) : -saturation,
    contrast: contrast > 0 ? 1 / (1 - contrast) : 1 + contrast,
    brightnessLow: tone.brightnessMin ?? 0,
    brightnessHigh: tone.brightness ?? 1,
    opacity: Math.min(1, Math.max(0, tone.opacity ?? 1)),
  };
}

const AIR = `
const float R = ${EARTH.toFixed(1)};
const vec3 HAZE = vec3(0.78, 0.84, 0.90);
// how much air lies between the eye and a point d metres away at height hp,
// the air thinning with height (8 km to a fold)
float airBetween(float d, float he, float hp) {
  float H = 8000.0;
  float dh = he - hp;
  float lo = exp(-max(hp, -500.0) / H);
  float hi = exp(-max(he, -500.0) / H);
  float density = abs(dh) < 1.0 ? lo : (lo - hi) * H / dh;
  return 1.0 - exp(-d * density / 90000.0);
}`;

const SKY_VS = `#version 300 es
layout(location = 0) in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
${AIR}
uniform vec3 fwd; uniform vec3 rgt; uniform vec3 cup;
uniform vec2 focal; uniform vec2 size;
uniform vec3 eyeUp; uniform float eyeAlt;
out vec4 colour;
void main() {
  vec2 ndc = gl_FragCoord.xy / size * 2.0 - 1.0;
  vec3 dir = normalize(fwd + rgt * (ndc.x / focal.x) + cup * (ndc.y / focal.y));
  float r = R + eyeAlt;
  float s = dot(dir, eyeUp);
  float b = r * s;
  float c = eyeAlt * (2.0 * R + eyeAlt);
  float disc = b * b - c;
  float t = disc > 0.0 ? -b - sqrt(disc) : -1.0;
  if (t > 0.0) {
    vec3 sea = vec3(0.09, 0.15, 0.22);
    colour = vec4(mix(sea, HAZE, airBetween(t, eyeAlt, 0.0)), 1.0);
    return;
  }
  // the air seen from inside it: pale at the horizon, which dips as the eye rises
  float dip = -sqrt(max(0.0, 2.0 * eyeAlt / R));
  float above = clamp((s - dip) / 0.35, 0.0, 1.0);
  vec3 day = mix(HAZE, vec3(0.32, 0.49, 0.72), pow(above, 0.6));
  // …and from space: dark, with a rim of air round the Earth
  float closest = s < 0.0 ? r * sqrt(max(0.0, 1.0 - s * s)) : r;
  float rim = exp(-max(closest - R, 0.0) / 30000.0);
  vec3 space = mix(vec3(0.012, 0.016, 0.03), vec3(0.42, 0.6, 0.88), rim);
  float high = smoothstep(12000.0, 160000.0, eyeAlt);
  colour = vec4(mix(day, space, high), 1.0);
}`;

const GROUND_VS = `#version 300 es
layout(location = 0) in vec3 base;
layout(location = 1) in vec3 up;
layout(location = 2) in float h;
layout(location = 3) in vec3 nrm;
layout(location = 4) in vec2 uv;
uniform vec3 offset;
uniform vec3 rgt; uniform vec3 cup; uniform vec3 fwd;
uniform vec2 focal;
uniform float exaggeration;
uniform vec4 box;
out vec3 vRel; out vec3 vUp; out vec3 vN; out vec2 vUv; out vec2 vTileUv; out float vDepth; out float vH; out float vMetres;
void main() {
  float lift = h * exaggeration;
  vMetres = h;
  vec3 p = offset + base + up * lift;
  float z = dot(p, fwd);
  vRel = p;
  vUp = up;
  vH = lift;
  // a steeper relief has steeper slopes: the normal's level part grows with it
  float along = dot(nrm, up);
  vN = up * along + (nrm - up * along) * exaggeration;
  vUv = uv * box.xy + box.zw;
  vTileUv = uv;
  vDepth = z;
  gl_Position = vec4(dot(p, rgt) * focal.x, dot(p, cup) * focal.y, z - ${(2 * NEAR).toFixed(1)}, z);
}`;

const GROUND_FS = `#version 300 es
precision highp float;
${AIR}
in vec3 vRel; in vec3 vUp; in vec3 vN; in vec2 vUv; in vec2 vTileUv; in float vDepth; in float vH; in float vMetres;
uniform sampler2D picture; uniform float pictured;
uniform sampler2D overlay; uniform float overlaid; uniform vec4 overlayBox;
uniform float eyeAlt;
uniform vec3 bare;
uniform int tintCount; uniform float tintAt[${TINT_STOPS}]; uniform vec3 tintColour[${TINT_STOPS}]; uniform float tintOpacity;
uniform float shade; uniform float shadeLaid;
uniform vec3 spin; uniform float saturation; uniform float contrast;
uniform float brightnessLow; uniform float brightnessHigh; uniform float opacity;
out vec4 colour;
// the heights' colour, between the two stops a height falls between
vec3 tint(float m) {
  if (m <= tintAt[0]) return tintColour[0];
  for (int i = 1; i < ${TINT_STOPS}; i += 1) {
    if (i >= tintCount) break;
    if (m <= tintAt[i]) return mix(tintColour[i - 1], tintColour[i], (m - tintAt[i - 1]) / max(tintAt[i] - tintAt[i - 1], 1e-3));
  }
  return tintColour[tintCount - 1];
}
// a picture in the flat map's tone (its raster shader, step for step)
vec3 toned(vec3 c) {
  vec3 rgb = vec3(dot(c, spin.xyz), dot(c, spin.zxy), dot(c, spin.yzx));
  float average = (c.r + c.g + c.b) / 3.0;
  rgb += (average - rgb) * saturation;
  rgb = (rgb - 0.5) * contrast + 0.5;
  return mix(vec3(brightnessLow), vec3(brightnessHigh), rgb);
}
void main() {
  gl_FragDepth = clamp(log2(max(vDepth, ${NEAR.toFixed(1)}) / ${NEAR.toFixed(1)}) / ${LOG_FAR.toFixed(6)}, 0.0, 1.0);
  vec3 up = normalize(vUp);
  vec3 n = normalize(vN);
  vec3 east = normalize(vec3(-up.y, up.x, 0.0) + vec3(1e-7, 0.0, 0.0));
  vec3 north = cross(up, east);
  vec3 light = normalize(up * 1.2 + north * 0.7 - east * 0.7);
  float lit = 0.62 + 0.5 * max(dot(n, light), 0.0);
  vec3 plain = bare;
  if (tintCount > 0) plain = mix(plain, tint(vMetres), tintOpacity);
  // a ground with no style waits for its picture lit by its relief; a styled one is shaded over what lies on it
  float plainLight = mix(1.0, lit, shade);
  vec3 ground = pictured > 0.5
    ? mix(plain, toned(clamp(texture(picture, vUv).rgb, 0.0, 1.0)), opacity) * mix(1.0, lit, ${SHADING.toFixed(2)})
    : plain * (shadeLaid > 0.5 ? 1.0 : plainLight);
  // what the flat map lays on the ground (drape.js), premultiplied, unshaded so its lines stay crisp
  if (overlaid > 0.5) {
    vec4 laid = texture(overlay, vTileUv * overlayBox.xy + overlayBox.zw);
    ground = ground * (1.0 - laid.a) + laid.rgb;
  }
  if (pictured < 0.5 && shadeLaid > 0.5) ground *= plainLight;
  colour = vec4(mix(ground, HAZE, airBetween(length(vRel), eyeAlt, vH)), 1.0);
}`;

/** The ground as Satellite draws it: pictures as they are, a pale stone until they come. */
const LOOK = { plain: groundUniforms(null), tone: toneUniforms() };

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  return shader;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const { name } = gl.getActiveUniform(p, i);
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { p, u: uniforms };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {null | ReturnType<typeof build>}
 */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;
  return build(gl);
}

function build(gl) {
  const sky = program(gl, SKY_VS, SKY_FS);
  const ground = program(gl, GROUND_VS, GROUND_FS);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const anisoMax = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0;

  const skyVao = gl.createVertexArray();
  gl.bindVertexArray(skyVao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const indices = tileIndices();
  const indexBuffer = gl.createBuffer();
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  return {
    gl,
    /** A tile's vertices on the GPU. */
    createMesh(vertices) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      const bytes = STRIDE * 4;
      const attribute = (location, count, offset) => {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, count, gl.FLOAT, false, bytes, offset * 4);
      };
      attribute(0, 3, 0);
      attribute(1, 3, 3);
      attribute(2, 1, 6);
      attribute(3, 3, 7);
      attribute(4, 2, 10);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bindVertexArray(null);
      return { vao, buffer };
    },
    deleteMesh(mesh) {
      if (!mesh) return;
      gl.deleteVertexArray(mesh.vao);
      gl.deleteBuffer(mesh.buffer);
    },
    /** A picture on the GPU, mipmapped and read at an angle as sharply as the GPU allows. */
    createTexture(bitmap) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (anisoMax) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, anisoMax);
      return { texture, bytes: Math.round(bitmap.width * bitmap.height * 4 * (4 / 3)) };
    },
    /** A picture laid over the imagery: kept premultiplied, so its see-through edges blend clean when mipmapped. */
    createOverlayTexture(bitmap) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (anisoMax) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, anisoMax);
      return { texture, bytes: Math.round(bitmap.width * bitmap.height * 4 * (4 / 3)) };
    },
    deleteTexture(handle) {
      if (handle?.texture) gl.deleteTexture(handle.texture);
    },
    /**
     * One frame. `view` is the camera's axes and eye (tree.js `viewOf`),
     * `size` the drawing buffer's pixels, `tiles` what to draw:
     * `[{ mesh, centre, quarters, picture: { handle, box } | null, drape }]`,
     * the quarters a bit each (north-west first), all four for the whole tile,
     * and `drape` what is laid over the picture, as `picture` is.
     */
    draw({ view, size, tiles, exaggeration, look = LOOK }) {
      const { forward, right, up, eye, f } = view;
      gl.viewport(0, 0, size.width, size.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // the lens in clip units: CSS focal over half the CSS size, the same either way
      const fx = f / (view.cssWidth / 2);
      const fy = f / (view.cssHeight / 2);
      const frame = localFrame(eye);
      const eyeAlt = length(eye) - EARTH;

      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(sky.p);
      gl.uniform3fv(sky.u.fwd, forward);
      gl.uniform3fv(sky.u.rgt, right);
      gl.uniform3fv(sky.u.cup, up);
      gl.uniform2f(sky.u.focal, fx, fy);
      gl.uniform2f(sky.u.size, size.width, size.height);
      gl.uniform3fv(sky.u.eyeUp, frame.up);
      gl.uniform1f(sky.u.eyeAlt, eyeAlt);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.useProgram(ground.p);
      gl.uniform3fv(ground.u.fwd, forward);
      gl.uniform3fv(ground.u.rgt, right);
      gl.uniform3fv(ground.u.cup, up);
      gl.uniform2f(ground.u.focal, fx, fy);
      gl.uniform1f(ground.u.exaggeration, exaggeration);
      gl.uniform1f(ground.u.eyeAlt, eyeAlt);
      gl.uniform1i(ground.u.picture, 0);
      gl.uniform1i(ground.u.overlay, 1);
      const { plain, tone } = look;
      gl.uniform3fv(ground.u.bare, plain.bare);
      gl.uniform1i(ground.u.tintCount, plain.tintCount);
      gl.uniform1fv(ground.u['tintAt[0]'], plain.tintAt);
      gl.uniform3fv(ground.u['tintColour[0]'], plain.tintColour);
      gl.uniform1f(ground.u.tintOpacity, plain.tintOpacity);
      gl.uniform1f(ground.u.shade, plain.shade);
      gl.uniform1f(ground.u.shadeLaid, plain.shadeLaid);
      gl.uniform3fv(ground.u.spin, tone.spin);
      gl.uniform1f(ground.u.saturation, tone.saturation);
      gl.uniform1f(ground.u.contrast, tone.contrast);
      gl.uniform1f(ground.u.brightnessLow, tone.brightnessLow);
      gl.uniform1f(ground.u.brightnessHigh, tone.brightnessHigh);
      gl.uniform1f(ground.u.opacity, tone.opacity);
      for (const tile of tiles) {
        const rel = sub(tile.centre, eye);
        gl.uniform3f(ground.u.offset, rel[0], rel[1], rel[2]);
        gl.activeTexture(gl.TEXTURE1);
        if (tile.drape) {
          gl.bindTexture(gl.TEXTURE_2D, tile.drape.handle.texture);
          gl.uniform4fv(ground.u.overlayBox, tile.drape.box);
          gl.uniform1f(ground.u.overlaid, 1);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, null);
          gl.uniform1f(ground.u.overlaid, 0);
        }
        gl.activeTexture(gl.TEXTURE0);
        if (tile.picture) {
          gl.bindTexture(gl.TEXTURE_2D, tile.picture.handle.texture);
          gl.uniform4fv(ground.u.box, tile.picture.box);
          gl.uniform1f(ground.u.pictured, 1);
        } else {
          gl.uniform4f(ground.u.box, 1, 1, 0, 0);
          gl.uniform1f(ground.u.pictured, 0);
        }
        gl.bindVertexArray(tile.mesh.vao);
        // runs of quarters side by side in the indices go in one call
        const quarters = tile.quarters ?? 15;
        for (let q = 0; q < 4; q += 1) {
          if (!(quarters & (1 << q))) continue;
          let end = q + 1;
          while (end < 4 && quarters & (1 << end)) end += 1;
          gl.drawElements(gl.TRIANGLES, (end - q) * QUARTER, gl.UNSIGNED_SHORT, q * QUARTER * 2);
          q = end;
        }
      }
      gl.bindVertexArray(null);
    },
    get lost() {
      return gl.isContextLost();
    },
    dispose() {
      gl.deleteBuffer(corners);
      gl.deleteBuffer(indexBuffer);
      gl.deleteVertexArray(skyVao);
      gl.deleteProgram(sky.p);
      gl.deleteProgram(ground.p);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
